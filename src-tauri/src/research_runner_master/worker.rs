//! One native owner of master lifecycle observations, sampling and persistence.
use super::{
    forms::FormAnswers,
    information::{ContentKind, PreparedTransfer},
    lsl::MasterLslService,
    markers::{MarkerEvent, MasterMarkers},
    response::ResponseState,
    runtime::{lock, InputAuthority, MasterAction, MasterPhase, MasterStatus, Message},
    storage::MasterStorage,
    MasterStep, MasterStepKind, PreparedMaster,
};
use crate::{
    research_error::{CommandError, ResearchResult},
    research_lsl::LslState,
    research_native_media::{
        NativeMediaCommandFenceV1, NativeMediaService, NativeMediaStateV1, NativeMediaStatusV1,
        NativeMediaViewportPxV1,
    },
    research_native_protocol::{input_mailbox::ProtocolInputMailbox, runtime::CompanionLease},
    research_recorder::RecorderService,
    research_timing::DeadlineClock,
    research_workspace::{RunnerVideoBinding, WorkspaceService},
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    sync::{
        mpsc::{Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub(crate) struct MasterWorker {
    prepared: PreparedMaster,
    workspace_id: String,
    bindings: Vec<RunnerVideoBinding>,
    viewport: NativeMediaViewportPxV1,
    storage: MasterStorage,
    authority: InputAuthority,
    mailbox: Arc<ProtocolInputMailbox>,
    workspace: Arc<WorkspaceService>,
    media: Arc<NativeMediaService>,
    recorder: Arc<RecorderService>,
    _lease: CompanionLease,
    pub public: Arc<Mutex<MasterStatus>>,
    state: MasterStatus,
    response: ResponseState,
    markers: MasterMarkers,
    lsl: Option<MasterLslService>,
    epoch: Instant,
    step_started: Option<Instant>,
    transition_started: Instant,
    occurrence: String,
    opened: bool,
    fence: Option<NativeMediaCommandFenceV1>,
    bound_file: Option<String>,
    media_sequence: u64,
    clock: Option<DeadlineClock>,
    interval_deadline: Option<Instant>,
    answers: FormAnswers,
    typed_answers: super::typed_forms::TypedFormAnswers,
    terminal: bool,
    pub cancellation: Arc<AtomicBool>,
    #[cfg(test)]
    before_observe: Option<fn(&MasterWorker, MarkerEvent)>,
}
impl MasterWorker {
    #[allow(clippy::too_many_arguments)] // Private composition, no untyped IPC arguments.
    pub(crate) fn new(
        prepared: PreparedMaster,
        workspace_id: String,
        bindings: Vec<RunnerVideoBinding>,
        viewport: NativeMediaViewportPxV1,
        mut storage: MasterStorage,
        authority: InputAuthority,
        mailbox: Arc<ProtocolInputMailbox>,
        workspace: Arc<WorkspaceService>,
        media: Arc<NativeMediaService>,
        recorder: Arc<RecorderService>,
        lease: CompanionLease,
    ) -> ResearchResult<Self> {
        let run_id = storage.receipt["runId"]
            .as_str()
            .ok_or_else(|| invalid("Missing run identity."))?
            .to_owned();
        let attempt_id = storage.receipt["attemptId"]
            .as_str()
            .ok_or_else(|| invalid("Missing attempt identity."))?
            .to_owned();
        let markers = MasterMarkers::new(&prepared.plan, &run_id, &attempt_id)?;
        storage.profile(&markers.profile_message)?;
        let settings = crate::research_runner_session::participant_lsl(
            &prepared.loaded.recipe.policy().lsl,
            &prepared.plan.participant_id,
        )?;
        let startup = super::information::startup_bundle(
            &prepared,
            &markers,
            &settings,
            storage.receipt["participant"].clone(),
        );
        let startup = PreparedTransfer::new(&startup)?;
        let lsl = if settings.enabled {
            Some(MasterLslService::start(
                &settings,
                prepared.loaded.recipe.policy().sampling_frequency_hz as u16,
                &run_id,
                &prepared.plan.recipe_source_byte_sha256,
                &recorder,
                &attempt_id,
                startup,
            )?)
        } else {
            None
        };
        let now = Instant::now();
        let state = MasterStatus {
            schema: "affect-runner-master-status",
            version: prepared.plan.version,
            active: true,
            run_id,
            attempt_id,
            participant_id: prepared.plan.participant_id.clone(),
            recipe_source_byte_sha256: prepared.plan.recipe_source_byte_sha256.clone(),
            plan_identity_sha256: prepared.plan.plan_identity_sha256.clone(),
            phase: MasterPhase::AwaitingPresentation,
            position: 1,
            step_count: prepared.plan.steps.len() as u32,
            completed_step_count: 0,
            answers: Default::default(),
            sample_count: 0,
            event_count: 0,
            missed_slot_count: 0,
            current_valence: 0.,
            current_arousal: 0.,
            input_active: false,
            interval_remaining_ms: None,
            media_time_ms: None,
            failure_code: None,
            result: None,
        };
        let response = ResponseState::new(prepared.feedback.response.clone(), now);
        Ok(Self {
            prepared,
            workspace_id,
            bindings,
            viewport,
            storage,
            authority,
            mailbox,
            workspace,
            media,
            recorder,
            _lease: lease,
            public: Arc::new(Mutex::new(state.clone())),
            state,
            response,
            markers,
            lsl,
            epoch: now,
            step_started: None,
            transition_started: now,
            occurrence: String::new(),
            opened: false,
            fence: None,
            bound_file: None,
            media_sequence: 0,
            clock: None,
            interval_deadline: None,
            answers: Default::default(),
            terminal: false,
            typed_answers: Default::default(),
            cancellation: Arc::new(AtomicBool::new(false)),
            #[cfg(test)]
            before_observe: None,
        })
    }
    pub(crate) fn run(&mut self, receiver: Receiver<Message>) {
        if let Err(e) = self.observe(MarkerEvent::SessionStart, false) {
            self.fail(&e.code);
            return;
        }
        while !self.terminal {
            if self.cancellation.load(Ordering::Acquire) {
                self.fail("master-window-closing");
                break;
            }
            let now = Instant::now();
            let wait = self
                .clock
                .as_ref()
                .map(|c| c.next_deadline().saturating_duration_since(now))
                .unwrap_or(Duration::from_millis(25))
                .min(Duration::from_millis(4));
            match receiver.recv_timeout(wait) {
                Ok((action, reply)) => {
                    let result = self.action(action);
                    // Validation errors reject the command; failures in accepted work
                    // terminate acquisition and retain a partial attempt.
                    if let Err(e) = &result {
                        if e.code != "invalid_research_contract" {
                            self.fail(&e.code);
                        }
                    }
                    self.publish();
                    let _ = reply.send(result.map(|_| self.state.clone()));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.fail("master-controller-disconnected");
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
            if !self.terminal {
                if let Err(e) = self.tick() {
                    self.fail(&e.code);
                }
            }
        }
    }
    fn current(&self) -> ResearchResult<&MasterStep> {
        self.prepared
            .plan
            .steps
            .get(self.state.position.saturating_sub(1) as usize)
            .ok_or_else(|| invalid("No current master occurrence."))
    }
    fn action(&mut self, action: MasterAction) -> ResearchResult<()> {
        match action {
            MasterAction::Stop => self.finish(false, None),
            MasterAction::Presented { position } => {
                self.require_position(position, MasterPhase::AwaitingPresentation)?;
                let step = self.current()?.clone();
                self.occurrence = format!("execution-{}", uuid::Uuid::new_v4());
                self.transition_started = Instant::now();
                match step.kind {
                    MasterStepKind::Questionnaire => {
                        self.state.phase = MasterPhase::Questionnaire;
                        self.step_started = Some(Instant::now());
                        self.observe(MarkerEvent::FormStart, true)?;
                        self.opened = true;
                    }
                    MasterStepKind::Interval => {
                        // Complete the native dispatch barrier before clearing any
                        // final queued release/absolute update and resetting P5.
                        self.quiesce()?;
                        self.reset_response();
                        // Publish neutral while still awaiting admission, before
                        // the interval clock or IsiStart can become observable.
                        self.publish();
                        self.state.phase = MasterPhase::Interval;
                        let now = Instant::now();
                        self.step_started = Some(now);
                        self.interval_deadline = Some(
                            now + Duration::from_millis(
                                step.duration_ms
                                    .ok_or_else(|| invalid("Missing interval duration."))?,
                            ),
                        );
                        self.observe(MarkerEvent::IsiStart, true)?;
                        self.opened = true;
                    }
                    MasterStepKind::Video => self.prepare_video(&step)?,
                }
                Ok(())
            }
            MasterAction::Draft { position, answers } => {
                self.answers_action(position, answers, false)
            }
            MasterAction::Submit { position, answers } => {
                self.answers_action(position, answers, true)
            }
            MasterAction::DraftV2 { position, answers } => {
                self.typed_answers_action(position, answers, false)
            }
            MasterAction::SubmitV2 { position, answers } => {
                self.typed_answers_action(position, answers, true)
            }
            MasterAction::Pause => {
                if self.state.phase != MasterPhase::Playing {
                    return Err(invalid("Pause requires native Playing."));
                }
                self.quiesce()?;
                self.state.phase = MasterPhase::Pausing;
                self.transition_started = Instant::now();
                let status = self.media.pause(
                    self.fence
                        .clone()
                        .ok_or_else(|| invalid("Missing media fence."))?,
                )?;
                self.reconcile(status)
            }
            MasterAction::Resume => {
                if self.state.phase != MasterPhase::Paused {
                    return Err(invalid("Resume requires native Paused."));
                }
                self.state.phase = MasterPhase::Resuming;
                self.transition_started = Instant::now();
                let status = self.media.play(
                    self.fence
                        .clone()
                        .ok_or_else(|| invalid("Missing media fence."))?,
                )?;
                self.reconcile(status)
            }
        }
    }
    fn answers_action(
        &mut self,
        position: u32,
        answers: Vec<super::runtime::MasterChoice>,
        submitted: bool,
    ) -> ResearchResult<()> {
        if self.prepared.plan.version != 1 {
            return Err(invalid("Use the versioned master answer command."));
        }
        self.require_position(position, MasterPhase::Questionnaire)?;
        let step = self.current()?.clone();
        let mut record = self.answers.replace(
            &step,
            answers,
            submitted,
            self.step_started
                .ok_or_else(|| invalid("Questionnaire was not presented."))?,
            Instant::now(),
        )?;
        self.state.answers = self
            .answers
            .projection()
            .into_iter()
            .map(|(id, value)| (id, json!(value)))
            .collect();
        self.record_answers(&mut record, submitted)
    }
    fn typed_answers_action(
        &mut self,
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
        submitted: bool,
    ) -> ResearchResult<()> {
        use super::typed_forms::FormAnswerValue;
        if self.prepared.plan.version != 2 {
            return Err(invalid("Typed answers require master version 2."));
        }
        self.require_position(position, MasterPhase::Questionnaire)?;
        let step = self.current()?.clone();
        let start = self
            .step_started
            .ok_or_else(|| invalid("Questionnaire was not presented."))?;
        let now = Instant::now();
        let mut record = if step.payload["definition"]["schema"]
            == "affect-research-form-definition"
        {
            let definition = crate::research_form_definition::decode_form_definition_v1(
                &step.payload["definition"],
            )?;
            let result = self
                .typed_answers
                .replace(&definition, answers, submitted, start, now)?;
            self.state.answers = self
                .typed_answers
                .projection()
                .into_iter()
                .map(|(id, value)| (id, json!(value)))
                .collect();
            json!({"schema":"affect-runner-master-responses","version":2,"entryId":step.entry_id,"position":step.position,"module":step.payload["module"],"questionnaireId":definition.questionnaire_id,"questionnaireVersion":definition.questionnaire_version,"definitionSha256":definition.definition_sha256,"status":if submitted {"submitted"} else {"draft"},"responses":result.responses})
        } else {
            let choices = answers
                .into_iter()
                .map(|choice| match choice.value {
                    FormAnswerValue::SingleChoice { option_id } => {
                        Ok(super::runtime::MasterChoice {
                            item_id: choice.item_id,
                            option_id,
                        })
                    }
                    _ => Err(invalid(
                        "Likert answers require a frozen single-choice option.",
                    )),
                })
                .collect::<ResearchResult<Vec<_>>>()?;
            let mut record = self
                .answers
                .replace(&step, choices, submitted, start, now)?;
            record["version"] = json!(2);
            self.state.answers = self
                .answers
                .projection()
                .into_iter()
                .map(|(id, option_id)| (id, json!(FormAnswerValue::SingleChoice { option_id })))
                .collect();
            record
        };
        self.record_answers(&mut record, submitted)
    }
    fn record_answers(&mut self, record: &mut Value, submitted: bool) -> ResearchResult<()> {
        record["runId"] = json!(self.state.run_id);
        record["attemptId"] = json!(self.state.attempt_id);
        record["participantId"] = json!(self.state.participant_id);
        record["recipeSourceByteSha256"] = json!(self.state.recipe_source_byte_sha256);
        record["planIdentitySha256"] = json!(self.state.plan_identity_sha256);
        record["monotonicMs"] = json!(self.elapsed());
        self.storage.responses(record)?;
        if let Some(lsl) = &mut self.lsl {
            lsl.record(ContentKind::Responses, record)?;
        }
        if submitted {
            self.observe(MarkerEvent::FormEnd, true)?;
            self.next()?;
        }
        Ok(())
    }
    fn require_position(&self, position: u32, phase: MasterPhase) -> ResearchResult<()> {
        if self.state.position != position || self.state.phase != phase {
            Err(invalid(
                "This command targets a stale or unavailable master occurrence.",
            ))
        } else {
            Ok(())
        }
    }
    fn prepare_video(&mut self, step: &MasterStep) -> ResearchResult<()> {
        let asset = &step.payload["asset"];
        let binding = self
            .bindings
            .iter()
            .find(|b| {
                asset["assetId"] == b.asset_id
                    && asset["sourceRelativePath"] == b.source_relative_path
            })
            .ok_or_else(|| {
                invalid("The video occurrence has no exact native asset/location binding.")
            })?;
        let grant = self.workspace.issue_native_media_grant(
            &self.workspace_id,
            &binding.workspace_file_id,
            &binding.sha256,
            binding.byte_length,
            &binding.mime_type,
        )?;
        self.bound_file = Some(binding.workspace_file_id.clone());
        let receipt = self.media.prepare(grant, self.viewport)?;
        self.fence = Some(NativeMediaCommandFenceV1 {
            session_id: receipt.session_id,
            generation: receipt.generation,
        });
        self.media_sequence = 0;
        self.state.phase = MasterPhase::Preparing;
        let status = self.media.play(
            self.fence
                .clone()
                .ok_or_else(|| invalid("Missing media fence."))?,
        )?;
        self.reconcile(status)
    }
    fn tick(&mut self) -> ResearchResult<()> {
        if self.fence.is_some() {
            self.reconcile(self.media.status_snapshot()?)?;
        }
        let now = Instant::now();
        if matches!(
            self.state.phase,
            MasterPhase::Preparing | MasterPhase::Resuming | MasterPhase::Pausing
        ) && now.duration_since(self.transition_started) > Duration::from_secs(15)
        {
            return Err(CommandError::new(
                "master-media-transition-timeout",
                "Native media transition did not complete.",
            ));
        }
        if self.state.phase == MasterPhase::Playing {
            let drained = self.mailbox.drain()?;
            let mut missed = 0;
            for input in drained.digital {
                missed += self.response.digital(input);
            }
            if let Some(input) = drained.continuous {
                missed += self.response.continuous(input);
            }
            missed += self.response.advance(now);
            if missed > 0 || drained.coalesced_count > 0 {
                self.diagnostic(
                    "native-input-observation-gap",
                    json!({"missedRepeats":missed,"coalescedUpdates":drained.coalesced_count}),
                )?;
            }
            self.sample(now)?;
        } else {
            self.mailbox.clear();
        }
        if self.state.phase == MasterPhase::Interval {
            let deadline = self
                .interval_deadline
                .ok_or_else(|| invalid("Missing interval deadline."))?;
            self.state.interval_remaining_ms =
                Some(deadline.saturating_duration_since(now).as_secs_f64() * 1000.);
            if now >= deadline {
                self.observe(MarkerEvent::IsiEnd, true)?;
                self.next()?;
            }
        }
        self.state.current_valence = self.response.x;
        self.state.current_arousal = self.response.y;
        self.state.input_active =
            self.state.phase == MasterPhase::Playing && self.response.active(now);
        self.publish();
        Ok(())
    }
    fn reconcile(&mut self, status: NativeMediaStatusV1) -> ResearchResult<()> {
        let fence = self
            .fence
            .as_ref()
            .ok_or_else(|| invalid("Missing native media fence."))?;
        if status.generation != fence.generation
            || status.session_id.as_deref() != Some(&fence.session_id)
            || status.workspace_file_id != self.bound_file
            || status.sequence < self.media_sequence
            || status.viewport != self.viewport
        {
            return Err(CommandError::new(
                "master-media-binding-lost",
                "Native media no longer matches the frozen occurrence and viewport.",
            ));
        }
        self.media_sequence = status.sequence;
        self.state.media_time_ms = status.position_ms;
        match status.state {
            NativeMediaStateV1::Playing
                if matches!(
                    self.state.phase,
                    MasterPhase::Preparing | MasterPhase::Resuming | MasterPhase::Paused
                ) =>
            {
                let first = !self.opened;
                self.authority
                    .service
                    .set_run_accepting(&self.authority.id, true)?;
                let now = Instant::now();
                self.response.clear_holds(now);
                self.clock = Some(DeadlineClock::new(
                    self.prepared.loaded.recipe.policy().sampling_frequency_hz as u16,
                    now,
                )?);
                self.state.phase = MasterPhase::Playing;
                self.observe(
                    if first {
                        MarkerEvent::VideoStart
                    } else {
                        MarkerEvent::Resume
                    },
                    true,
                )?;
                self.opened = true;
            }
            NativeMediaStateV1::Paused | NativeMediaStateV1::Buffering
                if matches!(
                    self.state.phase,
                    MasterPhase::Playing | MasterPhase::Pausing
                ) =>
            {
                self.quiesce()?;
                self.state.phase = MasterPhase::Paused;
                self.observe(MarkerEvent::Pause, true)?;
            }
            NativeMediaStateV1::Ended => {
                self.quiesce()?;
                if !self.opened {
                    return Err(CommandError::new(
                        "master-video-ended-before-playing",
                        "Video ended without an observed start.",
                    ));
                }
                self.observe(MarkerEvent::VideoEnd, true)?;
                self.stop_media()?;
                self.next()?;
            }
            NativeMediaStateV1::Failed
            | NativeMediaStateV1::Idle
            | NativeMediaStateV1::ShuttingDown => {
                return Err(CommandError::new(
                    "master-native-media-failed",
                    "The native media actor left the active occurrence.",
                ))
            }
            _ => {}
        }
        Ok(())
    }
    fn sample(&mut self, now: Instant) -> ResearchResult<()> {
        let Some(due) = self.clock.as_mut().and_then(|c| c.poll(now)) else {
            return Ok(());
        };
        if due.missed_slots_before > 0 {
            self.state.missed_slot_count += due.missed_slots_before;
            self.diagnostic(
                "native-deadline-missed",
                json!({"missedSlots":due.missed_slots_before}),
            )?;
        }
        let x = self.response.x;
        let y = self.response.y;
        let radius = x.hypot(y).clamp(0., 1.);
        let angle = if radius == 0. {
            0.
        } else {
            y.atan2(x).to_degrees().rem_euclid(360.)
        };
        let active = self.response.active(now);
        let feedback = &self.prepared.feedback;
        let animation = feedback.visual.flubber_enabled;
        let lsl = self
            .lsl
            .as_ref()
            .map(|s| {
                s.state(LslState {
                    current_valence: x,
                    current_arousal: y,
                    target_valence: x,
                    target_arousal: y,
                    radius,
                    angle_degrees: angle,
                    animation_active: animation,
                    input_active: active,
                })
            })
            .transpose()?;
        self.state.sample_count += 1;
        let mappings = &feedback.mappings;
        let sample = json!({"schema":"affect-runner-master-sample","version":1,"sequence":self.state.sample_count,"runId":self.state.run_id,"attemptId":self.state.attempt_id,"participantId":self.state.participant_id,"recipeSourceByteSha256":self.state.recipe_source_byte_sha256,"planIdentitySha256":self.state.plan_identity_sha256,"entryId":self.current()?.entry_id,"executionId":self.occurrence,"monotonicMs":self.elapsed(),"lslTimeSeconds":lsl,"mediaTimeMs":self.state.media_time_ms,"sampleRateHz":self.prepared.loaded.recipe.policy().sampling_frequency_hz,"scheduledElapsedMs":due.scheduled_elapsed.as_secs_f64()*1000.,"observedElapsedMs":due.observed_elapsed.as_secs_f64()*1000.,"schedulerLatenessMs":due.lateness.as_secs_f64()*1000.,"schedulerJitterMs":due.jitter_ms,"stateAnchorAgeMs":now.saturating_duration_since(self.response.anchor).as_secs_f64()*1000.,"missedSlotsBefore":due.missed_slots_before,"valence":x,"arousal":y,"radius":radius,"angleDegrees":angle,"inputActive":active,"animationActive":animation,"inputKind":feedback.input.kind,"feedbackVisible":!feedback.visual.hide_feedback,"oscillationFrequency":mappings.oscillation_frequency.evaluate(x,y),"edgeSmoothness":mappings.edge_smoothness.evaluate(x,y),"projectionAmplitude":mappings.projection_amplitude.evaluate(x,y),"pulseSynchrony":mappings.pulse_synchrony.evaluate(x,y),"waveSizeVariation":mappings.wave_size_variation.evaluate(x,y),"saturation":mappings.saturation.evaluate(x,y)});
        self.storage.sample(&sample)?;
        if self.state.sample_count.is_multiple_of(u64::from(
            self.prepared.loaded.recipe.policy().sampling_frequency_hz,
        )) {
            self.storage.checkpoint()?;
        }
        Ok(())
    }
    fn observe(&mut self, event: MarkerEvent, occurrence: bool) -> ResearchResult<()> {
        #[cfg(test)]
        if let Some(probe) = self.before_observe {
            probe(self, event);
        }
        let id = if occurrence {
            Some(self.current()?.entry_id.clone())
        } else {
            None
        };
        let execution = occurrence.then_some(self.occurrence.as_str());
        let observation = self
            .markers
            .observe(event, id.as_deref(), execution, self.elapsed())?;
        let lsl = self
            .lsl
            .as_mut()
            .map(|s| s.observe(&observation))
            .transpose()?;
        self.storage.event(&json!({"schema":"affect-runner-master-event-record","version":1,"observation":observation,"lslTimeSeconds":lsl}))?;
        self.state.event_count += 1;
        Ok(())
    }
    fn diagnostic(&mut self, code: &str, detail: Value) -> ResearchResult<()> {
        self.storage.diagnostic(&json!({"schema":"affect-runner-master-diagnostic","version":1,"runId":self.state.run_id,"attemptId":self.state.attempt_id,"position":self.state.position,"monotonicMs":self.elapsed(),"code":code,"detail":detail}))
    }
    fn elapsed(&self) -> f64 {
        self.epoch.elapsed().as_secs_f64() * 1000.
    }
    fn quiesce(&mut self) -> ResearchResult<()> {
        self.clock = None;
        let result = self
            .authority
            .service
            .set_run_accepting(&self.authority.id, false);
        self.mailbox.clear();
        self.response.clear_holds(Instant::now());
        self.state.input_active = false;
        result
    }
    fn stop_media(&mut self) -> ResearchResult<()> {
        if let Some(fence) = self.fence.take() {
            self.media.stop(fence)?;
        }
        self.bound_file = None;
        Ok(())
    }
    fn next(&mut self) -> ResearchResult<()> {
        self.opened = false;
        self.state.completed_step_count += 1;
        self.state.position += 1;
        self.step_started = None;
        self.interval_deadline = None;
        self.state.interval_remaining_ms = None;
        self.state.media_time_ms = None;
        self.answers = Default::default();
        self.typed_answers = Default::default();
        self.state.answers.clear();
        self.reset_response();
        if self.state.completed_step_count == self.state.step_count {
            self.finish(true, None)
        } else {
            self.state.phase = MasterPhase::AwaitingPresentation;
            Ok(())
        }
    }
    fn reset_response(&mut self) {
        self.response = ResponseState::new(self.prepared.feedback.response.clone(), Instant::now());
        self.state.current_valence = 0.;
        self.state.current_arousal = 0.;
        self.state.input_active = false;
    }
    fn finish(&mut self, complete: bool, failure: Option<&str>) -> ResearchResult<()> {
        let input_failure = self.quiesce().err();
        let media_failure = self.stop_media().err();
        self.authority.service.end_run(&self.authority.id);
        let failure = failure
            .or_else(|| input_failure.as_ref().map(|e| e.code.as_str()))
            .or_else(|| media_failure.as_ref().map(|e| e.code.as_str()));
        let complete = complete && failure.is_none();
        if self.opened {
            self.observe(MarkerEvent::Interruption, true)?;
            self.opened = false;
        }
        self.observe(
            if complete {
                MarkerEvent::Complete
            } else {
                MarkerEvent::Partial
            },
            false,
        )?;
        self.storage.checkpoint()?;
        let outcome = serde_json::json!({"schema":"affect-runner-outcome","version":1,"protocolOutcome":if complete{"completed"}else{"partial"},"completedStepCount":self.state.completed_step_count,"failureCode":failure,"monotonicMs":self.elapsed(),"localCheckpoint":"durable","recordingFinalization":"pending"});
        if let Some(lsl) = &mut self.lsl {
            lsl.record(ContentKind::Outcome, &outcome)?;
        }
        self.lsl = None;
        if self.recorder.status().active {
            self.recorder.stop()?;
        }
        let receipt = self.storage.finish(
            if failure.is_some() {
                "failed"
            } else if complete {
                "completed"
            } else {
                "stopped"
            },
            self.state.completed_step_count as usize,
            failure,
        )?;
        self.state.failure_code = failure.map(str::to_owned);
        self.state.result = Some(receipt);
        self.state.active = false;
        self.state.phase = if failure.is_some() {
            MasterPhase::Failed
        } else {
            MasterPhase::Finished
        };
        self.terminal = true;
        self.publish();
        Ok(())
    }
    pub(crate) fn fail(&mut self, code: &str) {
        self.state.failure_code = Some(code.into());
        if self.finish(false, Some(code)).is_err() {
            self.authority.service.end_run(&self.authority.id);
            let _ = self.stop_media();
            self.lsl = None;
            let _ = self.recorder.stop();
            // Retained partial files are intentionally not labeled completed.
            self.state.phase = MasterPhase::Failed;
            self.state.active = false;
            self.terminal = true;
            self.publish();
        }
    }
    fn publish(&self) {
        *lock(&self.public) = self.state.clone();
    }
}
impl Drop for MasterWorker {
    fn drop(&mut self) {
        self.authority.service.end_run(&self.authority.id);
    }
}
fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        research_input::ResearchInputService,
        research_native_protocol::runtime::PackageProtocolRuntime,
        research_runner_master::{runtime::MasterChoice, MasterSelector},
    };
    fn with_neutral_worker(check: impl FnOnce(&mut MasterWorker)) {
        // Exact saved fixture, synthetic worker boundary/input state only; no
        // decoded video, physical input, renderer paint or XDF attestation.
        let root =
            std::env::temp_dir().join(format!("runner-isi-neutral-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("outputs")).unwrap();
        let prepared = PreparedMaster::read(
            include_str!(
                "../../../test/fixtures/planner-recipe-locations-current-v1.canonical.json"
            ),
            "P001",
            MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        let workspace = Arc::new(WorkspaceService::new(root.join("app")).unwrap());
        let media = Arc::new(NativeMediaService::unavailable_for_tests());
        let input = Arc::new(ResearchInputService::for_tests());
        let binding = prepared.feedback.input.clone();
        let receipt = input.issue_test_receipt_for_tests(binding.clone()).unwrap();
        let mailbox = Arc::new(ProtocolInputMailbox::new(binding.kind));
        let sink = Arc::clone(&mailbox);
        let authority = InputAuthority {
            service: Arc::clone(&input),
            id: input
                .prepare_run_full(binding, &receipt.receipt_id, move |v| sink.push(v))
                .unwrap(),
        };
        let legacy = PackageProtocolRuntime::with_services(
            Arc::clone(&workspace),
            Arc::clone(&media),
            Arc::clone(&input),
        );
        let storage =
            MasterStorage::create(&root, &prepared, "run-neutral-test", Value::Null, false)
                .unwrap();
        let mut worker = legacy
            .begin_companion(|lease| {
                MasterWorker::new(
                    prepared,
                    "unused".into(),
                    vec![],
                    NativeMediaViewportPxV1::initial(),
                    storage,
                    authority,
                    mailbox,
                    workspace,
                    media,
                    Arc::new(RecorderService::default()),
                    lease,
                )
            })
            .unwrap();
        worker.before_observe = Some(|worker, event| {
            if matches!(event, MarkerEvent::IsiStart) {
                assert_eq!((worker.response.x, worker.response.y), (0., 0.));
                assert!(!worker.response.active(Instant::now()));
                assert_eq!(
                    (worker.state.current_valence, worker.state.current_arousal),
                    (0., 0.)
                );
                let displayed = lock(&worker.public);
                assert_eq!(
                    (displayed.current_valence, displayed.current_arousal),
                    (0., 0.)
                );
                assert!(!displayed.input_active);
                assert_eq!(displayed.phase, MasterPhase::AwaitingPresentation);
                assert!(worker.clock.is_none());
                assert!(matches!(
                    worker.authority.service.status().phase,
                    crate::research_input::NativeInputPhase::RunPrepared
                ));
                let pending = worker.mailbox.drain().unwrap();
                assert!(pending.digital.is_empty() && pending.continuous.is_none());
                assert_eq!(pending.coalesced_count, 0);
            }
        });
        check(&mut worker);
        drop(worker);
        drop(legacy);
        drop(input);
        std::fs::remove_dir_all(root).unwrap();
    }
    fn seed_stale_digital(worker: &mut MasterWorker) {
        let edge = crate::research_input::NativeDigitalInput {
            direction: crate::research_contracts::DirectionV1::Right,
            detail: "synthetic-held".into(),
            apply_step: true,
            input_active: true,
            impulse: false,
            observed_at: Instant::now(),
        };
        worker.response.digital(edge.clone());
        worker.response.x = 0.8;
        worker.response.y = -0.4;
        worker.state.current_valence = 0.8;
        worker.state.current_arousal = -0.4;
        worker.state.input_active = true;
        worker
            .mailbox
            .push(crate::research_input::NativeInputUpdate::Digital(edge));
        worker.publish();
    }
    fn present_interval(worker: &mut MasterWorker, position: u32) {
        assert_eq!(
            worker.prepared.plan.steps[position as usize - 1].kind,
            MasterStepKind::Interval
        );
        worker.state.position = position;
        worker.state.phase = MasterPhase::AwaitingPresentation;
        worker.action(MasterAction::Presented { position }).unwrap();
        // No queued repeat/held movement may return even after its deadline.
        worker
            .response
            .advance(Instant::now() + Duration::from_secs(10));
        assert_eq!((worker.response.x, worker.response.y), (0., 0.));
        assert!(!worker.state.input_active);
    }
    #[test]
    fn first_isi_resets_non_neutral_state_before_its_start_observation() {
        with_neutral_worker(|worker| {
            seed_stale_digital(worker);
            present_interval(worker, 2);
        });
    }
    #[test]
    fn consecutive_isis_each_reset_before_admission_including_zero_duration() {
        with_neutral_worker(|worker| {
            seed_stale_digital(worker);
            present_interval(worker, 2);
            worker.tick().unwrap(); // Exact fixture's first ISI is zero duration.
            assert_eq!(worker.state.position, 3);
            seed_stale_digital(worker);
            present_interval(worker, 3);
        });
    }
    #[test]
    fn video_to_isi_publishes_neutral_without_waiting_for_a_tick() {
        with_neutral_worker(|worker| {
            let video_position = worker
                .prepared
                .plan
                .steps
                .windows(2)
                .find(|pair| {
                    pair[0].kind == MasterStepKind::Video
                        && pair[1].kind == MasterStepKind::Interval
                })
                .unwrap()[0]
                .position;
            worker.state.position = video_position;
            assert_eq!(worker.current().unwrap().kind, MasterStepKind::Video);
            seed_stale_digital(worker);
            // Enter the actual next() seam used after observed video end/stop.
            worker.next().unwrap();
            assert_eq!(worker.state.position, video_position + 1);
            assert_eq!(
                (worker.state.current_valence, worker.state.current_arousal),
                (0., 0.)
            );
            worker.publish();
            assert_eq!(lock(&worker.public).current_valence, 0.);
            present_interval(worker, video_position + 1);
        });
    }
    #[test]
    fn stale_absolute_updates_and_coalescing_cannot_restore_pre_isi_affect() {
        with_neutral_worker(|worker| {
            // Inject the alternative transport queue independently of a physical
            // device; this checks clearing, not device binding qualification.
            worker.mailbox = Arc::new(ProtocolInputMailbox::new(
                crate::research_contracts::InputKindV1::Absolute,
            ));
            let value = crate::research_input::NativeContinuousInput {
                x: 0.75,
                y: -0.5,
                detail: "synthetic-absolute".into(),
                input_active: true,
                observed_at: Instant::now(),
            };
            worker.response.continuous(value.clone());
            worker
                .mailbox
                .push(crate::research_input::NativeInputUpdate::Continuous(
                    value.clone(),
                ));
            worker
                .mailbox
                .push(crate::research_input::NativeInputUpdate::Continuous(value));
            worker.state.current_valence = 0.75;
            worker.state.current_arousal = -0.5;
            present_interval(worker, 2);
        });
    }
    #[test]
    fn master_v2_requires_every_typed_and_likert_answer_before_advancing() {
        use super::super::typed_forms::{FormAnswerValue, TypedChoice};
        for language in ["en", "de"] {
            let root =
                std::env::temp_dir().join(format!("affect-master-v2-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::create_dir(root.join("outputs")).unwrap();
            let prepared = PreparedMaster::read(
                include_str!("../../../test/fixtures/runner-master-v2-owner.canonical.json"),
                "P001",
                MasterSelector {
                    variant_id: "variant-1".into(),
                    language_id: language.into(),
                    language_selection_path: vec!["both".into(), language.into()],
                    presentation_target: "desktop-screen".into(),
                },
            )
            .unwrap();
            let workspace = Arc::new(WorkspaceService::new(root.join("app")).unwrap());
            let media = Arc::new(NativeMediaService::unavailable_for_tests());
            let input = Arc::new(ResearchInputService::for_tests());
            let recorder = Arc::new(RecorderService::default());
            let binding = prepared.feedback.input.clone();
            let receipt = input.issue_test_receipt_for_tests(binding.clone()).unwrap();
            let mailbox = Arc::new(ProtocolInputMailbox::new(binding.kind));
            let sink = Arc::clone(&mailbox);
            let authority = InputAuthority {
                service: Arc::clone(&input),
                id: input
                    .prepare_run_full(binding, &receipt.receipt_id, move |v| sink.push(v))
                    .unwrap(),
            };
            let legacy = PackageProtocolRuntime::with_services(
                Arc::clone(&workspace),
                Arc::clone(&media),
                Arc::clone(&input),
            );
            let storage =
                MasterStorage::create(&root, &prepared, "run-typed-test", Value::Null, false)
                    .unwrap();
            assert_eq!(storage.receipt["version"], 2);
            assert!(storage.receipt.get("participant").is_none());
            let output = root.join(storage.receipt["outputDirectory"].as_str().unwrap());
            let mut worker = legacy
                .begin_companion(|lease| {
                    MasterWorker::new(
                        prepared,
                        "unused".into(),
                        vec![],
                        NativeMediaViewportPxV1::initial(),
                        storage,
                        authority,
                        mailbox,
                        workspace,
                        media,
                        recorder,
                        lease,
                    )
                })
                .unwrap();
            worker.observe(MarkerEvent::SessionStart, false).unwrap();
            assert!(worker
                .action(MasterAction::SubmitV2 {
                    position: 1,
                    answers: vec![]
                })
                .is_err());
            worker
                .action(MasterAction::Presented { position: 1 })
                .unwrap();
            assert!(worker
                .action(MasterAction::Submit {
                    position: 1,
                    answers: vec![]
                })
                .is_err());
            assert!(worker
                .action(MasterAction::SubmitV2 {
                    position: 1,
                    answers: vec![]
                })
                .is_err());
            let answers = vec![
                TypedChoice {
                    item_id: "fullName".into(),
                    value: FormAnswerValue::Text {
                        text: "  Fictitious Ä\nName  ".into(),
                    },
                },
                TypedChoice {
                    item_id: "age".into(),
                    value: FormAnswerValue::Integer { integer: 0 },
                },
                TypedChoice {
                    item_id: "gender".into(),
                    value: FormAnswerValue::SingleChoice {
                        option_id: "preferNotToSay".into(),
                    },
                },
                TypedChoice {
                    item_id: "handedness".into(),
                    value: FormAnswerValue::SingleChoice {
                        option_id: "ambidextrous".into(),
                    },
                },
            ];
            let mut partial = answers.clone();
            partial.pop();
            worker
                .action(MasterAction::DraftV2 {
                    position: 1,
                    answers: partial.clone(),
                })
                .unwrap();
            assert!(worker
                .action(MasterAction::SubmitV2 {
                    position: 1,
                    answers: partial
                })
                .is_err());
            assert_eq!(worker.state.position, 1);
            worker
                .action(MasterAction::SubmitV2 {
                    position: 1,
                    answers,
                })
                .unwrap();
            assert_eq!(worker.state.position, 2);
            assert!(worker.state.answers.is_empty());
            worker
                .action(MasterAction::Presented { position: 2 })
                .unwrap();
            let choices = worker.current().unwrap().payload["definition"]["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| TypedChoice {
                    item_id: item["itemId"].as_str().unwrap().into(),
                    value: FormAnswerValue::SingleChoice {
                        option_id: item["options"][0]["optionId"].as_str().unwrap().into(),
                    },
                })
                .collect::<Vec<_>>();
            assert!(worker
                .action(MasterAction::SubmitV2 {
                    position: 2,
                    answers: choices[..1].to_vec()
                })
                .is_err());
            worker
                .action(MasterAction::SubmitV2 {
                    position: 2,
                    answers: choices,
                })
                .unwrap();
            assert_eq!(worker.state.completed_step_count, 2);
            worker.action(MasterAction::Stop).unwrap();
            let records = std::fs::read_to_string(output.join("master-responses.v2.jsonl"))
                .unwrap()
                .lines()
                .map(|s| serde_json::from_str::<Value>(s).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(records.len(), 3);
            assert_eq!(
                records[1]["responses"][0]["value"]["text"],
                "  Fictitious Ä\nName  "
            );
            assert_eq!(records[1]["responses"][1]["value"]["integer"], 0);
            assert_eq!(records[2]["responses"][0]["optionId"], "option-1");
            assert!(records[2]["responses"][0].get("value").is_none());
            assert!(records.iter().all(|r| r["version"] == 2));
            drop(worker);
            drop(legacy);
            drop(input);
            std::fs::remove_dir_all(root).unwrap();
        }
    }
    #[test]
    fn observed_form_submission_precedes_distinct_zero_interval_and_partial_stop() {
        // Synthetic authority/fixture: tests reducer/storage ordering, never media qualification.
        let root =
            std::env::temp_dir().join(format!("affect-master-order-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("outputs")).unwrap();
        let prepared = PreparedMaster::read(
            include_str!(
                "../../../test/fixtures/planner-recipe-locations-current-v1.canonical.json"
            ),
            "P001",
            MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        let workspace = Arc::new(WorkspaceService::new(root.join("app")).unwrap());
        let media = Arc::new(NativeMediaService::unavailable_for_tests());
        let input = Arc::new(ResearchInputService::for_tests());
        let recorder = Arc::new(RecorderService::default());
        let binding = prepared.feedback.input.clone();
        let receipt = input.issue_test_receipt_for_tests(binding.clone()).unwrap();
        let mailbox = Arc::new(ProtocolInputMailbox::new(binding.kind));
        let sink = Arc::clone(&mailbox);
        let authority = InputAuthority {
            service: Arc::clone(&input),
            id: input
                .prepare_run_full(binding, &receipt.receipt_id, move |v| sink.push(v))
                .unwrap(),
        };
        let legacy = PackageProtocolRuntime::with_services(
            Arc::clone(&workspace),
            Arc::clone(&media),
            Arc::clone(&input),
        );
        let storage =
            MasterStorage::create(&root, &prepared, "run-order-test", Value::Null, false).unwrap();
        let output = root.join(storage.receipt["outputDirectory"].as_str().unwrap());
        let mut worker = legacy
            .begin_companion(|lease| {
                MasterWorker::new(
                    prepared,
                    "unused-workspace".into(),
                    vec![],
                    NativeMediaViewportPxV1::initial(),
                    storage,
                    authority,
                    mailbox,
                    workspace,
                    media,
                    recorder,
                    lease,
                )
            })
            .unwrap();
        assert!(legacy.while_idle(|| Ok(())).is_err());
        worker.observe(MarkerEvent::SessionStart, false).unwrap();
        assert!(worker
            .action(MasterAction::Submit {
                position: 1,
                answers: vec![]
            })
            .is_err());
        worker
            .action(MasterAction::Presented { position: 1 })
            .unwrap();
        assert!(worker
            .action(MasterAction::Presented { position: 1 })
            .is_err());
        assert!(worker
            .action(MasterAction::Submit {
                position: 1,
                answers: vec![]
            })
            .is_err());
        let choices = worker.current().unwrap().payload["definition"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| MasterChoice {
                item_id: item["itemId"].as_str().unwrap().into(),
                option_id: item["options"][0]["optionId"].as_str().unwrap().into(),
            })
            .collect::<Vec<_>>();
        worker
            .action(MasterAction::Draft {
                position: 1,
                answers: choices.clone(),
            })
            .unwrap();
        assert_eq!(worker.state.position, 1);
        worker
            .action(MasterAction::Submit {
                position: 1,
                answers: choices,
            })
            .unwrap();
        assert_eq!(worker.state.position, 2);
        assert_eq!(worker.state.phase, MasterPhase::AwaitingPresentation);
        worker
            .action(MasterAction::Presented { position: 2 })
            .unwrap();
        assert_eq!(worker.state.phase, MasterPhase::Interval);
        worker.tick().unwrap();
        assert_eq!(worker.state.position, 3);
        assert_eq!(worker.state.completed_step_count, 2);
        worker.action(MasterAction::Stop).unwrap();
        assert!(!worker.state.active);
        assert_eq!(worker.state.result.as_ref().unwrap()["status"], "stopped");
        let rows = std::fs::read_to_string(output.join("master-events.v1.jsonl"))
            .unwrap()
            .lines()
            .map(|s| {
                serde_json::from_str::<Value>(s).unwrap()["observation"]["eventType"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            rows,
            [
                "sessionStart",
                "formStart",
                "formEnd",
                "isiStart",
                "isiEnd",
                "partial"
            ]
        );
        drop(worker);
        assert!(legacy.while_idle(|| Ok(())).is_ok());
        drop(legacy);
        drop(input);
        std::fs::remove_dir_all(root).unwrap();
    }
}

//! One native owner of master lifecycle observations, sampling and persistence.
use super::{
    bindings::MasterVideoBinding,
    forms::FormAnswers,
    information::{ContentKind, PreparedTransfer},
    lsl::MasterLslService,
    markers::{EvidenceEvent, MarkerEvent, MasterMarkers},
    response::ResponseState,
    runtime::{lock, InputAuthority, MasterAction, MasterPhase, MasterStatus, Message},
    storage::MasterStorage,
    MasterStep, MasterStepKind, PreparedMaster,
};
use crate::{
    research_error::{CommandError, ResearchResult},
    research_lsl::LslState,
    research_native_protocol::{input_mailbox::ProtocolInputMailbox, runtime::CompanionLease},
    research_recorder::RecorderService,
    research_timing::DeadlineClock,
    research_workspace::WorkspaceService,
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
    bindings: Vec<MasterVideoBinding>,
    storage: MasterStorage,
    authority: InputAuthority,
    mailbox: Arc<ProtocolInputMailbox>,
    workspace: Arc<WorkspaceService>,
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
    bound_file: Option<String>,
    clock: Option<DeadlineClock>,
    interval_deadline: Option<Instant>,
    answers: FormAnswers,
    typed_answers: super::typed_forms::TypedFormAnswers,
    input_count: u64,
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
        bindings: Vec<MasterVideoBinding>,
        mut storage: MasterStorage,
        authority: InputAuthority,
        mailbox: Arc<ProtocolInputMailbox>,
        workspace: Arc<WorkspaceService>,
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
        let startup = if let Some(qualification) = storage.receipt.get("executionQualification") {
            json!({"schema":"affect-runner-validation-startup","version":1,
                "executionQualification":qualification,"startup":startup})
        } else {
            startup
        };
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
        let clock = prepared
            .loaded
            .recipe
            .full_attempt_acquisition()
            .then(|| {
                DeadlineClock::new(
                    prepared.loaded.recipe.policy().sampling_frequency_hz as u16,
                    now,
                )
            })
            .transpose()?;
        Ok(Self {
            prepared,
            workspace_id,
            bindings,
            storage,
            authority,
            mailbox,
            workspace,
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
            bound_file: None,
            clock,
            interval_deadline: None,
            answers: Default::default(),
            terminal: false,
            typed_answers: Default::default(),
            input_count: 0,
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
                        self.observe_neutral_reset("intervalAdmission", true)?;
                        self.observe(MarkerEvent::IsiStart, true)?;
                        self.opened = true;
                    }
                    MasterStepKind::Video => self.prepare_html_video(&step)?,
                }
                Ok(())
            }
            MasterAction::HtmlVideoStarted {
                position,
                media_time_ms,
            } => self.html_video_started(position, media_time_ms),
            MasterAction::HtmlVideoEnded {
                position,
                media_time_ms,
            } => self.html_video_ended(position, media_time_ms),
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
            MasterAction::SurveyDraft {
                position,
                data,
                page_no,
            } => self.survey_answers_action(position, data, page_no, false),
            MasterAction::SurveySubmit {
                position,
                data,
                page_no,
            } => self.survey_answers_action(position, data, page_no, true),
            MasterAction::Pause => {
                if self.state.phase != MasterPhase::Playing {
                    return Err(invalid("Pause requires native Playing."));
                }
                self.quiesce()?;
                self.state.phase = MasterPhase::Paused;
                self.observe(MarkerEvent::Pause, true)
            }
            MasterAction::Resume => {
                if self.state.phase != MasterPhase::Paused {
                    return Err(invalid("Resume requires native Paused."));
                }
                self.resume_html_video()
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
        if !matches!(self.prepared.plan.version, 2..=6) {
            return Err(invalid("Typed answers require master version 2 through 6."));
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
    fn survey_answers_action(
        &mut self,
        position: u32,
        data: Value,
        page_no: u32,
        submitted: bool,
    ) -> ResearchResult<()> {
        if !matches!(self.prepared.plan.version, 4..=6) {
            return Err(invalid(
                "SurveyJS answers require master version 4 through 6.",
            ));
        }
        self.require_position(position, MasterPhase::Questionnaire)?;
        let step = self.current()?.clone();
        let definition: crate::research_surveyjs_definition::SurveyDefinitionV1 =
            serde_json::from_value(step.payload["definition"].clone())
                .map_err(|_| invalid("This occurrence is not a SurveyJS questionnaire."))?;
        // The definition was validated and hashed by PreparedMaster; only the
        // participant's data enters the fixed core for this bound occurrence.
        let seed = (u32::from_str_radix(&self.state.plan_identity_sha256[..8], 16)
            .map_err(|_| invalid("Invalid plan hash."))?
            ^ position)
            .max(1);
        let checked = self.validate_survey_while_sampling(&definition, &data, submitted, seed)?;
        let page_count = checked["pageCount"]
            .as_u64()
            .ok_or_else(|| invalid("SurveyJS did not return its page count."))?;
        if u64::from(page_no) >= page_count {
            return Err(invalid(
                "SurveyJS page index is outside this questionnaire.",
            ));
        }
        let elapsed = self
            .step_started
            .ok_or_else(|| invalid("Questionnaire was not presented."))?
            .elapsed()
            .as_secs_f64()
            * 1000.;
        let mut record = json!({"schema":"affect-runner-master-responses","version":3,"entryId":step.entry_id,"position":step.position,"module":step.payload["module"],"questionnaireId":definition.questionnaire_id,"questionnaireVersion":definition.questionnaire_version,"definitionSha256":definition.definition_sha256,"status":if submitted {"submitted"} else {"draft"},
            "responses":{"engineVersion":definition.engine_version,"language":definition.language,"completionPolicy":definition.completion_policy,"randomSeed":seed,"evaluatedAtUnixMs":checked["evaluatedAtUnixMs"],"inputData":data,"data":checked["data"],"visibleQuestionNames":checked["visibleQuestionNames"],"pageNo":page_no,"elapsedMs":elapsed}});
        let projection = serde_json::from_value(checked["data"].clone())
            .map_err(|_| invalid("Invalid SurveyJS answer projection."))?;
        self.record_answers(&mut record, submitted)?;
        if !submitted {
            self.state.answers = projection;
        }
        Ok(())
    }
    fn validate_survey_while_sampling(
        &mut self,
        definition: &crate::research_surveyjs_definition::SurveyDefinitionV1,
        data: &Value,
        submitted: bool,
        seed: u32,
    ) -> ResearchResult<Value> {
        let survey_json = definition.survey_json.clone();
        let language = definition.language.clone();
        let data = data.clone();
        self.perform_while_sampling("master-survey-validation", move || {
            crate::research_surveyjs_engine::validate_survey_data_seed(
                &survey_json,
                &language,
                &data,
                submitted,
                seed,
            )
        })
    }
    fn perform_while_sampling<T: Send + 'static>(
        &mut self,
        thread_name: &str,
        operation: impl FnOnce() -> ResearchResult<T> + Send + 'static,
    ) -> ResearchResult<T> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let background = std::thread::Builder::new()
            .name(thread_name.into())
            .spawn(move || {
                let _ = sender.send(operation());
            })
            .map_err(CommandError::io)?;
        let result = loop {
            let wait = self
                .clock
                .as_ref()
                .map(|clock| {
                    clock
                        .next_deadline()
                        .saturating_duration_since(Instant::now())
                })
                .unwrap_or(Duration::from_millis(4))
                .min(Duration::from_millis(4));
            match receiver.recv_timeout(wait) {
                Ok(result) => break result,
                Err(RecvTimeoutError::Timeout) => {
                    if self.full_attempt_acquisition() {
                        if let Err(error) = self.tick() {
                            break Err(error);
                        }
                    }
                }
                Err(RecvTimeoutError::Disconnected) => {
                    break Err(invalid("Background operation stopped unexpectedly."));
                }
            }
        };
        background
            .join()
            .map_err(|_| invalid("Background operation panicked."))?;
        let value = result?;
        if self.full_attempt_acquisition() {
            self.tick()?;
        }
        Ok(value)
    }
    fn record_answers(&mut self, record: &mut Value, submitted: bool) -> ResearchResult<()> {
        if matches!(self.prepared.plan.version, 4..=6) {
            record["version"] = json!(3);
        }
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
    fn prepare_html_video(&mut self, step: &MasterStep) -> ResearchResult<()> {
        let asset = &step.payload["asset"];
        let binding = self
            .bindings
            .iter()
            .find(|b| b.matches(asset))
            .ok_or_else(|| {
                invalid("The video occurrence has no exact native asset/location binding.")
            })?
            .clone();
        let bound_file = binding.workspace_file_id().to_owned();
        let workspace = Arc::clone(&self.workspace);
        let workspace_id = self.workspace_id.clone();
        // Full-attempt sampling continues while the current file identity is
        // revalidated. Preparing has occurrence context but never claims play.
        self.state.phase = MasterPhase::Preparing;
        let _grant = self.perform_while_sampling("master-media-verification", move || {
            binding.issue_grant(&workspace, &workspace_id)
        })?;
        self.bound_file = Some(bound_file);
        // No position has been observed yet; entering the step is not playback.
        self.state.media_time_ms = None;
        Ok(())
    }
    fn html_video_started(
        &mut self,
        position: u32,
        media_time_ms: Option<f64>,
    ) -> ResearchResult<()> {
        self.require_position(position, MasterPhase::Preparing)?;
        self.begin_html_video(MarkerEvent::VideoStart, media_time_ms)
    }
    fn resume_html_video(&mut self) -> ResearchResult<()> {
        self.begin_html_video(MarkerEvent::Resume, self.state.media_time_ms)
    }
    fn begin_html_video(
        &mut self,
        event: MarkerEvent,
        media_time_ms: Option<f64>,
    ) -> ResearchResult<()> {
        self.authority
            .service
            .set_run_accepting(&self.authority.id, true)?;
        let now = Instant::now();
        self.response.clear_holds(now);
        if !self.full_attempt_acquisition() {
            self.clock = Some(DeadlineClock::new(
                self.prepared.loaded.recipe.policy().sampling_frequency_hz as u16,
                now,
            )?);
        }
        self.step_started = Some(now);
        // Only a reported observation is recorded; an unavailable position
        // stays absent rather than becoming a fabricated zero.
        self.state.media_time_ms = normalize_media_time(media_time_ms);
        self.state.phase = MasterPhase::Playing;
        self.observe(event, true)?;
        self.opened = true;
        Ok(())
    }
    fn html_video_ended(
        &mut self,
        position: u32,
        media_time_ms: Option<f64>,
    ) -> ResearchResult<()> {
        if self.state.position != position
            || !matches!(self.state.phase, MasterPhase::Playing | MasterPhase::Paused)
        {
            return Err(invalid(
                "This command targets a stale or unavailable master occurrence.",
            ));
        }
        self.quiesce()?;
        if !self.opened {
            return Err(CommandError::new(
                "master-video-ended-before-playing",
                "Video ended without an observed start.",
            ));
        }
        // An absent observed position stays absent rather than being filled in
        // with the native elapsed estimate.
        if let Some(observed) = normalize_media_time(media_time_ms) {
            self.state.media_time_ms = Some(observed);
        }
        self.observe(MarkerEvent::VideoEnd, true)?;
        self.reset_response();
        self.observe_neutral_reset("videoEnd", true)?;
        self.stop_media()?;
        self.next()
    }
    fn tick(&mut self) -> ResearchResult<()> {
        let now = Instant::now();
        if self.state.phase == MasterPhase::Preparing
            && now.duration_since(self.transition_started) > Duration::from_secs(15)
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
                let observed_ms = self.instant_elapsed(input.observed_at);
                missed += self.response.digital(input.clone());
                self.record_input(
                    "digital",
                    observed_ms,
                    json!({"direction":input.direction,"detail":input.detail,"applyStep":input.apply_step,"inputActive":input.input_active,"impulse":input.impulse,"stateAfter":{"valence":self.response.x,"arousal":self.response.y}}),
                )?;
                self.observe_input_edge(&input, observed_ms)?;
            }
            for input in drained.continuous_evidence {
                let observed_ms = self.instant_elapsed(input.observed_at);
                missed += self.response.continuous(input.clone());
                self.record_input(
                    "continuous",
                    observed_ms,
                    json!({"detail":input.detail,"inputActive":input.input_active,"x":input.x,"y":input.y,"stateAfter":{"valence":self.response.x,"arousal":self.response.y}}),
                )?;
            }
            if let Some(input) = drained.continuous {
                let observed_ms = self.instant_elapsed(input.observed_at);
                missed += self.response.continuous(input.clone());
                self.record_input(
                    "continuous",
                    observed_ms,
                    json!({"detail":input.detail,"inputActive":input.input_active,"x":input.x,"y":input.y,"coalescedBefore":drained.coalesced_count,"stateAfter":{"valence":self.response.x,"arousal":self.response.y}}),
                )?;
            }
            missed += self.response.advance(now);
            if missed > 0 || drained.coalesced_count > 0 {
                self.diagnostic(
                    "native-input-observation-gap",
                    json!({"missedRepeats":missed,"coalescedUpdates":drained.coalesced_count}),
                )?;
                self.observe_timing_gap(
                    "inputObservation",
                    json!({"missedRepeats":missed,"coalescedUpdates":drained.coalesced_count}),
                )?;
            }
        } else {
            self.mailbox.clear();
        }
        if self.full_attempt_acquisition() || self.state.phase == MasterPhase::Playing {
            self.sample(now)?;
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
            self.observe_timing_gap(
                "sampleDeadline",
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
        let active = self.state.phase == MasterPhase::Playing && self.response.active(now);
        let feedback = &self.prepared.feedback;
        let feedback_presented =
            matches!(self.state.phase, MasterPhase::Playing | MasterPhase::Paused);
        let animation = feedback_presented && feedback.visual.flubber_enabled;
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
        let (version, phase, entry_id, execution_id) = if self.evidence_v2() {
            let context = (!self.occurrence.is_empty())
                .then(|| self.current().map(|step| step.entry_id.clone()))
                .transpose()?;
            (
                2,
                Some(self.phase_name()),
                context,
                (!self.occurrence.is_empty()).then(|| self.occurrence.clone()),
            )
        } else {
            (
                1,
                None,
                Some(self.current()?.entry_id.clone()),
                Some(self.occurrence.clone()),
            )
        };
        let mut sample = json!({"schema":"affect-runner-master-sample","version":version,"sequence":self.state.sample_count,"runId":self.state.run_id,"attemptId":self.state.attempt_id,"participantId":self.state.participant_id,"recipeSourceByteSha256":self.state.recipe_source_byte_sha256,"planIdentitySha256":self.state.plan_identity_sha256,"phase":phase,"entryId":entry_id,"executionId":execution_id,"monotonicMs":self.elapsed(),"lslTimeSeconds":lsl,"mediaTimeMs":self.state.media_time_ms,"sampleRateHz":self.prepared.loaded.recipe.policy().sampling_frequency_hz,"scheduledElapsedMs":due.scheduled_elapsed.as_secs_f64()*1000.,"observedElapsedMs":due.observed_elapsed.as_secs_f64()*1000.,"schedulerLatenessMs":due.lateness.as_secs_f64()*1000.,"schedulerJitterMs":due.jitter_ms,"stateAnchorAgeMs":now.saturating_duration_since(self.response.anchor).as_secs_f64()*1000.,"missedSlotsBefore":due.missed_slots_before,"valence":x,"arousal":y,"radius":radius,"angleDegrees":angle,"inputActive":active,"animationActive":animation,"inputKind":feedback.input.kind,"feedbackVisible":feedback_presented && !feedback.visual.hide_feedback,"oscillationFrequency":mappings.oscillation_frequency.evaluate(x,y),"edgeSmoothness":mappings.edge_smoothness.evaluate(x,y),"projectionAmplitude":mappings.projection_amplitude.evaluate(x,y),"pulseSynchrony":mappings.pulse_synchrony.evaluate(x,y),"waveSizeVariation":mappings.wave_size_variation.evaluate(x,y),"saturation":mappings.saturation.evaluate(x,y)});
        if version == 1 {
            sample.as_object_mut().unwrap().remove("phase");
        }
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
        if self.evidence_v2() {
            return self.observe_evidence(
                event.into(),
                json!({"kind":"lifecycle"}),
                occurrence,
                self.elapsed(),
                true,
            );
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
    fn observe_evidence(
        &mut self,
        event: EvidenceEvent,
        payload: Value,
        occurrence: bool,
        observed_ms: f64,
        checkpoint: bool,
    ) -> ResearchResult<()> {
        if !self.evidence_v2() {
            return Ok(());
        }
        let id = if occurrence {
            Some(self.current()?.entry_id.clone())
        } else {
            None
        };
        let execution = occurrence.then_some(self.occurrence.as_str());
        let accepted_ms = self.elapsed().max(observed_ms);
        let observation = self.markers.observe_evidence(
            event,
            self.phase_name(),
            id.as_deref(),
            execution,
            observed_ms,
            accepted_ms,
            payload,
        )?;
        let record = serde_json::to_value(&observation)
            .map_err(|_| invalid("Evidence event serialization failed."))?;
        if checkpoint {
            self.storage.event(&record)?;
        } else {
            self.storage.buffered_event(&record)?;
        }
        if let Some(lsl) = &mut self.lsl {
            lsl.observe(&observation)?;
        }
        self.state.event_count += 1;
        Ok(())
    }
    fn observe_input_edge(
        &mut self,
        input: &crate::research_input::NativeDigitalInput,
        observed_ms: f64,
    ) -> ResearchResult<()> {
        self.observe_evidence(
            EvidenceEvent::InputEdge,
            json!({"kind":"inputEdge","direction":input.direction,"detail":input.detail,"applyStep":input.apply_step,"inputActive":input.input_active,"impulse":input.impulse,"stateAfter":{"valence":self.response.x,"arousal":self.response.y}}),
            true,
            observed_ms,
            true,
        )
    }
    fn record_input(
        &mut self,
        input_kind: &str,
        observed_ms: f64,
        payload: Value,
    ) -> ResearchResult<()> {
        if !self.evidence_v2() {
            return Ok(());
        }
        self.input_count = self
            .input_count
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or_else(|| invalid("Master input observation sequence exhausted."))?;
        let entry_id = self.current()?.entry_id.clone();
        let record = json!({"schema":"affect-runner-input-observation","version":2,"recipeSourceByteSha256":self.state.recipe_source_byte_sha256,"planIdentitySha256":self.state.plan_identity_sha256,"runId":self.state.run_id,"attemptId":self.state.attempt_id,"participantId":self.state.participant_id,"sequence":self.input_count,"inputKind":input_kind,"phase":self.phase_name(),"entryId":entry_id,"executionId":self.occurrence,"observedMonotonicMs":observed_ms,"acceptedMonotonicMs":self.elapsed().max(observed_ms),"payload":payload});
        self.storage.input(&record)
    }
    fn observe_neutral_reset(&mut self, reason: &str, occurrence: bool) -> ResearchResult<()> {
        self.observe_evidence(
            EvidenceEvent::NeutralReset,
            json!({"kind":"neutralReset","reason":reason,"stateAfter":{"valence":0.0,"arousal":0.0}}),
            occurrence,
            self.elapsed(),
            true,
        )
    }
    fn observe_timing_gap(&mut self, gap_kind: &str, detail: Value) -> ResearchResult<()> {
        self.observe_evidence(
            EvidenceEvent::TimingGap,
            json!({"kind":"timingGap","gapKind":gap_kind,"detail":detail}),
            !self.occurrence.is_empty(),
            self.elapsed(),
            false,
        )
    }
    fn full_attempt_acquisition(&self) -> bool {
        self.prepared.loaded.recipe.full_attempt_acquisition()
    }
    fn evidence_v2(&self) -> bool {
        self.prepared.plan.version == 6
    }
    fn phase_name(&self) -> &'static str {
        match self.state.phase {
            MasterPhase::AwaitingPresentation => "awaitingPresentation",
            MasterPhase::Questionnaire => "questionnaire",
            MasterPhase::Interval => "interval",
            MasterPhase::Preparing => "preparing",
            MasterPhase::Playing => "playing",
            MasterPhase::Paused => "paused",
            MasterPhase::Finished => "finished",
            MasterPhase::Failed => "failed",
        }
    }
    fn instant_elapsed(&self, instant: Instant) -> f64 {
        instant
            .checked_duration_since(self.epoch)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.
    }
    fn diagnostic(&mut self, code: &str, detail: Value) -> ResearchResult<()> {
        self.storage.diagnostic(&json!({"schema":"affect-runner-master-diagnostic","version":1,"runId":self.state.run_id,"attemptId":self.state.attempt_id,"position":self.state.position,"monotonicMs":self.elapsed(),"code":code,"detail":detail}))
    }
    fn elapsed(&self) -> f64 {
        self.epoch.elapsed().as_secs_f64() * 1000.
    }
    fn quiesce(&mut self) -> ResearchResult<()> {
        if !self.full_attempt_acquisition() {
            self.clock = None;
        }
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
        self.occurrence.clear();
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
        self.clock = None;
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
        if self.full_attempt_acquisition() {
            self.state.phase = if failure.is_some() {
                MasterPhase::Failed
            } else {
                MasterPhase::Finished
            };
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
fn normalize_media_time(value: Option<f64>) -> Option<f64> {
    value.filter(|ms| ms.is_finite() && *ms >= 0.)
}
fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}
#[cfg(test)]
#[path = "worker_survey_tests.rs"]
mod survey_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        research_contracts::{canonical_json, canonical_sha256},
        research_input::ResearchInputService,
        research_native_media::NativeMediaService,
        research_native_protocol::runtime::PackageProtocolRuntime,
        research_planner_recipe_supported::{
            parse_supported_planner_recipe_bytes, SupportedPlannerRecipe,
        },
        research_planner_recipe_v6::PlannerRecipeV6,
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
                    storage,
                    authority,
                    mailbox,
                    workspace,
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
    fn full_attempt_pause_samples_the_frozen_rating_with_input_inactive() {
        // Synthetic worker/input boundary only: this proves pause sampling
        // semantics, not decoded media, physical input or saved-XDF parity.
        let root = std::env::temp_dir().join(format!(
            "runner-full-attempt-pause-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(root.join("outputs")).unwrap();
        let loaded = parse_supported_planner_recipe_bytes(include_bytes!(
            "../../../test/fixtures/planner-recipe-v5.bundle.json"
        ))
        .unwrap();
        let recipe = match loaded.recipe {
            SupportedPlannerRecipe::V5(recipe) => recipe,
            _ => panic!("expected master5 fixture"),
        };
        let mut manifest = serde_json::to_value(&recipe.manifest).unwrap();
        manifest["version"] = json!(6);
        manifest["policy"]["version"] = json!(2);
        manifest["policy"]["acquisitionWindow"] = json!("fullAttempt");
        manifest["integrity"]["algorithmVersion"] = json!("planner-questionnaire-assets-v2");
        manifest["integrity"]["definitionSha256"] =
            json!(canonical_sha256(&manifest, &["integrity"]).unwrap());
        let mut manifest_bytes = canonical_json(&manifest, &[]).unwrap();
        manifest_bytes.push(b'\n');
        let manifest_text = String::from_utf8(manifest_bytes).unwrap();
        let source = PlannerRecipeV6::read(manifest_text.as_bytes(), recipe.assets)
            .unwrap()
            .bundle_text(&manifest_text)
            .unwrap();
        let prepared = PreparedMaster::read(
            &source,
            "P001",
            MasterSelector {
                variant_id: "variant-1".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        assert!(prepared.loaded.recipe.full_attempt_acquisition());
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
                .prepare_run_full(binding, &receipt.receipt_id, move |value| sink.push(value))
                .unwrap(),
        };
        let legacy = PackageProtocolRuntime::with_services(
            Arc::clone(&workspace),
            Arc::clone(&media),
            Arc::clone(&input),
        );
        let storage =
            MasterStorage::create(&root, &prepared, "run-pause-test", Value::Null, false).unwrap();
        let output = root.join(storage.receipt["outputDirectory"].as_str().unwrap());
        let mut worker = legacy
            .begin_companion(|lease| {
                MasterWorker::new(
                    prepared,
                    "unused-workspace".into(),
                    vec![],
                    storage,
                    authority,
                    mailbox,
                    workspace,
                    Arc::new(RecorderService::default()),
                    lease,
                )
            })
            .unwrap();
        let video_position = worker
            .prepared
            .plan
            .steps
            .iter()
            .find(|step| step.kind == MasterStepKind::Video)
            .unwrap()
            .position;
        worker.state.position = video_position;
        worker.state.phase = MasterPhase::Playing;
        worker.occurrence = "execution-pause-test".into();
        worker.opened = true;
        seed_stale_digital(&mut worker);
        worker.action(MasterAction::Pause).unwrap();
        assert_eq!(worker.state.phase, MasterPhase::Paused);
        assert_eq!((worker.response.x, worker.response.y), (0.8, -0.4));
        assert!(!worker.state.input_active);
        assert!(
            worker.clock.is_some(),
            "full-attempt sampling must remain armed"
        );

        let rate = worker.prepared.loaded.recipe.policy().sampling_frequency_hz as u16;
        worker.clock =
            Some(DeadlineClock::new(rate, Instant::now() - Duration::from_millis(100)).unwrap());
        worker.tick().unwrap();
        worker.storage.checkpoint().unwrap();
        let sample: Value = serde_json::from_str(
            std::fs::read_to_string(output.join("master-samples.v2.jsonl"))
                .unwrap()
                .lines()
                .last()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(sample["phase"], "paused");
        assert_eq!(sample["valence"], 0.8);
        assert_eq!(sample["arousal"], -0.4);
        assert_eq!(sample["inputActive"], false);
        assert_eq!(sample["feedbackVisible"], true);
        let events = std::fs::read_to_string(output.join("master-events.v2.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert!(events.iter().any(|event| event["eventType"] == "pause"));
        assert!(events
            .iter()
            .all(|event| event["eventType"] != "neutralReset"));
        drop(worker);
        drop(legacy);
        drop(input);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
    #[test]
    #[ignore = "requires an exact Planner-authored master6 workspace and explicit empty qualification root"]
    fn actual_master6_worker_records_dense_full_attempt_evidence() {
        let recipe_path = std::env::var_os("AFFECT_RUNNER_MASTER6_SOURCE")
            .map(std::path::PathBuf::from)
            .expect("AFFECT_RUNNER_MASTER6_SOURCE is required");
        let root = std::env::var_os("AFFECT_RUNNER_MASTER6_WORKER_ROOT")
            .map(std::path::PathBuf::from)
            .expect("AFFECT_RUNNER_MASTER6_WORKER_ROOT is required");
        let xdf_path = std::env::var_os("AFFECT_RUNNER_MASTER6_WORKER_XDF")
            .map(std::path::PathBuf::from)
            .expect("AFFECT_RUNNER_MASTER6_WORKER_XDF is required");
        assert!(root.is_dir(), "qualification root must already exist");
        assert!(
            root.read_dir().unwrap().next().is_none(),
            "qualification root must be empty"
        );
        assert_eq!(
            xdf_path.parent().unwrap().canonicalize().unwrap(),
            root.canonicalize().unwrap(),
            "XDF must be a direct child of the qualification root"
        );
        assert!(!xdf_path.exists(), "qualification XDF must be new");

        let loaded =
            crate::research_planner_recipe_file::read_supported_planner_recipe_file(&recipe_path)
                .unwrap();
        assert_eq!(loaded.recipe.version(), 6);
        let transport = loaded.transport_text().unwrap();
        let prepared = PreparedMaster::read(
            &transport,
            "P001",
            MasterSelector {
                variant_id: "variant-1".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        assert_eq!(prepared.plan.version, 6);
        assert!(prepared.loaded.recipe.full_attempt_acquisition());
        let rate = prepared.loaded.recipe.policy().sampling_frequency_hz;
        assert!(prepared.loaded.recipe.policy().lsl.enabled);

        let workspace = Arc::new(WorkspaceService::new(root.join("app-data")).unwrap());
        let workspace_id = workspace
            .select(recipe_path.parent().unwrap().to_path_buf())
            .unwrap()
            .workspace_id
            .unwrap();
        workspace
            .with_workspace(&workspace_id, |workspace_root, _| {
                crate::research_planner_recipe_file::verify_loaded_questionnaire_assets(
                    workspace_root,
                    &prepared.loaded,
                )
            })
            .unwrap();
        let scan = workspace.rescan_planner_videos(&workspace_id).unwrap();
        let catalogue = &prepared.loaded.recipe.segment("P1").unwrap()["videoCatalogue"];
        let entries = catalogue["entries"].as_array().unwrap();
        assert_eq!(entries.len(), scan.stimuli.len());
        // This qualification drives synthetic HTML-video callbacks and therefore
        // must not mint a decode/display proof. Bind only the exact current file
        // identity needed by the worker's ephemeral media grant; production
        // preflight remains stricter and requires a real WebView attestation.
        let bindings = entries
            .iter()
            .map(|entry| {
                let current = scan
                    .stimuli
                    .iter()
                    .find(|stimulus| {
                        stimulus.sha256 == entry["sha256"]
                            && stimulus.byte_length == entry["byteLength"]
                    })
                    .unwrap();
                MasterVideoBinding::V3(crate::research_workspace::RunnerVideoBindingV3 {
                    asset_id: entry["assetId"].as_str().unwrap().into(),
                    annotation_id: entry["annotationId"].as_str().unwrap().into(),
                    source_relative_path: entry["sourceRelativePath"].as_str().unwrap().into(),
                    workspace_file_id: current.workspace_file_id.clone(),
                    sha256: current.sha256.clone(),
                    byte_length: current.byte_length,
                    mime_type: current.mime_type.clone(),
                    duration_ms: entry["durationMs"].as_u64().unwrap(),
                    display_geometry: serde_json::from_value(entry["geometry"].clone()).unwrap(),
                })
            })
            .collect::<Vec<_>>();

        let recorder = Arc::new(RecorderService::default());
        recorder
            .start_path(
                crate::research_recorder::RecordStartRequest {
                    experiment_package_source_text: transport,
                    record_own: true,
                    discovery_revision: None,
                    stream_keys: vec![],
                },
                xdf_path.clone(),
            )
            .unwrap();
        let input = Arc::new(ResearchInputService::for_tests());
        let binding = prepared.feedback.input.clone();
        let receipt = input.issue_test_receipt_for_tests(binding.clone()).unwrap();
        let mailbox = Arc::new(ProtocolInputMailbox::new(binding.kind));
        let sink = Arc::clone(&mailbox);
        let authority = InputAuthority {
            service: Arc::clone(&input),
            id: input
                .prepare_run_full(binding, &receipt.receipt_id, move |value| sink.push(value))
                .unwrap(),
        };
        let media = Arc::new(NativeMediaService::unavailable_for_tests());
        let runtime = PackageProtocolRuntime::with_services(
            Arc::clone(&workspace),
            Arc::clone(&media),
            Arc::clone(&input),
        );
        std::fs::create_dir(root.join("outputs")).unwrap();
        let storage = MasterStorage::create_with_validation(
            &root,
            &prepared,
            "run-master6-worker",
            Value::Null,
            false,
            true,
        )
        .unwrap();
        let output = root.join(storage.receipt["outputDirectory"].as_str().unwrap());
        let mut worker = runtime
            .begin_companion(|lease| {
                MasterWorker::new(
                    prepared,
                    workspace_id,
                    bindings,
                    storage,
                    authority,
                    Arc::clone(&mailbox),
                    workspace,
                    Arc::clone(&recorder),
                    lease,
                )
            })
            .unwrap();
        worker.observe(MarkerEvent::SessionStart, false).unwrap();

        let tick = |worker: &mut MasterWorker| {
            let wait = worker
                .clock
                .as_ref()
                .unwrap()
                .next_deadline()
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(4));
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
            worker.tick().unwrap();
        };
        while !worker.terminal {
            let step = worker.current().unwrap().clone();
            worker
                .action(MasterAction::Presented {
                    position: step.position,
                })
                .unwrap();
            match step.kind {
                MasterStepKind::Questionnaire => worker
                    .action(MasterAction::SurveySubmit {
                        position: step.position,
                        data: json!({
                            "details": true,
                            "explanation": "Synthetic worker qualification response",
                            "choices": ["a", "b"]
                        }),
                        page_no: 1,
                    })
                    .unwrap(),
                MasterStepKind::Interval => {
                    while worker.state.phase == MasterPhase::Interval {
                        tick(&mut worker);
                    }
                }
                MasterStepKind::Video => {
                    worker
                        .action(MasterAction::HtmlVideoStarted {
                            position: step.position,
                            media_time_ms: Some(0.),
                        })
                        .unwrap();
                    for (direction, detail, apply_step, input_active) in [
                        (
                            crate::research_contracts::DirectionV1::Right,
                            "synthetic-right-press",
                            true,
                            true,
                        ),
                        (
                            crate::research_contracts::DirectionV1::Right,
                            "synthetic-right-release",
                            false,
                            false,
                        ),
                        (
                            crate::research_contracts::DirectionV1::Up,
                            "synthetic-up-press",
                            true,
                            true,
                        ),
                        (
                            crate::research_contracts::DirectionV1::Up,
                            "synthetic-up-release",
                            false,
                            false,
                        ),
                    ] {
                        mailbox.push(crate::research_input::NativeInputUpdate::Digital(
                            crate::research_input::NativeDigitalInput {
                                direction,
                                detail: detail.into(),
                                apply_step,
                                input_active,
                                impulse: false,
                                observed_at: Instant::now(),
                            },
                        ));
                    }
                    let video_end = Instant::now() + Duration::from_secs(10);
                    while Instant::now() < video_end {
                        tick(&mut worker);
                    }
                    worker
                        .action(MasterAction::HtmlVideoEnded {
                            position: step.position,
                            media_time_ms: Some(10_000.),
                        })
                        .unwrap();
                }
            }
        }

        assert_eq!(worker.state.phase, MasterPhase::Finished);
        assert_eq!(worker.state.completed_step_count, worker.state.step_count);
        assert!(worker.state.sample_count >= u64::from(rate) * 10);
        assert_eq!(worker.state.result.as_ref().unwrap()["status"], "completed");
        let sample_count = worker.state.sample_count;
        let missed_slot_count = worker.state.missed_slot_count;
        drop(worker);
        drop(runtime);
        drop(input);

        let line_count = |name: &str| {
            std::fs::read_to_string(output.join(name))
                .unwrap()
                .lines()
                .count()
        };
        assert_eq!(line_count("master-samples.v2.jsonl"), sample_count as usize);
        assert_eq!(line_count("master-inputs.v2.jsonl"), 4);
        assert_eq!(line_count("master-responses.v3.jsonl"), 3);
        assert!(line_count("master-events.v2.jsonl") >= 20);
        assert!(xdf_path.is_file());
        eprintln!(
            "master6 worker qualification: {sample_count} samples, {missed_slot_count} missed slots"
        );
    }
    #[test]
    fn master_v2_and_v3_require_every_typed_and_likert_answer_before_advancing() {
        use super::super::typed_forms::{FormAnswerValue, TypedChoice};
        for (version, source, language) in [
            (
                2,
                include_str!("../../../test/fixtures/runner-master-v2-owner.canonical.json"),
            ),
            (
                3,
                include_str!("../../../test/fixtures/runner-master-v3-owner.canonical.json"),
            ),
        ]
        .into_iter()
        .flat_map(|(version, source)| {
            ["en", "de"]
                .into_iter()
                .map(move |language| (version, source, language))
        }) {
            let root =
                std::env::temp_dir().join(format!("affect-master-v2-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::create_dir(root.join("outputs")).unwrap();
            let prepared = PreparedMaster::read(
                source,
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
            assert_eq!(storage.receipt["version"], version);
            assert!(storage.receipt.get("participant").is_none());
            let output = root.join(storage.receipt["outputDirectory"].as_str().unwrap());
            let mut worker = legacy
                .begin_companion(|lease| {
                    MasterWorker::new(
                        prepared,
                        "unused".into(),
                        vec![],
                        storage,
                        authority,
                        mailbox,
                        workspace,
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
                    storage,
                    authority,
                    mailbox,
                    workspace,
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

//! Rust-owned HTML video session lifecycle, sampling and persistence.
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
    research_native_protocol::{input_mailbox::ProtocolInputMailbox, runtime::CompanionLease},
    research_recorder::RecorderService,
    research_timing::DeadlineClock,
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
    storage: MasterStorage,
    authority: InputAuthority,
    mailbox: Arc<ProtocolInputMailbox>,
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
    media_grant_id: Option<String>,
    clock: Option<DeadlineClock>,
    interval_deadline: Option<Instant>,
    answers: FormAnswers,
    typed_answers: super::typed_forms::TypedFormAnswers,
    terminal: bool,
    pub cancellation: Arc<AtomicBool>,
}
impl MasterWorker {
    pub(crate) fn new(
        prepared: PreparedMaster,
        mut storage: MasterStorage,
        authority: InputAuthority,
        mailbox: Arc<ProtocolInputMailbox>,
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
        Ok(Self {
            prepared,
            storage,
            authority,
            mailbox,
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
            media_grant_id: None,
            clock: None,
            interval_deadline: None,
            answers: Default::default(),
            terminal: false,
            typed_answers: Default::default(),
            cancellation: Arc::new(AtomicBool::new(false)),
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
                    MasterStepKind::Video => {
                        self.state.phase = MasterPhase::Preparing;
                        self.media_grant_id = None;
                    }
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
                    return Err(invalid("Pause requires observed HTML video playback."));
                }
                self.state.phase = MasterPhase::Pausing;
                self.transition_started = Instant::now();
                Ok(())
            }
            MasterAction::Resume => {
                if self.state.phase != MasterPhase::Paused {
                    return Err(invalid("Resume requires observed HTML video pause."));
                }
                self.state.phase = MasterPhase::Resuming;
                self.transition_started = Instant::now();
                Ok(())
            }
            MasterAction::VideoGrant {
                position,
                media_grant_id,
            } => {
                self.require_position(position, MasterPhase::Preparing)?;
                if media_grant_id.len() != 32
                    || !media_grant_id.bytes().all(|byte| byte.is_ascii_hexdigit())
                    || self.media_grant_id.is_some()
                {
                    return Err(invalid(
                        "HTML media grant is missing, malformed or duplicated.",
                    ));
                }
                self.media_grant_id = Some(media_grant_id);
                Ok(())
            }
            MasterAction::VideoPlaying {
                position,
                media_grant_id,
            } => {
                self.require_video_grant(position, &media_grant_id)?;
                if !matches!(
                    self.state.phase,
                    MasterPhase::Preparing | MasterPhase::Resuming | MasterPhase::Paused
                ) {
                    return Err(invalid("HTML play observation is stale."));
                }
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
                self.step_started.get_or_insert(now);
                self.observe(
                    if first {
                        MarkerEvent::VideoStart
                    } else {
                        MarkerEvent::Resume
                    },
                    true,
                )?;
                self.opened = true;
                Ok(())
            }
            MasterAction::VideoPaused {
                position,
                media_grant_id,
            } => {
                self.require_video_grant(position, &media_grant_id)?;
                if !matches!(
                    self.state.phase,
                    MasterPhase::Playing | MasterPhase::Pausing
                ) {
                    return Err(invalid("HTML pause observation is stale."));
                }
                self.quiesce()?;
                self.state.phase = MasterPhase::Paused;
                self.observe(MarkerEvent::Pause, true)
            }
            MasterAction::VideoEnded {
                position,
                media_grant_id,
            } => {
                self.require_video_grant(position, &media_grant_id)?;
                if !matches!(self.state.phase, MasterPhase::Playing | MasterPhase::Paused)
                    || !self.opened
                {
                    return Err(invalid("HTML end requires the matching started video."));
                }
                self.quiesce()?;
                self.observe(MarkerEvent::VideoEnd, true)?;
                self.media_grant_id = None;
                self.next()
            }
            MasterAction::VideoFailed {
                position,
                media_grant_id,
            } => {
                self.require_video_grant(position, &media_grant_id)?;
                Err(CommandError::new(
                    "master-html-video-failed",
                    "The selected HTML video failed during this occurrence.",
                ))
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
        if !matches!(self.prepared.plan.version, 2..=5) {
            return Err(invalid("Typed answers require master version 2, 3 or 4."));
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
        if !matches!(self.prepared.plan.version, 4 | 5) {
            return Err(invalid("SurveyJS answers require master version 4."));
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
        let checked = crate::research_surveyjs_engine::validate_survey_data_seed(
            &definition.survey_json,
            &definition.language,
            &data,
            submitted,
            seed,
        )?;
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
    fn record_answers(&mut self, record: &mut Value, submitted: bool) -> ResearchResult<()> {
        if matches!(self.prepared.plan.version, 4 | 5) {
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
    fn require_video_grant(&self, position: u32, media_grant_id: &str) -> ResearchResult<()> {
        if self.state.position != position
            || self.current()?.kind != MasterStepKind::Video
            || self.media_grant_id.as_deref() != Some(media_grant_id)
        {
            return Err(invalid(
                "HTML video observation is stale or belongs to another grant.",
            ));
        }
        Ok(())
    }
    fn tick(&mut self) -> ResearchResult<()> {
        let now = Instant::now();
        if matches!(
            self.state.phase,
            MasterPhase::Preparing | MasterPhase::Resuming | MasterPhase::Pausing
        ) && now.duration_since(self.transition_started) > Duration::from_secs(15)
        {
            return Err(CommandError::new(
                "master-media-transition-timeout",
                "HTML media transition did not complete.",
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
    fn next(&mut self) -> ResearchResult<()> {
        self.opened = false;
        self.media_grant_id = None;
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
        self.media_grant_id = None;
        self.authority.service.end_run(&self.authority.id);
        let failure = failure.or_else(|| input_failure.as_ref().map(|e| e.code.as_str()));
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
            self.media_grant_id = None;
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
        research_input::ResearchInputService, research_native_media::NativeMediaService,
        research_native_protocol::runtime::PackageProtocolRuntime,
        research_runner_master::MasterSelector, research_workspace::WorkspaceService,
    };

    fn with_worker(check: impl FnOnce(&mut MasterWorker)) {
        let root =
            std::env::temp_dir().join(format!("runner-html-worker-{}", uuid::Uuid::new_v4()));
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
        // The package service only provides its shared attempt lease here; it
        // never creates or controls a player in this test.
        let media = Arc::new(NativeMediaService::unavailable_for_tests());
        let input = Arc::new(ResearchInputService::for_tests());
        let receipt = input
            .issue_test_receipt_for_tests(prepared.feedback.input.clone())
            .unwrap();
        let mailbox = Arc::new(ProtocolInputMailbox::new(prepared.feedback.input.kind));
        let sink = Arc::clone(&mailbox);
        let authority = InputAuthority {
            service: Arc::clone(&input),
            id: input
                .prepare_run_full(
                    prepared.feedback.input.clone(),
                    &receipt.receipt_id,
                    move |update| sink.push(update),
                )
                .unwrap(),
        };
        let package = PackageProtocolRuntime::with_services(workspace, media, input);
        let storage =
            MasterStorage::create(&root, &prepared, "run-html-test", Value::Null, false).unwrap();
        let mut worker = package
            .begin_companion(|lease| {
                MasterWorker::new(
                    prepared,
                    storage,
                    authority,
                    mailbox,
                    Arc::new(RecorderService::default()),
                    lease,
                )
            })
            .unwrap();
        check(&mut worker);
        drop(worker);
        drop(package);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn observed_video_events_require_the_current_position_and_grant() {
        with_worker(|worker| {
            worker.observe(MarkerEvent::SessionStart, false).unwrap();
            let position = worker
                .prepared
                .plan
                .steps
                .iter()
                .find(|step| step.kind == MasterStepKind::Video)
                .unwrap()
                .position;
            worker.state.position = position;
            worker.state.phase = MasterPhase::AwaitingPresentation;
            worker.action(MasterAction::Presented { position }).unwrap();
            assert_eq!(worker.state.phase, MasterPhase::Preparing);
            let grant = "0123456789abcdef0123456789abcdef".to_owned();
            assert!(worker
                .action(MasterAction::VideoPlaying {
                    position,
                    media_grant_id: grant.clone()
                })
                .is_err());
            worker
                .action(MasterAction::VideoGrant {
                    position,
                    media_grant_id: grant.clone(),
                })
                .unwrap();
            assert!(worker
                .action(MasterAction::VideoPlaying {
                    position,
                    media_grant_id: "ffffffffffffffffffffffffffffffff".into()
                })
                .is_err());
            assert!(worker
                .action(MasterAction::VideoEnded {
                    position,
                    media_grant_id: grant.clone()
                })
                .is_err());
            worker
                .action(MasterAction::VideoPlaying {
                    position,
                    media_grant_id: grant.clone(),
                })
                .unwrap();
            assert_eq!(worker.state.phase, MasterPhase::Playing);
            worker
                .action(MasterAction::VideoEnded {
                    position,
                    media_grant_id: grant.clone(),
                })
                .unwrap();
            assert_eq!(worker.state.position, position + 1);
            assert_eq!(worker.state.event_count, 3);
            assert!(worker
                .action(MasterAction::VideoEnded {
                    position,
                    media_grant_id: grant
                })
                .is_err());
            assert_eq!(worker.state.event_count, 3);
        });
    }
}

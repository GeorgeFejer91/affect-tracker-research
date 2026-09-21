//! Master-only outbound adapter. Frozen legacy marker APIs are unchanged.
#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
use super::information::InformationWriter;
use super::information::{ContentKind, PreparedTransfer};
use crate::research_contracts::ResearchLslSettingsV1;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_lsl::LslState;
use crate::research_recorder::RecorderService;

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
pub(crate) struct MasterLslService {
    state: labstream::Outlet,
    markers: labstream::Outlet,
    recording: Option<crate::research_recorder::OwnRecording>,
    information: InformationWriter,
}

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
impl MasterLslService {
    pub(crate) fn start(
        settings: &ResearchLslSettingsV1,
        rate: u16,
        run_id: &str,
        source_hash: &str,
        recorder: &RecorderService,
        attempt_id: &str,
        startup: PreparedTransfer,
    ) -> ResearchResult<Self> {
        // Validate the entire profile before any publication or authority starts.
        let information = InformationWriter::new(run_id, attempt_id, source_hash)?;
        let (state_info, marker_info) =
            crate::research_lsl::build_stream_descriptions(settings, rate, run_id)?;
        let state = labstream::Outlet::new(state_info).map_err(CommandError::io)?;
        let markers = labstream::Outlet::new(marker_info).map_err(CommandError::io)?;
        let recording = recorder.attach_own(state.info(), markers.info(), source_hash, run_id)?;
        let mut service = Self {
            state,
            markers,
            recording,
            information,
        };
        // Attach acknowledgement precedes this first stream sample.
        if let Err(error) = service.send(ContentKind::Startup, startup) {
            // No worker owns cleanup until this constructor succeeds. Close the
            // attached attempt recording and retain any partial startup frames.
            drop(service);
            let _ = recorder.stop();
            return Err(error);
        }
        Ok(service)
    }
    fn send(&mut self, kind: ContentKind, value: PreparedTransfer) -> ResearchResult<f64> {
        let outlet = &self.markers;
        let recording = &self.recording;
        let receipt = self.information.send(kind, value, |text| {
            let timestamp = labstream::clock();
            outlet
                .push_text_at(text, timestamp)
                .map_err(CommandError::io)?;
            if let Some(recording) = recording {
                recording.marker(timestamp, text)?;
            }
            Ok(timestamp)
        })?;
        Ok(receipt.first_lsl_time_seconds)
    }
    pub(crate) fn record(
        &mut self,
        kind: ContentKind,
        value: &impl serde::Serialize,
    ) -> ResearchResult<f64> {
        self.send(kind, PreparedTransfer::new(value)?)
    }
    pub(crate) fn observe(&mut self, observation: &impl serde::Serialize) -> ResearchResult<f64> {
        self.record(ContentKind::Observation, observation)
    }
    pub(crate) fn state(&self, state: LslState) -> ResearchResult<f64> {
        self.information.require_ready()?;
        let timestamp = labstream::clock();
        let values = crate::research_lsl::state_values(state);
        self.state
            .push_at(&values, timestamp)
            .map_err(CommandError::io)?;
        if let Some(recording) = &self.recording {
            recording.state(timestamp, &values)?;
        }
        Ok(timestamp)
    }
}

#[cfg(not(all(feature = "lsl-streaming", target_os = "windows")))]
pub(crate) struct MasterLslService;
#[cfg(not(all(feature = "lsl-streaming", target_os = "windows")))]
impl MasterLslService {
    pub(crate) fn start(
        _: &ResearchLslSettingsV1,
        _: u16,
        _: &str,
        _: &str,
        _: &RecorderService,
        _: &str,
        _: PreparedTransfer,
    ) -> ResearchResult<Self> {
        Err(unavailable())
    }
    pub(crate) fn observe(&mut self, _: &impl serde::Serialize) -> ResearchResult<f64> {
        Err(unavailable())
    }
    pub(crate) fn state(&self, _: LslState) -> ResearchResult<f64> {
        Err(unavailable())
    }
    pub(crate) fn record(
        &mut self,
        _: ContentKind,
        _: &impl serde::Serialize,
    ) -> ResearchResult<f64> {
        Err(unavailable())
    }
}
#[cfg(not(all(feature = "lsl-streaming", target_os = "windows")))]
fn unavailable() -> CommandError {
    CommandError::new(
        "lsl_unavailable",
        "This build cannot emit master LSL streams.",
    )
}

#[cfg(all(test, feature = "lsl-streaming", target_os = "windows"))]
mod tests {
    use super::*;
    use crate::research_runner_master::{
        forms::FormAnswers,
        information::startup_bundle,
        markers::{EvidenceEvent, MarkerEvent, MasterMarkers},
        runtime::MasterChoice,
        MasterSelector, MasterStepKind, PreparedMaster,
    };
    #[test]
    fn actual_outlets_record_self_contained_information_and_synthetic_answers() {
        let source =
            include_str!("../../../test/fixtures/runner-master-lsl-synthetic-v1.canonical.json");
        let prepared = PreparedMaster::read(
            source,
            "P001",
            MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        let path = std::env::var_os("AFFECT_RUNNER_INFORMATION_XDF_FIXTURE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!(
                    "affect-information-synthetic-{}.xdf",
                    uuid::Uuid::new_v4()
                ))
            });
        let recorder = RecorderService::default();
        recorder
            .start_path(
                crate::research_recorder::RecordStartRequest {
                    experiment_package_source_text: source.into(),
                    record_own: true,
                    discovery_revision: None,
                    stream_keys: vec![],
                },
                path.clone(),
            )
            .unwrap();
        let mut markers = MasterMarkers::new(
            &prepared.plan,
            "run-synthetic-stream",
            "attempt-synthetic-stream",
        )
        .unwrap();
        let settings = crate::research_runner_session::participant_lsl(
            &prepared.loaded.recipe.policy().lsl,
            "P001",
        )
        .unwrap();
        let startup = startup_bundle(
            &prepared,
            &markers,
            &settings,
            serde_json::json!({"participantId":"P001","participantCode":"TP","age":30,"gender":"X","handedness":"R"}),
        );
        let mut count = 2 + crate::research_contracts::canonical_json(&startup, &[])
            .unwrap()
            .len()
            .div_ceil(super::super::information::CHUNK_BYTES) as u64;
        let mut service = MasterLslService::start(
            &settings,
            prepared
                .loaded
                .recipe
                .policy()
                .sampling_frequency_hz
                .try_into()
                .unwrap(),
            "run-synthetic-stream",
            &prepared.plan.recipe_source_byte_sha256,
            &recorder,
            "attempt-synthetic-stream",
            PreparedTransfer::new(&startup).unwrap(),
        )
        .unwrap();
        let mut time = 0.;
        service
            .observe(
                &markers
                    .observe(MarkerEvent::SessionStart, None, None, time)
                    .unwrap(),
            )
            .unwrap();
        count += 3;
        for step in &prepared.plan.steps {
            let execution = format!("execution-synthetic-{}", step.position);
            let (start, end) = match step.kind {
                MasterStepKind::Questionnaire => (MarkerEvent::FormStart, MarkerEvent::FormEnd),
                MasterStepKind::Interval => (MarkerEvent::IsiStart, MarkerEvent::IsiEnd),
                MasterStepKind::Video => (MarkerEvent::VideoStart, MarkerEvent::VideoEnd),
            };
            time += 1.;
            service
                .observe(
                    &markers
                        .observe(start, Some(&step.entry_id), Some(&execution), time)
                        .unwrap(),
                )
                .unwrap();
            time += step.duration_ms.unwrap_or(250) as f64;
            if step.kind == MasterStepKind::Questionnaire {
                let now = std::time::Instant::now();
                let choices = step.payload["definition"]["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|item| MasterChoice {
                        item_id: item["itemId"].as_str().unwrap().into(),
                        option_id: item["options"][0]["optionId"].as_str().unwrap().into(),
                    })
                    .collect();
                let mut record = FormAnswers::default()
                    .replace(
                        step,
                        choices,
                        true,
                        now,
                        now + std::time::Duration::from_millis(125),
                    )
                    .unwrap();
                record["runId"] = serde_json::json!("run-synthetic-stream");
                record["attemptId"] = serde_json::json!("attempt-synthetic-stream");
                record["participantId"] = serde_json::json!("P001");
                record["recipeSourceByteSha256"] =
                    serde_json::json!(prepared.plan.recipe_source_byte_sha256);
                record["planIdentitySha256"] =
                    serde_json::json!(prepared.plan.plan_identity_sha256);
                record["monotonicMs"] = serde_json::json!(time);
                service.record(ContentKind::Responses, &record).unwrap();
                count += 3;
            } else if step.kind == MasterStepKind::Video {
                service
                    .state(LslState {
                        current_valence: 0.25,
                        current_arousal: -0.5,
                        target_valence: 0.25,
                        target_arousal: -0.5,
                        radius: 0.5590169943749475,
                        angle_degrees: 296.565051177078,
                        animation_active: true,
                        input_active: true,
                    })
                    .unwrap();
                count += 1;
            }
            service
                .observe(
                    &markers
                        .observe(end, Some(&step.entry_id), Some(&execution), time)
                        .unwrap(),
                )
                .unwrap();
            count += 6;
        }
        service
            .observe(
                &markers
                    .observe(MarkerEvent::Complete, None, None, time + 1.)
                    .unwrap(),
            )
            .unwrap();
        count += 3;
        service.record(ContentKind::Outcome,&serde_json::json!({"schema":"affect-runner-outcome","version":1,"protocolOutcome":"completed","completedStepCount":prepared.plan.steps.len(),"failureCode":null,"monotonicMs":time+2.,"localCheckpoint":"durable","recordingFinalization":"pending"})).unwrap();
        count += 3;
        drop(service);
        let status = recorder.stop().unwrap();
        assert_eq!(status.phase, "complete", "{:?}", status.error);
        assert_eq!(status.sample_count, count);
        assert!(path.is_file());
    }

    #[test]
    #[ignore = "requires an exact Planner-authored master6 source tree and explicit XDF output path"]
    fn actual_master6_outlets_record_reconstructable_synthetic_session() {
        let recipe_path = std::env::var_os("AFFECT_RUNNER_MASTER6_SOURCE")
            .map(std::path::PathBuf::from)
            .expect("AFFECT_RUNNER_MASTER6_SOURCE is required");
        let path = std::env::var_os("AFFECT_RUNNER_MASTER6_XDF_FIXTURE")
            .map(std::path::PathBuf::from)
            .expect("AFFECT_RUNNER_MASTER6_XDF_FIXTURE is required");
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
        assert!(prepared.loaded.recipe.policy().lsl.enabled);

        let recorder = RecorderService::default();
        recorder
            .start_path(
                crate::research_recorder::RecordStartRequest {
                    experiment_package_source_text: transport,
                    record_own: true,
                    discovery_revision: None,
                    stream_keys: vec![],
                },
                path.clone(),
            )
            .unwrap();
        let mut markers =
            MasterMarkers::new(&prepared.plan, "run-master6-xdf", "attempt-master6-xdf").unwrap();
        let settings = crate::research_runner_session::participant_lsl(
            &prepared.loaded.recipe.policy().lsl,
            "P001",
        )
        .unwrap();
        let startup = startup_bundle(&prepared, &markers, &settings, serde_json::Value::Null);
        assert_eq!(startup["version"], 6);
        assert!(startup.get("legacyCodedParticipant").is_none());
        assert!(startup["questionnaireAssets"]
            .as_array()
            .is_some_and(|assets| !assets.is_empty()));
        let mut service = MasterLslService::start(
            &settings,
            prepared
                .loaded
                .recipe
                .policy()
                .sampling_frequency_hz
                .try_into()
                .unwrap(),
            "run-master6-xdf",
            &prepared.plan.recipe_source_byte_sha256,
            &recorder,
            "attempt-master6-xdf",
            PreparedTransfer::new(&startup).unwrap(),
        )
        .unwrap();
        let mut time = 0.;
        service
            .observe(
                &markers
                    .observe_evidence(
                        EvidenceEvent::SessionStart,
                        "awaitingPresentation",
                        None,
                        None,
                        time,
                        time,
                        serde_json::json!({"kind":"lifecycle"}),
                    )
                    .unwrap(),
            )
            .unwrap();
        for step in &prepared.plan.steps {
            let execution = format!("execution-master6-{}", step.position);
            let (start, end, phase) = match step.kind {
                MasterStepKind::Questionnaire => (
                    EvidenceEvent::FormStart,
                    EvidenceEvent::FormEnd,
                    "questionnaire",
                ),
                MasterStepKind::Interval => {
                    (EvidenceEvent::IsiStart, EvidenceEvent::IsiEnd, "interval")
                }
                MasterStepKind::Video => (
                    EvidenceEvent::VideoStart,
                    EvidenceEvent::VideoEnd,
                    "playing",
                ),
            };
            time += 1.;
            if step.kind == MasterStepKind::Interval {
                service
                    .observe(
                        &markers
                            .observe_evidence(
                                EvidenceEvent::NeutralReset,
                                phase,
                                Some(&step.entry_id),
                                Some(&execution),
                                time,
                                time,
                                serde_json::json!({"kind":"neutralReset","reason":"intervalAdmission","stateAfter":{"valence":0.0,"arousal":0.0}}),
                            )
                            .unwrap(),
                    )
                    .unwrap();
            }
            service
                .observe(
                    &markers
                        .observe_evidence(
                            start,
                            phase,
                            Some(&step.entry_id),
                            Some(&execution),
                            time,
                            time,
                            serde_json::json!({"kind":"lifecycle"}),
                        )
                        .unwrap(),
                )
                .unwrap();
            let active = step.kind == MasterStepKind::Video;
            service
                .state(LslState {
                    current_valence: if active { 0.25 } else { 0. },
                    current_arousal: if active { -0.5 } else { 0. },
                    target_valence: if active { 0.25 } else { 0. },
                    target_arousal: if active { -0.5 } else { 0. },
                    radius: if active { 0.559_016_994_374_947_5 } else { 0. },
                    angle_degrees: if active { 296.565_051_177_078 } else { 0. },
                    animation_active: active,
                    input_active: active,
                })
                .unwrap();
            time += step.duration_ms.unwrap_or(250) as f64;
            if step.kind == MasterStepKind::Questionnaire {
                let definition: crate::research_surveyjs_definition::SurveyDefinitionV1 =
                    serde_json::from_value(step.payload["definition"].clone()).unwrap();
                let seed = (u32::from_str_radix(&prepared.plan.plan_identity_sha256[..8], 16)
                    .unwrap()
                    ^ step.position)
                    .max(1);
                let data = serde_json::json!({
                    "details": true,
                    "explanation": "Synthetic qualification response",
                    "choices": ["a", "b"]
                });
                let checked = crate::research_surveyjs_engine::validate_survey_data_seed(
                    &definition.survey_json,
                    &definition.language,
                    &data,
                    true,
                    seed,
                )
                .unwrap();
                let record = serde_json::json!({
                    "schema":"affect-runner-master-responses",
                    "version":3,
                    "runId":"run-master6-xdf",
                    "attemptId":"attempt-master6-xdf",
                    "participantId":"P001",
                    "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,
                    "planIdentitySha256":prepared.plan.plan_identity_sha256,
                    "entryId":step.entry_id,
                    "position":step.position,
                    "module":step.payload["module"],
                    "questionnaireId":definition.questionnaire_id,
                    "questionnaireVersion":definition.questionnaire_version,
                    "definitionSha256":definition.definition_sha256,
                    "status":"submitted",
                    "monotonicMs":time,
                    "responses":{
                        "engineVersion":definition.engine_version,
                        "language":definition.language,
                        "completionPolicy":definition.completion_policy,
                        "randomSeed":seed,
                        "evaluatedAtUnixMs":checked["evaluatedAtUnixMs"],
                        "inputData":data,
                        "data":checked["data"],
                        "visibleQuestionNames":checked["visibleQuestionNames"],
                        "pageNo":1,
                        "elapsedMs":125.
                    }
                });
                service.record(ContentKind::Responses, &record).unwrap();
            }
            service
                .observe(
                    &markers
                        .observe_evidence(
                            end,
                            phase,
                            Some(&step.entry_id),
                            Some(&execution),
                            time,
                            time,
                            serde_json::json!({"kind":"lifecycle"}),
                        )
                        .unwrap(),
                )
                .unwrap();
            if step.kind == MasterStepKind::Video {
                service
                    .observe(
                        &markers
                            .observe_evidence(
                                EvidenceEvent::NeutralReset,
                                phase,
                                Some(&step.entry_id),
                                Some(&execution),
                                time,
                                time,
                                serde_json::json!({"kind":"neutralReset","reason":"videoEnd","stateAfter":{"valence":0.0,"arousal":0.0}}),
                            )
                            .unwrap(),
                    )
                    .unwrap();
            }
        }
        service
            .observe(
                &markers
                    .observe_evidence(
                        EvidenceEvent::Complete,
                        "finished",
                        None,
                        None,
                        time + 1.,
                        time + 1.,
                        serde_json::json!({"kind":"lifecycle"}),
                    )
                    .unwrap(),
            )
            .unwrap();
        service
            .record(
                ContentKind::Outcome,
                &serde_json::json!({
                    "schema":"affect-runner-outcome",
                    "version":1,
                    "protocolOutcome":"completed",
                    "completedStepCount":prepared.plan.steps.len(),
                    "failureCode":null,
                    "monotonicMs":time+2.,
                    "localCheckpoint":"durable",
                    "recordingFinalization":"pending"
                }),
            )
            .unwrap();
        drop(service);
        let status = recorder.stop().unwrap();
        assert_eq!(status.phase, "complete", "{:?}", status.error);
        assert!(status.sample_count > prepared.plan.steps.len() as u64);
        assert!(path.is_file());
    }
}

//! Master-only outbound adapter. Frozen legacy marker APIs are unchanged.
#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
use super::information::InformationWriter;
use super::information::{ContentKind, PreparedTransfer};
use super::markers::MasterObservation;
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
    pub(crate) fn observe(&mut self, observation: &MasterObservation) -> ResearchResult<f64> {
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
    pub(crate) fn observe(&mut self, _: &MasterObservation) -> ResearchResult<f64> {
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
        markers::{MarkerEvent, MasterMarkers},
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
            &prepared.loaded.recipe.policy.lsl,
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
            130,
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
}

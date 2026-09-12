//! Master-only outbound adapter. Frozen legacy marker APIs are unchanged.
use super::markers::{MasterMarkers, MasterObservation};
#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
use super::markers::{MAX_OBSERVATION_BYTES, MAX_PROFILE_BYTES};
use crate::research_contracts::ResearchLslSettingsV1;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_lsl::LslState;
use crate::research_recorder::RecorderService;

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
pub(crate) struct MasterLslService {
    state: labstream::Outlet,
    markers: labstream::Outlet,
    recording: Option<crate::research_recorder::OwnRecording>,
}

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
impl MasterLslService {
    pub(crate) fn start(
        settings: &ResearchLslSettingsV1,
        rate: u16,
        run_id: &str,
        source_hash: &str,
        recorder: &RecorderService,
        profile: &MasterMarkers,
    ) -> ResearchResult<Self> {
        // Validate the entire profile before any publication or authority starts.
        let profile_text = bounded_text(&profile.profile_message, MAX_PROFILE_BYTES)?;
        let (state_info, marker_info) =
            crate::research_lsl::build_stream_descriptions(settings, rate, run_id)?;
        let state = labstream::Outlet::new(state_info).map_err(CommandError::io)?;
        let markers = labstream::Outlet::new(marker_info).map_err(CommandError::io)?;
        let recording = recorder.attach_own(state.info(), markers.info(), source_hash, run_id)?;
        let service = Self {
            state,
            markers,
            recording,
        };
        // Attach acknowledgement precedes this first stream sample.
        service.push_text(&profile_text)?;
        Ok(service)
    }
    fn push_text(&self, text: &str) -> ResearchResult<f64> {
        let timestamp = labstream::clock();
        self.markers
            .push_text_at(text, timestamp)
            .map_err(CommandError::io)?;
        if let Some(recording) = &self.recording {
            recording.marker(timestamp, text)?;
        }
        Ok(timestamp)
    }
    pub(crate) fn observe(&self, observation: &MasterObservation) -> ResearchResult<f64> {
        self.push_text(&bounded_text(observation, MAX_OBSERVATION_BYTES)?)
    }
    pub(crate) fn state(&self, state: LslState) -> ResearchResult<f64> {
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
        _: &MasterMarkers,
    ) -> ResearchResult<Self> {
        Err(unavailable())
    }
    pub(crate) fn observe(&self, _: &MasterObservation) -> ResearchResult<f64> {
        Err(unavailable())
    }
    pub(crate) fn state(&self, _: LslState) -> ResearchResult<f64> {
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

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
fn bounded_text(value: &impl serde::Serialize, limit: usize) -> ResearchResult<String> {
    let bytes = crate::research_contracts::canonical_json(value, &[])?;
    if bytes.len() > limit {
        return Err(CommandError::invalid_contract(
            "Master stream payload exceeds its execution bound.",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| CommandError::invalid_contract("Master stream payload is not UTF-8."))
}

#[cfg(all(test, feature = "lsl-streaming", target_os = "windows"))]
mod tests {
    use super::*;
    use crate::research_runner_master::{
        markers::MarkerEvent, MasterSelector, MasterStepKind, PreparedMaster,
    };
    #[test]
    fn actual_master_outlets_record_profile_before_synthetic_occurrences() {
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
        let path = std::env::var_os("AFFECT_RUNNER_MASTER_XDF_FIXTURE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!(
                    "affect-master-synthetic-{}.xdf",
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
        let service = MasterLslService::start(
            &settings,
            130,
            "run-synthetic-stream",
            &prepared.plan.recipe_source_byte_sha256,
            &recorder,
            &markers,
        )
        .unwrap();
        let mut time = 0.;
        let mut count = 1;
        service
            .observe(
                &markers
                    .observe(MarkerEvent::SessionStart, None, None, time)
                    .unwrap(),
            )
            .unwrap();
        count += 1;
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
            service
                .observe(
                    &markers
                        .observe(end, Some(&step.entry_id), Some(&execution), time)
                        .unwrap(),
                )
                .unwrap();
            count += 2;
        }
        service
            .observe(
                &markers
                    .observe(MarkerEvent::Complete, None, None, time + 1.)
                    .unwrap(),
            )
            .unwrap();
        count += 1;
        drop(service);
        let status = recorder.stop().unwrap();
        assert_eq!(status.phase, "complete", "{:?}", status.error);
        assert_eq!(status.sample_count, count);
        assert!(path.is_file());
    }
}

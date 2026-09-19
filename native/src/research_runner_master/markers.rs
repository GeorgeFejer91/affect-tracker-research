//! Versioned master marker stream. P3's planned profile remains immutable;
//! a complete execution profile adds only P2 before/after-session form sources.
use super::{MasterPlan, MasterStepKind};
use crate::research_contracts::{canonical_json, canonical_sha256};
use crate::research_error::{CommandError, ResearchResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(crate) const MAX_PROFILE_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_OBSERVATION_BYTES: usize = 2048;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MarkerEvent {
    SessionStart,
    VideoStart,
    VideoEnd,
    IsiStart,
    IsiEnd,
    FormStart,
    FormEnd,
    Pause,
    Resume,
    Interruption,
    Restart,
    Complete,
    Partial,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MasterObservation {
    pub schema: String,
    pub version: u32,
    pub recipe_sha256: String,
    pub run_id: String,
    pub attempt_id: String,
    pub variant_id: String,
    pub variant_version_sha256: String,
    pub sequence: u64,
    pub event_type: MarkerEvent,
    pub entry_id: Option<String>,
    pub execution_id: Option<String>,
    pub source_code: Option<String>,
    pub monotonic_ms: f64,
}

pub(crate) fn code(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub(crate) struct MasterMarkers {
    pub profile_message: Value,
    pub profile: Value,
    run_id: String,
    attempt_id: String,
    sequence: u64,
    last_ms: f64,
}
impl MasterMarkers {
    pub(crate) fn new(plan: &MasterPlan, run_id: &str, attempt_id: &str) -> ResearchResult<Self> {
        if !code(run_id) || !code(attempt_id) {
            return Err(CommandError::invalid_contract(
                "Master marker context requires bounded opaque codes.",
            ));
        }
        let planned = &plan.selected["markerProfile"];
        let mut profile = planned.clone();
        let mut entries = Vec::new();
        let mut codebook = planned["codebook"]
            .as_array()
            .ok_or_else(|| CommandError::invalid_contract("Missing planned marker codebook."))?
            .clone();
        for step in &plan.steps {
            if !code(&step.entry_id) {
                return Err(CommandError::invalid_contract(
                    "Master occurrence cannot be represented by the marker contract.",
                ));
            }
            let source = if step.kind == MasterStepKind::Questionnaire {
                let source = format!("form-source-{}", step.position);
                codebook.push(json!({"sourceCode":source,"kind":"form","identitySha256":step.payload["definition"]["definitionSha256"],"durationMs":null}));
                source
            } else {
                step.source_code
                    .clone()
                    .ok_or_else(|| CommandError::invalid_contract("Missing planned source code."))?
            };
            entries.push(json!({"entryId":step.entry_id,"sourceCode":source}));
        }
        profile["entries"] = json!(entries);
        profile["codebook"] = json!(codebook);
        if profile["entries"]
            .as_array()
            .is_none_or(|v| v.len() > 32000)
            || profile["codebook"]
                .as_array()
                .is_none_or(|v| v.len() > 11024)
        {
            return Err(CommandError::invalid_contract(
                "Master execution profile exceeds the independent P3 reader bounds.",
            ));
        }
        for key in ["recipeSha256", "variantId", "variantVersionSha256"] {
            if profile[key].as_str().is_none_or(str::is_empty) {
                return Err(CommandError::invalid_contract(
                    "Master profile is missing a required identity.",
                ));
            }
        }
        let mut message = json!({"schema":"affect-runner-master-stream-profile","version":1,
            "recipeSourceByteSha256":plan.recipe_source_byte_sha256,"planIdentitySha256":plan.plan_identity_sha256,
            "participantId":plan.participant_id,"selector":plan.selector,"runId":run_id,"attemptId":attempt_id,
            "plannedProfile":planned,"executionProfile":profile});
        message["profileSha256"] = json!(canonical_sha256(&message, &[])?);
        if canonical_json(&message, &[])?.len() > MAX_PROFILE_BYTES {
            return Err(CommandError::invalid_contract(
                "Master stream profile exceeds its 4 MiB execution bound.",
            ));
        }
        Ok(Self {
            profile_message: message,
            profile,
            run_id: run_id.into(),
            attempt_id: attempt_id.into(),
            sequence: 0,
            last_ms: 0.,
        })
    }

    pub(crate) fn observe(
        &mut self,
        event_type: MarkerEvent,
        entry_id: Option<&str>,
        execution_id: Option<&str>,
        monotonic_ms: f64,
    ) -> ResearchResult<MasterObservation> {
        if !monotonic_ms.is_finite()
            || monotonic_ms < self.last_ms
            || monotonic_ms > 9_007_199_254_740_991.
            || execution_id.is_some_and(|s| !code(s))
        {
            return Err(CommandError::invalid_contract(
                "Master observation time or occurrence is invalid.",
            ));
        }
        let session = matches!(
            event_type,
            MarkerEvent::SessionStart | MarkerEvent::Complete | MarkerEvent::Partial
        );
        if session != entry_id.is_none() || session != execution_id.is_none() {
            return Err(CommandError::invalid_contract(
                "Master observation requires its exact session/occurrence context.",
            ));
        }
        let source_code = match entry_id {
            Some(id) => Some(
                self.profile["entries"]
                    .as_array()
                    .and_then(|entries| entries.iter().find(|e| e["entryId"] == id))
                    .and_then(|entry| entry["sourceCode"].as_str())
                    .ok_or_else(|| {
                        CommandError::invalid_contract(
                            "Observation is absent from the execution profile.",
                        )
                    })?
                    .to_owned(),
            ),
            None => None,
        };
        self.sequence = self
            .sequence
            .checked_add(1)
            .filter(|s| *s <= 9_007_199_254_740_991)
            .ok_or_else(|| CommandError::invalid_contract("Master marker sequence exhausted."))?;
        self.last_ms = monotonic_ms;
        let observation = MasterObservation {
            schema: "affect-research-marker".into(),
            version: 1,
            recipe_sha256: self.profile["recipeSha256"]
                .as_str()
                .ok_or_else(|| CommandError::invalid_contract("Missing marker recipe identity."))?
                .into(),
            run_id: self.run_id.clone(),
            attempt_id: self.attempt_id.clone(),
            variant_id: self.profile["variantId"]
                .as_str()
                .ok_or_else(|| CommandError::invalid_contract("Missing marker variant identity."))?
                .into(),
            variant_version_sha256: self.profile["variantVersionSha256"]
                .as_str()
                .ok_or_else(|| CommandError::invalid_contract("Missing marker variant version."))?
                .into(),
            sequence: self.sequence,
            event_type,
            entry_id: entry_id.map(str::to_owned),
            execution_id: execution_id.map(str::to_owned),
            source_code,
            monotonic_ms,
        };
        if canonical_json(&observation, &[])?.len() > MAX_OBSERVATION_BYTES {
            return Err(CommandError::invalid_contract(
                "Master observation exceeds its bound.",
            ));
        }
        Ok(observation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_runner_master::{MasterSelector, PreparedMaster};
    #[test]
    fn master_profile_preserves_planned_sources_and_adds_unknown_duration_forms() {
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
        let mut markers = MasterMarkers::new(&prepared.plan, "run-test", "attempt-test").unwrap();
        assert_eq!(
            markers.profile_message["plannedProfile"],
            prepared.plan.selected["markerProfile"]
        );
        assert_eq!(
            markers.profile["entries"].as_array().unwrap().len(),
            prepared.plan.steps.len()
        );
        assert_eq!(
            markers.profile["codebook"]
                .as_array()
                .unwrap()
                .last()
                .unwrap()["durationMs"],
            Value::Null
        );
        assert_eq!(
            markers
                .observe(MarkerEvent::SessionStart, None, None, 0.)
                .unwrap()
                .sequence,
            1
        );
        assert_eq!(
            markers
                .observe(
                    MarkerEvent::FormStart,
                    Some("form-1"),
                    Some("execution-test"),
                    5.
                )
                .unwrap()
                .source_code
                .as_deref(),
            Some("form-source-1")
        );
        assert!(markers
            .observe(
                MarkerEvent::FormEnd,
                Some("form-1"),
                Some("execution-test"),
                4.
            )
            .is_err());
        assert!(markers
            .observe(
                MarkerEvent::Complete,
                Some("form-1"),
                Some("execution-test"),
                6.
            )
            .is_err());
        assert!(MasterMarkers::new(&prepared.plan, "participant name", "attempt-test").is_err());
    }
}

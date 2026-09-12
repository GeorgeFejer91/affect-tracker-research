use crate::research_contracts::{normalize_text, OutputSettingsV1, ResearchLslSettingsV1};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{deserialize_u32_integer, CompleteVideoPlaybackPolicyV1};
use serde::{Deserialize, Serialize};

/// Retained authored policy only. No variant allocation, media authorization,
/// native execution capability or run evidence is created by this contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerRecipePolicyV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub participant_count: u32,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub sampling_frequency_hz: u32,
    pub output: OutputSettingsV1,
    pub lsl: ResearchLslSettingsV1,
    pub playback: CompleteVideoPlaybackPolicyV1,
}

impl PlannerRecipePolicyV1 {
    pub fn validate(&self) -> ResearchResult<()> {
        if self.schema != "affect-research-planner-recipe-policy" || self.version != 1 {
            return Err(CommandError::invalid_contract(
                "Unsupported Planner recipe policy version.",
            ));
        }
        if !(1..=100_000).contains(&self.participant_count)
            || !(1..=240).contains(&self.sampling_frequency_hz)
        {
            return Err(CommandError::invalid_contract(
                "Planner participant count or sampling rate is outside its existing bound.",
            ));
        }
        if !self.output.csv && !self.output.tsv {
            return Err(CommandError::invalid_contract("Select CSV, TSV or both."));
        }
        for (value, maximum, label) in [
            (&self.lsl.state_stream, 80, "lsl.stateStream"),
            (&self.lsl.stream_type, 80, "lsl.streamType"),
            (&self.lsl.marker_stream, 80, "lsl.markerStream"),
            (&self.lsl.source_id, 120, "lsl.sourceId"),
        ] {
            if normalize_text(value, 1, maximum, label)? != *value {
                return Err(CommandError::invalid_contract(
                    "Planner policy text must be canonical.",
                ));
            }
        }
        self.playback.validate()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-policy-v1.json"
        ))
        .unwrap()
    }
    fn accepts(value: Value) -> bool {
        serde_json::from_value::<PlannerRecipePolicyV1>(value)
            .and_then(|policy| policy.validate().map_err(serde::de::Error::custom))
            .is_ok()
    }

    #[test]
    fn planner_policy_shared_fixture_retains_existing_values() {
        let source = fixture();
        let policy: PlannerRecipePolicyV1 = serde_json::from_value(source.clone()).unwrap();
        policy.validate().unwrap();
        let observed = serde_json::to_value(policy).unwrap();
        assert_eq!(
            crate::research_contracts::canonical_sha256(&observed, &[]).unwrap(),
            "c2b30a0af779d28e1ca5c753f84b36717ce10af241ab7a2837be49df6c982f21"
        );
        assert_eq!(
            crate::research_contracts::canonical_json(&observed, &[]).unwrap(),
            crate::research_contracts::canonical_json(&source, &[]).unwrap()
        );
    }

    #[test]
    fn planner_policy_rejects_unknown_missing_and_changed_meanings() {
        for field in fixture().as_object().unwrap().keys() {
            let mut value = fixture();
            value.as_object_mut().unwrap().remove(field);
            assert!(!accepts(value), "missing {field}");
        }
        for (field, replacement) in [
            ("version", json!(2)),
            ("allocate", json!("cyclic")),
            ("participantCount", json!(1.5)),
            ("participantCount", json!(100001)),
            ("samplingFrequencyHz", json!(0)),
            ("samplingFrequencyHz", json!(241)),
            ("output", json!({"csv":false,"tsv":false})),
            ("output", json!({"csv":true,"tsv":true,"json":true})),
        ] {
            let mut value = fixture();
            value[field] = replacement;
            assert!(!accepts(value), "{field}");
        }
        let mut value = fixture();
        value["playback"]["loop"] = json!(true);
        assert!(!accepts(value));
        let mut value = fixture();
        value["lsl"]["sourceId"] = json!(" trimmed ");
        assert!(!accepts(value));
    }
}

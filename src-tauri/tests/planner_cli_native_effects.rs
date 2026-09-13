//! Compile actual owner modules without changing Main's production registration.
//! Unused owner APIs are expected in this focused test crate.
#![allow(dead_code)]
#[path = "../src"]
mod owners {
    pub(crate) mod research_contracts;
    pub(crate) mod research_desktop_layout;
    pub(crate) mod research_error;
    pub(crate) mod research_experiment_package;
    pub(crate) mod research_external_protocol;
    pub(crate) mod research_feedback;
    pub(crate) mod research_form_definition;
    pub(crate) mod research_native_media;
    pub(crate) mod research_planner_cli_effects;
    pub(crate) mod research_planner_recipe;
    pub(crate) mod research_planner_recipe_file;
    pub(crate) mod research_planner_recipe_policy;
    pub(crate) mod research_planner_recipe_supported;
    pub(crate) mod research_planner_recipe_v2;
    pub(crate) mod research_planner_recipe_v3;
    pub(crate) mod research_planner_recipe_v4;
    pub(crate) mod research_planner_recipe_v5;
    pub(crate) mod research_platform;
    pub(crate) mod research_protocol;
    pub(crate) mod research_questionnaire_recipe;
    pub(crate) mod research_questionnaire_recipe_v2;
    pub(crate) mod research_shutdown;
    pub(crate) mod research_stimulus_order;
    pub(crate) mod research_surveyjs_definition;
    pub(crate) mod research_surveyjs_engine;
    pub(crate) mod research_video_geometry;
    pub(crate) mod research_workspace;
    pub(crate) mod research_workspace_contribution;
    pub(crate) mod research_xr_layout;
}
use owners::*;
mod research_runner_master {
    use super::*;
    use serde::{Deserialize, Serialize};
    use serde_json::Value;

    #[derive(Debug, Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct MasterSelector {
        pub variant_id: String,
        pub language_id: String,
        pub language_selection_path: Vec<String>,
        pub presentation_target: String,
    }

    #[derive(Debug, Clone, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct MasterPlan {
        pub schema: String,
        pub version: u32,
        pub algorithm_version: String,
        pub recipe_source_byte_sha256: String,
        pub participant_id: String,
        pub selector: MasterSelector,
        pub plan_identity_sha256: String,
        pub selected: Value,
        pub steps: Vec<Value>,
    }

    pub struct PreparedMaster {
        pub plan: MasterPlan,
    }

    impl PreparedMaster {
        pub fn read(
            _source: &str,
            participant_id: &str,
            selector: MasterSelector,
        ) -> research_error::ResearchResult<Self> {
            if participant_id != "P001" {
                return Err(research_error::CommandError::invalid_contract(
                    "Unsupported test participant.",
                ));
            }
            let selected = research_contracts::canonical_json(&selector, &[])?;
            let plans: Vec<MasterPlan> = serde_json::from_str(include_str!(
                "../../test/fixtures/planner-recipe-v5.plans.json"
            ))
            .unwrap();
            plans
                .into_iter()
                .find(|plan| {
                    research_contracts::canonical_json(&plan.selector, &[]).unwrap() == selected
                })
                .map(|plan| Self { plan })
                .ok_or_else(|| research_error::CommandError::invalid_contract("Missing test plan."))
        }
    }
}

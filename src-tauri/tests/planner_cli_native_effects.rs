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
    pub(crate) mod research_platform;
    pub(crate) mod research_protocol;
    pub(crate) mod research_questionnaire_recipe;
    pub(crate) mod research_questionnaire_recipe_v2;
    pub(crate) mod research_stimulus_order;
    pub(crate) mod research_video_geometry;
    pub(crate) mod research_workspace;
    pub(crate) mod research_workspace_contribution;
    pub(crate) mod research_xr_layout;
}
use owners::*;

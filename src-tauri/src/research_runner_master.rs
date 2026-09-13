//! Complete master consumption. The frozen package runtime/records stay separate.
//! A plan is content interpretation, never a playback or acquisition attestation.
pub(crate) mod bindings;
pub(crate) mod commands;
pub(crate) mod forms;
pub(crate) mod information;
pub(crate) mod lsl;
pub(crate) mod markers;
pub(crate) mod response;
pub mod runtime;
pub(crate) mod storage;
pub(crate) mod typed_forms;
pub(crate) mod variant_usage;
pub(crate) mod worker;
use crate::research_contracts::canonical_sha256;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe_supported::{
    parse_supported_planner_recipe_bytes, LoadedSupportedPlannerRecipe,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterSelector {
    pub variant_id: String,
    pub language_id: String,
    pub language_selection_path: Vec<String>,
    pub presentation_target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStep {
    pub position: u32,
    pub entry_id: String,
    pub kind: MasterStepKind,
    pub source_code: Option<String>,
    pub duration_ms: Option<u64>,
    /// Complete owner data: form/module/presentation, video/entry, or ISI/entry.
    pub payload: Value,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MasterStepKind {
    Questionnaire,
    Video,
    Interval,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterPlan {
    pub schema: &'static str,
    pub version: u32,
    pub algorithm_version: &'static str,
    pub recipe_source_byte_sha256: String,
    pub participant_id: String,
    pub selector: MasterSelector,
    pub plan_identity_sha256: String,
    /// Unmodified complete P7 selection, including policy, feedback and layout.
    pub selected: Value,
    pub steps: Vec<MasterStep>,
}

pub struct PreparedMaster {
    pub loaded: LoadedSupportedPlannerRecipe,
    pub plan: MasterPlan,
    pub layout: crate::research_desktop_layout::DesktopLayoutContributionV1,
    pub feedback: crate::research_feedback::FeedbackContributionV2,
}

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}

pub(crate) fn validate_master_participant(id: &str) -> ResearchResult<()> {
    let number = id
        .strip_prefix('P')
        .and_then(|s| {
            ((3..=6).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()))
                .then(|| s.parse::<u32>().ok())
                .flatten()
        })
        .filter(|n| (1..=100_000).contains(n))
        .ok_or_else(|| invalid("Select a canonical participant number."))?;
    if id != format!("P{number:03}") {
        return Err(invalid("Select a canonical participant number."));
    }
    Ok(())
}

impl PreparedMaster {
    pub fn read(
        source: &str,
        participant_id: &str,
        selector: MasterSelector,
    ) -> ResearchResult<Self> {
        validate_master_participant(participant_id)?;
        let loaded = parse_supported_planner_recipe_bytes(source.as_bytes())?;
        let selected = loaded.recipe.reconstruct_selection(&json!(selector))?;
        if loaded.recipe.presentation_target() != "desktop-screen" {
            return Err(invalid("This master requires XR presentation; desktop execution cannot substitute its desktop profile."));
        }
        let p3 = loaded.recipe.segment("P3")?;
        let layout = serde_json::from_value(loaded.recipe.segment("P4")?)
            .map_err(|_| invalid("Validated desktop layout is unavailable."))?;
        let feedback = serde_json::from_value(loaded.recipe.segment("P5")?)
            .map_err(|_| invalid("Validated feedback policy is unavailable."))?;
        let legacy_library = if p3["version"] == 1 {
            let catalogue =
                crate::research_workspace_contribution::validate_workspace_contribution(
                    &loaded.recipe.segment("P1")?,
                )?;
            Some(crate::research_stimulus_order::VideoLibrary::create(
                catalogue
                    .video_catalogue
                    .entries
                    .iter()
                    .map(|e| crate::research_stimulus_order::VideoIdentity {
                        relative_path: e.package_relative_path.clone(),
                        sha256: e.sha256.clone(),
                        byte_length: e.byte_length,
                    })
                    .collect(),
            )?)
        } else {
            None
        };
        let variant = p3["variants"]
            .as_array()
            .and_then(|variants| {
                variants
                    .iter()
                    .find(|v| v["variantId"] == selector.variant_id)
            })
            .ok_or_else(|| invalid("Choose an explicit saved variant."))?;
        let mut steps = Vec::new();
        append_forms(&mut steps, &selected, "beforeSession")?;
        for entry in array(&variant["entries"])? {
            let entry_id = string(&entry["entryId"])?;
            let source_code = array(&selected["markerProfile"]["entries"])?
                .iter()
                .find(|row| row["entryId"] == entry_id)
                .map(|row| string(&row["sourceCode"]))
                .transpose()?
                .ok_or_else(|| invalid("A selected entry has no planned marker source."))?;
            let (kind, duration, payload) = if entry["kind"] == "isi" {
                let definition = array(&p3["isiDefinitions"])?
                    .iter()
                    .find(|isi| isi["isiId"] == entry["referenceId"])
                    .ok_or_else(|| invalid("A selected interval has no saved definition."))?;
                (
                    MasterStepKind::Interval,
                    integer(&definition["durationMs"])?,
                    json!({"entry":entry,"definition":definition}),
                )
            } else {
                let asset = array(&selected["assets"])?
                    .iter()
                    .find(|asset| {
                        if p3["version"] == 2 {
                            asset["assetId"] == entry["assetId"]
                                && asset["annotationId"] == entry["referenceId"]
                        } else {
                            legacy_library.as_ref().is_some_and(|library| {
                                library.videos.iter().any(|video| {
                                    video.annotation_id == entry["referenceId"]
                                        && asset["packageRelativePath"] == video.relative_path
                                })
                            })
                        }
                    })
                    .ok_or_else(|| {
                        invalid("A selected video occurrence has no exact saved asset binding.")
                    })?;
                (
                    MasterStepKind::Video,
                    integer(&asset["durationMs"])?,
                    json!({"entry":entry,"asset":asset}),
                )
            };
            append(
                &mut steps,
                kind,
                entry_id,
                Some(source_code),
                Some(duration),
                payload,
            );
        }
        append_forms(&mut steps, &selected, "afterSession")?;
        let version = loaded.recipe.version();
        let algorithm = match version {
            1 => "master-sequence-v1",
            2 => "master-sequence-v2",
            3 => "master-sequence-v3",
            _ => return Err(invalid("Unsupported Runner master version.")),
        };
        let identity = json!({"schema":"affect-runner-master-plan","version":version,"algorithmVersion":algorithm,
            "recipeSourceByteSha256":loaded.canonical_source_byte_sha256,"participantId":participant_id,"selector":selector});
        let plan = MasterPlan {
            schema: "affect-runner-master-plan",
            version,
            algorithm_version: algorithm,
            recipe_source_byte_sha256: loaded.canonical_source_byte_sha256.clone(),
            participant_id: participant_id.into(),
            selector,
            plan_identity_sha256: canonical_sha256(&identity, &[])?,
            selected,
            steps,
        };
        Ok(Self {
            loaded,
            plan,
            layout,
            feedback,
        })
    }
}

fn append(
    steps: &mut Vec<MasterStep>,
    kind: MasterStepKind,
    entry_id: String,
    source_code: Option<String>,
    duration_ms: Option<u64>,
    payload: Value,
) {
    steps.push(MasterStep {
        position: steps.len() as u32 + 1,
        entry_id,
        kind,
        source_code,
        duration_ms,
        payload,
    });
}
fn append_forms(
    steps: &mut Vec<MasterStep>,
    selected: &Value,
    placement: &str,
) -> ResearchResult<()> {
    for row in array(&selected["questionnaires"][placement])? {
        let entry_id = format!("form-{}", steps.len() + 1);
        append(
            steps,
            MasterStepKind::Questionnaire,
            entry_id,
            None,
            None,
            row.clone(),
        );
    }
    Ok(())
}
fn array(value: &Value) -> ResearchResult<&Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| invalid("Master reconstruction contains an invalid collection."))
}
fn string(value: &Value) -> ResearchResult<String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| invalid("Master reconstruction contains an invalid identity."))
}
fn integer(value: &Value) -> ResearchResult<u64> {
    value
        .as_u64()
        .ok_or_else(|| invalid("Master reconstruction contains an invalid duration."))
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str =
        include_str!("../../test/fixtures/planner-recipe-locations-current-v1.canonical.json");
    fn selector() -> MasterSelector {
        MasterSelector {
            variant_id: "variant-3".into(),
            language_id: "en".into(),
            language_selection_path: vec!["both".into(), "en".into()],
            presentation_target: "desktop-screen".into(),
        }
    }

    #[test]
    fn v2_plan_preserves_exact_owner_selection_and_versioned_identity() {
        let source = include_str!("../../test/fixtures/runner-master-v2-owner.canonical.json");
        let selections: Vec<Value> = serde_json::from_str(include_str!(
            "../../test/fixtures/runner-master-v2-owner-selections.canonical.json"
        ))
        .unwrap();
        let mut plans = Vec::new();
        for selected in selections {
            let selector = MasterSelector {
                variant_id: selected["variant"]["variantId"].as_str().unwrap().into(),
                language_id: selected["language"]["languageId"].as_str().unwrap().into(),
                language_selection_path: serde_json::from_value(
                    selected["language"]["languageSelectionPath"].clone(),
                )
                .unwrap(),
                presentation_target: "desktop-screen".into(),
            };
            let prepared = PreparedMaster::read(source, "P001", selector).unwrap();
            assert_eq!(prepared.plan.version, 2);
            assert_eq!(prepared.plan.algorithm_version, "master-sequence-v2");
            assert_eq!(prepared.loaded.canonical_source_text, source);
            assert_eq!(
                crate::research_contracts::canonical_json(&prepared.plan.selected, &[]).unwrap(),
                crate::research_contracts::canonical_json(&selected, &[]).unwrap()
            );
            assert_eq!(
                prepared.plan.steps[0].payload["presentation"]["kind"],
                "fields"
            );
            plans.push(prepared.plan);
        }
        if let Ok(path) = std::env::var("AFFECT_RUNNER_V2_PLAN_FIXTURE") {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .unwrap();
            file.write_all(&crate::research_contracts::canonical_json(&plans, &[]).unwrap())
                .unwrap();
        }
    }
    #[test]
    fn v3_plan_preserves_exact_owner_selection_and_versioned_identity() {
        let source = include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json");
        let selections: Vec<Value> = serde_json::from_str(include_str!(
            "../../test/fixtures/runner-master-v3-owner-selections.canonical.json"
        ))
        .unwrap();
        let mut plans = Vec::new();
        for selected in selections {
            let selector = MasterSelector {
                variant_id: selected["variant"]["variantId"].as_str().unwrap().into(),
                language_id: selected["language"]["languageId"].as_str().unwrap().into(),
                language_selection_path: serde_json::from_value(
                    selected["language"]["languageSelectionPath"].clone(),
                )
                .unwrap(),
                presentation_target: "desktop-screen".into(),
            };
            let prepared = PreparedMaster::read(source, "P001", selector).unwrap();
            assert_eq!(prepared.plan.version, 3);
            assert_eq!(prepared.plan.algorithm_version, "master-sequence-v3");
            assert_eq!(prepared.loaded.canonical_source_text, source);
            assert_eq!(
                crate::research_contracts::canonical_json(&prepared.plan.selected, &[]).unwrap(),
                crate::research_contracts::canonical_json(&selected, &[]).unwrap()
            );
            assert_eq!(
                prepared.plan.steps[0].payload["presentation"]["kind"],
                "fields"
            );
            plans.push(prepared.plan);
        }
        if let Ok(path) = std::env::var("AFFECT_RUNNER_V3_PLAN_FIXTURE") {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .unwrap();
            file.write_all(&crate::research_contracts::canonical_json(&plans, &[]).unwrap())
                .unwrap();
        }
    }
    #[test]
    fn complete_master_keeps_forms_repeated_locations_and_every_interval() {
        let prepared = PreparedMaster::read(SOURCE, "P001", selector()).unwrap();
        assert_eq!(prepared.loaded.canonical_source_text, SOURCE);
        let plan = prepared.plan;
        assert_eq!(plan.steps.len(), 10);
        assert_eq!(plan.steps[0].kind, MasterStepKind::Questionnaire);
        assert_eq!(
            plan.steps[0].payload["presentation"]["repeatLabelsEvery"],
            5
        );
        assert_eq!(plan.steps[1].duration_ms, Some(0));
        assert_eq!(plan.steps[2].duration_ms, Some(500));
        assert_eq!(
            plan.steps[3].payload["asset"],
            plan.steps[4].payload["asset"]
        );
        assert_ne!(plan.steps[3].entry_id, plan.steps[4].entry_id);
        assert_eq!(plan.steps[8].duration_ms, Some(0));
        assert_eq!(plan.steps[9].kind, MasterStepKind::Questionnaire);
        assert_eq!(plan.selected["feedback"]["response"]["repeatDelayMs"], 900);
        assert_eq!(plan.selected["policy"]["samplingFrequencyHz"], 137);
    }

    #[test]
    fn master_selection_is_explicit_and_never_repairs_source() {
        let mut absent = selector();
        absent.variant_id = "".into();
        assert!(PreparedMaster::read(SOURCE, "P001", absent).is_err());
        let mut wrong_route = selector();
        wrong_route.language_id = "de".into();
        assert!(PreparedMaster::read(SOURCE, "P001", wrong_route).is_err());
        for id in ["P01", "P0001", "P000", "P100001", "../P001"] {
            assert!(PreparedMaster::read(SOURCE, id, selector()).is_err());
        }
        assert!(PreparedMaster::read(SOURCE.trim_end(), "P001", selector()).is_err());
        let p1 = PreparedMaster::read(SOURCE, "P001", selector()).unwrap();
        let p2 = PreparedMaster::read(SOURCE, "P002", selector()).unwrap();
        assert_ne!(p1.plan.plan_identity_sha256, p2.plan.plan_identity_sha256);
        assert_eq!(p1.plan.selected, p2.plan.selected); // Count is not an allocator.
        assert!(PreparedMaster::read(SOURCE, "P100000", selector()).is_ok());
    }
}

//! Compose complete owner-validated content. No media permission or runtime state.
use crate::research_contracts::{canonical_json, canonical_sha256};
use crate::research_desktop_layout::{
    DesktopLayoutContributionV1, FeedbackEnvelope, MediaGeometry,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{LanguageSelectionTargetV1, LanguageSelectionTreeV1};
use crate::research_feedback::{resolve_feedback_envelope_v2, FeedbackContributionV2};
use crate::research_questionnaire_recipe::QuestionnaireRecipeContributionV1;
use crate::research_workspace_contribution::WorkspaceContribution;
use crate::research_xr_layout::XrLayoutProfileV1;
use serde_json::{json, Value};
use std::collections::BTreeSet;

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}

pub(super) fn hash(value: &impl serde::Serialize) -> ResearchResult<String> {
    canonical_sha256(value, &[])
}

pub(super) fn exact_reencoding(value: &Value, typed: &impl serde::Serialize) -> ResearchResult<()> {
    if canonical_json(value, &[])? != canonical_json(typed, &[])? {
        return Err(invalid(
            "Recipe content cannot be defaulted, discarded or repaired.",
        ));
    }
    Ok(())
}

pub(super) fn media(workspace: &WorkspaceContribution) -> Vec<MediaGeometry> {
    let mut seen = BTreeSet::new();
    workspace
        .video_catalogue
        .entries
        .iter()
        .filter(|entry| seen.insert(&entry.asset_id))
        .map(|entry| MediaGeometry {
            asset_id: entry.asset_id.clone(),
            display_width: entry.geometry.display_width_px as f64,
            display_height: entry.geometry.display_height_px as f64,
        })
        .collect()
}

pub(super) fn desktop(
    profile: &DesktopLayoutContributionV1,
    workspace: &WorkspaceContribution,
    feedback: &FeedbackContributionV2,
) -> ResearchResult<Value> {
    profile
        .validate()
        .map_err(|code| invalid(format!("P4: {code}")))?;
    let base = profile
        .resolve_base()
        .map_err(|code| invalid(format!("P4: {code}")))?;
    let envelope = resolve_feedback_envelope_v2(feedback, base.feedback.width)?;
    let result = profile
        .resolve(
            &media(workspace),
            &FeedbackEnvelope {
                algorithm_version: &envelope.algorithm_version,
                origin: &envelope.origin,
                configuration_key: &envelope.configuration_key,
                overlay_side_css_px: envelope.overlay_side_css_px,
                half_extent_css_px: envelope.half_extent_css_px,
            },
        )
        .map_err(|code| invalid(format!("P4: {code}")))?;
    if !result.issues.is_empty() {
        return Err(invalid(format!("P4: {}", result.issues.join(", "))));
    }
    Ok(
        json!({"profile":profile,"geometry":result.geometry,"videos":result.videos,
        "issues":[],"envelope":envelope,"inputKind":"live"}),
    )
}

pub(super) fn xr(
    profile: &XrLayoutProfileV1,
    workspace: &WorkspaceContribution,
    feedback: &FeedbackContributionV2,
) -> ResearchResult<Value> {
    profile
        .validate()
        .map_err(|code| invalid(format!("P6: {code}")))?;
    let envelope = resolve_feedback_envelope_v2(feedback, 1024.)?;
    let footprint = profile
        .resolve_feedback_footprint(
            &envelope.algorithm_version,
            &envelope.origin,
            &envelope.configuration_key,
            envelope.overlay_side_css_px,
            envelope.half_extent_css_px,
        )
        .map_err(|code| invalid(format!("P6: {code}")))?;
    let videos = media(workspace)
        .iter()
        .map(|video| {
            let geometry = profile
                .resolve(Some([video.display_width, video.display_height]))
                .map_err(|code| invalid(format!("P6: {code}")))?;
            Ok(json!({"assetId":video.asset_id,"geometry":geometry}))
        })
        .collect::<ResearchResult<Vec<_>>>()?;
    if videos.is_empty() {
        return Err(invalid("P6 requires declared media."));
    }
    Ok(
        json!({"profile":profile,"requirements":{"target":"webxr-immersive-vr",
        "profileSchema":"affect-research-xr-layout","profileVersion":1,"projection":"flat-monoscopic",
        "anchor":"world-fixed-initial-head-forward"},"videos":videos,"feedback":footprint}),
    )
}

/// Count before allocating complete route/matrix projections. P2's strict tree
/// has already rejected cycles, duplicate leaves and unreachable definitions.
pub(super) fn route_count(tree: &LanguageSelectionTreeV1) -> ResearchResult<usize> {
    fn count(tree: &LanguageSelectionTreeV1, id: &str, depth: usize) -> ResearchResult<usize> {
        // Graph edges are flat JSON references. P2's established 256-node
        // acyclic-tree contract is separate from the wire nesting limit.
        if depth >= tree.nodes.len() {
            return Err(invalid(
                "Language graph traversal exceeds its validated node count.",
            ));
        }
        let node = tree
            .nodes
            .iter()
            .find(|n| n.node_id == id)
            .ok_or_else(|| invalid("Missing language node."))?;
        let mut total = 0;
        for option in &node.options {
            total += match &option.target {
                LanguageSelectionTargetV1::Node { node_id } => count(tree, node_id, depth + 1)?,
                LanguageSelectionTargetV1::Language { .. } => 1,
            };
            if total > 64 {
                return Err(invalid("Too many terminal language paths."));
            }
        }
        Ok(total)
    }
    count(tree, &tree.root_node_id, 0)
}

pub(super) fn questionnaire_routes(
    p2: &QuestionnaireRecipeContributionV1,
) -> ResearchResult<Vec<Value>> {
    use crate::research_protocol::QuestionnairePlacementV2;
    for module in &p2.questionnaires.modules {
        if !matches!(
            module.placement,
            QuestionnairePlacementV2::BeforeSession { .. }
                | QuestionnairePlacementV2::AfterSession { .. }
        ) {
            return Err(invalid("P2: variant-placement-unsupported; preserve the hook until its variant mapping is defined."));
        }
    }
    fn walk(
        p2: &QuestionnaireRecipeContributionV1,
        id: &str,
        path: &[String],
        routes: &mut Vec<Value>,
    ) -> ResearchResult<()> {
        let tree = &p2.language_selection;
        let node = tree
            .nodes
            .iter()
            .find(|n| n.node_id == id)
            .ok_or_else(|| invalid("Missing language node."))?;
        for option in &node.options {
            let mut next = path.to_vec();
            next.push(option.option_id.clone());
            match &option.target {
                LanguageSelectionTargetV1::Node { node_id } => walk(p2, node_id, &next, routes)?,
                LanguageSelectionTargetV1::Language { language_id } => {
                    let language = tree
                        .languages
                        .iter()
                        .find(|l| l.language_id == *language_id)
                        .ok_or_else(|| invalid("Missing language."))?;
                    let mut before = Vec::new();
                    let mut after = Vec::new();
                    for id in &language.questionnaire_module_ids {
                        let module = p2
                            .questionnaires
                            .modules
                            .iter()
                            .find(|m| m.module_id == *id)
                            .ok_or_else(|| invalid("Missing module."))?;
                        let definition = p2
                            .questionnaires
                            .definitions
                            .iter()
                            .find(|d| d.questionnaire_id == module.questionnaire_id)
                            .ok_or_else(|| invalid("Missing definition."))?;
                        let presentation = p2
                            .presentation
                            .definitions
                            .iter()
                            .find(|d| d.questionnaire_id == module.questionnaire_id)
                            .ok_or_else(|| invalid("Missing presentation."))?;
                        let item = json!({"module":module,"definition":definition,"presentation":presentation});
                        match module.placement {
                            QuestionnairePlacementV2::BeforeSession { .. } => before.push(item),
                            QuestionnairePlacementV2::AfterSession { .. } => after.push(item),
                            _ => {
                                return Err(invalid("Unsupported variant questionnaire placement."))
                            }
                        }
                    }
                    routes.push(json!({"languageId":language.language_id,"languageTag":language.language_tag,
                        "optionIds":next,"beforeSession":before,"afterSession":after}));
                }
            }
        }
        Ok(())
    }
    let mut routes = Vec::with_capacity(route_count(&p2.language_selection)?);
    walk(p2, &p2.language_selection.root_node_id, &[], &mut routes)?;
    Ok(routes)
}

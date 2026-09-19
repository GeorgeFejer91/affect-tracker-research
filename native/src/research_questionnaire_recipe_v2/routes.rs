use super::*;
use crate::research_experiment_package::LanguageSelectionTargetV1;
use crate::research_planner_recipe::owners::route_count;
use serde_json::json;
pub(super) fn questionnaire_routes(
    p2: &QuestionnaireRecipeContributionV2,
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
        p2: &QuestionnaireRecipeContributionV2,
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
                            .find(|d| d.questionnaire_id() == module.questionnaire_id)
                            .ok_or_else(|| invalid("Missing definition."))?;
                        let presentation = p2
                            .presentation
                            .definitions
                            .iter()
                            .find(|d| d.questionnaire_id() == module.questionnaire_id)
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

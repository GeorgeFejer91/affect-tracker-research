//! Explicit SurveyJS master boundary; historical readers retain their contracts.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe_v2::PlannerRecipeV2;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlannerRecipeV4(pub(crate) PlannerRecipeV2);
impl PlannerRecipeV4 {
    pub fn validate(&self) -> ResearchResult<()> {
        self.0.validate_version(4)
    }
    pub fn reproduce(&self) -> ResearchResult<Value> {
        self.0.reproduce_version(4)
    }
    pub fn reconstruct_selection(&self, selector: &Value) -> ResearchResult<Value> {
        self.0.reconstruct_selection_version(selector, 4)
    }
    pub fn canonical_file_bytes(&self) -> ResearchResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = crate::research_contracts::canonical_json(self, &[])?;
        bytes.push(b'\n');
        if bytes.len() > crate::research_planner_recipe::MAX_BYTES {
            return Err(CommandError::invalid_contract("Recipe exceeds 16 MiB."));
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn surveyjs_master4_matches_javascript_and_keeps_historical_readers_strict() {
        let source = include_str!("../../test/fixtures/planner-recipe-v4-surveyjs.canonical.json");
        let loaded =
            crate::research_planner_recipe_supported::parse_supported_planner_recipe_bytes(
                source.as_bytes(),
            )
            .unwrap();
        assert_eq!(loaded.recipe.version(), 4);
        let recipe: PlannerRecipeV4 = serde_json::from_str(source).unwrap();
        assert_eq!(recipe.canonical_file_bytes().unwrap(), source.as_bytes());
        let expected: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-v4-surveyjs.reproduction.json"
        ))
        .unwrap();
        assert_eq!(recipe.reproduce().unwrap(), expected);
        let selector = serde_json::json!({"variantId":"variant-1","languageId":"de","languageSelectionPath":["both","de"],"presentationTarget":"desktop-screen"});
        let selection: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-v4-surveyjs.selection.json"
        ))
        .unwrap();
        assert_eq!(
            crate::research_contracts::canonical_json(
                &loaded.recipe.reconstruct_selection(&selector).unwrap(),
                &[]
            )
            .unwrap(),
            crate::research_contracts::canonical_json(&selection, &[]).unwrap()
        );
        assert!(serde_json::from_str::<PlannerRecipeV2>(source)
            .unwrap()
            .validate()
            .is_err());
        assert!(
            serde_json::from_str::<crate::research_planner_recipe_v3::PlannerRecipeV3>(source)
                .unwrap()
                .validate()
                .is_err()
        );
        assert!(recipe.0.segments.p2.validate().is_err());
    }
}

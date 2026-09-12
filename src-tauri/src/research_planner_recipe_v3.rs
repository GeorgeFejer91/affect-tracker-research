//! Explicit master3 boundary; shared reproduction, never widening the v2 reader.
use crate::research_contracts::canonical_json;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe::MAX_BYTES;
use crate::research_planner_recipe_v2::PlannerRecipeV2;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PlannerRecipeV3(pub(crate) PlannerRecipeV2);

impl PlannerRecipeV3 {
    pub fn validate(&self) -> ResearchResult<()> { self.0.validate_version(3) }
    pub fn reproduce(&self) -> ResearchResult<Value> { self.0.reproduce_version(3) }
    pub fn reconstruct_selection(&self, selector: &Value) -> ResearchResult<Value> {
        self.0.reconstruct_selection_version(selector, 3)
    }
    pub fn canonical_file_bytes(&self) -> ResearchResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = canonical_json(self, &[])?;
        bytes.push(b'\n');
        if bytes.len() > MAX_BYTES {
            return Err(CommandError::invalid_contract("Recipe exceeds 16 MiB."));
        }
        Ok(bytes)
    }
}

//! Explicit supported-version intake; only complete validated recipes are exposed.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe::owners::exact_reencoding;
use crate::research_planner_recipe::{parse_planner_recipe_bytes, read_value, PlannerRecipeV1};
use crate::research_planner_recipe_policy::PlannerRecipePolicyV1;
use crate::research_planner_recipe_v2::PlannerRecipeV2;
use crate::research_planner_recipe_v3::PlannerRecipeV3;
use crate::research_planner_recipe_v4::PlannerRecipeV4;
use crate::research_planner_recipe_v5::{
    PlannerRecipeV5, QuestionnaireAssetSnapshot, BUNDLE_SCHEMA,
};
use serde::{Serialize, Serializer};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
// Recipe variants are bounded, compatibility-authoritative documents. Keeping
// them direct avoids adding ownership indirection to every version consumer.
#[allow(clippy::large_enum_variant)]
pub enum SupportedPlannerRecipe {
    V1(PlannerRecipeV1),
    V2(PlannerRecipeV2),
    V3(PlannerRecipeV3),
    V4(PlannerRecipeV4),
    V5(PlannerRecipeV5),
}
impl Serialize for SupportedPlannerRecipe {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::V1(value) => value.serialize(serializer),
            Self::V2(value) => value.serialize(serializer),
            Self::V3(value) => value.serialize(serializer),
            Self::V4(value) => value.serialize(serializer),
            Self::V5(value) => value.serialize(serializer),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSupportedPlannerRecipe {
    pub recipe: SupportedPlannerRecipe,
    pub canonical_source_text: String,
    pub canonical_source_byte_sha256: String,
}
impl LoadedSupportedPlannerRecipe {
    pub fn transport_text(&self) -> ResearchResult<String> {
        match &self.recipe {
            SupportedPlannerRecipe::V5(r) => r.bundle_text(&self.canonical_source_text),
            _ => Ok(self.canonical_source_text.clone()),
        }
    }
    pub fn wire_document(&self) -> ResearchResult<Value> {
        let mut value = serde_json::to_value(self)
            .map_err(|_| CommandError::invalid_contract("Invalid recipe document."))?;
        if let SupportedPlannerRecipe::V5(r) = &self.recipe {
            value["questionnaireAssets"] = serde_json::json!(r.assets);
            value["resolvedRecipe"] = serde_json::json!(r.content);
        }
        Ok(value)
    }
}
impl SupportedPlannerRecipe {
    pub fn version(&self) -> u32 {
        match self {
            Self::V1(r) => r.version,
            Self::V2(r) => r.version,
            Self::V3(r) => r.0.version,
            Self::V4(r) => r.0.version,
            Self::V5(_) => 5,
        }
    }
    pub fn recipe_id(&self) -> &str {
        match self {
            Self::V1(r) => &r.recipe_id,
            Self::V2(r) => &r.recipe_id,
            Self::V3(r) => &r.0.recipe_id,
            Self::V4(r) => &r.0.recipe_id,
            Self::V5(r) => &r.manifest.recipe_id,
        }
    }
    pub fn presentation_target(&self) -> &str {
        match self {
            Self::V1(r) => &r.presentation_target,
            Self::V2(r) => &r.presentation_target,
            Self::V3(r) => &r.0.presentation_target,
            Self::V4(r) => &r.0.presentation_target,
            Self::V5(r) => &r.manifest.presentation_target,
        }
    }
    pub fn definition_sha256(&self) -> &str {
        match self {
            Self::V1(r) => &r.integrity.definition_sha256,
            Self::V2(r) => &r.integrity.definition_sha256,
            Self::V3(r) => &r.0.integrity.definition_sha256,
            Self::V4(r) => &r.0.integrity.definition_sha256,
            Self::V5(r) => &r.manifest.integrity.definition_sha256,
        }
    }
    pub fn policy(&self) -> &PlannerRecipePolicyV1 {
        match self {
            Self::V1(r) => &r.policy,
            Self::V2(r) => &r.policy,
            Self::V3(r) => &r.0.policy,
            Self::V4(r) => &r.0.policy,
            Self::V5(r) => &r.manifest.policy,
        }
    }
    pub fn segment(&self, id: &str) -> ResearchResult<Value> {
        macro_rules! segment {
            ($r:expr) => {
                match id {
                    "P1" => Ok($r.segments.p1.clone()),
                    "P2" => serde_json::to_value(&$r.segments.p2),
                    "P3" => Ok($r.segments.p3.clone()),
                    "P4" => serde_json::to_value(&$r.segments.p4),
                    "P5" => serde_json::to_value(&$r.segments.p5),
                    "P6" => serde_json::to_value(&$r.segments.p6),
                    _ => return Err(CommandError::invalid_contract("Unknown Planner segment.")),
                }
            };
        }
        match self {
            Self::V1(r) => segment!(r),
            Self::V2(r) => segment!(r),
            Self::V3(r) => segment!(r.0),
            Self::V4(r) => segment!(r.0),
            Self::V5(r) => segment!(r.content.0),
        }
        .map_err(|_| CommandError::invalid_contract("Invalid Planner owner projection."))
    }
    pub fn reconstruct_selection(&self, selector: &Value) -> ResearchResult<Value> {
        match self {
            Self::V1(r) => r.reconstruct_selection(selector),
            Self::V2(r) => r.reconstruct_selection(selector),
            Self::V3(r) => r.reconstruct_selection(selector),
            Self::V4(r) => r.reconstruct_selection(selector),
            Self::V5(r) => r.content.reconstruct_selection(selector),
        }
    }
}
pub fn parse_supported_planner_recipe_bytes(
    bytes: &[u8],
) -> ResearchResult<LoadedSupportedPlannerRecipe> {
    let value = read_value(bytes)?; // Existing byte/depth/canonical/duplicate-key gate.
    if value["schema"] == BUNDLE_SCHEMA {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Bundle {
            schema: String,
            version: u32,
            recipe_source_text: String,
            questionnaire_assets: Vec<QuestionnaireAssetSnapshot>,
        }
        let bundle: Bundle = serde_json::from_value(value).map_err(|_| {
            CommandError::invalid_contract("Invalid questionnaire asset transport.")
        })?;
        if bundle.schema != BUNDLE_SCHEMA || bundle.version != 1 {
            return Err(CommandError::invalid_contract(
                "Unsupported questionnaire asset transport.",
            ));
        }
        return parse_planner_recipe_asset_bytes(
            bundle.recipe_source_text.as_bytes(),
            bundle.questionnaire_assets,
        );
    }
    if value["schema"] != "affect-research-planner-recipe" {
        return Err(CommandError::invalid_contract(
            "Unsupported Planner recipe schema.",
        ));
    }
    let recipe = match value["version"].as_u64() {
        Some(1) => SupportedPlannerRecipe::V1(parse_planner_recipe_bytes(bytes)?.recipe),
        Some(2) => {
            let recipe: PlannerRecipeV2 = serde_json::from_value(value.clone())
                .map_err(|_| CommandError::invalid_contract("Invalid Planner v2 fields."))?;
            exact_reencoding(&value, &recipe)?;
            recipe.validate()?;
            SupportedPlannerRecipe::V2(recipe)
        }
        Some(3) => {
            let recipe: PlannerRecipeV3 = serde_json::from_value(value.clone())
                .map_err(|_| CommandError::invalid_contract("Invalid Planner v3 fields."))?;
            exact_reencoding(&value, &recipe)?;
            recipe.validate()?;
            SupportedPlannerRecipe::V3(recipe)
        }
        Some(4) => {
            let recipe: PlannerRecipeV4 = serde_json::from_value(value.clone())
                .map_err(|_| CommandError::invalid_contract("Invalid Planner v4 fields."))?;
            exact_reencoding(&value, &recipe)?;
            recipe.validate()?;
            SupportedPlannerRecipe::V4(recipe)
        }
        _ => {
            return Err(CommandError::invalid_contract(
                "Unsupported Planner recipe version.",
            ))
        }
    };
    Ok(LoadedSupportedPlannerRecipe {
        recipe,
        canonical_source_text: String::from_utf8(bytes.to_vec())
            .map_err(|_| CommandError::invalid_contract("Invalid UTF-8."))?,
        canonical_source_byte_sha256: format!("{:x}", Sha256::digest(bytes)),
    })
}

pub fn parse_planner_recipe_asset_bytes(
    bytes: &[u8],
    assets: Vec<QuestionnaireAssetSnapshot>,
) -> ResearchResult<LoadedSupportedPlannerRecipe> {
    let recipe = PlannerRecipeV5::read(bytes, assets)?;
    Ok(LoadedSupportedPlannerRecipe {
        recipe: SupportedPlannerRecipe::V5(recipe),
        canonical_source_text: String::from_utf8(bytes.to_vec())
            .map_err(|_| CommandError::invalid_contract("Invalid UTF-8."))?,
        canonical_source_byte_sha256: format!("{:x}", Sha256::digest(bytes)),
    })
}

//! Master6 adds an explicit acquisition window while retaining the exact
//! master4 questionnaire content behind the portable asset manifest.
use crate::research_contracts::{canonical_json, canonical_sha256};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe::{read_value, RecipeIntegrityV1};
use crate::research_planner_recipe_policy::{PlannerRecipePolicyV1, PlannerRecipePolicyV2};
use crate::research_planner_recipe_v4::PlannerRecipeV4;
use crate::research_planner_recipe_v5::{QuestionnaireAssetReference, QuestionnaireAssetSnapshot};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

const SEGMENTS: [&str; 6] = ["P1", "P2", "P3", "P4", "P5", "P6"];

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}

fn exact(value: &Value, fields: &[&str]) -> ResearchResult<()> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Expected a closed questionnaire manifest object."))?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
        return Err(invalid(
            "Questionnaire manifest contains missing or unknown fields.",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerAssetManifestV6 {
    pub schema: String,
    pub version: u32,
    pub recipe_id: String,
    pub presentation_target: String,
    pub policy: PlannerRecipePolicyV2,
    pub segments: Value,
    pub content_integrity: RecipeIntegrityV1,
    pub integrity: RecipeIntegrityV1,
}

#[derive(Debug, Clone)]
pub struct PlannerRecipeV6 {
    pub manifest: PlannerAssetManifestV6,
    pub content: PlannerRecipeV4,
    pub assets: Vec<QuestionnaireAssetSnapshot>,
    pub base_policy: PlannerRecipePolicyV1,
}

impl Serialize for PlannerRecipeV6 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.manifest.serialize(serializer)
    }
}

impl PlannerAssetManifestV6 {
    pub fn read(bytes: &[u8]) -> ResearchResult<Self> {
        let value = read_value(bytes)?;
        let result: Self = serde_json::from_value(value.clone())
            .map_err(|_| invalid("Invalid master6 questionnaire manifest fields."))?;
        crate::research_planner_recipe::owners::exact_reencoding(&value, &result)?;
        result.references()?;
        Ok(result)
    }

    pub fn references(&self) -> ResearchResult<Vec<QuestionnaireAssetReference>> {
        self.policy.validate()?;
        if self.schema != "affect-research-planner-recipe"
            || self.version != 6
            || self.integrity.algorithm_version != "planner-questionnaire-assets-v2"
            || canonical_sha256(self, &["integrity"])? != self.integrity.definition_sha256
            || self.integrity.reproduction_sha256 != self.content_integrity.reproduction_sha256
        {
            return Err(invalid(
                "Master6 questionnaire manifest integrity mismatch.",
            ));
        }
        exact(&self.segments, &SEGMENTS)?;
        let hashes = serde_json::to_value(&self.integrity.segment_sha256)
            .map_err(|_| invalid("Invalid segment hashes."))?;
        for segment in SEGMENTS {
            if hashes[segment].as_str() != Some(&canonical_sha256(&self.segments[segment], &[])?) {
                return Err(invalid("Questionnaire manifest segment hash mismatch."));
            }
        }
        let p2 = &self.segments["P2"];
        exact(
            p2,
            &[
                "schema",
                "version",
                "questionnaires",
                "languageSelection",
                "presentation",
            ],
        )?;
        exact(
            &p2["questionnaires"],
            &["algorithmVersion", "assets", "modules"],
        )?;
        if p2["schema"] != "affect-research-questionnaire-recipe-contribution"
            || p2["version"] != 4
            || p2["questionnaires"]["algorithmVersion"] != "questionnaire-asset-hooks-v1"
        {
            return Err(invalid("Unsupported questionnaire asset contribution."));
        }
        let refs: Vec<QuestionnaireAssetReference> =
            serde_json::from_value(p2["questionnaires"]["assets"].clone())
                .map_err(|_| invalid("Invalid questionnaire asset registry."))?;
        let mut paths = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for entry in &refs {
            entry.validate()?;
            if !paths.insert(&entry.relative_path) || !ids.insert(&entry.questionnaire_id) {
                return Err(invalid("Duplicate questionnaire asset path or ID."));
            }
        }
        Ok(refs)
    }
}

impl PlannerRecipeV6 {
    pub fn read(bytes: &[u8], assets: Vec<QuestionnaireAssetSnapshot>) -> ResearchResult<Self> {
        let manifest = PlannerAssetManifestV6::read(bytes)?;
        let refs = manifest.references()?;
        if refs.len() != assets.len() {
            return Err(invalid(
                "Load every declared questionnaire asset before opening this experiment.",
            ));
        }
        let mut definitions = Vec::new();
        for (entry, snapshot) in refs.iter().zip(&assets) {
            if snapshot.relative_path != entry.relative_path
                || snapshot.source_text.len() as u64 != entry.byte_length
                || format!("{:x}", Sha256::digest(snapshot.source_text.as_bytes())) != entry.sha256
            {
                return Err(invalid(
                    "Questionnaire asset is missing, changed, or out of order.",
                ));
            }
            let data = read_value(snapshot.source_text.as_bytes())?;
            let definition = if entry.format == "surveyjs" {
                let mut value = entry.metadata.clone();
                value["surveyJson"] = data;
                value
            } else {
                data
            };
            if definition["questionnaireId"] != entry.questionnaire_id
                || definition["language"] != entry.language
                || definition["definitionSha256"] != entry.definition_sha256
            {
                return Err(invalid(
                    "Questionnaire reference and definition identity differ.",
                ));
            }
            definitions.push(definition);
        }
        let base_policy = manifest.policy.legacy();
        let mut resolved =
            serde_json::to_value(&manifest).map_err(|_| invalid("Invalid manifest."))?;
        resolved
            .as_object_mut()
            .ok_or_else(|| invalid("Invalid manifest."))?
            .remove("contentIntegrity");
        resolved["version"] = json!(4);
        resolved["policy"] = serde_json::to_value(&base_policy)
            .map_err(|_| invalid("Invalid acquisition policy projection."))?;
        resolved["integrity"] = json!(manifest.content_integrity);
        resolved["segments"]["P2"]["version"] = json!(3);
        let modules = resolved["segments"]["P2"]["questionnaires"]["modules"].clone();
        resolved["segments"]["P2"]["questionnaires"] = json!({
            "algorithmVersion":"questionnaire-hooks-v4",
            "definitions":definitions,
            "modules":modules
        });
        let content: PlannerRecipeV4 = serde_json::from_value(resolved.clone())
            .map_err(|_| invalid("Invalid resolved questionnaire content."))?;
        crate::research_planner_recipe::owners::exact_reencoding(&resolved, &content)?;
        content.validate()?;
        Ok(Self {
            manifest,
            content,
            assets,
            base_policy,
        })
    }

    pub fn reconstruct_selection(&self, selector: &Value) -> ResearchResult<Value> {
        let mut selected = self.content.reconstruct_selection(selector)?;
        selected["policy"] = serde_json::to_value(&self.manifest.policy)
            .map_err(|_| invalid("Invalid master6 policy projection."))?;
        Ok(selected)
    }

    pub fn bundle_text(&self, source: &str) -> ResearchResult<String> {
        let mut bytes = canonical_json(
            &json!({"schema":crate::research_planner_recipe_v5::BUNDLE_SCHEMA,"version":1,"recipeSourceText":source,"questionnaireAssets":self.assets}),
            &[],
        )?;
        bytes.push(b'\n');
        String::from_utf8(bytes).map_err(|_| invalid("Invalid UTF-8."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_planner_recipe_supported::{
        parse_supported_planner_recipe_bytes, SupportedPlannerRecipe,
    };

    #[test]
    fn master6_preserves_manifest_assets_and_adds_only_explicit_acquisition_policy() {
        let loaded = parse_supported_planner_recipe_bytes(include_bytes!(
            "../../test/fixtures/planner-recipe-v5.bundle.json"
        ))
        .unwrap();
        let recipe = match loaded.recipe {
            SupportedPlannerRecipe::V5(recipe) => recipe,
            _ => panic!("expected master5 fixture"),
        };
        let mut manifest = serde_json::to_value(&recipe.manifest).unwrap();
        manifest["version"] = json!(6);
        manifest["policy"]["version"] = json!(2);
        manifest["policy"]["acquisitionWindow"] = json!("fullAttempt");
        manifest["integrity"]["algorithmVersion"] = json!("planner-questionnaire-assets-v2");
        manifest["integrity"]["definitionSha256"] =
            json!(canonical_sha256(&manifest, &["integrity"]).unwrap());
        let mut bytes = canonical_json(&manifest, &[]).unwrap();
        bytes.push(b'\n');
        let parsed = PlannerRecipeV6::read(&bytes, recipe.assets.clone()).unwrap();
        assert_eq!(
            parsed.manifest.policy.acquisition_window,
            crate::research_planner_recipe_policy::AcquisitionWindowV1::FullAttempt
        );
        assert_eq!(parsed.base_policy, parsed.manifest.policy.legacy());
        assert_eq!(
            serde_json::to_value(&parsed.content.0.segments.p2.questionnaires).unwrap(),
            serde_json::to_value(&recipe.content.0.segments.p2.questionnaires).unwrap()
        );
        let plans: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-v5.plans.json"
        ))
        .unwrap();
        let selected = parsed.reconstruct_selection(&plans[0]["selector"]).unwrap();
        assert_eq!(selected["policy"]["version"], 2);
        assert_eq!(selected["policy"]["acquisitionWindow"], "fullAttempt");
    }
}

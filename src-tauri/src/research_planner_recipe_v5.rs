//! Portable questionnaire manifest. Its contentIntegrity binds the unchanged
//! master4 semantic projection; the manifest hash binds paths and exact assets.
use crate::research_contracts::{canonical_json, canonical_sha256, validate_sha256};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe::{read_value, RecipeIntegrityV1};
use crate::research_planner_recipe_policy::PlannerRecipePolicyV1;
use crate::research_planner_recipe_v4::PlannerRecipeV4;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const BUNDLE_SCHEMA: &str = "affect-research-planner-asset-bundle";
const SEGMENTS: [&str; 6] = ["P1", "P2", "P3", "P4", "P5", "P6"];
fn invalid(message: &str) -> CommandError { CommandError::invalid_contract(message) }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireAssetSnapshot { pub relative_path: String, pub source_text: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireAssetReference {
    pub questionnaire_id: String, pub language: String, pub definition_sha256: String,
    pub format: String, pub relative_path: String, pub sha256: String, pub byte_length: u64,
    pub metadata: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_planner_recipe_supported::parse_supported_planner_recipe_bytes as parse;
    const BUNDLE: &str = include_str!("../../test/fixtures/planner-recipe-v5.bundle.json");
    const MANIFEST: &str = include_str!("../../test/fixtures/planner-recipe-v5.canonical.json");

    #[test]
    fn manifest5_matches_js_content_and_every_variant_language_plan() {
        let loaded = parse(BUNDLE.as_bytes()).unwrap();
        assert_eq!(loaded.recipe.version(), 5);
        assert_eq!(loaded.canonical_source_text, MANIFEST);
        assert_eq!(loaded.transport_text().unwrap(), BUNDLE);
        let old = parse(include_bytes!("../../test/fixtures/planner-recipe-v4-surveyjs.canonical.json")).unwrap();
        let old_source = old.canonical_source_text.clone();
        assert_eq!(loaded.wire_document().unwrap()["resolvedRecipe"], serde_json::to_value(&old.recipe).unwrap());
        let expected: Value = serde_json::from_str(include_str!("../../test/fixtures/planner-recipe-v5.plans.json")).unwrap();
        for case in expected.as_array().unwrap() {
            let selector = case["selector"].clone();
            assert_eq!(loaded.recipe.reconstruct_selection(&selector).unwrap(), old.recipe.reconstruct_selection(&selector).unwrap());
            let prepared = crate::research_runner_master::PreparedMaster::read(BUNDLE, "P001", serde_json::from_value(selector.clone()).unwrap()).unwrap();
            assert_eq!(canonical_json(&prepared.plan, &[]).unwrap(), canonical_json(case, &[]).unwrap());
            let historical = crate::research_runner_master::PreparedMaster::read(&old_source, "P001", serde_json::from_value(selector).unwrap()).unwrap();
            assert_eq!(canonical_json(&prepared.plan.steps, &[]).unwrap(), canonical_json(&historical.plan.steps, &[]).unwrap());
        }
        assert!(parse(MANIFEST.as_bytes()).is_err());
        assert!(serde_json::from_str::<PlannerRecipeV4>(MANIFEST).is_err());
    }

    #[test]
    fn manifest5_rejects_changed_missing_reordered_extra_or_unsafe_assets() {
        let bundle: Value = serde_json::from_str(BUNDLE).unwrap();
        let assets: Vec<QuestionnaireAssetSnapshot> = serde_json::from_value(bundle["questionnaireAssets"].clone()).unwrap();
        let mut changed = assets.clone(); changed[0].source_text.push(' ');
        let mut reversed = assets.clone(); reversed.reverse();
        let mut extra = assets.clone(); extra.push(assets[0].clone());
        for snapshots in [changed, reversed, extra, assets[1..].to_vec()] {
            assert!(PlannerRecipeV5::read(MANIFEST.as_bytes(), snapshots).is_err());
        }
        for path in ["../survey.json", "C:/survey.json", "/survey.json", "https://example.com/survey.json"] {
            let mut reference = PlannerAssetManifestV5::read(MANIFEST.as_bytes()).unwrap().references().unwrap().remove(0);
            reference.relative_path = path.into();
            assert!(reference.validate().is_err());
        }
        let mut extra_field = bundle; extra_field["unexpected"] = json!(true);
        assert!(parse(&canonical_json(&extra_field, &[]).unwrap()).is_err());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerAssetManifestV5 {
    pub schema: String, pub version: u32, pub recipe_id: String, pub presentation_target: String,
    pub policy: PlannerRecipePolicyV1, pub segments: Value,
    pub content_integrity: RecipeIntegrityV1, pub integrity: RecipeIntegrityV1,
}
#[derive(Debug, Clone)]
pub struct PlannerRecipeV5 {
    pub manifest: PlannerAssetManifestV5,
    pub content: PlannerRecipeV4,
    pub assets: Vec<QuestionnaireAssetSnapshot>,
}
impl Serialize for PlannerRecipeV5 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> { self.manifest.serialize(serializer) }
}

fn exact(value: &Value, fields: &[&str]) -> ResearchResult<()> {
    let object = value.as_object().ok_or_else(|| invalid("Expected a closed questionnaire manifest object."))?;
    if object.len() != fields.len() || fields.iter().any(|f| !object.contains_key(*f)) { return Err(invalid("Questionnaire manifest contains missing or unknown fields.")); }
    Ok(())
}
impl QuestionnaireAssetReference {
    pub fn validate(&self) -> ResearchResult<()> {
        validate_sha256(&self.sha256, "questionnaire file hash")?;
        validate_sha256(&self.definition_sha256, "questionnaire definition hash")?;
        let id = self.questionnaire_id.as_bytes();
        let language: Vec<_> = self.language.split('-').collect();
        if id.is_empty() || id.len() > 128 || !id[0].is_ascii_alphanumeric()
            || !id.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_')
            || language.is_empty() || !(2..=8).contains(&language[0].len()) || !language[0].bytes().all(|b| b.is_ascii_alphabetic())
            || language[1..].iter().any(|s| s.is_empty() || s.len() > 8 || !s.bytes().all(|b| b.is_ascii_alphanumeric()))
            || self.byte_length == 0 {
            return Err(invalid("Invalid questionnaire asset identity or size."));
        }
        let suffix = match self.format.as_str() {
            "surveyjs" => {
                exact(&self.metadata, &["schema", "version", "questionnaireId", "questionnaireVersion", "title", "language", "engineVersion", "completionPolicy", "source", "definitionSha256"])?;
                if self.metadata["schema"] != "affect-research-surveyjs-definition" || self.metadata["version"] != 1 { return Err(invalid("Unsupported SurveyJS asset metadata.")); }
                "survey"
            }
            "questionnaire-definition" if self.metadata.is_null() => "definition",
            _ => return Err(invalid("Unsupported questionnaire asset format or metadata.")),
        };
        let path = format!("assets/questionnaires/{}/{}/{}.{}.json", self.questionnaire_id.to_ascii_lowercase(), self.language.to_ascii_lowercase(), self.sha256, suffix);
        if self.relative_path != path { return Err(invalid("Questionnaire assets require an exact portable content-addressed path.")); }
        Ok(())
    }
}

impl PlannerAssetManifestV5 {
    pub fn read(bytes: &[u8]) -> ResearchResult<Self> {
        let value = read_value(bytes)?;
        let result: Self = serde_json::from_value(value.clone()).map_err(|_| invalid("Invalid questionnaire manifest fields."))?;
        crate::research_planner_recipe::owners::exact_reencoding(&value, &result)?;
        result.references()?;
        Ok(result)
    }
    /// Validate manifest identity and all paths before filesystem traversal.
    pub fn references(&self) -> ResearchResult<Vec<QuestionnaireAssetReference>> {
        if self.schema != "affect-research-planner-recipe" || self.version != 5
            || self.integrity.algorithm_version != "planner-questionnaire-assets-v1"
            || canonical_sha256(self, &["integrity"])? != self.integrity.definition_sha256
            || self.integrity.reproduction_sha256 != self.content_integrity.reproduction_sha256 {
            return Err(invalid("Questionnaire manifest integrity mismatch."));
        }
        exact(&self.segments, &SEGMENTS)?;
        let hashes = serde_json::to_value(&self.integrity.segment_sha256).map_err(|_| invalid("Invalid segment hashes."))?;
        for segment in SEGMENTS {
            if hashes[segment].as_str() != Some(&canonical_sha256(&self.segments[segment], &[])?) { return Err(invalid("Questionnaire manifest segment hash mismatch.")); }
        }
        let p2 = &self.segments["P2"];
        exact(p2, &["schema", "version", "questionnaires", "languageSelection", "presentation"])?;
        exact(&p2["questionnaires"], &["algorithmVersion", "assets", "modules"])?;
        if p2["schema"] != "affect-research-questionnaire-recipe-contribution" || p2["version"] != 4
            || p2["questionnaires"]["algorithmVersion"] != "questionnaire-asset-hooks-v1" { return Err(invalid("Unsupported questionnaire asset contribution.")); }
        let refs: Vec<QuestionnaireAssetReference> = serde_json::from_value(p2["questionnaires"]["assets"].clone()).map_err(|_| invalid("Invalid questionnaire asset registry."))?;
        let mut paths = BTreeSet::new(); let mut ids = BTreeSet::new();
        for entry in &refs {
            entry.validate()?;
            if !paths.insert(&entry.relative_path) || !ids.insert(&entry.questionnaire_id) { return Err(invalid("Duplicate questionnaire asset path or ID.")); }
        }
        Ok(refs)
    }
}

impl PlannerRecipeV5 {
    pub fn read(bytes: &[u8], assets: Vec<QuestionnaireAssetSnapshot>) -> ResearchResult<Self> {
        let manifest = PlannerAssetManifestV5::read(bytes)?;
        let refs = manifest.references()?;
        if refs.len() != assets.len() { return Err(invalid("Load every declared questionnaire asset before opening the experiment.")); }
        let mut definitions = Vec::new();
        for (entry, snapshot) in refs.iter().zip(&assets) {
            if snapshot.relative_path != entry.relative_path || snapshot.source_text.len() as u64 != entry.byte_length
                || format!("{:x}", Sha256::digest(snapshot.source_text.as_bytes())) != entry.sha256 {
                return Err(invalid("Questionnaire asset is missing, changed, or out of order."));
            }
            let data = read_value(snapshot.source_text.as_bytes())?;
            let definition = if entry.format == "surveyjs" {
                let mut value = entry.metadata.clone(); value["surveyJson"] = data; value
            } else { data };
            if definition["questionnaireId"] != entry.questionnaire_id || definition["language"] != entry.language
                || definition["definitionSha256"] != entry.definition_sha256 { return Err(invalid("Questionnaire reference and definition identity differ.")); }
            definitions.push(definition);
        }
        let mut resolved = serde_json::to_value(&manifest).map_err(|_| invalid("Invalid manifest."))?;
        resolved.as_object_mut().ok_or_else(|| invalid("Invalid manifest."))?.remove("contentIntegrity");
        resolved["version"] = json!(4); resolved["integrity"] = json!(manifest.content_integrity);
        resolved["segments"]["P2"]["version"] = json!(3);
        let modules = resolved["segments"]["P2"]["questionnaires"]["modules"].clone();
        resolved["segments"]["P2"]["questionnaires"] = json!({"algorithmVersion":"questionnaire-hooks-v4", "definitions":definitions,"modules":modules});
        let content: PlannerRecipeV4 = serde_json::from_value(resolved.clone()).map_err(|_| invalid("Invalid resolved questionnaire content."))?;
        crate::research_planner_recipe::owners::exact_reencoding(&resolved, &content)?;
        content.validate()?;
        Ok(Self { manifest, content, assets })
    }
    pub fn bundle_text(&self, source: &str) -> ResearchResult<String> {
        let mut bytes = canonical_json(&json!({"schema":BUNDLE_SCHEMA,"version":1,"recipeSourceText":source,"questionnaireAssets":self.assets}), &[])?;
        bytes.push(b'\n');
        String::from_utf8(bytes).map_err(|_| invalid("Invalid UTF-8."))
    }
}

//! Complete Planner master. Independent Rust validation and reconstruction;
//! content validity never restores media authority or establishes Runner support.
mod owners;
use crate::research_contracts::{canonical_json, validate_sha256};
use crate::research_desktop_layout::DesktopLayoutContributionV1;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_feedback::FeedbackContributionV2;
use crate::research_planner_recipe_policy::PlannerRecipePolicyV1;
use crate::research_questionnaire_recipe::QuestionnaireRecipeContributionV1;
use crate::research_workspace_contribution::validate_workspace_contribution;
use crate::research_xr_layout::XrLayoutProfileV1;
use owners::{exact_reencoding, hash};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const SCHEMA: &str = "affect-research-planner-recipe";
pub const ALGORITHM: &str = "planner-recipe-reproduction-v2";
const LEGACY_ALGORITHM: &str = "planner-recipe-reproduction-v1";
pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_DEPTH: usize = 64;
pub const MAX_CASES: usize = 25_000;
const SEGMENTS: [&str; 6] = ["P1", "P2", "P3", "P4", "P5", "P6"];

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> ResearchResult<T> {
    serde_json::from_value(value)
        .map_err(|_| invalid("Recipe contains missing, unknown or invalid fields."))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerRecipeV1 {
    pub schema: String,
    pub version: u32,
    pub recipe_id: String,
    pub presentation_target: String,
    pub policy: PlannerRecipePolicyV1,
    pub segments: RecipeSegmentsV1,
    pub integrity: RecipeIntegrityV1,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeSegmentsV1 {
    #[serde(rename = "P1")]
    pub p1: Value,
    #[serde(rename = "P2")]
    pub p2: QuestionnaireRecipeContributionV1,
    #[serde(rename = "P3")]
    pub p3: Value,
    #[serde(rename = "P4")]
    pub p4: DesktopLayoutContributionV1,
    #[serde(rename = "P5")]
    pub p5: FeedbackContributionV2,
    #[serde(rename = "P6")]
    pub p6: XrSelectionV1,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase", deny_unknown_fields)]
pub enum XrSelectionV1 {
    Excluded,
    Included { profile: Box<XrLayoutProfileV1> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeIntegrityV1 {
    pub algorithm_version: String,
    pub definition_sha256: String,
    pub segment_sha256: SegmentHashes,
    pub reproduction_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentHashes {
    #[serde(rename = "P1")]
    pub p1: String,
    #[serde(rename = "P2")]
    pub p2: String,
    #[serde(rename = "P3")]
    pub p3: String,
    #[serde(rename = "P4")]
    pub p4: String,
    #[serde(rename = "P5")]
    pub p5: String,
    #[serde(rename = "P6")]
    pub p6: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPlannerRecipe {
    pub recipe: PlannerRecipeV1,
    pub canonical_source_text: String,
    pub canonical_source_byte_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedPlannerRecipeReceipt {
    pub schema: String,
    pub version: u32,
    pub recipe_id: String,
    pub definition_sha256: String,
    pub canonical_source_byte_sha256: String,
    pub byte_length: u64,
}

struct Prepared {
    routes: Vec<Value>,
    variants: Vec<Value>,
    presentations: Vec<Value>,
    matrix: Value,
}

impl PlannerRecipeV1 {
    fn prepare(&self) -> ResearchResult<Prepared> {
        if self.schema != SCHEMA
            || self.version != 1
            || ![ALGORITHM, LEGACY_ALGORITHM].contains(&self.integrity.algorithm_version.as_str())
        {
            return Err(invalid("Unsupported Planner recipe schema or algorithm."));
        }
        let id = self.recipe_id.as_bytes();
        if id.is_empty()
            || id.len() > 128
            || !id[0].is_ascii_alphanumeric()
            || id.iter().any(|b| {
                !(b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_' || *b == b'-')
            })
        {
            return Err(invalid(
                "Recipe ID requires 1–128 lowercase identifier characters.",
            ));
        }
        if !["desktop-screen", "webxr-immersive-vr"].contains(&self.presentation_target.as_str())
            || matches!(self.segments.p6, XrSelectionV1::Included { .. })
                != (self.presentation_target == "webxr-immersive-vr")
        {
            return Err(invalid(
                "P6 inclusion must match the explicit presentation target.",
            ));
        }
        self.policy.validate()?;
        self.segments.p2.validate()?;
        self.segments.p5.validate()?;
        let workspace = validate_workspace_contribution(&self.segments.p1)?;
        let route_count = owners::route_count(&self.segments.p2.language_selection)?;
        let variant_count = self
            .segments
            .p3
            .get("variants")
            .and_then(Value::as_array)
            .map(Vec::len)
            .ok_or_else(|| invalid("P3 variants are required."))?;
        let presentation_count = if matches!(self.segments.p6, XrSelectionV1::Included { .. }) {
            2
        } else {
            1
        };
        let case_count = route_count * variant_count * presentation_count;
        if !(1..=64).contains(&variant_count) || route_count == 0 || case_count > MAX_CASES {
            return Err(invalid(
                "Variant × language path × presentation matrix exceeds recipe bounds.",
            ));
        }
        let definition_hash = crate::research_contracts::canonical_sha256(self, &["integrity"])?;
        validate_sha256(&self.integrity.definition_sha256, "recipe definition hash")?;
        validate_sha256(
            &self.integrity.reproduction_sha256,
            "recipe reproduction hash",
        )?;
        if definition_hash != self.integrity.definition_sha256 {
            return Err(invalid(
                "Recipe definition hash does not match saved content.",
            ));
        }
        let segments = serde_json::to_value(&self.segments)
            .map_err(|_| invalid("Invalid recipe segments."))?;
        let hashes = serde_json::to_value(&self.integrity.segment_sha256)
            .map_err(|_| invalid("Invalid recipe hashes."))?;
        for segment in SEGMENTS {
            let expected = hashes[segment]
                .as_str()
                .ok_or_else(|| invalid("Missing segment hash."))?;
            validate_sha256(expected, "segment hash")?;
            if hash(&segments[segment])? != expected {
                return Err(invalid(format!("{segment} content hash does not match.")));
            }
        }
        let routes = owners::questionnaire_routes(&self.segments.p2)?;
        let reproduced =
            crate::research_stimulus_order::reproduction::validate_and_reproduce_saved_variants(
                &workspace,
                &self.segments.p3,
                &definition_hash,
            )?;
        let variants = reproduced["variants"]
            .as_array()
            .ok_or_else(|| invalid("P3 reproduction is incomplete."))?
            .clone();
        if variants.len() != variant_count || routes.len() != route_count {
            return Err(invalid("Reproduction omitted a saved variant or route."));
        }
        let mut presentations = vec![json!({"presentationTarget":"desktop-screen","layout":
            owners::desktop(&self.segments.p4, &workspace, &self.segments.p5)?})];
        if let XrSelectionV1::Included { profile } = &self.segments.p6 {
            presentations.push(json!({"presentationTarget":"webxr-immersive-vr","layout":owners::xr(profile, &workspace, &self.segments.p5)?}));
        }
        let variant_hashes = variants.iter().map(|v| Ok(json!({"variantId":v["variantId"],"versionSha256":v["versionSha256"],
            "timelineSha256":hash(&v["timeline"])?,"markerProfileSha256":hash(&v["markerProfile"])?}))).collect::<ResearchResult<Vec<_>>>()?;
        let languages = routes
            .iter()
            .map(|r| {
                Ok(
                    json!({"languageId":r["languageId"],"languageSelectionPath":r["optionIds"],
            "questionnaireSha256":hash(r)?}),
                )
            })
            .collect::<ResearchResult<Vec<_>>>()?;
        let presentation_hashes = presentations.iter().map(|p| {
            if self.integrity.algorithm_version == LEGACY_ALGORITHM {
                Ok(json!({"presentationTarget":p["presentationTarget"],"layoutSha256":hash(&p["layout"])?}))
            } else {
                let desktop = p["presentationTarget"] == "desktop-screen";
                let identity = json!({"schema":"affect-research-planner-layout-identity","version":1,
                    "presentationTarget":p["presentationTarget"],"algorithms":{
                        "layout":if desktop {"desktop-layout-resolution-v1"} else {"xr-layout-resolution-v1"},
                        "feedbackEnvelope":"feedback-envelope-v2",
                        "feedbackFootprint":if desktop {Value::Null} else {json!("xr-feedback-footprint-v1")}},
                    "profile":p["layout"]["profile"],"media":owners::media(&workspace),"feedback":self.segments.p5});
                Ok(json!({"presentationTarget":p["presentationTarget"],"layoutIdentitySha256":hash(&identity)?}))
            }
        }).collect::<ResearchResult<Vec<_>>>()?;
        let policy_hash = hash(&self.policy)?;
        let feedback_hash = hash(&self.segments.p5)?;
        let mut cases = Vec::with_capacity(case_count);
        for variant in &variant_hashes {
            for language in &languages {
                for presentation in &presentation_hashes {
                    let identity = json!({"definitionSha256":definition_hash,"policySha256":policy_hash,"feedbackSha256":feedback_hash,
                "variant":variant,"language":language,"presentation":presentation});
                    cases.push(json!({"variantId":variant["variantId"],"languageId":language["languageId"],
                "languageSelectionPath":language["languageSelectionPath"],"presentationTarget":presentation["presentationTarget"],
                "selectionSha256":hash(&identity)?}));
                }
            }
        }
        let matrix = json!({"algorithmVersion":self.integrity.algorithm_version,"definitionSha256":definition_hash,"policySha256":policy_hash,
            "feedbackSha256":feedback_hash,"routeCount":route_count,"variantCount":variant_count,"presentationCount":presentation_count,
            "caseCount":case_count,"variants":variant_hashes,"languages":languages,"presentations":presentation_hashes,"cases":cases});
        if hash(&matrix)? != self.integrity.reproduction_sha256 {
            return Err(invalid(
                "Independent Planner reproduction does not match its saved hash.",
            ));
        }
        Ok(Prepared {
            routes,
            variants,
            presentations,
            matrix,
        })
    }

    pub fn validate(&self) -> ResearchResult<()> {
        self.prepare().map(|_| ())
    }
    pub fn reproduce(&self) -> ResearchResult<Value> {
        Ok(self.prepare()?.matrix)
    }
    pub fn canonical_file_bytes(&self) -> ResearchResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = canonical_json(self, &[])?;
        bytes.push(b'\n');
        if bytes.len() > MAX_BYTES {
            return Err(invalid("Recipe exceeds 16 MiB."));
        }
        Ok(bytes)
    }
    pub fn reconstruct_selection(&self, selector: &Value) -> ResearchResult<Value> {
        let prepared = self.prepare()?;
        let keys = selector
            .as_object()
            .ok_or_else(|| invalid("Explicit selection is required."))?;
        if keys.len() != 4
            || [
                "variantId",
                "languageId",
                "languageSelectionPath",
                "presentationTarget",
            ]
            .iter()
            .any(|k| !keys.contains_key(*k))
            || selector["presentationTarget"] != self.presentation_target
        {
            return Err(invalid(
                "Select the exact saved variant, language path and recipe target.",
            ));
        }
        let variant = prepared
            .variants
            .iter()
            .find(|v| v["variantId"] == selector["variantId"])
            .ok_or_else(|| invalid("Selected variant is absent."))?;
        let route = prepared
            .routes
            .iter()
            .find(|r| {
                r["languageId"] == selector["languageId"]
                    && r["optionIds"] == selector["languageSelectionPath"]
            })
            .ok_or_else(|| invalid("Selected language path is absent."))?;
        let presentation = prepared
            .presentations
            .iter()
            .find(|p| p["presentationTarget"] == selector["presentationTarget"])
            .ok_or_else(|| invalid("Selected presentation is absent."))?;
        Ok(
            json!({"schema":"affect-research-planner-selection","version":1,"recipeId":self.recipe_id,
            "definitionSha256":self.integrity.definition_sha256,"presentationTarget":self.presentation_target,
            "study":self.segments.p1["study"],"assets":self.segments.p1["videoCatalogue"]["entries"],
            "policy":self.policy,"feedback":self.segments.p5,
            "language":{"languageId":route["languageId"],"languageTag":route["languageTag"],"languageSelectionPath":route["optionIds"]},
            "questionnaires":{"beforeSession":route["beforeSession"],"afterSession":route["afterSession"]},
            "variant":{"variantId":variant["variantId"],"versionSha256":variant["versionSha256"]},
            "timeline":variant["timeline"],"markerProfile":variant["markerProfile"],"layout":presentation["layout"]}),
        )
    }
}

/// Check resource bounds before recursive JSON deserialization. Comparing exact
/// canonical bytes rejects duplicate keys even inside Value-dispatched owners.
fn read_value(bytes: &[u8]) -> ResearchResult<Value> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(invalid("Recipe must contain 1 byte to 16 MiB."));
    }
    std::str::from_utf8(bytes).map_err(|_| invalid("Recipe must be valid UTF-8."))?;
    let mut depth: usize = 0;
    let mut quoted = false;
    let mut escaped = false;
    for b in bytes {
        if quoted {
            if escaped {
                escaped = false;
            } else if *b == b'\\' {
                escaped = true;
            } else if *b == b'"' {
                quoted = false;
            }
        } else if *b == b'"' {
            quoted = true;
        } else if *b == b'{' || *b == b'[' {
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(invalid("Recipe JSON is nested too deeply."));
            }
        } else if *b == b'}' || *b == b']' {
            depth = depth.saturating_sub(1);
        }
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| invalid("Recipe must contain strict JSON."))?;
    let mut canonical = canonical_json(&value, &[])?;
    canonical.push(b'\n');
    if canonical != bytes {
        return Err(invalid(
            "Recipe must use exact canonical JSON with one trailing LF.",
        ));
    }
    Ok(value)
}

pub fn parse_planner_recipe_bytes(bytes: &[u8]) -> ResearchResult<LoadedPlannerRecipe> {
    let value = read_value(bytes)?;
    let recipe: PlannerRecipeV1 = decode(value.clone())?;
    exact_reencoding(&value, &recipe)?;
    recipe.validate()?;
    Ok(LoadedPlannerRecipe {
        recipe,
        canonical_source_text: String::from_utf8(bytes.to_vec())
            .map_err(|_| invalid("Invalid UTF-8."))?,
        canonical_source_byte_sha256: format!("{:x}", Sha256::digest(bytes)),
    })
}

pub fn parse_planner_recipe_file(bytes: &[u8]) -> ResearchResult<Value> {
    let value = read_value(bytes)?;
    match value["schema"].as_str() {
        Some(SCHEMA) => {
            Ok(json!({"kind":"planner-recipe-v1","document":parse_planner_recipe_bytes(bytes)?}))
        }
        Some(crate::research_experiment_package::EXPERIMENT_PACKAGE_SCHEMA) => {
            Ok(json!({"kind":"experiment-package-v1",
            "document":crate::research_experiment_package::parse_experiment_package_bytes(bytes)?}))
        }
        _ => Err(invalid("Unsupported recipe file schema.")),
    }
}

impl SavedPlannerRecipeReceipt {
    pub fn from_loaded(document: &LoadedPlannerRecipe) -> Self {
        Self {
            schema: "affect-research-planner-recipe-save-receipt".into(),
            version: 1,
            recipe_id: document.recipe.recipe_id.clone(),
            definition_sha256: document.recipe.integrity.definition_sha256.clone(),
            canonical_source_byte_sha256: document.canonical_source_byte_sha256.clone(),
            byte_length: document.canonical_source_text.len() as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const DESKTOP: &[u8] =
        include_bytes!("../../test/fixtures/planner-recipe-current-v1.canonical.json");
    const LOCATIONS: &[u8] =
        include_bytes!("../../test/fixtures/planner-recipe-locations-current-v1.canonical.json");
    const XR: &[u8] =
        include_bytes!("../../test/fixtures/planner-recipe-xr-current-v1.canonical.json");
    fn json_bytes(value: &Value) -> Vec<u8> {
        let mut bytes = canonical_json(value, &[]).unwrap();
        bytes.push(b'\n');
        bytes
    }

    #[test]
    fn full_js_masters_reproduce_every_hash_and_selection_in_rust() {
        for (bytes, expected) in [
            (
                DESKTOP,
                include_str!("../../test/fixtures/planner-recipe-current-v1-reproduction.json"),
            ),
            (
                LOCATIONS,
                include_str!(
                    "../../test/fixtures/planner-recipe-locations-current-v1-reproduction.json"
                ),
            ),
            (
                XR,
                include_str!("../../test/fixtures/planner-recipe-xr-current-v1-reproduction.json"),
            ),
        ] {
            let loaded = parse_planner_recipe_bytes(bytes).unwrap_or_else(|error| {
                panic!("{}: {error}", read_value(bytes).unwrap()["recipeId"])
            });
            assert_eq!(loaded.recipe.canonical_file_bytes().unwrap(), bytes);
            let matrix = loaded.recipe.reproduce().unwrap();
            assert_eq!(matrix, serde_json::from_str::<Value>(expected).unwrap());
            let receipt = SavedPlannerRecipeReceipt::from_loaded(&loaded);
            assert_eq!(
                receipt.canonical_source_byte_sha256,
                format!("{:x}", Sha256::digest(bytes))
            );
            for case in matrix["cases"].as_array().unwrap() {
                let mut selector = case.clone();
                selector.as_object_mut().unwrap().remove("selectionSha256");
                if selector["presentationTarget"] == loaded.recipe.presentation_target {
                    let selected = loaded.recipe.reconstruct_selection(&selector).unwrap();
                    assert_eq!(selected["timeline"]["variantId"], selector["variantId"]);
                    assert_eq!(
                        selected["feedback"],
                        serde_json::to_value(&loaded.recipe.segments.p5).unwrap()
                    );
                } else {
                    assert!(loaded.recipe.reconstruct_selection(&selector).is_err());
                }
            }
            assert_eq!(
                parse_planner_recipe_file(bytes).unwrap()["kind"],
                "planner-recipe-v1"
            );
        }
    }

    #[test]
    fn composed_layout_and_questionnaire_hashes_match_js_before_root_intake() {
        let raw: Value = serde_json::from_slice(DESKTOP).unwrap();
        let recipe: PlannerRecipeV1 = decode(raw).unwrap();
        let workspace = validate_workspace_contribution(&recipe.segments.p1).unwrap();
        let layout = owners::desktop(&recipe.segments.p4, &workspace, &recipe.segments.p5).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-v1-reproduction.json"
        ))
        .unwrap();
        assert_eq!(
            hash(&layout).unwrap(),
            expected["presentations"][0]["layoutSha256"]
        );
        for (route, expected) in owners::questionnaire_routes(&recipe.segments.p2)
            .unwrap()
            .iter()
            .zip(expected["languages"].as_array().unwrap())
        {
            assert_eq!(hash(route).unwrap(), expected["questionnaireSha256"]);
        }
        let raw: Value = serde_json::from_slice(XR).unwrap();
        let recipe: PlannerRecipeV1 = decode(raw).unwrap();
        let workspace = validate_workspace_contribution(&recipe.segments.p1).unwrap();
        let XrSelectionV1::Included { profile } = &recipe.segments.p6 else {
            panic!("fixture must include XR");
        };
        let layout = owners::xr(profile, &workspace, &recipe.segments.p5).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-xr-master-v1-layout.json"
        ))
        .unwrap();
        // P6's named geometry tolerance is strict absolute 1e-10, never a
        // canonical-byte/hash tolerance. No input fields or hashes are rounded.
        fn differences(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
            match (a, b) {
                (Value::Object(a), Value::Object(b)) => {
                    assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
                    for (key, value) in a {
                        differences(value, &b[key], &format!("{path}/{key}"), out);
                    }
                }
                (Value::Array(a), Value::Array(b)) => {
                    assert_eq!(a.len(), b.len());
                    for (i, (a, b)) in a.iter().zip(b).enumerate() {
                        differences(a, b, &format!("{path}/{i}"), out);
                    }
                }
                (Value::Number(a), Value::Number(b))
                    if (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-10 =>
                {
                    ()
                }
                _ if a != b => out.push(format!("{path}: {a} vs {b}")),
                _ => (),
            }
        }
        let mut diff = Vec::new();
        differences(&layout, &expected, "", &mut diff);
        assert!(
            diff.is_empty(),
            "{}",
            diff.into_iter().take(20).collect::<Vec<_>>().join("\n")
        );
    }

    #[test]
    fn strict_transport_rejects_duplicate_noncanonical_deep_and_invalid_utf8() {
        let text = std::str::from_utf8(DESKTOP).unwrap();
        for source in [
            text.trim().to_string(),
            text.replace(
                "\"recipeId\":\"complete-master\"",
                "\"recipeId\":\"complete-master\",\"recipeId\":\"complete-master\"",
            ),
            format!("{}0{}\n", "[".repeat(65), "]".repeat(65)),
            "{}\r\n".into(),
            format!("\u{feff}{text}"),
        ] {
            assert!(parse_planner_recipe_bytes(source.as_bytes()).is_err());
        }
        assert!(parse_planner_recipe_bytes(&[0xff]).is_err());
        assert!(parse_planner_recipe_bytes(&vec![b' '; MAX_BYTES + 1]).is_err());
    }

    #[test]
    fn complete_integrity_and_closed_owner_fields_reject_tamper() {
        for path in [
            "/schema",
            "/recipeId",
            "/integrity/definitionSha256",
            "/integrity/reproductionSha256",
            "/integrity/segmentSha256/P1",
            "/segments/P1/videoCatalogue/integritySha256",
            "/segments/P2/presentation/definitions/0/repeatLabelsEvery",
            "/segments/P3/integritySha256",
            "/segments/P4/reference/source/policy",
            "/segments/P5/presentation/renderer",
            "/segments/P6/status",
        ] {
            let mut raw: Value = serde_json::from_slice(DESKTOP).unwrap();
            *raw.pointer_mut(path).unwrap() = json!("invalid");
            assert!(
                parse_planner_recipe_bytes(&json_bytes(&raw)).is_err(),
                "{path}"
            );
        }
        for path in [
            "",
            "/segments",
            "/segments/P1",
            "/segments/P2",
            "/segments/P3",
            "/segments/P4",
            "/segments/P5",
            "/segments/P6",
            "/policy",
            "/integrity",
        ] {
            let mut raw: Value = serde_json::from_slice(DESKTOP).unwrap();
            raw.pointer_mut(path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("extra".into(), Value::Null);
            assert!(parse_planner_recipe_bytes(&json_bytes(&raw)).is_err());
        }
        let legacy = include_bytes!("../../test/fixtures/experiment-package-v1.canonical.json");
        assert_eq!(
            parse_planner_recipe_file(legacy).unwrap()["kind"],
            "experiment-package-v1"
        );
        assert!(parse_planner_recipe_bytes(legacy).is_err());
    }
}

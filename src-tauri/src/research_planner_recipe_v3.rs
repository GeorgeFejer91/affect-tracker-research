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
    pub fn validate(&self) -> ResearchResult<()> {
        self.0.validate_version(3)
    }
    pub fn reproduce(&self) -> ResearchResult<Value> {
        self.0.reproduce_version(3)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::{canonical_json, canonical_sha256};
    use crate::research_planner_recipe::parse_planner_recipe_bytes;
    use crate::research_planner_recipe_supported::parse_supported_planner_recipe_bytes;

    #[test]
    fn js_master3_bytes_reproduction_and_every_selected_hash_match_rust() {
        for (source, matrix, selections) in [
            (
                include_str!("../../test/fixtures/planner-recipe-v3-locations.canonical.json"),
                include_str!("../../test/fixtures/planner-recipe-v3-locations-reproduction.json"),
                include_str!(
                    "../../test/fixtures/planner-recipe-v3-locations-selection-hashes.json"
                ),
            ),
            (
                include_str!("../../test/fixtures/planner-recipe-v3-xr.canonical.json"),
                include_str!("../../test/fixtures/planner-recipe-v3-xr-reproduction.json"),
                include_str!("../../test/fixtures/planner-recipe-v3-xr-selection-hashes.json"),
            ),
        ] {
            let loaded = parse_supported_planner_recipe_bytes(source.as_bytes()).unwrap();
            assert_eq!(loaded.recipe.version(), 3);
            assert_eq!(loaded.canonical_source_text, source);
            assert!(parse_planner_recipe_bytes(source.as_bytes()).is_err());
            let v2: PlannerRecipeV2 = serde_json::from_str(source).unwrap();
            assert!(v2.validate().is_err());
            let recipe: PlannerRecipeV3 = serde_json::from_str(source).unwrap();
            assert_eq!(recipe.canonical_file_bytes().unwrap(), source.as_bytes());
            let expected: Value = serde_json::from_str(matrix).unwrap();
            assert_eq!(
                canonical_json(&recipe.reproduce().unwrap(), &[]).unwrap(),
                canonical_json(&expected, &[]).unwrap()
            );
            let cases: Vec<Value> = serde_json::from_str(selections).unwrap();
            for case in cases {
                let mut selected = loaded
                    .recipe
                    .reconstruct_selection(&case["selector"])
                    .unwrap();
                assert_eq!(selected["version"], 3);
                if selected["presentationTarget"] == "webxr-immersive-vr" {
                    let expected_layout: Value = serde_json::from_str(include_str!(
                        "../../test/fixtures/planner-recipe-v3-xr-layout.json"
                    ))
                    .unwrap();
                    // Existing P6 absolute geometry tolerance, not a hash tolerance.
                    // Compare native geometry first; use the JS layout only in this
                    // test copy to check every other selected byte against its hash.
                    compare_xr_geometry(&selected["layout"], &expected_layout, "layout");
                    selected["layout"] = expected_layout;
                }
                assert_eq!(
                    canonical_sha256(&selected, &[]).unwrap(),
                    case["sha256"].as_str().unwrap()
                );
            }
        }
    }

    fn compare_xr_geometry(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(
                    a.keys().collect::<Vec<_>>(),
                    b.keys().collect::<Vec<_>>(),
                    "{path}"
                );
                for (key, value) in a {
                    compare_xr_geometry(value, &b[key], &format!("{path}/{key}"));
                }
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len(), "{path}");
                for (index, (a, b)) in a.iter().zip(b).enumerate() {
                    compare_xr_geometry(a, b, &format!("{path}/{index}"));
                }
            }
            (Value::Number(a), Value::Number(b)) => assert!(
                (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-10,
                "{path}: {a} vs {b}"
            ),
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }

    #[test]
    fn master3_rejects_old_chain_and_proof_drift_without_repair() {
        let value: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-v3-locations.canonical.json"
        ))
        .unwrap();
        for mode in 0..5 {
            let mut changed = value.clone();
            match mode {
                0 => changed["version"] = 2.into(),
                1 => changed["segments"]["P1"]["version"] = 2.into(),
                2 => changed["segments"]["P2"]["version"] = 1.into(),
                3 => {
                    changed["integrity"]["algorithmVersion"] =
                        "planner-recipe-reproduction-v3".into()
                }
                _ => {
                    changed["segments"]["P1"]["videoCatalogue"]["entries"][0]["geometry"]
                        ["nativeDisplayMetadata"]["renderer"]["readbackRotationDegrees"] = 90.into()
                }
            }
            let parsed = serde_json::from_value::<PlannerRecipeV3>(changed);
            assert!(parsed.is_err() || parsed.unwrap().validate().is_err());
        }
    }
}

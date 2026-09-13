//! Exact source modules, no lib/Runner/file-service registration or test parser.
#[path = "../src"]
mod owners {
    pub(crate) mod research_contracts;
    pub(crate) mod research_desktop_layout;
    pub(crate) mod research_error;
    pub(crate) mod research_experiment_package;
    pub(crate) mod research_external_protocol;
    pub(crate) mod research_feedback;
    pub(crate) mod research_form_definition;
    pub(crate) mod research_planner_recipe;
    pub(crate) mod research_planner_recipe_policy;
    pub(crate) mod research_planner_recipe_supported;
    pub(crate) mod research_planner_recipe_v2;
    pub(crate) mod research_planner_recipe_v3;
    pub(crate) mod research_planner_recipe_v4;
    pub(crate) mod research_protocol;
    pub(crate) mod research_questionnaire_recipe;
    pub(crate) mod research_questionnaire_recipe_v2;
    pub(crate) mod research_stimulus_order;
    pub(crate) mod research_surveyjs_definition;
    pub(crate) mod research_surveyjs_engine;
    pub(crate) mod research_video_geometry;
    pub(crate) mod research_workspace_contribution;
    pub(crate) mod research_xr_layout;
}
use owners::*;
use research_contracts::canonical_json;
use research_planner_recipe_supported::{
    parse_supported_planner_recipe_bytes, SupportedPlannerRecipe,
};
use research_questionnaire_recipe_v2::QuestionnaireRecipeContributionV2;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MIXED: &[u8] = include_bytes!("../../test/fixtures/planner-recipe-v2-mixed.canonical.json");
fn bytes(value: &Value) -> Vec<u8> {
    let mut b = canonical_json(value, &[]).unwrap();
    b.push(b'\n');
    b
}
fn fixture() -> Value {
    serde_json::from_slice(MIXED).unwrap()
}
fn valid_p2(value: Value) -> bool {
    serde_json::from_value::<QuestionnaireRecipeContributionV2>(value)
        .is_ok_and(|v| v.validate().is_ok())
}

fn compare_xr_layout(actual: &Value, expected: &Value, path: &str) {
    // Existing P6 gate: strict absolute 1e-10 for derived geometry only.
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
            for (key, value) in a {
                compare_xr_layout(value, &b[key], &format!("{path}/{key}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare_xr_layout(a, b, &format!("{path}/{i}"));
            }
        }
        (Value::Number(a), Value::Number(b))
            if path.starts_with("/videos/") || path.starts_with("/feedback/") =>
        {
            assert!(
                (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-10,
                "XR derived mismatch at {path}"
            );
        }
        _ => assert!(
            canonical_json(actual, &[]).unwrap() == canonical_json(expected, &[]).unwrap(),
            "XR exact mismatch at {path}"
        ),
    }
}

#[test]
fn native_v2_matches_independent_js_masters_matrices_and_every_selection() {
    for (source, matrix, selections) in [
        (
            MIXED,
            include_str!("../../test/fixtures/planner-recipe-v2-mixed-reproduction.json"),
            include_str!("../../test/fixtures/planner-recipe-v2-mixed-selections.json"),
        ),
        (
            include_bytes!("../../test/fixtures/planner-recipe-v2-xr.canonical.json").as_slice(),
            include_str!("../../test/fixtures/planner-recipe-v2-xr-reproduction.json"),
            include_str!("../../test/fixtures/planner-recipe-v2-xr-selections.json"),
        ),
        (
            include_bytes!("../../test/fixtures/planner-recipe-v2-locations.canonical.json")
                .as_slice(),
            include_str!("../../test/fixtures/planner-recipe-v2-locations-reproduction.json"),
            include_str!("../../test/fixtures/planner-recipe-v2-locations-selections.json"),
        ),
    ] {
        let original: Value = serde_json::from_slice(source).unwrap();
        let loaded = parse_supported_planner_recipe_bytes(source).unwrap();
        assert_eq!(loaded.canonical_source_text.as_bytes(), source);
        assert_eq!(
            loaded.canonical_source_byte_sha256,
            format!("{:x}", Sha256::digest(source))
        );
        assert_eq!(loaded.recipe.version(), 2);
        assert_eq!(
            loaded.recipe.recipe_id(),
            original["recipeId"].as_str().unwrap()
        );
        assert_eq!(
            loaded.recipe.presentation_target(),
            original["presentationTarget"].as_str().unwrap()
        );
        assert_eq!(
            loaded.recipe.definition_sha256(),
            original["integrity"]["definitionSha256"].as_str().unwrap()
        );
        assert_eq!(
            canonical_json(loaded.recipe.policy(), &[]).unwrap(),
            canonical_json(&original["policy"], &[]).unwrap()
        );
        for segment in ["P1", "P2", "P3", "P4", "P5", "P6"] {
            assert_eq!(
                canonical_json(&loaded.recipe.segment(segment).unwrap(), &[]).unwrap(),
                canonical_json(&original["segments"][segment], &[]).unwrap()
            );
        }
        assert!(loaded.recipe.segment("P7").is_err());
        let SupportedPlannerRecipe::V2(recipe) = &loaded.recipe else {
            panic!("Version dispatch");
        };
        assert_eq!(recipe.canonical_file_bytes().unwrap(), source);
        let expected_matrix: Value = serde_json::from_str(matrix).unwrap();
        assert_eq!(recipe.reproduce().unwrap(), expected_matrix);
        let expected: Value = serde_json::from_str(selections).unwrap();
        let mut selected = Vec::new();
        for case in expected_matrix["cases"].as_array().unwrap() {
            if case["presentationTarget"] != original["presentationTarget"] {
                continue;
            }
            let mut selector = case.clone();
            selector.as_object_mut().unwrap().remove("selectionSha256");
            selected.push(loaded.recipe.reconstruct_selection(&selector).unwrap());
        }
        assert_eq!(selected.len(), expected.as_array().unwrap().len());
        for (actual, expected) in selected.iter().zip(expected.as_array().unwrap()) {
            let (mut a, mut b) = (actual.clone(), expected.clone());
            if original["presentationTarget"] == "webxr-immersive-vr" {
                compare_xr_layout(&a["layout"], &b["layout"], "");
                a.as_object_mut().unwrap().remove("layout");
                b.as_object_mut().unwrap().remove("layout");
            }
            assert!(
                canonical_json(&a, &[]).unwrap() == canonical_json(&b, &[]).unwrap(),
                "Exact selection bytes differ outside derived XR layout."
            );
        }
        assert!(selected.iter().all(|s| s["version"] == 2));
        let mut detached = loaded.recipe.segment("P2").unwrap();
        detached["version"] = json!(999);
        assert_eq!(loaded.recipe.segment("P2").unwrap()["version"], 2);
    }
}

#[test]
fn supported_dispatch_preserves_legacy_bytes_and_rejects_version_confusion() {
    for source in [
        include_bytes!("../../test/fixtures/planner-recipe-current-v1.canonical.json").as_slice(),
        include_bytes!("../../test/fixtures/planner-recipe-xr-current-v1.canonical.json")
            .as_slice(),
        include_bytes!("../../test/fixtures/planner-recipe-locations-current-v1.canonical.json")
            .as_slice(),
        include_bytes!("../../test/fixtures/planner-recipe-deep-language-v1.canonical.json")
            .as_slice(),
    ] {
        let supported = parse_supported_planner_recipe_bytes(source).unwrap();
        let legacy = research_planner_recipe::parse_planner_recipe_bytes(source).unwrap();
        assert_eq!(supported.recipe.version(), 1);
        assert_eq!(
            supported.canonical_source_text,
            legacy.canonical_source_text
        );
        assert_eq!(
            canonical_json(&supported.recipe, &[]).unwrap(),
            canonical_json(&legacy.recipe, &[]).unwrap()
        );
    }
    assert!(research_planner_recipe::parse_planner_recipe_bytes(MIXED).is_err());
    for (path, bad) in [
        ("/version", json!(1)),
        ("/version", json!(3)),
        ("/version", json!("2")),
        ("/schema", json!("affect-research-experiment-package")),
        (
            "/integrity/algorithmVersion",
            json!("planner-recipe-reproduction-v2"),
        ),
        ("/segments/P2/version", json!(1)),
        (
            "/segments/P2/questionnaires/algorithmVersion",
            json!("questionnaire-hooks-v2"),
        ),
        ("/segments/P2/presentation/version", json!(1)),
    ] {
        let mut value = fixture();
        *value.pointer_mut(path).unwrap() = bad;
        assert!(
            parse_supported_planner_recipe_bytes(&bytes(&value)).is_err(),
            "{path}"
        );
    }
}

#[test]
fn p2_closed_objects_and_mixed_definition_references_fail_before_master_hashes() {
    let base = fixture()["segments"]["P2"].clone();
    assert!(valid_p2(base.clone()));
    for path in [
        "",
        "/questionnaires",
        "/presentation",
        "/presentation/definitions/0",
        "/questionnaires/modules/0",
        "/questionnaires/definitions/0",
        "/questionnaires/definitions/2",
    ] {
        let keys = base
            .pointer(path)
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for key in keys {
            let mut value = base.clone();
            value
                .pointer_mut(path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(&key);
            assert!(!valid_p2(value), "missing {path}/{key}");
        }
        let mut value = base.clone();
        value
            .pointer_mut(path)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(1));
        assert!(!valid_p2(value));
    }
    for (path, bad) in [
        (
            "/questionnaires/definitions/0/schema",
            json!("affect-research-form-definition"),
        ),
        (
            "/questionnaires/definitions/2/schema",
            json!("affect-research-questionnaire-definition"),
        ),
        ("/questionnaires/definitions/2/version", json!(2)),
        (
            "/questionnaires/modules/0/definitionSha256",
            json!("0".repeat(64)),
        ),
        (
            "/questionnaires/modules/0/questionnaireId",
            json!("missing"),
        ),
        (
            "/questionnaires/modules/0/placement",
            json!({"kind":"beforeBlock","blockId":"block"}),
        ),
        ("/presentation/definitions/0/kind", json!("fields")),
        ("/presentation/definitions/2/kind", json!("likert")),
        ("/presentation/definitions/0/repeatLabelsEvery", json!(2)),
        (
            "/languageSelection/languages/0/questionnaireModuleIds",
            json!(["missing"]),
        ),
    ] {
        let mut value = base.clone();
        *value.pointer_mut(path).unwrap() = bad;
        assert!(!valid_p2(value), "{path}");
    }
    for list in [
        "/questionnaires/definitions",
        "/questionnaires/modules",
        "/presentation/definitions",
    ] {
        let mut value = base.clone();
        let array = value.pointer_mut(list).unwrap().as_array_mut().unwrap();
        array[1] = array[0].clone();
        assert!(!valid_p2(value));
    }
    let mut value = base;
    value["presentation"]["definitions"]
        .as_array_mut()
        .unwrap()
        .reverse();
    assert!(!valid_p2(value));
}

#[test]
fn canonical_intake_bounds_and_integrity_fail_closed() {
    for value in [
        Vec::new(),
        MIXED[..MIXED.len() - 1].to_vec(),
        [b"\xef\xbb\xbf".as_slice(), MIXED].concat(),
        [MIXED, b"\n"].concat(),
        vec![b' '; research_planner_recipe::MAX_BYTES + 1],
        format!("{}0{}\n", "[".repeat(65), "]".repeat(65)).into_bytes(),
    ] {
        assert!(parse_supported_planner_recipe_bytes(&value).is_err());
    }
    let duplicate = String::from_utf8(MIXED.to_vec())
        .unwrap()
        .replacen("{", "{\"version\":2,", 1);
    assert!(parse_supported_planner_recipe_bytes(duplicate.as_bytes()).is_err());
    for path in [
        "/integrity/definitionSha256",
        "/integrity/reproductionSha256",
        "/integrity/segmentSha256/P1",
        "/integrity/segmentSha256/P2",
        "/integrity/segmentSha256/P3",
        "/integrity/segmentSha256/P4",
        "/integrity/segmentSha256/P5",
        "/integrity/segmentSha256/P6",
    ] {
        let mut value = fixture();
        *value.pointer_mut(path).unwrap() = json!("0".repeat(64));
        assert!(parse_supported_planner_recipe_bytes(&bytes(&value)).is_err());
    }
    let mut value = fixture();
    value["unexpected"] = json!(true);
    assert!(parse_supported_planner_recipe_bytes(&bytes(&value)).is_err());
}

#[test]
fn selection_requires_exact_saved_route_variant_and_target() {
    let loaded = parse_supported_planner_recipe_bytes(MIXED).unwrap();
    let expected: Value = serde_json::from_str(include_str!(
        "../../test/fixtures/planner-recipe-v2-mixed-reproduction.json"
    ))
    .unwrap();
    let mut selector = expected["cases"][0].clone();
    selector.as_object_mut().unwrap().remove("selectionSha256");
    for key in [
        "variantId",
        "languageId",
        "languageSelectionPath",
        "presentationTarget",
    ] {
        let mut missing = selector.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(loaded.recipe.reconstruct_selection(&missing).is_err());
        let mut wrong = selector.clone();
        wrong[key] = json!("absent");
        assert!(loaded.recipe.reconstruct_selection(&wrong).is_err());
    }
    selector["extra"] = json!(true);
    assert!(loaded.recipe.reconstruct_selection(&selector).is_err());
}

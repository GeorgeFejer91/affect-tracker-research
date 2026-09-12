// Standalone integration harness; Main owns lib/master registration.
#[path = "../src/research_contracts.rs"]
mod research_contracts;
#[path = "../src/research_error.rs"]
mod research_error;
#[path = "../src/research_form_definition.rs"]
mod research_form_definition;

use research_contracts::{canonical_json, canonical_sha256};
use research_form_definition::{
    decode_form_definition_v1, validate_form_definition_v1, FormDefinitionV1, FormResponseV1,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const EN: &str = include_str!("../../test/fixtures/demographics-en-form-v1.canonical.json");
const DE: &str = include_str!("../../test/fixtures/demographics-de-form-v1.canonical.json");

#[test]
fn matches_pinned_production_js_acceptance_and_canonical_bytes() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../test/fixtures/form-definition-native-parity-v1.json"
    ))
    .unwrap();
    for vector in corpus["vectors"].as_array().unwrap() {
        let accepted = vector["accepted"].as_bool().unwrap();
        let parsed = serde_json::from_str::<Value>(vector["jsonValue"].as_str().unwrap());
        let Ok(change) = parsed else {
            assert!(!accepted, "{}", vector["label"]);
            continue; // Non-finite JSON is rejected at serde's intake boundary.
        };
        let mut value = fixture();
        *value
            .pointer_mut(vector["pointer"].as_str().unwrap())
            .unwrap() = change;
        rehash(&mut value);
        let result = decode_form_definition_v1(&value);
        assert_eq!(result.is_ok(), accepted, "{}", vector["label"]);
        if let Ok(definition) = result {
            let mut bytes = canonical_json(&definition, &[]).unwrap();
            bytes.push(b'\n');
            assert_eq!(
                json!(format!("{:x}", Sha256::digest(bytes))),
                vector["canonicalFileSha256"],
                "{}",
                vector["label"]
            );
        }
    }
}
fn fixture() -> Value {
    serde_json::from_str(EN).unwrap()
}
fn rehash(value: &mut Value) {
    value["definitionSha256"] = json!(canonical_sha256(value, &["definitionSha256"]).unwrap());
}
fn reject(mut value: Value) {
    rehash(&mut value); // Rejection must be semantic, not merely a stale hash.
    assert!(decode_form_definition_v1(&value).is_err());
}

#[test]
fn native_forms_match_both_frozen_files_and_manifest_hashes() {
    let manifest: Value = serde_json::from_str(include_str!(
        "../../test/fixtures/demographics-form-v1.manifest.json"
    ))
    .unwrap();
    for (source, receipt) in [EN, DE]
        .into_iter()
        .zip(manifest["fixtures"].as_array().unwrap())
    {
        let value: Value = serde_json::from_str(source).unwrap();
        let definition = decode_form_definition_v1(&value).unwrap();
        assert_eq!(
            json!(definition.definition_sha256),
            receipt["definitionSha256"]
        );
        assert_eq!(json!(source.len()), receipt["byteLength"]);
        assert_eq!(
            json!(format!("{:x}", Sha256::digest(source.as_bytes()))),
            receipt["fileSha256"]
        );
        let mut encoded = canonical_json(&definition, &[]).unwrap();
        encoded.push(b'\n');
        assert_eq!(encoded, source.as_bytes());
        assert_eq!(serde_json::to_value(&definition).unwrap(), value);
    }
}

#[test]
fn every_closed_object_rejects_unknown_and_missing_fields() {
    for path in [
        "",
        "/provenance",
        "/items/0",
        "/items/0/response",
        "/items/1/response",
        "/items/2/response",
        "/items/2/response/options/0",
    ] {
        let base = fixture();
        for key in base.pointer(path).unwrap().as_object().unwrap().keys() {
            let mut value = base.clone();
            value
                .pointer_mut(path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(key);
            if path.is_empty() && key == "definitionSha256" {
                assert!(decode_form_definition_v1(&value).is_err());
            } else {
                reject(value);
            }
        }
        let mut value = base;
        value
            .pointer_mut(path)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(1));
        reject(value);
    }
}

#[test]
fn rejects_malformed_types_branches_bounds_and_identity() {
    for (path, bad) in [
        ("/schema", json!("affect-research-questionnaire-definition")),
        ("/version", json!(2)),
        ("/title", json!(null)),
        ("/questionnaireId", json!("bad.id")),
        ("/questionnaireId", json!("Ä")),
        ("/provenance/kind", json!("imported")),
        ("/provenance/validationStatus", json!("validated")),
        ("/provenance/sourceId", json!("")),
        ("/provenance/sourceVersion", json!("")),
        ("/items/0/required", json!(1)),
        ("/items/0/response/kind", json!("textarea")),
        ("/items/0/response/maxUtf8Bytes", json!(0)),
        ("/items/0/response/maxUtf8Bytes", json!(1025)),
        ("/items/1/response/min", json!(-1)),
        ("/items/1/response/max", json!(9_007_199_254_740_992_u64)),
        ("/items/1/response/unit", json!("months")),
        ("/items/0/order", json!(2)),
        ("/items/2/response/options/0/order", json!(2)),
        ("/items/2/response/options", json!([])),
        ("/items", json!([])),
        ("/items/0/itemId", json!("age")),
        ("/items/2/response/options/0/optionId", json!("female")),
    ] {
        let mut value = fixture();
        *value.pointer_mut(path).unwrap() = bad;
        reject(value);
    }
    let mut reversed = fixture();
    reversed["items"][1]["response"]["min"] = json!(10);
    reversed["items"][1]["response"]["max"] = json!(9);
    reject(reversed);
}

#[test]
fn json_whole_floats_match_js_without_coercion_or_negative_zero() {
    for (path, valid) in [
        ("/version", 1.0),
        ("/items/0/order", 1.0),
        ("/items/0/response/maxUtf8Bytes", 1024.0),
        ("/items/1/response/min", 0.0),
        ("/items/1/response/max", 9_007_199_254_740_991.0),
        ("/items/2/response/options/0/order", 1.0),
    ] {
        let mut value = fixture();
        *value.pointer_mut(path).unwrap() = json!(valid);
        rehash(&mut value);
        decode_form_definition_v1(&value).unwrap();
        for invalid in [
            json!(-0.0),
            json!(1.25),
            json!("1"),
            json!(true),
            json!(null),
            json!(-1),
            json!(9_007_199_254_740_992_u64),
            json!(u64::MAX),
        ] {
            let mut bad = fixture();
            *bad.pointer_mut(path).unwrap() = invalid;
            reject(bad);
        }
    }
    for spelling in ["-0", "-0.0", "-0e5"] {
        let raw = EN.replacen("\"min\":0", &format!("\"min\":{spelling}"), 1);
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert!(decode_form_definition_v1(&value).is_err());
    }
}

#[test]
fn unicode_scalar_bounds_and_whitespace_are_exact() {
    for (path, limit) in [
        ("/title", 500),
        ("/questionnaireVersion", 120),
        ("/provenance/sourceVersion", 120),
        ("/items/0/prompt", 8000),
        ("/items/2/response/options/0/label", 2000),
    ] {
        for length in [1, limit] {
            let mut value = fixture();
            *value.pointer_mut(path).unwrap() = json!("😀".repeat(length));
            rehash(&mut value);
            assert_eq!(
                serde_json::to_value(decode_form_definition_v1(&value).unwrap()).unwrap(),
                value
            );
        }
        for bad in [String::new(), "😀".repeat(limit + 1)] {
            let mut value = fixture();
            *value.pointer_mut(path).unwrap() = json!(bad);
            reject(value);
        }
    }
    // Definition text is not an answer: whitespace-only prompts/titles remain authored text.
    let mut value = fixture();
    value["title"] = json!(" \t\r\n\u{85}\u{a0}\u{feff} e\u{301} é ");
    rehash(&mut value);
    assert_eq!(
        decode_form_definition_v1(&value).unwrap().title,
        value["title"].as_str().unwrap()
    );
    for surrogate in [r#""\ud800""#, r#""\udfff""#] {
        assert!(serde_json::from_str::<Value>(&format!("{{\"title\":{surrogate}}}")).is_err());
    }
}

#[test]
fn language_grammar_preserves_case_and_rejects_implicit_language() {
    for tag in [
        "en",
        "de",
        "en-US",
        "zh-Hant-TW",
        "abcdefgh-12345678",
        "UND",
    ] {
        let mut value = fixture();
        value["language"] = json!(tag);
        rehash(&mut value);
        assert_eq!(decode_form_definition_v1(&value).unwrap().language, tag);
    }
    for tag in [
        "",
        "und",
        "e",
        "abcdefghi",
        "en_uk",
        "en-",
        "en--US",
        "en-123456789",
        "en-ä",
        " en",
        "en\n",
    ] {
        let mut value = fixture();
        value["language"] = json!(tag);
        reject(value);
    }
}

#[test]
fn item_and_option_count_limits_and_total_canonical_size() {
    let mut value = fixture();
    value["items"] = json!((1..=256).map(|i| json!({"itemId":format!("item{i}"),"order":i,"prompt":"P","required":false,"response":{"kind":"text","maxUtf8Bytes":1}})).collect::<Vec<_>>());
    rehash(&mut value);
    decode_form_definition_v1(&value).unwrap();
    let mut too_many = value.clone();
    let mut extra = too_many["items"][0].clone();
    extra["itemId"] = json!("last");
    extra["order"] = json!(257);
    too_many["items"].as_array_mut().unwrap().push(extra);
    reject(too_many);
    for item in value["items"].as_array_mut().unwrap() {
        item["prompt"] = json!("😀".repeat(8000));
    }
    rehash(&mut value);
    assert!(canonical_json(&value, &[]).unwrap().len() > 4 * 1024 * 1024);
    decode_form_definition_v1(&value).unwrap(); // The frozen bound is 16 MiB.
    for item in value["items"].as_array_mut().unwrap() {
        item["response"] = json!({"kind":"singleChoice", "options": (1..=5)
            .map(|i| json!({"optionId":format!("option{i}"),"order":i,"label":"😀".repeat(2000)}))
            .collect::<Vec<_>>()});
    }
    assert!(canonical_json(&value, &[]).unwrap().len() > 16 * 1024 * 1024);
    reject(value); // Each individual field fits; the complete form is too large.
    let mut value = fixture();
    value["items"][2]["response"]["options"] = json!((1..=256)
        .map(|i| json!({"optionId":format!("opt{i}"),"order":i,"label":"L"}))
        .collect::<Vec<_>>());
    rehash(&mut value);
    decode_form_definition_v1(&value).unwrap();
    value["items"][2]["response"]["options"]
        .as_array_mut()
        .unwrap()
        .push(json!({"optionId":"last","order":257,"label":"L"}));
    reject(value);
}

#[test]
fn stale_hash_and_invalid_public_structs_are_rejected() {
    let mut value = fixture();
    value["title"] = json!("Changed");
    assert!(decode_form_definition_v1(&value).is_err());
    for hash in ["0".repeat(64), "A".repeat(64), "a".repeat(63)] {
        let mut value = fixture();
        value["definitionSha256"] = json!(hash);
        assert!(decode_form_definition_v1(&value).is_err());
    }
    let mut definition: FormDefinitionV1 = decode_form_definition_v1(&fixture()).unwrap();
    definition.items[1].response = FormResponseV1::Integer {
        min: 0,
        max: u64::MAX,
        unit: "years".into(),
    };
    definition.definition_sha256 = canonical_sha256(&definition, &["definitionSha256"]).unwrap();
    assert!(validate_form_definition_v1(&definition).is_err());
}

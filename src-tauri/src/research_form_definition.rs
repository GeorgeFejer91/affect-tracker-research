//! Strict typed-form definitions. This module owns no answers, I/O or runtime policy.
use crate::research_contracts::{canonical_json, canonical_sha256, MAX_SAFE_INTEGER};
use crate::research_error::{CommandError, ResearchResult};
use serde::{de, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fmt;

pub const FORM_DEFINITION_SCHEMA: &str = "affect-research-form-definition";
const MAX_DEFINITION_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormDefinitionV1 {
    pub schema: String,
    #[serde(deserialize_with = "whole_u8")]
    pub version: u8,
    pub questionnaire_id: String,
    pub questionnaire_version: String,
    pub title: String,
    pub language: String,
    pub provenance: FormProvenanceV1,
    pub items: Vec<FormItemV1>,
    pub definition_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormProvenanceV1 {
    pub kind: String,
    pub source_id: String,
    pub source_version: String,
    pub validation_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormItemV1 {
    pub item_id: String,
    #[serde(deserialize_with = "whole_u32")]
    pub order: u32,
    pub prompt: String,
    pub required: bool,
    pub response: FormResponseV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FormResponseV1 {
    Text {
        #[serde(deserialize_with = "whole_u32")]
        max_utf8_bytes: u32,
    },
    Integer {
        #[serde(deserialize_with = "whole_u64")]
        min: u64,
        #[serde(deserialize_with = "whole_u64")]
        max: u64,
        unit: String,
    },
    SingleChoice {
        options: Vec<FormOptionV1>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormOptionV1 {
    pub option_id: String,
    #[serde(deserialize_with = "whole_u32")]
    pub order: u32,
    pub label: String,
}

// JSON 1 and 1.0 have the same meaning in the JS contract. Do not coerce
// strings/bools, round fractions, admit -0, or round an unsafe integer to f64.
struct WholeNumber;
impl<'de> de::Visitor<'de> for WholeNumber {
    type Value = u64;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a nonnegative safe whole number, excluding negative zero")
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<u64, E> {
        if value <= MAX_SAFE_INTEGER {
            Ok(value)
        } else {
            Err(E::custom("Unsafe integer."))
        }
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<u64, E> {
        u64::try_from(value)
            .map_err(|_| E::custom("Negative integer."))
            .and_then(|v| self.visit_u64(v))
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<u64, E> {
        if value.is_finite()
            && !value.is_sign_negative()
            && value.fract() == 0.0
            && value <= MAX_SAFE_INTEGER as f64
        {
            Ok(value as u64)
        } else {
            Err(E::custom("Invalid whole number."))
        }
    }
}
fn whole_u64<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    deserializer.deserialize_any(WholeNumber)
}
fn whole_u32<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u32, D::Error> {
    u32::try_from(whole_u64(deserializer)?).map_err(|_| de::Error::custom("Number exceeds u32."))
}
fn whole_u8<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    u8::try_from(whole_u64(deserializer)?).map_err(|_| de::Error::custom("Number exceeds u8."))
}
fn require(condition: bool, message: &'static str) -> ResearchResult<()> {
    if condition {
        Ok(())
    } else {
        Err(CommandError::invalid_contract(message))
    }
}
fn identifier(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn text(value: &str, maximum: usize) -> bool {
    // Rust strings contain Unicode scalars, so unpaired surrogates cannot enter.
    // Whitespace, control characters and normalization are deliberately preserved.
    !value.is_empty() && value.chars().take(maximum + 1).count() <= maximum
}
fn language(value: &str) -> bool {
    if value == "und" {
        return false;
    }
    let mut parts = value.split('-');
    let Some(first) = parts.next() else {
        return false;
    };
    (2..=8).contains(&first.len())
        && first.bytes().all(|b| b.is_ascii_alphabetic())
        && parts.all(|part| {
            (1..=8).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_alphanumeric())
        })
}

/// Decode the explicit new type and validate its complete content and self-hash.
/// Historical questionnaire definitions must use their unchanged reader.
pub fn decode_form_definition_v1(value: &Value) -> ResearchResult<FormDefinitionV1> {
    let definition = FormDefinitionV1::deserialize(value)
        .map_err(|_| CommandError::invalid_contract("Invalid typed form definition shape."))?;
    validate_form_definition_v1(&definition)?;
    Ok(definition)
}

/// Validate authored typed values too; constructing a public struct grants no trust.
pub fn validate_form_definition_v1(definition: &FormDefinitionV1) -> ResearchResult<()> {
    require(
        definition.schema == FORM_DEFINITION_SCHEMA && definition.version == 1,
        "Unsupported typed form schema/version.",
    )?;
    require(
        identifier(&definition.questionnaire_id)
            && text(&definition.questionnaire_version, 120)
            && text(&definition.title, 500)
            && language(&definition.language),
        "Invalid typed form identity, text or language.",
    )?;
    let provenance = &definition.provenance;
    require(
        provenance.kind == "projectAuthored"
            && provenance.validation_status == "notValidated"
            && identifier(&provenance.source_id)
            && text(&provenance.source_version, 120),
        "Invalid typed form provenance.",
    )?;
    require(
        (1..=256).contains(&definition.items.len()),
        "Invalid typed form item count.",
    )?;
    let mut item_ids = HashSet::new();
    for (index, item) in definition.items.iter().enumerate() {
        require(
            identifier(&item.item_id)
                && item_ids.insert(&item.item_id)
                && item.order as usize == index + 1
                && text(&item.prompt, 8000),
            "Invalid typed form item identity, order or prompt.",
        )?;
        match &item.response {
            FormResponseV1::Text { max_utf8_bytes } => {
                require(
                    (1..=1024).contains(max_utf8_bytes),
                    "Invalid typed form text byte limit.",
                )?;
            }
            FormResponseV1::Integer { min, max, unit } => {
                require(
                    min <= max && *max <= MAX_SAFE_INTEGER && unit == "years",
                    "Invalid typed form integer bounds or unit.",
                )?;
            }
            FormResponseV1::SingleChoice { options } => {
                require(
                    (1..=256).contains(&options.len()),
                    "Invalid typed form option count.",
                )?;
                let mut option_ids = HashSet::new();
                for (option_index, option) in options.iter().enumerate() {
                    require(
                        identifier(&option.option_id)
                            && option_ids.insert(&option.option_id)
                            && option.order as usize == option_index + 1
                            && text(&option.label, 2000),
                        "Invalid typed form option identity, order or label.",
                    )?;
                }
            }
        }
    }
    require(
        definition.definition_sha256.len() == 64
            && definition
                .definition_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "Invalid typed form definition hash.",
    )?;
    require(
        canonical_json(definition, &[])?.len() <= MAX_DEFINITION_BYTES,
        "Typed form exceeds 16 MiB.",
    )?;
    require(
        canonical_sha256(definition, &["definitionSha256"])? == definition.definition_sha256,
        "Typed form definition hash does not match.",
    )
}

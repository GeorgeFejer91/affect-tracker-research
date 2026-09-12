//! Runner-owned typed values and native answer observation. P2 owns definitions.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_form_definition::{
    validate_form_definition_v1, FormDefinitionV1, FormResponseV1,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum FormAnswerValue {
    Text {
        text: String,
    },
    Integer {
        #[serde(deserialize_with = "whole_answer")]
        integer: u64,
    },
    #[serde(rename_all = "camelCase")]
    SingleChoice {
        option_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TypedChoice {
    pub item_id: String,
    pub value: FormAnswerValue,
}

fn whole_answer<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    // Match P2's numeric meaning (1, 1.0, 1e0), without string coercion,
    // fraction rounding, negative zero or unsafe-integer rounding.
    let value = Value::deserialize(deserializer)?;
    if let Value::Number(number) = value {
        if let Some(integer) = number.as_u64().filter(|n| *n <= 9_007_199_254_740_991) {
            return Ok(integer);
        }
        if let Some(number) = number.as_f64().filter(|n| {
            n.is_finite()
                && !n.is_sign_negative()
                && n.fract() == 0.
                && *n <= 9_007_199_254_740_991.
        }) {
            return Ok(number as u64);
        }
    }
    Err(serde::de::Error::custom(
        "A typed age answer requires a nonnegative safe whole number.",
    ))
}

fn answered(value: &FormAnswerValue) -> bool {
    match value {
        // Exact shared contract set, including FEFF; no platform trim behavior.
        FormAnswerValue::Text { text } => text.chars().any(|c| {
            !matches!(c,
            '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{0085}' | '\u{00a0}' |
            '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' |
            '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
        }),
        _ => true,
    }
}

fn validate_value(value: &FormAnswerValue, response: &FormResponseV1) -> ResearchResult<()> {
    let valid = match (value, response) {
        (FormAnswerValue::Text { text }, FormResponseV1::Text { max_utf8_bytes }) => {
            text.len() <= *max_utf8_bytes as usize
        }
        (FormAnswerValue::Integer { integer }, FormResponseV1::Integer { min, max, .. }) => {
            *integer >= *min && *integer <= *max && *integer <= 9_007_199_254_740_991
        }
        (FormAnswerValue::SingleChoice { option_id }, FormResponseV1::SingleChoice { options }) => {
            options.iter().any(|option| option.option_id == *option_id)
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(invalid(
            "The answer does not match its frozen field type, option or bounds.",
        ))
    }
}

#[derive(Default)]
pub(crate) struct TypedFormAnswers {
    values: BTreeMap<String, (FormAnswerValue, f64)>,
}
pub(crate) struct TypedFormResult {
    pub complete: bool,
    pub responses: Vec<Value>,
}
impl TypedFormAnswers {
    pub(crate) fn projection(&self) -> BTreeMap<String, FormAnswerValue> {
        self.values
            .iter()
            .map(|(id, (value, _))| (id.clone(), value.clone()))
            .collect()
    }
    pub(crate) fn replace(
        &mut self,
        definition: &FormDefinitionV1,
        choices: Vec<TypedChoice>,
        submitted: bool,
        start: Instant,
        now: Instant,
    ) -> ResearchResult<TypedFormResult> {
        validate_form_definition_v1(definition)?;
        let latency = now.saturating_duration_since(start).as_secs_f64() * 1000.;
        if latency > 86_400_000. {
            return Err(CommandError::forbidden(
                "Typed response latency exceeds the supported bound.",
            ));
        }
        if choices.len() > definition.items.len() {
            return Err(invalid("Too many typed answers for the current form."));
        }
        let mut next = BTreeMap::new();
        for choice in choices {
            let item = definition
                .items
                .iter()
                .find(|item| item.item_id == choice.item_id)
                .ok_or_else(|| invalid("Unknown typed form item."))?;
            if next.contains_key(&choice.item_id) {
                return Err(invalid("Duplicate typed form item."));
            }
            validate_value(&choice.value, &item.response)?;
            let observed = self
                .values
                .get(&choice.item_id)
                .filter(|(previous, _)| *previous == choice.value)
                .map(|(_, ms)| *ms)
                .unwrap_or(latency);
            next.insert(choice.item_id, (choice.value, observed));
        }
        let complete = definition.items.iter().all(|item| {
            next.get(&item.item_id)
                .is_some_and(|(value, _)| answered(value))
        });
        if submitted && !complete {
            return Err(invalid(
                "Answer every displayed form item before continuing.",
            ));
        }
        let mut responses = Vec::new();
        for item in &definition.items {
            if let Some((value, latency)) = next.get(&item.item_id) {
                let mut row = json!({"itemId":item.item_id,"itemOrder":item.order,"value":value,"responseLatencyMs":latency});
                if let (
                    FormAnswerValue::SingleChoice { option_id },
                    FormResponseV1::SingleChoice { options },
                ) = (value, &item.response)
                {
                    let option = options
                        .iter()
                        .find(|option| option.option_id == *option_id)
                        .ok_or_else(|| invalid("Frozen choice option disappeared."))?;
                    row["optionOrder"] = json!(option.order);
                    row["responseLabel"] = json!(option.label);
                }
                responses.push(row);
            }
        }
        self.values = next;
        Ok(TypedFormResult {
            complete,
            responses,
        })
    }
}
fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_form_definition::decode_form_definition_v1;
    use std::time::Duration;

    fn definition(language: &str) -> FormDefinitionV1 {
        let source = if language == "de" {
            include_str!("../../../test/fixtures/demographics-de-form-v1.canonical.json")
        } else {
            include_str!("../../../test/fixtures/demographics-en-form-v1.canonical.json")
        };
        decode_form_definition_v1(&serde_json::from_str(source).unwrap()).unwrap()
    }
    fn choices(name: &str, age: u64) -> Vec<TypedChoice> {
        serde_json::from_value(json!([
            {"itemId":"fullName","value":{"kind":"text","text":name}},
            {"itemId":"age","value":{"kind":"integer","integer":age}},
            {"itemId":"gender","value":{"kind":"singleChoice","optionId":"preferNotToSay"}},
            {"itemId":"handedness","value":{"kind":"singleChoice","optionId":"ambidextrous"}}
        ]))
        .unwrap()
    }
    #[test]
    fn bilingual_answers_preserve_exact_text_zero_age_labels_and_native_latency() {
        let mut exported = Vec::new();
        for language in ["en", "de"] {
            let definition = definition(language);
            let start = Instant::now();
            let mut state = TypedFormAnswers::default();
            let name = "  Test Participant Ä\n李 👩🏽‍🔬  ";
            let draft = state
                .replace(
                    &definition,
                    choices(name, 0),
                    false,
                    start,
                    start + Duration::from_millis(250),
                )
                .unwrap();
            let result = state
                .replace(
                    &definition,
                    choices(name, 0),
                    true,
                    start,
                    start + Duration::from_secs(2),
                )
                .unwrap();
            assert!(result.complete);
            assert_eq!(draft.responses, result.responses);
            assert_eq!(result.responses[0]["value"]["text"], name);
            assert_eq!(result.responses[1]["value"]["integer"], 0);
            assert_eq!(result.responses[0]["responseLatencyMs"], 250.);
            assert_eq!(
                result.responses[2]["responseLabel"],
                if language == "de" {
                    "Keine Angabe"
                } else {
                    "Prefer not to say"
                }
            );
            assert!(result
                .responses
                .iter()
                .all(|row| row.get("scoreValue").is_none() && row.get("subscale").is_none()));
            assert!(result.responses[0].get("responseLabel").is_none());
            exported.push(json!({"definition":definition,"responses":result.responses,"submitted":true,"monotonicMs":2000.}));
            let changed = state
                .replace(
                    &definition,
                    choices("Test Participant Changed", 0),
                    false,
                    start,
                    start + Duration::from_secs(3),
                )
                .unwrap();
            assert_eq!(changed.responses[0]["responseLatencyMs"], 3000.);
            assert_eq!(changed.responses[1]["responseLatencyMs"], 250.);
        }
        if let Some(path) = std::env::var_os("AFFECT_RUNNER_TYPED_RESPONSE_FIXTURE") {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .unwrap();
            file.write_all(&crate::research_contracts::canonical_json(&json!({"schema":"affect-runner-typed-answer-engineering-fixture","version":1,"claim":"Native typed answer calculation with fictitious values and synthetic elapsed times; no experiment execution","forms":exported}),&[]).unwrap()).unwrap();
            file.sync_all().unwrap();
        }
    }
    #[test]
    fn missing_or_whitespace_answers_never_submit_and_failed_replacement_is_atomic() {
        let mut definition = definition("en");
        for item in &mut definition.items {
            item.required = false;
        }
        definition.definition_sha256 =
            crate::research_contracts::canonical_sha256(&definition, &["definitionSha256"])
                .unwrap();
        let now = Instant::now();
        let mut state = TypedFormAnswers::default();
        let whitespace = "\t\n\r \u{0085}\u{00a0}\u{1680}\u{2000}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";
        let draft = state
            .replace(&definition, choices(whitespace, 30), false, now, now)
            .unwrap();
        assert!(!draft.complete);
        let prior = state.projection();
        assert!(state
            .replace(&definition, choices(whitespace, 30), true, now, now)
            .is_err());
        assert_eq!(state.projection(), prior);
        assert!(state.replace(&definition, vec![], true, now, now).is_err());
        assert_eq!(state.projection(), prior);
        assert!(
            state
                .replace(&definition, choices("Test Participant", 30), true, now, now)
                .unwrap()
                .complete
        );
    }
    #[test]
    fn wrong_types_unknown_options_overflow_and_utf8_byte_excess_reject() {
        for text in ["0", "0.0", "1.0", "1e0", "9007199254740991.0"] {
            assert!(serde_json::from_str::<FormAnswerValue>(&format!(
                "{{\"kind\":\"integer\",\"integer\":{text}}}"
            ))
            .is_ok());
        }
        for text in ["-0", "-0.0", "9007199254740992", "9007199254740992.0"] {
            assert!(serde_json::from_str::<FormAnswerValue>(&format!(
                "{{\"kind\":\"integer\",\"integer\":{text}}}"
            ))
            .is_err());
        }
        for value in [
            json!({"kind":"integer","integer":"30"}),
            json!({"kind":"integer","integer":-1}),
            json!({"kind":"integer","integer":1.5}),
            json!({"kind":"integer","integer":true}),
            json!({"kind":"singleChoice","optionId":"male","scoreValue":1}),
            json!({"kind":"unknown"}),
        ] {
            assert!(serde_json::from_value::<FormAnswerValue>(value).is_err());
        }
        assert!(
            serde_json::from_str::<FormAnswerValue>(r#"{"kind":"text","text":"\ud800"}"#).is_err()
        );
        let d = definition("en");
        let now = Instant::now();
        let mut state = TypedFormAnswers::default();
        assert!(
            state
                .replace(
                    &d,
                    choices(&"ä".repeat(512), 9_007_199_254_740_991),
                    true,
                    now,
                    now
                )
                .unwrap()
                .complete
        );
        let prior = state.projection();
        let mut unsafe_age = choices("Test Participant", 30);
        // Also reject invalid values built directly in Rust, after IPC's own
        // deserializer has already been tested to reject this numeric value.
        unsafe_age[1].value = FormAnswerValue::Integer {
            integer: 9_007_199_254_740_992,
        };
        for values in [
            choices(&"ä".repeat(513), 30),
            unsafe_age,
            vec![TypedChoice {
                item_id: "fullName".into(),
                value: FormAnswerValue::Integer { integer: 30 },
            }],
            vec![TypedChoice {
                item_id: "gender".into(),
                value: FormAnswerValue::SingleChoice {
                    option_id: "unknown".into(),
                },
            }],
        ] {
            assert!(state.replace(&d, values, false, now, now).is_err());
            assert_eq!(state.projection(), prior);
        }
        let mut duplicate = choices("Test Participant", 30);
        duplicate[1] = duplicate[0].clone();
        assert!(state.replace(&d, duplicate, false, now, now).is_err());
        assert!(state
            .replace(
                &d,
                choices("Test Participant", 30),
                false,
                now,
                now + Duration::from_secs(86401)
            )
            .is_err());
    }
}

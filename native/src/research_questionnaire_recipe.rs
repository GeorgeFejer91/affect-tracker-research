//! P2-owned successor content/presentation, without changing scientific v1
//! definitions, v2 placements, filesystem authority or Runner behavior.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{deserialize_u32_integer, LanguageSelectionTreeV1};
use crate::research_protocol::{
    QuestionnaireDefinitionV1, QuestionnaireSettingsV3, QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireRecipeContributionV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub questionnaires: QuestionnaireSettingsV3,
    pub language_selection: LanguageSelectionTreeV1,
    pub presentation: QuestionnairePresentationV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnairePresentationV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub definitions: Vec<QuestionnairePresentationEntryV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnairePresentationEntryV1 {
    pub questionnaire_id: String,
    pub definition_sha256: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub repeat_labels_every: u32,
}

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}

// Mirrors the existing P2 family identity rule, including its historical aliases.
fn family_id(definition: &QuestionnaireDefinitionV1) -> String {
    match definition.questionnaire_id.as_str() {
        "maia-2-en" | "maia-2-de" => return "maia-2".into(),
        "tas-20-en" | "tas-20-de" => return "tas-20".into(),
        "phencon-long-en" | "phencon-long-de" => return "phencon-long".into(),
        "phencon-short-en" | "phencon-short-de" => return "phencon-short".into(),
        _ => {}
    }
    let language = definition.language.to_ascii_lowercase();
    for suffix in [language.as_str(), language.split('-').next().unwrap_or("")] {
        if let Some(id) = definition
            .questionnaire_id
            .strip_suffix(&format!("-{suffix}"))
        {
            if !id.is_empty() {
                return id.into();
            }
        }
    }
    definition.questionnaire_id.clone()
}

impl QuestionnaireRecipeContributionV1 {
    pub fn validate(&self) -> ResearchResult<()> {
        if self.schema != "affect-research-questionnaire-recipe-contribution" || self.version != 1 {
            return Err(invalid(
                "Unsupported questionnaire recipe contribution version.",
            ));
        }
        let questionnaires = &self.questionnaires;
        if questionnaires.algorithm_version != QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION
            || questionnaires.definitions.len() > 256
            || questionnaires.modules.len() > 1024
        {
            return Err(invalid(
                "Unsupported or oversized questionnaire contribution.",
            ));
        }
        // Existing normalizers own their grammar. Successor intake cannot repair
        // imported content, so compare their results before accepting anything.
        if self.language_selection.clone().normalize_and_validate()? != self.language_selection {
            return Err(invalid(
                "Questionnaire language tree must already be canonical.",
            ));
        }
        let mut definitions = BTreeMap::new();
        let mut families = BTreeSet::new();
        let mut slots = BTreeSet::new();
        let language_tags: BTreeSet<_> = self
            .language_selection
            .languages
            .iter()
            .map(|l| l.language_tag.as_str())
            .collect();
        for definition in &questionnaires.definitions {
            if definition.clone().normalize_and_validate()? != *definition
                || definition.language.eq_ignore_ascii_case("und")
                || !language_tags.contains(definition.language.as_str())
            {
                return Err(invalid(
                    "Each questionnaire needs an explicit, selected, canonical language.",
                ));
            }
            let family = family_id(definition);
            if definitions
                .insert(definition.questionnaire_id.as_str(), definition)
                .is_some()
                || !slots.insert((family.clone(), definition.language.as_str()))
            {
                return Err(invalid(
                    "Duplicate questionnaire identity or family/language slot.",
                ));
            }
            families.insert(family);
        }
        let mut modules = BTreeMap::new();
        let mut coverage = BTreeSet::new();
        for module in &questionnaires.modules {
            module.clone().normalize_and_validate()?;
            let definition = definitions
                .get(module.questionnaire_id.as_str())
                .ok_or_else(|| invalid("Questionnaire module has no definition."))?;
            if module.definition_sha256 != definition.definition_sha256
                || modules.insert(module.module_id.as_str(), module).is_some()
            {
                return Err(invalid(
                    "Questionnaire module identity or definition hash does not match.",
                ));
            }
            coverage.insert((family_id(definition), definition.language.as_str()));
        }
        let mut mapped = BTreeSet::new();
        for language in &self.language_selection.languages {
            for id in &language.questionnaire_module_ids {
                let module = modules
                    .get(id.as_str())
                    .ok_or_else(|| invalid("Language maps an unknown questionnaire module."))?;
                if definitions[module.questionnaire_id.as_str()].language != language.language_tag {
                    return Err(invalid(
                        "Language maps an incompatible questionnaire module.",
                    ));
                }
                mapped.insert(id.as_str());
            }
            for family in &families {
                if !coverage.contains(&(family.clone(), language.language_tag.as_str())) {
                    return Err(invalid(
                        "Supply every questionnaire in every selected language.",
                    ));
                }
            }
        }
        if mapped.len() != modules.len() {
            return Err(invalid(
                "Every questionnaire module needs a language mapping.",
            ));
        }
        self.presentation.validate(&questionnaires.definitions)
    }
}

impl QuestionnairePresentationV1 {
    pub fn validate(&self, definitions: &[QuestionnaireDefinitionV1]) -> ResearchResult<()> {
        if self.schema != "affect-research-questionnaire-presentation" || self.version != 1 {
            return Err(invalid("Unsupported questionnaire presentation version."));
        }
        if self.definitions.len() != definitions.len() {
            return Err(invalid(
                "Every definition needs exactly one presentation entry.",
            ));
        }
        for (entry, definition) in self.definitions.iter().zip(definitions) {
            if entry.questionnaire_id != definition.questionnaire_id
                || entry.definition_sha256 != definition.definition_sha256
                || !matches!(entry.repeat_labels_every, 1 | 5 | 10)
            {
                return Err(invalid(
                    "Questionnaire presentation identity, hash, order or repetition is invalid.",
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::{canonical_json, canonical_sha256};
    use serde_json::{json, Value};

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../test/fixtures/questionnaire-recipe-v1.json"
        ))
        .unwrap()
    }
    fn accepts(value: Value) -> bool {
        serde_json::from_value::<QuestionnaireRecipeContributionV1>(value)
            .is_ok_and(|value| value.validate().is_ok())
    }

    #[test]
    fn shared_successor_preserves_every_field_and_canonical_bytes() {
        let original = fixture();
        let value: QuestionnaireRecipeContributionV1 =
            serde_json::from_value(original.clone()).unwrap();
        value.validate().unwrap();
        assert_eq!(
            canonical_json(&value, &[]).unwrap(),
            canonical_json(&original, &[]).unwrap()
        );
        assert_eq!(
            canonical_sha256(&value, &[]).unwrap(),
            "ac7ef132eb5896794dfbef833b5a94e1a56a67d89fdd2854f1d84f3ff6da4d89"
        );
        assert_eq!(value.presentation.definitions[0].repeat_labels_every, 5);
        assert_eq!(value.presentation.definitions[1].repeat_labels_every, 10);
        assert_eq!(
            value.questionnaires.definitions[0].items[0].options[1].score_value,
            Some(-2.5)
        );
        assert!(!value.questionnaires.definitions[1].items[1].required);
    }

    #[test]
    fn strict_presentation_fields_identity_order_and_numeric_grammar() {
        for path in ["", "/presentation", "/presentation/definitions/0"] {
            for field in fixture().pointer(path).unwrap().as_object().unwrap().keys() {
                let mut value = fixture();
                value
                    .pointer_mut(path)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .remove(field);
                assert!(!accepts(value), "missing {path}/{field}");
            }
            let mut value = fixture();
            value
                .pointer_mut(path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("unknown".into(), json!(true));
            assert!(!accepts(value));
        }
        for replacement in [
            json!(0),
            json!(2),
            json!(1.5),
            json!("5"),
            json!(null),
            json!(true),
        ] {
            let mut value = fixture();
            value["presentation"]["definitions"][0]["repeatLabelsEvery"] = replacement;
            assert!(!accepts(value));
        }
        for path in [
            "/schema",
            "/version",
            "/presentation/schema",
            "/presentation/version",
            "/presentation/definitions/0/questionnaireId",
            "/presentation/definitions/0/definitionSha256",
            "/questionnaires/definitions/0/items/0/prompt",
            "/questionnaires/modules/0/definitionSha256",
        ] {
            let mut value = fixture();
            *value.pointer_mut(path).unwrap() = json!("invalid");
            assert!(!accepts(value), "{path}");
        }
        let mut value = fixture();
        value["presentation"]["definitions"]
            .as_array_mut()
            .unwrap()
            .reverse();
        assert!(!accepts(value));
        let mut value = fixture();
        value["presentation"]["definitions"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(!accepts(value));
        let mut value = fixture();
        value["presentation"]["definitions"][1] = value["presentation"]["definitions"][0].clone();
        assert!(!accepts(value));
    }

    #[test]
    fn language_coverage_and_hook_references_fail_closed() {
        let mut value = fixture();
        value["languageSelection"]["languages"][0]["questionnaireModuleIds"] = json!(["de-0"]);
        assert!(!accepts(value));
        let mut value = fixture();
        value["questionnaires"]["definitions"]
            .as_array_mut()
            .unwrap()
            .pop();
        value["presentation"]["definitions"]
            .as_array_mut()
            .unwrap()
            .pop();
        value["questionnaires"]["modules"]
            .as_array_mut()
            .unwrap()
            .truncate(2);
        value["languageSelection"]["languages"][1]["questionnaireModuleIds"] = json!([]);
        assert!(!accepts(value));
        let mut value = fixture();
        value["questionnaires"]["modules"][1] = value["questionnaires"]["modules"][0].clone();
        assert!(!accepts(value));
        let mut value = fixture();
        value["languageSelection"]["nodes"][0]["options"][0]["target"]["nodeId"] = json!("group");
        assert!(!accepts(value));
        // Existing placements remain representable; P7, not this content owner,
        // decides whether a selected successor sequence supports each hook.
        let mut value = fixture();
        value["questionnaires"]["modules"][0]["placement"] = json!({"kind":"afterStimulus","blockId":null,"stimulusId":"video-1","relativeToIsi":"after"});
        assert!(accepts(value));
    }
}

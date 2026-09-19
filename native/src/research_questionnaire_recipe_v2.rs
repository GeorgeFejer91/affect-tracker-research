//! Explicit mixed-definition P2 reader. Historical P2/definitions remain separate.
mod routes;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{deserialize_u32_integer, LanguageSelectionTreeV1};
use crate::research_form_definition::{
    decode_form_definition_v1, validate_form_definition_v1, FormDefinitionV1,
};
use crate::research_protocol::{
    QuestionnaireDefinitionV1, QuestionnaireModuleV2, QuestionnairePlacementV2,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq)]
pub enum SupportedQuestionnaireDefinition {
    Likert(QuestionnaireDefinitionV1),
    Form(FormDefinitionV1),
    SurveyJs(crate::research_surveyjs_definition::SurveyDefinitionV1),
}
impl Serialize for SupportedQuestionnaireDefinition {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Likert(value) => value.serialize(serializer),
            Self::Form(value) => value.serialize(serializer),
            Self::SurveyJs(value) => value.serialize(serializer),
        }
    }
}
impl<'de> Deserialize<'de> for SupportedQuestionnaireDefinition {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        if value["version"].as_f64() != Some(1.0) {
            return Err(serde::de::Error::custom("Unsupported definition version."));
        }
        match value["schema"].as_str() {
            Some("affect-research-questionnaire-definition") => serde_json::from_value(value)
                .map(Self::Likert)
                .map_err(serde::de::Error::custom),
            Some("affect-research-form-definition") => decode_form_definition_v1(&value)
                .map(Self::Form)
                .map_err(serde::de::Error::custom),
            Some("affect-research-surveyjs-definition") => serde_json::from_value(value)
                .map(Self::SurveyJs)
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom("Unsupported definition schema.")),
        }
    }
}
impl SupportedQuestionnaireDefinition {
    pub fn questionnaire_id(&self) -> &str {
        match self {
            Self::Likert(d) => &d.questionnaire_id,
            Self::Form(d) => &d.questionnaire_id,
            Self::SurveyJs(d) => &d.questionnaire_id,
        }
    }
    pub fn language(&self) -> &str {
        match self {
            Self::Likert(d) => &d.language,
            Self::Form(d) => &d.language,
            Self::SurveyJs(d) => &d.language,
        }
    }
    pub fn definition_sha256(&self) -> &str {
        match self {
            Self::Likert(d) => &d.definition_sha256,
            Self::Form(d) => &d.definition_sha256,
            Self::SurveyJs(d) => &d.definition_sha256,
        }
    }
    fn validate(&self) -> ResearchResult<()> {
        match self {
            Self::Likert(d) => {
                if d.clone().normalize_and_validate()? != *d {
                    return Err(invalid("Legacy definition must already be canonical."));
                }
                Ok(())
            }
            Self::Form(d) => validate_form_definition_v1(d),
            Self::SurveyJs(d) => d.validate(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireRecipeContributionV2 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub questionnaires: MixedQuestionnaireSettingsV1,
    pub language_selection: LanguageSelectionTreeV1,
    pub presentation: QuestionnairePresentationV2,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MixedQuestionnaireSettingsV1 {
    pub algorithm_version: String,
    pub definitions: Vec<SupportedQuestionnaireDefinition>,
    pub modules: Vec<QuestionnaireModuleV2>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnairePresentationV2 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub definitions: Vec<QuestionnairePresentationEntryV2>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QuestionnairePresentationEntryV2 {
    Likert {
        questionnaire_id: String,
        definition_sha256: String,
        #[serde(deserialize_with = "deserialize_u32_integer")]
        repeat_labels_every: u32,
    },
    Fields {
        questionnaire_id: String,
        definition_sha256: String,
    },
    #[serde(rename = "surveyjs")]
    SurveyJs {
        questionnaire_id: String,
        definition_sha256: String,
    },
}
impl QuestionnairePresentationEntryV2 {
    pub fn questionnaire_id(&self) -> &str {
        match self {
            Self::Likert {
                questionnaire_id, ..
            }
            | Self::Fields {
                questionnaire_id, ..
            }
            | Self::SurveyJs {
                questionnaire_id, ..
            } => questionnaire_id,
        }
    }
    fn definition_sha256(&self) -> &str {
        match self {
            Self::Likert {
                definition_sha256, ..
            }
            | Self::Fields {
                definition_sha256, ..
            }
            | Self::SurveyJs {
                definition_sha256, ..
            } => definition_sha256,
        }
    }
}
fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}
fn family_id(definition: &SupportedQuestionnaireDefinition) -> String {
    match definition.questionnaire_id() {
        "maia-2-en" | "maia-2-de" => return "maia-2".into(),
        "tas-20-en" | "tas-20-de" => return "tas-20".into(),
        "phencon-long-en" | "phencon-long-de" => return "phencon-long".into(),
        "phencon-short-en" | "phencon-short-de" => return "phencon-short".into(),
        _ => {}
    }
    let language = definition.language().to_ascii_lowercase();
    for suffix in [language.as_str(), language.split('-').next().unwrap_or("")] {
        if let Some(id) = definition
            .questionnaire_id()
            .strip_suffix(&format!("-{suffix}"))
        {
            if !id.is_empty() {
                return id.into();
            }
        }
    }
    definition.questionnaire_id().into()
}
impl QuestionnaireRecipeContributionV2 {
    pub fn validate(&self) -> ResearchResult<()> {
        self.validate_version(2)
    }
    pub(crate) fn validate_version(&self, version: u32) -> ResearchResult<()> {
        let algorithm = match version {
            2 => "questionnaire-hooks-v3",
            3 => "questionnaire-hooks-v4",
            _ => return Err(invalid("Unsupported P2 version.")),
        };
        if self.schema != "affect-research-questionnaire-recipe-contribution"
            || self.version != version
            || self.questionnaires.algorithm_version != algorithm
            || self.questionnaires.definitions.len() > 256
            || self.questionnaires.modules.len() > 1024
        {
            return Err(invalid(
                "Unsupported or oversized mixed questionnaire contribution.",
            ));
        }
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
        for definition in &self.questionnaires.definitions {
            if version == 2 && matches!(definition, SupportedQuestionnaireDefinition::SurveyJs(_)) {
                return Err(invalid("SurveyJS definitions require P2 version 3."));
            }
            definition.validate()?;
            if definition.language().eq_ignore_ascii_case("und")
                || !language_tags.contains(definition.language())
            {
                return Err(invalid(
                    "Every definition needs an explicit selected language.",
                ));
            }
            let family = family_id(definition);
            if definitions
                .insert(definition.questionnaire_id(), definition)
                .is_some()
                || !slots.insert((family.clone(), definition.language()))
            {
                return Err(invalid(
                    "Duplicate definition identity or family/language slot.",
                ));
            }
            families.insert(family);
        }
        let mut modules = BTreeMap::new();
        let mut coverage = BTreeSet::new();
        for module in &self.questionnaires.modules {
            if module.clone().normalize_and_validate()? != *module {
                return Err(invalid("Module must already be canonical."));
            }
            if !matches!(
                module.placement,
                QuestionnairePlacementV2::BeforeSession { .. }
                    | QuestionnairePlacementV2::AfterSession { .. }
            ) {
                return Err(invalid(
                    "P2 v2 supports only beforeSession/afterSession placements.",
                ));
            }
            let definition = definitions
                .get(module.questionnaire_id.as_str())
                .ok_or_else(|| invalid("Module has no definition."))?;
            if module.definition_sha256 != definition.definition_sha256()
                || modules.insert(module.module_id.as_str(), module).is_some()
            {
                return Err(invalid(
                    "Module identity or definition hash does not match.",
                ));
            }
            coverage.insert((family_id(definition), definition.language()));
        }
        let mut mapped = BTreeSet::new();
        for language in &self.language_selection.languages {
            for id in &language.questionnaire_module_ids {
                let module = modules
                    .get(id.as_str())
                    .ok_or_else(|| invalid("Language maps an unknown module."))?;
                if definitions[module.questionnaire_id.as_str()].language() != language.language_tag
                {
                    return Err(invalid("Language maps an incompatible definition."));
                }
                mapped.insert(id.as_str());
            }
            for family in &families {
                if !coverage.contains(&(family.clone(), language.language_tag.as_str())) {
                    return Err(invalid("Supply every family in every selected language."));
                }
            }
        }
        if mapped.len() != modules.len() {
            return Err(invalid("Every module needs a language mapping."));
        }
        self.presentation
            .validate_version(&self.questionnaires.definitions, version)
    }
    pub(crate) fn routes(&self) -> ResearchResult<Vec<Value>> {
        routes::questionnaire_routes(self)
    }
}
impl QuestionnairePresentationV2 {
    pub fn validate(&self, definitions: &[SupportedQuestionnaireDefinition]) -> ResearchResult<()> {
        self.validate_version(definitions, 2)
    }
    fn validate_version(
        &self,
        definitions: &[SupportedQuestionnaireDefinition],
        version: u32,
    ) -> ResearchResult<()> {
        if self.schema != "affect-research-questionnaire-presentation"
            || self.version != version
            || self.definitions.len() != definitions.len()
        {
            return Err(invalid(
                "Every definition needs exactly one versioned presentation entry.",
            ));
        }
        for (entry, definition) in self.definitions.iter().zip(definitions) {
            let compatible = matches!(
                (entry, definition),
                (
                    QuestionnairePresentationEntryV2::Likert {
                        repeat_labels_every: 1 | 5 | 10,
                        ..
                    },
                    SupportedQuestionnaireDefinition::Likert(_)
                ) | (
                    QuestionnairePresentationEntryV2::Fields { .. },
                    SupportedQuestionnaireDefinition::Form(_)
                )
            );
            let compatible = compatible
                || (version == 3
                    && matches!(
                        (entry, definition),
                        (
                            QuestionnairePresentationEntryV2::SurveyJs { .. },
                            SupportedQuestionnaireDefinition::SurveyJs(_)
                        )
                    ));
            if !compatible
                || entry.questionnaire_id() != definition.questionnaire_id()
                || entry.definition_sha256() != definition.definition_sha256()
            {
                return Err(invalid(
                    "Presentation kind, order, identity, hash or repetition does not match.",
                ));
            }
        }
        Ok(())
    }
}

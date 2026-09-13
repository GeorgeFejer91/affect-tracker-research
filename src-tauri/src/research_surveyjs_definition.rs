//! SurveyJS JSON has its own versioned definition; old form contracts stay frozen.
use crate::research_contracts::{canonical_json, canonical_sha256};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::deserialize_u32_integer;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurveyDefinitionV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub questionnaire_id: String,
    pub questionnaire_version: String,
    pub title: String,
    pub language: String,
    pub engine_version: String,
    pub completion_policy: String,
    pub source: SurveySource,
    pub survey_json: Value,
    pub definition_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurveySource {
    pub kind: String,
    pub basename: String,
    pub sha256: String,
}
impl SurveyDefinitionV1 {
    pub fn validate(&self) -> ResearchResult<()> {
        let invalid =
            || CommandError::invalid_contract("Invalid SurveyJS definition metadata or hash.");
        let hash = |s: &str| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        let text = |s: &str, max| !s.trim().is_empty() && s.encode_utf16().count() <= max;
        let id = &self.questionnaire_id;
        let mut language = self.language.split('-');
        let first = language.next().unwrap_or("");
        if self.schema != "affect-research-surveyjs-definition"
            || self.version != 1
            || self.engine_version != "3.0.4"
            || self.completion_policy != "allVisibleQuestions"
            || id.is_empty()
            || id.len() > 128
            || !id.as_bytes()[0].is_ascii_alphanumeric()
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || !text(&self.title, 500)
            || !text(&self.questionnaire_version, 120)
            || self.language.len() > 80
            || self.language.eq_ignore_ascii_case("und")
            || !(2..=8).contains(&first.len())
            || !first.bytes().all(|b| b.is_ascii_alphabetic())
            || !language
                .all(|p| (1..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric()))
            || self.source.kind != "researcherJson"
            || self.source.basename.is_empty()
            || self.source.basename.encode_utf16().count() > 255
            || self.source.basename.contains(['/', '\\', '\0'])
            || !hash(&self.source.sha256)
            || !hash(&self.definition_sha256)
            || canonical_json(self, &[])?.len() > 4 * 1024 * 1024
            || canonical_sha256(self, &["definitionSha256"])? != self.definition_sha256
        {
            return Err(invalid());
        }
        crate::research_surveyjs_engine::inspect_survey_json(&self.survey_json)?;
        Ok(())
    }
}

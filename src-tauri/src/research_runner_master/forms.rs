//! Answers reference complete P2 definitions; no renderer-supplied scores/text.
use super::{runtime::MasterChoice, MasterStep, MasterStepKind};
use crate::{
    research_error::{CommandError, ResearchResult},
    research_protocol::QuestionnaireDefinitionV1,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, time::Instant};

#[derive(Default)]
pub(crate) struct FormAnswers {
    choices: BTreeMap<String, (String, f64)>,
}
impl FormAnswers {
    pub(crate) fn projection(&self) -> BTreeMap<String, String> {
        self.choices
            .iter()
            .map(|(id, (option, _))| (id.clone(), option.clone()))
            .collect()
    }
    pub(crate) fn replace(
        &mut self,
        step: &MasterStep,
        choices: Vec<MasterChoice>,
        submitted: bool,
        start: Instant,
        now: Instant,
    ) -> ResearchResult<Value> {
        if step.kind != MasterStepKind::Questionnaire {
            return Err(CommandError::invalid_contract(
                "Answers must target the current form.",
            ));
        }
        let definition: QuestionnaireDefinitionV1 =
            serde_json::from_value(step.payload["definition"].clone()).map_err(|_| {
                CommandError::invalid_contract(
                    "The frozen questionnaire definition is unavailable.",
                )
            })?;
        let latency = now.saturating_duration_since(start).as_secs_f64() * 1000.;
        if choices.len() > definition.items.len() {
            return Err(CommandError::invalid_contract(
                "Too many answers for the frozen questionnaire.",
            ));
        }
        if latency > 86_400_000. {
            return Err(CommandError::forbidden(
                "Questionnaire response latency exceeds the supported bound.",
            ));
        }
        let mut next = BTreeMap::new();
        for choice in choices {
            let item = definition
                .items
                .iter()
                .find(|i| i.item_id == choice.item_id)
                .ok_or_else(|| {
                    CommandError::invalid_contract("Unknown frozen questionnaire item.")
                })?;
            if !item.options.iter().any(|o| o.option_id == choice.option_id)
                || next.contains_key(&choice.item_id)
            {
                return Err(CommandError::invalid_contract(
                    "Duplicate questionnaire item or unknown frozen option.",
                ));
            }
            let observed = self
                .choices
                .get(&choice.item_id)
                .filter(|(option, _)| *option == choice.option_id)
                .map(|(_, ms)| *ms)
                .unwrap_or(latency);
            next.insert(choice.item_id, (choice.option_id, observed));
        }
        if submitted
            && definition
                .items
                .iter()
                .any(|i| i.required && !next.contains_key(&i.item_id))
        {
            return Err(CommandError::invalid_contract(
                "Answer every required questionnaire item before continuing.",
            ));
        }
        let mut responses = Vec::new();
        for item in &definition.items {
            if let Some((id, latency)) = next.get(&item.item_id) {
                let option = item
                    .options
                    .iter()
                    .find(|o| o.option_id == *id)
                    .ok_or_else(|| {
                        CommandError::invalid_contract("Unknown questionnaire option.")
                    })?;
                responses.push(json!({"itemId":item.item_id,"itemOrder":item.order,"optionId":option.option_id,"optionOrder":option.order,"responseLabel":option.label,"scoreValue":option.score_value,"subscale":item.subscale,"responseLatencyMs":latency}));
            }
        }
        self.choices = next;
        Ok(
            json!({"schema":"affect-runner-master-responses","version":1,"entryId":step.entry_id,"position":step.position,"module":step.payload["module"],"questionnaireId":definition.questionnaire_id,"questionnaireVersion":definition.questionnaire_version,"definitionSha256":definition.definition_sha256,"status":if submitted {"submitted"} else {"draft"},"responses":responses}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_required_codes_and_keeps_native_choice_latency() {
        let prepared = crate::research_runner_master::PreparedMaster::read(
            include_str!(
                "../../../test/fixtures/planner-recipe-locations-current-v1.canonical.json"
            ),
            "P001",
            crate::research_runner_master::MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        let step = &prepared.plan.steps[0];
        let now = Instant::now();
        let mut answers = FormAnswers::default();
        assert!(answers.replace(step, vec![], true, now, now).is_err());
        let item = &step.payload["definition"]["items"][0];
        let choice = MasterChoice {
            item_id: item["itemId"].as_str().unwrap().into(),
            option_id: item["options"][0]["optionId"].as_str().unwrap().into(),
        };
        assert!(answers
            .replace(step, vec![choice.clone(), choice.clone()], false, now, now)
            .is_err());
        assert!(answers
            .replace(
                step,
                vec![MasterChoice {
                    option_id: "unknown".into(),
                    ..choice.clone()
                }],
                false,
                now,
                now
            )
            .is_err());
        let draft = answers
            .replace(
                step,
                vec![choice.clone()],
                false,
                now,
                now + std::time::Duration::from_millis(100),
            )
            .unwrap();
        let submitted = answers
            .replace(
                step,
                vec![choice],
                true,
                now,
                now + std::time::Duration::from_secs(1),
            )
            .unwrap();
        assert_eq!(draft["responses"], submitted["responses"]);
        assert_eq!(submitted["status"], "submitted");
        assert_eq!(submitted["responses"][0]["responseLatencyMs"], 100.);
        assert_eq!(
            submitted["responses"][0]["scoreValue"],
            item["options"][0]["scoreValue"]
        );
    }
}

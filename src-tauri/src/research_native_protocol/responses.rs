use super::contracts::{ProtocolStepV2, ResolvedProtocolPlanV2};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_protocol::{
    QuestionnaireAnswerInputV1, QuestionnaireResponseStatusV1, QuestionnaireResponseV1,
    ResearchSettingsV3, QUESTIONNAIRE_RESPONSE_SCHEMA,
};
use std::collections::{BTreeMap, BTreeSet};

#[allow(clippy::too_many_arguments)]
pub fn derive_questionnaire_responses_v3(
    settings: &ResearchSettingsV3,
    protocol_plan: &ResolvedProtocolPlanV2,
    protocol_step_position: u32,
    answers: &[QuestionnaireAnswerInputV1],
    status: QuestionnaireResponseStatusV1,
    first_sequence: u64,
    run_id: &str,
    attempt_number: u32,
    wall_time_utc: &str,
    monotonic_time_ns: &str,
) -> ResearchResult<Vec<QuestionnaireResponseV1>> {
    let step = protocol_plan.step(protocol_step_position).ok_or_else(|| {
        CommandError::invalid_contract("The questionnaire protocol step is unavailable.")
    })?;
    let ProtocolStepV2::Questionnaire {
        module_id,
        questionnaire_id,
        definition_sha256,
        ..
    } = step
    else {
        return Err(CommandError::invalid_contract(
            "Questionnaire answers cannot target a media protocol step.",
        ));
    };
    if protocol_plan.settings_sha256 != settings.canonical_sha256()? {
        return Err(CommandError::invalid_contract(
            "Questionnaire answers do not bind the frozen package settings.",
        ));
    }
    let definition = settings
        .questionnaires
        .definitions
        .iter()
        .find(|definition| definition.questionnaire_id == *questionnaire_id)
        .ok_or_else(|| {
            CommandError::invalid_contract("The questionnaire definition is unavailable.")
        })?;
    if definition.definition_sha256 != *definition_sha256 {
        return Err(CommandError::invalid_contract(
            "The questionnaire protocol step has a different definition hash.",
        ));
    }
    let mut by_item = BTreeMap::new();
    for answer in answers {
        if by_item.insert(answer.item_id.as_str(), answer).is_some()
            || !answer.response_latency_ms.is_finite()
            || !(0.0..=86_400_000.0).contains(&answer.response_latency_ms)
        {
            return Err(CommandError::invalid_contract(
                "Questionnaire answers contain a duplicate item or invalid latency.",
            ));
        }
    }
    if answers.len() > definition.items.len()
        || (status == QuestionnaireResponseStatusV1::Submitted
            && definition
                .items
                .iter()
                .any(|item| item.required && !by_item.contains_key(item.item_id.as_str())))
    {
        return Err(CommandError::invalid_contract(
            "A submitted questionnaire must answer every required frozen item.",
        ));
    }
    let known_items = definition
        .items
        .iter()
        .map(|item| item.item_id.as_str())
        .collect::<BTreeSet<_>>();
    if by_item.keys().any(|item_id| !known_items.contains(item_id)) {
        return Err(CommandError::invalid_contract(
            "Questionnaire answers contain an unknown frozen item.",
        ));
    }

    let mut responses = Vec::with_capacity(answers.len());
    for item in &definition.items {
        let Some(answer) = by_item.get(item.item_id.as_str()) else {
            continue;
        };
        let option = item
            .options
            .iter()
            .find(|option| option.option_id == answer.option_id)
            .ok_or_else(|| {
                CommandError::invalid_contract(
                    "A questionnaire answer uses an unknown frozen option.",
                )
            })?;
        let sequence = first_sequence
            .checked_add(responses.len() as u64)
            .filter(|sequence| *sequence <= 9_007_199_254_740_991)
            .ok_or_else(|| {
                CommandError::invalid_contract("Questionnaire response sequence overflowed.")
            })?;
        let response = QuestionnaireResponseV1 {
            schema: QUESTIONNAIRE_RESPONSE_SCHEMA.to_owned(),
            version: 1,
            sequence,
            run_id: run_id.to_owned(),
            participant_id: protocol_plan.participant_id.clone(),
            attempt_number,
            settings_sha256: protocol_plan.settings_sha256.clone(),
            assignment_plan_sha256: protocol_plan.assignment_plan_sha256.clone(),
            protocol_plan_sha256: protocol_plan.protocol_plan_hash_sha256.clone(),
            protocol_step_position,
            module_id: module_id.clone(),
            questionnaire_id: questionnaire_id.clone(),
            questionnaire_version: definition.questionnaire_version.clone(),
            definition_sha256: definition.definition_sha256.clone(),
            item_id: item.item_id.clone(),
            item_order: item.order,
            option_id: option.option_id.clone(),
            option_order: option.order,
            response_label: option.label.clone(),
            score_value: option.score_value,
            subscale: item.subscale.clone(),
            status,
            wall_time_utc: wall_time_utc.to_owned(),
            monotonic_time_ns: monotonic_time_ns.to_owned(),
            response_latency_ms: answer.response_latency_ms,
        };
        response.validate()?;
        responses.push(response);
    }
    Ok(responses)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_experiment_package::parse_experiment_package_bytes;
    use crate::research_native_protocol::compiler::compile_package_selection;

    #[test]
    fn derives_only_frozen_labels_scores_and_hashes() {
        let loaded = parse_experiment_package_bytes(include_bytes!(
            "../../../test/fixtures/experiment-package-v1.canonical.json"
        ))
        .unwrap();
        let selected = compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "en",
            &["en".to_owned()],
            "P001",
        )
        .unwrap();
        let questionnaire_position = selected
            .protocol_plan
            .steps
            .iter()
            .find_map(|step| match step {
                ProtocolStepV2::Questionnaire {
                    protocol_position, ..
                } => Some(*protocol_position),
                _ => None,
            })
            .unwrap();
        let definition = &selected.settings.questionnaires.definitions[0];
        let answers = definition
            .items
            .iter()
            .map(|item| QuestionnaireAnswerInputV1 {
                item_id: item.item_id.clone(),
                option_id: item.options[0].option_id.clone(),
                response_latency_ms: 125.0,
            })
            .collect::<Vec<_>>();
        let responses = derive_questionnaire_responses_v3(
            &selected.settings,
            &selected.protocol_plan,
            questionnaire_position,
            &answers,
            QuestionnaireResponseStatusV1::Submitted,
            1,
            "00000000-0000-4000-8000-000000000000",
            1,
            "2026-09-10T12:00:00.000Z",
            "1",
        )
        .unwrap();
        assert_eq!(responses.len(), definition.items.len());
        assert_eq!(
            responses[0].response_label,
            definition.items[0].options[0].label
        );
        assert_eq!(
            responses[0].protocol_plan_sha256,
            selected.protocol_plan.protocol_plan_hash_sha256
        );
    }
}

use crate::research_contracts::{
    canonical_sha256, validate_participant_id, validate_sha256, StimulusV1,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_external_protocol::{ExperimentBlockV1, EXTERNAL_ORDER_ALGORITHM_VERSION};
use crate::research_protocol::{QuestionnaireRelativeToIsiV1, RESEARCH_PROTOCOL_PLAN_SCHEMA};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

const RESOLVED_EXPERIMENT_PLAN_SCHEMA: &str = "affect-research-experiment-plan";
const MAX_PROTOCOL_STEPS: usize = 40_000;
const EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION: &str = "external-questionnaire-hooks-v1";

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn contract_error(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}

fn require_identifier(value: &str, label: &str) -> ResearchResult<()> {
    let mut bytes = value.bytes();
    let valid = bytes
        .next()
        .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit())
        && bytes.all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        });
    if !valid || value.len() > 128 {
        return Err(contract_error(format!(
            "{label} must be a lowercase canonical identifier."
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedExperimentPlanV1 {
    pub schema: String,
    pub version: u32,
    pub algorithm_version: String,
    pub experiment_id: String,
    pub title: String,
    pub settings_sha256: String,
    pub source_byte_sha256: String,
    pub definition_sha256: String,
    pub participant_ids: Vec<String>,
    pub stimuli: Vec<StimulusV1>,
    pub blocks: Vec<ExperimentBlockV1>,
    pub assignments: Vec<ResolvedExperimentAssignmentV1>,
    pub plan_hash_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedExperimentAssignmentV1 {
    pub participant_id: String,
    pub block_order: Vec<String>,
    pub slots: Vec<ResolvedExperimentSlotV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedExperimentSlotV1 {
    pub position: u32,
    pub block_id: String,
    pub pool_position: u32,
    pub stimulus_id: String,
    pub isi_after_ms: u32,
}

impl ResolvedExperimentPlanV1 {
    pub fn validate_self(&self) -> ResearchResult<()> {
        if self.schema != RESOLVED_EXPERIMENT_PLAN_SCHEMA
            || self.version != 1
            || self.algorithm_version != EXTERNAL_ORDER_ALGORITHM_VERSION
        {
            return Err(contract_error(
                "ResolvedExperimentPlanV1 schema, version, or algorithm is unsupported.",
            ));
        }
        require_identifier(&self.experiment_id, "ResolvedExperimentPlanV1.experimentId")?;
        validate_sha256(
            &self.settings_sha256,
            "ResolvedExperimentPlanV1.settingsSha256",
        )?;
        validate_sha256(
            &self.source_byte_sha256,
            "ResolvedExperimentPlanV1.sourceByteSha256",
        )?;
        validate_sha256(
            &self.definition_sha256,
            "ResolvedExperimentPlanV1.definitionSha256",
        )?;
        validate_sha256(
            &self.plan_hash_sha256,
            "ResolvedExperimentPlanV1.planHashSha256",
        )?;
        if self.participant_ids.is_empty()
            || self.participant_ids.len() != self.assignments.len()
            || self.blocks.is_empty()
            || self.stimuli.is_empty()
        {
            return Err(contract_error(
                "ResolvedExperimentPlanV1 registries and assignments must be nonempty and aligned.",
            ));
        }
        let known_blocks = self
            .blocks
            .iter()
            .map(|block| block.block_id.as_str())
            .collect::<BTreeSet<_>>();
        let known_stimuli = self
            .stimuli
            .iter()
            .map(|stimulus| stimulus.stimulus_id.as_str())
            .collect::<BTreeSet<_>>();
        if known_blocks.len() != self.blocks.len() || known_stimuli.len() != self.stimuli.len() {
            return Err(contract_error(
                "ResolvedExperimentPlanV1 repeats a block or stimulus.",
            ));
        }
        for (index, participant_id) in self.participant_ids.iter().enumerate() {
            validate_participant_id(participant_id)?;
            let assignment = &self.assignments[index];
            if assignment.participant_id != *participant_id
                || assignment.block_order.len() != self.blocks.len()
                || assignment.block_order.iter().collect::<BTreeSet<_>>().len()
                    != known_blocks.len()
                || assignment
                    .block_order
                    .iter()
                    .any(|block_id| !known_blocks.contains(block_id.as_str()))
                || assignment.slots.is_empty()
            {
                return Err(contract_error(
                    "ResolvedExperimentPlanV1 participant assignment is not aligned to its registries.",
                ));
            }
            let mut seen_stimuli = BTreeSet::new();
            let mut cursor = 0usize;
            for block_id in &assignment.block_order {
                let mut pool_position = 1u32;
                while let Some(slot) = assignment.slots.get(cursor) {
                    if slot.block_id != *block_id {
                        break;
                    }
                    if slot.position as usize != cursor + 1
                        || slot.pool_position != pool_position
                        || !known_stimuli.contains(slot.stimulus_id.as_str())
                        || !seen_stimuli.insert(slot.stimulus_id.as_str())
                        || slot.isi_after_ms > 3_600_000
                    {
                        return Err(contract_error(
                            "ResolvedExperimentPlanV1 contains an invalid or repeated participant slot.",
                        ));
                    }
                    cursor += 1;
                    pool_position += 1;
                }
                if pool_position == 1 {
                    return Err(contract_error(
                        "ResolvedExperimentPlanV1 contains an empty participant block.",
                    ));
                }
            }
            if cursor != assignment.slots.len() {
                return Err(contract_error(
                    "ResolvedExperimentPlanV1 slots do not form contiguous block groups.",
                ));
            }
        }
        if canonical_sha256(self, &["planHashSha256"])? != self.plan_hash_sha256 {
            return Err(contract_error(
                "ResolvedExperimentPlanV1 plan hash does not match its canonical content.",
            ));
        }
        Ok(())
    }

    pub fn assignment_for(&self, participant_id: &str) -> Option<&ResolvedExperimentAssignmentV1> {
        self.assignments
            .iter()
            .find(|assignment| assignment.participant_id == participant_id)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuestionnaireStepPlacementV2 {
    BeforeSession,
    AfterSession,
    BeforeBlock,
    AfterBlock,
    AfterStimulus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProtocolStepV2 {
    Questionnaire {
        protocol_position: u32,
        #[serde(deserialize_with = "deserialize_required_option")]
        block_position: Option<u32>,
        #[serde(deserialize_with = "deserialize_required_option")]
        block_id: Option<String>,
        module_id: String,
        questionnaire_id: String,
        definition_sha256: String,
        placement: QuestionnaireStepPlacementV2,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stimulus_position: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        block_stimulus_position: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stimulus_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        relative_to_isi: Option<QuestionnaireRelativeToIsiV1>,
    },
    Stimulus {
        protocol_position: u32,
        stimulus_position: u32,
        block_position: u32,
        block_id: String,
        block_stimulus_position: u32,
        stimulus_id: String,
    },
    Interval {
        protocol_position: u32,
        stimulus_position: u32,
        block_position: u32,
        block_id: String,
        block_stimulus_position: u32,
        stimulus_id: String,
        duration_ms: u32,
    },
}

impl ProtocolStepV2 {
    pub fn protocol_position(&self) -> u32 {
        match self {
            Self::Questionnaire {
                protocol_position, ..
            }
            | Self::Stimulus {
                protocol_position, ..
            }
            | Self::Interval {
                protocol_position, ..
            } => *protocol_position,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedProtocolPlanV2 {
    pub schema: String,
    pub version: u32,
    pub algorithm_version: String,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub participant_id: String,
    pub block_order: Vec<String>,
    pub steps: Vec<ProtocolStepV2>,
    pub protocol_plan_hash_sha256: String,
}

impl ResolvedProtocolPlanV2 {
    pub fn validate_self(&self) -> ResearchResult<()> {
        if self.schema != RESEARCH_PROTOCOL_PLAN_SCHEMA
            || self.version != 2
            || self.algorithm_version != EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION
        {
            return Err(contract_error(
                "ResolvedProtocolPlanV2 schema, version, or algorithm is unsupported.",
            ));
        }
        validate_sha256(
            &self.settings_sha256,
            "ResolvedProtocolPlanV2.settingsSha256",
        )?;
        validate_sha256(
            &self.assignment_plan_sha256,
            "ResolvedProtocolPlanV2.assignmentPlanSha256",
        )?;
        validate_sha256(
            &self.protocol_plan_hash_sha256,
            "ResolvedProtocolPlanV2.protocolPlanHashSha256",
        )?;
        validate_participant_id(&self.participant_id)?;
        if self.block_order.is_empty()
            || self.block_order.len() > 256
            || self.steps.len() < 2
            || self.steps.len() > MAX_PROTOCOL_STEPS
        {
            return Err(contract_error(
                "ResolvedProtocolPlanV2 block or step count is outside supported bounds.",
            ));
        }
        let block_ids = self.block_order.iter().collect::<BTreeSet<_>>();
        if block_ids.len() != self.block_order.len() {
            return Err(contract_error("ResolvedProtocolPlanV2 repeats a block ID."));
        }
        for (index, step) in self.steps.iter().enumerate() {
            if step.protocol_position() as usize != index + 1 {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 positions must be contiguous and one-based.",
                ));
            }
            validate_step(step, &self.block_order)?;
        }
        validate_step_order(&self.steps, &self.block_order)?;
        if canonical_sha256(self, &["protocolPlanHashSha256"])? != self.protocol_plan_hash_sha256 {
            return Err(contract_error(
                "ResolvedProtocolPlanV2 protocol hash does not match its canonical content.",
            ));
        }
        Ok(())
    }

    pub fn step(&self, protocol_position: u32) -> Option<&ProtocolStepV2> {
        self.steps.get(protocol_position.saturating_sub(1) as usize)
    }
}

fn validate_step(step: &ProtocolStepV2, block_order: &[String]) -> ResearchResult<()> {
    match step {
        ProtocolStepV2::Questionnaire {
            block_position,
            block_id,
            module_id,
            questionnaire_id,
            definition_sha256,
            placement,
            stimulus_position,
            block_stimulus_position,
            stimulus_id,
            relative_to_isi,
            ..
        } => {
            require_identifier(module_id, "ResolvedProtocolPlanV2.moduleId")?;
            require_identifier(questionnaire_id, "ResolvedProtocolPlanV2.questionnaireId")?;
            validate_sha256(definition_sha256, "ResolvedProtocolPlanV2.definitionSha256")?;
            let session = matches!(
                placement,
                QuestionnaireStepPlacementV2::BeforeSession
                    | QuestionnaireStepPlacementV2::AfterSession
            );
            if session {
                if block_position.is_some()
                    || block_id.is_some()
                    || stimulus_position.is_some()
                    || block_stimulus_position.is_some()
                    || stimulus_id.is_some()
                    || relative_to_isi.is_some()
                {
                    return Err(contract_error(
                        "Session questionnaire steps cannot carry block or stimulus identity.",
                    ));
                }
            } else {
                validate_block_identity(*block_position, block_id.as_deref(), block_order)?;
                let after_stimulus = *placement == QuestionnaireStepPlacementV2::AfterStimulus;
                if after_stimulus
                    != (stimulus_position.is_some()
                        && block_stimulus_position.is_some()
                        && stimulus_id.is_some()
                        && relative_to_isi.is_some())
                {
                    return Err(contract_error(
                        "After-stimulus questionnaire identity is incomplete or appears on another placement.",
                    ));
                }
                if after_stimulus {
                    if stimulus_position == &Some(0) || block_stimulus_position == &Some(0) {
                        return Err(contract_error(
                            "After-stimulus questionnaire positions must be positive.",
                        ));
                    }
                    require_identifier(
                        stimulus_id.as_deref().unwrap_or_default(),
                        "ResolvedProtocolPlanV2.stimulusId",
                    )?;
                }
            }
        }
        ProtocolStepV2::Stimulus {
            stimulus_position,
            block_position,
            block_id,
            block_stimulus_position,
            stimulus_id,
            ..
        }
        | ProtocolStepV2::Interval {
            stimulus_position,
            block_position,
            block_id,
            block_stimulus_position,
            stimulus_id,
            ..
        } => {
            validate_block_identity(Some(*block_position), Some(block_id), block_order)?;
            if *stimulus_position == 0 || *block_stimulus_position == 0 {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 media positions must be positive.",
                ));
            }
            require_identifier(stimulus_id, "ResolvedProtocolPlanV2.stimulusId")?;
            if matches!(step, ProtocolStepV2::Interval { duration_ms, .. } if *duration_ms > 3_600_000)
            {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 interval duration is outside 0–3600000 ms.",
                ));
            }
        }
    }
    Ok(())
}

fn validate_block_identity(
    block_position: Option<u32>,
    block_id: Option<&str>,
    block_order: &[String],
) -> ResearchResult<()> {
    let position = block_position
        .ok_or_else(|| contract_error("ResolvedProtocolPlanV2 step requires a block position."))?;
    let block_id = block_id
        .ok_or_else(|| contract_error("ResolvedProtocolPlanV2 step requires a block ID."))?;
    require_identifier(block_id, "ResolvedProtocolPlanV2.blockId")?;
    if position == 0
        || position as usize > block_order.len()
        || block_order[position as usize - 1] != block_id
    {
        return Err(contract_error(
            "ResolvedProtocolPlanV2 step block does not match blockOrder.",
        ));
    }
    Ok(())
}

fn validate_step_order(steps: &[ProtocolStepV2], block_order: &[String]) -> ResearchResult<()> {
    let mut cursor = 0usize;
    let mut seen_modules = BTreeSet::new();
    for step in steps {
        if let ProtocolStepV2::Questionnaire { module_id, .. } = step {
            if !seen_modules.insert(module_id.as_str()) {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 repeats a questionnaire module.",
                ));
            }
        }
    }
    while matches!(
        steps.get(cursor),
        Some(ProtocolStepV2::Questionnaire {
            placement: QuestionnaireStepPlacementV2::BeforeSession,
            ..
        })
    ) {
        cursor += 1;
    }
    let mut expected_stimulus_position = 1u32;
    for (block_index, expected_block) in block_order.iter().enumerate() {
        let block_position = (block_index + 1) as u32;
        while matches!(
            steps.get(cursor),
            Some(ProtocolStepV2::Questionnaire {
                placement: QuestionnaireStepPlacementV2::BeforeBlock,
                block_id: Some(block_id),
                block_position: Some(position),
                ..
            }) if block_id == expected_block && *position == block_position
        ) {
            cursor += 1;
        }
        let mut expected_block_stimulus_position = 1u32;
        while let Some(ProtocolStepV2::Stimulus {
            stimulus_position,
            block_position: observed_block_position,
            block_id,
            block_stimulus_position,
            stimulus_id,
            ..
        }) = steps.get(cursor)
        {
            if block_id != expected_block || *observed_block_position != block_position {
                break;
            }
            if *stimulus_position != expected_stimulus_position
                || *block_stimulus_position != expected_block_stimulus_position
            {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 stimulus positions are not contiguous.",
                ));
            }
            cursor += 1;
            while matches!(
                steps.get(cursor),
                Some(ProtocolStepV2::Questionnaire {
                    placement: QuestionnaireStepPlacementV2::AfterStimulus,
                    relative_to_isi: Some(QuestionnaireRelativeToIsiV1::Before),
                    stimulus_position: Some(position),
                    stimulus_id: Some(observed_stimulus),
                    ..
                }) if *position == *stimulus_position && observed_stimulus == stimulus_id
            ) {
                cursor += 1;
            }
            let Some(ProtocolStepV2::Interval {
                stimulus_position: interval_position,
                block_position: interval_block_position,
                block_id: interval_block_id,
                block_stimulus_position: interval_block_stimulus_position,
                stimulus_id: interval_stimulus_id,
                ..
            }) = steps.get(cursor)
            else {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 requires one interval after every stimulus.",
                ));
            };
            if *interval_position != *stimulus_position
                || *interval_block_position != block_position
                || interval_block_id != expected_block
                || *interval_block_stimulus_position != expected_block_stimulus_position
                || interval_stimulus_id != stimulus_id
            {
                return Err(contract_error(
                    "ResolvedProtocolPlanV2 interval does not bind its stimulus.",
                ));
            }
            cursor += 1;
            while matches!(
                steps.get(cursor),
                Some(ProtocolStepV2::Questionnaire {
                    placement: QuestionnaireStepPlacementV2::AfterStimulus,
                    relative_to_isi: Some(QuestionnaireRelativeToIsiV1::After),
                    stimulus_position: Some(position),
                    stimulus_id: Some(observed_stimulus),
                    ..
                }) if *position == *stimulus_position && observed_stimulus == stimulus_id
            ) {
                cursor += 1;
            }
            expected_stimulus_position += 1;
            expected_block_stimulus_position += 1;
        }
        if expected_block_stimulus_position == 1 {
            return Err(contract_error(
                "ResolvedProtocolPlanV2 contains an empty block.",
            ));
        }
        while matches!(
            steps.get(cursor),
            Some(ProtocolStepV2::Questionnaire {
                placement: QuestionnaireStepPlacementV2::AfterBlock,
                block_id: Some(block_id),
                block_position: Some(position),
                ..
            }) if block_id == expected_block && *position == block_position
        ) {
            cursor += 1;
        }
    }
    while matches!(
        steps.get(cursor),
        Some(ProtocolStepV2::Questionnaire {
            placement: QuestionnaireStepPlacementV2::AfterSession,
            ..
        })
    ) {
        cursor += 1;
    }
    if cursor != steps.len() {
        return Err(contract_error(
            "ResolvedProtocolPlanV2 steps do not follow session, block, stimulus, and interval order.",
        ));
    }
    Ok(())
}

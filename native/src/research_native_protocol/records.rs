use super::compiler::CompiledPackageSelectionV1;
use crate::research_contracts::{
    canonical_sha256, validate_participant_id, validate_sha256, CompletionStatusV1, GenderCodeV1,
    HandednessCodeV1, RecoverySummaryV1, ResearchBuildV1, SampleStimulusIdentityV1,
    RESEARCH_RUN_MANIFEST_SCHEMA,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_protocol::{
    QuestionnaireDefinitionReceiptV1, QuestionnaireDraftV1, QuestionnaireModuleReceiptV1,
    QuestionnaireModuleStatusV1, RunPlaybackModeV3, RunPlaybackQualificationV3,
    RunProtocolSummaryV3, RunTimingV3,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

pub const PACKAGE_RECOVERY_JOURNAL_SCHEMA: &str = "affect-research-native-package-recovery-journal";

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentPackageRunReceiptV1 {
    pub canonical_source_byte_sha256: String,
    pub package_definition_sha256: String,
    pub package_id: String,
    pub language_id: String,
    pub language_selection_path: Vec<String>,
    pub assignment_sha256: String,
    pub asset_bindings_sha256: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum RunOutputKindV4 {
    Settings,
    ExperimentSource,
    ExperimentPlan,
    ExperimentPackage,
    ProtocolPlan,
    Events,
    RatingsCsv,
    RatingsTsv,
    QuestionnaireCsv,
    QuestionnaireTsv,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunOutputV4 {
    pub kind: RunOutputKindV4,
    pub file_name: String,
    pub sha256: String,
    pub byte_length: u64,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub row_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchRunManifestV4 {
    pub schema: String,
    pub version: u32,
    pub run_id: String,
    pub experiment_id: String,
    pub participant_id: String,
    pub participant_code: String,
    pub age: u8,
    pub gender: GenderCodeV1,
    pub handedness: HandednessCodeV1,
    pub attempt_number: u32,
    pub session_stem: String,
    pub completion_status: CompletionStatusV1,
    pub playback_mode: RunPlaybackModeV3,
    pub playback_qualification: RunPlaybackQualificationV3,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub stimuli: Vec<SampleStimulusIdentityV1>,
    pub protocol: RunProtocolSummaryV3,
    pub timing: RunTimingV3,
    pub outputs: Vec<RunOutputV4>,
    pub recovery: RecoverySummaryV1,
    pub build: ResearchBuildV1,
    pub experiment_package: ExperimentPackageRunReceiptV1,
}

impl ResearchRunManifestV4 {
    pub fn validate_bindings(&self, selection: &CompiledPackageSelectionV1) -> ResearchResult<()> {
        if self.schema != RESEARCH_RUN_MANIFEST_SCHEMA || self.version != 4 {
            return Err(contract_error(
                "ResearchRunManifestV4 schema or version is unsupported.",
            ));
        }
        validate_uuid(&self.run_id, "ResearchRunManifestV4.runId")?;
        validate_participant_id(&self.participant_id)?;
        validate_sha256(
            &self.settings_sha256,
            "ResearchRunManifestV4.settingsSha256",
        )?;
        validate_sha256(
            &self.assignment_plan_sha256,
            "ResearchRunManifestV4.assignmentPlanSha256",
        )?;
        validate_sha256(
            &self.protocol_plan_sha256,
            "ResearchRunManifestV4.protocolPlanSha256",
        )?;
        if self.participant_id != selection.participant_id
            || self.experiment_id != selection.settings.experiment.id
            || self.settings_sha256 != selection.settings_sha256
            || self.assignment_plan_sha256 != selection.experiment_plan.plan_hash_sha256
            || self.protocol_plan_sha256 != selection.protocol_plan.protocol_plan_hash_sha256
            || self.experiment_package.canonical_source_byte_sha256
                != selection.package_source_byte_sha256
            || self.experiment_package.package_definition_sha256
                != selection.package_definition_sha256
            || self.experiment_package.package_id != selection.package_id
            || self.experiment_package.language_id != selection.language_id
            || self.experiment_package.language_selection_path != selection.language_selection_path
            || self.experiment_package.assignment_sha256 != selection.assignment_sha256
        {
            return Err(contract_error(
                "ResearchRunManifestV4 does not bind the exact compiled package selection.",
            ));
        }
        if self.age == 0
            || self.age > 120
            || self.attempt_number == 0
            || self.attempt_number > 999_999
            || self.protocol.protocol_step_count != selection.protocol_plan.steps.len() as u32
            || self.protocol.safe_protocol_step_position > self.protocol.protocol_step_count
        {
            return Err(contract_error(
                "ResearchRunManifestV4 demographic, attempt, or protocol bounds are invalid.",
            ));
        }
        if self.completion_status == CompletionStatusV1::Completed
            && self.protocol.safe_protocol_step_position != self.protocol.protocol_step_count
        {
            return Err(contract_error(
                "A completed ResearchRunManifestV4 must finish every protocol step.",
            ));
        }
        let kinds = self
            .outputs
            .iter()
            .map(|output| output.kind)
            .collect::<BTreeSet<_>>();
        let names = self
            .outputs
            .iter()
            .map(|output| output.file_name.as_str())
            .collect::<BTreeSet<_>>();
        if kinds.len() != self.outputs.len()
            || names.len() != self.outputs.len()
            || ![
                RunOutputKindV4::Settings,
                RunOutputKindV4::ExperimentSource,
                RunOutputKindV4::ExperimentPlan,
                RunOutputKindV4::ExperimentPackage,
                RunOutputKindV4::ProtocolPlan,
                RunOutputKindV4::Events,
            ]
            .iter()
            .all(|kind| kinds.contains(kind))
            || ![RunOutputKindV4::RatingsCsv, RunOutputKindV4::RatingsTsv]
                .iter()
                .any(|kind| kinds.contains(kind))
            || ![
                RunOutputKindV4::QuestionnaireCsv,
                RunOutputKindV4::QuestionnaireTsv,
            ]
            .iter()
            .any(|kind| kinds.contains(kind))
        {
            return Err(contract_error(
                "ResearchRunManifestV4 lacks a mandatory unique output kind.",
            ));
        }
        for output in &self.outputs {
            validate_sha256(&output.sha256, "ResearchRunManifestV4.output.sha256")?;
            if output.byte_length == 0
                || output.file_name.is_empty()
                || output.file_name.len() > 240
                || output.file_name.contains(['/', '\\'])
            {
                return Err(contract_error(
                    "ResearchRunManifestV4 contains an invalid output receipt.",
                ));
            }
            let table = matches!(
                output.kind,
                RunOutputKindV4::RatingsCsv
                    | RunOutputKindV4::RatingsTsv
                    | RunOutputKindV4::QuestionnaireCsv
                    | RunOutputKindV4::QuestionnaireTsv
            );
            if table != output.row_count.is_some() {
                return Err(contract_error(
                    "ResearchRunManifestV4 table row count presence is inconsistent.",
                ));
            }
            if matches!(
                output.kind,
                RunOutputKindV4::RatingsCsv | RunOutputKindV4::RatingsTsv
            ) && output.row_count != Some(self.timing.sample_count)
            {
                return Err(contract_error(
                    "ResearchRunManifestV4 rating rows differ from the sample count.",
                ));
            }
            if matches!(
                output.kind,
                RunOutputKindV4::QuestionnaireCsv | RunOutputKindV4::QuestionnaireTsv
            ) && output.row_count
                != Some(
                    self.protocol
                        .submitted_response_count
                        .saturating_add(self.protocol.draft_response_count),
                )
            {
                return Err(contract_error(
                    "ResearchRunManifestV4 questionnaire rows differ from response counts.",
                ));
            }
        }
        let package_output = self
            .outputs
            .iter()
            .find(|output| output.kind == RunOutputKindV4::ExperimentPackage)
            .ok_or_else(|| contract_error("ResearchRunManifestV4 lacks its package output."))?;
        if package_output.file_name != "experiment.package.json"
            || package_output.sha256 != self.experiment_package.canonical_source_byte_sha256
        {
            return Err(contract_error(
                "ResearchRunManifestV4 package output does not bind its package receipt.",
            ));
        }
        if self.timing.gap_event_count > self.timing.event_count
            || (self.timing.gap_event_count == 0) != (self.timing.missed_slot_count == 0)
            || self.timing.questionnaire_submitted_response_count
                != self.protocol.submitted_response_count
            || self.timing.questionnaire_draft_response_count != self.protocol.draft_response_count
        {
            return Err(contract_error(
                "ResearchRunManifestV4 timing and response totals are inconsistent.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingPackageFinalizationV1 {
    pub completion_status: CompletionStatusV1,
    pub manifest: ResearchRunManifestV4,
    pub terminal_event_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageRecoveryJournalV1 {
    pub schema: String,
    pub version: u32,
    pub recovery_id: String,
    pub run_id: String,
    pub experiment_id: String,
    pub participant_id: String,
    pub participant_code: String,
    pub age: u8,
    pub gender: GenderCodeV1,
    pub handedness: HandednessCodeV1,
    pub attempt_number: u32,
    pub session_stem: String,
    pub started_at: String,
    pub playback_mode: RunPlaybackModeV3,
    pub playback_qualification: RunPlaybackQualificationV3,
    pub package: ExperimentPackageRunReceiptV1,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub definition_hashes: Vec<QuestionnaireDefinitionReceiptV1>,
    pub partial_sample_count: u64,
    pub partial_event_count: u64,
    pub submitted_response_count: u64,
    pub submitted_responses: Vec<crate::research_protocol::QuestionnaireResponseV1>,
    pub safe_protocol_step_position: u32,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub active_questionnaire_draft: Option<QuestionnaireDraftV1>,
    pub last_monotonic_time_ns: String,
    pub gap_event_count: u64,
    pub missed_slot_count: u64,
    pub recovery: RecoverySummaryV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub pending_finalization: Option<PendingPackageFinalizationV1>,
}

impl PackageRecoveryJournalV1 {
    pub fn validate_bindings(&self, selection: &CompiledPackageSelectionV1) -> ResearchResult<()> {
        if self.schema != PACKAGE_RECOVERY_JOURNAL_SCHEMA || self.version != 1 {
            return Err(contract_error(
                "The package recovery journal schema or version is unsupported.",
            ));
        }
        validate_uuid(&self.recovery_id, "PackageRecoveryJournalV1.recoveryId")?;
        validate_uuid(&self.run_id, "PackageRecoveryJournalV1.runId")?;
        if self.participant_id != selection.participant_id
            || self.experiment_id != selection.settings.experiment.id
            || self.settings_sha256 != selection.settings_sha256
            || self.assignment_plan_sha256 != selection.experiment_plan.plan_hash_sha256
            || self.protocol_plan_sha256 != selection.protocol_plan.protocol_plan_hash_sha256
            || self.package.canonical_source_byte_sha256 != selection.package_source_byte_sha256
            || self.package.package_definition_sha256 != selection.package_definition_sha256
            || self.package.package_id != selection.package_id
            || self.package.language_id != selection.language_id
            || self.package.language_selection_path != selection.language_selection_path
            || self.package.assignment_sha256 != selection.assignment_sha256
            || self.safe_protocol_step_position > selection.protocol_plan.steps.len() as u32
            || self.submitted_response_count != self.submitted_responses.len() as u64
        {
            return Err(contract_error(
                "The package recovery journal does not bind the exact compiled selection.",
            ));
        }
        validate_sha256(
            &self.package.asset_bindings_sha256,
            "PackageRecoveryJournalV1.package.assetBindingsSha256",
        )?;
        for (index, response) in self.submitted_responses.iter().enumerate() {
            validate_response_binding(
                response,
                selection,
                crate::research_protocol::QuestionnaireResponseStatusV1::Submitted,
            )?;
            if response.sequence as usize != index + 1
                || response.run_id != self.run_id
                || response.participant_id != self.participant_id
                || response.attempt_number != self.attempt_number
                || response.settings_sha256 != self.settings_sha256
                || response.assignment_plan_sha256 != self.assignment_plan_sha256
                || response.protocol_plan_sha256 != self.protocol_plan_sha256
                || response.protocol_step_position > self.safe_protocol_step_position
                || response.status
                    != crate::research_protocol::QuestionnaireResponseStatusV1::Submitted
            {
                return Err(contract_error(
                    "The package recovery journal contains an unbound submitted response.",
                ));
            }
        }
        let mut submitted_items = std::collections::BTreeSet::new();
        if self.submitted_responses.iter().any(|response| {
            !submitted_items.insert((response.protocol_step_position, response.item_id.as_str()))
        }) {
            return Err(contract_error(
                "The package recovery journal repeats a submitted questionnaire item.",
            ));
        }
        if let Some(draft) = &self.active_questionnaire_draft {
            if draft.protocol_step_position != self.safe_protocol_step_position.saturating_add(1) {
                return Err(contract_error(
                    "The package questionnaire draft is not at the next unsafe protocol step.",
                ));
            }
            let Some(super::contracts::ProtocolStepV2::Questionnaire {
                module_id,
                questionnaire_id,
                definition_sha256,
                ..
            }) = selection.protocol_plan.step(draft.protocol_step_position)
            else {
                return Err(contract_error(
                    "The package questionnaire draft targets a non-questionnaire step.",
                ));
            };
            if draft.module_id != *module_id
                || draft.questionnaire_id != *questionnaire_id
                || draft.definition_sha256 != *definition_sha256
            {
                return Err(contract_error(
                    "The package questionnaire draft identity differs from its frozen step.",
                ));
            }
            let mut items = std::collections::BTreeSet::new();
            for (index, response) in draft.responses.iter().enumerate() {
                validate_response_binding(
                    response,
                    selection,
                    crate::research_protocol::QuestionnaireResponseStatusV1::Draft,
                )?;
                if response.sequence as usize != self.submitted_responses.len() + index + 1
                    || response.run_id != self.run_id
                    || response.participant_id != self.participant_id
                    || response.attempt_number != self.attempt_number
                    || response.protocol_step_position != draft.protocol_step_position
                    || !items.insert(response.item_id.as_str())
                {
                    return Err(contract_error(
                        "The package questionnaire draft rows are inconsistent.",
                    ));
                }
            }
        }
        if let Some(pending) = &self.pending_finalization {
            validate_sha256(
                &pending.terminal_event_sha256,
                "PackageRecoveryJournalV1.pendingFinalization.terminalEventSha256",
            )?;
            pending.manifest.validate_bindings(selection)?;
        }
        Ok(())
    }
}

fn validate_response_binding(
    response: &crate::research_protocol::QuestionnaireResponseV1,
    selection: &CompiledPackageSelectionV1,
    expected_status: crate::research_protocol::QuestionnaireResponseStatusV1,
) -> ResearchResult<()> {
    response.validate()?;
    let Some(super::contracts::ProtocolStepV2::Questionnaire {
        module_id,
        questionnaire_id,
        definition_sha256,
        ..
    }) = selection
        .protocol_plan
        .step(response.protocol_step_position)
    else {
        return Err(contract_error(
            "A package questionnaire response targets a non-questionnaire step.",
        ));
    };
    let definition = selection
        .settings
        .questionnaires
        .definitions
        .iter()
        .find(|definition| definition.questionnaire_id == *questionnaire_id)
        .ok_or_else(|| contract_error("A response questionnaire definition is absent."))?;
    let item = definition
        .items
        .iter()
        .find(|item| item.item_id == response.item_id)
        .ok_or_else(|| contract_error("A response questionnaire item is absent."))?;
    let option = item
        .options
        .iter()
        .find(|option| option.option_id == response.option_id)
        .ok_or_else(|| contract_error("A response questionnaire option is absent."))?;
    if response.status != expected_status
        || response.run_id.is_empty()
        || response.participant_id != selection.participant_id
        || response.settings_sha256 != selection.settings_sha256
        || response.assignment_plan_sha256 != selection.experiment_plan.plan_hash_sha256
        || response.protocol_plan_sha256 != selection.protocol_plan.protocol_plan_hash_sha256
        || response.module_id != *module_id
        || response.questionnaire_id != *questionnaire_id
        || response.questionnaire_version != definition.questionnaire_version
        || response.definition_sha256 != *definition_sha256
        || response.item_order != item.order
        || response.option_order != option.order
        || response.response_label != option.label
        || response.score_value != option.score_value
        || response.subscale != item.subscale
    {
        return Err(contract_error(
            "A package questionnaire response differs from its frozen definition or protocol binding.",
        ));
    }
    Ok(())
}

pub fn package_receipt(
    selection: &CompiledPackageSelectionV1,
    asset_bindings_sha256: String,
) -> ExperimentPackageRunReceiptV1 {
    ExperimentPackageRunReceiptV1 {
        canonical_source_byte_sha256: selection.package_source_byte_sha256.clone(),
        package_definition_sha256: selection.package_definition_sha256.clone(),
        package_id: selection.package_id.clone(),
        language_id: selection.language_id.clone(),
        language_selection_path: selection.language_selection_path.clone(),
        assignment_sha256: selection.assignment_sha256.clone(),
        asset_bindings_sha256,
    }
}

pub fn response_table_sha256<T: Serialize>(responses: &[T]) -> ResearchResult<String> {
    canonical_sha256(&responses, &[])
}

pub fn module_receipts(
    selection: &CompiledPackageSelectionV1,
    safe_protocol_step_position: u32,
    submitted_counts: &std::collections::BTreeMap<u32, u64>,
    draft: Option<&QuestionnaireDraftV1>,
) -> Vec<QuestionnaireModuleReceiptV1> {
    selection
        .protocol_plan
        .steps
        .iter()
        .filter_map(|step| {
            let super::contracts::ProtocolStepV2::Questionnaire {
                protocol_position,
                module_id,
                questionnaire_id,
                definition_sha256,
                ..
            } = step
            else {
                return None;
            };
            let response_count = submitted_counts
                .get(protocol_position)
                .copied()
                .or_else(|| {
                    draft
                        .filter(|draft| draft.protocol_step_position == *protocol_position)
                        .map(|draft| draft.responses.len() as u64)
                })
                .unwrap_or(0);
            let status = if submitted_counts.contains_key(protocol_position) {
                QuestionnaireModuleStatusV1::Submitted
            } else if draft.is_some_and(|draft| draft.protocol_step_position == *protocol_position)
            {
                QuestionnaireModuleStatusV1::Draft
            } else {
                QuestionnaireModuleStatusV1::NotReached
            };
            debug_assert!(
                *protocol_position > safe_protocol_step_position
                    || status == QuestionnaireModuleStatusV1::Submitted
            );
            Some(QuestionnaireModuleReceiptV1 {
                protocol_step_position: *protocol_position,
                module_id: module_id.clone(),
                questionnaire_id: questionnaire_id.clone(),
                definition_sha256: definition_sha256.clone(),
                status,
                response_count,
            })
        })
        .collect()
}

fn validate_uuid(value: &str, label: &str) -> ResearchResult<()> {
    match uuid::Uuid::parse_str(value) {
        Ok(uuid) if uuid.to_string() == value => Ok(()),
        _ => Err(contract_error(format!("{label} must be a canonical UUID."))),
    }
}

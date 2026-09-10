use crate::research_contracts::{
    canonical_json, canonical_sha256, validate_participant_id, validate_sha256, AdvancedSettingsV1,
    AllocationAlgorithmV1, BetweenVideosV1, ConditionOrderV1, ExperimentSettingsV1, InputBindingV1,
    OutputSettingsV1, RecoverySummaryV1, ResearchBuildV1, ResearchPlatformV1, ResearchSettingsV1,
    ResolvedAssignmentPlanV1, SampleStimulusIdentityV1, StimuliSettingsV1, StimulusSourceV1,
    StimulusV1, VisualSettingsV1, MAX_SAFE_INTEGER, RESEARCH_EVENT_SCHEMA,
    RESEARCH_RUN_MANIFEST_SCHEMA, RESEARCH_SETTINGS_SCHEMA,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_external_protocol::{ExperimentDefinitionV1, EXTERNAL_ORDER_ALGORITHM_VERSION};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;
use uuid::Uuid;

pub const QUESTIONNAIRE_DEFINITION_SCHEMA: &str = "affect-research-questionnaire-definition";
pub const QUESTIONNAIRE_MODULE_SCHEMA: &str = "affect-research-questionnaire-module";
pub const QUESTIONNAIRE_RESPONSE_SCHEMA: &str = "affect-research-questionnaire-response";
pub const QUESTIONNAIRE_CSV_FORMAT_VERSION: &str = "questionnaire-csv-v1";
pub const QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION: &str = "questionnaire-hooks-v1";
pub const QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION: &str = "questionnaire-hooks-v2";
pub const RESEARCH_PROTOCOL_PLAN_SCHEMA: &str = "affect-research-protocol-plan";
pub const RESEARCH_RECOVERY_JOURNAL_SCHEMA: &str = "affect-research-recovery-journal";
pub const NATIVE_PROTOCOL_CAPABILITY_SCHEMA: &str =
    "affect-research-native-questionnaire-protocol-capability";

const MAX_CSV_BYTES: usize = 4 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 25_000;
const MAX_FIELD_UTF16: usize = 16_384;
const MAX_ITEMS: usize = 1_024;
const MAX_OPTIONS_PER_ITEM: usize = 64;
const MAX_DEFINITIONS: usize = 256;
const MAX_MODULES: usize = 1_024;
const MAX_PROTOCOL_STEPS: usize = 20_000;
const MAX_RESPONSES: usize = 100_000;
const MAX_SCORE_ABS: f64 = 1_000_000_000.0;
const MAX_RESPONSE_LATENCY_MS: f64 = 86_400_000.0;
const MAX_ATTEMPT_NUMBER: u32 = 999_999;

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchSettingsV2 {
    pub schema: String,
    pub version: u32,
    pub experiment: ExperimentSettingsV1,
    pub stimuli: StimuliSettingsV1,
    pub input: InputBindingV1,
    pub visual: VisualSettingsV1,
    pub advanced: AdvancedSettingsV1,
    pub output: OutputSettingsV1,
    pub questionnaires: QuestionnaireSettingsV2,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchSettingsV3 {
    pub schema: String,
    pub version: u32,
    pub experiment: ExperimentSettingsV3,
    pub stimuli: StimuliSettingsV3,
    pub input: InputBindingV1,
    pub visual: VisualSettingsV1,
    pub advanced: AdvancedSettingsV1,
    pub output: OutputSettingsV1,
    pub questionnaires: QuestionnaireSettingsV3,
    pub external_protocol: ExternalProtocolSettingsV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentSettingsV3 {
    pub id: String,
    pub title: String,
    pub participant_count: u32,
    pub sampling_frequency_hz: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StimuliSettingsV3 {
    pub items: Vec<StimulusV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireSettingsV3 {
    pub algorithm_version: String,
    pub definitions: Vec<QuestionnaireDefinitionV1>,
    pub modules: Vec<QuestionnaireModuleV2>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalProtocolSettingsV1 {
    pub algorithm_version: String,
    pub source_byte_sha256: String,
    pub definition_sha256: String,
    pub definition: ExperimentDefinitionV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireSettingsV2 {
    pub algorithm_version: String,
    pub definitions: Vec<QuestionnaireDefinitionV1>,
    pub modules: Vec<QuestionnaireModuleV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireDefinitionV1 {
    pub schema: String,
    pub version: u32,
    pub questionnaire_id: String,
    pub questionnaire_version: String,
    pub title: String,
    pub language: String,
    pub instructions: String,
    pub attribution: String,
    pub source: QuestionnaireSourceV1,
    pub items: Vec<QuestionnaireItemV1>,
    pub definition_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireSourceV1 {
    pub kind: QuestionnaireSourceKindV1,
    pub logical_name: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub source_document_sha256: Option<String>,
    pub format_version: String,
    pub byte_length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuestionnaireSourceKindV1 {
    Bundled,
    ResearcherCsv,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireItemV1 {
    pub item_id: String,
    pub order: u32,
    pub prompt: String,
    pub required: bool,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub subscale: Option<String>,
    pub options: Vec<QuestionnaireOptionV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireOptionV1 {
    pub option_id: String,
    pub order: u32,
    pub label: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub score_value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireModuleV1 {
    pub schema: String,
    pub version: u32,
    pub module_id: String,
    pub questionnaire_id: String,
    pub definition_sha256: String,
    pub placement: QuestionnairePlacementV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireModuleV2 {
    pub schema: String,
    pub version: u32,
    pub module_id: String,
    pub questionnaire_id: String,
    pub definition_sha256: String,
    pub placement: QuestionnairePlacementV2,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnairePlacementV1 {
    pub kind: QuestionnairePlacementKindV1,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub pool_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QuestionnairePlacementV2 {
    BeforeSession {
        #[serde(deserialize_with = "deserialize_required_option")]
        block_id: Option<String>,
    },
    AfterSession {
        #[serde(deserialize_with = "deserialize_required_option")]
        block_id: Option<String>,
    },
    BeforeBlock {
        block_id: String,
    },
    AfterBlock {
        block_id: String,
    },
    AfterStimulus {
        #[serde(deserialize_with = "deserialize_required_option")]
        block_id: Option<String>,
        stimulus_id: String,
        relative_to_isi: QuestionnaireRelativeToIsiV1,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuestionnaireRelativeToIsiV1 {
    Before,
    After,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuestionnairePlacementKindV1 {
    BeforeSession,
    AfterSession,
    BeforeBlock,
    AfterBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ResearchSettingsDocument {
    V3(ResearchSettingsV3),
    V2(ResearchSettingsV2),
    V1(ResearchSettingsV1),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedProtocolPlanV1 {
    pub schema: String,
    pub version: u32,
    pub algorithm_version: String,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub participant_id: String,
    pub condition_order: Vec<String>,
    pub steps: Vec<ProtocolStepV1>,
    pub protocol_plan_hash_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProtocolStepV1 {
    Questionnaire {
        protocol_position: u32,
        #[serde(deserialize_with = "deserialize_required_option")]
        block_position: Option<u32>,
        #[serde(deserialize_with = "deserialize_required_option")]
        pool_id: Option<String>,
        module_id: String,
        questionnaire_id: String,
        definition_sha256: String,
        placement: QuestionnairePlacementKindV1,
    },
    Stimulus {
        protocol_position: u32,
        block_position: u32,
        pool_id: String,
        stimulus_position: u32,
        pool_position: u32,
        stimulus_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireResponseV1 {
    pub schema: String,
    pub version: u32,
    pub sequence: u64,
    pub run_id: String,
    pub participant_id: String,
    pub attempt_number: u32,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub protocol_step_position: u32,
    pub module_id: String,
    pub questionnaire_id: String,
    pub questionnaire_version: String,
    pub definition_sha256: String,
    pub item_id: String,
    pub item_order: u32,
    pub option_id: String,
    pub option_order: u32,
    pub response_label: String,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub score_value: Option<f64>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub subscale: Option<String>,
    pub status: QuestionnaireResponseStatusV1,
    pub wall_time_utc: String,
    pub monotonic_time_ns: String,
    pub response_latency_ms: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuestionnaireResponseStatusV1 {
    Submitted,
    Draft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireAnswerInputV1 {
    pub item_id: String,
    pub option_id: String,
    pub response_latency_ms: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ResearchEventTypeV2 {
    SessionPrepared,
    SessionStarted,
    StimulusStarted,
    StimulusPaused,
    StimulusResumed,
    StimulusCompleted,
    TransitionStarted,
    TransitionCompleted,
    InputEdge,
    TimingGap,
    WriteInterrupted,
    WriteRecovered,
    RecoveryStarted,
    RecoveryCompleted,
    StoppedEarly,
    SessionCompleted,
    SessionAborted,
    QuestionnaireStarted,
    QuestionnaireDraftCheckpointed,
    QuestionnaireCompleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchEventV2 {
    pub schema: String,
    pub version: u32,
    pub sequence: u64,
    pub run_id: String,
    pub participant_id: String,
    pub attempt_number: u32,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub wall_time_utc: String,
    pub monotonic_time_ns: String,
    #[serde(rename = "type")]
    pub event_type: ResearchEventTypeV2,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub stimulus_identity: Option<SampleStimulusIdentityV1>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub stimulus_position: Option<u32>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub protocol_step_position: Option<u32>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub module_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub questionnaire_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub definition_sha256: Option<String>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub media_time_ms: Option<f64>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub missed_slot_count: Option<u64>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub detail_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryJournalV2 {
    pub schema: String,
    pub version: u32,
    pub recovery_id: String,
    pub run_id: String,
    pub experiment_id: String,
    pub participant_id: String,
    pub participant_code: String,
    pub age: u8,
    pub gender: crate::research_contracts::GenderCodeV1,
    pub handedness: crate::research_contracts::HandednessCodeV1,
    pub attempt_number: u32,
    pub session_stem: String,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub definition_hashes: Vec<QuestionnaireDefinitionReceiptV1>,
    pub started_at: String,
    pub partial_sample_count: u64,
    pub partial_event_count: u64,
    pub partial_questionnaire_response_count: u64,
    pub safe_protocol_step_position: u32,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub active_protocol_step_position: Option<u32>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub active_questionnaire_draft: Option<QuestionnaireDraftV1>,
    pub last_monotonic_time_ns: String,
    pub gap_event_count: u64,
    pub missed_slot_count: u64,
    pub recovery: RecoverySummaryV1,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireDraftV1 {
    pub protocol_step_position: u32,
    pub module_id: String,
    pub questionnaire_id: String,
    pub definition_sha256: String,
    pub responses: Vec<QuestionnaireResponseV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireDefinitionReceiptV1 {
    pub questionnaire_id: String,
    pub definition_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchRunManifestV3 {
    pub schema: String,
    pub version: u32,
    pub run_id: String,
    pub experiment_id: String,
    pub participant_id: String,
    pub participant_code: String,
    pub age: u8,
    pub gender: crate::research_contracts::GenderCodeV1,
    pub handedness: crate::research_contracts::HandednessCodeV1,
    pub attempt_number: u32,
    pub session_stem: String,
    pub completion_status: crate::research_contracts::CompletionStatusV1,
    pub playback_mode: RunPlaybackModeV3,
    pub playback_qualification: RunPlaybackQualificationV3,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub stimuli: Vec<SampleStimulusIdentityV1>,
    pub protocol: RunProtocolSummaryV3,
    pub timing: RunTimingV3,
    pub outputs: Vec<RunOutputV3>,
    pub recovery: RecoverySummaryV1,
    pub build: ResearchBuildV1,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunPlaybackModeV3 {
    NativeGstPlay,
    UnqualifiedWebview,
    BrowserMediaAdapters,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunPlaybackQualificationV3 {
    QualifiedNative,
    Unqualified,
    Browser,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunProtocolSummaryV3 {
    pub safe_protocol_step_position: u32,
    pub protocol_step_count: u32,
    pub questionnaire_definitions: Vec<QuestionnaireDefinitionReceiptV1>,
    pub questionnaire_modules: Vec<QuestionnaireModuleReceiptV1>,
    pub submitted_response_count: u64,
    pub draft_response_count: u64,
    pub submitted_responses_sha256: String,
    pub draft_responses_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireModuleReceiptV1 {
    pub protocol_step_position: u32,
    pub module_id: String,
    pub questionnaire_id: String,
    pub definition_sha256: String,
    pub status: QuestionnaireModuleStatusV1,
    pub response_count: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuestionnaireModuleStatusV1 {
    Submitted,
    Draft,
    NotReached,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunTimingV3 {
    pub sample_rate_hz: u16,
    pub sample_count: u64,
    pub event_count: u64,
    pub gap_event_count: u64,
    pub missed_slot_count: u64,
    pub questionnaire_submitted_response_count: u64,
    pub questionnaire_draft_response_count: u64,
    pub started_at: String,
    pub finalized_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunOutputV3 {
    pub kind: RunOutputKindV3,
    pub file_name: String,
    pub sha256: String,
    pub byte_length: u64,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub row_count: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum RunOutputKindV3 {
    ExperimentSource,
    ExperimentPlan,
    Settings,
    ProtocolPlan,
    Events,
    RatingsCsv,
    RatingsTsv,
    QuestionnaireCsv,
    QuestionnaireTsv,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeProtocolCapability {
    pub schema: &'static str,
    pub version: u32,
    pub settings_v2_validation_ready: bool,
    pub questionnaire_csv_import_ready: bool,
    pub protocol_plan_validation_ready: bool,
    pub native_start_resume_ready: bool,
    pub durable_draft_checkpoint_ready: bool,
    pub atomic_submission_ready: bool,
    pub manifest_v3_finalization_ready: bool,
    pub reason_code: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolPreflightReceipt {
    pub schema: &'static str,
    pub version: u32,
    pub participant_id: String,
    pub settings_sha256: String,
    pub assignment_settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub definition_hashes: Vec<QuestionnaireDefinitionReceiptV1>,
    pub protocol_step_count: u32,
    pub questionnaire_step_count: u32,
    pub stimulus_step_count: u32,
    pub native_start_ready: bool,
    pub blocking_reason_code: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionnaireImportReceipt {
    pub definition: QuestionnaireDefinitionV1,
    pub source_sha256: String,
    pub definition_sha256: String,
}

impl ResearchSettingsDocument {
    pub fn normalize_and_validate(self) -> ResearchResult<Self> {
        match self {
            Self::V3(settings) => settings.normalize_and_validate().map(Self::V3),
            Self::V2(settings) => settings.normalize_and_validate().map(Self::V2),
            Self::V1(settings) => settings.normalize_and_validate().map(Self::V1),
        }
    }

    pub fn experiment_id(&self) -> &str {
        match self {
            Self::V3(settings) => &settings.experiment.id,
            Self::V2(settings) => &settings.experiment.id,
            Self::V1(settings) => &settings.experiment.id,
        }
    }

    pub fn canonical_sha256(&self) -> ResearchResult<String> {
        canonical_sha256(self, &[])
    }
}

impl ResearchSettingsV3 {
    pub fn normalize_and_validate(mut self) -> ResearchResult<Self> {
        if self.schema != RESEARCH_SETTINGS_SCHEMA || self.version != 3 {
            return Err(contract_error(
                "ResearchSettingsV3 schema or version is unsupported.",
            ));
        }
        if self.external_protocol.algorithm_version != EXTERNAL_ORDER_ALGORITHM_VERSION {
            return Err(contract_error(
                "ResearchSettingsV3 external protocol algorithm is unsupported.",
            ));
        }
        validate_sha256(
            &self.external_protocol.source_byte_sha256,
            "ResearchSettingsV3.externalProtocol.sourceByteSha256",
        )?;
        validate_sha256(
            &self.external_protocol.definition_sha256,
            "ResearchSettingsV3.externalProtocol.definitionSha256",
        )?;
        self.external_protocol.definition = self
            .external_protocol
            .definition
            .clone()
            .normalize_and_validate()?;
        if self.external_protocol.definition.canonical_sha256()?
            != self.external_protocol.definition_sha256
        {
            return Err(contract_error(
                "ResearchSettingsV3 external protocol definition hash does not match its canonical content.",
            ));
        }

        let common = ResearchSettingsV1 {
            schema: RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 1,
            experiment: ExperimentSettingsV1 {
                id: self.experiment.id.clone(),
                title: self.experiment.title.clone(),
                participant_count: self.experiment.participant_count,
                sampling_frequency_hz: self.experiment.sampling_frequency_hz,
                between_videos: BetweenVideosV1::Fixed { duration_ms: 0 },
            },
            stimuli: StimuliSettingsV1 {
                allocation_algorithm: AllocationAlgorithmV1::BalancedV1,
                condition_order: ConditionOrderV1::Williams,
                seed: "00000000000000000000000000000000".to_owned(),
                items: Vec::new(),
                pools: Vec::new(),
            },
            input: self.input,
            visual: self.visual,
            advanced: self.advanced,
            output: self.output,
        }
        .normalize_and_validate()?;
        self.experiment = ExperimentSettingsV3 {
            id: common.experiment.id,
            title: common.experiment.title,
            participant_count: common.experiment.participant_count,
            sampling_frequency_hz: common.experiment.sampling_frequency_hz,
        };
        self.input = common.input;
        self.visual = common.visual;
        self.advanced = common.advanced;
        self.output = common.output;
        for stimulus in &mut self.stimuli.items {
            stimulus.normalize_and_validate()?;
        }
        self.stimuli
            .items
            .sort_by(|left, right| left.stimulus_id.cmp(&right.stimulus_id));

        let definition = &self.external_protocol.definition;
        if self.experiment.id != definition.experiment_id
            || self.experiment.title != definition.title
            || self.experiment.participant_count as usize != definition.schedules.len()
            || self.stimuli.items.len() != definition.stimuli.len()
        {
            return Err(contract_error(
                "ResearchSettingsV3 does not bind the external experiment identity and registries.",
            ));
        }
        let items: BTreeMap<&str, &StimulusV1> = self
            .stimuli
            .items
            .iter()
            .map(|stimulus| (stimulus.stimulus_id.as_str(), stimulus))
            .collect();
        if items.len() != self.stimuli.items.len() {
            return Err(contract_error("ResearchSettingsV3 repeats a stimulus ID."));
        }
        for reference in &definition.stimuli {
            let stimulus = items.get(reference.stimulus_id.as_str()).ok_or_else(|| {
                contract_error("ResearchSettingsV3 is missing an external stimulus.")
            })?;
            let StimulusSourceV1::WorkspaceFile { relative_path, .. } = &stimulus.source else {
                return Err(contract_error(
                    "ResearchSettingsV3 external stimuli must use workspace files.",
                ));
            };
            if stimulus.title != reference.title || relative_path != &reference.relative_path {
                return Err(contract_error(
                    "ResearchSettingsV3 stimulus identity differs from experiment.json.",
                ));
            }
        }

        if self.questionnaires.algorithm_version != QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION {
            return Err(contract_error(
                "ResearchSettingsV3 questionnaire algorithm is unsupported.",
            ));
        }
        if self.questionnaires.definitions.len() > MAX_DEFINITIONS
            || self.questionnaires.modules.len() > MAX_MODULES
        {
            return Err(contract_error(
                "ResearchSettingsV3 exceeds questionnaire definition or module bounds.",
            ));
        }
        let mut definition_ids = BTreeSet::new();
        let mut definition_hashes = BTreeSet::new();
        for questionnaire in &mut self.questionnaires.definitions {
            *questionnaire = questionnaire.clone().normalize_and_validate()?;
            if !definition_ids.insert(questionnaire.questionnaire_id.clone())
                || !definition_hashes.insert(questionnaire.definition_sha256.clone())
            {
                return Err(contract_error(
                    "ResearchSettingsV3 repeats a questionnaire definition ID or hash.",
                ));
            }
        }
        let questionnaires: BTreeMap<_, _> = self
            .questionnaires
            .definitions
            .iter()
            .map(|questionnaire| (questionnaire.questionnaire_id.as_str(), questionnaire))
            .collect();
        let block_ids: BTreeSet<_> = definition
            .blocks
            .iter()
            .map(|block| block.block_id.as_str())
            .collect();
        let stimulus_ids: BTreeSet<_> = definition
            .stimuli
            .iter()
            .map(|stimulus| stimulus.stimulus_id.as_str())
            .collect();
        let mut module_ids = BTreeSet::new();
        for module in &mut self.questionnaires.modules {
            *module = module.clone().normalize_and_validate()?;
            if !module_ids.insert(module.module_id.clone()) {
                return Err(contract_error(
                    "ResearchSettingsV3 repeats a questionnaire module ID.",
                ));
            }
            let questionnaire = questionnaires
                .get(module.questionnaire_id.as_str())
                .ok_or_else(|| {
                    contract_error("A V3 questionnaire module references an unknown definition.")
                })?;
            if module.definition_sha256 != questionnaire.definition_sha256 {
                return Err(contract_error(
                    "A V3 questionnaire module definition hash does not match its definition.",
                ));
            }
            match &module.placement {
                QuestionnairePlacementV2::BeforeBlock { block_id }
                | QuestionnairePlacementV2::AfterBlock { block_id } => {
                    if !block_ids.contains(block_id.as_str()) {
                        return Err(contract_error(
                            "A V3 questionnaire module references an unknown experiment block.",
                        ));
                    }
                }
                QuestionnairePlacementV2::AfterStimulus { stimulus_id, .. } => {
                    if !stimulus_ids.contains(stimulus_id.as_str()) {
                        return Err(contract_error(
                            "A V3 questionnaire module references an unknown experiment stimulus.",
                        ));
                    }
                }
                QuestionnairePlacementV2::BeforeSession { .. }
                | QuestionnairePlacementV2::AfterSession { .. } => {}
            }
        }
        Ok(self)
    }

    pub fn canonical_sha256(&self) -> ResearchResult<String> {
        canonical_sha256(self, &[])
    }
}

impl ResearchSettingsV2 {
    pub fn normalize_and_validate(mut self) -> ResearchResult<Self> {
        if self.schema != RESEARCH_SETTINGS_SCHEMA || self.version != 2 {
            return Err(contract_error(
                "ResearchSettingsV2 schema or version is unsupported.",
            ));
        }
        let normalized_v1 = self.assignment_projection()?.normalize_and_validate()?;
        self.experiment = normalized_v1.experiment;
        self.stimuli = normalized_v1.stimuli;
        self.input = normalized_v1.input;
        self.visual = normalized_v1.visual;
        self.advanced = normalized_v1.advanced;
        self.output = normalized_v1.output;

        if self.questionnaires.algorithm_version != QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION {
            return Err(contract_error(
                "ResearchSettingsV2 questionnaire algorithm is unsupported.",
            ));
        }
        if self.questionnaires.definitions.len() > MAX_DEFINITIONS
            || self.questionnaires.modules.len() > MAX_MODULES
        {
            return Err(contract_error(
                "ResearchSettingsV2 exceeds questionnaire definition or module bounds.",
            ));
        }

        let mut definition_ids = BTreeSet::new();
        let mut definition_hashes = BTreeSet::new();
        for definition in &mut self.questionnaires.definitions {
            *definition = definition.clone().normalize_and_validate()?;
            if !definition_ids.insert(definition.questionnaire_id.clone())
                || !definition_hashes.insert(definition.definition_sha256.clone())
            {
                return Err(contract_error(
                    "ResearchSettingsV2 repeats a questionnaire definition ID or hash.",
                ));
            }
        }

        let definitions: BTreeMap<_, _> = self
            .questionnaires
            .definitions
            .iter()
            .map(|definition| (definition.questionnaire_id.as_str(), definition))
            .collect();
        let pool_ids: BTreeSet<&str> = self
            .stimuli
            .pools
            .iter()
            .map(|pool| pool.pool_id.as_str())
            .collect();
        let mut module_ids = BTreeSet::new();
        for module in &mut self.questionnaires.modules {
            *module = module.clone().normalize_and_validate()?;
            if !module_ids.insert(module.module_id.clone()) {
                return Err(contract_error(
                    "ResearchSettingsV2 repeats a questionnaire module ID.",
                ));
            }
            let definition = definitions
                .get(module.questionnaire_id.as_str())
                .ok_or_else(|| {
                    contract_error("A questionnaire module references an unknown definition.")
                })?;
            if module.definition_sha256 != definition.definition_sha256 {
                return Err(contract_error(
                    "A questionnaire module definition hash does not match its definition.",
                ));
            }
            match module.placement.kind {
                QuestionnairePlacementKindV1::BeforeSession
                | QuestionnairePlacementKindV1::AfterSession => {
                    if module.placement.pool_id.is_some() {
                        return Err(contract_error(
                            "Session questionnaire modules require a null poolId.",
                        ));
                    }
                }
                QuestionnairePlacementKindV1::BeforeBlock
                | QuestionnairePlacementKindV1::AfterBlock => {
                    let pool_id = module.placement.pool_id.as_deref().ok_or_else(|| {
                        contract_error("Block questionnaire modules require a poolId.")
                    })?;
                    if !pool_ids.contains(pool_id) {
                        return Err(contract_error(
                            "A questionnaire module references an unknown condition pool.",
                        ));
                    }
                }
            }
        }
        Ok(self)
    }

    pub fn assignment_projection(&self) -> ResearchResult<ResearchSettingsV1> {
        if self.schema != RESEARCH_SETTINGS_SCHEMA || self.version != 2 {
            return Err(contract_error(
                "ResearchSettingsV2 schema or version is unsupported.",
            ));
        }
        Ok(ResearchSettingsV1 {
            schema: RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 1,
            experiment: self.experiment.clone(),
            stimuli: self.stimuli.clone(),
            input: self.input.clone(),
            visual: self.visual.clone(),
            advanced: self.advanced.clone(),
            output: self.output.clone(),
        })
    }

    pub fn canonical_sha256(&self) -> ResearchResult<String> {
        canonical_sha256(self, &[])
    }

    pub fn definition(&self, questionnaire_id: &str) -> Option<&QuestionnaireDefinitionV1> {
        self.questionnaires
            .definitions
            .iter()
            .find(|definition| definition.questionnaire_id == questionnaire_id)
    }

    pub fn module(&self, module_id: &str) -> Option<&QuestionnaireModuleV1> {
        self.questionnaires
            .modules
            .iter()
            .find(|module| module.module_id == module_id)
    }
}

impl QuestionnaireDefinitionV1 {
    pub fn normalize_and_validate(mut self) -> ResearchResult<Self> {
        if self.schema != QUESTIONNAIRE_DEFINITION_SCHEMA || self.version != 1 {
            return Err(contract_error(
                "QuestionnaireDefinitionV1 schema or version is unsupported.",
            ));
        }
        require_identifier(
            &self.questionnaire_id,
            "QuestionnaireDefinitionV1.questionnaireId",
        )?;
        require_canonical_text(
            &self.questionnaire_version,
            1,
            120,
            "QuestionnaireDefinitionV1.questionnaireVersion",
        )?;
        require_canonical_text(&self.title, 1, 500, "QuestionnaireDefinitionV1.title")?;
        require_language(&self.language, "QuestionnaireDefinitionV1.language")?;
        require_canonical_text(
            &self.instructions,
            1,
            8_000,
            "QuestionnaireDefinitionV1.instructions",
        )?;
        require_canonical_text(
            &self.attribution,
            1,
            12_000,
            "QuestionnaireDefinitionV1.attribution",
        )?;
        self.source.validate()?;
        if self.items.is_empty() || self.items.len() > MAX_ITEMS {
            return Err(contract_error(
                "QuestionnaireDefinitionV1 must contain 1–1024 items.",
            ));
        }
        let mut item_ids = BTreeSet::new();
        for (index, item) in self.items.iter_mut().enumerate() {
            item.normalize_and_validate(index + 1)?;
            if !item_ids.insert(item.item_id.clone()) {
                return Err(contract_error(
                    "QuestionnaireDefinitionV1 repeats an item ID.",
                ));
            }
        }
        validate_sha256(
            &self.definition_sha256,
            "QuestionnaireDefinitionV1.definitionSha256",
        )?;
        let observed = canonical_sha256(&self, &["definitionSha256"])?;
        if observed != self.definition_sha256 {
            return Err(contract_error(
                "QuestionnaireDefinitionV1 definition hash does not match its canonical content.",
            ));
        }
        Ok(self)
    }

    pub fn canonical_csv_bytes(&self) -> ResearchResult<Vec<u8>> {
        self.clone().normalize_and_validate()?;
        let headers = [
            "format_version",
            "questionnaire_id",
            "questionnaire_version",
            "title",
            "language",
            "instructions",
            "attribution",
            "item_id",
            "prompt",
            "required",
            "subscale",
            "option_id",
            "option_label",
            "score_value",
        ];
        let mut output = Vec::new();
        write_csv_row(&mut output, &headers.map(str::to_owned))?;
        for item in &self.items {
            for option in &item.options {
                let score = option
                    .score_value
                    .map(canonical_number)
                    .transpose()?
                    .unwrap_or_default();
                write_csv_row(
                    &mut output,
                    &[
                        QUESTIONNAIRE_CSV_FORMAT_VERSION.to_owned(),
                        self.questionnaire_id.clone(),
                        self.questionnaire_version.clone(),
                        self.title.clone(),
                        self.language.clone(),
                        self.instructions.clone(),
                        self.attribution.clone(),
                        item.item_id.clone(),
                        item.prompt.clone(),
                        item.required.to_string(),
                        item.subscale.clone().unwrap_or_default(),
                        option.option_id.clone(),
                        option.label.clone(),
                        score,
                    ],
                )?;
            }
        }
        Ok(output)
    }
}

impl QuestionnaireSourceV1 {
    fn validate(&self) -> ResearchResult<()> {
        require_logical_name(
            &self.logical_name,
            "QuestionnaireDefinitionV1.source.logicalName",
        )?;
        if let Some(source_document_sha256) = &self.source_document_sha256 {
            validate_sha256(
                source_document_sha256,
                "QuestionnaireDefinitionV1.source.sourceDocumentSha256",
            )?;
        }
        if self.format_version != QUESTIONNAIRE_CSV_FORMAT_VERSION
            || self.byte_length == 0
            || self.byte_length as usize > MAX_CSV_BYTES
        {
            return Err(contract_error(
                "QuestionnaireDefinitionV1 source format or byte length is invalid.",
            ));
        }
        validate_sha256(&self.sha256, "QuestionnaireDefinitionV1.source.sha256")
    }
}

impl QuestionnaireItemV1 {
    fn normalize_and_validate(&mut self, expected_order: usize) -> ResearchResult<()> {
        require_identifier(&self.item_id, "QuestionnaireDefinitionV1.item.itemId")?;
        if self.order as usize != expected_order {
            return Err(contract_error(
                "QuestionnaireDefinitionV1 item order must be contiguous and one-based.",
            ));
        }
        require_canonical_text(
            &self.prompt,
            1,
            4_000,
            "QuestionnaireDefinitionV1.item.prompt",
        )?;
        if let Some(subscale) = &self.subscale {
            require_canonical_text(subscale, 1, 300, "QuestionnaireDefinitionV1.item.subscale")?;
        }
        if self.options.len() < 2 || self.options.len() > MAX_OPTIONS_PER_ITEM {
            return Err(contract_error(
                "Each questionnaire item must contain 2–64 options.",
            ));
        }
        let mut option_ids = BTreeSet::new();
        let mut scored_count = 0usize;
        for (index, option) in self.options.iter_mut().enumerate() {
            option.normalize_and_validate(index + 1)?;
            scored_count += usize::from(option.score_value.is_some());
            if !option_ids.insert(option.option_id.clone()) {
                return Err(contract_error("A questionnaire item repeats an option ID."));
            }
        }
        if scored_count != 0 && scored_count != self.options.len() {
            return Err(contract_error(
                "Questionnaire item options must either all declare scores or all be unscored.",
            ));
        }
        Ok(())
    }
}

impl QuestionnaireOptionV1 {
    fn normalize_and_validate(&mut self, expected_order: usize) -> ResearchResult<()> {
        require_identifier(
            &self.option_id,
            "QuestionnaireDefinitionV1.item.option.optionId",
        )?;
        if self.order as usize != expected_order {
            return Err(contract_error(
                "Questionnaire option order must be contiguous and one-based.",
            ));
        }
        require_canonical_text(
            &self.label,
            1,
            500,
            "QuestionnaireDefinitionV1.item.option.label",
        )?;
        if self
            .score_value
            .is_some_and(|score| !score.is_finite() || score.abs() > MAX_SCORE_ABS)
        {
            return Err(contract_error(
                "Questionnaire option scores must be finite and bounded.",
            ));
        }
        if self.score_value == Some(-0.0) {
            self.score_value = Some(0.0);
        }
        Ok(())
    }
}

impl QuestionnaireModuleV1 {
    pub fn normalize_and_validate(self) -> ResearchResult<Self> {
        if self.schema != QUESTIONNAIRE_MODULE_SCHEMA || self.version != 1 {
            return Err(contract_error(
                "QuestionnaireModuleV1 schema or version is unsupported.",
            ));
        }
        require_identifier(&self.module_id, "QuestionnaireModuleV1.moduleId")?;
        require_identifier(
            &self.questionnaire_id,
            "QuestionnaireModuleV1.questionnaireId",
        )?;
        validate_sha256(
            &self.definition_sha256,
            "QuestionnaireModuleV1.definitionSha256",
        )?;
        if let Some(pool_id) = &self.placement.pool_id {
            require_identifier(pool_id, "QuestionnaireModuleV1.placement.poolId")?;
        }
        match self.placement.kind {
            QuestionnairePlacementKindV1::BeforeSession
            | QuestionnairePlacementKindV1::AfterSession
                if self.placement.pool_id.is_some() =>
            {
                return Err(contract_error(
                    "Session questionnaire modules require a null poolId.",
                ));
            }
            QuestionnairePlacementKindV1::BeforeBlock
            | QuestionnairePlacementKindV1::AfterBlock
                if self.placement.pool_id.is_none() =>
            {
                return Err(contract_error(
                    "Block questionnaire modules require a poolId.",
                ));
            }
            _ => {}
        }
        Ok(self)
    }
}

impl QuestionnaireModuleV2 {
    pub fn normalize_and_validate(self) -> ResearchResult<Self> {
        if self.schema != QUESTIONNAIRE_MODULE_SCHEMA || self.version != 2 {
            return Err(contract_error(
                "QuestionnaireModuleV2 schema or version is unsupported.",
            ));
        }
        require_identifier(&self.module_id, "QuestionnaireModuleV2.moduleId")?;
        require_identifier(
            &self.questionnaire_id,
            "QuestionnaireModuleV2.questionnaireId",
        )?;
        validate_sha256(
            &self.definition_sha256,
            "QuestionnaireModuleV2.definitionSha256",
        )?;
        match &self.placement {
            QuestionnairePlacementV2::BeforeSession { block_id }
            | QuestionnairePlacementV2::AfterSession { block_id } => {
                if block_id.is_some() {
                    return Err(contract_error(
                        "Session questionnaire modules require a null blockId.",
                    ));
                }
            }
            QuestionnairePlacementV2::BeforeBlock { block_id }
            | QuestionnairePlacementV2::AfterBlock { block_id } => {
                require_identifier(block_id, "QuestionnaireModuleV2.placement.blockId")?;
            }
            QuestionnairePlacementV2::AfterStimulus {
                block_id,
                stimulus_id,
                ..
            } => {
                if block_id.is_some() {
                    return Err(contract_error(
                        "Post-video questionnaire modules require a null blockId.",
                    ));
                }
                require_identifier(stimulus_id, "QuestionnaireModuleV2.placement.stimulusId")?;
            }
        }
        Ok(self)
    }
}

pub fn import_questionnaire_csv(
    bytes: &[u8],
    source_kind: QuestionnaireSourceKindV1,
    logical_name: &str,
    source_document_sha256: Option<String>,
) -> ResearchResult<QuestionnaireImportReceipt> {
    if bytes.is_empty() || bytes.len() > MAX_CSV_BYTES {
        return Err(contract_error(
            "Questionnaire CSV must contain between 1 byte and 4 MiB.",
        ));
    }
    require_logical_name(logical_name, "Questionnaire CSV logicalName")?;
    if let Some(value) = &source_document_sha256 {
        validate_sha256(value, "Questionnaire CSV sourceDocumentSha256")?;
    }
    let source_sha256 = format!("{:x}", Sha256::digest(bytes));
    let content = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        &bytes[3..]
    } else {
        bytes
    };
    if content.starts_with(&[0xff, 0xfe]) || content.starts_with(&[0xfe, 0xff]) {
        return Err(contract_error(
            "Questionnaire CSV must use UTF-8, not UTF-16.",
        ));
    }
    let text = std::str::from_utf8(content)
        .map_err(|_| contract_error("Questionnaire CSV must be valid UTF-8."))?;
    if text.contains('\u{feff}') {
        return Err(contract_error(
            "Questionnaire CSV may contain a BOM only at byte zero.",
        ));
    }
    let records = parse_csv_records(text)?;
    if records.len() < 3 {
        return Err(contract_error(
            "Questionnaire CSV requires a header and at least two option rows.",
        ));
    }
    let expected_header = [
        "format_version",
        "questionnaire_id",
        "questionnaire_version",
        "title",
        "language",
        "instructions",
        "attribution",
        "item_id",
        "prompt",
        "required",
        "subscale",
        "option_id",
        "option_label",
        "score_value",
    ];
    if records[0].iter().map(String::as_str).ne(expected_header) {
        return Err(contract_error(
            "Questionnaire CSV header does not match questionnaire-csv-v1.",
        ));
    }
    if records
        .iter()
        .skip(1)
        .any(|row| row.len() != expected_header.len())
    {
        return Err(contract_error(
            "Every Questionnaire CSV data row must contain exactly 14 columns.",
        ));
    }

    let metadata = records[1][..7].to_vec();
    let mut items: Vec<QuestionnaireItemV1> = Vec::new();
    let mut seen_items = BTreeSet::new();
    for (record_index, row) in records.iter().enumerate().skip(1) {
        if row.len() != expected_header.len() {
            return Err(contract_error(format!(
                "Questionnaire CSV row {} does not contain exactly 14 columns.",
                record_index + 1
            )));
        }
        if row[0] != QUESTIONNAIRE_CSV_FORMAT_VERSION || row[..7] != metadata {
            return Err(contract_error(
                "Questionnaire CSV changes its format or repeated metadata.",
            ));
        }
        let item_id = row[7].clone();
        require_identifier(&item_id, "Questionnaire CSV item_id")?;
        let prompt = row[8].clone();
        require_canonical_text(&prompt, 1, 4_000, "Questionnaire CSV prompt")?;
        let required = match row[9].as_str() {
            "true" => true,
            "false" => false,
            _ => {
                return Err(contract_error(
                    "Questionnaire CSV required must be exactly true or false.",
                ));
            }
        };
        let subscale = if row[10].is_empty() {
            None
        } else {
            require_canonical_text(&row[10], 1, 300, "Questionnaire CSV subscale")?;
            Some(row[10].clone())
        };
        let option_id = row[11].clone();
        require_identifier(&option_id, "Questionnaire CSV option_id")?;
        let option_label = row[12].clone();
        require_canonical_text(&option_label, 1, 500, "Questionnaire CSV option_label")?;
        let score_value = parse_score(&row[13])?;

        let starts_new_item = items.last().is_none_or(|item| item.item_id != item_id);
        if starts_new_item {
            if !seen_items.insert(item_id.clone()) {
                return Err(contract_error(
                    "Questionnaire CSV repeats a noncontiguous item ID.",
                ));
            }
            if items.len() == MAX_ITEMS {
                return Err(contract_error(
                    "Questionnaire CSV exceeds the 1024-item bound.",
                ));
            }
            items.push(QuestionnaireItemV1 {
                item_id: item_id.clone(),
                order: (items.len() + 1) as u32,
                prompt: prompt.clone(),
                required,
                subscale: subscale.clone(),
                options: Vec::new(),
            });
        }
        let item = items
            .last_mut()
            .expect("a questionnaire row always has an active item");
        if item.prompt != prompt || item.required != required || item.subscale != subscale {
            return Err(contract_error(
                "Questionnaire CSV changes prompt, required, or subscale within one item.",
            ));
        }
        if item.options.len() == MAX_OPTIONS_PER_ITEM
            || item
                .options
                .iter()
                .any(|option| option.option_id == option_id)
        {
            return Err(contract_error(
                "Questionnaire CSV repeats an option ID or exceeds 64 options per item.",
            ));
        }
        item.options.push(QuestionnaireOptionV1 {
            option_id,
            order: (item.options.len() + 1) as u32,
            label: option_label,
            score_value,
        });
    }

    let source = QuestionnaireSourceV1 {
        kind: source_kind,
        logical_name: logical_name.to_owned(),
        source_document_sha256,
        format_version: QUESTIONNAIRE_CSV_FORMAT_VERSION.to_owned(),
        byte_length: bytes.len() as u64,
        sha256: source_sha256.clone(),
    };
    let mut definition = QuestionnaireDefinitionV1 {
        schema: QUESTIONNAIRE_DEFINITION_SCHEMA.to_owned(),
        version: 1,
        questionnaire_id: metadata[1].clone(),
        questionnaire_version: metadata[2].clone(),
        title: metadata[3].clone(),
        language: metadata[4].clone(),
        instructions: metadata[5].clone(),
        attribution: metadata[6].clone(),
        source,
        items,
        definition_sha256: String::new(),
    };
    definition.definition_sha256 = canonical_sha256(&definition, &["definitionSha256"])?;
    definition = definition.normalize_and_validate()?;
    Ok(QuestionnaireImportReceipt {
        source_sha256,
        definition_sha256: definition.definition_sha256.clone(),
        definition,
    })
}

impl ProtocolStepV1 {
    pub fn protocol_position(&self) -> u32 {
        match self {
            Self::Questionnaire {
                protocol_position, ..
            }
            | Self::Stimulus {
                protocol_position, ..
            } => *protocol_position,
        }
    }

    pub fn stimulus_position(&self) -> Option<u32> {
        match self {
            Self::Stimulus {
                stimulus_position, ..
            } => Some(*stimulus_position),
            Self::Questionnaire { .. } => None,
        }
    }
}

impl ResolvedProtocolPlanV1 {
    pub fn validate_self(&self) -> ResearchResult<()> {
        if self.schema != RESEARCH_PROTOCOL_PLAN_SCHEMA
            || self.version != 1
            || self.algorithm_version != QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION
        {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 schema, version, or algorithm is unsupported.",
            ));
        }
        validate_sha256(
            &self.settings_sha256,
            "ResolvedProtocolPlanV1.settingsSha256",
        )?;
        validate_sha256(
            &self.assignment_plan_sha256,
            "ResolvedProtocolPlanV1.assignmentPlanSha256",
        )?;
        validate_participant_id(&self.participant_id)?;
        if self.condition_order.is_empty() || self.condition_order.len() > 256 {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 conditionOrder must contain 1–256 pools.",
            ));
        }
        let mut pool_ids = BTreeSet::new();
        for pool_id in &self.condition_order {
            require_identifier(pool_id, "ResolvedProtocolPlanV1.conditionOrder")?;
            if !pool_ids.insert(pool_id.as_str()) {
                return Err(contract_error(
                    "ResolvedProtocolPlanV1 repeats a condition pool.",
                ));
            }
        }
        if self.steps.is_empty() || self.steps.len() > MAX_PROTOCOL_STEPS {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 must contain 1–20000 steps.",
            ));
        }
        let mut module_ids = BTreeSet::new();
        let mut stimulus_ids = BTreeSet::new();
        for (index, step) in self.steps.iter().enumerate() {
            if step.protocol_position() as usize != index + 1 {
                return Err(contract_error(
                    "ResolvedProtocolPlanV1 protocol positions must be contiguous and one-based.",
                ));
            }
            match step {
                ProtocolStepV1::Questionnaire {
                    block_position,
                    pool_id,
                    module_id,
                    questionnaire_id,
                    definition_sha256,
                    placement,
                    ..
                } => {
                    require_identifier(module_id, "ResolvedProtocolPlanV1.moduleId")?;
                    require_identifier(questionnaire_id, "ResolvedProtocolPlanV1.questionnaireId")?;
                    validate_sha256(definition_sha256, "ResolvedProtocolPlanV1.definitionSha256")?;
                    if !module_ids.insert(module_id.as_str()) {
                        return Err(contract_error(
                            "ResolvedProtocolPlanV1 repeats a questionnaire module.",
                        ));
                    }
                    match placement {
                        QuestionnairePlacementKindV1::BeforeSession
                        | QuestionnairePlacementKindV1::AfterSession => {
                            if block_position.is_some() || pool_id.is_some() {
                                return Err(contract_error(
                                    "Session questionnaire steps require null block and pool identity.",
                                ));
                            }
                        }
                        QuestionnairePlacementKindV1::BeforeBlock
                        | QuestionnairePlacementKindV1::AfterBlock => {
                            let block_position = block_position.ok_or_else(|| {
                                contract_error(
                                    "Block questionnaire steps require a block position.",
                                )
                            })?;
                            let pool_id = pool_id.as_deref().ok_or_else(|| {
                                contract_error("Block questionnaire steps require a pool ID.")
                            })?;
                            if block_position == 0
                                || block_position as usize > self.condition_order.len()
                                || self.condition_order[block_position as usize - 1] != pool_id
                            {
                                return Err(contract_error(
                                    "A block questionnaire step does not match conditionOrder.",
                                ));
                            }
                        }
                    }
                }
                ProtocolStepV1::Stimulus {
                    block_position,
                    pool_id,
                    stimulus_position,
                    pool_position,
                    stimulus_id,
                    ..
                } => {
                    require_identifier(pool_id, "ResolvedProtocolPlanV1.poolId")?;
                    require_identifier(stimulus_id, "ResolvedProtocolPlanV1.stimulusId")?;
                    if *block_position == 0
                        || *block_position as usize > self.condition_order.len()
                        || self.condition_order[*block_position as usize - 1] != *pool_id
                        || *stimulus_position == 0
                        || *pool_position == 0
                    {
                        return Err(contract_error(
                            "A stimulus protocol step has invalid block or position identity.",
                        ));
                    }
                    if !stimulus_ids.insert(stimulus_id.as_str()) {
                        return Err(contract_error(
                            "ResolvedProtocolPlanV1 repeats a participant stimulus.",
                        ));
                    }
                }
            }
        }
        validate_protocol_step_order(&self.steps, &self.condition_order)?;
        validate_sha256(
            &self.protocol_plan_hash_sha256,
            "ResolvedProtocolPlanV1.protocolPlanHashSha256",
        )?;
        if canonical_sha256(self, &["protocolPlanHashSha256"])? != self.protocol_plan_hash_sha256 {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 protocol hash does not match canonical content.",
            ));
        }
        Ok(())
    }

    pub fn validate_bindings(
        &self,
        settings: &ResearchSettingsV2,
        assignment_plan: &ResolvedAssignmentPlanV1,
    ) -> ResearchResult<()> {
        self.validate_self()?;
        let settings = settings.clone().normalize_and_validate()?;
        let assignment_settings = settings.assignment_projection()?.normalize_and_validate()?;
        let assignment_settings_sha256 = assignment_settings.canonical_sha256()?;
        assignment_plan.validate(&assignment_settings_sha256)?;
        if assignment_plan.settings_sha256 != assignment_settings_sha256
            || self.settings_sha256 != settings.canonical_sha256()?
            || self.assignment_plan_sha256 != assignment_plan.plan_hash_sha256
        {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 hash bindings do not match settings and assignment.",
            ));
        }
        let expected = resolve_protocol_plan_v1(&settings, assignment_plan, &self.participant_id)?;
        if expected != *self {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 does not match the frozen participant assignment and questionnaire order.",
            ));
        }
        Ok(())
    }
}

pub fn resolve_protocol_plan_v1(
    settings: &ResearchSettingsV2,
    assignment_plan: &ResolvedAssignmentPlanV1,
    participant_id: &str,
) -> ResearchResult<ResolvedProtocolPlanV1> {
    let settings = settings.clone().normalize_and_validate()?;
    validate_participant_id(participant_id)?;
    let assignment_settings = settings.assignment_projection()?.normalize_and_validate()?;
    let assignment_settings_sha256 = assignment_settings.canonical_sha256()?;
    assignment_plan.validate(&assignment_settings_sha256)?;
    let assignment = assignment_plan
        .assignment_for(participant_id)
        .ok_or_else(|| contract_error("The protocol participant has no assignment."))?;
    let mut steps = Vec::new();
    append_questionnaire_steps(
        &mut steps,
        &settings.questionnaires.modules,
        QuestionnairePlacementKindV1::BeforeSession,
        None,
        None,
    );
    for (block_index, pool_id) in assignment.condition_order.iter().enumerate() {
        let block_position = (block_index + 1) as u32;
        append_questionnaire_steps(
            &mut steps,
            &settings.questionnaires.modules,
            QuestionnairePlacementKindV1::BeforeBlock,
            Some(pool_id),
            Some(block_position),
        );
        let block_slots: Vec<_> = assignment
            .slots
            .iter()
            .filter(|slot| slot.pool_id == *pool_id)
            .collect();
        if block_slots.is_empty() {
            return Err(contract_error(
                "A participant assignment contains an empty condition block.",
            ));
        }
        for slot in block_slots {
            steps.push(ProtocolStepV1::Stimulus {
                protocol_position: (steps.len() + 1) as u32,
                block_position,
                pool_id: slot.pool_id.clone(),
                stimulus_position: slot.position,
                pool_position: slot.pool_position,
                stimulus_id: slot.stimulus_id.clone(),
            });
        }
        append_questionnaire_steps(
            &mut steps,
            &settings.questionnaires.modules,
            QuestionnairePlacementKindV1::AfterBlock,
            Some(pool_id),
            Some(block_position),
        );
    }
    append_questionnaire_steps(
        &mut steps,
        &settings.questionnaires.modules,
        QuestionnairePlacementKindV1::AfterSession,
        None,
        None,
    );
    let mut plan = ResolvedProtocolPlanV1 {
        schema: RESEARCH_PROTOCOL_PLAN_SCHEMA.to_owned(),
        version: 1,
        algorithm_version: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION.to_owned(),
        settings_sha256: settings.canonical_sha256()?,
        assignment_plan_sha256: assignment_plan.plan_hash_sha256.clone(),
        participant_id: participant_id.to_owned(),
        condition_order: assignment.condition_order.clone(),
        steps,
        protocol_plan_hash_sha256: String::new(),
    };
    plan.protocol_plan_hash_sha256 = canonical_sha256(&plan, &["protocolPlanHashSha256"])?;
    plan.validate_self()?;
    Ok(plan)
}

fn append_questionnaire_steps(
    steps: &mut Vec<ProtocolStepV1>,
    modules: &[QuestionnaireModuleV1],
    placement: QuestionnairePlacementKindV1,
    pool_id: Option<&str>,
    block_position: Option<u32>,
) {
    for module in modules.iter().filter(|module| {
        module.placement.kind == placement && module.placement.pool_id.as_deref() == pool_id
    }) {
        steps.push(ProtocolStepV1::Questionnaire {
            protocol_position: (steps.len() + 1) as u32,
            block_position,
            pool_id: pool_id.map(str::to_owned),
            module_id: module.module_id.clone(),
            questionnaire_id: module.questionnaire_id.clone(),
            definition_sha256: module.definition_sha256.clone(),
            placement,
        });
    }
}

fn validate_protocol_step_order(
    steps: &[ProtocolStepV1],
    condition_order: &[String],
) -> ResearchResult<()> {
    let mut cursor = 0usize;
    while matches!(
        steps.get(cursor),
        Some(ProtocolStepV1::Questionnaire {
            placement: QuestionnairePlacementKindV1::BeforeSession,
            ..
        })
    ) {
        cursor += 1;
    }
    let mut expected_stimulus_position = 1u32;
    for (block_index, expected_pool) in condition_order.iter().enumerate() {
        let block_position = (block_index + 1) as u32;
        while matches!(
            steps.get(cursor),
            Some(ProtocolStepV1::Questionnaire {
                placement: QuestionnairePlacementKindV1::BeforeBlock,
                block_position: Some(position),
                pool_id: Some(pool_id),
                ..
            }) if *position == block_position && pool_id == expected_pool
        ) {
            cursor += 1;
        }
        let mut expected_pool_position = 1u32;
        while let Some(ProtocolStepV1::Stimulus {
            block_position: observed_block,
            pool_id,
            stimulus_position,
            pool_position,
            ..
        }) = steps.get(cursor)
        {
            if *observed_block != block_position || pool_id != expected_pool {
                break;
            }
            if *stimulus_position != expected_stimulus_position
                || *pool_position != expected_pool_position
            {
                return Err(contract_error(
                    "ResolvedProtocolPlanV1 stimulus positions are not contiguous.",
                ));
            }
            cursor += 1;
            expected_stimulus_position += 1;
            expected_pool_position += 1;
        }
        if expected_pool_position == 1 {
            return Err(contract_error(
                "ResolvedProtocolPlanV1 contains an empty condition block.",
            ));
        }
        while matches!(
            steps.get(cursor),
            Some(ProtocolStepV1::Questionnaire {
                placement: QuestionnairePlacementKindV1::AfterBlock,
                block_position: Some(position),
                pool_id: Some(pool_id),
                ..
            }) if *position == block_position && pool_id == expected_pool
        ) {
            cursor += 1;
        }
    }
    while matches!(
        steps.get(cursor),
        Some(ProtocolStepV1::Questionnaire {
            placement: QuestionnairePlacementKindV1::AfterSession,
            ..
        })
    ) {
        cursor += 1;
    }
    if cursor != steps.len() {
        return Err(contract_error(
            "ResolvedProtocolPlanV1 steps do not follow session and block hook order.",
        ));
    }
    Ok(())
}

impl QuestionnaireResponseV1 {
    pub fn validate(&self) -> ResearchResult<()> {
        if self.schema != QUESTIONNAIRE_RESPONSE_SCHEMA || self.version != 1 {
            return Err(contract_error(
                "QuestionnaireResponseV1 schema or version is unsupported.",
            ));
        }
        validate_response_record_identity(self)?;
        require_identifier(&self.module_id, "QuestionnaireResponseV1.moduleId")?;
        require_identifier(
            &self.questionnaire_id,
            "QuestionnaireResponseV1.questionnaireId",
        )?;
        require_canonical_text(
            &self.questionnaire_version,
            1,
            120,
            "QuestionnaireResponseV1.questionnaireVersion",
        )?;
        validate_sha256(
            &self.definition_sha256,
            "QuestionnaireResponseV1.definitionSha256",
        )?;
        require_identifier(&self.item_id, "QuestionnaireResponseV1.itemId")?;
        require_identifier(&self.option_id, "QuestionnaireResponseV1.optionId")?;
        if self.item_order == 0
            || self.item_order as usize > MAX_ITEMS
            || self.option_order == 0
            || self.option_order as usize > MAX_OPTIONS_PER_ITEM
        {
            return Err(contract_error(
                "QuestionnaireResponseV1 item or option order is invalid.",
            ));
        }
        require_canonical_text(
            &self.response_label,
            1,
            500,
            "QuestionnaireResponseV1.responseLabel",
        )?;
        if let Some(score) = self.score_value {
            validate_finite_range(
                score,
                -MAX_SCORE_ABS,
                MAX_SCORE_ABS,
                "QuestionnaireResponseV1.scoreValue",
            )?;
        }
        if let Some(subscale) = &self.subscale {
            require_canonical_text(subscale, 1, 300, "QuestionnaireResponseV1.subscale")?;
        }
        validate_finite_range(
            self.response_latency_ms,
            0.0,
            MAX_RESPONSE_LATENCY_MS,
            "QuestionnaireResponseV1.responseLatencyMs",
        )
    }

    pub fn validate_bindings(
        &self,
        settings: &ResearchSettingsV2,
        protocol_plan: &ResolvedProtocolPlanV1,
    ) -> ResearchResult<()> {
        self.validate()?;
        let settings = settings.clone().normalize_and_validate()?;
        protocol_plan.validate_self()?;
        let settings_sha256 = settings.canonical_sha256()?;
        if protocol_plan.settings_sha256 != settings_sha256
            || self.settings_sha256 != settings_sha256
            || self.assignment_plan_sha256 != protocol_plan.assignment_plan_sha256
            || self.protocol_plan_sha256 != protocol_plan.protocol_plan_hash_sha256
            || self.participant_id != protocol_plan.participant_id
        {
            return Err(contract_error(
                "QuestionnaireResponseV1 does not bind the frozen settings and protocol.",
            ));
        }
        let step = protocol_plan
            .steps
            .get(self.protocol_step_position.saturating_sub(1) as usize)
            .ok_or_else(|| {
                contract_error("Questionnaire response protocol step is unavailable.")
            })?;
        let ProtocolStepV1::Questionnaire {
            module_id,
            questionnaire_id,
            definition_sha256,
            ..
        } = step
        else {
            return Err(contract_error(
                "QuestionnaireResponseV1 cannot bind a stimulus protocol step.",
            ));
        };
        if self.module_id != *module_id
            || self.questionnaire_id != *questionnaire_id
            || self.definition_sha256 != *definition_sha256
        {
            return Err(contract_error(
                "QuestionnaireResponseV1 module identity differs from its protocol step.",
            ));
        }
        let definition = settings
            .definition(questionnaire_id)
            .ok_or_else(|| contract_error("Questionnaire response definition is unavailable."))?;
        let item = definition
            .items
            .iter()
            .find(|item| item.item_id == self.item_id)
            .ok_or_else(|| contract_error("Questionnaire response item is unavailable."))?;
        let option = item
            .options
            .iter()
            .find(|option| option.option_id == self.option_id)
            .ok_or_else(|| contract_error("Questionnaire response option is unavailable."))?;
        if self.questionnaire_version != definition.questionnaire_version
            || self.item_order != item.order
            || self.option_order != option.order
            || self.response_label != option.label
            || self.score_value != option.score_value
            || self.subscale != item.subscale
        {
            return Err(contract_error(
                "QuestionnaireResponseV1 derived fields differ from the frozen definition.",
            ));
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
pub fn derive_questionnaire_responses_v1(
    settings: &ResearchSettingsV2,
    protocol_plan: &ResolvedProtocolPlanV1,
    protocol_step_position: u32,
    answers: &[QuestionnaireAnswerInputV1],
    status: QuestionnaireResponseStatusV1,
    first_sequence: u64,
    run_id: &str,
    participant_id: &str,
    attempt_number: u32,
    wall_time_utc: &str,
    monotonic_time_ns: &str,
) -> ResearchResult<Vec<QuestionnaireResponseV1>> {
    let settings = settings.clone().normalize_and_validate()?;
    protocol_plan.validate_self()?;
    if protocol_plan.settings_sha256 != settings.canonical_sha256()? {
        return Err(contract_error(
            "Questionnaire response settings differ from the resolved protocol.",
        ));
    }
    validate_uuid(run_id, "QuestionnaireResponseV1.runId")?;
    validate_participant_id(participant_id)?;
    parse_canonical_utc_timestamp(wall_time_utc, "QuestionnaireResponseV1.wallTimeUtc")?;
    validate_monotonic_ns(monotonic_time_ns, "QuestionnaireResponseV1.monotonicTimeNs")?;
    if first_sequence == 0 || first_sequence > MAX_SAFE_INTEGER || attempt_number == 0 {
        return Err(contract_error(
            "Questionnaire response sequence or attempt number is invalid.",
        ));
    }
    let step = protocol_plan
        .steps
        .get(protocol_step_position.saturating_sub(1) as usize)
        .ok_or_else(|| contract_error("Questionnaire protocol step is unavailable."))?;
    let ProtocolStepV1::Questionnaire {
        module_id,
        questionnaire_id,
        definition_sha256,
        ..
    } = step
    else {
        return Err(contract_error(
            "Questionnaire responses cannot be submitted for a stimulus step.",
        ));
    };
    let definition = settings
        .definition(questionnaire_id)
        .ok_or_else(|| contract_error("Questionnaire definition is unavailable."))?;
    if definition.definition_sha256 != *definition_sha256 {
        return Err(contract_error(
            "Questionnaire protocol definition hash is unavailable.",
        ));
    }
    let mut by_item = BTreeMap::new();
    for answer in answers {
        require_identifier(&answer.item_id, "Questionnaire answer itemId")?;
        require_identifier(&answer.option_id, "Questionnaire answer optionId")?;
        validate_finite_range(
            answer.response_latency_ms,
            0.0,
            MAX_RESPONSE_LATENCY_MS,
            "Questionnaire answer responseLatencyMs",
        )?;
        if by_item.insert(answer.item_id.as_str(), answer).is_some() {
            return Err(contract_error("Questionnaire answers repeat an item ID."));
        }
    }
    if answers.len() > definition.items.len() {
        return Err(contract_error(
            "Questionnaire answers exceed the frozen item count.",
        ));
    }
    if status == QuestionnaireResponseStatusV1::Submitted
        && definition
            .items
            .iter()
            .any(|item| item.required && !by_item.contains_key(item.item_id.as_str()))
    {
        return Err(contract_error(
            "A submitted questionnaire requires every required item.",
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
            .ok_or_else(|| contract_error("A questionnaire answer uses an unknown option."))?;
        let sequence = first_sequence
            .checked_add(responses.len() as u64)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| contract_error("Questionnaire response sequence overflowed."))?;
        let response = QuestionnaireResponseV1 {
            schema: QUESTIONNAIRE_RESPONSE_SCHEMA.to_owned(),
            version: 1,
            sequence,
            run_id: run_id.to_owned(),
            participant_id: participant_id.to_owned(),
            attempt_number,
            settings_sha256: settings.canonical_sha256()?,
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
        response.validate_bindings(&settings, protocol_plan)?;
        responses.push(response);
    }
    Ok(responses)
}

impl ResearchEventTypeV2 {
    fn is_questionnaire(self) -> bool {
        matches!(
            self,
            Self::QuestionnaireStarted
                | Self::QuestionnaireDraftCheckpointed
                | Self::QuestionnaireCompleted
        )
    }

    fn is_timing_gap(self) -> bool {
        self == Self::TimingGap
    }
}

impl ResearchEventV2 {
    pub fn validate(&self) -> ResearchResult<()> {
        if self.schema != RESEARCH_EVENT_SCHEMA || self.version != 2 {
            return Err(contract_error(
                "ResearchEventV2 schema or version is unsupported.",
            ));
        }
        validate_common_record_identity(
            self.sequence,
            &self.run_id,
            &self.participant_id,
            self.attempt_number,
            &self.settings_sha256,
            &self.assignment_plan_sha256,
            &self.wall_time_utc,
            &self.monotonic_time_ns,
            "ResearchEventV2",
        )?;
        validate_sha256(
            &self.protocol_plan_sha256,
            "ResearchEventV2.protocolPlanSha256",
        )?;
        if self.stimulus_identity.is_some() != self.stimulus_position.is_some() {
            return Err(contract_error(
                "ResearchEventV2 stimulus identity and position must be present together.",
            ));
        }
        if let Some(identity) = &self.stimulus_identity {
            identity.validate()?;
        }
        if self.stimulus_position.is_some_and(|position| {
            position == 0 || position as usize > crate::research_contracts::MAX_STIMULI
        }) {
            return Err(contract_error(
                "ResearchEventV2 stimulus position is invalid.",
            ));
        }
        if let Some(media_time_ms) = self.media_time_ms {
            let identity = self.stimulus_identity.as_ref().ok_or_else(|| {
                contract_error("ResearchEventV2 media time requires a stimulus identity.")
            })?;
            validate_finite_range(
                media_time_ms,
                0.0,
                identity.duration_ms,
                "ResearchEventV2.mediaTimeMs",
            )?;
        }
        if self.event_type.is_timing_gap() != self.missed_slot_count.is_some()
            || self
                .missed_slot_count
                .is_some_and(|count| count == 0 || count > 1_000_000)
        {
            return Err(contract_error(
                "ResearchEventV2 timing-gap count is inconsistent.",
            ));
        }
        if let Some(detail_code) = &self.detail_code {
            require_semantic_code(detail_code, "ResearchEventV2.detailCode")?;
        }
        if self
            .protocol_step_position
            .is_some_and(|position| position == 0 || position as usize > MAX_PROTOCOL_STEPS)
        {
            return Err(contract_error(
                "ResearchEventV2 protocol step position is invalid.",
            ));
        }
        if self.event_type.is_questionnaire() {
            if self.protocol_step_position.is_none()
                || self.stimulus_identity.is_some()
                || self.stimulus_position.is_some()
                || self.media_time_ms.is_some()
                || self.missed_slot_count.is_some()
            {
                return Err(contract_error(
                    "Questionnaire events require one protocol step and no stimulus timing.",
                ));
            }
            require_identifier(
                self.module_id.as_deref().unwrap_or_default(),
                "ResearchEventV2.moduleId",
            )?;
            require_identifier(
                self.questionnaire_id.as_deref().unwrap_or_default(),
                "ResearchEventV2.questionnaireId",
            )?;
            validate_sha256(
                self.definition_sha256.as_deref().unwrap_or_default(),
                "ResearchEventV2.definitionSha256",
            )?;
        } else if self.module_id.is_some()
            || self.questionnaire_id.is_some()
            || self.definition_sha256.is_some()
        {
            return Err(contract_error(
                "Non-questionnaire events cannot carry questionnaire identity.",
            ));
        }
        if !self.event_type.is_questionnaire()
            && self.stimulus_identity.is_some()
            && self.protocol_step_position.is_none()
        {
            return Err(contract_error(
                "Stimulus events require their frozen protocol step position.",
            ));
        }
        Ok(())
    }

    pub fn validate_protocol_binding(
        &self,
        protocol_plan: &ResolvedProtocolPlanV1,
    ) -> ResearchResult<()> {
        self.validate()?;
        protocol_plan.validate_self()?;
        if self.protocol_plan_sha256 != protocol_plan.protocol_plan_hash_sha256
            || self.assignment_plan_sha256 != protocol_plan.assignment_plan_sha256
            || self.settings_sha256 != protocol_plan.settings_sha256
            || self.participant_id != protocol_plan.participant_id
        {
            return Err(contract_error(
                "ResearchEventV2 does not bind the frozen protocol plan.",
            ));
        }
        if self.event_type.is_questionnaire() {
            let position = self.protocol_step_position.unwrap_or_default();
            let step = protocol_plan
                .steps
                .get(position.saturating_sub(1) as usize)
                .ok_or_else(|| contract_error("Questionnaire event step is unavailable."))?;
            let ProtocolStepV1::Questionnaire {
                module_id,
                questionnaire_id,
                definition_sha256,
                ..
            } = step
            else {
                return Err(contract_error(
                    "A questionnaire event cannot bind a stimulus step.",
                ));
            };
            if self.module_id.as_ref() != Some(module_id)
                || self.questionnaire_id.as_ref() != Some(questionnaire_id)
                || self.definition_sha256.as_ref() != Some(definition_sha256)
            {
                return Err(contract_error(
                    "A questionnaire event identity differs from its protocol step.",
                ));
            }
        } else if let Some(identity) = &self.stimulus_identity {
            let position = self.protocol_step_position.unwrap_or_default();
            let step = protocol_plan
                .steps
                .get(position.saturating_sub(1) as usize)
                .ok_or_else(|| contract_error("Stimulus event protocol step is unavailable."))?;
            let ProtocolStepV1::Stimulus {
                stimulus_id,
                stimulus_position,
                ..
            } = step
            else {
                return Err(contract_error(
                    "A stimulus event cannot bind a questionnaire step.",
                ));
            };
            if identity.stimulus_id != *stimulus_id
                || self.stimulus_position != Some(*stimulus_position)
            {
                return Err(contract_error(
                    "A stimulus event identity differs from its protocol step.",
                ));
            }
        }
        Ok(())
    }
}

impl RecoveryJournalV2 {
    pub fn validate(
        &self,
        settings: &ResearchSettingsV2,
        assignment_plan: &ResolvedAssignmentPlanV1,
        protocol_plan: &ResolvedProtocolPlanV1,
    ) -> ResearchResult<()> {
        if self.schema != RESEARCH_RECOVERY_JOURNAL_SCHEMA || self.version != 2 {
            return Err(contract_error(
                "RecoveryJournalV2 schema or version is unsupported.",
            ));
        }
        validate_uuid(&self.recovery_id, "RecoveryJournalV2.recoveryId")?;
        validate_uuid(&self.run_id, "RecoveryJournalV2.runId")?;
        require_identifier(&self.experiment_id, "RecoveryJournalV2.experimentId")?;
        validate_participant_id(&self.participant_id)?;
        validate_participant_code(&self.participant_code)?;
        if self.age == 0 || self.age > 120 || self.attempt_number == 0 {
            return Err(contract_error(
                "RecoveryJournalV2 participant metadata is invalid.",
            ));
        }
        require_safe_basename(&self.session_stem, "RecoveryJournalV2.sessionStem")?;
        parse_canonical_utc_timestamp(&self.started_at, "RecoveryJournalV2.startedAt")?;
        validate_monotonic_ns(
            &self.last_monotonic_time_ns,
            "RecoveryJournalV2.lastMonotonicTimeNs",
        )?;
        let settings = settings.clone().normalize_and_validate()?;
        let assignment_settings = settings.assignment_projection()?.normalize_and_validate()?;
        let assignment_settings_hash = assignment_settings.canonical_sha256()?;
        assignment_plan.validate(&assignment_settings_hash)?;
        protocol_plan.validate_bindings(&settings, assignment_plan)?;
        if self.experiment_id != settings.experiment.id
            || self.participant_id != protocol_plan.participant_id
            || self.settings_sha256 != settings.canonical_sha256()?
            || self.assignment_plan_sha256 != assignment_plan.plan_hash_sha256
            || self.protocol_plan_sha256 != protocol_plan.protocol_plan_hash_sha256
        {
            return Err(contract_error(
                "RecoveryJournalV2 does not bind the frozen settings, assignment, and protocol.",
            ));
        }
        let expected_definitions: Vec<_> = settings
            .questionnaires
            .definitions
            .iter()
            .map(|definition| QuestionnaireDefinitionReceiptV1 {
                questionnaire_id: definition.questionnaire_id.clone(),
                definition_sha256: definition.definition_sha256.clone(),
            })
            .collect();
        if self.definition_hashes != expected_definitions {
            return Err(contract_error(
                "RecoveryJournalV2 definition receipts differ from frozen settings.",
            ));
        }
        if self.partial_sample_count > MAX_SAFE_INTEGER
            || self.partial_event_count > MAX_SAFE_INTEGER
            || self.partial_questionnaire_response_count > MAX_RESPONSES as u64
            || self.safe_protocol_step_position as usize > protocol_plan.steps.len()
            || self.gap_event_count > self.partial_event_count
            || (self.gap_event_count == 0) != (self.missed_slot_count == 0)
        {
            return Err(contract_error(
                "RecoveryJournalV2 counters are inconsistent.",
            ));
        }
        if let Some(position) = self.active_protocol_step_position {
            if position != self.safe_protocol_step_position.saturating_add(1)
                || position as usize > protocol_plan.steps.len()
            {
                return Err(contract_error(
                    "RecoveryJournalV2 active step is not the next unsafe protocol step.",
                ));
            }
        }
        if let Some(draft) = &self.active_questionnaire_draft {
            if self.active_protocol_step_position != Some(draft.protocol_step_position)
                || draft.responses.len() > MAX_ITEMS
            {
                return Err(contract_error(
                    "RecoveryJournalV2 questionnaire draft is outside the active step.",
                ));
            }
            let step = protocol_plan
                .steps
                .get(draft.protocol_step_position.saturating_sub(1) as usize)
                .ok_or_else(|| contract_error("Recovery draft protocol step is unavailable."))?;
            let ProtocolStepV1::Questionnaire {
                module_id,
                questionnaire_id,
                definition_sha256,
                ..
            } = step
            else {
                return Err(contract_error(
                    "Recovery questionnaire draft cannot bind a stimulus step.",
                ));
            };
            if draft.module_id != *module_id
                || draft.questionnaire_id != *questionnaire_id
                || draft.definition_sha256 != *definition_sha256
            {
                return Err(contract_error(
                    "Recovery questionnaire draft identity differs from its protocol step.",
                ));
            }
            let mut items = BTreeSet::new();
            let mut sequences = BTreeSet::new();
            for response in &draft.responses {
                response.validate_bindings(&settings, protocol_plan)?;
                if response.status != QuestionnaireResponseStatusV1::Draft
                    || response.run_id != self.run_id
                    || response.participant_id != self.participant_id
                    || response.attempt_number != self.attempt_number
                    || response.protocol_step_position != draft.protocol_step_position
                    || response.module_id != draft.module_id
                    || response.questionnaire_id != draft.questionnaire_id
                    || response.definition_sha256 != draft.definition_sha256
                    || response.sequence > self.partial_questionnaire_response_count
                    || !sequences.insert(response.sequence)
                    || !items.insert(response.item_id.as_str())
                {
                    return Err(contract_error(
                        "RecoveryJournalV2 questionnaire draft rows are inconsistent.",
                    ));
                }
            }
        } else if self.active_protocol_step_position.is_some_and(|position| {
            matches!(
                protocol_plan.steps.get(position.saturating_sub(1) as usize),
                Some(ProtocolStepV1::Questionnaire { .. })
            )
        }) {
            // A questionnaire may be entered before the first answer; null draft is valid.
        }
        if self.recovery.resumed != self.recovery.source_run_id.is_some() {
            return Err(contract_error(
                "RecoveryJournalV2 resumed state and source run differ.",
            ));
        }
        for run_id in self.recovery.source_run_id.iter() {
            validate_uuid(run_id, "RecoveryJournalV2.recovery.sourceRunId")?;
        }
        let stimulus_ids: BTreeSet<_> = assignment_plan
            .assignment_for(&self.participant_id)
            .into_iter()
            .flat_map(|assignment| assignment.slots.iter())
            .map(|slot| slot.stimulus_id.as_str())
            .collect();
        let mut restarted = BTreeSet::new();
        for stimulus_id in &self.recovery.restarted_stimulus_ids {
            require_identifier(stimulus_id, "RecoveryJournalV2.restartedStimulusId")?;
            if !stimulus_ids.contains(stimulus_id.as_str())
                || !restarted.insert(stimulus_id.as_str())
            {
                return Err(contract_error(
                    "RecoveryJournalV2 restarted stimuli must be unique assignment members.",
                ));
            }
        }
        Ok(())
    }
}

fn validate_manifest_v3_stimulus_identity(
    stimulus: &SampleStimulusIdentityV1,
) -> ResearchResult<()> {
    stimulus.validate()?;
    if stimulus.duration_ms.fract() != 0.0 {
        return Err(contract_error(
            "ResearchRunManifestV3 stimulus durationMs must be an integer.",
        ));
    }
    if stimulus.kind == crate::research_contracts::StimulusSourceKindV1::Youtube {
        let video_id = stimulus.video_id.as_deref().unwrap_or_default();
        let canonical_video_id = video_id.len() == 11
            && video_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
        let canonical_url = format!("https://www.youtube.com/watch?v={video_id}");
        if !canonical_video_id || stimulus.url.as_deref() != Some(canonical_url.as_str()) {
            return Err(contract_error(
                "ResearchRunManifestV3 has a noncanonical YouTube URL or video ID.",
            ));
        }
    }
    Ok(())
}

impl ResearchRunManifestV3 {
    pub fn validate(&self) -> ResearchResult<()> {
        if self.schema != RESEARCH_RUN_MANIFEST_SCHEMA || self.version != 3 {
            return Err(contract_error(
                "ResearchRunManifestV3 schema or version is unsupported.",
            ));
        }
        validate_uuid(&self.run_id, "ResearchRunManifestV3.runId")?;
        require_identifier(&self.experiment_id, "ResearchRunManifestV3.experimentId")?;
        validate_participant_id(&self.participant_id)?;
        validate_participant_code(&self.participant_code)?;
        if self.age == 0
            || self.age > 120
            || self.attempt_number == 0
            || self.attempt_number > MAX_ATTEMPT_NUMBER
        {
            return Err(contract_error(
                "ResearchRunManifestV3 participant metadata is invalid.",
            ));
        }
        require_safe_basename(&self.session_stem, "ResearchRunManifestV3.sessionStem")?;
        validate_sha256(
            &self.settings_sha256,
            "ResearchRunManifestV3.settingsSha256",
        )?;
        validate_sha256(
            &self.assignment_plan_sha256,
            "ResearchRunManifestV3.assignmentPlanSha256",
        )?;
        validate_sha256(
            &self.protocol_plan_sha256,
            "ResearchRunManifestV3.protocolPlanSha256",
        )?;
        if self.stimuli.is_empty() || self.stimuli.len() > crate::research_contracts::MAX_STIMULI {
            return Err(contract_error(
                "ResearchRunManifestV3 stimuli are outside supported bounds.",
            ));
        }
        let mut stimulus_ids = BTreeSet::new();
        for stimulus in &self.stimuli {
            validate_manifest_v3_stimulus_identity(stimulus)?;
            if !stimulus_ids.insert(stimulus.stimulus_id.as_str()) {
                return Err(contract_error(
                    "ResearchRunManifestV3 repeats a stimulus identity.",
                ));
            }
        }
        match (
            self.build.platform,
            self.playback_mode,
            self.playback_qualification,
        ) {
            (
                ResearchPlatformV1::TauriWindows,
                RunPlaybackModeV3::NativeGstPlay,
                RunPlaybackQualificationV3::QualifiedNative,
            )
            | (
                ResearchPlatformV1::TauriWindows,
                RunPlaybackModeV3::UnqualifiedWebview,
                RunPlaybackQualificationV3::Unqualified,
            )
            | (
                ResearchPlatformV1::Chrome | ResearchPlatformV1::Edge,
                RunPlaybackModeV3::BrowserMediaAdapters,
                RunPlaybackQualificationV3::Browser,
            ) => {}
            _ => {
                return Err(contract_error(
                    "ResearchRunManifestV3 playback mode and qualification do not match its platform.",
                ));
            }
        }
        if self.protocol.protocol_step_count == 0
            || self.protocol.protocol_step_count as usize > MAX_PROTOCOL_STEPS
            || self.protocol.safe_protocol_step_position > self.protocol.protocol_step_count
            || (self.completion_status == crate::research_contracts::CompletionStatusV1::Completed
                && self.protocol.safe_protocol_step_position != self.protocol.protocol_step_count)
        {
            return Err(contract_error(
                "ResearchRunManifestV3 safe protocol boundary is invalid.",
            ));
        }
        let mut definition_ids = BTreeSet::new();
        let mut definition_hashes = BTreeSet::new();
        for definition in &self.protocol.questionnaire_definitions {
            require_identifier(
                &definition.questionnaire_id,
                "ResearchRunManifestV3.questionnaireId",
            )?;
            validate_sha256(
                &definition.definition_sha256,
                "ResearchRunManifestV3.definitionSha256",
            )?;
            if !definition_ids.insert(definition.questionnaire_id.as_str())
                || !definition_hashes.insert(definition.definition_sha256.as_str())
            {
                return Err(contract_error(
                    "ResearchRunManifestV3 repeats questionnaire definition identity.",
                ));
            }
        }
        let definitions_by_id: BTreeMap<_, _> = self
            .protocol
            .questionnaire_definitions
            .iter()
            .map(|definition| {
                (
                    definition.questionnaire_id.as_str(),
                    definition.definition_sha256.as_str(),
                )
            })
            .collect();
        if self.protocol.questionnaire_definitions.len() > MAX_DEFINITIONS
            || self.protocol.questionnaire_modules.len() > MAX_MODULES
        {
            return Err(contract_error(
                "ResearchRunManifestV3 questionnaire receipts exceed supported bounds.",
            ));
        }
        let mut module_ids = BTreeSet::new();
        let mut module_positions = BTreeSet::new();
        let mut submitted_response_count = 0u64;
        let mut draft_response_count = 0u64;
        let mut draft_modules = 0usize;
        for module in &self.protocol.questionnaire_modules {
            require_identifier(&module.module_id, "ResearchRunManifestV3.moduleId")?;
            require_identifier(
                &module.questionnaire_id,
                "ResearchRunManifestV3.questionnaireId",
            )?;
            validate_sha256(
                &module.definition_sha256,
                "ResearchRunManifestV3.definitionSha256",
            )?;
            if module.protocol_step_position == 0
                || module.protocol_step_position > self.protocol.protocol_step_count
                || !module_ids.insert(module.module_id.as_str())
                || !module_positions.insert(module.protocol_step_position)
                || definitions_by_id
                    .get(module.questionnaire_id.as_str())
                    .copied()
                    != Some(module.definition_sha256.as_str())
            {
                return Err(contract_error(
                    "ResearchRunManifestV3 questionnaire module receipt is invalid.",
                ));
            }
            match module.status {
                QuestionnaireModuleStatusV1::Submitted => {
                    submitted_response_count = submitted_response_count
                        .checked_add(module.response_count)
                        .ok_or_else(|| {
                            contract_error("Questionnaire response count overflowed.")
                        })?;
                }
                QuestionnaireModuleStatusV1::Draft => {
                    draft_modules += 1;
                    draft_response_count = draft_response_count
                        .checked_add(module.response_count)
                        .ok_or_else(|| {
                            contract_error("Questionnaire response count overflowed.")
                        })?;
                }
                QuestionnaireModuleStatusV1::NotReached => {
                    if module.response_count != 0 {
                        return Err(contract_error(
                            "A not-reached questionnaire module cannot contain responses.",
                        ));
                    }
                }
            }
            if module.protocol_step_position <= self.protocol.safe_protocol_step_position {
                if module.status != QuestionnaireModuleStatusV1::Submitted {
                    return Err(contract_error(
                        "A questionnaire before the safe boundary must be submitted.",
                    ));
                }
            } else if module.status == QuestionnaireModuleStatusV1::Submitted {
                return Err(contract_error(
                    "A questionnaire beyond the safe boundary cannot be submitted.",
                ));
            }
            if module.status == QuestionnaireModuleStatusV1::Draft
                && module.protocol_step_position
                    != self.protocol.safe_protocol_step_position.saturating_add(1)
            {
                return Err(contract_error(
                    "A questionnaire draft must occupy the next unsafe protocol step.",
                ));
            }
        }
        if draft_modules > 1
            || submitted_response_count != self.protocol.submitted_response_count
            || draft_response_count != self.protocol.draft_response_count
            || submitted_response_count.saturating_add(draft_response_count) > MAX_RESPONSES as u64
        {
            return Err(contract_error(
                "ResearchRunManifestV3 questionnaire status counts are inconsistent.",
            ));
        }
        if self.completion_status == crate::research_contracts::CompletionStatusV1::Completed
            && self
                .protocol
                .questionnaire_modules
                .iter()
                .any(|module| module.status != QuestionnaireModuleStatusV1::Submitted)
        {
            return Err(contract_error(
                "A completed ResearchRunManifestV3 requires every questionnaire submitted.",
            ));
        }
        validate_sha256(
            &self.protocol.submitted_responses_sha256,
            "ResearchRunManifestV3.submittedResponsesSha256",
        )?;
        validate_sha256(
            &self.protocol.draft_responses_sha256,
            "ResearchRunManifestV3.draftResponsesSha256",
        )?;
        if !(1..=240).contains(&self.timing.sample_rate_hz)
            || self.timing.sample_count > MAX_SAFE_INTEGER
            || self.timing.event_count > MAX_SAFE_INTEGER
            || self.timing.gap_event_count > self.timing.event_count
            || self.timing.missed_slot_count > MAX_SAFE_INTEGER
            || (self.timing.gap_event_count == 0) != (self.timing.missed_slot_count == 0)
            || self.timing.questionnaire_submitted_response_count != submitted_response_count
            || self.timing.questionnaire_draft_response_count != draft_response_count
        {
            return Err(contract_error(
                "ResearchRunManifestV3 timing and response counts are inconsistent.",
            ));
        }
        let started_at = parse_canonical_utc_timestamp(
            &self.timing.started_at,
            "ResearchRunManifestV3.timing.startedAt",
        )?;
        let finalized_at = parse_canonical_utc_timestamp(
            &self.timing.finalized_at,
            "ResearchRunManifestV3.timing.finalizedAt",
        )?;
        if finalized_at < started_at {
            return Err(contract_error(
                "ResearchRunManifestV3 finalization precedes its start.",
            ));
        }
        if expected_session_stem(self, &self.timing.started_at)? != self.session_stem {
            return Err(contract_error(
                "ResearchRunManifestV3 session stem is inconsistent.",
            ));
        }
        if self.outputs.len() < 5 || self.outputs.len() > 9 {
            return Err(contract_error(
                "ResearchRunManifestV3 output receipt count is invalid.",
            ));
        }
        let mut output_kinds = BTreeSet::new();
        let mut output_file_names = BTreeSet::new();
        for output in &self.outputs {
            require_safe_basename(&output.file_name, "ResearchRunManifestV3.output.fileName")?;
            validate_sha256(&output.sha256, "ResearchRunManifestV3.output.sha256")?;
            if output.byte_length == 0
                || output.byte_length > MAX_SAFE_INTEGER
                || !output_kinds.insert(output.kind)
                || !output_file_names.insert(output.file_name.as_str())
                || output
                    .row_count
                    .is_some_and(|count| count > MAX_SAFE_INTEGER)
            {
                return Err(contract_error(
                    "ResearchRunManifestV3 contains an invalid output receipt.",
                ));
            }
            let tabular = matches!(
                output.kind,
                RunOutputKindV3::RatingsCsv
                    | RunOutputKindV3::RatingsTsv
                    | RunOutputKindV3::QuestionnaireCsv
                    | RunOutputKindV3::QuestionnaireTsv
            );
            if tabular != output.row_count.is_some() {
                return Err(contract_error(
                    "ResearchRunManifestV3 output rowCount presence is inconsistent.",
                ));
            }
            match output.kind {
                RunOutputKindV3::ExperimentSource if output.file_name != "experiment.json" => {
                    return Err(contract_error(
                        "ResearchRunManifestV3 experimentSource must be experiment.json.",
                    ));
                }
                RunOutputKindV3::ExperimentPlan
                    if output.file_name != "experiment-plan.snapshot.json" =>
                {
                    return Err(contract_error(
                        "ResearchRunManifestV3 experimentPlan must be experiment-plan.snapshot.json.",
                    ));
                }
                RunOutputKindV3::RatingsCsv | RunOutputKindV3::RatingsTsv
                    if output.row_count != Some(self.timing.sample_count) =>
                {
                    return Err(contract_error(
                        "A rating output row count differs from canonical samples.",
                    ));
                }
                RunOutputKindV3::QuestionnaireCsv | RunOutputKindV3::QuestionnaireTsv
                    if output.row_count
                        != Some(submitted_response_count + draft_response_count) =>
                {
                    return Err(contract_error(
                        "A questionnaire output row count differs from canonical responses.",
                    ));
                }
                _ => {}
            }
        }
        for required in [
            RunOutputKindV3::Settings,
            RunOutputKindV3::ProtocolPlan,
            RunOutputKindV3::Events,
        ] {
            if !output_kinds.contains(&required) {
                return Err(contract_error(
                    "ResearchRunManifestV3 lacks a required snapshot or event output.",
                ));
            }
        }
        if !output_kinds.contains(&RunOutputKindV3::RatingsCsv)
            && !output_kinds.contains(&RunOutputKindV3::RatingsTsv)
            || !output_kinds.contains(&RunOutputKindV3::QuestionnaireCsv)
                && !output_kinds.contains(&RunOutputKindV3::QuestionnaireTsv)
        {
            return Err(contract_error(
                "ResearchRunManifestV3 requires selected rating and questionnaire tables.",
            ));
        }
        if self.recovery.resumed != self.recovery.source_run_id.is_some() {
            return Err(contract_error(
                "ResearchRunManifestV3 recovery source and resumed state differ.",
            ));
        }
        if let Some(source_run_id) = &self.recovery.source_run_id {
            validate_uuid(source_run_id, "ResearchRunManifestV3.recovery.sourceRunId")?;
        }
        let mut restarted = BTreeSet::new();
        for stimulus_id in &self.recovery.restarted_stimulus_ids {
            require_identifier(stimulus_id, "ResearchRunManifestV3.restartedStimulusId")?;
            if !stimulus_ids.contains(stimulus_id.as_str())
                || !restarted.insert(stimulus_id.as_str())
            {
                return Err(contract_error(
                    "ResearchRunManifestV3 restarted stimuli must be unique assignment members.",
                ));
            }
        }
        require_canonical_text(
            &self.build.app_version,
            1,
            40,
            "ResearchRunManifestV3.build.appVersion",
        )?;
        require_canonical_text(
            &self.build.build_commit,
            1,
            64,
            "ResearchRunManifestV3.build.buildCommit",
        )?;
        Ok(())
    }

    pub fn validate_protocol_binding(
        &self,
        protocol_plan: &ResolvedProtocolPlanV1,
    ) -> ResearchResult<()> {
        self.validate()?;
        protocol_plan.validate_self()?;
        if self.settings_sha256 != protocol_plan.settings_sha256
            || self.assignment_plan_sha256 != protocol_plan.assignment_plan_sha256
            || self.protocol_plan_sha256 != protocol_plan.protocol_plan_hash_sha256
            || self.participant_id != protocol_plan.participant_id
            || self.protocol.protocol_step_count as usize != protocol_plan.steps.len()
        {
            return Err(contract_error(
                "ResearchRunManifestV3 does not bind the frozen protocol plan.",
            ));
        }

        let mut module_receipts = self.protocol.questionnaire_modules.iter();
        let mut stimulus_receipts = self.stimuli.iter();
        for step in &protocol_plan.steps {
            match step {
                ProtocolStepV1::Questionnaire {
                    protocol_position,
                    module_id,
                    questionnaire_id,
                    definition_sha256,
                    ..
                } => {
                    let receipt = module_receipts.next().ok_or_else(|| {
                        contract_error(
                            "ResearchRunManifestV3 lacks a questionnaire protocol receipt.",
                        )
                    })?;
                    if receipt.protocol_step_position != *protocol_position
                        || receipt.module_id != *module_id
                        || receipt.questionnaire_id != *questionnaire_id
                        || receipt.definition_sha256 != *definition_sha256
                    {
                        return Err(contract_error(
                            "A ResearchRunManifestV3 questionnaire receipt differs from its protocol step.",
                        ));
                    }
                }
                ProtocolStepV1::Stimulus {
                    stimulus_id,
                    stimulus_position,
                    ..
                } => {
                    let receipt = stimulus_receipts.next().ok_or_else(|| {
                        contract_error("ResearchRunManifestV3 lacks a stimulus protocol receipt.")
                    })?;
                    if receipt.stimulus_id != *stimulus_id
                        || *stimulus_position as usize
                            != self.stimuli.len() - stimulus_receipts.len()
                    {
                        return Err(contract_error(
                            "A ResearchRunManifestV3 stimulus receipt differs from its protocol step.",
                        ));
                    }
                }
            }
        }
        if module_receipts.next().is_some() || stimulus_receipts.next().is_some() {
            return Err(contract_error(
                "ResearchRunManifestV3 contains receipts outside its protocol plan.",
            ));
        }
        Ok(())
    }
}

pub fn native_protocol_capability() -> NativeProtocolCapability {
    NativeProtocolCapability {
        schema: NATIVE_PROTOCOL_CAPABILITY_SCHEMA,
        version: 1,
        settings_v2_validation_ready: true,
        questionnaire_csv_import_ready: true,
        protocol_plan_validation_ready: true,
        native_start_resume_ready: false,
        durable_draft_checkpoint_ready: false,
        atomic_submission_ready: false,
        manifest_v3_finalization_ready: false,
        reason_code: "native-questionnaire-runtime-v3-not-integrated",
    }
}

pub fn protocol_preflight(
    settings: ResearchSettingsV2,
    assignment_plan: ResolvedAssignmentPlanV1,
    protocol_plan: ResolvedProtocolPlanV1,
) -> ResearchResult<ProtocolPreflightReceipt> {
    let settings = settings.normalize_and_validate()?;
    protocol_plan.validate_bindings(&settings, &assignment_plan)?;
    let assignment_settings = settings.assignment_projection()?.normalize_and_validate()?;
    let assignment_settings_sha256 = assignment_settings.canonical_sha256()?;
    let definition_hashes = settings
        .questionnaires
        .definitions
        .iter()
        .map(|definition| QuestionnaireDefinitionReceiptV1 {
            questionnaire_id: definition.questionnaire_id.clone(),
            definition_sha256: definition.definition_sha256.clone(),
        })
        .collect();
    let questionnaire_step_count = protocol_plan
        .steps
        .iter()
        .filter(|step| matches!(step, ProtocolStepV1::Questionnaire { .. }))
        .count() as u32;
    let stimulus_step_count = protocol_plan.steps.len() as u32 - questionnaire_step_count;
    Ok(ProtocolPreflightReceipt {
        schema: "affect-research-native-protocol-preflight",
        version: 1,
        participant_id: protocol_plan.participant_id.clone(),
        settings_sha256: settings.canonical_sha256()?,
        assignment_settings_sha256,
        assignment_plan_sha256: assignment_plan.plan_hash_sha256,
        protocol_plan_sha256: protocol_plan.protocol_plan_hash_sha256,
        definition_hashes,
        protocol_step_count: protocol_plan.steps.len() as u32,
        questionnaire_step_count,
        stimulus_step_count,
        native_start_ready: false,
        blocking_reason_code: "native-questionnaire-runtime-v3-not-integrated",
    })
}

pub fn native_protocol_runtime_unavailable() -> CommandError {
    CommandError::new(
        "native_questionnaire_runtime_unavailable",
        "The questionnaire-aware native protocol passed strict validation, but this build cannot yet atomically checkpoint and finalize ResearchRunManifestV3. No run was started.",
    )
}

fn parse_csv_records(source: &str) -> ResearchResult<Vec<Vec<String>>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut characters = source.char_indices().peekable();
    let mut in_quotes = false;
    let mut after_quote = false;

    let finish_field = |record: &mut Vec<String>, field: &mut String| -> ResearchResult<()> {
        if record.len() == 14 {
            return Err(contract_error(
                "Questionnaire CSV rows may not exceed 14 columns.",
            ));
        }
        record.push(std::mem::take(field));
        Ok(())
    };

    while let Some((_, character)) = characters.next() {
        if in_quotes {
            if character == '"' {
                if characters.peek().is_some_and(|(_, next)| *next == '"') {
                    characters.next();
                    field.push('"');
                } else {
                    in_quotes = false;
                    after_quote = true;
                }
            } else if character == '\r' {
                if characters.next().is_none_or(|(_, next)| next != '\n') {
                    return Err(contract_error(
                        "Questionnaire CSV contains a bare carriage return.",
                    ));
                }
                field.push_str("\r\n");
            } else {
                field.push(character);
            }
        } else if after_quote {
            match character {
                ',' => {
                    finish_field(&mut record, &mut field)?;
                    after_quote = false;
                }
                '\r' => {
                    if characters.next().is_none_or(|(_, next)| next != '\n') {
                        return Err(contract_error(
                            "Questionnaire CSV contains a bare carriage return.",
                        ));
                    }
                    finish_field(&mut record, &mut field)?;
                    records.push(std::mem::take(&mut record));
                    after_quote = false;
                }
                '\n' => {
                    finish_field(&mut record, &mut field)?;
                    records.push(std::mem::take(&mut record));
                    after_quote = false;
                }
                _ => {
                    return Err(contract_error(
                        "Questionnaire CSV contains characters after a closing quote.",
                    ));
                }
            }
        } else {
            match character {
                '"' if field.is_empty() => in_quotes = true,
                '"' => {
                    return Err(contract_error(
                        "Questionnaire CSV quotes must begin at the start of a field.",
                    ));
                }
                ',' => finish_field(&mut record, &mut field)?,
                '\r' => {
                    if characters.next().is_none_or(|(_, next)| next != '\n') {
                        return Err(contract_error(
                            "Questionnaire CSV contains a bare carriage return.",
                        ));
                    }
                    finish_field(&mut record, &mut field)?;
                    records.push(std::mem::take(&mut record));
                }
                '\n' => {
                    finish_field(&mut record, &mut field)?;
                    records.push(std::mem::take(&mut record));
                }
                _ => field.push(character),
            }
        }
        if field.encode_utf16().count() > MAX_FIELD_UTF16 {
            return Err(contract_error(
                "Questionnaire CSV fields may not exceed 16384 characters.",
            ));
        }
        if records.len() > MAX_CSV_ROWS + 1 {
            return Err(contract_error(
                "Questionnaire CSV exceeds the 25000-row bound.",
            ));
        }
    }
    if in_quotes {
        return Err(contract_error(
            "Questionnaire CSV contains an unterminated quoted field.",
        ));
    }
    if after_quote || !field.is_empty() || !record.is_empty() {
        finish_field(&mut record, &mut field)?;
        records.push(record);
    }
    Ok(records)
}

fn parse_score(value: &str) -> ResearchResult<Option<f64>> {
    if value.is_empty() {
        return Ok(None);
    }
    if !is_decimal(value) {
        return Err(contract_error(
            "Questionnaire CSV score_value must be a finite decimal number or blank.",
        ));
    }
    let parsed = value.parse::<f64>().map_err(|_| {
        contract_error("Questionnaire CSV score_value must be a finite decimal number or blank.")
    })?;
    validate_finite_range(
        parsed,
        -MAX_SCORE_ABS,
        MAX_SCORE_ABS,
        "Questionnaire CSV score_value",
    )?;
    Ok(Some(if parsed == 0.0 { 0.0 } else { parsed }))
}

fn is_decimal(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut index = usize::from(bytes[0] == b'-');
    if index == bytes.len() {
        return false;
    }
    if bytes[index] == b'0' {
        index += 1;
        if bytes.get(index).is_some_and(u8::is_ascii_digit) {
            return false;
        }
    } else if bytes[index].is_ascii_digit() && bytes[index] != b'0' {
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
    } else {
        return false;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+' | b'-')) {
            index += 1;
        }
        let start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }
    index == bytes.len()
}

fn write_csv_row(output: &mut Vec<u8>, values: &[String]) -> ResearchResult<()> {
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            output.push(b',');
        }
        let needs_quotes = value.contains([',', '"', '\r', '\n']);
        if needs_quotes {
            output.push(b'"');
            for byte in value.as_bytes() {
                output.push(*byte);
                if *byte == b'"' {
                    output.push(b'"');
                }
            }
            output.push(b'"');
        } else {
            output.extend_from_slice(value.as_bytes());
        }
    }
    output.extend_from_slice(b"\r\n");
    if output.len() > 64 * 1024 * 1024 {
        return Err(contract_error(
            "Canonical questionnaire CSV output exceeds its safety bound.",
        ));
    }
    Ok(())
}

fn canonical_number(value: f64) -> ResearchResult<String> {
    String::from_utf8(canonical_json(&value, &[])?).map_err(CommandError::io)
}

fn validate_response_record_identity(response: &QuestionnaireResponseV1) -> ResearchResult<()> {
    validate_common_record_identity(
        response.sequence,
        &response.run_id,
        &response.participant_id,
        response.attempt_number,
        &response.settings_sha256,
        &response.assignment_plan_sha256,
        &response.wall_time_utc,
        &response.monotonic_time_ns,
        "QuestionnaireResponseV1",
    )?;
    validate_sha256(
        &response.protocol_plan_sha256,
        "QuestionnaireResponseV1.protocolPlanSha256",
    )?;
    if response.protocol_step_position == 0
        || response.protocol_step_position as usize > MAX_PROTOCOL_STEPS
    {
        return Err(contract_error(
            "QuestionnaireResponseV1 protocol step position is invalid.",
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_common_record_identity(
    sequence: u64,
    run_id: &str,
    participant_id: &str,
    attempt_number: u32,
    settings_sha256: &str,
    assignment_plan_sha256: &str,
    wall_time_utc: &str,
    monotonic_time_ns: &str,
    label: &str,
) -> ResearchResult<()> {
    if sequence == 0
        || sequence > MAX_SAFE_INTEGER
        || attempt_number == 0
        || attempt_number > 999_999
    {
        return Err(contract_error(format!(
            "{label} sequence or attempt number is invalid."
        )));
    }
    validate_uuid(run_id, &format!("{label}.runId"))?;
    validate_participant_id(participant_id)?;
    validate_sha256(settings_sha256, &format!("{label}.settingsSha256"))?;
    validate_sha256(
        assignment_plan_sha256,
        &format!("{label}.assignmentPlanSha256"),
    )?;
    parse_canonical_utc_timestamp(wall_time_utc, &format!("{label}.wallTimeUtc"))?;
    validate_monotonic_ns(monotonic_time_ns, &format!("{label}.monotonicTimeNs"))
}

fn validate_uuid(value: &str, label: &str) -> ResearchResult<()> {
    let parsed = Uuid::parse_str(value)
        .map_err(|_| contract_error(format!("{label} must be a canonical UUID.")))?;
    if parsed.hyphenated().to_string() != value
        || parsed.get_version_num() == 0
        || parsed.get_version_num() > 8
        || !matches!(value.as_bytes().get(19), Some(b'8' | b'9' | b'a' | b'b'))
    {
        return Err(contract_error(format!(
            "{label} must be a canonical RFC 4122 UUID."
        )));
    }
    Ok(())
}

fn validate_monotonic_ns(value: &str, label: &str) -> ResearchResult<()> {
    if value.is_empty()
        || value.len() > 30
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || value.len() > 1 && value.starts_with('0')
    {
        return Err(contract_error(format!(
            "{label} must be an unsigned decimal nanosecond string."
        )));
    }
    Ok(())
}

fn parse_canonical_utc_timestamp(value: &str, label: &str) -> ResearchResult<OffsetDateTime> {
    let bytes = value.as_bytes();
    let canonical_shape = bytes.len() == 24
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && bytes[16] == b':'
        && bytes[19] == b'.'
        && bytes[23] == b'Z'
        && bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || byte.is_ascii_digit()
        });
    if !canonical_shape {
        return Err(contract_error(format!(
            "{label} must be a canonical UTC ISO-8601 timestamp."
        )));
    }
    OffsetDateTime::parse(value, &Rfc3339).map_err(|_| {
        contract_error(format!(
            "{label} must be a canonical UTC ISO-8601 timestamp."
        ))
    })
}

fn require_identifier(value: &str, label: &str) -> ResearchResult<()> {
    require_canonical_text(value, 1, 128, label)?;
    let mut characters = value.chars();
    let first = characters
        .next()
        .ok_or_else(|| contract_error(format!("{label} is empty.")))?;
    if (!first.is_ascii_lowercase() && !first.is_ascii_digit())
        || !characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '-')
        })
    {
        return Err(contract_error(format!(
            "{label} must be a canonical lowercase identifier."
        )));
    }
    Ok(())
}

fn require_semantic_code(value: &str, label: &str) -> ResearchResult<()> {
    require_canonical_text(value, 1, 128, label)?;
    let mut characters = value.chars();
    let first = characters
        .next()
        .ok_or_else(|| contract_error(format!("{label} is empty.")))?;
    if (!first.is_ascii_lowercase() && !first.is_ascii_digit())
        || !characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '_' | '.' | ':' | '-')
        })
    {
        return Err(contract_error(format!(
            "{label} must be a bounded semantic code."
        )));
    }
    Ok(())
}

fn require_language(value: &str, label: &str) -> ResearchResult<()> {
    require_canonical_text(value, 1, 80, label)?;
    let mut parts = value.split('-');
    let first = parts.next().unwrap_or_default();
    if !(2..=8).contains(&first.len()) || !first.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return Err(contract_error(format!(
            "{label} must be a bounded language tag."
        )));
    }
    for part in parts {
        if part.is_empty()
            || part.len() > 8
            || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(contract_error(format!(
                "{label} must be a bounded language tag."
            )));
        }
    }
    Ok(())
}

fn require_logical_name(value: &str, label: &str) -> ResearchResult<()> {
    require_canonical_text(value, 1, 255, label)?;
    if matches!(value, "." | "..") || value.contains(['\\', '/', ':']) {
        return Err(contract_error(format!(
            "{label} must be a path-free logical filename."
        )));
    }
    Ok(())
}

fn require_safe_basename(value: &str, label: &str) -> ResearchResult<()> {
    require_canonical_text(value, 1, 240, label)?;
    if matches!(value, "." | "..")
        || value.chars().any(|character| {
            is_forbidden_text(character)
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        return Err(contract_error(format!("{label} must be a safe basename.")));
    }
    Ok(())
}

fn require_canonical_text(
    value: &str,
    minimum: usize,
    maximum: usize,
    label: &str,
) -> ResearchResult<()> {
    let trimmed = value.trim_matches(is_ecmascript_trim_character);
    let normalized: String = trimmed.nfc().collect();
    let length = normalized.encode_utf16().count();
    if normalized != value
        || length < minimum
        || length > maximum
        || value.chars().any(is_forbidden_text)
    {
        return Err(contract_error(format!(
            "{label} must contain {minimum}–{maximum} canonical safe characters."
        )));
    }
    Ok(())
}

fn is_forbidden_text(character: char) -> bool {
    character.is_control()
        || matches!(
            character as u32,
            0x00ad
                | 0x0600..=0x0605
                | 0x061c
                | 0x06dd
                | 0x070f
                | 0x0890..=0x0891
                | 0x08e2
                | 0x180e
                | 0x200b..=0x200f
                | 0x202a..=0x202e
                | 0x2060..=0x2064
                | 0x2066..=0x206f
                | 0xfeff
                | 0xfff9..=0xfffb
                | 0x110bd
                | 0x110cd
                | 0x13430..=0x1343f
                | 0x1bca0..=0x1bca3
                | 0x1d173..=0x1d17a
                | 0xe0001
                | 0xe0020..=0xe007f
        )
}

fn is_ecmascript_trim_character(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'
            | '\u{000a}'
            | '\u{000b}'
            | '\u{000c}'
            | '\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    ) || ('\u{2000}'..='\u{200a}').contains(&character)
}

fn validate_finite_range(
    value: f64,
    minimum: f64,
    maximum: f64,
    label: &str,
) -> ResearchResult<()> {
    if !value.is_finite() || !(minimum..=maximum).contains(&value) {
        return Err(contract_error(format!(
            "{label} must be finite and within {minimum}–{maximum}."
        )));
    }
    Ok(())
}

fn validate_participant_code(value: &str) -> ResearchResult<()> {
    require_canonical_text(value, 2, 32, "participantCode")?;
    if value.graphemes(true).count() != 2
        || value != value.to_uppercase()
        || value.chars().any(|character| {
            is_forbidden_text(character)
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '_'
                )
        })
    {
        return Err(contract_error(
            "participantCode must contain exactly two uppercase filename-safe graphemes.",
        ));
    }
    Ok(())
}

fn expected_session_stem(
    manifest: &ResearchRunManifestV3,
    started_at: &str,
) -> ResearchResult<String> {
    let parsed = parse_canonical_utc_timestamp(started_at, "startedAt")?;
    let timestamp = parsed
        .format(&time::macros::format_description!(
            "[year][month][day]T[hour][minute][second][subsecond digits:3]Z"
        ))
        .map_err(CommandError::io)?;
    Ok(format!(
        "{}_{}_A{}_G{:?}_H{:?}_{}_R{:02}",
        manifest.participant_id,
        manifest.participant_code,
        manifest.age,
        manifest.gender,
        manifest.handedness,
        timestamp,
        manifest.attempt_number
    ))
}

fn contract_error(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::research_contracts::resolve_assignment_plan_v1;
    use crate::research_external_protocol::{
        ExperimentBlockV1, ExperimentScheduleBlockV1, ExperimentScheduleV1, ExperimentStimulusV1,
        ExperimentVideoV1, EXPERIMENT_DEFINITION_SCHEMA,
    };
    use serde_json::Value;

    fn base_settings() -> ResearchSettingsV1 {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/research-contract-parity-v1.json"
        ))
        .unwrap();
        serde_json::from_value(fixture["valid"]["settings"]["value"].clone()).unwrap()
    }

    fn questionnaire_definition() -> QuestionnaireDefinitionV1 {
        import_questionnaire_csv(
            include_bytes!("../../site/questionnaires/questionnaire-template.csv"),
            QuestionnaireSourceKindV1::ResearcherCsv,
            "questionnaire-template.csv",
            None,
        )
        .unwrap()
        .definition
    }

    pub(crate) fn external_settings() -> ResearchSettingsV3 {
        let v1 = base_settings().normalize_and_validate().unwrap();
        let stimulus = v1.stimuli.items[0].clone();
        let StimulusSourceV1::WorkspaceFile { relative_path, .. } = &stimulus.source else {
            panic!("the shared settings fixture must use a workspace stimulus")
        };
        let definition = ExperimentDefinitionV1 {
            schema: EXPERIMENT_DEFINITION_SCHEMA.to_owned(),
            version: 1,
            experiment_id: v1.experiment.id.clone(),
            title: v1.experiment.title.clone(),
            stimuli: vec![ExperimentStimulusV1 {
                stimulus_id: stimulus.stimulus_id.clone(),
                title: stimulus.title.clone(),
                relative_path: relative_path.clone(),
            }],
            blocks: vec![ExperimentBlockV1 {
                block_id: "main".to_owned(),
                label: "Main block".to_owned(),
            }],
            schedules: vec![ExperimentScheduleV1 {
                participant_id: "P001".to_owned(),
                blocks: vec![ExperimentScheduleBlockV1 {
                    block_id: "main".to_owned(),
                    videos: vec![ExperimentVideoV1 {
                        stimulus_id: stimulus.stimulus_id.clone(),
                        isi_after_ms: 3_000,
                    }],
                }],
            }],
        }
        .normalize_and_validate()
        .unwrap();
        let definition_sha256 = definition.canonical_sha256().unwrap();
        let questionnaire = questionnaire_definition();
        ResearchSettingsV3 {
            schema: RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 3,
            experiment: ExperimentSettingsV3 {
                id: v1.experiment.id,
                title: v1.experiment.title,
                participant_count: v1.experiment.participant_count,
                sampling_frequency_hz: v1.experiment.sampling_frequency_hz,
            },
            stimuli: StimuliSettingsV3 {
                items: vec![stimulus],
            },
            input: v1.input,
            visual: v1.visual,
            advanced: v1.advanced,
            output: v1.output,
            questionnaires: QuestionnaireSettingsV3 {
                algorithm_version: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION.to_owned(),
                definitions: vec![questionnaire.clone()],
                modules: vec![QuestionnaireModuleV2 {
                    schema: QUESTIONNAIRE_MODULE_SCHEMA.to_owned(),
                    version: 2,
                    module_id: "pre-main".to_owned(),
                    questionnaire_id: questionnaire.questionnaire_id,
                    definition_sha256: questionnaire.definition_sha256,
                    placement: QuestionnairePlacementV2::BeforeBlock {
                        block_id: "main".to_owned(),
                    },
                }],
            },
            external_protocol: ExternalProtocolSettingsV1 {
                algorithm_version: EXTERNAL_ORDER_ALGORITHM_VERSION.to_owned(),
                source_byte_sha256: "a".repeat(64),
                definition_sha256,
                definition,
            },
        }
        .normalize_and_validate()
        .unwrap()
    }

    fn protocol_fixture() -> (
        ResearchSettingsV2,
        ResolvedAssignmentPlanV1,
        ResolvedProtocolPlanV1,
    ) {
        let v1 = base_settings().normalize_and_validate().unwrap();
        let assignment = resolve_assignment_plan_v1(&v1).unwrap();
        let definition = questionnaire_definition();
        let before = QuestionnaireModuleV1 {
            schema: QUESTIONNAIRE_MODULE_SCHEMA.to_owned(),
            version: 1,
            module_id: "pre-session".to_owned(),
            questionnaire_id: definition.questionnaire_id.clone(),
            definition_sha256: definition.definition_sha256.clone(),
            placement: QuestionnairePlacementV1 {
                kind: QuestionnairePlacementKindV1::BeforeSession,
                pool_id: None,
            },
        };
        let after = QuestionnaireModuleV1 {
            schema: QUESTIONNAIRE_MODULE_SCHEMA.to_owned(),
            version: 1,
            module_id: "post-session".to_owned(),
            questionnaire_id: definition.questionnaire_id.clone(),
            definition_sha256: definition.definition_sha256.clone(),
            placement: QuestionnairePlacementV1 {
                kind: QuestionnairePlacementKindV1::AfterSession,
                pool_id: None,
            },
        };
        let before_block = QuestionnaireModuleV1 {
            schema: QUESTIONNAIRE_MODULE_SCHEMA.to_owned(),
            version: 1,
            module_id: "pre-calm-block".to_owned(),
            questionnaire_id: definition.questionnaire_id.clone(),
            definition_sha256: definition.definition_sha256.clone(),
            placement: QuestionnairePlacementV1 {
                kind: QuestionnairePlacementKindV1::BeforeBlock,
                pool_id: Some("pool-calm".to_owned()),
            },
        };
        let after_block = QuestionnaireModuleV1 {
            schema: QUESTIONNAIRE_MODULE_SCHEMA.to_owned(),
            version: 1,
            module_id: "post-calm-block".to_owned(),
            questionnaire_id: definition.questionnaire_id.clone(),
            definition_sha256: definition.definition_sha256.clone(),
            placement: QuestionnairePlacementV1 {
                kind: QuestionnairePlacementKindV1::AfterBlock,
                pool_id: Some("pool-calm".to_owned()),
            },
        };
        let settings = ResearchSettingsV2 {
            schema: RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 2,
            experiment: v1.experiment,
            stimuli: v1.stimuli,
            input: v1.input,
            visual: v1.visual,
            advanced: v1.advanced,
            output: v1.output,
            questionnaires: QuestionnaireSettingsV2 {
                algorithm_version: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION.to_owned(),
                definitions: vec![definition],
                modules: vec![before, before_block, after_block, after],
            },
        }
        .normalize_and_validate()
        .unwrap();
        let protocol = resolve_protocol_plan_v1(&settings, &assignment, "P001").unwrap();
        (settings, assignment, protocol)
    }

    #[test]
    fn csv_import_and_v2_contract_are_closed_and_self_hashed() {
        let definition = questionnaire_definition();
        assert_eq!(definition.items.len(), 2);
        assert_eq!(definition.items[0].options.len(), 3);
        assert_eq!(
            canonical_sha256(&definition, &["definitionSha256"]).unwrap(),
            definition.definition_sha256
        );
        assert!(!definition.canonical_csv_bytes().unwrap().is_empty());

        let (settings, _, _) = protocol_fixture();
        let mut value = serde_json::to_value(&settings).unwrap();
        value["questionnaires"]["unexpected"] = Value::Bool(true);
        assert!(serde_json::from_value::<ResearchSettingsV2>(value).is_err());

        let mut missing_null = serde_json::to_value(&definition).unwrap();
        missing_null["source"]
            .as_object_mut()
            .unwrap()
            .remove("sourceDocumentSha256");
        assert!(serde_json::from_value::<QuestionnaireDefinitionV1>(missing_null).is_err());
    }

    #[test]
    fn v3_settings_are_closed_and_bind_external_order() {
        let settings = external_settings();
        assert_eq!(settings.version, 3);
        assert_eq!(settings.external_protocol.definition.schedules.len(), 1);
        assert_eq!(
            settings.external_protocol.definition_sha256,
            settings
                .external_protocol
                .definition
                .canonical_sha256()
                .unwrap()
        );
        assert_eq!(
            settings.canonical_sha256().unwrap(),
            ResearchSettingsDocument::V3(settings.clone())
                .canonical_sha256()
                .unwrap()
        );
        assert!(serde_json::from_value::<ResearchSettingsV2>(
            serde_json::to_value(&settings).unwrap()
        )
        .is_err());

        let mut unknown = serde_json::to_value(&settings).unwrap();
        unknown["externalProtocol"]["unexpected"] = Value::Bool(true);
        assert!(serde_json::from_value::<ResearchSettingsDocument>(unknown).is_err());

        let mut missing_null = serde_json::to_value(&settings).unwrap();
        missing_null["questionnaires"]["modules"][0]["placement"]
            .as_object_mut()
            .unwrap()
            .remove("blockId");
        assert!(serde_json::from_value::<ResearchSettingsDocument>(missing_null).is_err());

        let mut hash_drift = settings.clone();
        hash_drift.external_protocol.definition.title = "Changed title".to_owned();
        assert!(hash_drift.normalize_and_validate().is_err());

        let mut source_drift = settings;
        let StimulusSourceV1::WorkspaceFile { relative_path, .. } =
            &mut source_drift.stimuli.items[0].source
        else {
            unreachable!()
        };
        *relative_path = "stimuli/other.mp4".to_owned();
        assert!(source_drift.normalize_and_validate().is_err());
    }

    #[test]
    fn v3_after_stimulus_placement_matches_the_strict_browser_union() {
        let mut settings = external_settings();
        settings.questionnaires.modules[0].placement = QuestionnairePlacementV2::AfterStimulus {
            block_id: None,
            stimulus_id: settings.stimuli.items[0].stimulus_id.clone(),
            relative_to_isi: QuestionnaireRelativeToIsiV1::Before,
        };
        let settings = settings.normalize_and_validate().unwrap();
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(
            value["questionnaires"]["modules"][0]["placement"],
            serde_json::json!({
                "kind": "afterStimulus",
                "blockId": null,
                "stimulusId": settings.stimuli.items[0].stimulus_id,
                "relativeToIsi": "before"
            })
        );

        let mut missing_null = value.clone();
        missing_null["questionnaires"]["modules"][0]["placement"]
            .as_object_mut()
            .unwrap()
            .remove("blockId");
        assert!(serde_json::from_value::<ResearchSettingsV3>(missing_null).is_err());

        let mut unexpected_stimulus_field = value.clone();
        unexpected_stimulus_field["questionnaires"]["modules"][0]["placement"] = serde_json::json!({
            "kind": "beforeBlock",
            "blockId": "main",
            "stimulusId": settings.stimuli.items[0].stimulus_id
        });
        assert!(serde_json::from_value::<ResearchSettingsV3>(unexpected_stimulus_field).is_err());

        let mut unknown_stimulus = settings;
        unknown_stimulus.questionnaires.modules[0].placement =
            QuestionnairePlacementV2::AfterStimulus {
                block_id: None,
                stimulus_id: "unknown-stimulus".to_owned(),
                relative_to_isi: QuestionnaireRelativeToIsiV1::After,
            };
        assert!(unknown_stimulus.normalize_and_validate().is_err());
    }

    #[test]
    fn bundled_maia_import_preserves_items_order_and_reverse_scores() {
        let receipt = import_questionnaire_csv(
            include_bytes!("../../site/questionnaires/maia-2-de.csv"),
            QuestionnaireSourceKindV1::Bundled,
            "maia-2-de.csv",
            Some("7402c80c6da71d4a11543676acdf0a7640cdb842d55afc10dde6ad3d4978fdbe".to_owned()),
        )
        .unwrap();
        assert_eq!(
            receipt.source_sha256,
            "2cf89fe2cb88ca79ddf7c3f6d06394563bcce055f6aade280fb7b38272d85fba"
        );
        assert_eq!(receipt.definition.questionnaire_id, "maia-2-de");
        assert_eq!(receipt.definition.items.len(), 37);
        for (index, item) in receipt.definition.items.iter().enumerate() {
            assert_eq!(item.item_id, format!("f{:02}", index + 1));
            assert_eq!(item.order, (index + 1) as u32);
        }
        assert_eq!(
            receipt.definition.items[4]
                .options
                .iter()
                .map(|option| option.score_value)
                .collect::<Vec<_>>(),
            vec![
                Some(5.0),
                Some(4.0),
                Some(3.0),
                Some(2.0),
                Some(1.0),
                Some(0.0)
            ]
        );
    }

    #[test]
    fn protocol_resolution_is_deterministic_and_exactly_bound() {
        let (settings, assignment, protocol) = protocol_fixture();
        let repeated = resolve_protocol_plan_v1(&settings, &assignment, "P001").unwrap();
        assert_eq!(protocol, repeated);
        assert!(matches!(
            protocol.steps.first(),
            Some(ProtocolStepV1::Questionnaire {
                placement: QuestionnairePlacementKindV1::BeforeSession,
                ..
            })
        ));
        assert!(matches!(
            protocol.steps.get(1),
            Some(ProtocolStepV1::Questionnaire {
                placement: QuestionnairePlacementKindV1::BeforeBlock,
                pool_id: Some(pool_id),
                ..
            }) if pool_id == "pool-calm"
        ));
        assert!(matches!(
            protocol.steps.get(3),
            Some(ProtocolStepV1::Questionnaire {
                placement: QuestionnairePlacementKindV1::AfterBlock,
                pool_id: Some(pool_id),
                ..
            }) if pool_id == "pool-calm"
        ));
        assert!(matches!(
            protocol.steps.last(),
            Some(ProtocolStepV1::Questionnaire {
                placement: QuestionnairePlacementKindV1::AfterSession,
                ..
            })
        ));
        protocol.validate_bindings(&settings, &assignment).unwrap();

        let receipt =
            protocol_preflight(settings.clone(), assignment.clone(), protocol.clone()).unwrap();
        assert_eq!(receipt.questionnaire_step_count, 4);
        assert_eq!(receipt.stimulus_step_count, 1);
        assert!(!receipt.native_start_ready);
        assert_eq!(
            receipt.blocking_reason_code,
            "native-questionnaire-runtime-v3-not-integrated"
        );

        let mut drifted = protocol;
        drifted.participant_id = "P002".to_owned();
        assert!(drifted.validate_bindings(&settings, &assignment).is_err());
    }

    #[test]
    fn response_rows_are_derived_from_the_frozen_definition() {
        let (settings, _, protocol) = protocol_fixture();
        let responses = derive_questionnaire_responses_v1(
            &settings,
            &protocol,
            1,
            &[QuestionnaireAnswerInputV1 {
                item_id: "item-01".to_owned(),
                option_id: "never".to_owned(),
                response_latency_ms: 125.0,
            }],
            QuestionnaireResponseStatusV1::Submitted,
            1,
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "P001",
            1,
            "2026-09-08T12:00:00.000Z",
            "1",
        )
        .unwrap();
        assert_eq!(responses.len(), 1);
        assert_eq!(responses[0].response_label, "Never");
        responses[0]
            .validate_bindings(&settings, &protocol)
            .unwrap();

        let mut spoofed = responses[0].clone();
        spoofed.response_label = "Injected".to_owned();
        assert!(spoofed.validate_bindings(&settings, &protocol).is_err());

        let mut unknown = serde_json::to_value(&responses[0]).unwrap();
        unknown["rawParticipantName"] = Value::String("must-not-pass".to_owned());
        assert!(serde_json::from_value::<QuestionnaireResponseV1>(unknown).is_err());
    }

    #[test]
    fn event_recovery_and_manifest_v3_validate_and_reject_tampering() {
        use crate::research_contracts::{
            CompletionStatusV1, GenderCodeV1, HandednessCodeV1, StimulusSourceKindV1,
            StimulusSourceV1,
        };

        let (settings, assignment, protocol) = protocol_fixture();
        let definition = &settings.questionnaires.definitions[0];
        let settings_sha256 = settings.canonical_sha256().unwrap();
        let run_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let started_at = "2026-09-08T12:00:00.000Z";
        let event = ResearchEventV2 {
            schema: RESEARCH_EVENT_SCHEMA.to_owned(),
            version: 2,
            sequence: 1,
            run_id: run_id.to_owned(),
            participant_id: "P001".to_owned(),
            attempt_number: 1,
            settings_sha256: settings_sha256.clone(),
            assignment_plan_sha256: assignment.plan_hash_sha256.clone(),
            protocol_plan_sha256: protocol.protocol_plan_hash_sha256.clone(),
            wall_time_utc: started_at.to_owned(),
            monotonic_time_ns: "1".to_owned(),
            event_type: ResearchEventTypeV2::QuestionnaireStarted,
            stimulus_identity: None,
            stimulus_position: None,
            protocol_step_position: Some(1),
            module_id: Some("pre-session".to_owned()),
            questionnaire_id: Some(definition.questionnaire_id.clone()),
            definition_sha256: Some(definition.definition_sha256.clone()),
            media_time_ms: None,
            missed_slot_count: None,
            detail_code: None,
        };
        event.validate_protocol_binding(&protocol).unwrap();
        let mut tampered_event = event.clone();
        tampered_event.module_id = Some("post-session".to_owned());
        assert!(tampered_event.validate_protocol_binding(&protocol).is_err());
        let mut unknown_event = serde_json::to_value(&event).unwrap();
        unknown_event["participantName"] = Value::String("must-not-pass".to_owned());
        assert!(serde_json::from_value::<ResearchEventV2>(unknown_event).is_err());

        let draft_responses = derive_questionnaire_responses_v1(
            &settings,
            &protocol,
            1,
            &[QuestionnaireAnswerInputV1 {
                item_id: "item-01".to_owned(),
                option_id: "never".to_owned(),
                response_latency_ms: 125.0,
            }],
            QuestionnaireResponseStatusV1::Draft,
            1,
            run_id,
            "P001",
            1,
            started_at,
            "1",
        )
        .unwrap();
        let definitions = vec![QuestionnaireDefinitionReceiptV1 {
            questionnaire_id: definition.questionnaire_id.clone(),
            definition_sha256: definition.definition_sha256.clone(),
        }];
        let recovery = RecoveryJournalV2 {
            schema: RESEARCH_RECOVERY_JOURNAL_SCHEMA.to_owned(),
            version: 2,
            recovery_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".to_owned(),
            run_id: run_id.to_owned(),
            experiment_id: settings.experiment.id.clone(),
            participant_id: "P001".to_owned(),
            participant_code: "EF".to_owned(),
            age: 27,
            gender: GenderCodeV1::W,
            handedness: HandednessCodeV1::R,
            attempt_number: 1,
            session_stem: "P001_EF_A27_GW_HR_20260908T120000000Z_R01".to_owned(),
            settings_sha256: settings_sha256.clone(),
            assignment_plan_sha256: assignment.plan_hash_sha256.clone(),
            protocol_plan_sha256: protocol.protocol_plan_hash_sha256.clone(),
            definition_hashes: definitions.clone(),
            started_at: started_at.to_owned(),
            partial_sample_count: 0,
            partial_event_count: 1,
            partial_questionnaire_response_count: 1,
            safe_protocol_step_position: 0,
            active_protocol_step_position: Some(1),
            active_questionnaire_draft: Some(QuestionnaireDraftV1 {
                protocol_step_position: 1,
                module_id: "pre-session".to_owned(),
                questionnaire_id: definition.questionnaire_id.clone(),
                definition_sha256: definition.definition_sha256.clone(),
                responses: draft_responses,
            }),
            last_monotonic_time_ns: "1".to_owned(),
            gap_event_count: 0,
            missed_slot_count: 0,
            recovery: RecoverySummaryV1 {
                resumed: false,
                source_run_id: None,
                restarted_stimulus_ids: Vec::new(),
            },
        };
        recovery
            .validate(&settings, &assignment, &protocol)
            .unwrap();
        let mut tampered_recovery = recovery.clone();
        tampered_recovery
            .active_questionnaire_draft
            .as_mut()
            .unwrap()
            .module_id = "post-session".to_owned();
        assert!(tampered_recovery
            .validate(&settings, &assignment, &protocol)
            .is_err());
        let mut unknown_recovery = serde_json::to_value(&recovery).unwrap();
        unknown_recovery["rawFirstName"] = Value::String("must-not-pass".to_owned());
        assert!(serde_json::from_value::<RecoveryJournalV2>(unknown_recovery).is_err());

        let stimulus = &settings.stimuli.items[0];
        let StimulusSourceV1::WorkspaceFile {
            sha256,
            byte_length,
            duration_ms,
            ..
        } = &stimulus.source
        else {
            panic!("fixture must use a workspace file");
        };
        let stimulus_identity = SampleStimulusIdentityV1 {
            kind: StimulusSourceKindV1::WorkspaceFile,
            stimulus_id: stimulus.stimulus_id.clone(),
            sha256: Some(sha256.clone()),
            byte_length: Some(*byte_length),
            duration_ms: *duration_ms,
            url: None,
            video_id: None,
        };
        let questionnaire_modules = protocol
            .steps
            .iter()
            .filter_map(|step| match step {
                ProtocolStepV1::Questionnaire {
                    protocol_position,
                    module_id,
                    questionnaire_id,
                    definition_sha256,
                    ..
                } => Some(QuestionnaireModuleReceiptV1 {
                    protocol_step_position: *protocol_position,
                    module_id: module_id.clone(),
                    questionnaire_id: questionnaire_id.clone(),
                    definition_sha256: definition_sha256.clone(),
                    status: if *protocol_position == 1 {
                        QuestionnaireModuleStatusV1::Draft
                    } else {
                        QuestionnaireModuleStatusV1::NotReached
                    },
                    response_count: u64::from(*protocol_position == 1),
                }),
                ProtocolStepV1::Stimulus { .. } => None,
            })
            .collect();
        let output = |kind, file_name: &str, row_count| RunOutputV3 {
            kind,
            file_name: file_name.to_owned(),
            sha256: "c".repeat(64),
            byte_length: 1,
            row_count,
        };
        let manifest = ResearchRunManifestV3 {
            schema: RESEARCH_RUN_MANIFEST_SCHEMA.to_owned(),
            version: 3,
            run_id: run_id.to_owned(),
            experiment_id: settings.experiment.id.clone(),
            participant_id: "P001".to_owned(),
            participant_code: "EF".to_owned(),
            age: 27,
            gender: GenderCodeV1::W,
            handedness: HandednessCodeV1::R,
            attempt_number: 1,
            session_stem: "P001_EF_A27_GW_HR_20260908T120000000Z_R01".to_owned(),
            completion_status: CompletionStatusV1::Partial,
            playback_mode: RunPlaybackModeV3::UnqualifiedWebview,
            playback_qualification: RunPlaybackQualificationV3::Unqualified,
            settings_sha256,
            assignment_plan_sha256: assignment.plan_hash_sha256.clone(),
            protocol_plan_sha256: protocol.protocol_plan_hash_sha256.clone(),
            stimuli: vec![stimulus_identity],
            protocol: RunProtocolSummaryV3 {
                safe_protocol_step_position: 0,
                protocol_step_count: protocol.steps.len() as u32,
                questionnaire_definitions: definitions,
                questionnaire_modules,
                submitted_response_count: 0,
                draft_response_count: 1,
                submitted_responses_sha256: "d".repeat(64),
                draft_responses_sha256: "e".repeat(64),
            },
            timing: RunTimingV3 {
                sample_rate_hz: 130,
                sample_count: 0,
                event_count: 1,
                gap_event_count: 0,
                missed_slot_count: 0,
                questionnaire_submitted_response_count: 0,
                questionnaire_draft_response_count: 1,
                started_at: started_at.to_owned(),
                finalized_at: "2026-09-08T12:00:01.000Z".to_owned(),
            },
            outputs: vec![
                output(RunOutputKindV3::Settings, "settings.snapshot.json", None),
                output(RunOutputKindV3::ProtocolPlan, "protocol-plan.json", None),
                output(RunOutputKindV3::Events, "events.jsonl", None),
                output(RunOutputKindV3::RatingsCsv, "ratings.csv", Some(0)),
                output(
                    RunOutputKindV3::QuestionnaireCsv,
                    "questionnaire.csv",
                    Some(1),
                ),
                output(RunOutputKindV3::ExperimentSource, "experiment.json", None),
                output(
                    RunOutputKindV3::ExperimentPlan,
                    "experiment-plan.snapshot.json",
                    None,
                ),
            ],
            recovery: RecoverySummaryV1 {
                resumed: false,
                source_run_id: None,
                restarted_stimulus_ids: Vec::new(),
            },
            build: ResearchBuildV1 {
                platform: ResearchPlatformV1::TauriWindows,
                app_version: "0.4.0-alpha.1".to_owned(),
                build_commit: "deadbeef".to_owned(),
            },
        };
        manifest.validate().unwrap();
        manifest.validate_protocol_binding(&protocol).unwrap();

        let mut historical_manifest = manifest.clone();
        historical_manifest.outputs.retain(|output| {
            !matches!(
                output.kind,
                RunOutputKindV3::ExperimentSource | RunOutputKindV3::ExperimentPlan
            )
        });
        historical_manifest.validate().unwrap();

        let mut wrong_external_name = manifest.clone();
        wrong_external_name
            .outputs
            .iter_mut()
            .find(|output| output.kind == RunOutputKindV3::ExperimentSource)
            .unwrap()
            .file_name = "experiment-copy.json".to_owned();
        assert!(wrong_external_name.validate().is_err());

        let mut zero_row_submission = manifest.clone();
        zero_row_submission.protocol.safe_protocol_step_position = 1;
        zero_row_submission.protocol.questionnaire_modules[0].status =
            QuestionnaireModuleStatusV1::Submitted;
        zero_row_submission.protocol.questionnaire_modules[0].response_count = 0;
        zero_row_submission.protocol.submitted_response_count = 0;
        zero_row_submission.protocol.draft_response_count = 0;
        zero_row_submission
            .timing
            .questionnaire_submitted_response_count = 0;
        zero_row_submission
            .timing
            .questionnaire_draft_response_count = 0;
        zero_row_submission.outputs[4].row_count = Some(0);
        zero_row_submission.validate().unwrap();
        zero_row_submission
            .validate_protocol_binding(&protocol)
            .unwrap();

        let mut definition_mismatch = manifest.clone();
        definition_mismatch.protocol.questionnaire_modules[0].questionnaire_id =
            "missing-definition".to_owned();
        assert!(definition_mismatch.validate().is_err());

        let mut submitted_beyond_boundary = manifest.clone();
        submitted_beyond_boundary.protocol.questionnaire_modules[1].status =
            QuestionnaireModuleStatusV1::Submitted;
        assert!(submitted_beyond_boundary.validate().is_err());

        let mut misplaced_draft = manifest.clone();
        misplaced_draft.protocol.questionnaire_modules[2].status =
            QuestionnaireModuleStatusV1::Draft;
        assert!(misplaced_draft.validate().is_err());

        let mut duplicate_output_name = manifest.clone();
        duplicate_output_name.outputs[1].file_name =
            duplicate_output_name.outputs[0].file_name.clone();
        assert!(duplicate_output_name.validate().is_err());

        let mut excessive_attempt = manifest.clone();
        excessive_attempt.attempt_number = MAX_ATTEMPT_NUMBER + 1;
        assert!(excessive_attempt.validate().is_err());

        let mut excessive_missed_slots = manifest.clone();
        excessive_missed_slots.timing.missed_slot_count = MAX_SAFE_INTEGER + 1;
        assert!(excessive_missed_slots.validate().is_err());

        let mut excessive_participant = manifest.clone();
        excessive_participant.participant_id = "P100001".to_owned();
        assert!(excessive_participant.validate().is_err());

        let mut dotted_stimulus = manifest.clone();
        dotted_stimulus.stimuli[0].stimulus_id = "video.1".to_owned();
        assert!(dotted_stimulus.validate().is_err());

        let mut fractional_duration = manifest.clone();
        fractional_duration.stimuli[0].duration_ms = 2_000.5;
        assert!(fractional_duration.validate().is_err());

        let mut canonical_youtube = manifest.clone();
        canonical_youtube.stimuli[0] = SampleStimulusIdentityV1 {
            kind: StimulusSourceKindV1::Youtube,
            stimulus_id: "youtube-1".to_owned(),
            sha256: None,
            byte_length: None,
            duration_ms: 2_000.0,
            url: Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_owned()),
            video_id: Some("dQw4w9WgXcQ".to_owned()),
        };
        canonical_youtube.validate().unwrap();
        canonical_youtube.stimuli[0].url = Some("https://youtu.be/dQw4w9WgXcQ".to_owned());
        assert!(canonical_youtube.validate().is_err());

        let mut reordered_modules = manifest.clone();
        let first_module_id = reordered_modules.protocol.questionnaire_modules[0]
            .module_id
            .clone();
        let second_module_id = reordered_modules.protocol.questionnaire_modules[1]
            .module_id
            .clone();
        reordered_modules.protocol.questionnaire_modules[0].module_id = second_module_id;
        reordered_modules.protocol.questionnaire_modules[1].module_id = first_module_id;
        reordered_modules.validate().unwrap();
        assert!(reordered_modules
            .validate_protocol_binding(&protocol)
            .is_err());

        let mut substituted_stimulus = manifest.clone();
        substituted_stimulus.stimuli[0].stimulus_id = "video-substituted".to_owned();
        substituted_stimulus.validate().unwrap();
        assert!(substituted_stimulus
            .validate_protocol_binding(&protocol)
            .is_err());

        let mut tampered_manifest = manifest.clone();
        tampered_manifest.outputs[4].row_count = Some(2);
        assert!(tampered_manifest.validate().is_err());
        let mut unknown_manifest = serde_json::to_value(&manifest).unwrap();
        unknown_manifest["participantName"] = Value::String("must-not-pass".to_owned());
        assert!(serde_json::from_value::<ResearchRunManifestV3>(unknown_manifest).is_err());
    }

    #[test]
    fn protocol_plan_enforces_shared_participant_and_step_bounds() {
        let (_, _, protocol) = protocol_fixture();

        let mut upper_participant = protocol.clone();
        upper_participant.participant_id = "P100000".to_owned();
        upper_participant.protocol_plan_hash_sha256 =
            canonical_sha256(&upper_participant, &["protocolPlanHashSha256"]).unwrap();
        upper_participant.validate_self().unwrap();

        let mut excessive_participant = protocol.clone();
        excessive_participant.participant_id = "P100001".to_owned();
        assert!(excessive_participant.validate_self().is_err());

        let mut excessive_steps = protocol;
        excessive_steps.steps = vec![excessive_steps.steps[0].clone(); MAX_PROTOCOL_STEPS + 1];
        assert!(excessive_steps.validate_self().is_err());
    }

    #[test]
    fn capability_is_precise_and_fails_closed() {
        let capability = native_protocol_capability();
        assert!(capability.settings_v2_validation_ready);
        assert!(capability.questionnaire_csv_import_ready);
        assert!(capability.protocol_plan_validation_ready);
        assert!(!capability.native_start_resume_ready);
        assert!(!capability.durable_draft_checkpoint_ready);
        assert!(!capability.atomic_submission_ready);
        assert!(!capability.manifest_v3_finalization_ready);
        assert_eq!(
            native_protocol_runtime_unavailable().code,
            "native_questionnaire_runtime_unavailable"
        );
    }
}

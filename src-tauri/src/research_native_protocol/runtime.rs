//! Rust-owned experiment-package protocol runtime.
//!
//! One worker owns protocol transitions, GstPlay lifecycle observations,
//! native input, the no-catch-up scheduler, LSL, persistence, and recovery.
//! The WebView can request user actions and render typed projections; it never
//! authors a stimulus-complete edge or a sample timestamp.

use super::compiler::{compile_package_selection, CompiledPackageSelectionV1};
use super::contracts::{ProtocolStepV2, ResolvedProtocolPlanV2};
use super::input_mailbox::{InputDrain, ProtocolInputMailbox};
use super::records::{
    module_receipts, package_receipt, response_table_sha256, PackageRecoveryJournalV1,
    PendingPackageFinalizationV1, ResearchRunManifestV4, PACKAGE_RECOVERY_JOURNAL_SCHEMA,
};
use super::recovery::{
    list_bound_recoveries, load_bound_recovery, PackageParticipantStateV1, PackageRecoveryListingV1,
};
use super::reducer::{MediaEdge, ProtocolPhase, ProtocolReducer};
use super::responses::derive_questionnaire_responses_v3;
use super::storage::{
    finalize_pending_storage, prepare_attempt, FinalFileReceipt, FinalizePendingStorageRequest,
    NewStorageRequest, PackageRunStorage, ResumeStorageRequest,
};
use crate::research_clock::{
    duration_ms, format_wall_time, monotonic_ns, session_timestamp, wall_time_now,
};
use crate::research_contracts::{
    canonical_json, canonical_sha256, CompletionStatusV1, DirectionV1, GenderCodeV1,
    HandednessCodeV1, InputKindV1, RecoverySummaryV1, ResearchBuildV1, ResearchPlatformV1,
    ResearchSampleV1, SampleStimulusIdentityV1, StimulusSourceV1, RESEARCH_EVENT_SCHEMA,
    RESEARCH_RUN_MANIFEST_SCHEMA, RESEARCH_SAMPLE_SCHEMA,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::parse_canonical_experiment_package_text;
use crate::research_input::{NativeContinuousInput, NativeDigitalInput, ResearchInputService};
use crate::research_lsl::{LslService, LslState};
use crate::research_native_media::{
    NativeMediaCommandFenceV1, NativeMediaService, NativeMediaStateV1, NativeMediaStatusV1,
    NativeMediaViewportPxV1, PlaybackMode, PlaybackQualification,
};
use crate::research_participant::{validate_participant_code, TransientParticipant};
use crate::research_platform::{require_native_acquisition, NATIVE_ACQUISITION_SUPPORTED};
use crate::research_protocol::{
    QuestionnaireAnswerInputV1, QuestionnaireDraftV1, QuestionnaireResponseStatusV1,
    QuestionnaireResponseV1, ResearchEventTypeV2, ResearchEventV2, RunPlaybackModeV3,
    RunPlaybackQualificationV3, RunProtocolSummaryV3, RunTimingV3,
};
use crate::research_timing::DeadlineClock;
use crate::research_workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use time::OffsetDateTime;
use uuid::Uuid;

const BUILD_COMMIT: &str = env!("AFFECT_TRACKER_BUILD_COMMIT");
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const MESSAGE_TIMEOUT: Duration = Duration::from_secs(120);
const ACTIVE_POLL: Duration = Duration::from_millis(4);
const IDLE_POLL: Duration = Duration::from_millis(25);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartPackageRunRequest {
    pub workspace_id: String,
    pub experiment_package_source_text: String,
    pub participant: TransientParticipant,
    pub selected_language_id: String,
    pub language_selection_path: Vec<String>,
    pub rerun_confirmed: bool,
    pub input_test_receipt_id: String,
    pub playback_mode: PlaybackMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumePackageRunRequest {
    pub workspace_id: String,
    pub experiment_package_source_text: String,
    pub recovery_id: String,
    pub input_test_receipt_id: String,
    pub playback_mode: PlaybackMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalizePackageRecoveryRequest {
    pub workspace_id: String,
    pub experiment_package_source_text: String,
    pub recovery_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackagePreflightRequest {
    pub workspace_id: String,
    pub experiment_package_source_text: String,
    pub participant_id: String,
    pub selected_language_id: String,
    pub language_selection_path: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreflightReceiptV1 {
    pub schema: &'static str,
    pub version: u32,
    pub package_source_byte_sha256: String,
    pub package_definition_sha256: String,
    pub participant_id: String,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub assignment_sha256: String,
    pub protocol_plan_sha256: String,
    pub asset_bindings_sha256: String,
    pub asset_binding_count: u32,
    pub protocol_step_count: u32,
    pub stimulus_step_count: u32,
    pub questionnaire_step_count: u32,
    pub native_start_ready: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageStartRunReceipt {
    pub run_id: String,
    pub participant_id: String,
    pub attempt_number: u32,
    pub session_stem: String,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub package_source_byte_sha256: String,
    pub output_receipt_id: String,
    pub resumed: bool,
    pub resume_at_protocol_step_position: Option<u32>,
    pub playback_mode: PlaybackMode,
    pub playback_qualification: PlaybackQualification,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PackageFinishOutcome {
    Completed,
    StopEarly,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageFinalizeReceipt {
    pub run_id: String,
    pub participant_id: String,
    pub attempt_number: u32,
    pub completion_status: CompletionStatusV1,
    pub output_receipt_id: String,
    pub files: Vec<FinalFileReceipt>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PackageRunPhase {
    Questionnaire,
    StimulusReady,
    Playing,
    Paused,
    Interval,
    CompleteReady,
    Finalizing,
    Finished,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageQuestionnaireStatus {
    pub protocol_step_position: u32,
    pub module_id: String,
    pub questionnaire_id: String,
    pub definition_sha256: String,
    pub answers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageQuestionnaireChoiceV1 {
    pub item_id: String,
    pub option_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageStimulusStatus {
    pub protocol_step_position: u32,
    pub stimulus_position: u32,
    pub stimulus_count: u32,
    pub stimulus_id: String,
    pub title: String,
    pub media_time_ms: f64,
    pub duration_ms: f64,
    pub prepared: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageRunStatus {
    pub active: bool,
    pub run_id: Option<String>,
    pub participant_id: Option<String>,
    pub attempt_number: Option<u32>,
    pub phase: PackageRunPhase,
    pub protocol_step_position: Option<u32>,
    pub safe_protocol_step_position: u32,
    pub protocol_step_count: u32,
    pub questionnaire: Option<PackageQuestionnaireStatus>,
    pub stimulus: Option<PackageStimulusStatus>,
    pub interval_duration_ms: Option<u32>,
    pub interval_remaining_ms: Option<f64>,
    pub sample_count: u64,
    pub event_count: u64,
    pub gap_event_count: u64,
    pub missed_slot_count: u64,
    pub coalesced_input_update_count: u64,
    pub submitted_response_count: u64,
    pub draft_response_count: u64,
    pub current_valence: f64,
    pub current_arousal: f64,
    pub input_active: bool,
    pub write_healthy: bool,
    pub lsl_enabled: bool,
    pub failure_code: Option<String>,
}

impl PackageRunStatus {
    fn idle() -> Self {
        Self {
            active: false,
            run_id: None,
            participant_id: None,
            attempt_number: None,
            phase: PackageRunPhase::Finished,
            protocol_step_position: None,
            safe_protocol_step_position: 0,
            protocol_step_count: 0,
            questionnaire: None,
            stimulus: None,
            interval_duration_ms: None,
            interval_remaining_ms: None,
            sample_count: 0,
            event_count: 0,
            gap_event_count: 0,
            missed_slot_count: 0,
            coalesced_input_update_count: 0,
            submitted_response_count: 0,
            draft_response_count: 0,
            current_valence: 0.0,
            current_arousal: 0.0,
            input_active: false,
            write_healthy: true,
            lsl_enabled: false,
            failure_code: None,
        }
    }
}

pub struct PackageProtocolRuntime {
    workspace: Arc<WorkspaceService>,
    native_media: Arc<NativeMediaService>,
    input: Arc<ResearchInputService>,
    native_acquisition_supported: bool,
    active: Mutex<Option<ActivePackageRun>>,
}

struct ActivePackageRun {
    run_id: String,
    sender: SyncSender<WorkerMessage>,
    status: Arc<Mutex<PackageRunStatus>>,
    worker: Option<JoinHandle<()>>,
    input_authority_id: String,
}

enum WorkerMessage {
    PrepareMedia(
        NativeMediaViewportPxV1,
        mpsc::Sender<ResearchResult<NativeMediaStatusV1>>,
    ),
    SetViewport(
        NativeMediaViewportPxV1,
        mpsc::Sender<ResearchResult<NativeMediaStatusV1>>,
    ),
    Play(mpsc::Sender<ResearchResult<NativeMediaStatusV1>>),
    Pause(mpsc::Sender<ResearchResult<NativeMediaStatusV1>>),
    QuestionnaireDraft(
        u32,
        Vec<PackageQuestionnaireChoiceV1>,
        mpsc::Sender<ResearchResult<()>>,
    ),
    QuestionnaireSubmit(
        u32,
        Vec<PackageQuestionnaireChoiceV1>,
        mpsc::Sender<ResearchResult<()>>,
    ),
    Finish(
        PackageFinishOutcome,
        mpsc::Sender<ResearchResult<PackageFinalizeReceipt>>,
    ),
    Interrupt(mpsc::Sender<ResearchResult<()>>),
}

impl PackageProtocolRuntime {
    pub fn with_services(
        workspace: Arc<WorkspaceService>,
        native_media: Arc<NativeMediaService>,
        input: Arc<ResearchInputService>,
    ) -> Self {
        Self {
            workspace,
            native_media,
            input,
            native_acquisition_supported: NATIVE_ACQUISITION_SUPPORTED,
            active: Mutex::new(None),
        }
    }

    pub fn start(&self, request: StartPackageRunRequest) -> ResearchResult<PackageStartRunReceipt> {
        require_native_acquisition(self.native_acquisition_supported)?;
        let mut active = lock(&self.active);
        if active.is_some() {
            return Err(CommandError::run_active());
        }
        if request.playback_mode != PlaybackMode::NativeGstPlay {
            return Err(CommandError::invalid_contract(
                "The Rust-owned package protocol requires native GstPlay playback.",
            ));
        }
        let playback_qualification = self
            .native_media
            .authorize_playback(request.playback_mode)?;
        if playback_qualification != PlaybackQualification::QualifiedNative {
            return Err(CommandError::native_media_unavailable(
                "native-gstplay-qualification-required",
            ));
        }
        let loaded =
            parse_canonical_experiment_package_text(&request.experiment_package_source_text)?;
        let selection = compile_package_selection(
            &loaded.package,
            &loaded.canonical_source_byte_sha256,
            &request.selected_language_id,
            &request.language_selection_path,
            &request.participant.participant_id,
        )?;
        validate_participant(&request.participant, &selection)?;
        let participant_code = validate_participant_code(&request.participant.participant_code)?;
        let workspace_files =
            resolve_workspace_files(&self.workspace, &request.workspace_id, &selection)?;
        let asset_bindings_sha256 = canonical_sha256(&selection.asset_bindings, &[])?;
        let package_receipt = package_receipt(&selection, asset_bindings_sha256);
        let run_id = Uuid::new_v4().to_string();
        let lsl = if selection.settings.advanced.lsl.enabled {
            Some(LslService::start(
                &selection.settings.advanced.lsl,
                selection.settings.experiment.sampling_frequency_hz,
                &run_id,
            )?)
        } else {
            None
        };

        let mailbox = Arc::new(ProtocolInputMailbox::new(selection.settings.input.kind));
        let callback_mailbox = Arc::clone(&mailbox);
        let authority_id = self.input.prepare_run_full(
            selection.settings.input.clone(),
            &request.input_test_receipt_id,
            move |update| callback_mailbox.push(update),
        )?;
        let mut input_guard =
            PreparedInputGuard::new(Arc::clone(&self.input), authority_id.clone());

        let recovery_id = Uuid::new_v4().to_string();
        let started = OffsetDateTime::now_utc();
        let started_at = format_wall_time(started)?;
        let timestamp = session_timestamp(started)?;
        let output_receipt_id = Uuid::new_v4().to_string();
        let participant = CodedParticipant {
            id: request.participant.participant_id,
            code: participant_code,
            age: request.participant.age,
            gender: request.participant.gender,
            handedness: request.participant.handedness,
            attempt_number: 0,
        };
        let (receipt, storage, participant) =
            self.workspace
                .with_workspace(&request.workspace_id, |workspace_root, _| {
                    let prepared = prepare_attempt(
                        workspace_root,
                        &selection.settings.experiment.id,
                        &participant.id,
                        request.rerun_confirmed,
                    )?;
                    let mut participant = participant.clone();
                    participant.attempt_number = prepared.attempt_number;
                    let session_stem = format!(
                        "{}_{}_A{}_G{:?}_H{:?}_{}_R{:02}",
                        participant.id,
                        participant.code,
                        participant.age,
                        participant.gender,
                        participant.handedness,
                        timestamp,
                        participant.attempt_number
                    );
                    let journal = PackageRecoveryJournalV1 {
                        schema: PACKAGE_RECOVERY_JOURNAL_SCHEMA.to_owned(),
                        version: 1,
                        recovery_id: recovery_id.clone(),
                        run_id: run_id.clone(),
                        experiment_id: selection.settings.experiment.id.clone(),
                        participant_id: participant.id.clone(),
                        participant_code: participant.code.clone(),
                        age: participant.age,
                        gender: participant.gender,
                        handedness: participant.handedness,
                        attempt_number: participant.attempt_number,
                        session_stem: session_stem.clone(),
                        started_at: started_at.clone(),
                        playback_mode: RunPlaybackModeV3::NativeGstPlay,
                        playback_qualification: RunPlaybackQualificationV3::QualifiedNative,
                        package: package_receipt.clone(),
                        settings_sha256: selection.settings_sha256.clone(),
                        assignment_plan_sha256: selection.experiment_plan.plan_hash_sha256.clone(),
                        protocol_plan_sha256: selection
                            .protocol_plan
                            .protocol_plan_hash_sha256
                            .clone(),
                        definition_hashes: definition_receipts(&selection),
                        partial_sample_count: 0,
                        partial_event_count: 0,
                        submitted_response_count: 0,
                        submitted_responses: Vec::new(),
                        safe_protocol_step_position: 0,
                        active_questionnaire_draft: None,
                        last_monotonic_time_ns: "0".to_owned(),
                        gap_event_count: 0,
                        missed_slot_count: 0,
                        recovery: RecoverySummaryV1 {
                            resumed: false,
                            source_run_id: None,
                            restarted_stimulus_ids: Vec::new(),
                        },
                        pending_finalization: None,
                    };
                    journal.validate_bindings(&selection)?;
                    let settings_bytes = canonical_json(&selection.settings, &[])?;
                    let experiment_source_bytes =
                        canonical_json(&selection.settings.external_protocol.definition, &[])?;
                    let experiment_plan_bytes = canonical_json(&selection.experiment_plan, &[])?;
                    let protocol_plan_bytes = canonical_json(&selection.protocol_plan, &[])?;
                    let storage = PackageRunStorage::create(
                        prepared,
                        NewStorageRequest {
                            workspace_root,
                            session_stem: &session_stem,
                            package_source: request.experiment_package_source_text.as_bytes(),
                            settings: &settings_bytes,
                            experiment_source: &experiment_source_bytes,
                            experiment_plan: &experiment_plan_bytes,
                            protocol_plan: &protocol_plan_bytes,
                            journal,
                            csv: selection.settings.output.csv,
                            tsv: selection.settings.output.tsv,
                        },
                    )?;
                    let receipt = PackageStartRunReceipt {
                        run_id: run_id.clone(),
                        participant_id: participant.id.clone(),
                        attempt_number: participant.attempt_number,
                        session_stem,
                        settings_sha256: selection.settings_sha256.clone(),
                        assignment_plan_sha256: selection.experiment_plan.plan_hash_sha256.clone(),
                        protocol_plan_sha256: selection
                            .protocol_plan
                            .protocol_plan_hash_sha256
                            .clone(),
                        package_source_byte_sha256: selection.package_source_byte_sha256.clone(),
                        output_receipt_id: output_receipt_id.clone(),
                        resumed: false,
                        resume_at_protocol_step_position: Some(1),
                        playback_mode: request.playback_mode,
                        playback_qualification,
                    };
                    Ok((receipt, storage, participant))
                })?;

        let status = Arc::new(Mutex::new(initial_status(
            &receipt,
            &selection,
            lsl.is_some(),
        )));
        let active_run = self.launch_worker(WorkerInit {
            receipt: receipt.clone(),
            selection,
            participant,
            workspace_id: request.workspace_id,
            workspace_files,
            storage,
            lsl,
            workspace: Arc::clone(&self.workspace),
            media: Arc::clone(&self.native_media),
            input: Arc::clone(&self.input),
            input_authority_id: authority_id,
            mailbox,
            status,
            safe_protocol_position: 0,
            monotonic_offset_ns: 0,
            sample_sequence: 0,
            event_sequence: 0,
            submitted_responses: Vec::new(),
            active_draft: None,
            resumed: false,
        })?;
        input_guard.disarm();
        *active = Some(active_run);
        Ok(receipt)
    }

    pub fn preflight(
        &self,
        request: PackagePreflightRequest,
    ) -> ResearchResult<PackagePreflightReceiptV1> {
        let loaded =
            parse_canonical_experiment_package_text(&request.experiment_package_source_text)?;
        let selection = compile_package_selection(
            &loaded.package,
            &loaded.canonical_source_byte_sha256,
            &request.selected_language_id,
            &request.language_selection_path,
            &request.participant_id,
        )?;
        let workspace_files =
            resolve_workspace_files(&self.workspace, &request.workspace_id, &selection)?;
        if workspace_files.len() != selection.asset_bindings.len() {
            return Err(CommandError::invalid_contract(
                "The native package asset closure is incomplete.",
            ));
        }
        let asset_bindings_sha256 = canonical_sha256(&selection.asset_bindings, &[])?;
        let stimulus_step_count = selection
            .protocol_plan
            .steps
            .iter()
            .filter(|step| matches!(step, ProtocolStepV2::Stimulus { .. }))
            .count() as u32;
        let questionnaire_step_count = selection
            .protocol_plan
            .steps
            .iter()
            .filter(|step| matches!(step, ProtocolStepV2::Questionnaire { .. }))
            .count() as u32;
        let media = self.native_media.capability();
        Ok(PackagePreflightReceiptV1 {
            schema: "affect-research-native-package-preflight",
            version: 1,
            package_source_byte_sha256: selection.package_source_byte_sha256,
            package_definition_sha256: selection.package_definition_sha256,
            participant_id: selection.participant_id,
            settings_sha256: selection.settings_sha256,
            assignment_plan_sha256: selection.experiment_plan.plan_hash_sha256,
            assignment_sha256: selection.assignment_sha256,
            protocol_plan_sha256: selection.protocol_plan.protocol_plan_hash_sha256,
            asset_bindings_sha256,
            asset_binding_count: selection.asset_bindings.len() as u32,
            protocol_step_count: selection.protocol_plan.steps.len() as u32,
            stimulus_step_count,
            questionnaire_step_count,
            native_start_ready: self.native_acquisition_supported
                && media.qualified_start_available
                && media.player_actor_ready,
        })
    }

    pub fn list_recoveries(
        &self,
        workspace_id: &str,
        experiment_package_source_text: &str,
    ) -> ResearchResult<PackageRecoveryListingV1> {
        let loaded = parse_canonical_experiment_package_text(experiment_package_source_text)?;
        let mut listing = self
            .workspace
            .with_workspace(workspace_id, |root, _| list_bound_recoveries(root, &loaded))?;
        let status = self.status();
        if status.active {
            if let Some(participant_id) = status.participant_id {
                if let Some(participant) = listing
                    .participants
                    .iter_mut()
                    .find(|participant| participant.participant_id == participant_id)
                {
                    participant.state = PackageParticipantStateV1::Active;
                    participant.latest_attempt_number = status.attempt_number;
                }
            }
        }
        Ok(listing)
    }

    pub fn resume(
        &self,
        request: ResumePackageRunRequest,
    ) -> ResearchResult<PackageStartRunReceipt> {
        require_native_acquisition(self.native_acquisition_supported)?;
        let mut active = lock(&self.active);
        if active.is_some() {
            return Err(CommandError::run_active());
        }
        if request.playback_mode != PlaybackMode::NativeGstPlay {
            return Err(CommandError::invalid_contract(
                "The Rust-owned package protocol requires native GstPlay playback.",
            ));
        }
        let playback_qualification = self
            .native_media
            .authorize_playback(request.playback_mode)?;
        if playback_qualification != PlaybackQualification::QualifiedNative {
            return Err(CommandError::native_media_unavailable(
                "native-gstplay-qualification-required",
            ));
        }
        let loaded =
            parse_canonical_experiment_package_text(&request.experiment_package_source_text)?;
        let bound = self
            .workspace
            .with_workspace(&request.workspace_id, |root, _| {
                load_bound_recovery(root, &loaded, &request.recovery_id)
            })?;
        if bound.journal.pending_finalization.is_some() {
            return Err(CommandError::forbidden(
                "This package recovery contains a terminal transaction and requires finalize-only recovery.",
            ));
        }
        if bound.journal.safe_protocol_step_position
            >= bound.selection.protocol_plan.steps.len() as u32
        {
            return Err(CommandError::forbidden(
                "The recovered protocol has no unsafe step to resume.",
            ));
        }
        let selection = bound.selection;
        let workspace_files =
            resolve_workspace_files(&self.workspace, &request.workspace_id, &selection)?;
        let mut journal = bound.journal;
        let monotonic_offset_ns = journal
            .last_monotonic_time_ns
            .parse::<u128>()
            .map_err(|_| {
                CommandError::invalid_contract(
                    "The package recovery monotonic timestamp is invalid.",
                )
            })?
            .saturating_add(1);
        journal.recovery.resumed = true;
        journal.recovery.source_run_id = Some(journal.run_id.clone());
        if let Some(ProtocolStepV2::Stimulus { stimulus_id, .. }) = selection
            .protocol_plan
            .step(journal.safe_protocol_step_position + 1)
        {
            if !journal
                .recovery
                .restarted_stimulus_ids
                .contains(stimulus_id)
            {
                journal
                    .recovery
                    .restarted_stimulus_ids
                    .push(stimulus_id.clone());
            }
        }
        journal.validate_bindings(&selection)?;
        let participant = CodedParticipant {
            id: journal.participant_id.clone(),
            code: validate_participant_code(&journal.participant_code)?,
            age: journal.age,
            gender: journal.gender,
            handedness: journal.handedness,
            attempt_number: journal.attempt_number,
        };
        let settings_bytes = canonical_json(&selection.settings, &[])?;
        let experiment_source_bytes =
            canonical_json(&selection.settings.external_protocol.definition, &[])?;
        let experiment_plan_bytes = canonical_json(&selection.experiment_plan, &[])?;
        let protocol_plan_bytes = canonical_json(&selection.protocol_plan, &[])?;
        let storage = self
            .workspace
            .with_workspace(&request.workspace_id, |root, _| {
                PackageRunStorage::resume(ResumeStorageRequest {
                    workspace_root: root,
                    package_source: request.experiment_package_source_text.as_bytes(),
                    settings: &settings_bytes,
                    experiment_source: &experiment_source_bytes,
                    experiment_plan: &experiment_plan_bytes,
                    protocol_plan: &protocol_plan_bytes,
                    journal: journal.clone(),
                    csv: selection.settings.output.csv,
                    tsv: selection.settings.output.tsv,
                })
            })?;
        let lsl = if selection.settings.advanced.lsl.enabled {
            Some(LslService::start(
                &selection.settings.advanced.lsl,
                selection.settings.experiment.sampling_frequency_hz,
                &journal.run_id,
            )?)
        } else {
            None
        };
        let mailbox = Arc::new(ProtocolInputMailbox::new(selection.settings.input.kind));
        let callback_mailbox = Arc::clone(&mailbox);
        let authority_id = self.input.prepare_run_full(
            selection.settings.input.clone(),
            &request.input_test_receipt_id,
            move |update| callback_mailbox.push(update),
        )?;
        let mut input_guard =
            PreparedInputGuard::new(Arc::clone(&self.input), authority_id.clone());
        let receipt = PackageStartRunReceipt {
            run_id: journal.run_id.clone(),
            participant_id: journal.participant_id.clone(),
            attempt_number: journal.attempt_number,
            session_stem: journal.session_stem.clone(),
            settings_sha256: journal.settings_sha256.clone(),
            assignment_plan_sha256: journal.assignment_plan_sha256.clone(),
            protocol_plan_sha256: journal.protocol_plan_sha256.clone(),
            package_source_byte_sha256: selection.package_source_byte_sha256.clone(),
            output_receipt_id: Uuid::new_v4().to_string(),
            resumed: true,
            resume_at_protocol_step_position: Some(journal.safe_protocol_step_position + 1),
            playback_mode: request.playback_mode,
            playback_qualification,
        };
        let status = Arc::new(Mutex::new(initial_status(
            &receipt,
            &selection,
            lsl.is_some(),
        )));
        let active_run = self.launch_worker(WorkerInit {
            receipt: receipt.clone(),
            selection,
            participant,
            workspace_id: request.workspace_id,
            workspace_files,
            storage,
            lsl,
            workspace: Arc::clone(&self.workspace),
            media: Arc::clone(&self.native_media),
            input: Arc::clone(&self.input),
            input_authority_id: authority_id,
            mailbox,
            status,
            safe_protocol_position: journal.safe_protocol_step_position,
            monotonic_offset_ns,
            sample_sequence: journal.partial_sample_count,
            event_sequence: journal.partial_event_count,
            submitted_responses: journal.submitted_responses,
            active_draft: journal.active_questionnaire_draft,
            resumed: true,
        })?;
        input_guard.disarm();
        *active = Some(active_run);
        Ok(receipt)
    }

    pub fn finalize_recovery(
        &self,
        request: FinalizePackageRecoveryRequest,
    ) -> ResearchResult<PackageFinalizeReceipt> {
        let active = lock(&self.active);
        if active.is_some() {
            return Err(CommandError::run_active());
        }
        let loaded =
            parse_canonical_experiment_package_text(&request.experiment_package_source_text)?;
        let bound = self
            .workspace
            .with_workspace(&request.workspace_id, |root, _| {
                load_bound_recovery(root, &loaded, &request.recovery_id)
            })?;
        let pending = bound.journal.pending_finalization.as_ref().ok_or_else(|| {
            CommandError::invalid_contract(
                "The selected package recovery has no pending finalization.",
            )
        })?;
        pending.manifest.validate_bindings(&bound.selection)?;
        let settings_bytes = canonical_json(&bound.selection.settings, &[])?;
        let experiment_source_bytes =
            canonical_json(&bound.selection.settings.external_protocol.definition, &[])?;
        let experiment_plan_bytes = canonical_json(&bound.selection.experiment_plan, &[])?;
        let protocol_plan_bytes = canonical_json(&bound.selection.protocol_plan, &[])?;
        let files = self
            .workspace
            .with_workspace(&request.workspace_id, |root, _| {
                finalize_pending_storage(FinalizePendingStorageRequest {
                    workspace_root: root,
                    package_source: request.experiment_package_source_text.as_bytes(),
                    settings: &settings_bytes,
                    experiment_source: &experiment_source_bytes,
                    experiment_plan: &experiment_plan_bytes,
                    protocol_plan: &protocol_plan_bytes,
                    journal: &bound.journal,
                })
            })?;
        Ok(PackageFinalizeReceipt {
            run_id: bound.journal.run_id,
            participant_id: bound.journal.participant_id,
            attempt_number: bound.journal.attempt_number,
            completion_status: pending.completion_status,
            output_receipt_id: Uuid::new_v4().to_string(),
            files,
        })
    }

    fn launch_worker(&self, init: WorkerInit) -> ResearchResult<ActivePackageRun> {
        let run_id = init.receipt.run_id.clone();
        let input_authority_id = init.input_authority_id.clone();
        let status = Arc::clone(&init.status);
        let (sender, receiver) = mpsc::sync_channel(128);
        let interrupt_sender = sender.clone();
        let (startup_tx, startup_rx) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("affect-research-package-protocol".to_owned())
            .spawn(move || run_worker(Worker::new(init), receiver, startup_tx))
            .map_err(CommandError::io)?;
        match startup_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = worker.join();
                return Err(error);
            }
            Err(_) => {
                let (reply_tx, reply_rx) = mpsc::channel();
                let _ = interrupt_sender.send(WorkerMessage::Interrupt(reply_tx));
                let _ = reply_rx.recv_timeout(Duration::from_secs(2));
                let _ = worker.join();
                return Err(CommandError::io(
                    "The native package protocol worker did not acknowledge startup.",
                ));
            }
        }
        Ok(ActivePackageRun {
            run_id,
            sender,
            status,
            worker: Some(worker),
            input_authority_id,
        })
    }

    pub fn status(&self) -> PackageRunStatus {
        let mut active = self.lock_active();
        let Some(current) = active.as_mut() else {
            return PackageRunStatus::idle();
        };
        let status = lock(&current.status).clone();
        let terminal_worker =
            !status.active && current.worker.as_ref().is_some_and(JoinHandle::is_finished);
        if !terminal_worker {
            return status;
        }
        let mut terminal = active
            .take()
            .expect("the package worker was present while holding the active-run lock");
        drop(active);
        if let Some(worker) = terminal.worker.take() {
            let _ = worker.join();
        }
        self.input.end_run(&terminal.input_authority_id);
        status
    }

    pub fn prepare_media(
        &self,
        run_id: &str,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.request(run_id, |reply| WorkerMessage::PrepareMedia(viewport, reply))
    }

    pub fn set_viewport(
        &self,
        run_id: &str,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.request(run_id, |reply| WorkerMessage::SetViewport(viewport, reply))
    }

    pub fn play(&self, run_id: &str) -> ResearchResult<NativeMediaStatusV1> {
        self.request(run_id, WorkerMessage::Play)
    }

    pub fn pause(&self, run_id: &str) -> ResearchResult<NativeMediaStatusV1> {
        self.request(run_id, WorkerMessage::Pause)
    }

    pub fn questionnaire_draft(
        &self,
        run_id: &str,
        protocol_step_position: u32,
        answers: Vec<PackageQuestionnaireChoiceV1>,
    ) -> ResearchResult<()> {
        self.request(run_id, |reply| {
            WorkerMessage::QuestionnaireDraft(protocol_step_position, answers, reply)
        })
    }

    pub fn questionnaire_submit(
        &self,
        run_id: &str,
        protocol_step_position: u32,
        answers: Vec<PackageQuestionnaireChoiceV1>,
    ) -> ResearchResult<()> {
        self.request(run_id, |reply| {
            WorkerMessage::QuestionnaireSubmit(protocol_step_position, answers, reply)
        })
    }

    pub fn finish(
        &self,
        run_id: &str,
        outcome: PackageFinishOutcome,
    ) -> ResearchResult<PackageFinalizeReceipt> {
        let mut active = self.lock_active();
        let current = active.as_mut().ok_or_else(CommandError::no_active_run)?;
        if current.run_id != run_id {
            return Err(CommandError::forbidden(
                "The active package run ID does not match.",
            ));
        }
        let (reply_tx, reply_rx) = mpsc::channel();
        if current
            .sender
            .send(WorkerMessage::Finish(outcome, reply_tx))
            .is_err()
        {
            let mut terminal = active
                .take()
                .expect("the failed package sender was present while holding the active-run lock");
            drop(active);
            if let Some(worker) = terminal.worker.take() {
                let _ = worker.join();
            }
            self.input.end_run(&terminal.input_authority_id);
            return Err(CommandError::io(
                "The native package worker stopped; reconcile its durable recovery before continuing.",
            ));
        }
        let result = reply_rx
            .recv_timeout(MESSAGE_TIMEOUT)
            .map_err(|_| CommandError::io("The native package finalization timed out."))?;
        if let Some(worker) = current.worker.take() {
            let _ = worker.join();
        }
        self.input.end_run(&current.input_authority_id);
        *active = None;
        result
    }

    pub fn shutdown(&self) {
        let mut active = self.lock_active();
        let Some(mut current) = active.take() else {
            return;
        };
        let (reply_tx, reply_rx) = mpsc::channel();
        let _ = current.sender.send(WorkerMessage::Interrupt(reply_tx));
        let _ = reply_rx.recv_timeout(Duration::from_secs(10));
        if let Some(worker) = current.worker.take() {
            let _ = worker.join();
        }
        self.input.end_run(&current.input_authority_id);
    }

    fn request<T>(
        &self,
        run_id: &str,
        message: impl FnOnce(mpsc::Sender<ResearchResult<T>>) -> WorkerMessage,
    ) -> ResearchResult<T> {
        let active = self.lock_active();
        let current = active.as_ref().ok_or_else(CommandError::no_active_run)?;
        if current.run_id != run_id {
            return Err(CommandError::forbidden(
                "The active package run ID does not match.",
            ));
        }
        let (reply_tx, reply_rx) = mpsc::channel();
        current
            .sender
            .send(message(reply_tx))
            .map_err(|_| CommandError::no_active_run())?;
        reply_rx
            .recv_timeout(MESSAGE_TIMEOUT)
            .map_err(|_| CommandError::io("The native package protocol command timed out."))?
    }

    fn lock_active(&self) -> MutexGuard<'_, Option<ActivePackageRun>> {
        lock(&self.active)
    }
}

impl Drop for PackageProtocolRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct PreparedInputGuard {
    input: Arc<ResearchInputService>,
    authority_id: String,
    armed: bool,
}

impl PreparedInputGuard {
    fn new(input: Arc<ResearchInputService>, authority_id: String) -> Self {
        Self {
            input,
            authority_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PreparedInputGuard {
    fn drop(&mut self) {
        if self.armed {
            self.input.end_run(&self.authority_id);
        }
    }
}

#[derive(Clone)]
struct CodedParticipant {
    id: String,
    code: String,
    age: u8,
    gender: GenderCodeV1,
    handedness: HandednessCodeV1,
    attempt_number: u32,
}

fn validate_participant(
    participant: &TransientParticipant,
    selection: &CompiledPackageSelectionV1,
) -> ResearchResult<()> {
    if participant.participant_id != selection.participant_id
        || participant.age == 0
        || participant.age > 120
    {
        return Err(CommandError::invalid_contract(
            "The participant demographics do not bind the selected package assignment.",
        ));
    }
    validate_participant_code(&participant.participant_code)?;
    Ok(())
}

fn resolve_workspace_files(
    workspace: &WorkspaceService,
    workspace_id: &str,
    selection: &CompiledPackageSelectionV1,
) -> ResearchResult<HashMap<String, String>> {
    let mut resolved = HashMap::with_capacity(selection.asset_bindings.len());
    for binding in &selection.asset_bindings {
        let stimulus = selection
            .settings
            .stimuli
            .items
            .iter()
            .find(|stimulus| stimulus.stimulus_id == binding.stimulus_id)
            .ok_or_else(|| CommandError::invalid_contract("A package asset has no stimulus."))?;
        let StimulusSourceV1::WorkspaceFile { mime_type, .. } = &stimulus.source else {
            return Err(CommandError::invalid_contract(
                "Native experiment packages require fixed local workspace assets.",
            ));
        };
        let workspace_file_id = workspace.resolve_native_package_file(
            workspace_id,
            &binding.sha256,
            binding.byte_length,
            &binding.logical_path,
            mime_type,
            binding.duration_ms,
        )?;
        resolved.insert(binding.stimulus_id.clone(), workspace_file_id);
    }
    Ok(resolved)
}

fn definition_receipts(
    selection: &CompiledPackageSelectionV1,
) -> Vec<crate::research_protocol::QuestionnaireDefinitionReceiptV1> {
    selection
        .settings
        .questionnaires
        .definitions
        .iter()
        .map(
            |definition| crate::research_protocol::QuestionnaireDefinitionReceiptV1 {
                questionnaire_id: definition.questionnaire_id.clone(),
                definition_sha256: definition.definition_sha256.clone(),
            },
        )
        .collect()
}

fn initial_status(
    receipt: &PackageStartRunReceipt,
    selection: &CompiledPackageSelectionV1,
    lsl_enabled: bool,
) -> PackageRunStatus {
    PackageRunStatus {
        active: true,
        run_id: Some(receipt.run_id.clone()),
        participant_id: Some(receipt.participant_id.clone()),
        attempt_number: Some(receipt.attempt_number),
        phase: PackageRunPhase::StimulusReady,
        protocol_step_position: Some(1),
        safe_protocol_step_position: 0,
        protocol_step_count: selection.protocol_plan.steps.len() as u32,
        questionnaire: None,
        stimulus: None,
        interval_duration_ms: None,
        interval_remaining_ms: None,
        sample_count: 0,
        event_count: 0,
        gap_event_count: 0,
        missed_slot_count: 0,
        coalesced_input_update_count: 0,
        submitted_response_count: 0,
        draft_response_count: 0,
        current_valence: 0.0,
        current_arousal: 0.0,
        input_active: false,
        write_healthy: true,
        lsl_enabled,
        failure_code: None,
    }
}

struct WorkerInit {
    receipt: PackageStartRunReceipt,
    selection: CompiledPackageSelectionV1,
    participant: CodedParticipant,
    workspace_id: String,
    workspace_files: HashMap<String, String>,
    storage: PackageRunStorage,
    lsl: Option<LslService>,
    workspace: Arc<WorkspaceService>,
    media: Arc<NativeMediaService>,
    input: Arc<ResearchInputService>,
    input_authority_id: String,
    mailbox: Arc<ProtocolInputMailbox>,
    status: Arc<Mutex<PackageRunStatus>>,
    safe_protocol_position: u32,
    monotonic_offset_ns: u128,
    sample_sequence: u64,
    event_sequence: u64,
    submitted_responses: Vec<QuestionnaireResponseV1>,
    active_draft: Option<QuestionnaireDraftV1>,
    resumed: bool,
}

struct Worker {
    receipt: PackageStartRunReceipt,
    selection: CompiledPackageSelectionV1,
    participant: CodedParticipant,
    workspace_id: String,
    workspace_files: HashMap<String, String>,
    storage: PackageRunStorage,
    lsl: Option<LslService>,
    workspace: Arc<WorkspaceService>,
    media: Arc<NativeMediaService>,
    input: Arc<ResearchInputService>,
    input_authority_id: String,
    mailbox: Arc<ProtocolInputMailbox>,
    status: Arc<Mutex<PackageRunStatus>>,
    reducer: ProtocolReducer,
    announced_protocol_position: Option<u32>,
    run_epoch: Instant,
    monotonic_offset_ns: u128,
    clock: Option<DeadlineClock>,
    state: AffectState,
    media_fence: Option<NativeMediaCommandFenceV1>,
    media_status: Option<NativeMediaStatusV1>,
    sample_sequence: u64,
    event_sequence: u64,
    submitted_responses: Vec<QuestionnaireResponseV1>,
    active_draft: Option<QuestionnaireDraftV1>,
    questionnaire_started_at: Option<Instant>,
    questionnaire_answer_latency_ms: HashMap<String, f64>,
    coalesced_input_update_count: u64,
    terminal: bool,
    resumed: bool,
}

#[derive(Clone, Copy)]
struct AffectState {
    current_x: f64,
    current_y: f64,
    target_x: f64,
    target_y: f64,
    anchor: Instant,
    input_active: bool,
    impulse_active_until: Instant,
}

impl Worker {
    fn new(init: WorkerInit) -> ResearchResult<Self> {
        let now = Instant::now();
        let reducer = if init.safe_protocol_position == 0 {
            ProtocolReducer::new(&init.selection.protocol_plan, now)?
        } else {
            ProtocolReducer::resume(
                &init.selection.protocol_plan,
                init.safe_protocol_position,
                now,
            )?
        };
        let questionnaire_answer_latency_ms = init
            .active_draft
            .as_ref()
            .map(|draft| {
                draft
                    .responses
                    .iter()
                    .map(|response| (response.item_id.clone(), response.response_latency_ms))
                    .collect()
            })
            .unwrap_or_default();
        Ok(Self {
            receipt: init.receipt,
            selection: init.selection,
            participant: init.participant,
            workspace_id: init.workspace_id,
            workspace_files: init.workspace_files,
            storage: init.storage,
            lsl: init.lsl,
            workspace: init.workspace,
            media: init.media,
            input: init.input,
            input_authority_id: init.input_authority_id,
            mailbox: init.mailbox,
            status: init.status,
            reducer,
            announced_protocol_position: None,
            run_epoch: now,
            monotonic_offset_ns: init.monotonic_offset_ns,
            clock: None,
            state: AffectState {
                current_x: 0.0,
                current_y: 0.0,
                target_x: 0.0,
                target_y: 0.0,
                anchor: now,
                input_active: false,
                impulse_active_until: now,
            },
            media_fence: None,
            media_status: None,
            sample_sequence: init.sample_sequence,
            event_sequence: init.event_sequence,
            submitted_responses: init.submitted_responses,
            active_draft: init.active_draft,
            questionnaire_started_at: None,
            questionnaire_answer_latency_ms,
            coalesced_input_update_count: 0,
            terminal: false,
            resumed: init.resumed,
        })
    }

    fn start(&mut self) -> ResearchResult<()> {
        if self.resumed {
            self.write_event(EventContext::session(
                ResearchEventTypeV2::RecoveryStarted,
                Some("safe-protocol-boundary".to_owned()),
            ))?;
            self.write_event(EventContext::session(
                ResearchEventTypeV2::RecoveryCompleted,
                Some("native-recovery-restored".to_owned()),
            ))?;
        } else {
            self.write_event(EventContext::session(
                ResearchEventTypeV2::SessionPrepared,
                Some("native-gstplay-package-v1".to_owned()),
            ))?;
            self.write_event(EventContext::session(
                ResearchEventTypeV2::SessionStarted,
                None,
            ))?;
        }
        self.announce_current_step()?;
        self.publish_status();
        Ok(())
    }

    fn timeout(&self) -> Duration {
        let now = Instant::now();
        let sample = self
            .clock
            .as_ref()
            .and_then(|clock| clock.next_deadline().checked_duration_since(now));
        let interval = self.reducer.interval_remaining(now);
        sample
            .into_iter()
            .chain(interval)
            .min()
            .unwrap_or_else(|| {
                if self.media_fence.is_some() {
                    ACTIVE_POLL
                } else {
                    IDLE_POLL
                }
            })
            .min(if self.media_fence.is_some() {
                ACTIVE_POLL
            } else {
                IDLE_POLL
            })
    }

    fn tick(&mut self) -> ResearchResult<()> {
        if self.reducer.phase() == ProtocolPhase::StimulusPlaying {
            self.apply_input_drain(self.mailbox.drain()?)?;
        } else {
            self.mailbox.clear();
        }
        self.poll_media()?;
        self.poll_interval()?;
        self.sample_if_due()?;
        self.publish_status();
        Ok(())
    }

    fn prepare_media(
        &mut self,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        if self.reducer.phase() != ProtocolPhase::StimulusReady || self.media_fence.is_some() {
            return Err(CommandError::invalid_contract(
                "Native media can be prepared only once for the active ready stimulus.",
            ));
        }
        let (stimulus_id, _, _, _) = self.current_stimulus()?;
        let binding = self
            .selection
            .asset_bindings
            .iter()
            .find(|binding| binding.stimulus_id == stimulus_id)
            .ok_or_else(|| CommandError::invalid_contract("The active package asset is absent."))?;
        let stimulus = self.stimulus_definition(stimulus_id)?;
        let StimulusSourceV1::WorkspaceFile { mime_type, .. } = &stimulus.source else {
            return Err(CommandError::invalid_contract(
                "The native package runner accepts only fixed local assets.",
            ));
        };
        let workspace_file_id = self
            .workspace_files
            .get(stimulus_id)
            .ok_or_else(|| CommandError::forbidden("The active package asset is not verified."))?;
        let grant = self.workspace.issue_native_media_grant(
            &self.workspace_id,
            workspace_file_id,
            &binding.sha256,
            binding.byte_length,
            mime_type,
        )?;
        let receipt = self.media.prepare(grant, viewport)?;
        let fence = NativeMediaCommandFenceV1 {
            session_id: receipt.session_id,
            generation: receipt.generation,
        };
        let status = self.media.status()?;
        self.require_media_binding(&status, &fence, workspace_file_id)?;
        self.media_fence = Some(fence);
        self.media_status = Some(status.clone());
        self.publish_status();
        Ok(status)
    }

    fn set_viewport(
        &mut self,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        let fence = self
            .media_fence
            .clone()
            .ok_or_else(|| CommandError::invalid_contract("No native stimulus is prepared."))?;
        let status = self.media.set_viewport(fence.clone(), viewport)?;
        self.require_current_media_status(&status, &fence)?;
        self.media_status = Some(status.clone());
        self.publish_status();
        Ok(status)
    }

    fn play(&mut self) -> ResearchResult<NativeMediaStatusV1> {
        if !matches!(
            self.reducer.phase(),
            ProtocolPhase::StimulusReady | ProtocolPhase::StimulusPaused
        ) {
            return Err(CommandError::invalid_contract(
                "Play is available only for the active ready or paused stimulus.",
            ));
        }
        let fence = self
            .media_fence
            .clone()
            .ok_or_else(|| CommandError::invalid_contract("Prepare the native stimulus first."))?;
        let status = self.media.play(fence.clone())?;
        self.reconcile_media(status.clone())?;
        Ok(status)
    }

    fn pause(&mut self) -> ResearchResult<NativeMediaStatusV1> {
        if self.reducer.phase() != ProtocolPhase::StimulusPlaying {
            return Err(CommandError::invalid_contract(
                "Pause is available only while the native stimulus is playing.",
            ));
        }
        let fence = self
            .media_fence
            .clone()
            .ok_or_else(|| CommandError::invalid_contract("No native stimulus is prepared."))?;
        let status = self.media.pause(fence.clone())?;
        self.reconcile_media(status.clone())?;
        Ok(status)
    }

    fn checkpoint_questionnaire(
        &mut self,
        expected_position: u32,
        answers: Vec<PackageQuestionnaireChoiceV1>,
    ) -> ResearchResult<()> {
        let position = self.active_position()?;
        if position != expected_position {
            return Err(CommandError::invalid_contract(
                "The questionnaire draft targets a stale protocol step.",
            ));
        }
        let now = Instant::now();
        let answers = self.answers_with_latency(answers, now)?;
        let responses = derive_questionnaire_responses_v3(
            &self.selection.settings,
            &self.selection.protocol_plan,
            position,
            &answers,
            QuestionnaireResponseStatusV1::Draft,
            self.submitted_responses.len() as u64 + 1,
            &self.receipt.run_id,
            self.participant.attempt_number,
            &wall_time_now()?,
            &monotonic_ns(self.monotonic_offset_ns, self.run_epoch, now),
        )?;
        let (module_id, questionnaire_id, definition_sha256) =
            self.current_questionnaire_identity()?;
        self.active_draft = Some(QuestionnaireDraftV1 {
            protocol_step_position: position,
            module_id: module_id.clone(),
            questionnaire_id: questionnaire_id.clone(),
            definition_sha256: definition_sha256.clone(),
            responses,
        });
        self.sync_journal_state();
        self.write_event(EventContext::questionnaire(
            ResearchEventTypeV2::QuestionnaireDraftCheckpointed,
            position,
            module_id,
            questionnaire_id,
            definition_sha256,
            None,
        ))?;
        self.publish_status();
        Ok(())
    }

    fn submit_questionnaire(
        &mut self,
        expected_position: u32,
        answers: Vec<PackageQuestionnaireChoiceV1>,
    ) -> ResearchResult<()> {
        let position = self.active_position()?;
        if position != expected_position {
            return Err(CommandError::invalid_contract(
                "The questionnaire submission targets a stale protocol step.",
            ));
        }
        let now = Instant::now();
        let answers = self.answers_with_latency(answers, now)?;
        let responses = derive_questionnaire_responses_v3(
            &self.selection.settings,
            &self.selection.protocol_plan,
            position,
            &answers,
            QuestionnaireResponseStatusV1::Submitted,
            self.submitted_responses.len() as u64 + 1,
            &self.receipt.run_id,
            self.participant.attempt_number,
            &wall_time_now()?,
            &monotonic_ns(self.monotonic_offset_ns, self.run_epoch, now),
        )?;
        let (module_id, questionnaire_id, definition_sha256) =
            self.current_questionnaire_identity()?;
        self.submitted_responses.extend(responses);
        self.active_draft = None;
        self.questionnaire_started_at = None;
        self.questionnaire_answer_latency_ms.clear();
        self.reducer
            .submit_questionnaire(&self.selection.protocol_plan, position, now)?;
        self.announced_protocol_position = None;
        self.sync_journal_state();
        self.write_event(EventContext::questionnaire(
            ResearchEventTypeV2::QuestionnaireCompleted,
            position,
            module_id,
            questionnaire_id,
            definition_sha256,
            None,
        ))?;
        self.announce_current_step()?;
        self.publish_status();
        Ok(())
    }

    fn apply_input_drain(&mut self, mut drain: InputDrain) -> ResearchResult<()> {
        self.coalesced_input_update_count = self
            .coalesced_input_update_count
            .saturating_add(drain.coalesced_count);
        while let Some(input) = drain.digital.pop_front() {
            self.apply_digital_input(input)?;
        }
        if let Some(input) = drain.continuous {
            self.apply_continuous_input(input)?;
        }
        Ok(())
    }

    fn apply_digital_input(&mut self, input: NativeDigitalInput) -> ResearchResult<()> {
        if self.selection.settings.input.kind != InputKindV1::Digital {
            return Err(CommandError::invalid_contract(
                "A digital edge crossed a non-digital binding boundary.",
            ));
        }
        if input.observed_at > Instant::now() {
            return Err(CommandError::invalid_contract(
                "A native input timestamp is in the future.",
            ));
        }
        self.state.anchor = self.state.anchor.max(input.observed_at);
        self.state.input_active = !input.impulse && input.input_active;
        self.state.impulse_active_until = if input.impulse {
            input.observed_at + Duration::from_millis(100)
        } else {
            input.observed_at
        };
        if input.apply_step {
            let step = self.selection.settings.input.step_size.unwrap_or(0.1);
            match input.direction {
                DirectionV1::Up => {
                    self.state.target_y = (self.state.target_y + step).clamp(-1.0, 1.0)
                }
                DirectionV1::Down => {
                    self.state.target_y = (self.state.target_y - step).clamp(-1.0, 1.0)
                }
                DirectionV1::Left => {
                    self.state.target_x = (self.state.target_x - step).clamp(-1.0, 1.0)
                }
                DirectionV1::Right => {
                    self.state.target_x = (self.state.target_x + step).clamp(-1.0, 1.0)
                }
            }
            self.state.current_x = self.state.target_x;
            self.state.current_y = self.state.target_y;
            let (identity, stimulus_position, protocol_position) =
                self.active_stimulus_context()?;
            self.write_event(EventContext::stimulus(
                ResearchEventTypeV2::InputEdge,
                protocol_position,
                stimulus_position,
                identity,
                self.media_position(),
                None,
                Some(input.detail),
            ))?;
        }
        Ok(())
    }

    fn apply_continuous_input(&mut self, input: NativeContinuousInput) -> ResearchResult<()> {
        if self.selection.settings.input.kind == InputKindV1::Digital
            || !input.x.is_finite()
            || !input.y.is_finite()
            || !(-1.0..=1.0).contains(&input.x)
            || !(-1.0..=1.0).contains(&input.y)
            || input.observed_at > Instant::now()
        {
            return Err(CommandError::invalid_contract(
                "A native continuous input update is outside its frozen contract.",
            ));
        }
        self.state.current_x = canonical_zero(input.x);
        self.state.current_y = canonical_zero(input.y);
        self.state.target_x = self.state.current_x;
        self.state.target_y = self.state.current_y;
        self.state.anchor = self.state.anchor.max(input.observed_at);
        self.state.input_active = input.input_active;
        Ok(())
    }

    fn poll_media(&mut self) -> ResearchResult<()> {
        if self.media_fence.is_none() {
            return Ok(());
        }
        let status = self.media.status_snapshot()?;
        if self
            .media_status
            .as_ref()
            .is_some_and(|previous| status.sequence <= previous.sequence)
        {
            return Ok(());
        }
        self.reconcile_media(status)
    }

    fn reconcile_media(&mut self, status: NativeMediaStatusV1) -> ResearchResult<()> {
        let fence = self
            .media_fence
            .clone()
            .ok_or_else(|| CommandError::invalid_contract("No native stimulus is prepared."))?;
        self.require_current_media_status(&status, &fence)?;
        let previous_state = self.media_status.as_ref().map(|previous| previous.state);
        let protocol_position = self.active_position()?;
        let phase = self.reducer.phase();
        let media_edge = match (phase, status.state) {
            (ProtocolPhase::StimulusReady, NativeMediaStateV1::Playing) => Some(MediaEdge::Started),
            (
                ProtocolPhase::StimulusPlaying,
                NativeMediaStateV1::Paused | NativeMediaStateV1::Buffering,
            ) => Some(MediaEdge::Paused),
            (ProtocolPhase::StimulusPaused, NativeMediaStateV1::Playing) => {
                Some(MediaEdge::Resumed)
            }
            (
                ProtocolPhase::StimulusPlaying | ProtocolPhase::StimulusPaused,
                NativeMediaStateV1::Ended,
            ) => Some(MediaEdge::Completed),
            (_, NativeMediaStateV1::Failed | NativeMediaStateV1::ShuttingDown) => {
                return Err(CommandError::native_media_unavailable(
                    status
                        .reason_code
                        .as_deref()
                        .unwrap_or("native-media-failed"),
                ));
            }
            (_, NativeMediaStateV1::Idle)
                if previous_state.is_some_and(|state| state != NativeMediaStateV1::Idle) =>
            {
                return Err(CommandError::native_media_unavailable(
                    "native-media-became-idle-before-completion",
                ));
            }
            _ => None,
        };
        self.media_status = Some(status.clone());
        let Some(edge) = media_edge else {
            self.publish_status();
            return Ok(());
        };
        let (identity, stimulus_position, _) = self.active_stimulus_context()?;
        let event_type = match edge {
            MediaEdge::Started => ResearchEventTypeV2::StimulusStarted,
            MediaEdge::Paused => ResearchEventTypeV2::StimulusPaused,
            MediaEdge::Resumed => ResearchEventTypeV2::StimulusResumed,
            MediaEdge::Completed => ResearchEventTypeV2::StimulusCompleted,
        };
        self.reducer.apply_media_edge(
            &self.selection.protocol_plan,
            protocol_position,
            edge,
            Instant::now(),
        )?;
        match edge {
            MediaEdge::Started | MediaEdge::Resumed => {
                self.input
                    .set_run_accepting(&self.input_authority_id, true)?;
                self.clock = Some(DeadlineClock::new(
                    self.selection.settings.experiment.sampling_frequency_hz,
                    Instant::now(),
                )?);
            }
            MediaEdge::Paused => {
                self.input
                    .set_run_accepting(&self.input_authority_id, false)?;
                self.clock = None;
                self.state.input_active = false;
            }
            MediaEdge::Completed => {
                self.input
                    .set_run_accepting(&self.input_authority_id, false)?;
                self.clock = None;
                self.state.input_active = false;
            }
        }
        self.sync_journal_state();
        self.write_event(EventContext::stimulus(
            event_type,
            protocol_position,
            stimulus_position,
            identity,
            status.position_ms.unwrap_or_default(),
            None,
            (status.state == NativeMediaStateV1::Buffering).then(|| "native-buffering".to_owned()),
        ))?;
        if edge == MediaEdge::Completed {
            let _ = self.media.stop(fence);
            self.media_fence = None;
            self.media_status = None;
            self.reset_affect();
            self.announced_protocol_position = None;
            self.announce_current_step()?;
        }
        self.publish_status();
        Ok(())
    }

    fn poll_interval(&mut self) -> ResearchResult<()> {
        if self.reducer.phase() != ProtocolPhase::Interval {
            return Ok(());
        }
        let position = self.active_position()?;
        let Some(step) = self.selection.protocol_plan.step(position).cloned() else {
            return Err(CommandError::invalid_contract(
                "The active interval is unavailable.",
            ));
        };
        if !self
            .reducer
            .poll_interval(&self.selection.protocol_plan, Instant::now())?
        {
            return Ok(());
        }
        let ProtocolStepV2::Interval {
            stimulus_position,
            stimulus_id,
            ..
        } = step
        else {
            return Err(CommandError::invalid_contract(
                "The interval reducer crossed a non-interval step.",
            ));
        };
        let identity = self.stimulus_definition(&stimulus_id)?.sample_identity();
        self.announced_protocol_position = None;
        self.sync_journal_state();
        self.write_event(EventContext::stimulus(
            ResearchEventTypeV2::TransitionCompleted,
            position,
            stimulus_position,
            identity,
            0.0,
            None,
            Some("fixed-isi-complete".to_owned()),
        ))?;
        self.announce_current_step()
    }

    fn announce_current_step(&mut self) -> ResearchResult<()> {
        let Some(position) = self
            .reducer
            .active_protocol_position(&self.selection.protocol_plan)
        else {
            self.publish_status();
            return Ok(());
        };
        if self.announced_protocol_position == Some(position) {
            return Ok(());
        }
        self.announced_protocol_position = Some(position);
        let step = self
            .selection
            .protocol_plan
            .step(position)
            .cloned()
            .ok_or_else(|| CommandError::invalid_contract("The active protocol step is absent."))?;
        match step {
            ProtocolStepV2::Questionnaire {
                module_id,
                questionnaire_id,
                definition_sha256,
                ..
            } => {
                self.questionnaire_started_at = Some(Instant::now());
                if self
                    .active_draft
                    .as_ref()
                    .is_none_or(|draft| draft.protocol_step_position != position)
                {
                    self.questionnaire_answer_latency_ms.clear();
                }
                self.write_event(EventContext::questionnaire(
                    ResearchEventTypeV2::QuestionnaireStarted,
                    position,
                    module_id,
                    questionnaire_id,
                    definition_sha256,
                    None,
                ))?;
            }
            ProtocolStepV2::Interval {
                stimulus_position,
                stimulus_id,
                duration_ms,
                ..
            } => {
                let identity = self.stimulus_definition(&stimulus_id)?.sample_identity();
                self.write_event(EventContext::stimulus(
                    ResearchEventTypeV2::TransitionStarted,
                    position,
                    stimulus_position,
                    identity,
                    0.0,
                    None,
                    Some(format!("fixed-isi-{duration_ms}-ms")),
                ))?;
            }
            ProtocolStepV2::Stimulus { .. } => {
                self.questionnaire_started_at = None;
                self.questionnaire_answer_latency_ms.clear();
            }
        }
        self.publish_status();
        Ok(())
    }

    fn sample_if_due(&mut self) -> ResearchResult<()> {
        if self.reducer.phase() != ProtocolPhase::StimulusPlaying {
            return Ok(());
        }
        let now = Instant::now();
        let Some(due) = self.clock.as_mut().and_then(|clock| clock.poll(now)) else {
            return Ok(());
        };
        let (identity, stimulus_position, protocol_position) = self.active_stimulus_context()?;
        if due.missed_slots_before > 0 {
            self.storage.journal.gap_event_count =
                self.storage.journal.gap_event_count.saturating_add(1);
            self.storage.journal.missed_slot_count = self
                .storage
                .journal
                .missed_slot_count
                .saturating_add(due.missed_slots_before);
            self.write_event(EventContext::stimulus(
                ResearchEventTypeV2::TimingGap,
                protocol_position,
                stimulus_position,
                identity.clone(),
                self.media_position(),
                Some(due.missed_slots_before),
                Some("native-deadline-missed".to_owned()),
            ))?;
        }
        self.sample_sequence = self.sample_sequence.saturating_add(1);
        let x = self.state.current_x;
        let y = self.state.current_y;
        let radius = x.hypot(y).clamp(0.0, 1.0);
        let angle_degrees = if radius == 0.0 {
            0.0
        } else {
            y.atan2(x).to_degrees().rem_euclid(360.0)
        };
        let input_active = self.state.input_active || now < self.state.impulse_active_until;
        let animation_active = self.selection.settings.visual.flubber_enabled;
        let lsl_state = LslState {
            current_valence: x,
            current_arousal: y,
            target_valence: self.state.target_x,
            target_arousal: self.state.target_y,
            radius,
            angle_degrees,
            animation_active,
            input_active,
        };
        let lsl_time_seconds = self
            .lsl
            .as_ref()
            .map(|lsl| lsl.push_state(lsl_state))
            .transpose()?;
        let mappings = &self.selection.settings.advanced.mappings;
        let sample = ResearchSampleV1 {
            schema: RESEARCH_SAMPLE_SCHEMA.to_owned(),
            version: 1,
            sequence: self.sample_sequence,
            run_id: self.receipt.run_id.clone(),
            participant_id: self.participant.id.clone(),
            attempt_number: self.participant.attempt_number,
            settings_sha256: self.selection.settings_sha256.clone(),
            assignment_plan_sha256: self.selection.experiment_plan.plan_hash_sha256.clone(),
            stimulus_position,
            stimulus_identity: identity,
            wall_time_utc: wall_time_now()?,
            monotonic_time_ns: monotonic_ns(self.monotonic_offset_ns, self.run_epoch, now),
            lsl_time_seconds,
            sample_rate_hz: self.selection.settings.experiment.sampling_frequency_hz,
            scheduled_elapsed_ms: duration_ms(due.scheduled_elapsed),
            observed_elapsed_ms: duration_ms(due.observed_elapsed),
            scheduler_lateness_ms: duration_ms(due.lateness),
            scheduler_jitter_ms: due.jitter_ms,
            state_anchor_age_ms: duration_ms(now.duration_since(self.state.anchor)),
            missed_slots_before: due.missed_slots_before,
            media_time_ms: self.media_position(),
            current_valence: x,
            current_arousal: y,
            target_valence: self.state.target_x,
            target_arousal: self.state.target_y,
            radius,
            angle_degrees,
            oscillation_frequency: mappings.oscillation_frequency.evaluate(x, y),
            edge_smoothness: mappings.edge_smoothness.evaluate(x, y),
            projection_amplitude: mappings.projection_amplitude.evaluate(x, y),
            pulse_synchrony: mappings.pulse_synchrony.evaluate(x, y),
            wave_size_variation: mappings.wave_size_variation.evaluate(x, y),
            saturation: mappings.saturation.evaluate(x, y),
            animation_active,
            input_active,
            input_kind: self.selection.settings.input.kind,
            feedback_visible: !self.selection.settings.visual.hide_feedback
                && (self.selection.settings.visual.grid_enabled
                    || self.selection.settings.visual.flubber_enabled),
        };
        self.storage.write_sample(&sample)?;
        if self.sample_sequence.is_multiple_of(u64::from(
            self.selection.settings.experiment.sampling_frequency_hz,
        )) {
            self.sync_journal_state();
            self.storage.checkpoint()?;
        }
        Ok(())
    }

    fn write_event(&mut self, context: EventContext) -> ResearchResult<Vec<u8>> {
        self.event_sequence = self.event_sequence.saturating_add(1);
        let now = Instant::now();
        let event = ResearchEventV2 {
            schema: RESEARCH_EVENT_SCHEMA.to_owned(),
            version: 2,
            sequence: self.event_sequence,
            run_id: self.receipt.run_id.clone(),
            participant_id: self.participant.id.clone(),
            attempt_number: self.participant.attempt_number,
            settings_sha256: self.selection.settings_sha256.clone(),
            assignment_plan_sha256: self.selection.experiment_plan.plan_hash_sha256.clone(),
            protocol_plan_sha256: self
                .selection
                .protocol_plan
                .protocol_plan_hash_sha256
                .clone(),
            wall_time_utc: wall_time_now()?,
            monotonic_time_ns: monotonic_ns(self.monotonic_offset_ns, self.run_epoch, now),
            event_type: context.event_type,
            stimulus_identity: context.stimulus_identity,
            stimulus_position: context.stimulus_position,
            protocol_step_position: context.protocol_step_position,
            module_id: context.module_id,
            questionnaire_id: context.questionnaire_id,
            definition_sha256: context.definition_sha256,
            media_time_ms: context.media_time_ms,
            missed_slot_count: context.missed_slot_count,
            detail_code: context.detail_code,
        };
        let line = self.storage.write_event(&event)?;
        if let Some(lsl) = &self.lsl {
            lsl.push_marker(&event_marker(&event)?)?;
        }
        self.storage.journal.partial_event_count = self.event_sequence;
        self.storage.journal.last_monotonic_time_ns = event.monotonic_time_ns;
        self.sync_journal_state();
        self.storage.checkpoint()?;
        Ok(line)
    }

    fn sync_journal_state(&mut self) {
        self.storage.journal.partial_sample_count = self.sample_sequence;
        self.storage.journal.partial_event_count = self.event_sequence;
        self.storage.journal.submitted_response_count = self.submitted_responses.len() as u64;
        self.storage.journal.submitted_responses = self.submitted_responses.clone();
        self.storage.journal.safe_protocol_step_position = self.reducer.safe_protocol_position();
        self.storage.journal.active_questionnaire_draft = self.active_draft.clone();
    }

    fn reset_affect(&mut self) {
        let now = Instant::now();
        self.state = AffectState {
            current_x: 0.0,
            current_y: 0.0,
            target_x: 0.0,
            target_y: 0.0,
            anchor: now,
            input_active: false,
            impulse_active_until: now,
        };
    }

    fn answers_with_latency(
        &mut self,
        choices: Vec<PackageQuestionnaireChoiceV1>,
        observed_at: Instant,
    ) -> ResearchResult<Vec<QuestionnaireAnswerInputV1>> {
        let started_at = self.questionnaire_started_at.ok_or_else(|| {
            CommandError::invalid_contract(
                "The active questionnaire has no Rust-owned timing anchor.",
            )
        })?;
        let observed_latency_ms = duration_ms(observed_at.duration_since(started_at));
        choices
            .into_iter()
            .map(|choice| {
                let latency = *self
                    .questionnaire_answer_latency_ms
                    .entry(choice.item_id.clone())
                    .or_insert(observed_latency_ms);
                Ok(QuestionnaireAnswerInputV1 {
                    item_id: choice.item_id,
                    option_id: choice.option_id,
                    response_latency_ms: latency,
                })
            })
            .collect()
    }

    fn finish(&mut self, outcome: PackageFinishOutcome) -> ResearchResult<PackageFinalizeReceipt> {
        if outcome == PackageFinishOutcome::Completed
            && self.reducer.phase() != ProtocolPhase::CompleteReady
        {
            return Err(CommandError::invalid_contract(
                "A completed result requires every frozen protocol step to finish.",
            ));
        }
        self.input
            .set_run_accepting(&self.input_authority_id, false)
            .or_else(|error| {
                if self.reducer.phase() == ProtocolPhase::StimulusPlaying {
                    Err(error)
                } else {
                    Ok(())
                }
            })?;
        if let Some(fence) = self.media_fence.take() {
            let _ = self.media.stop(fence);
        }
        self.clock = None;
        self.state.input_active = false;
        self.reducer.begin_finalization()?;
        let completion_status = match outcome {
            PackageFinishOutcome::Completed => CompletionStatusV1::Completed,
            PackageFinishOutcome::StopEarly => CompletionStatusV1::Partial,
        };
        let terminal_type = match outcome {
            PackageFinishOutcome::Completed => ResearchEventTypeV2::SessionCompleted,
            PackageFinishOutcome::StopEarly => ResearchEventTypeV2::StoppedEarly,
        };
        let terminal_line = self.write_event(EventContext::session(
            terminal_type,
            Some(match outcome {
                PackageFinishOutcome::Completed => "protocol-complete".to_owned(),
                PackageFinishOutcome::StopEarly => "controlled-stop-early".to_owned(),
            }),
        ))?;
        self.sync_journal_state();
        let mut all_responses = self.submitted_responses.clone();
        if let Some(draft) = &self.active_draft {
            all_responses.extend(draft.responses.clone());
        }
        let outputs = self.storage.prepare_outputs(&all_responses)?;
        let finalized_at = wall_time_now()?;
        let submitted_counts = submitted_counts(&self.submitted_responses);
        let draft_count = self
            .active_draft
            .as_ref()
            .map_or(0, |draft| draft.responses.len() as u64);
        let manifest = ResearchRunManifestV4 {
            schema: RESEARCH_RUN_MANIFEST_SCHEMA.to_owned(),
            version: 4,
            run_id: self.receipt.run_id.clone(),
            experiment_id: self.selection.settings.experiment.id.clone(),
            participant_id: self.participant.id.clone(),
            participant_code: self.participant.code.clone(),
            age: self.participant.age,
            gender: self.participant.gender,
            handedness: self.participant.handedness,
            attempt_number: self.participant.attempt_number,
            session_stem: self.receipt.session_stem.clone(),
            completion_status,
            playback_mode: RunPlaybackModeV3::NativeGstPlay,
            playback_qualification: RunPlaybackQualificationV3::QualifiedNative,
            settings_sha256: self.selection.settings_sha256.clone(),
            assignment_plan_sha256: self.selection.experiment_plan.plan_hash_sha256.clone(),
            protocol_plan_sha256: self
                .selection
                .protocol_plan
                .protocol_plan_hash_sha256
                .clone(),
            stimuli: ordered_stimuli(&self.selection)?,
            protocol: RunProtocolSummaryV3 {
                safe_protocol_step_position: self.reducer.safe_protocol_position(),
                protocol_step_count: self.selection.protocol_plan.steps.len() as u32,
                questionnaire_definitions: definition_receipts(&self.selection),
                questionnaire_modules: module_receipts(
                    &self.selection,
                    self.reducer.safe_protocol_position(),
                    &submitted_counts,
                    self.active_draft.as_ref(),
                ),
                submitted_response_count: self.submitted_responses.len() as u64,
                draft_response_count: draft_count,
                submitted_responses_sha256: response_table_sha256(&self.submitted_responses)?,
                draft_responses_sha256: response_table_sha256(
                    self.active_draft
                        .as_ref()
                        .map(|draft| draft.responses.as_slice())
                        .unwrap_or(&[]),
                )?,
            },
            timing: RunTimingV3 {
                sample_rate_hz: self.selection.settings.experiment.sampling_frequency_hz,
                sample_count: self.sample_sequence,
                event_count: self.event_sequence,
                gap_event_count: self.storage.journal.gap_event_count,
                missed_slot_count: self.storage.journal.missed_slot_count,
                questionnaire_submitted_response_count: self.submitted_responses.len() as u64,
                questionnaire_draft_response_count: draft_count,
                started_at: self.storage.journal.started_at.clone(),
                finalized_at,
            },
            outputs,
            recovery: self.storage.journal.recovery.clone(),
            build: ResearchBuildV1 {
                platform: ResearchPlatformV1::TauriWindows,
                app_version: APP_VERSION.to_owned(),
                build_commit: BUILD_COMMIT.to_owned(),
            },
            experiment_package: self.storage.journal.package.clone(),
        };
        manifest.validate_bindings(&self.selection)?;
        self.storage.journal.pending_finalization = Some(PendingPackageFinalizationV1 {
            completion_status,
            manifest: manifest.clone(),
            terminal_event_sha256: format!("{:x}", Sha256::digest(&terminal_line)),
        });
        self.storage.persist_pending_finalization()?;
        self.storage.commit_manifest(&manifest)?;
        let files = self.storage.finalized_file_receipts()?;
        self.reducer.finish();
        self.terminal = true;
        {
            let mut status = lock(&self.status);
            status.active = false;
            status.phase = PackageRunPhase::Finished;
            status.write_healthy = true;
        }
        Ok(PackageFinalizeReceipt {
            run_id: self.receipt.run_id.clone(),
            participant_id: self.participant.id.clone(),
            attempt_number: self.participant.attempt_number,
            completion_status,
            output_receipt_id: self.receipt.output_receipt_id.clone(),
            files,
        })
    }

    fn interrupt(&mut self, reason: &str) -> ResearchResult<()> {
        if self.terminal {
            return Ok(());
        }
        let _ = self
            .input
            .set_run_accepting(&self.input_authority_id, false);
        if let Some(fence) = self.media_fence.take() {
            let _ = self.media.stop(fence);
        }
        self.clock = None;
        self.state.input_active = false;
        let mut persistence_error = self
            .write_event(EventContext::session(
                ResearchEventTypeV2::WriteInterrupted,
                Some(reason.to_owned()),
            ))
            .err();
        self.sync_journal_state();
        if let Err(error) = self.storage.checkpoint() {
            if persistence_error.is_none() {
                persistence_error = Some(error);
            }
        }
        self.reducer.fail();
        self.terminal = true;
        let mut status = lock(&self.status);
        status.active = false;
        status.run_id = None;
        status.participant_id = None;
        status.attempt_number = None;
        status.phase = PackageRunPhase::Failed;
        status.protocol_step_position = None;
        status.questionnaire = None;
        status.stimulus = None;
        status.interval_duration_ms = None;
        status.interval_remaining_ms = None;
        status.input_active = false;
        status.write_healthy = persistence_error.is_none();
        status.failure_code = Some(reason.to_owned());
        drop(status);
        persistence_error.map_or(Ok(()), Err)
    }

    fn publish_status(&self) {
        let now = Instant::now();
        let position = self
            .reducer
            .active_protocol_position(&self.selection.protocol_plan);
        let questionnaire = position
            .and_then(|position| {
                self.selection
                    .protocol_plan
                    .step(position)
                    .map(|step| (position, step))
            })
            .and_then(|(position, step)| match step {
                ProtocolStepV2::Questionnaire {
                    module_id,
                    questionnaire_id,
                    definition_sha256,
                    ..
                } => Some(PackageQuestionnaireStatus {
                    protocol_step_position: position,
                    module_id: module_id.clone(),
                    questionnaire_id: questionnaire_id.clone(),
                    definition_sha256: definition_sha256.clone(),
                    answers: self
                        .active_draft
                        .as_ref()
                        .filter(|draft| draft.protocol_step_position == position)
                        .map(|draft| {
                            draft
                                .responses
                                .iter()
                                .map(|response| {
                                    (response.item_id.clone(), response.option_id.clone())
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                }),
                _ => None,
            });
        let stimulus = position
            .and_then(|position| {
                self.selection
                    .protocol_plan
                    .step(position)
                    .map(|step| (position, step))
            })
            .and_then(|(position, step)| match step {
                ProtocolStepV2::Stimulus {
                    stimulus_position,
                    stimulus_id,
                    ..
                } => self.stimulus_definition(stimulus_id).ok().map(|stimulus| {
                    PackageStimulusStatus {
                        protocol_step_position: position,
                        stimulus_position: *stimulus_position,
                        stimulus_count: stimulus_count(&self.selection.protocol_plan),
                        stimulus_id: stimulus_id.clone(),
                        title: stimulus.title.clone(),
                        media_time_ms: self.media_position(),
                        duration_ms: stimulus.sample_identity().duration_ms,
                        prepared: self.media_fence.is_some(),
                    }
                }),
                _ => None,
            });
        let (interval_duration_ms, interval_remaining_ms) = position
            .and_then(|position| self.selection.protocol_plan.step(position))
            .and_then(|step| match step {
                ProtocolStepV2::Interval { duration_ms, .. } => Some((
                    Some(*duration_ms),
                    self.reducer.interval_remaining(now).map(duration_ms_f64),
                )),
                _ => None,
            })
            .unwrap_or((None, None));
        let mut status = lock(&self.status);
        status.phase = public_phase(self.reducer.phase());
        status.protocol_step_position = position;
        status.safe_protocol_step_position = self.reducer.safe_protocol_position();
        status.questionnaire = questionnaire;
        status.stimulus = stimulus;
        status.interval_duration_ms = interval_duration_ms;
        status.interval_remaining_ms = interval_remaining_ms;
        status.sample_count = self.sample_sequence;
        status.event_count = self.event_sequence;
        status.gap_event_count = self.storage.journal.gap_event_count;
        status.missed_slot_count = self.storage.journal.missed_slot_count;
        status.coalesced_input_update_count = self.coalesced_input_update_count;
        status.submitted_response_count = self.submitted_responses.len() as u64;
        status.draft_response_count = self
            .active_draft
            .as_ref()
            .map_or(0, |draft| draft.responses.len() as u64);
        status.current_valence = self.state.current_x;
        status.current_arousal = self.state.current_y;
        status.input_active = self.state.input_active || now < self.state.impulse_active_until;
    }

    fn active_position(&self) -> ResearchResult<u32> {
        self.reducer
            .active_protocol_position(&self.selection.protocol_plan)
            .ok_or_else(|| {
                CommandError::invalid_contract("The package protocol has no active step.")
            })
    }

    fn current_questionnaire_identity(&self) -> ResearchResult<(String, String, String)> {
        let position = self.active_position()?;
        match self.selection.protocol_plan.step(position) {
            Some(ProtocolStepV2::Questionnaire {
                module_id,
                questionnaire_id,
                definition_sha256,
                ..
            }) if self.reducer.phase() == ProtocolPhase::Questionnaire => Ok((
                module_id.clone(),
                questionnaire_id.clone(),
                definition_sha256.clone(),
            )),
            _ => Err(CommandError::invalid_contract(
                "Questionnaire answers require the active questionnaire step.",
            )),
        }
    }

    fn current_stimulus(&self) -> ResearchResult<(&str, u32, u32, SampleStimulusIdentityV1)> {
        let position = self.active_position()?;
        match self.selection.protocol_plan.step(position) {
            Some(ProtocolStepV2::Stimulus {
                stimulus_position,
                stimulus_id,
                ..
            }) => Ok((
                stimulus_id,
                *stimulus_position,
                position,
                self.stimulus_definition(stimulus_id)?.sample_identity(),
            )),
            _ => Err(CommandError::invalid_contract(
                "The active protocol step is not a stimulus.",
            )),
        }
    }

    fn active_stimulus_context(&self) -> ResearchResult<(SampleStimulusIdentityV1, u32, u32)> {
        let (_, stimulus_position, protocol_position, identity) = self.current_stimulus()?;
        Ok((identity, stimulus_position, protocol_position))
    }

    fn stimulus_definition(
        &self,
        stimulus_id: &str,
    ) -> ResearchResult<&crate::research_contracts::StimulusV1> {
        self.selection
            .settings
            .stimuli
            .items
            .iter()
            .find(|stimulus| stimulus.stimulus_id == stimulus_id)
            .ok_or_else(|| CommandError::invalid_contract("The frozen stimulus is unavailable."))
    }

    fn media_position(&self) -> f64 {
        self.media_status
            .as_ref()
            .and_then(|status| status.position_ms)
            .unwrap_or_default()
            .max(0.0)
    }

    fn require_current_media_status(
        &self,
        status: &NativeMediaStatusV1,
        fence: &NativeMediaCommandFenceV1,
    ) -> ResearchResult<()> {
        let workspace_file_id = self
            .current_stimulus()
            .ok()
            .and_then(|(stimulus_id, ..)| self.workspace_files.get(stimulus_id))
            .ok_or_else(|| CommandError::forbidden("The current package asset is unavailable."))?;
        self.require_media_binding(status, fence, workspace_file_id)
    }

    fn require_media_binding(
        &self,
        status: &NativeMediaStatusV1,
        fence: &NativeMediaCommandFenceV1,
        workspace_file_id: &str,
    ) -> ResearchResult<()> {
        if status.session_id.as_deref() != Some(fence.session_id.as_str())
            || status.generation != fence.generation
            || status.workspace_file_id.as_deref() != Some(workspace_file_id)
        {
            return Err(CommandError::forbidden(
                "Native GstPlay status crossed the frozen run or asset generation.",
            ));
        }
        Ok(())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        if !self.terminal {
            let _ = self.interrupt("native-worker-dropped");
        }
        self.input.end_run(&self.input_authority_id);
    }
}

fn run_worker(
    worker: ResearchResult<Worker>,
    receiver: Receiver<WorkerMessage>,
    startup: SyncSender<ResearchResult<()>>,
) {
    let mut worker = match worker {
        Ok(worker) => worker,
        Err(error) => {
            let _ = startup.send(Err(error));
            return;
        }
    };
    match worker.start() {
        Ok(()) => {
            let _ = startup.send(Ok(()));
        }
        Err(error) => {
            let _ = startup.send(Err(error));
            return;
        }
    }
    loop {
        if let Err(error) = worker.tick() {
            let _ = worker.interrupt(&error.code);
            return;
        }
        match receiver.recv_timeout(worker.timeout()) {
            Ok(WorkerMessage::PrepareMedia(viewport, reply)) => {
                let _ = reply.send(worker.prepare_media(viewport));
            }
            Ok(WorkerMessage::SetViewport(viewport, reply)) => {
                let _ = reply.send(worker.set_viewport(viewport));
            }
            Ok(WorkerMessage::Play(reply)) => {
                let _ = reply.send(worker.play());
            }
            Ok(WorkerMessage::Pause(reply)) => {
                let _ = reply.send(worker.pause());
            }
            Ok(WorkerMessage::QuestionnaireDraft(position, answers, reply)) => {
                let _ = reply.send(worker.checkpoint_questionnaire(position, answers));
            }
            Ok(WorkerMessage::QuestionnaireSubmit(position, answers, reply)) => {
                let _ = reply.send(worker.submit_questionnaire(position, answers));
            }
            Ok(WorkerMessage::Finish(outcome, reply)) => {
                let result = worker.finish(outcome);
                let terminal = result.is_ok();
                let _ = reply.send(result);
                if terminal {
                    return;
                }
                let _ = worker.interrupt("native-finalization-failed");
                return;
            }
            Ok(WorkerMessage::Interrupt(reply)) => {
                let result = worker.interrupt("application-interrupted");
                let _ = reply.send(result);
                return;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                let _ = worker.interrupt("command-channel-disconnected");
                return;
            }
        }
    }
}

struct EventContext {
    event_type: ResearchEventTypeV2,
    stimulus_identity: Option<SampleStimulusIdentityV1>,
    stimulus_position: Option<u32>,
    protocol_step_position: Option<u32>,
    module_id: Option<String>,
    questionnaire_id: Option<String>,
    definition_sha256: Option<String>,
    media_time_ms: Option<f64>,
    missed_slot_count: Option<u64>,
    detail_code: Option<String>,
}

impl EventContext {
    fn session(event_type: ResearchEventTypeV2, detail_code: Option<String>) -> Self {
        Self {
            event_type,
            stimulus_identity: None,
            stimulus_position: None,
            protocol_step_position: None,
            module_id: None,
            questionnaire_id: None,
            definition_sha256: None,
            media_time_ms: None,
            missed_slot_count: None,
            detail_code,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn stimulus(
        event_type: ResearchEventTypeV2,
        protocol_step_position: u32,
        stimulus_position: u32,
        stimulus_identity: SampleStimulusIdentityV1,
        media_time_ms: f64,
        missed_slot_count: Option<u64>,
        detail_code: Option<String>,
    ) -> Self {
        Self {
            event_type,
            stimulus_identity: Some(stimulus_identity),
            stimulus_position: Some(stimulus_position),
            protocol_step_position: Some(protocol_step_position),
            module_id: None,
            questionnaire_id: None,
            definition_sha256: None,
            media_time_ms: Some(media_time_ms),
            missed_slot_count,
            detail_code,
        }
    }

    fn questionnaire(
        event_type: ResearchEventTypeV2,
        protocol_step_position: u32,
        module_id: String,
        questionnaire_id: String,
        definition_sha256: String,
        detail_code: Option<String>,
    ) -> Self {
        Self {
            event_type,
            stimulus_identity: None,
            stimulus_position: None,
            protocol_step_position: Some(protocol_step_position),
            module_id: Some(module_id),
            questionnaire_id: Some(questionnaire_id),
            definition_sha256: Some(definition_sha256),
            media_time_ms: None,
            missed_slot_count: None,
            detail_code,
        }
    }
}

fn submitted_counts(responses: &[QuestionnaireResponseV1]) -> BTreeMap<u32, u64> {
    let mut counts = BTreeMap::new();
    for response in responses {
        *counts.entry(response.protocol_step_position).or_insert(0) += 1;
    }
    counts
}

fn ordered_stimuli(
    selection: &CompiledPackageSelectionV1,
) -> ResearchResult<Vec<SampleStimulusIdentityV1>> {
    selection
        .protocol_plan
        .steps
        .iter()
        .filter_map(|step| match step {
            ProtocolStepV2::Stimulus { stimulus_id, .. } => Some(stimulus_id),
            _ => None,
        })
        .map(|stimulus_id| {
            selection
                .settings
                .stimuli
                .items
                .iter()
                .find(|stimulus| stimulus.stimulus_id == *stimulus_id)
                .map(|stimulus| stimulus.sample_identity())
                .ok_or_else(|| {
                    CommandError::invalid_contract(
                        "A protocol stimulus is absent from frozen settings.",
                    )
                })
        })
        .collect()
}

fn stimulus_count(plan: &ResolvedProtocolPlanV2) -> u32 {
    plan.steps
        .iter()
        .filter(|step| matches!(step, ProtocolStepV2::Stimulus { .. }))
        .count() as u32
}

fn public_phase(phase: ProtocolPhase) -> PackageRunPhase {
    match phase {
        ProtocolPhase::Questionnaire => PackageRunPhase::Questionnaire,
        ProtocolPhase::StimulusReady => PackageRunPhase::StimulusReady,
        ProtocolPhase::StimulusPlaying => PackageRunPhase::Playing,
        ProtocolPhase::StimulusPaused => PackageRunPhase::Paused,
        ProtocolPhase::Interval => PackageRunPhase::Interval,
        ProtocolPhase::CompleteReady => PackageRunPhase::CompleteReady,
        ProtocolPhase::Finalizing => PackageRunPhase::Finalizing,
        ProtocolPhase::Finished => PackageRunPhase::Finished,
        ProtocolPhase::Failed => PackageRunPhase::Failed,
    }
}

fn duration_ms_f64(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn canonical_zero(value: f64) -> f64 {
    if value == 0.0 {
        0.0
    } else {
        value
    }
}

fn event_marker(event: &ResearchEventV2) -> ResearchResult<String> {
    let event_type = serde_json::to_value(event.event_type)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| CommandError::io("The native event marker could not be serialized."))?;
    Ok(format!("event:{event_type}"))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_phase_is_a_total_projection() {
        assert_eq!(
            public_phase(ProtocolPhase::StimulusPlaying),
            PackageRunPhase::Playing
        );
        assert_eq!(
            public_phase(ProtocolPhase::Questionnaire),
            PackageRunPhase::Questionnaire
        );
        assert_eq!(public_phase(ProtocolPhase::Failed), PackageRunPhase::Failed);
    }

    #[test]
    fn event_marker_is_semantic_and_lsl_safe() {
        let event = ResearchEventV2 {
            schema: RESEARCH_EVENT_SCHEMA.to_owned(),
            version: 2,
            sequence: 1,
            run_id: "00000000-0000-4000-8000-000000000000".to_owned(),
            participant_id: "P001".to_owned(),
            attempt_number: 1,
            settings_sha256: "a".repeat(64),
            assignment_plan_sha256: "b".repeat(64),
            protocol_plan_sha256: "c".repeat(64),
            wall_time_utc: "2026-09-10T12:00:00.000Z".to_owned(),
            monotonic_time_ns: "1".to_owned(),
            event_type: ResearchEventTypeV2::SessionStarted,
            stimulus_identity: None,
            stimulus_position: None,
            protocol_step_position: None,
            module_id: None,
            questionnaire_id: None,
            definition_sha256: None,
            media_time_ms: None,
            missed_slot_count: None,
            detail_code: None,
        };
        assert_eq!(event_marker(&event).unwrap(), "event:sessionStarted");
    }
}

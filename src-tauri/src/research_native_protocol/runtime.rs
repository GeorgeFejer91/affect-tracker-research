//! Historical package metadata and pending-finalization support.
//!
//! Participant execution uses the Runner HTML path. This module only keeps
//! strict package reads and the companion lease shared with Recorder and
//! current Runner sessions.

use super::compiler::{compile_package_selection, CompiledPackageSelectionV1};
use super::contracts::ProtocolStepV2;
use super::recovery::{list_bound_recoveries, load_bound_recovery, PackageRecoveryListingV1};
use super::storage::{finalize_pending_storage, FinalFileReceipt, FinalizePendingStorageRequest};
use crate::research_contracts::{
    canonical_json, canonical_sha256, CompletionStatusV1, StimulusSourceV1,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::parse_canonical_experiment_package_text;
use crate::research_input::ResearchInputService;
use crate::research_native_media::NativeMediaService;
use crate::research_workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use uuid::Uuid;

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
    companion_reserved: Arc<AtomicBool>,
    workspace: Arc<WorkspaceService>,
    gate: Mutex<()>,
}

pub(crate) struct CompanionLease(Arc<AtomicBool>);

impl Drop for CompanionLease {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl PackageProtocolRuntime {
    pub fn with_services(
        workspace: Arc<WorkspaceService>,
        _native_media: Arc<NativeMediaService>,
        _input: Arc<ResearchInputService>,
    ) -> Self {
        Self {
            companion_reserved: Arc::new(AtomicBool::new(false)),
            workspace,
            gate: Mutex::new(()),
        }
    }

    pub fn with_recorder(self, _recorder: Arc<crate::research_recorder::RecorderService>) -> Self {
        self
    }

    pub fn while_idle<T>(
        &self,
        operation: impl FnOnce() -> ResearchResult<T>,
    ) -> ResearchResult<T> {
        let _gate = lock(&self.gate);
        if self.companion_reserved.load(Ordering::Acquire) {
            return Err(CommandError::run_active());
        }
        operation()
    }

    pub(crate) fn begin_companion<T>(
        &self,
        operation: impl FnOnce(CompanionLease) -> ResearchResult<T>,
    ) -> ResearchResult<T> {
        let _gate = lock(&self.gate);
        if self.companion_reserved.swap(true, Ordering::AcqRel) {
            return Err(CommandError::run_active());
        }
        operation(CompanionLease(Arc::clone(&self.companion_reserved)))
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
            native_start_ready: false,
        })
    }

    pub fn list_recoveries(
        &self,
        workspace_id: &str,
        experiment_package_source_text: &str,
    ) -> ResearchResult<PackageRecoveryListingV1> {
        let loaded = parse_canonical_experiment_package_text(experiment_package_source_text)?;
        self.workspace
            .with_workspace(workspace_id, |root, _| list_bound_recoveries(root, &loaded))
    }

    pub fn finalize_recovery(
        &self,
        request: FinalizePackageRecoveryRequest,
    ) -> ResearchResult<PackageFinalizeReceipt> {
        let _gate = lock(&self.gate);
        if self.companion_reserved.load(Ordering::Acquire) {
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

    pub fn status(&self) -> PackageRunStatus {
        PackageRunStatus::idle()
    }

    pub fn shutdown(&self) {}
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

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

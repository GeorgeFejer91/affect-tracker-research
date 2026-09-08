use crate::research_contracts::{
    DirectionV1, InputBindingV1, ResearchSettingsV1, ResolvedAssignmentPlanV1,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_input::{
    NativeInputCapability, NativeInputRegionRequest, NativeInputStatus, ResearchInputService,
};
use crate::research_lsl::{probe_readiness, LslReadiness};
use crate::research_native_media::{NativeMediaCapability, NativeMediaService, PlaybackMode};
use crate::research_platform::{require_native_acquisition, NATIVE_ACQUISITION_SUPPORTED};
use crate::research_protocol::{
    native_protocol_capability, native_protocol_runtime_unavailable, protocol_preflight,
    NativeProtocolCapability, ProtocolPreflightReceipt, ResearchSettingsDocument,
    ResearchSettingsV2, ResolvedProtocolPlanV1,
};
use crate::research_runtime::{
    FinalizeReceipt, FinalizeRecoveryRequest, FinishOutcome, MediaPlaybackFailureReceipt,
    MediaPlaybackFailureReport, ParticipantTileStatus, RecoveryListing, ResearchRuntime,
    ResumeRunRequest, RunStatus, StartRunReceipt, StartRunRequest, StimulusStateUpdate,
    TransientParticipant, WorkspaceFileBinding,
};
use crate::research_workspace::{
    source_capabilities, AssignmentPlanExportReceipt, DecodeAttestationRequest,
    ImportSelectionKind, MediaUrlReceipt, RescanResult, SavedSettingsReceipt,
    ScannedStimulusSummary, SourceCapabilities, StorageReadiness, WorkspaceService,
    WorkspaceStatus,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn authorize(window: &WebviewWindow) -> ResearchResult<()> {
    if window.label() != "research" {
        return Err(CommandError::forbidden(
            "This command is restricted to the Affect Research window.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn research_source_capabilities(window: WebviewWindow) -> ResearchResult<SourceCapabilities> {
    authorize(&window)?;
    Ok(source_capabilities())
}

#[tauri::command]
pub fn research_native_media_capability(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
) -> ResearchResult<NativeMediaCapability> {
    authorize(&window)?;
    Ok(native_media.capability())
}

#[tauri::command]
pub fn research_native_protocol_capability(
    window: WebviewWindow,
) -> ResearchResult<NativeProtocolCapability> {
    authorize(&window)?;
    Ok(native_protocol_capability())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolPreflightRequest {
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
}

#[tauri::command]
pub fn research_protocol_preflight(
    window: WebviewWindow,
    request: ProtocolPreflightRequest,
) -> ResearchResult<ProtocolPreflightReceipt> {
    authorize(&window)?;
    protocol_preflight(
        request.research_settings,
        request.assignment_plan,
        request.resolved_protocol_plan,
    )
}

#[tauri::command]
pub fn research_input_capability(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
) -> ResearchResult<NativeInputCapability> {
    authorize(&window)?;
    Ok(input.capability())
}

#[tauri::command]
pub fn research_input_set_region(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
    region: NativeInputRegionRequest,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    let origin = window.inner_position().map_err(CommandError::io)?;
    let size = window.inner_size().map_err(CommandError::io)?;
    input.set_region(
        region,
        f64::from(origin.x),
        f64::from(origin.y),
        f64::from(size.width),
        f64::from(size.height),
    )
}

#[tauri::command]
pub fn research_input_begin_test(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
    binding: InputBindingV1,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    input.begin_test(binding)
}

#[tauri::command]
pub fn research_input_begin_capture(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
    binding: InputBindingV1,
    direction: DirectionV1,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    input.begin_capture(binding, direction)
}

#[tauri::command]
pub fn research_input_status(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    Ok(input.status())
}

#[tauri::command]
pub fn research_input_cancel_setup(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    Ok(input.cancel_setup())
}

#[tauri::command]
pub fn research_workspace_status(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
) -> ResearchResult<WorkspaceStatus> {
    authorize(&window)?;
    Ok(workspace.status())
}

#[tauri::command]
pub async fn research_choose_workspace(
    window: WebviewWindow,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceService>>,
) -> ResearchResult<WorkspaceStatus> {
    authorize(&window)?;
    let Some(selection) = app.dialog().file().blocking_pick_folder() else {
        return Ok(workspace.status());
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The selected workspace is not a local folder."))?;
    workspace.select(path)
}

#[tauri::command]
pub async fn research_load_settings(
    window: WebviewWindow,
    app: AppHandle,
) -> ResearchResult<Option<LoadedSettingsReceipt>> {
    authorize(&window)?;
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Affect Research settings", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The selected settings file is not local."))?;
    let metadata = fs::metadata(&path).map_err(CommandError::io)?;
    if !metadata.is_file() || metadata.len() > 5 * 1024 * 1024 {
        return Err(CommandError::invalid_contract(
            "The settings file is unavailable or exceeds 5 MiB.",
        ));
    }
    let bytes = fs::read(path).map_err(CommandError::io)?;
    Ok(Some(decode_settings_bytes(&bytes)?))
}

fn decode_settings_bytes(bytes: &[u8]) -> ResearchResult<LoadedSettingsReceipt> {
    if let Ok(settings) = serde_json::from_slice::<ResearchSettingsV2>(bytes) {
        return Ok(LoadedSettingsReceipt {
            settings: Some(ResearchSettingsDocument::V2(
                settings.normalize_and_validate()?,
            )),
            legacy_settings: None,
            report: SettingsLoadReport::research_v2(),
        });
    }
    if let Ok(settings) = serde_json::from_slice::<ResearchSettingsV1>(bytes) {
        return Ok(LoadedSettingsReceipt {
            settings: Some(ResearchSettingsDocument::V1(
                settings.normalize_and_validate()?,
            )),
            legacy_settings: None,
            report: SettingsLoadReport::research_v1(),
        });
    }
    if bytes.len() > 1_000_000 {
        return Err(CommandError::invalid_contract(
            "Portable legacy settings exceed the one-megabyte explicit-import limit.",
        ));
    }
    let legacy: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| {
        CommandError::invalid_contract(
            "The selected file is neither ResearchSettingsV2/ResearchSettingsV1 nor bounded portable version 1 JSON.",
        )
    })?;
    if legacy.get("schema").is_some() {
        return Err(CommandError::invalid_contract(
            "A malformed Research settings document cannot be reinterpreted as portable legacy settings.",
        ));
    }
    if !legacy.is_object() || legacy.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err(CommandError::invalid_contract(
            "Explicit legacy import requires one portable settings version-1 object.",
        ));
    }
    // Canonicalization rejects unsupported values and bounds the renderer payload.
    crate::research_contracts::canonical_json(&legacy, &[])?;
    Ok(LoadedSettingsReceipt {
        settings: None,
        legacy_settings: Some(legacy),
        report: SettingsLoadReport::legacy(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettingsReceipt {
    pub settings: Option<ResearchSettingsDocument>,
    pub legacy_settings: Option<serde_json::Value>,
    pub report: SettingsLoadReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadReport {
    pub schema: &'static str,
    pub version: u32,
    pub source_kind: &'static str,
    pub requires_explicit_import: bool,
    pub defaults: Vec<String>,
    pub discarded: Vec<String>,
}

impl SettingsLoadReport {
    fn research_v1() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "researchV1",
            requires_explicit_import: false,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }

    fn research_v2() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "researchV2",
            requires_explicit_import: false,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }

    fn legacy() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "portableLegacyV1",
            requires_explicit_import: true,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }
}

#[tauri::command]
pub async fn research_rescan_stimuli(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
) -> ResearchResult<RescanResult> {
    authorize(&window)?;
    workspace.rescan(&workspace_id)
}

#[tauri::command]
pub async fn research_import_stimuli(
    window: WebviewWindow,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    selection_kind: ImportSelectionKind,
) -> ResearchResult<Option<RescanResult>> {
    authorize(&window)?;
    let selections = match selection_kind {
        ImportSelectionKind::Videos => app
            .dialog()
            .file()
            .add_filter(
                "Video stimuli",
                &["mp4", "webm", "mov", "m4v", "avi", "mkv"],
            )
            .blocking_pick_files(),
        ImportSelectionKind::Folder => app
            .dialog()
            .file()
            .blocking_pick_folder()
            .map(|selection| vec![selection]),
    };
    let Some(selections) = selections else {
        return Ok(None);
    };
    let paths = selections
        .into_iter()
        .map(|selection| {
            selection.into_path().map_err(|_| {
                CommandError::forbidden("An imported selection is not a local filesystem item.")
            })
        })
        .collect::<ResearchResult<Vec<_>>>()?;
    Ok(Some(workspace.import_paths(&workspace_id, paths)?))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn research_workspace_media_url(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    workspace_file_id: String,
    sha256: String,
    byte_length: u64,
    mime_type: String,
) -> ResearchResult<MediaUrlReceipt> {
    authorize(&window)?;
    workspace.issue_media_url(
        &workspace_id,
        &workspace_file_id,
        &sha256,
        byte_length,
        &mime_type,
    )
}

#[tauri::command]
pub fn research_attest_workspace_decode(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    attestation: DecodeAttestationRequest,
) -> ResearchResult<ScannedStimulusSummary> {
    authorize(&window)?;
    workspace.attest_workspace_decode(attestation)
}

#[tauri::command]
pub fn research_save_settings(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    settings: ResearchSettingsDocument,
) -> ResearchResult<SavedSettingsReceipt> {
    authorize(&window)?;
    workspace.save_settings_document(&workspace_id, settings)
}

#[tauri::command]
pub fn research_storage_readiness(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    required_bytes: u64,
) -> ResearchResult<StorageReadiness> {
    authorize(&window)?;
    workspace.storage_readiness(&workspace_id, required_bytes)
}

#[tauri::command]
pub fn research_export_assignment_plan(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    settings: ResearchSettingsV1,
    assignment_plan: ResolvedAssignmentPlanV1,
) -> ResearchResult<AssignmentPlanExportReceipt> {
    authorize(&window)?;
    workspace.export_assignment_plan(&workspace_id, settings, assignment_plan)
}

#[tauri::command]
pub fn research_lsl_readiness(
    window: WebviewWindow,
    settings: ResearchSettingsV1,
) -> ResearchResult<LslReadiness> {
    authorize(&window)?;
    let settings = settings.normalize_and_validate()?;
    Ok(probe_readiness(
        &settings.advanced.lsl,
        settings.experiment.sampling_frequency_hz,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartProtocolRunRequest {
    pub workspace_id: String,
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
    pub participant: TransientParticipant,
    pub workspace_files: Vec<WorkspaceFileBinding>,
    pub rerun_confirmed: bool,
    pub input_test_receipt_id: String,
    pub playback_mode: PlaybackMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeProtocolRunRequest {
    pub workspace_id: String,
    pub recovery_id: String,
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
    pub workspace_files: Vec<WorkspaceFileBinding>,
    pub input_test_receipt_id: String,
    pub playback_mode: PlaybackMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalizeProtocolRecoveryRequest {
    pub workspace_id: String,
    pub recovery_id: String,
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
}

#[tauri::command]
pub fn research_start_protocol_run(
    window: WebviewWindow,
    request: StartProtocolRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let StartProtocolRunRequest {
        workspace_id,
        research_settings,
        assignment_plan,
        resolved_protocol_plan,
        participant,
        workspace_files,
        rerun_confirmed,
        input_test_receipt_id,
        playback_mode,
    } = request;
    validate_protocol_run_envelope(
        &workspace_id,
        &input_test_receipt_id,
        playback_mode,
        &workspace_files,
        &research_settings,
        &resolved_protocol_plan,
    )?;
    let _rerun_was_explicitly_confirmed = rerun_confirmed;
    if participant.participant_id != resolved_protocol_plan.participant_id {
        return Err(CommandError::invalid_contract(
            "The transient participant does not match the resolved questionnaire protocol.",
        ));
    }
    if participant.age == 0 || participant.age > 120 || participant.participant_code.is_empty() {
        return Err(CommandError::invalid_contract(
            "The transient participant metadata is invalid.",
        ));
    }
    let _demographic_codes = (participant.gender, participant.handedness);
    protocol_preflight(research_settings, assignment_plan, resolved_protocol_plan)?;
    Err(native_protocol_runtime_unavailable())
}

#[tauri::command]
pub fn research_resume_protocol_run(
    window: WebviewWindow,
    request: ResumeProtocolRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let ResumeProtocolRunRequest {
        workspace_id,
        recovery_id,
        research_settings,
        assignment_plan,
        resolved_protocol_plan,
        workspace_files,
        input_test_receipt_id,
        playback_mode,
    } = request;
    validate_protocol_run_envelope(
        &workspace_id,
        &input_test_receipt_id,
        playback_mode,
        &workspace_files,
        &research_settings,
        &resolved_protocol_plan,
    )?;
    validate_canonical_uuid(&recovery_id, "recoveryId")?;
    protocol_preflight(research_settings, assignment_plan, resolved_protocol_plan)?;
    Err(native_protocol_runtime_unavailable())
}

#[tauri::command]
pub fn research_finalize_protocol_recovery(
    window: WebviewWindow,
    request: FinalizeProtocolRecoveryRequest,
) -> ResearchResult<FinalizeReceipt> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let FinalizeProtocolRecoveryRequest {
        workspace_id,
        recovery_id,
        research_settings,
        assignment_plan,
        resolved_protocol_plan,
    } = request;
    validate_canonical_uuid(&workspace_id, "workspaceId")?;
    validate_canonical_uuid(&recovery_id, "recoveryId")?;
    protocol_preflight(research_settings, assignment_plan, resolved_protocol_plan)?;
    Err(native_protocol_runtime_unavailable())
}

fn validate_protocol_run_envelope(
    workspace_id: &str,
    input_test_receipt_id: &str,
    playback_mode: PlaybackMode,
    workspace_files: &[WorkspaceFileBinding],
    research_settings: &ResearchSettingsV2,
    protocol_plan: &ResolvedProtocolPlanV1,
) -> ResearchResult<()> {
    validate_canonical_uuid(workspace_id, "workspaceId")?;
    validate_canonical_uuid(input_test_receipt_id, "inputTestReceiptId")?;
    if playback_mode == PlaybackMode::NativeLibvlc {
        return Err(CommandError::invalid_contract(
            "The retired nativeLibvlc mode cannot start a questionnaire protocol.",
        ));
    }
    if workspace_files.is_empty() || workspace_files.len() > crate::research_contracts::MAX_STIMULI
    {
        return Err(CommandError::invalid_contract(
            "workspaceFiles must bind every assigned stimulus within supported bounds.",
        ));
    }
    let mut stimulus_ids = std::collections::BTreeSet::new();
    let mut file_ids = std::collections::BTreeSet::new();
    for binding in workspace_files {
        if binding.stimulus_id.is_empty()
            || !binding.workspace_file_id.starts_with("wf-")
            || binding.workspace_file_id.len() != 27
            || !binding.workspace_file_id[3..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            || !stimulus_ids.insert(binding.stimulus_id.as_str())
            || !file_ids.insert(binding.workspace_file_id.as_str())
        {
            return Err(CommandError::invalid_contract(
                "workspaceFiles contains an invalid or repeated opaque binding.",
            ));
        }
    }
    let expected_stimulus_ids = protocol_plan
        .steps
        .iter()
        .filter_map(|step| match step {
            crate::research_protocol::ProtocolStepV1::Stimulus { stimulus_id, .. } => {
                Some(stimulus_id.as_str())
            }
            crate::research_protocol::ProtocolStepV1::Questionnaire { .. } => None,
        })
        .collect::<std::collections::BTreeSet<_>>();
    for stimulus_id in &expected_stimulus_ids {
        let stimulus = research_settings
            .stimuli
            .items
            .iter()
            .find(|stimulus| stimulus.stimulus_id == *stimulus_id)
            .ok_or_else(|| {
                CommandError::invalid_contract(
                    "The resolved protocol references an unknown stimulus.",
                )
            })?;
        if !matches!(
            &stimulus.source,
            crate::research_contracts::StimulusSourceV1::WorkspaceFile { .. }
        ) {
            return Err(CommandError::unsupported_source(
                "Questionnaire-aware native Start currently accepts only workspace-file stimuli.",
            ));
        }
    }
    if stimulus_ids != expected_stimulus_ids {
        return Err(CommandError::invalid_contract(
            "workspaceFiles must exactly equal the selected participant protocol stimuli.",
        ));
    }
    Ok(())
}

fn validate_canonical_uuid(value: &str, label: &str) -> ResearchResult<()> {
    match uuid::Uuid::parse_str(value) {
        Ok(uuid) if uuid.to_string() == value => Ok(()),
        _ => Err(CommandError::invalid_contract(format!(
            "{label} must be a canonical UUID."
        ))),
    }
}

#[tauri::command]
pub fn research_start_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    request: StartRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    runtime.start_run(request)
}

#[tauri::command]
pub fn research_resume_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    request: ResumeRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    runtime.resume_run(request)
}

#[tauri::command]
pub fn research_finalize_recovery(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    request: FinalizeRecoveryRequest,
) -> ResearchResult<FinalizeReceipt> {
    authorize(&window)?;
    runtime.finalize_recovery(request)
}

#[tauri::command]
pub fn research_run_status(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
) -> ResearchResult<RunStatus> {
    authorize(&window)?;
    Ok(runtime.status())
}

#[tauri::command]
pub fn research_set_stimulus_state(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    update: StimulusStateUpdate,
) -> ResearchResult<()> {
    authorize(&window)?;
    runtime.set_webview_stimulus_state(update)
}

#[tauri::command]
pub fn research_finish_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    run_id: String,
    outcome: FinishOutcome,
) -> ResearchResult<FinalizeReceipt> {
    authorize(&window)?;
    runtime.finish(&run_id, outcome)
}

#[tauri::command]
pub fn research_report_media_failure(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    report: MediaPlaybackFailureReport,
) -> ResearchResult<MediaPlaybackFailureReceipt> {
    authorize(&window)?;
    runtime.report_webview_media_failure(report)
}

#[tauri::command]
pub fn research_recoveries(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    workspace_id: String,
) -> ResearchResult<RecoveryListing> {
    authorize(&window)?;
    runtime.list_recoveries(&workspace_id)
}

#[tauri::command]
pub fn research_participant_states(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    workspace_id: String,
    settings: ResearchSettingsV1,
) -> ResearchResult<Vec<ParticipantTileStatus>> {
    authorize(&window)?;
    runtime.participant_states(&workspace_id, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_surface_contains_no_path_argument_types() {
        // Keep this assertion near the boundary as a visible security invariant.
        let names = [
            "research_choose_workspace",
            "research_source_capabilities",
            "research_native_media_capability",
            "research_native_protocol_capability",
            "research_protocol_preflight",
            "research_input_capability",
            "research_input_set_region",
            "research_input_begin_test",
            "research_input_begin_capture",
            "research_input_status",
            "research_input_cancel_setup",
            "research_workspace_status",
            "research_load_settings",
            "research_rescan_stimuli",
            "research_import_stimuli",
            "research_workspace_media_url",
            "research_attest_workspace_decode",
            "research_save_settings",
            "research_storage_readiness",
            "research_export_assignment_plan",
            "research_lsl_readiness",
            "research_start_protocol_run",
            "research_resume_protocol_run",
            "research_finalize_protocol_recovery",
            "research_start_run",
            "research_resume_run",
            "research_finalize_recovery",
            "research_run_status",
            "research_set_stimulus_state",
            "research_finish_run",
            "research_report_media_failure",
            "research_recoveries",
            "research_participant_states",
        ];
        assert!(names.iter().all(|name| name.starts_with("research_")));
    }

    #[test]
    fn settings_loader_distinguishes_strict_research_from_explicit_legacy() {
        let research = crate::research_contracts::tests::default_settings()
            .normalize_and_validate()
            .unwrap();
        let receipt = decode_settings_bytes(
            &crate::research_contracts::canonical_json(&research, &[]).unwrap(),
        )
        .unwrap();
        assert!(receipt.settings.is_some());
        assert!(receipt.legacy_settings.is_none());
        assert!(!receipt.report.requires_explicit_import);
        assert_eq!(receipt.report.source_kind, "researchV1");

        let v2 = ResearchSettingsV2 {
            schema: crate::research_contracts::RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 2,
            experiment: research.experiment.clone(),
            stimuli: research.stimuli.clone(),
            input: research.input.clone(),
            visual: research.visual.clone(),
            advanced: research.advanced.clone(),
            output: research.output.clone(),
            questionnaires: crate::research_protocol::QuestionnaireSettingsV2 {
                algorithm_version: crate::research_protocol::QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION
                    .to_owned(),
                definitions: Vec::new(),
                modules: Vec::new(),
            },
        }
        .normalize_and_validate()
        .unwrap();
        let v2_receipt =
            decode_settings_bytes(&crate::research_contracts::canonical_json(&v2, &[]).unwrap())
                .unwrap();
        assert!(matches!(
            v2_receipt.settings,
            Some(ResearchSettingsDocument::V2(_))
        ));
        assert_eq!(v2_receipt.report.source_kind, "researchV2");

        let legacy = decode_settings_bytes(br#"{"version":1,"stepSize":0.2}"#).unwrap();
        assert!(legacy.settings.is_none());
        assert!(legacy.legacy_settings.is_some());
        assert!(legacy.report.requires_explicit_import);

        let malformed_research =
            br#"{"schema":"affect-research-settings","version":1,"unknown":true}"#;
        assert!(decode_settings_bytes(malformed_research).is_err());
    }
}

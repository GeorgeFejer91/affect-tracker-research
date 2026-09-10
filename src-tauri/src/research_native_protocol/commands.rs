//! Thin Tauri adapter for the Rust-owned package protocol runtime.

use super::recovery::PackageRecoveryListingV1;
use super::runtime::{
    FinalizePackageRecoveryRequest, PackageFinalizeReceipt, PackageFinishOutcome,
    PackagePreflightReceiptV1, PackagePreflightRequest, PackageProtocolRuntime,
    PackageQuestionnaireChoiceV1, PackageRunStatus, PackageStartRunReceipt,
    ResumePackageRunRequest, StartPackageRunRequest,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_native_media::{
    NativeMediaService, NativeMediaStatusV1, NativeMediaViewportCssV1, NativeMediaViewportPxV1,
};
use crate::research_platform::NATIVE_ACQUISITION_SUPPORTED;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativePackageProtocolCapabilityV1 {
    pub schema: &'static str,
    pub version: u32,
    pub backend: &'static str,
    pub rust_owned_protocol: bool,
    pub package_v1_compilation_ready: bool,
    pub protocol_plan_v2_ready: bool,
    pub questionnaire_drafts_ready: bool,
    pub recovery_journal_ready: bool,
    pub manifest_v4_ready: bool,
    pub native_start_ready: bool,
    pub reason_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageRunIdentityRequest {
    pub run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageMediaViewportRequest {
    pub run_id: String,
    pub viewport: NativeMediaViewportCssV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageQuestionnaireAnswersRequest {
    pub run_id: String,
    pub protocol_step_position: u32,
    pub answers: Vec<PackageQuestionnaireChoiceV1>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinishPackageRunRequest {
    pub run_id: String,
    pub outcome: PackageFinishOutcome,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageRecoveryQueryV1 {
    pub workspace_id: String,
    pub experiment_package_source_text: String,
}

#[tauri::command]
pub fn research_package_protocol_capability(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
) -> ResearchResult<NativePackageProtocolCapabilityV1> {
    authorize(&window)?;
    let media = native_media.capability();
    let native_start_ready =
        NATIVE_ACQUISITION_SUPPORTED && media.qualified_start_available && media.player_actor_ready;
    Ok(NativePackageProtocolCapabilityV1 {
        schema: "affect-research-native-package-protocol-capability",
        version: 1,
        backend: "rust-gstplay",
        rust_owned_protocol: true,
        package_v1_compilation_ready: true,
        protocol_plan_v2_ready: true,
        questionnaire_drafts_ready: true,
        recovery_journal_ready: true,
        manifest_v4_ready: true,
        native_start_ready,
        reason_code: if native_start_ready {
            "ready".to_owned()
        } else if !NATIVE_ACQUISITION_SUPPORTED {
            "tauri-windows-required".to_owned()
        } else {
            media.reason_code
        },
    })
}

#[tauri::command]
pub fn research_start_package_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: StartPackageRunRequest,
) -> ResearchResult<PackageStartRunReceipt> {
    authorize(&window)?;
    runtime.start(request)
}

#[tauri::command]
pub fn research_package_preflight(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackagePreflightRequest,
) -> ResearchResult<PackagePreflightReceiptV1> {
    authorize(&window)?;
    runtime.preflight(request)
}

#[tauri::command]
pub fn research_resume_package_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: ResumePackageRunRequest,
) -> ResearchResult<PackageStartRunReceipt> {
    authorize(&window)?;
    runtime.resume(request)
}

#[tauri::command]
pub fn research_package_recoveries(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageRecoveryQueryV1,
) -> ResearchResult<PackageRecoveryListingV1> {
    authorize(&window)?;
    runtime.list_recoveries(
        &request.workspace_id,
        &request.experiment_package_source_text,
    )
}

#[tauri::command]
pub fn research_finalize_package_recovery(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: FinalizePackageRecoveryRequest,
) -> ResearchResult<PackageFinalizeReceipt> {
    authorize(&window)?;
    runtime.finalize_recovery(request)
}

#[tauri::command]
pub fn research_package_run_status(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
) -> ResearchResult<PackageRunStatus> {
    authorize(&window)?;
    Ok(runtime.status())
}

#[tauri::command]
pub fn research_package_prepare_media(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageMediaViewportRequest,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    let viewport = physical_media_viewport(&window, request.viewport)?;
    runtime.prepare_media(&request.run_id, viewport)
}

#[tauri::command]
pub fn research_package_set_media_viewport(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageMediaViewportRequest,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    let viewport = physical_media_viewport(&window, request.viewport)?;
    runtime.set_viewport(&request.run_id, viewport)
}

#[tauri::command]
pub fn research_package_play(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageRunIdentityRequest,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    runtime.play(&request.run_id)
}

#[tauri::command]
pub fn research_package_pause(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageRunIdentityRequest,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    runtime.pause(&request.run_id)
}

#[tauri::command]
pub fn research_package_questionnaire_draft(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageQuestionnaireAnswersRequest,
) -> ResearchResult<()> {
    authorize(&window)?;
    runtime.questionnaire_draft(
        &request.run_id,
        request.protocol_step_position,
        request.answers,
    )
}

#[tauri::command]
pub fn research_package_questionnaire_submit(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: PackageQuestionnaireAnswersRequest,
) -> ResearchResult<()> {
    authorize(&window)?;
    runtime.questionnaire_submit(
        &request.run_id,
        request.protocol_step_position,
        request.answers,
    )
}

#[tauri::command]
pub fn research_finish_package_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: FinishPackageRunRequest,
) -> ResearchResult<PackageFinalizeReceipt> {
    authorize(&window)?;
    runtime.finish(&request.run_id, request.outcome)
}

fn physical_media_viewport(
    window: &WebviewWindow,
    viewport: NativeMediaViewportCssV1,
) -> ResearchResult<NativeMediaViewportPxV1> {
    let scale_factor = window.scale_factor().map_err(CommandError::io)?;
    let size = window.inner_size().map_err(CommandError::io)?;
    viewport.to_physical(scale_factor, size.width, size.height)
}

fn authorize(window: &WebviewWindow) -> ResearchResult<()> {
    if window.label() != "research" {
        return Err(CommandError::forbidden(
            "This command is restricted to the Affect Research window.",
        ));
    }
    Ok(())
}

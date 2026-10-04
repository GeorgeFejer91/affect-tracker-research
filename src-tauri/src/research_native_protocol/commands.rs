//! Tauri adapter for historical package metadata and pending finalization.

use super::recovery::PackageRecoveryListingV1;
use super::runtime::{
    FinalizePackageRecoveryRequest, PackageFinalizeReceipt, PackagePreflightReceiptV1,
    PackagePreflightRequest, PackageProtocolRuntime, PackageRunStatus,
};
use crate::research_error::{CommandError, ResearchResult};
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
pub struct PackageRecoveryQueryV1 {
    pub workspace_id: String,
    pub experiment_package_source_text: String,
}

#[tauri::command]
pub fn research_package_protocol_capability(
    window: WebviewWindow,
) -> ResearchResult<NativePackageProtocolCapabilityV1> {
    authorize(&window)?;
    Ok(NativePackageProtocolCapabilityV1 {
        schema: "affect-research-native-package-protocol-capability",
        version: 1,
        backend: "html-video",
        rust_owned_protocol: true,
        package_v1_compilation_ready: true,
        protocol_plan_v2_ready: true,
        questionnaire_drafts_ready: true,
        recovery_journal_ready: true,
        manifest_v4_ready: true,
        native_start_ready: false,
        reason_code: "legacy-package-execution-retired".to_owned(),
    })
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

fn authorize(window: &WebviewWindow) -> ResearchResult<()> {
    if window.label() != "research" {
        return Err(CommandError::forbidden(
            "This command is restricted to the Affect Research window.",
        ));
    }
    Ok(())
}

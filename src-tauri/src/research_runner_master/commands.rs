use super::runtime::{MasterAction, MasterRuntime, MasterStartRequest, MasterStatus};
use super::{MasterPlan, MasterSelector, PreparedMaster};
use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_native_media::NativeMediaService;
use crate::research_native_protocol::runtime::PackageProtocolRuntime;
use crate::research_workspace::{RescanResult, WorkspaceService};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterPreflightRequest {
    pub workspace_id: String,
    pub source_text: String,
    pub participant_id: String,
    pub selector: MasterSelector,
}

fn authorize(window: &WebviewWindow) -> ResearchResult<()> {
    if window.label() != "research"
        || window.try_state::<DesktopRole>().as_deref() != Some(&DesktopRole::Runner)
    {
        return Err(CommandError::forbidden(
            "Only Experiment Runner owns master session selection.",
        ));
    }
    Ok(())
}

/// Pure native interpretation. Never grants media/input, creates attempts or
/// claims execution. The caller may compare it with the independent JS plan.
#[tauri::command]
pub async fn research_runner_master_plan(
    window: WebviewWindow,
    source_text: String,
    participant_id: String,
    selector: MasterSelector,
) -> ResearchResult<MasterPlan> {
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        PreparedMaster::read(&source_text, &participant_id, selector).map(|p| p.plan)
    })
    .await
    .map_err(|_| CommandError::forbidden("Master interpretation did not finish."))?
}

#[tauri::command]
pub async fn research_runner_master_rescan(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    workspace_id: String,
    source_text: String,
) -> ResearchResult<RescanResult> {
    authorize(&window)?;
    crate::research_planner_recipe::parse_planner_recipe_bytes(source_text.as_bytes())?;
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| workspace.rescan_planner_videos(&workspace_id))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master media scan did not finish."))?
}

#[tauri::command]
pub async fn research_runner_master_preflight(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    media: State<'_, Arc<NativeMediaService>>,
    request: MasterPreflightRequest,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    let media = Arc::clone(&media);
    tauri::async_runtime::spawn_blocking(move || runtime.while_idle(|| {
        let prepared = PreparedMaster::read(&request.source_text, &request.participant_id, request.selector)?;
        let bindings = workspace.validate_runner_video_catalogue(&request.workspace_id, &prepared.loaded.recipe.segments.p1["videoCatalogue"])?;
        let viewport = &prepared.loaded.recipe.segments.p4.viewport;
        let viewport_matches = f64::from(physical.width) / scale == viewport.width_css_px && f64::from(physical.height) / scale == viewport.height_css_px;
        let capability = media.capability();
        let mut reasons = Vec::new();
        if !viewport_matches { reasons.push("master-exact-fullscreen-viewport-required".to_owned()); }
        if !capability.qualified_start_available { reasons.push(capability.reason_code.clone()); }
        if !crate::research_platform::NATIVE_ACQUISITION_SUPPORTED { reasons.push("native-acquisition-platform-unsupported".into()); }
        super::markers::MasterMarkers::new(&prepared.plan,"run-preflight","attempt-preflight")?;
        Ok(serde_json::json!({"schema":"affect-runner-master-preflight","version":1,
            "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,"planIdentitySha256":prepared.plan.plan_identity_sha256,
            "mediaBindingCount":bindings.len(),"viewportMatches":viewport_matches,"nativeStartReady":reasons.is_empty(),"reasons":reasons}))
    })).await.map_err(|_| CommandError::forbidden("Master preflight did not finish."))?
}

#[tauri::command]
pub async fn research_runner_master_start(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterStartRequest,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden(
            "Enter fullscreen participant preparation before starting.",
        ));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start(request, (physical.width, physical.height, scale))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master Start worker did not finish."))?
}
#[tauri::command]
pub fn research_runner_master_status(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
) -> ResearchResult<Option<MasterStatus>> {
    authorize(&window)?;
    Ok(runtime.status())
}
#[tauri::command]
pub async fn research_runner_master_action(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    run_id: String,
    action: MasterAction,
) -> ResearchResult<MasterStatus> {
    authorize(&window)?;
    if !matches!(action, MasterAction::Stop | MasterAction::Pause) {
        let physical = window.inner_size().map_err(CommandError::io)?;
        runtime.validate_window(
            &run_id,
            (
                physical.width,
                physical.height,
                window.scale_factor().map_err(CommandError::io)?,
            ),
            window.is_fullscreen().map_err(CommandError::io)?,
        )?;
    }
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || runtime.action(&run_id, action))
        .await
        .map_err(|_| CommandError::forbidden("Master action worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_history(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    workspace_id: String,
    source_text: String,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| {
            workspace.with_workspace(&workspace_id, |root, _| {
                super::storage::history(root, &source_text)
            })
        })
    })
    .await
    .map_err(|_| CommandError::forbidden("Master history scan did not finish."))?
}

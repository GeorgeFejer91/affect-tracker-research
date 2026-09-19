use super::runtime::{
    MasterAction, MasterActionRequestV3, MasterActionRequestV4, MasterActionV2, MasterActionV4,
    MasterRuntime, MasterStartRequest, MasterStartRequestV2, MasterStartRequestV3,
    MasterStartRequestV4, MasterStatus,
};
use super::runtime::{MasterActionRequestV5, MasterStartRequestV5};
use super::{MasterPlan, MasterSelector, PreparedMaster};
use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_native_protocol::runtime::PackageProtocolRuntime;
use crate::research_workspace::{MediaUrlReceipt, RescanResult, WorkspaceService};
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterHtmlVideoRequest {
    pub workspace_id: String,
    pub source_text: String,
    pub participant_id: String,
    pub selector: MasterSelector,
    pub protocol_step_position: u32,
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
    crate::research_planner_recipe_supported::parse_supported_planner_recipe_bytes(
        source_text.as_bytes(),
    )?;
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| workspace.rescan_planner_videos(&workspace_id))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master media scan did not finish."))?
}

#[tauri::command]
pub async fn research_runner_master_html_video_url(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: MasterHtmlVideoRequest,
) -> ResearchResult<MediaUrlReceipt> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| {
            let prepared = PreparedMaster::read(
                &request.source_text,
                &request.participant_id,
                request.selector,
            )?;
            let step = prepared
                .plan
                .steps
                .iter()
                .find(|step| step.position == request.protocol_step_position)
                .ok_or_else(|| {
                    CommandError::invalid_contract(
                        "The requested video step is absent from this master plan.",
                    )
                })?;
            if step.kind != super::MasterStepKind::Video {
                return Err(CommandError::invalid_contract(
                    "HTML video URL preparation requires a video protocol step.",
                ));
            }
            let asset = &step.payload["asset"];
            let relative_path = asset["sourceRelativePath"]
                .as_str()
                .or_else(|| {
                    asset["packageRelativePath"]
                        .as_str()
                        .and_then(|value| value.strip_prefix("assets/"))
                })
                .ok_or_else(|| {
                    CommandError::invalid_contract("The selected video has no source path.")
                })?;
            let sha256 = asset["sha256"].as_str().ok_or_else(|| {
                CommandError::invalid_contract("The selected video has no SHA-256.")
            })?;
            let byte_length = asset["byteLength"].as_u64().ok_or_else(|| {
                CommandError::invalid_contract("The selected video has no byte length.")
            })?;
            workspace.issue_planner_media_url(
                &request.workspace_id,
                relative_path,
                sha256,
                byte_length,
            )
        })
    })
    .await
    .map_err(|_| CommandError::forbidden("Master HTML video URL preparation did not finish."))?
}

#[tauri::command]
pub async fn research_runner_master_preflight(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: MasterPreflightRequest,
) -> ResearchResult<serde_json::Value> {
    master_preflight(window, workspace, runtime, request, false).await
}
#[tauri::command]
pub async fn research_runner_master_validation_preflight(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: MasterPreflightRequest,
) -> ResearchResult<serde_json::Value> {
    master_preflight(window, workspace, runtime, request, true).await
}
async fn master_preflight(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: MasterPreflightRequest,
    validation: bool,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || runtime.while_idle(|| {
        let prepared = PreparedMaster::read(&request.source_text, &request.participant_id, request.selector)?;
        workspace.with_workspace(&request.workspace_id, |root, _| crate::research_planner_recipe_file::verify_loaded_questionnaire_assets(root, &prepared.loaded))?;
        let bindings = super::bindings::bind_master_media(&workspace, &request.workspace_id, &prepared)?;
        let viewport = super::runtime::native_viewport_projection(&prepared, (physical.width, physical.height, scale));
        let viewport_matches = viewport.as_ref().is_ok_and(|projection| projection.viewport_matches);
        let viewport_mode = viewport.as_ref().map(|projection| projection.mode).unwrap_or("unavailable");
        let viewport_scale = viewport.as_ref().map(|projection| projection.scale).unwrap_or(0.0);
        let mut reasons = Vec::new();
        if viewport.is_err() { reasons.push("master-html-video-viewport-unavailable".to_owned()); }
        if validation {
            if !matches!(prepared.plan.version, 3 | 4 | 5) { reasons.push("validation-requires-master3-4-or-5".into()); }
        }
        super::markers::MasterMarkers::new(&prepared.plan,"run-preflight","attempt-preflight")?;
        let result = serde_json::json!({"schema":"affect-runner-master-preflight","version":prepared.plan.version,
            "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,"planIdentitySha256":prepared.plan.plan_identity_sha256,
            "mediaBindingCount":bindings.len(),"viewportMatches":viewport_matches,"viewportMode":viewport_mode,"viewportScale":viewport_scale,
            "htmlVideoStartReady":reasons.is_empty(),"nativeStartReady":reasons.is_empty(),"reasons":reasons,
            "playbackProtocol":"html-video-element"});
        if validation { Ok(serde_json::json!({"schema":"affect-runner-validation-preflight","version":1,"result":result})) } else { Ok(result) }
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
pub async fn research_runner_master_start_v2(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterStartRequestV2,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden("Enter fullscreen before starting."));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_v2(request, (physical.width, physical.height, scale))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master Start worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_start_v3(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterStartRequestV3,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden("Enter fullscreen before starting."));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_v3(request, (physical.width, physical.height, scale))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master Start worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_validation_start(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: super::runtime::MasterValidationStartRequest,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden("Enter fullscreen before starting."));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_validation(request, (physical.width, physical.height, scale))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master Start worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_validation_start_v5(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: super::runtime::MasterValidationStartRequestV5,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden("Enter fullscreen before starting."));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_validation_v5(request, (physical.width, physical.height, scale))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master Start worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_start_v4(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterStartRequestV4,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden("Enter fullscreen before starting."));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_v4(request, (physical.width, physical.height, scale))
    })
    .await
    .map_err(|_| CommandError::forbidden("Master Start worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_start_v5(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterStartRequestV5,
) -> ResearchResult<serde_json::Value> {
    authorize(&window)?;
    if !window.is_fullscreen().map_err(CommandError::io)? {
        return Err(CommandError::forbidden("Enter fullscreen before starting."));
    }
    let physical = window.inner_size().map_err(CommandError::io)?;
    let scale = window.scale_factor().map_err(CommandError::io)?;
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.start_v5(request, (physical.width, physical.height, scale))
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
    runtime.require_version(&run_id, 1)?;
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
pub async fn research_runner_master_action_v2(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    run_id: String,
    action: MasterActionV2,
) -> ResearchResult<MasterStatus> {
    authorize(&window)?;
    runtime.require_version(&run_id, 2)?;
    if !matches!(action, MasterActionV2::Stop | MasterActionV2::Pause) {
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
    tauri::async_runtime::spawn_blocking(move || runtime.action(&run_id, action.into()))
        .await
        .map_err(|_| CommandError::forbidden("Master action worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_action_v3(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterActionRequestV3,
) -> ResearchResult<MasterStatus> {
    authorize(&window)?;
    request.validate()?;
    let MasterActionRequestV3 { run_id, action, .. } = request;
    runtime.require_version(&run_id, 3)?;
    if !matches!(action, MasterActionV2::Stop | MasterActionV2::Pause) {
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
    tauri::async_runtime::spawn_blocking(move || runtime.action(&run_id, action.into()))
        .await
        .map_err(|_| CommandError::forbidden("Master action worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_action_v4(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterActionRequestV4,
) -> ResearchResult<MasterStatus> {
    authorize(&window)?;
    request.validate()?;
    let MasterActionRequestV4 { run_id, action, .. } = request;
    runtime.require_version(&run_id, 4)?;
    if !matches!(action, MasterActionV4::Stop | MasterActionV4::Pause) {
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
    tauri::async_runtime::spawn_blocking(move || runtime.action(&run_id, action.into()))
        .await
        .map_err(|_| CommandError::forbidden("Master action worker did not finish."))?
}
#[tauri::command]
pub async fn research_runner_master_action_v5(
    window: WebviewWindow,
    runtime: State<'_, Arc<MasterRuntime>>,
    request: MasterActionRequestV5,
) -> ResearchResult<MasterStatus> {
    authorize(&window)?;
    request.validate()?;
    let MasterActionRequestV5 { run_id, action, .. } = request;
    runtime.require_version(&run_id, 5)?;
    if !matches!(action, MasterActionV4::Stop | MasterActionV4::Pause) {
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
    tauri::async_runtime::spawn_blocking(move || runtime.action(&run_id, action.into()))
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

#[tauri::command]
pub async fn research_runner_variant_usage(
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
                super::variant_usage::usage(root, &source_text)
            })
        })
    })
    .await
    .map_err(|_| CommandError::forbidden("Version usage scan did not finish."))?
}

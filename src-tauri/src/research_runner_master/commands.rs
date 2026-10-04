use super::runtime::{
    MasterAction, MasterActionRequestV3, MasterActionRequestV4, MasterActionV2, MasterActionV4,
    MasterRuntime, MasterStartRequest, MasterStartRequestV2, MasterStartRequestV3,
    MasterStartRequestV4, MasterStatus,
};
use super::runtime::{MasterActionRequestV5, MasterStartRequestV5};
use super::{MasterPlan, MasterSelector, MasterStepKind, PreparedMaster};
use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_native_protocol::runtime::PackageProtocolRuntime;
use crate::research_workspace::{RescanResult, RunnerVideoBindingV3, WorkspaceService};
use serde::{Deserialize, Serialize};
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterHtmlVideoUrl {
    pub schema: &'static str,
    pub version: u32,
    pub media_url: String,
    pub media_grant_id: String,
    pub workspace_file_id: String,
    pub sha256: String,
    pub byte_length: u64,
    pub mime_type: String,
}

fn declared_video_asset(plan: &MasterPlan, position: u32) -> ResearchResult<&serde_json::Value> {
    plan.steps
        .iter()
        .find(|step| step.position == position && step.kind == MasterStepKind::Video)
        .and_then(|step| step.payload.get("asset"))
        .ok_or_else(|| {
            CommandError::invalid_contract("Select an exact video step in the saved plan.")
        })
}

fn bound_video_asset<'a>(
    asset: &serde_json::Value,
    bindings: &'a [RunnerVideoBindingV3],
) -> ResearchResult<&'a RunnerVideoBindingV3> {
    let matches = bindings
        .iter()
        .filter(|binding| {
            asset["assetId"] == binding.asset_id
                && asset["annotationId"] == binding.annotation_id
                && asset["sourceRelativePath"] == binding.source_relative_path
                && asset["sha256"] == binding.sha256
                && asset["byteLength"] == binding.byte_length
                && asset["durationMs"] == binding.duration_ms
                && serde_json::to_value(&binding.display_geometry)
                    .is_ok_and(|geometry| asset["geometry"] == geometry)
        })
        .collect::<Vec<_>>();
    let [binding] = matches.as_slice() else {
        return Err(CommandError::forbidden(
            "The selected video step does not match one verified catalogue entry.",
        ));
    };
    Ok(binding)
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

/// Grants the exact prepared workspace file selected by a saved video step to
/// the participant HTML video element. The caller cannot supply a file path.
#[tauri::command]
pub async fn research_runner_master_html_video_url(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    request: MasterHtmlVideoRequest,
) -> ResearchResult<MasterHtmlVideoUrl> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = PreparedMaster::read(
            &request.source_text,
            &request.participant_id,
            request.selector,
        )?;
        let asset = declared_video_asset(&prepared.plan, request.protocol_step_position)?;
        if matches!(prepared.plan.version, 3..=5) {
            let catalogue = prepared.loaded.recipe.segment("P1")?["videoCatalogue"].clone();
            let bindings =
                workspace.validate_runner_video_catalogue_v3(&request.workspace_id, &catalogue)?;
            bound_video_asset(asset, &bindings)?;
        }
        let path = asset["sourceRelativePath"].as_str().ok_or_else(|| {
            CommandError::invalid_contract("The selected video has no saved path.")
        })?;
        let sha256 = asset["sha256"].as_str().ok_or_else(|| {
            CommandError::invalid_contract("The selected video has no saved hash.")
        })?;
        let byte_length = asset["byteLength"].as_u64().ok_or_else(|| {
            CommandError::invalid_contract("The selected video has no saved length.")
        })?;
        let mime_type = crate::research_workspace::video_mime_type(std::path::Path::new(path));
        let receipt = workspace.issue_planner_declared_media_url(
            &request.workspace_id,
            path,
            sha256,
            byte_length,
            mime_type,
        )?;
        Ok(MasterHtmlVideoUrl {
            schema: "affect-runner-html-media-url",
            version: 1,
            media_url: receipt.media_url,
            media_grant_id: receipt.media_grant_id,
            workspace_file_id: receipt.workspace_file_id,
            sha256: sha256.to_owned(),
            byte_length: receipt.byte_length,
            mime_type: receipt.mime_type,
        })
    })
    .await
    .map_err(|_| CommandError::forbidden("HTML media selection did not finish."))?
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
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| {
            let prepared = PreparedMaster::read(
                &request.source_text,
                &request.participant_id,
                request.selector,
            )?;
            workspace.with_workspace(&request.workspace_id, |root, _| {
                crate::research_planner_recipe_file::verify_loaded_questionnaire_assets(
                    root,
                    &prepared.loaded,
                )
            })?;
            let p1 = prepared.loaded.recipe.segment("P1")?;
            let saved_video_count = p1["videoCatalogue"]["entries"]
                .as_array()
                .ok_or_else(|| CommandError::invalid_contract("Saved video catalogue is missing."))?
                .len();
            let media_binding_count = if matches!(prepared.plan.version, 3..=5) {
                let bindings = workspace.validate_runner_video_catalogue_v3(
                    &request.workspace_id,
                    &p1["videoCatalogue"],
                )?;
                for step in prepared
                    .plan
                    .steps
                    .iter()
                    .filter(|s| s.kind == MasterStepKind::Video)
                {
                    bound_video_asset(
                        declared_video_asset(&prepared.plan, step.position)?,
                        &bindings,
                    )?;
                }
                bindings.len()
            } else {
                0
            };
            let viewport = &prepared.layout.viewport;
            let viewport_matches = scale.is_finite()
                && scale > 0.0
                && f64::from(physical.width) / scale == viewport.width_css_px
                && f64::from(physical.height) / scale == viewport.height_css_px;
            let mut reasons = vec![super::runtime::RUNNER_START_UNAVAILABLE_REASON.to_owned()];
            if !viewport_matches {
                reasons.push("master-exact-fullscreen-viewport-required".to_owned());
            }
            if validation && !matches!(prepared.plan.version, 3 | 4 | 5) {
                reasons.push("validation-requires-master3-4-or-5".to_owned());
            }
            super::markers::MasterMarkers::new(
                &prepared.plan,
                "run-preflight",
                "attempt-preflight",
            )?;
            let result = serde_json::json!({
                "schema": "affect-runner-master-preflight",
                "version": prepared.plan.version,
                "recipeSourceByteSha256": prepared.plan.recipe_source_byte_sha256,
                "planIdentitySha256": prepared.plan.plan_identity_sha256,
                "mediaBindingCount": media_binding_count,
                "savedVideoCount": saved_video_count,
                "viewportMatches": viewport_matches,
                "nativeStartReady": false,
                "reasons": reasons
            });
            if validation {
                Ok(serde_json::json!({
                    "schema": "affect-runner-validation-preflight",
                    "version": 1,
                    "result": result
                }))
            } else {
                Ok(result)
            }
        })
    })
    .await
    .map_err(|_| CommandError::forbidden("Master preflight did not finish."))?
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

#[cfg(test)]
mod html_video_tests {
    use super::*;

    #[test]
    fn html_video_url_can_select_only_a_saved_video_step() {
        let source = include_str!(
            "../../../test/fixtures/planner-recipe-locations-current-v1.canonical.json"
        );
        let selector = MasterSelector {
            variant_id: "variant-3".into(),
            language_id: "en".into(),
            language_selection_path: vec!["both".into(), "en".into()],
            presentation_target: "desktop-screen".into(),
        };
        let prepared = PreparedMaster::read(source, "P001", selector).unwrap();
        let video = prepared
            .plan
            .steps
            .iter()
            .find(|step| step.kind == MasterStepKind::Video)
            .unwrap();
        let asset = declared_video_asset(&prepared.plan, video.position).unwrap();
        assert_eq!(asset["sourceRelativePath"], "stimuli/session_a/clip.mp4");
        let binding = RunnerVideoBindingV3 {
            asset_id: asset["assetId"].as_str().unwrap().into(),
            annotation_id: asset["annotationId"].as_str().unwrap().into(),
            source_relative_path: asset["sourceRelativePath"].as_str().unwrap().into(),
            workspace_file_id: "workspace-video-1".into(),
            sha256: asset["sha256"].as_str().unwrap().into(),
            byte_length: asset["byteLength"].as_u64().unwrap(),
            mime_type: "video/mp4".into(),
            duration_ms: asset["durationMs"].as_u64().unwrap(),
            display_geometry: serde_json::from_value(asset["geometry"].clone()).unwrap(),
        };
        assert_eq!(
            bound_video_asset(asset, std::slice::from_ref(&binding))
                .unwrap()
                .workspace_file_id,
            "workspace-video-1"
        );
        assert!(bound_video_asset(asset, &[binding.clone(), binding.clone()]).is_err());
        let mut changed = binding;
        changed.duration_ms += 1;
        assert!(bound_video_asset(asset, &[changed]).is_err());
        let form = prepared
            .plan
            .steps
            .iter()
            .find(|step| step.kind == MasterStepKind::Questionnaire)
            .unwrap();
        assert!(declared_video_asset(&prepared.plan, form.position).is_err());
        assert!(declared_video_asset(&prepared.plan, 0).is_err());
    }
}

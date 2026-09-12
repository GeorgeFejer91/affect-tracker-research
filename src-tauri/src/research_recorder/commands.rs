use super::{Discovery, RecordStartRequest, RecorderService, RecorderStatus};
use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_native_protocol::runtime::PackageProtocolRuntime;
use std::sync::Arc;
use tauri::{Manager, State, WebviewWindow};

fn authorize(window: &WebviewWindow) -> ResearchResult<()> {
    if window.label() != "research"
        || window.try_state::<DesktopRole>().as_deref() != Some(&DesktopRole::Runner)
    {
        return Err(CommandError::forbidden(
            "Only Experiment Runner owns stream recording.",
        ));
    }
    Ok(())
}
fn idle(runtime: &PackageProtocolRuntime) -> ResearchResult<()> {
    if runtime.status().active {
        return Err(CommandError::forbidden(
            "Finish the active attempt before changing its recorder.",
        ));
    }
    Ok(())
}
#[tauri::command]
pub fn research_recorder_status(
    window: WebviewWindow,
    service: State<'_, Arc<RecorderService>>,
) -> ResearchResult<RecorderStatus> {
    authorize(&window)?;
    Ok(service.status())
}
#[tauri::command]
pub async fn research_recorder_discover(
    window: WebviewWindow,
    service: State<'_, Arc<RecorderService>>,
) -> ResearchResult<Discovery> {
    authorize(&window)?;
    let service = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || service.discover())
        .await
        .map_err(|_| CommandError::new("recorder_worker", "Stream discovery did not finish."))?
}
#[tauri::command]
pub async fn research_recorder_start(
    window: WebviewWindow,
    workspace: State<'_, Arc<crate::research_workspace::WorkspaceService>>,
    service: State<'_, Arc<RecorderService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    request: RecordStartRequest,
    workspace_id: String,
) -> ResearchResult<Option<RecorderStatus>> {
    authorize(&window)?;
    idle(&runtime)?;
    request.validate()?;
    let service = Arc::clone(&service);
    let runtime = Arc::clone(&runtime);
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| {
            workspace.with_workspace(&workspace_id, |root, _| {
                let loaded = crate::research_runner_session::RunnerDocument::read(
                    &request.experiment_package_source_text,
                )?;
                let recipe = loaded.ensure_directory(root)?;
                let recordings =
                    crate::research_run_storage::ensure_checked_run_child(&recipe, "recordings")?;
                let path = recordings
                    .path
                    .join(format!("recording-{}.xdf", uuid::Uuid::new_v4()));
                service.start_path(request, path).map(Some)
            })
        })
    })
    .await
    .map_err(|_| CommandError::new("recorder_worker", "The recorder could not start."))?
}
#[tauri::command]
pub async fn research_recorder_stop(
    window: WebviewWindow,
    service: State<'_, Arc<RecorderService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
) -> ResearchResult<RecorderStatus> {
    authorize(&window)?;
    idle(&runtime)?;
    let service = Arc::clone(&service);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || runtime.while_idle(|| service.stop()))
        .await
        .map_err(|_| CommandError::new("recorder_worker", "The recorder did not finish."))?
}

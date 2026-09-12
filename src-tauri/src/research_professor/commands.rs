use super::{auth, Applied, ApplyRequest, ProfessorService, Result, Snapshot};
use crate::research_native_protocol::runtime::StartPackageRunRequest;
use std::sync::Arc;
use tauri::{State, WebviewWindow};
#[tauri::command]
pub async fn research_professor_frame(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
    grant: String,
) -> Result<super::PreviewFrame> {
    authorize(&window)?;
    let service = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || service.frame(&grant))
        .await
        .map_err(|_| super::error("authority_unavailable"))?
}
fn authorize(window: &WebviewWindow) -> Result<()> {
    if window.label() != "research" {
        return Err(super::error("forbidden_operation"));
    }
    Ok(()) // Handler registry and managed service exist only in the Runner executable.
}
#[tauri::command]
pub fn research_professor_begin(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
    video: bool,
) -> Result<auth::Invitation> {
    authorize(&window)?;
    service.begin(video)
}
#[tauri::command]
pub fn research_professor_verify(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
    request: auth::VerifyRequest,
) -> Result<auth::Grant> {
    authorize(&window)?;
    service.verify(request)
}
#[tauri::command]
pub fn research_professor_disable(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
) -> Result<()> {
    authorize(&window)?;
    service.disable();
    Ok(())
}
#[tauri::command]
pub fn research_professor_disarm(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
) -> Result<()> {
    authorize(&window)?;
    service.disarm()
}
#[tauri::command]
pub fn research_professor_arm(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
    request: StartPackageRunRequest,
) -> Result<()> {
    authorize(&window)?;
    service.arm(request)
}
#[tauri::command]
pub async fn research_professor_snapshot(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
    grant: String,
) -> Result<Snapshot> {
    authorize(&window)?;
    let service = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || service.snapshot(&grant))
        .await
        .map_err(|_| super::error("authority_unavailable"))?
}
#[tauri::command]
pub async fn research_professor_apply(
    window: WebviewWindow,
    service: State<'_, Arc<ProfessorService>>,
    request: ApplyRequest,
) -> Result<Applied> {
    authorize(&window)?;
    let service = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || service.apply(request))
        .await
        .map_err(|_| super::error("authority_unavailable"))?
}

use crate::research_error::{CommandError, ResearchResult};
use serde::Serialize;
use tauri::{State, WebviewWindow};

/// Chosen by the executable, never by an IPC request or a mutable UI mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopRole {
    Planner,
    Runner,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIdentity {
    schema: &'static str,
    version: u8,
    program: DesktopRole,
    build_commit: &'static str,
}

#[tauri::command]
pub fn research_desktop_identity(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
) -> ResearchResult<DesktopIdentity> {
    if window.label() != "research" {
        return Err(CommandError::forbidden("Unknown companion window."));
    }
    Ok(DesktopIdentity {
        schema: "affect-research-desktop-identity",
        version: 1,
        program: *role,
        build_commit: env!("AFFECT_TRACKER_BUILD_COMMIT"),
    })
}

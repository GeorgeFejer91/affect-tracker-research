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

/// Presentation only: no protocol, input, persistence or network authority.
#[tauri::command]
pub fn research_runner_fullscreen(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    fullscreen: bool,
) -> ResearchResult<()> {
    if window.label() != "research" || *role != DesktopRole::Runner {
        return Err(CommandError::forbidden("Runner window required."));
    }
    window.set_fullscreen(fullscreen).map_err(|_| {
        CommandError::new(
            "runner_fullscreen_failed",
            "Could not change the experiment window's fullscreen state.",
        )
    })
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

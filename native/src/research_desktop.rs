use crate::research_error::{CommandError, ResearchResult};
use crate::research_input::ResearchInputService;
use serde::Serialize;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{Manager, State, WebviewWindow};

/// Chosen by the executable, never by an IPC request or a mutable UI mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopRole {
    Planner,
    Runner,
}

/// Presentation plus a scoped native escape notification. Existing protocol
/// commands still own abort/finalization; no input data crosses this channel.
#[tauri::command]
pub fn research_runner_fullscreen(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    input: State<'_, Arc<ResearchInputService>>,
    fullscreen: bool,
    on_abort: Channel<()>,
) -> ResearchResult<()> {
    if window.label() != "research" || *role != DesktopRole::Runner {
        return Err(CommandError::forbidden("Runner window required."));
    }
    if fullscreen {
        input.set_runner_abort_sink(Some(Arc::new(move || {
            let _ = on_abort.send(());
        })))?;
    }
    let result = window.set_fullscreen(fullscreen).map_err(|_| {
        CommandError::new(
            "runner_fullscreen_failed",
            "Could not change the experiment window's fullscreen state.",
        )
    });
    if (!fullscreen && result.is_ok()) || (fullscreen && result.is_err()) {
        input.set_runner_abort_sink(None)?;
    }
    result
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

#[tauri::command]
pub fn research_show_flubber(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
) -> ResearchResult<()> {
    if window.label() != "research" || *role != DesktopRole::Planner {
        return Err(CommandError::forbidden("Planner window required."));
    }
    let preview = window
        .app_handle()
        .get_webview_window("flubber")
        .ok_or_else(|| {
            CommandError::new("flubber_unavailable", "The Flubber preview is unavailable.")
        })?;
    preview.show().map_err(|_| {
        CommandError::new("flubber_unavailable", "Could not show the Flubber preview.")
    })?;
    preview.set_focus().map_err(|_| {
        CommandError::new(
            "flubber_unavailable",
            "Could not focus the Flubber preview.",
        )
    })
}

#[tauri::command]
pub fn research_show_preview(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
) -> ResearchResult<()> {
    if window.label() != "research" || *role != DesktopRole::Planner {
        return Err(CommandError::forbidden("Planner window required."));
    }
    let settings = window
        .app_handle()
        .get_webview_window("preview")
        .ok_or_else(|| {
            CommandError::new("preview_unavailable", "Flubber settings are unavailable.")
        })?;
    settings.show().map_err(|_| {
        CommandError::new("preview_unavailable", "Could not show Flubber settings.")
    })?;
    settings.unminimize().map_err(|_| {
        CommandError::new("preview_unavailable", "Could not restore Flubber settings.")
    })?;
    settings
        .set_focus()
        .map_err(|_| CommandError::new("preview_unavailable", "Could not focus Flubber settings."))
}

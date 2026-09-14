use crate::research_error::{CommandError, ResearchResult};
use crate::research_input::ResearchInputService;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{State, WebviewWindow};

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
    playback_surface: &'static str,
    suite: DesktopSuiteStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSuiteStatus {
    schema: &'static str,
    version: u8,
    required: bool,
    complete: bool,
    issues: Vec<&'static str>,
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
        playback_surface: "htmlVideo",
        suite: desktop_suite_status(*role),
    })
}

fn desktop_suite_status(role: DesktopRole) -> DesktopSuiteStatus {
    let mut required = false;
    let mut issues = Vec::new();
    let exe = std::env::current_exe().ok();
    let Some(exe) = exe.as_deref() else {
        return suite_status(false, ["desktop-suite-current-exe-unavailable"]);
    };
    let Some(name) = exe.file_name().and_then(|value| value.to_str()) else {
        return suite_status(false, ["desktop-suite-current-exe-name-unavailable"]);
    };
    if name.eq_ignore_ascii_case("Experiment Planner.exe")
        || name.eq_ignore_ascii_case("affect-runner-engine.exe")
    {
        required = true;
    }
    let Some(root) = exe.parent() else {
        return suite_status(required, ["desktop-suite-root-unavailable"]);
    };
    if root.join("current-build.json").is_file() || root.join("launcher-receipt.json").is_file() {
        required = true;
    }
    if !required {
        return suite_status(false, []);
    }
    for (file, code) in [
        ("Experiment Planner.exe", "desktop-suite-planner-missing"),
        ("Experiment Runner.exe", "desktop-suite-runner-launcher-missing"),
        (
            "affect-runner-engine.exe",
            "desktop-suite-runner-engine-missing",
        ),
        ("current-build.json", "desktop-suite-current-build-missing"),
    ] {
        if !regular_file(&root.join(file)) {
            issues.push(code);
        }
    }
    match role {
        DesktopRole::Planner if !name.eq_ignore_ascii_case("Experiment Planner.exe") => {
            issues.push("desktop-suite-planner-executable-name-mismatch");
        }
        DesktopRole::Runner if !name.eq_ignore_ascii_case("affect-runner-engine.exe") => {
            issues.push("desktop-suite-runner-engine-name-mismatch");
        }
        _ => {}
    }
    DesktopSuiteStatus {
        schema: "affect-research-desktop-suite",
        version: 1,
        required,
        complete: issues.is_empty(),
        issues,
    }
}

fn suite_status<const N: usize>(required: bool, issues: [&'static str; N]) -> DesktopSuiteStatus {
    DesktopSuiteStatus {
        schema: "affect-research-desktop-suite",
        version: 1,
        required,
        complete: issues.is_empty(),
        issues: issues.into_iter().collect(),
    }
}

fn regular_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    metadata.is_file() && !metadata.file_type().is_symlink()
}

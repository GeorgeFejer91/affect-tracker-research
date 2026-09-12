#![deny(unsafe_op_in_unsafe_fn)]
#![deny(clippy::undocumented_unsafe_blocks)]

mod research_clock;
mod research_commands;
mod research_contracts;
mod research_desktop;
pub mod research_desktop_layout;
mod research_error;
mod research_experiment_package;
mod research_external_protocol;
pub mod research_feedback;
mod research_gamepad;
mod research_input;
mod research_lsl;
mod research_native_media;
mod research_native_protocol;
mod research_participant;
mod research_planner_authoring;
pub mod research_planner_recipe;
mod research_planner_recipe_file;
pub mod research_planner_recipe_policy;
mod research_platform;
pub mod research_protocol;
pub mod research_questionnaire_recipe;
mod research_recorder;
mod research_run_storage;
#[cfg(test)]
mod research_runtime;
mod research_stimulus_order;
mod research_timing;
mod research_video_geometry;
mod research_workspace;
pub mod research_workspace_contribution;
pub mod research_xr_layout;

use research_desktop::DesktopRole;
use research_input::ResearchInputService;
use research_native_media::NativeMediaService;
use research_native_protocol::runtime::PackageProtocolRuntime;
use research_platform::NATIVE_ACQUISITION_SUPPORTED;
use research_workspace::WorkspaceService;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    launch(DesktopRole::Planner, tauri::generate_context!(), None);
}

/// Independent Runner binary supplies its own embedded assets and identity.
pub fn run_runner(context: tauri::Context<tauri::Wry>) {
    launch(DesktopRole::Runner, context, None);
}

/// Production CLI entry point. It owns one private, hidden Planner lifecycle;
/// ordinary app startup has no authoring ingress or attached process control.
pub fn run_planner_cli(arguments: Vec<std::ffi::OsString>) -> Result<i32, String> {
    if arguments.is_empty() || arguments == ["--help"] || arguments == ["help"] {
        println!("Experiment Planner CLI\n\nUsage: affect-planner-cli jsonl\n\nStarts one hidden Planner. Read its JSON ready receipt, then send bounded\nPlanner command JSONL on stdin. Results contain request identity and revision.\nActions: catalogue, snapshot, get, validate, set, apply, cancel.\nMutations require the ready sessionId and current expectedRevision.\nEOF drains accepted commands and closes only this owned process.\nNo network listener or control of an existing application window.\nSee docs/planner-authoring-command-api-v1.md for the exact command schema.");
        return Ok(0);
    }
    if arguments != ["jsonl"] {
        return Err("Unknown CLI arguments. Use --help.".into());
    }
    let profile = std::env::temp_dir().join(format!("affect-planner-cli-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&profile)
        .map_err(|_| "Could not create an isolated Planner CLI profile.")?;
    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        window.visible = false;
        window.focus = false;
        window.data_directory = Some(profile.join("webview"));
    }
    Ok(launch(DesktopRole::Planner, context, Some(profile)))
}

fn launch(
    role: DesktopRole,
    context: tauri::Context<tauri::Wry>,
    cli_profile: Option<PathBuf>,
) -> i32 {
    let cli_enabled = cli_profile.is_some();
    let authoring = Arc::new(research_planner_authoring::PlannerAuthoringBroker::new(
        cli_enabled,
    ));
    let setup_authoring = Arc::clone(&authoring);
    let builder = tauri::Builder::default()
        .manage(role)
        .register_uri_scheme_protocol("research-media", |context, request| {
            if let Some(workspace) = context.app_handle().try_state::<Arc<WorkspaceService>>() {
                workspace.protocol_response(context.webview_label(), request)
            } else {
                let mut response = tauri::http::Response::new(Vec::new());
                *response.status_mut() = tauri::http::StatusCode::SERVICE_UNAVAILABLE;
                response
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let app_data_dir = match &cli_profile {
                Some(profile) => profile.join("app-data"),
                None => app.path().app_data_dir()?,
            };
            let workspace = Arc::new(
                (if cli_enabled {
                    WorkspaceService::new(app_data_dir.clone())
                } else {
                    WorkspaceService::with_default_workspace(app_data_dir.clone())
                })
                .map_err(|error| std::io::Error::other(error.message))?,
            );
            let resource_dir = app.path().resource_dir()?;
            let parent_window_handle = research_parent_window_handle(app);
            let native_media = Arc::new(NativeMediaService::start(
                &resource_dir,
                app_data_dir.as_path(),
                parent_window_handle,
            ));
            // Setup remains operable when the safe hook cannot start. Capability
            // reporting and every test/Start command then fail closed.
            let input = Arc::new(input_service_for_platform(NATIVE_ACQUISITION_SUPPORTED));
            let focused = app
                .get_webview_window("research")
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false);
            input.set_window_focused(focused);
            if role == DesktopRole::Runner {
                let recorder = Arc::new(research_recorder::RecorderService::default());
                app.manage(Arc::new(
                    PackageProtocolRuntime::with_services(
                        Arc::clone(&workspace),
                        Arc::clone(&native_media),
                        Arc::clone(&input),
                    )
                    .with_recorder(Arc::clone(&recorder)),
                ));
                app.manage(recorder);
            }
            app.manage(workspace);
            app.manage(native_media);
            app.manage(input);
            if role == DesktopRole::Planner {
                app.manage(Arc::clone(&setup_authoring));
                setup_authoring
                    .start(app.handle().clone())
                    .map_err(|error| std::io::Error::other(error.message))?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "research" {
                if matches!(
                    event,
                    WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                ) {
                    if let Some(runtime) = window.try_state::<Arc<PackageProtocolRuntime>>() {
                        runtime.shutdown();
                    }
                    if let Some(recorder) =
                        window.try_state::<Arc<research_recorder::RecorderService>>()
                    {
                        recorder.shutdown();
                    }
                }
                if matches!(
                    event,
                    WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                ) {
                    if let Some(native_media) = window.try_state::<Arc<NativeMediaService>>() {
                        native_media.shutdown();
                    }
                }
                if let Some(input) = window.try_state::<Arc<ResearchInputService>>() {
                    match event {
                        WindowEvent::Moved(_) => {
                            if let Ok(position) = window.inner_position() {
                                input.rebase_window_origin(
                                    f64::from(position.x),
                                    f64::from(position.y),
                                );
                            } else {
                                input.clear_regions_after_layout_change();
                            }
                        }
                        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                            input.clear_regions_after_layout_change();
                        }
                        WindowEvent::Focused(focused) => input.set_window_focused(*focused),
                        WindowEvent::Destroyed => input.shutdown(),
                        _ => {}
                    }
                }
            }
        });
    let builder = match role {
        DesktopRole::Planner => builder.invoke_handler(tauri::generate_handler![
            research_planner_authoring::research_planner_authoring_status,
            research_planner_authoring::research_planner_authoring_ready,
            research_planner_authoring::research_planner_authoring_next,
            research_planner_authoring::research_planner_authoring_complete,
            research_planner_authoring::research_planner_authoring_startup_failed,
            research_desktop::research_desktop_identity,
            research_commands::research_source_capabilities,
            research_commands::research_native_media_capability,
            research_commands::research_native_media_status,
            research_commands::research_native_media_prepare,
            research_commands::research_native_media_set_viewport,
            research_commands::research_native_media_attest_decode,
            research_commands::research_native_media_stop,
            research_commands::research_input_capability,
            research_commands::research_input_set_region,
            research_commands::research_input_begin_test,
            research_commands::research_input_begin_capture,
            research_commands::research_input_status,
            research_commands::research_input_cancel_setup,
            research_commands::research_choose_workspace,
            research_commands::research_open_workspace_location,
            research_commands::research_workspace_status,
            research_commands::research_load_settings,
            research_commands::research_load_experiment,
            research_commands::research_load_experiment_package,
            research_commands::research_save_experiment_package,
            research_commands::research_load_planner_recipe,
            research_commands::research_save_planner_recipe,
            research_commands::research_rescan_stimuli,
            research_commands::research_rescan_package_stimuli,
            research_commands::research_import_stimuli,
            research_commands::research_workspace_media_url,
            research_commands::research_attest_workspace_decode,
            research_commands::research_save_settings,
            research_commands::research_store_questionnaire_asset,
            research_commands::research_storage_readiness,
            research_commands::research_export_assignment_plan,
            research_commands::research_save_stimulus_order,
            research_commands::research_video_library,
            research_commands::research_import_library_videos,
            research_commands::research_export_video_library,
            research_commands::research_export_video_catalogue,
        ]),
        DesktopRole::Runner => builder.invoke_handler(tauri::generate_handler![
            research_recorder::commands::research_recorder_status,
            research_recorder::commands::research_recorder_discover,
            research_recorder::commands::research_recorder_start,
            research_recorder::commands::research_recorder_stop,
            research_desktop::research_desktop_identity,
            research_commands::research_source_capabilities,
            research_commands::research_native_media_capability,
            research_commands::research_native_media_status,
            research_commands::research_native_media_prepare,
            research_commands::research_native_media_set_viewport,
            research_commands::research_native_media_attest_decode,
            research_commands::research_native_media_stop,
            research_native_protocol::commands::research_package_protocol_capability,
            research_native_protocol::commands::research_package_preflight,
            research_native_protocol::commands::research_start_package_run,
            research_native_protocol::commands::research_resume_package_run,
            research_native_protocol::commands::research_package_recoveries,
            research_native_protocol::commands::research_finalize_package_recovery,
            research_native_protocol::commands::research_package_run_status,
            research_native_protocol::commands::research_package_prepare_media,
            research_native_protocol::commands::research_package_set_media_viewport,
            research_native_protocol::commands::research_package_play,
            research_native_protocol::commands::research_package_pause,
            research_native_protocol::commands::research_package_questionnaire_draft,
            research_native_protocol::commands::research_package_questionnaire_submit,
            research_native_protocol::commands::research_finish_package_run,
            research_commands::research_input_capability,
            research_commands::research_input_set_region,
            research_commands::research_input_begin_test,
            research_commands::research_input_status,
            research_commands::research_input_cancel_setup,
            research_commands::research_choose_workspace,
            research_commands::research_open_workspace_location,
            research_commands::research_workspace_status,
            research_commands::research_load_experiment_package,
            research_commands::research_rescan_package_stimuli,
            research_commands::research_load_planner_recipe,
            research_commands::research_workspace_media_url,
            research_commands::research_storage_readiness,
            research_commands::research_lsl_readiness,
        ]),
    };
    let app = builder
        .build(context)
        .expect("failed to build the selected companion app");

    let on_event = |app: &tauri::AppHandle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            if let Some(authoring) =
                app.try_state::<Arc<research_planner_authoring::PlannerAuthoringBroker>>()
            {
                authoring.shutdown();
            }
            if let Some(runtime) = app.try_state::<Arc<PackageProtocolRuntime>>() {
                runtime.shutdown();
            }
            if let Some(recorder) = app.try_state::<Arc<research_recorder::RecorderService>>() {
                recorder.shutdown();
            }
            if let Some(input) = app.try_state::<Arc<ResearchInputService>>() {
                input.shutdown();
            }
            if let Some(native_media) = app.try_state::<Arc<NativeMediaService>>() {
                native_media.shutdown();
            }
        }
    };
    if cli_enabled {
        let runtime_code = app.run_return(on_event);
        // Windows/WebView shutdown can return 0 despite app.exit(2). Preserve
        // the owned broker's terminal outcome independently of the event loop.
        if authoring.exit_code() == 0 {
            runtime_code
        } else {
            2
        }
    } else {
        app.run(on_event);
        0
    }
}

#[cfg(target_os = "windows")]
fn research_parent_window_handle(app: &tauri::App) -> Option<isize> {
    app.get_webview_window("research")
        .and_then(|window| window.hwnd().ok())
        .map(|handle| handle.0 as isize)
}

#[cfg(not(target_os = "windows"))]
fn research_parent_window_handle(_: &tauri::App) -> Option<isize> {
    None
}

fn input_service_for_platform(native_acquisition_supported: bool) -> ResearchInputService {
    if native_acquisition_supported {
        ResearchInputService::start().unwrap_or_else(|_| ResearchInputService::unavailable())
    } else {
        ResearchInputService::unavailable()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interface_only_platform_does_not_start_native_input_authority() {
        let capability = input_service_for_platform(false).capability();
        assert!(!capability.native_authority_ready);
        assert!(capability.supported_presets.is_empty());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn current_non_windows_build_exposes_no_native_input_authority() {
        let capability = input_service_for_platform(NATIVE_ACQUISITION_SUPPORTED).capability();
        assert!(!capability.native_authority_ready);
        assert!(capability.supported_presets.is_empty());
    }
}

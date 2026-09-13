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
pub mod research_form_definition;
mod research_gamepad;
mod research_input;
mod research_local_questionnaire_preset_commands;
mod research_local_questionnaire_presets;
mod research_lsl;
mod research_native_media;
mod research_native_protocol;
mod research_participant;
mod research_planner_authoring;
mod research_planner_cli_effects;
mod research_planner_cli_io;
pub mod research_planner_recipe;
mod research_planner_recipe_file;
pub mod research_planner_recipe_policy;
pub mod research_planner_recipe_supported;
pub mod research_planner_recipe_v2;
pub mod research_planner_recipe_v3;
mod research_platform;
pub mod research_protocol;
pub mod research_questionnaire_recipe;
pub mod research_questionnaire_recipe_v2;
mod research_recorder;
mod research_run_storage;
pub mod research_runner_master;
mod research_runner_recent;
mod research_runner_session;
#[cfg(test)]
mod research_runtime;
mod research_shutdown;
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
    if tauri::is_dev() {
        return Err(
            "Planner CLI requires embedded assets. Build with --features tauri/custom-protocol."
                .into(),
        );
    }
    let profile = std::env::temp_dir().join(format!("affect-planner-cli-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&profile)
        .map_err(|_| "Could not create an isolated Planner CLI profile.")?;
    let mut context = tauri::generate_context!();
    if context.config().app.windows.len() != 1
        || context.config().app.windows[0].label != "research"
    {
        return Err("Planner CLI requires its one fixed research window.".into());
    }
    for window in &mut context.config_mut().app.windows {
        window.create = false;
        window.visible = false;
        window.focus = false;
        window.data_directory = None;
    }
    Ok(launch(DesktopRole::Planner, context, Some(profile)))
}

fn launch(
    role: DesktopRole,
    context: tauri::Context<tauri::Wry>,
    cli_profile: Option<PathBuf>,
) -> i32 {
    let cli_enabled = cli_profile.is_some();
    if cli_enabled {
        research_shutdown::enable_cli_observations();
    }
    let authoring = Arc::new(research_planner_authoring::PlannerAuthoringBroker::new(
        cli_enabled,
    ));
    let setup_authoring = Arc::clone(&authoring);
    let shutdown = Arc::new(research_shutdown::ShutdownCoordinator::default());
    let builder = tauri::Builder::default()
        .manage(role)
        .manage(Arc::clone(&shutdown))
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
            if let Some(profile) = &cli_profile {
                let config = app.config().app.windows.first().ok_or_else(|| {
                    std::io::Error::other("Planner CLI window configuration is absent.")
                })?;
                // The pinned runtime's WindowConfig -> WebviewAttributes
                // conversion omits data_directory. Set it on the native builder
                // so this invocation never falls back to the shared GUI profile.
                tauri::WebviewWindowBuilder::from_config(app, config)?
                    .data_directory(profile.join("webview"))
                    .visible(false)
                    .focused(false)
                    .build()?;
            }
            let app_data_dir = match &cli_profile {
                Some(profile) => profile.join("app-data"),
                None => app.path().app_data_dir()?,
            };
            let workspace = Arc::new(
                (if cli_enabled {
                    WorkspaceService::new(app_data_dir.clone())
                } else {
                    // Companion programs share the Planner's default project,
                    // while their WebViews, preferences and sessions stay separate.
                    WorkspaceService::with_default_workspace(
                        app.path().data_dir()?.join("io.github.georgefejer91.affecttracker"),
                    )
                })
                .map_err(|error| std::io::Error::other(error.message))?,
            );
            app.manage(research_runner_recent::RunnerRecentExperiment::new(
                app_data_dir.clone(),
            ));
            let resource_dir = app.path().resource_dir()?;
            let parent = app
                .get_webview_window("research")
                .ok_or_else(|| std::io::Error::other("Native media parent window is absent."))?;
            // Setup remains operable when the safe hook cannot start. Capability
            // reporting and every test/Start command then fail closed.
            let input = Arc::new(input_service_for_platform(NATIVE_ACQUISITION_SUPPORTED));
            let focused = app
                .get_webview_window("research")
                .and_then(|window| window.is_focused().ok())
                .unwrap_or(false);
            input.set_window_focused(focused);
            if role == DesktopRole::Planner {
                // Finish fallible setup before starting an actor whose teardown
                // needs the UI event loop. A setup error cannot safely join it.
                app.manage(
                    research_local_questionnaire_preset_commands::LocalPresetService::new(
                        app.path().app_data_dir()?,
                    ),
                );
                app.manage(Arc::clone(&setup_authoring));
                setup_authoring
                    .start(app.handle().clone())
                    .map_err(|error| std::io::Error::other(error.message))?;
            }
            // No fallible setup remains after native startup. Normal close/exit
            // uses the off-UI shutdown coordinator while the event loop pumps.
            let native_media =
                NativeMediaService::start_async(resource_dir, app_data_dir.clone(), parent);
            if role == DesktopRole::Runner {
                let recorder = Arc::new(research_recorder::RecorderService::default());
                let package_runtime = Arc::new(
                    PackageProtocolRuntime::with_services(
                        Arc::clone(&workspace),
                        Arc::clone(&native_media),
                        Arc::clone(&input),
                    )
                    .with_recorder(Arc::clone(&recorder)),
                );
                app.manage(Arc::new(research_runner_master::runtime::MasterRuntime::new(
                    Arc::clone(&workspace), Arc::clone(&native_media), Arc::clone(&input),
                    Arc::clone(&recorder), Arc::clone(&package_runtime),
                )));
                app.manage(package_runtime);
                app.manage(recorder);
            }
            app.manage(workspace);
            app.manage(native_media);
            app.manage(input);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "research" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // A strong Rust clone alone does not veto OS destruction.
                    // Keep the parent/event loop alive through actual native join.
                    api.prevent_close();
                    request_companion_exit(window.app_handle(), 0);
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
            research_local_questionnaire_preset_commands::research_read_local_questionnaire_preset,
            research_local_questionnaire_preset_commands::research_install_local_questionnaire_preset,
            research_planner_authoring::research_planner_authoring_status,
            research_planner_authoring::research_planner_authoring_ready,
            research_planner_authoring::research_planner_authoring_next,
            research_planner_authoring::research_planner_authoring_complete,
            research_planner_authoring::research_planner_authoring_effect,
            research_planner_authoring::research_planner_authoring_revision,
            research_planner_authoring::research_planner_authoring_startup_failed,
            research_desktop::research_desktop_identity,
            research_commands::research_source_capabilities,
            research_commands::research_native_media_capability,
            research_commands::research_native_media_status,
            research_commands::research_native_media_prepare,
            research_commands::research_native_media_set_viewport,
            research_commands::research_native_media_attest_decode,
            research_commands::research_native_media_attest_decode_v2,
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
            research_runner_master::commands::research_runner_master_plan,
            research_runner_master::commands::research_runner_master_rescan,
            research_runner_master::commands::research_runner_master_preflight,
            research_runner_master::commands::research_runner_master_start,
            research_runner_master::commands::research_runner_master_start_v2,
            research_runner_master::commands::research_runner_master_start_v3,
            research_runner_master::commands::research_runner_master_validation_start,
            research_runner_master::commands::research_runner_master_validation_preflight,
            research_runner_master::commands::research_runner_master_status,
            research_runner_master::commands::research_runner_master_action,
            research_runner_master::commands::research_runner_master_action_v2,
            research_runner_master::commands::research_runner_master_action_v3,
            research_runner_master::commands::research_runner_master_history,
            research_desktop::research_runner_fullscreen,
            research_recorder::commands::research_recorder_status,
            research_runner_session::research_runner_selection,
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
            research_commands::research_native_media_attest_decode_v2,
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
            research_commands::research_runner_previous_experiment,
            research_commands::research_workspace_media_url,
            research_commands::research_storage_readiness,
            research_commands::research_lsl_readiness,
        ]),
    };
    let app = builder
        .build(context)
        .expect("failed to build the selected companion app");

    let on_event = |app: &tauri::AppHandle, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            research_shutdown::observe(research_shutdown::Phase::ExitRequested);
            let coordinator = app.state::<Arc<research_shutdown::ShutdownCoordinator>>();
            coordinator.join_finished();
            if !coordinator.ready_to_exit() {
                api.prevent_exit();
                request_companion_exit(app, code.unwrap_or(0));
            }
        }
    };
    if cli_enabled {
        let runtime_code = app.run_return(on_event);
        shutdown.join_finished();
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

fn request_companion_exit(app: &tauri::AppHandle, code: i32) {
    let coordinator = Arc::clone(
        app.state::<Arc<research_shutdown::ShutdownCoordinator>>()
            .inner(),
    );
    let work_app = app.clone();
    let exit_app = app.clone();
    coordinator.request(
        code,
        move || {
            shutdown_before_native(&work_app)?;
            if let Some(media) = work_app.try_state::<Arc<NativeMediaService>>() {
                media.request_shutdown();
                research_shutdown::observe(research_shutdown::Phase::NativeShutdownRequested);
                while !media.is_stopped() {
                    if media.shutdown_status()
                        == research_native_media::NativeMediaShutdownStatus::Stalled
                    {
                        research_shutdown::observe(research_shutdown::Phase::NativeStalled);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                media
                    .finish_shutdown()
                    .map_err(|_| "native-media-shutdown-failed")?;
            }
            Ok(())
        },
        move |code| exit_app.exit(code),
    );
}

/// Main's named Runner collection seam. Runs only on the coordinator worker:
/// authoring -> Master cancellation -> Package -> Master join -> recorder/input.
/// The parent/native actor remain alive throughout.
fn shutdown_before_native(app: &tauri::AppHandle) -> Result<(), &'static str> {
    if let Some(authoring) =
        app.try_state::<Arc<research_planner_authoring::PlannerAuthoringBroker>>()
    {
        research_shutdown::observe(research_shutdown::Phase::AuthoringStarted);
        authoring.shutdown();
        research_shutdown::observe(research_shutdown::Phase::AuthoringCompleted);
    }
    if let Some(master) = app.try_state::<Arc<research_runner_master::runtime::MasterRuntime>>() {
        master.shutdown();
    }
    if let Some(runtime) = app.try_state::<Arc<PackageProtocolRuntime>>() {
        runtime.shutdown();
    }
    if let Some(master) = app.try_state::<Arc<research_runner_master::runtime::MasterRuntime>>() {
        while !master.is_stopped() {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        master.join_stopped().map_err(|_| "master-shutdown-failed")?;
    }
    if let Some(recorder) = app.try_state::<Arc<research_recorder::RecorderService>>() {
        recorder.shutdown();
    }
    if let Some(input) = app.try_state::<Arc<ResearchInputService>>() {
        research_shutdown::observe(research_shutdown::Phase::InputStarted);
        input.shutdown();
        research_shutdown::observe(research_shutdown::Phase::InputCompleted);
    }
    Ok(())
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

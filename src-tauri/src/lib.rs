#![deny(unsafe_op_in_unsafe_fn)]
#![deny(clippy::undocumented_unsafe_blocks)]

mod research_clock;
mod research_commands;
mod research_contracts;
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
pub mod research_planner_recipe_policy;
mod research_platform;
pub mod research_protocol;
pub mod research_questionnaire_recipe;
mod research_run_storage;
mod research_runtime;
mod research_stimulus_order;
mod research_timing;
mod research_workspace;
pub mod research_xr_layout;

use research_input::ResearchInputService;
use research_native_media::NativeMediaService;
use research_native_protocol::runtime::PackageProtocolRuntime;
use research_platform::NATIVE_ACQUISITION_SUPPORTED;
use research_runtime::ResearchRuntime;
use research_workspace::WorkspaceService;
use std::sync::Arc;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let workspace = Arc::new(
                WorkspaceService::with_default_workspace(app_data_dir.clone())
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
            let runtime = Arc::new(ResearchRuntime::with_services(
                Arc::clone(&workspace),
                Arc::clone(&native_media),
                Arc::clone(&input),
            ));
            let package_runtime = Arc::new(PackageProtocolRuntime::with_services(
                Arc::clone(&workspace),
                Arc::clone(&native_media),
                Arc::clone(&input),
            ));
            app.manage(workspace);
            app.manage(native_media);
            app.manage(input);
            app.manage(runtime);
            app.manage(package_runtime);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "research" {
                if matches!(event, WindowEvent::Destroyed) {
                    if let Some(runtime) = window.try_state::<Arc<PackageProtocolRuntime>>() {
                        runtime.shutdown();
                    }
                    if let Some(runtime) = window.try_state::<Arc<ResearchRuntime>>() {
                        // The runtime must close its input-acceptance barrier and
                        // checkpoint recovery before native input authority stops.
                        runtime.shutdown();
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
        })
        .invoke_handler(tauri::generate_handler![
            research_commands::research_source_capabilities,
            research_commands::research_native_media_capability,
            research_commands::research_native_media_status,
            research_commands::research_native_media_prepare,
            research_commands::research_native_media_set_viewport,
            research_commands::research_native_media_play,
            research_commands::research_native_media_attest_decode,
            research_commands::research_native_media_pause,
            research_commands::research_native_media_stop,
            research_commands::research_native_protocol_capability,
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
            research_commands::research_protocol_preflight,
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
            research_commands::research_rescan_stimuli,
            research_commands::research_video_library,
            research_commands::research_save_stimulus_order,
            research_commands::research_import_library_videos,
            research_commands::research_export_video_library,
            research_commands::research_rescan_package_stimuli,
            research_commands::research_import_stimuli,
            research_commands::research_workspace_media_url,
            research_commands::research_attest_workspace_decode,
            research_commands::research_save_settings,
            research_commands::research_store_questionnaire_asset,
            research_commands::research_storage_readiness,
            research_commands::research_export_assignment_plan,
            research_commands::research_lsl_readiness,
            research_commands::research_start_protocol_run,
            research_commands::research_resume_protocol_run,
            research_commands::research_finalize_protocol_recovery,
            research_commands::research_start_run,
            research_commands::research_resume_run,
            research_commands::research_finalize_recovery,
            research_commands::research_run_status,
            research_commands::research_set_stimulus_state,
            research_commands::research_finish_run,
            research_commands::research_report_media_failure,
            research_commands::research_recoveries,
            research_commands::research_participant_states,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Affect Research");

    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            if let Some(runtime) = app.try_state::<Arc<PackageProtocolRuntime>>() {
                runtime.shutdown();
            }
            if let Some(runtime) = app.try_state::<Arc<ResearchRuntime>>() {
                runtime.shutdown();
            }
            if let Some(input) = app.try_state::<Arc<ResearchInputService>>() {
                input.shutdown();
            }
            if let Some(native_media) = app.try_state::<Arc<NativeMediaService>>() {
                native_media.shutdown();
            }
        }
    });
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

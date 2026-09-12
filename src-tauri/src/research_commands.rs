use crate::research_contracts::{
    DirectionV1, InputBindingV1, ResearchSettingsV1, ResolvedAssignmentPlanV1,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{
    parse_canonical_experiment_package_text, parse_experiment_package_bytes,
    LoadedExperimentPackageReceipt, SavedExperimentPackageReceipt, EXPERIMENT_PACKAGE_FILE_NAME,
    MAX_EXPERIMENT_PACKAGE_BYTES,
};
use crate::research_external_protocol::{
    parse_experiment_definition_bytes, LoadedExperimentReceipt, MAX_EXPERIMENT_DEFINITION_BYTES,
};
use crate::research_input::{
    NativeInputCapability, NativeInputRegionRequest, NativeInputStatus, ResearchInputService,
};
use crate::research_lsl::{probe_readiness, LslReadiness};
use crate::research_native_media::{
    NativeMediaCapability, NativeMediaCommandFenceV1, NativeMediaPrepareReceiptV1,
    NativeMediaService, NativeMediaStatusV1, NativeMediaViewportCssV1, NativeMediaViewportPxV1,
    PlaybackMode,
};
use crate::research_participant::TransientParticipant;
use crate::research_platform::{require_native_acquisition, NATIVE_ACQUISITION_SUPPORTED};
use crate::research_protocol::{
    native_protocol_capability, native_protocol_runtime_unavailable, protocol_preflight,
    NativeProtocolCapability, ProtocolPreflightReceipt, ResearchSettingsDocument,
    ResearchSettingsV2, ResearchSettingsV3, ResolvedProtocolPlanV1,
};
use crate::research_runtime::{
    FinalizeReceipt, FinalizeRecoveryRequest, FinishOutcome, MediaPlaybackFailureReceipt,
    MediaPlaybackFailureReport, ParticipantTileStatus, RecoveryListing, ResearchRuntime,
    ResumeRunRequest, RunStatus, StartRunReceipt, StartRunRequest, StimulusStateUpdate,
    WorkspaceFileBinding,
};
use crate::research_workspace::{
    source_capabilities, AssignmentPlanExportReceipt, DecodeAttestationRequest,
    ImportSelectionKind, MediaUrlReceipt, QuestionnaireAssetReceipt, RescanResult,
    SavedSettingsReceipt, ScannedStimulusSummary, SourceCapabilities, StorageReadiness,
    WorkspaceLocation, WorkspaceService, WorkspaceStatus,
};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_SETTINGS_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;

#[tauri::command]
pub async fn research_video_library(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    confirm: bool,
) -> ResearchResult<crate::research_stimulus_order::AuthoringReceipt> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || workspace.video_library(&workspace_id, confirm))
        .await
        .map_err(CommandError::io)?
}

#[tauri::command]
pub async fn research_save_stimulus_order(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    document: crate::research_stimulus_order::variants::StoredStimulusOrder,
) -> ResearchResult<crate::research_stimulus_order::AuthoringReceipt> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || {
        workspace.save_stimulus_order(&workspace_id, document)
    })
    .await
    .map_err(CommandError::io)?
}

#[tauri::command]
pub async fn research_import_library_videos(
    window: WebviewWindow,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    selection_kind: ImportSelectionKind,
) -> ResearchResult<Option<crate::research_stimulus_order::AuthoringReceipt>> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || {
        let selections = match selection_kind {
            ImportSelectionKind::Videos => app
                .dialog()
                .file()
                .add_filter(
                    "Video stimuli",
                    &["mp4", "webm", "mov", "m4v", "avi", "mkv", "ogv"],
                )
                .blocking_pick_files(),
            ImportSelectionKind::Folder => app
                .dialog()
                .file()
                .blocking_pick_folder()
                .map(|selection| vec![selection]),
        };
        let Some(selections) = selections else {
            return Ok(None);
        };
        let paths = selections
            .into_iter()
            .map(|selection| {
                selection
                    .into_path()
                    .map_err(|_| CommandError::forbidden("Imported videos must be local files."))
            })
            .collect::<ResearchResult<Vec<_>>>()?;
        Ok(Some(
            workspace.import_authoring_videos(&workspace_id, paths)?,
        ))
    })
    .await
    .map_err(CommandError::io)?
}

#[tauri::command]
pub async fn research_export_video_library(
    window: WebviewWindow,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    library_sha256: String,
    format: crate::research_stimulus_order::export::LibraryFormat,
) -> ResearchResult<bool> {
    authorize(&window)?;
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = workspace.export_video_library(&workspace_id, &library_sha256, format)?;
        let Some(selection) = app
            .dialog()
            .file()
            .add_filter("Video library", &[format.extension()])
            .set_file_name(format!("video-library.{}", format.extension()))
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selection
            .into_path()
            .map_err(|_| CommandError::forbidden("The export destination must be a local file."))?;
        crate::research_stimulus_order::export::write_export(&path, format, &bytes)?;
        Ok(true)
    })
    .await
    .map_err(CommandError::io)?
}

#[tauri::command]
pub async fn research_export_video_catalogue(
    window: WebviewWindow,
    role: State<'_, crate::research_desktop::DesktopRole>,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    catalogue: serde_json::Value,
    library_sha256: String,
    format: crate::research_stimulus_order::export::LibraryFormat,
) -> ResearchResult<bool> {
    authorize(&window)?;
    let role = *role;
    let app = tauri::Manager::app_handle(&window).clone();
    let workspace = Arc::clone(&workspace);
    tauri::async_runtime::spawn_blocking(move || {
        export_video_catalogue_with_picker(
            role,
            &workspace,
            &workspace_id,
            &catalogue,
            &library_sha256,
            format,
            |format| {
                app.dialog()
                    .file()
                    .add_filter("Video library", &[format.extension()])
                    .set_file_name(format!("video-library.{}", format.extension()))
                    .blocking_save_file()
                    .map(|selection| {
                        selection.into_path().map_err(|_| {
                            CommandError::forbidden("The export destination must be a local file.")
                        })
                    })
                    .transpose()
            },
        )
    })
    .await
    .map_err(CommandError::io)?
}

fn export_video_catalogue_with_picker(
    role: crate::research_desktop::DesktopRole,
    workspace: &WorkspaceService,
    workspace_id: &str,
    catalogue: &serde_json::Value,
    library_sha256: &str,
    format: crate::research_stimulus_order::export::LibraryFormat,
    pick: impl FnOnce(
        crate::research_stimulus_order::export::LibraryFormat,
    ) -> ResearchResult<Option<std::path::PathBuf>>,
) -> ResearchResult<bool> {
    if role != crate::research_desktop::DesktopRole::Planner {
        return Err(CommandError::forbidden(
            "Video catalogue export is restricted to Experiment Planner.",
        ));
    }
    let verified = workspace.validate_planner_video_catalogue(workspace_id, catalogue)?;
    let bytes =
        crate::research_stimulus_order::export::catalogue_bytes(&verified, library_sha256, format)?;
    let Some(path) = pick(format)? else {
        return Ok(false);
    };
    // The native dialog can remain open while the workspace or media changes.
    // Recheck through P1 before the create-new writer receives a destination.
    workspace.validate_planner_video_catalogue(workspace_id, catalogue)?;
    crate::research_stimulus_order::export::write_export(&path, format, &bytes)?;
    Ok(true)
}

#[cfg(test)]
mod catalogue_export_tests {
    use super::*;
    use crate::research_desktop::DesktopRole;
    use crate::research_stimulus_order::{
        export::{catalogue_bytes, LibraryFormat},
        location_variants::LocationLibrary,
    };
    use crate::research_video_geometry::{
        NativeDisplayMetadataReceiptV1, NativeVideoOrientationV1, VideoRatioV1,
        NATIVE_DISPLAY_METADATA_SCHEMA,
    };
    use std::cell::Cell;
    use std::path::PathBuf;

    struct Fixture {
        base: PathBuf,
        service: WorkspaceService,
        id: String,
        video: PathBuf,
        catalogue: serde_json::Value,
        hash: String,
    }
    impl Fixture {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!(
                "affect-research-catalogue-export-{}",
                Uuid::new_v4()
            ));
            fs::create_dir_all(&base).unwrap();
            let service = WorkspaceService::new(base.join("app-data")).unwrap();
            let root = base.join("workspace");
            fs::create_dir(&root).unwrap();
            let id = service.select(root.clone()).unwrap().workspace_id.unwrap();
            let video = root.join("assets/stimuli/session_a/clip.mp4");
            fs::create_dir_all(video.parent().unwrap()).unwrap();
            fs::write(&video, b"synthetic catalogue export media").unwrap();
            let scan = service.rescan_planner_videos(&id).unwrap();
            let item = &scan.stimuli[0];
            // This is a test-only software attestation, not decoded-media or
            // installed GStreamer evidence. Production receipts stay P1-owned.
            let summary = service
                .attest_native_decode(
                    &id,
                    &item.sha256,
                    item.byte_length,
                    &item.mime_type,
                    &crate::research_native_media::NativeMediaDecodeReceiptV1 {
                        schema: "affect-research-native-media-decode-receipt",
                        version: 1,
                        session_id: Uuid::new_v4().to_string(),
                        generation: 1,
                        media_grant_id: Uuid::new_v4().to_string(),
                        workspace_file_id: item.workspace_file_id.clone(),
                        duration_ms: 1000.0,
                        video_width: 1920,
                        video_height: 1080,
                        audio_stream_count: 1,
                        decoded_positions_ms: vec![100.0, 500.0, 900.0],
                        decoded_snapshot_count: 3,
                        display_metadata: NativeDisplayMetadataReceiptV1 {
                            schema: NATIVE_DISPLAY_METADATA_SCHEMA,
                            version: 1,
                            encoded_width_px: 1920,
                            encoded_height_px: 1080,
                            pixel_aspect_ratio: VideoRatioV1 {
                                numerator: 1,
                                denominator: 1,
                            },
                            orientation: NativeVideoOrientationV1::Identity,
                            snapshot_width_px: 1920,
                            snapshot_height_px: 1080,
                            snapshot_pixel_aspect_ratio: VideoRatioV1 {
                                numerator: 1,
                                denominator: 1,
                            },
                        },
                    },
                )
                .unwrap();
            let source = summary.source.as_ref().unwrap();
            let mut catalogue = serde_json::json!({"schema":"affect-research-video-catalogue-contribution","version":2,"revision":1,
            "annotationPolicy":"relative-path-reversible-v1","entries":[{
                "assetId":format!("asset-{}",item.sha256),"annotationId":"session%5Fa_clip.mp4",
                "sourceRelativePath":source.relative_path,"packageRelativePath":format!("assets/{}",source.relative_path),
                "sha256":item.sha256,"byteLength":item.byte_length,"durationMs":1000,"geometry":summary.display_geometry
            }]});
            catalogue["integritySha256"] = serde_json::json!(
                crate::research_contracts::canonical_sha256(&catalogue, &[]).unwrap()
            );
            let validated = service
                .validate_planner_video_catalogue(&id, &catalogue)
                .unwrap();
            let hash = LocationLibrary::from_catalogue(&validated)
                .unwrap()
                .integrity_sha256;
            Self {
                base,
                service,
                id,
                video,
                catalogue,
                hash,
            }
        }
        fn export(
            &self,
            format: LibraryFormat,
            pick: impl FnOnce(LibraryFormat) -> ResearchResult<Option<PathBuf>>,
        ) -> ResearchResult<bool> {
            export_video_catalogue_with_picker(
                DesktopRole::Planner,
                &self.service,
                &self.id,
                &self.catalogue,
                &self.hash,
                format,
                pick,
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let resolved = fs::canonicalize(&self.base).unwrap();
            let temp = fs::canonicalize(std::env::temp_dir()).unwrap();
            assert_eq!(resolved.parent(), Some(temp.as_path()));
            assert!(resolved
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("affect-research-catalogue-export-"));
            fs::remove_dir_all(resolved).unwrap();
        }
    }
    #[test]
    fn planner_role_and_current_catalogue_are_required_before_picker() {
        let fixture = Fixture::new();
        let invoked = Cell::new(false);
        let pick = |_| {
            invoked.set(true);
            Ok(None)
        };
        let denied = export_video_catalogue_with_picker(
            DesktopRole::Runner,
            &fixture.service,
            "wrong-workspace",
            &serde_json::Value::Null,
            "wrong-hash",
            LibraryFormat::Csv,
            pick,
        )
        .unwrap_err();
        assert_eq!(denied.code, "forbidden_operation");
        assert!(denied.message.contains("Experiment Planner"));
        assert!(!invoked.get());
        for (catalogue, hash, id) in [
            (
                &serde_json::Value::Null,
                fixture.hash.as_str(),
                fixture.id.as_str(),
            ),
            (&fixture.catalogue, "wrong-hash", fixture.id.as_str()),
            (&fixture.catalogue, fixture.hash.as_str(), "wrong-workspace"),
        ] {
            assert!(export_video_catalogue_with_picker(
                DesktopRole::Planner,
                &fixture.service,
                id,
                catalogue,
                hash,
                LibraryFormat::Csv,
                |_| {
                    invoked.set(true);
                    Ok(None)
                }
            )
            .is_err());
            assert!(!invoked.get());
        }
    }
    #[test]
    fn cancellation_and_verified_csv_xlsx_exports_use_the_named_destination() {
        let fixture = Fixture::new();
        assert!(!fixture.export(LibraryFormat::Csv, |_| Ok(None)).unwrap());
        let catalogue = fixture
            .service
            .validate_planner_video_catalogue(&fixture.id, &fixture.catalogue)
            .unwrap();
        for format in [LibraryFormat::Csv, LibraryFormat::Xlsx] {
            let path = fixture
                .base
                .join(format!("selected-name.{}", format.extension()));
            assert!(!path.exists());
            assert!(fixture
                .export(format, |selected| {
                    assert_eq!(selected.extension(), format.extension());
                    Ok(Some(path.clone()))
                })
                .unwrap());
            assert_eq!(
                fs::read(&path).unwrap(),
                catalogue_bytes(&catalogue, &fixture.hash, format).unwrap()
            );
        }
    }
    #[test]
    fn wrong_extension_and_existing_destination_are_preserved() {
        let fixture = Fixture::new();
        let wrong = fixture.base.join("wrong.txt");
        assert!(fixture
            .export(LibraryFormat::Csv, |_| Ok(Some(wrong.clone())))
            .is_err());
        assert!(!wrong.exists());
        let existing = fixture.base.join("existing.csv");
        fs::write(&existing, b"retain this file").unwrap();
        assert!(fixture
            .export(LibraryFormat::Csv, |_| Ok(Some(existing.clone())))
            .is_err());
        assert_eq!(fs::read(existing).unwrap(), b"retain this file");
    }
    #[test]
    fn media_or_workspace_changes_during_picker_write_nothing() {
        for change in ["bytes", "workspace"] {
            let fixture = Fixture::new();
            let destination = fixture.base.join("must-not-write.xlsx");
            assert!(fixture
                .export(LibraryFormat::Xlsx, |_| {
                    if change == "bytes" {
                        fs::write(&fixture.video, b"replacement media").unwrap();
                    } else {
                        let next = fixture.base.join("other-workspace");
                        fs::create_dir(&next).unwrap();
                        fixture.service.select(next).unwrap();
                    }
                    Ok(Some(destination.clone()))
                })
                .is_err());
            assert!(!destination.exists());
        }
    }
}

fn authorize(window: &WebviewWindow) -> ResearchResult<()> {
    if window.label() != "research" {
        return Err(CommandError::forbidden(
            "This command is restricted to the Affect Research window.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn research_source_capabilities(window: WebviewWindow) -> ResearchResult<SourceCapabilities> {
    authorize(&window)?;
    Ok(source_capabilities())
}

#[tauri::command]
pub fn research_native_media_capability(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
) -> ResearchResult<NativeMediaCapability> {
    authorize(&window)?;
    Ok(native_media.capability())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeMediaPrepareRequestV1 {
    pub workspace_id: String,
    pub workspace_file_id: String,
    pub sha256: String,
    pub byte_length: u64,
    pub mime_type: String,
    pub viewport: NativeMediaViewportCssV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeMediaViewportRequestV1 {
    pub fence: NativeMediaCommandFenceV1,
    pub viewport: NativeMediaViewportCssV1,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeMediaDecodeAttestationRequestV1 {
    pub workspace_id: String,
    pub workspace_file_id: String,
    pub sha256: String,
    pub byte_length: u64,
    pub mime_type: String,
    pub fence: NativeMediaCommandFenceV1,
}

#[tauri::command]
pub fn research_native_media_status(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    native_media.status()
}

#[tauri::command]
pub fn research_native_media_prepare(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    native_media: State<'_, Arc<NativeMediaService>>,
    request: NativeMediaPrepareRequestV1,
) -> ResearchResult<NativeMediaPrepareReceiptV1> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let viewport = physical_media_viewport(&window, request.viewport)?;
    let grant = workspace.issue_native_media_grant(
        &request.workspace_id,
        &request.workspace_file_id,
        &request.sha256,
        request.byte_length,
        &request.mime_type,
    )?;
    native_media.prepare(grant, viewport)
}

#[tauri::command]
pub fn research_native_media_set_viewport(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
    request: NativeMediaViewportRequestV1,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let viewport = physical_media_viewport(&window, request.viewport)?;
    native_media.set_viewport(request.fence, viewport)
}

#[tauri::command]
pub fn research_native_media_play(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
    fence: NativeMediaCommandFenceV1,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    native_media.play(fence)
}

#[tauri::command]
pub fn research_native_media_attest_decode(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    native_media: State<'_, Arc<NativeMediaService>>,
    request: NativeMediaDecodeAttestationRequestV1,
) -> ResearchResult<ScannedStimulusSummary> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let receipt = native_media.attest_decode(request.fence)?;
    if receipt.workspace_file_id != request.workspace_file_id {
        return Err(CommandError::forbidden(
            "Native decode evidence returned a different workspace identity.",
        ));
    }
    workspace.attest_native_decode(
        &request.workspace_id,
        &request.sha256,
        request.byte_length,
        &request.mime_type,
        &receipt,
    )
}

#[tauri::command]
pub fn research_native_media_pause(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
    fence: NativeMediaCommandFenceV1,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    native_media.pause(fence)
}

#[tauri::command]
pub fn research_native_media_stop(
    window: WebviewWindow,
    native_media: State<'_, Arc<NativeMediaService>>,
    fence: NativeMediaCommandFenceV1,
) -> ResearchResult<NativeMediaStatusV1> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    native_media.stop(fence)
}

fn physical_media_viewport(
    window: &WebviewWindow,
    viewport: NativeMediaViewportCssV1,
) -> ResearchResult<NativeMediaViewportPxV1> {
    let scale_factor = window.scale_factor().map_err(CommandError::io)?;
    let size = window.inner_size().map_err(CommandError::io)?;
    viewport.to_physical(scale_factor, size.width, size.height)
}

#[tauri::command]
pub fn research_native_protocol_capability(
    window: WebviewWindow,
) -> ResearchResult<NativeProtocolCapability> {
    authorize(&window)?;
    Ok(native_protocol_capability())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolPreflightRequest {
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
}

#[tauri::command]
pub fn research_protocol_preflight(
    window: WebviewWindow,
    request: ProtocolPreflightRequest,
) -> ResearchResult<ProtocolPreflightReceipt> {
    authorize(&window)?;
    protocol_preflight(
        request.research_settings,
        request.assignment_plan,
        request.resolved_protocol_plan,
    )
}

#[tauri::command]
pub fn research_input_capability(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
) -> ResearchResult<NativeInputCapability> {
    authorize(&window)?;
    Ok(input.capability())
}

#[tauri::command]
pub fn research_input_set_region(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
    region: NativeInputRegionRequest,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    let origin = window.inner_position().map_err(CommandError::io)?;
    let size = window.inner_size().map_err(CommandError::io)?;
    input.set_region(
        region,
        f64::from(origin.x),
        f64::from(origin.y),
        f64::from(size.width),
        f64::from(size.height),
    )
}

#[tauri::command]
pub fn research_input_begin_test(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
    binding: InputBindingV1,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    input.begin_test(binding)
}

#[tauri::command]
pub fn research_input_begin_capture(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
    binding: InputBindingV1,
    direction: DirectionV1,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    input.begin_capture(binding, direction)
}

#[tauri::command]
pub fn research_input_status(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    Ok(input.status())
}

#[tauri::command]
pub fn research_input_cancel_setup(
    window: WebviewWindow,
    input: State<'_, Arc<ResearchInputService>>,
) -> ResearchResult<NativeInputStatus> {
    authorize(&window)?;
    Ok(input.cancel_setup())
}

#[tauri::command]
pub fn research_workspace_status(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
) -> ResearchResult<WorkspaceStatus> {
    authorize(&window)?;
    Ok(workspace.status())
}

#[tauri::command]
pub fn research_rescan_package_stimuli(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    source_text: String,
) -> ResearchResult<RescanResult> {
    authorize(&window)?;
    let receipt = parse_canonical_experiment_package_text(&source_text)?;
    workspace.rescan_package(&workspace_id, &receipt.package)
}

#[tauri::command]
pub async fn research_choose_workspace(
    window: WebviewWindow,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceService>>,
) -> ResearchResult<WorkspaceStatus> {
    authorize(&window)?;
    let Some(selection) = app.dialog().file().blocking_pick_folder() else {
        return Ok(workspace.status());
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The selected workspace is not a local folder."))?;
    workspace.select(path)
}

#[tauri::command]
pub fn research_open_workspace_location(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    location: WorkspaceLocation,
) -> ResearchResult<()> {
    authorize(&window)?;
    workspace.open_location(&workspace_id, location)
}

#[tauri::command]
pub async fn research_load_settings(
    window: WebviewWindow,
    app: AppHandle,
) -> ResearchResult<Option<LoadedSettingsReceipt>> {
    authorize(&window)?;
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Affect Research settings", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The selected settings file is not local."))?;
    let file = File::open(path).map_err(CommandError::io)?;
    let metadata = file.metadata().map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_SETTINGS_DOCUMENT_BYTES as u64
    {
        return Err(CommandError::invalid_contract(
            "The settings file is unavailable, empty, or exceeds 5 MiB.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_SETTINGS_DOCUMENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    Ok(Some(decode_settings_bytes(&bytes)?))
}

#[tauri::command]
pub async fn research_load_experiment(
    window: WebviewWindow,
    app: AppHandle,
) -> ResearchResult<Option<LoadedExperimentReceipt>> {
    authorize(&window)?;
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Affect Research experiment", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The selected experiment file is not local."))?;
    let file = File::open(path).map_err(CommandError::io)?;
    let metadata = file.metadata().map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_EXPERIMENT_DEFINITION_BYTES as u64
    {
        return Err(CommandError::invalid_contract(
            "experiment.json is unavailable, empty, or exceeds 5 MiB.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_EXPERIMENT_DEFINITION_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    Ok(Some(parse_experiment_definition_bytes(&bytes)?))
}

#[tauri::command]
pub async fn research_load_experiment_package(
    window: WebviewWindow,
    app: AppHandle,
) -> ResearchResult<Option<LoadedExperimentPackageReceipt>> {
    authorize(&window)?;
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Affect Research experiment package", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The selected package is not a local file."))?;
    let file = File::open(path).map_err(CommandError::io)?;
    let metadata = file.metadata().map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_EXPERIMENT_PACKAGE_BYTES as u64
    {
        return Err(CommandError::invalid_contract(
            "The experiment package is unavailable, empty, or exceeds its byte limit.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_EXPERIMENT_PACKAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    Ok(Some(parse_experiment_package_bytes(&bytes)?))
}

#[tauri::command]
pub async fn research_save_experiment_package(
    window: WebviewWindow,
    app: AppHandle,
    source_text: String,
) -> ResearchResult<Option<SavedExperimentPackageReceipt>> {
    authorize(&window)?;
    let receipt = parse_canonical_experiment_package_text(&source_text)?;
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Affect Research experiment package", &["json"])
        .set_file_name(EXPERIMENT_PACKAGE_FILE_NAME)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::forbidden("The package destination is not a local file."))?;
    write_selected_package(&path, receipt.canonical_source_text.as_bytes())?;
    Ok(Some(SavedExperimentPackageReceipt::from_loaded(&receipt)?))
}

fn write_selected_package(path: &Path, bytes: &[u8]) -> ResearchResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("The package destination has no parent folder."))?;
    if !parent.is_dir() {
        return Err(CommandError::forbidden(
            "The package destination folder is unavailable.",
        ));
    }
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(CommandError::forbidden(
                "The package destination must be a regular file.",
            ));
        }
    }

    let staging = parent.join(format!(".affect-research-{}.staging", Uuid::new_v4()));
    let write_result = (|| -> ResearchResult<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
            .map_err(CommandError::io)?;
        file.write_all(bytes).map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)?;
        drop(file);

        if path.exists() {
            let backup = parent.join(format!(".affect-research-{}.backup", Uuid::new_v4()));
            fs::rename(path, &backup).map_err(CommandError::io)?;
            if let Err(error) = fs::rename(&staging, path) {
                let _ = fs::rename(&backup, path);
                return Err(CommandError::io(error));
            }
            fs::remove_file(backup).map_err(CommandError::io)?;
        } else {
            fs::rename(&staging, path).map_err(CommandError::io)?;
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(staging);
    }
    write_result
}

fn decode_settings_bytes(bytes: &[u8]) -> ResearchResult<LoadedSettingsReceipt> {
    if bytes.is_empty() || bytes.len() > MAX_SETTINGS_DOCUMENT_BYTES {
        return Err(CommandError::invalid_contract(
            "The settings file is unavailable, empty, or exceeds 5 MiB.",
        ));
    }
    if let Ok(settings) = serde_json::from_slice::<ResearchSettingsV3>(bytes) {
        return Ok(LoadedSettingsReceipt {
            settings: Some(ResearchSettingsDocument::V3(
                settings.normalize_and_validate()?,
            )),
            legacy_settings: None,
            report: SettingsLoadReport::research_v3(),
        });
    }
    if let Ok(settings) = serde_json::from_slice::<ResearchSettingsV2>(bytes) {
        return Ok(LoadedSettingsReceipt {
            settings: Some(ResearchSettingsDocument::V2(
                settings.normalize_and_validate()?,
            )),
            legacy_settings: None,
            report: SettingsLoadReport::research_v2(),
        });
    }
    if let Ok(settings) = serde_json::from_slice::<ResearchSettingsV1>(bytes) {
        return Ok(LoadedSettingsReceipt {
            settings: Some(ResearchSettingsDocument::V1(
                settings.normalize_and_validate()?,
            )),
            legacy_settings: None,
            report: SettingsLoadReport::research_v1(),
        });
    }
    if bytes.len() > 1_000_000 {
        return Err(CommandError::invalid_contract(
            "Portable legacy settings exceed the one-megabyte explicit-import limit.",
        ));
    }
    let legacy: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| {
        CommandError::invalid_contract(
            "The selected file is neither ResearchSettingsV3/ResearchSettingsV2/ResearchSettingsV1 nor bounded portable version 1 JSON.",
        )
    })?;
    if legacy.get("schema").is_some() {
        return Err(CommandError::invalid_contract(
            "A malformed Research settings document cannot be reinterpreted as portable legacy settings.",
        ));
    }
    if !legacy.is_object() || legacy.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err(CommandError::invalid_contract(
            "Explicit legacy import requires one portable settings version-1 object.",
        ));
    }
    // Canonicalization rejects unsupported values and bounds the renderer payload.
    crate::research_contracts::canonical_json(&legacy, &[])?;
    Ok(LoadedSettingsReceipt {
        settings: None,
        legacy_settings: Some(legacy),
        report: SettingsLoadReport::legacy(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettingsReceipt {
    pub settings: Option<ResearchSettingsDocument>,
    pub legacy_settings: Option<serde_json::Value>,
    pub report: SettingsLoadReport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadReport {
    pub schema: &'static str,
    pub version: u32,
    pub source_kind: &'static str,
    pub requires_explicit_import: bool,
    pub defaults: Vec<String>,
    pub discarded: Vec<String>,
}

impl SettingsLoadReport {
    fn research_v3() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "researchV3",
            requires_explicit_import: false,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }

    fn research_v1() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "researchV1",
            requires_explicit_import: false,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }

    fn research_v2() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "researchV2",
            requires_explicit_import: false,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }

    fn legacy() -> Self {
        Self {
            schema: "affect-research-settings-load-report",
            version: 1,
            source_kind: "portableLegacyV1",
            requires_explicit_import: true,
            defaults: Vec::new(),
            discarded: Vec::new(),
        }
    }
}

#[tauri::command]
pub async fn research_rescan_stimuli(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
) -> ResearchResult<RescanResult> {
    authorize(&window)?;
    workspace.rescan_planner_videos(&workspace_id)
}

#[tauri::command]
pub async fn research_import_stimuli(
    window: WebviewWindow,
    app: AppHandle,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    selection_kind: ImportSelectionKind,
) -> ResearchResult<Option<RescanResult>> {
    authorize(&window)?;
    let selections = match selection_kind {
        ImportSelectionKind::Videos => app
            .dialog()
            .file()
            .add_filter(
                "Video stimuli",
                &["mp4", "webm", "mov", "m4v", "avi", "mkv"],
            )
            .blocking_pick_files(),
        ImportSelectionKind::Folder => app
            .dialog()
            .file()
            .blocking_pick_folder()
            .map(|selection| vec![selection]),
    };
    let Some(selections) = selections else {
        return Ok(None);
    };
    let paths = selections
        .into_iter()
        .map(|selection| {
            selection.into_path().map_err(|_| {
                CommandError::forbidden("An imported selection is not a local filesystem item.")
            })
        })
        .collect::<ResearchResult<Vec<_>>>()?;
    Ok(Some(workspace.import_paths(&workspace_id, paths)?))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn research_workspace_media_url(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    workspace_file_id: String,
    sha256: String,
    byte_length: u64,
    mime_type: String,
) -> ResearchResult<MediaUrlReceipt> {
    authorize(&window)?;
    workspace.issue_media_url(
        &workspace_id,
        &workspace_file_id,
        &sha256,
        byte_length,
        &mime_type,
    )
}

#[tauri::command]
pub fn research_attest_workspace_decode(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    attestation: DecodeAttestationRequest,
) -> ResearchResult<ScannedStimulusSummary> {
    authorize(&window)?;
    workspace.attest_workspace_decode(attestation)
}

#[tauri::command]
pub fn research_save_settings(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    settings: ResearchSettingsDocument,
) -> ResearchResult<SavedSettingsReceipt> {
    authorize(&window)?;
    workspace.save_settings_document(&workspace_id, settings)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionnaireAssetStoreRequest {
    pub workspace_id: String,
    pub family_id: String,
    pub language_tag: String,
    pub format: String,
    pub source_sha256: String,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub fn research_store_questionnaire_asset(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    request: QuestionnaireAssetStoreRequest,
) -> ResearchResult<QuestionnaireAssetReceipt> {
    authorize(&window)?;
    workspace.store_questionnaire_asset(
        &request.workspace_id,
        &request.family_id,
        &request.language_tag,
        &request.format,
        &request.source_sha256,
        &request.bytes,
    )
}

#[tauri::command]
pub fn research_storage_readiness(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    required_bytes: u64,
) -> ResearchResult<StorageReadiness> {
    authorize(&window)?;
    workspace.storage_readiness(&workspace_id, required_bytes)
}

#[tauri::command]
pub fn research_export_assignment_plan(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    workspace_id: String,
    settings: ResearchSettingsV1,
    assignment_plan: ResolvedAssignmentPlanV1,
) -> ResearchResult<AssignmentPlanExportReceipt> {
    authorize(&window)?;
    workspace.export_assignment_plan(&workspace_id, settings, assignment_plan)
}

#[tauri::command]
pub fn research_lsl_readiness(
    window: WebviewWindow,
    settings: ResearchSettingsV1,
) -> ResearchResult<LslReadiness> {
    authorize(&window)?;
    let settings = settings.normalize_and_validate()?;
    Ok(probe_readiness(
        &settings.advanced.lsl,
        settings.experiment.sampling_frequency_hz,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartProtocolRunRequest {
    pub workspace_id: String,
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
    pub participant: TransientParticipant,
    pub workspace_files: Vec<WorkspaceFileBinding>,
    pub rerun_confirmed: bool,
    pub input_test_receipt_id: String,
    pub playback_mode: PlaybackMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeProtocolRunRequest {
    pub workspace_id: String,
    pub recovery_id: String,
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
    pub workspace_files: Vec<WorkspaceFileBinding>,
    pub input_test_receipt_id: String,
    pub playback_mode: PlaybackMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalizeProtocolRecoveryRequest {
    pub workspace_id: String,
    pub recovery_id: String,
    pub research_settings: ResearchSettingsV2,
    pub assignment_plan: ResolvedAssignmentPlanV1,
    pub resolved_protocol_plan: ResolvedProtocolPlanV1,
}

#[tauri::command]
pub fn research_start_protocol_run(
    window: WebviewWindow,
    request: StartProtocolRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let StartProtocolRunRequest {
        workspace_id,
        research_settings,
        assignment_plan,
        resolved_protocol_plan,
        participant,
        workspace_files,
        rerun_confirmed,
        input_test_receipt_id,
        playback_mode,
    } = request;
    validate_protocol_run_envelope(
        &workspace_id,
        &input_test_receipt_id,
        playback_mode,
        &workspace_files,
        &research_settings,
        &resolved_protocol_plan,
    )?;
    let _rerun_was_explicitly_confirmed = rerun_confirmed;
    if participant.participant_id != resolved_protocol_plan.participant_id {
        return Err(CommandError::invalid_contract(
            "The transient participant does not match the resolved questionnaire protocol.",
        ));
    }
    if participant.age == 0 || participant.age > 120 || participant.participant_code.is_empty() {
        return Err(CommandError::invalid_contract(
            "The transient participant metadata is invalid.",
        ));
    }
    let _demographic_codes = (participant.gender, participant.handedness);
    protocol_preflight(research_settings, assignment_plan, resolved_protocol_plan)?;
    Err(native_protocol_runtime_unavailable())
}

#[tauri::command]
pub fn research_resume_protocol_run(
    window: WebviewWindow,
    request: ResumeProtocolRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let ResumeProtocolRunRequest {
        workspace_id,
        recovery_id,
        research_settings,
        assignment_plan,
        resolved_protocol_plan,
        workspace_files,
        input_test_receipt_id,
        playback_mode,
    } = request;
    validate_protocol_run_envelope(
        &workspace_id,
        &input_test_receipt_id,
        playback_mode,
        &workspace_files,
        &research_settings,
        &resolved_protocol_plan,
    )?;
    validate_canonical_uuid(&recovery_id, "recoveryId")?;
    protocol_preflight(research_settings, assignment_plan, resolved_protocol_plan)?;
    Err(native_protocol_runtime_unavailable())
}

#[tauri::command]
pub fn research_finalize_protocol_recovery(
    window: WebviewWindow,
    request: FinalizeProtocolRecoveryRequest,
) -> ResearchResult<FinalizeReceipt> {
    authorize(&window)?;
    require_native_acquisition(NATIVE_ACQUISITION_SUPPORTED)?;
    let FinalizeProtocolRecoveryRequest {
        workspace_id,
        recovery_id,
        research_settings,
        assignment_plan,
        resolved_protocol_plan,
    } = request;
    validate_canonical_uuid(&workspace_id, "workspaceId")?;
    validate_canonical_uuid(&recovery_id, "recoveryId")?;
    protocol_preflight(research_settings, assignment_plan, resolved_protocol_plan)?;
    Err(native_protocol_runtime_unavailable())
}

fn validate_protocol_run_envelope(
    workspace_id: &str,
    input_test_receipt_id: &str,
    playback_mode: PlaybackMode,
    workspace_files: &[WorkspaceFileBinding],
    research_settings: &ResearchSettingsV2,
    protocol_plan: &ResolvedProtocolPlanV1,
) -> ResearchResult<()> {
    validate_canonical_uuid(workspace_id, "workspaceId")?;
    validate_canonical_uuid(input_test_receipt_id, "inputTestReceiptId")?;
    if playback_mode == PlaybackMode::NativeLibvlc {
        return Err(CommandError::invalid_contract(
            "The retired nativeLibvlc mode cannot start a questionnaire protocol.",
        ));
    }
    if workspace_files.is_empty() || workspace_files.len() > crate::research_contracts::MAX_STIMULI
    {
        return Err(CommandError::invalid_contract(
            "workspaceFiles must bind every assigned stimulus within supported bounds.",
        ));
    }
    let mut stimulus_ids = std::collections::BTreeSet::new();
    let mut file_ids = std::collections::BTreeSet::new();
    for binding in workspace_files {
        if binding.stimulus_id.is_empty()
            || !binding.workspace_file_id.starts_with("wf-")
            || binding.workspace_file_id.len() != 27
            || !binding.workspace_file_id[3..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            || !stimulus_ids.insert(binding.stimulus_id.as_str())
            || !file_ids.insert(binding.workspace_file_id.as_str())
        {
            return Err(CommandError::invalid_contract(
                "workspaceFiles contains an invalid or repeated opaque binding.",
            ));
        }
    }
    let expected_stimulus_ids = protocol_plan
        .steps
        .iter()
        .filter_map(|step| match step {
            crate::research_protocol::ProtocolStepV1::Stimulus { stimulus_id, .. } => {
                Some(stimulus_id.as_str())
            }
            crate::research_protocol::ProtocolStepV1::Questionnaire { .. } => None,
        })
        .collect::<std::collections::BTreeSet<_>>();
    for stimulus_id in &expected_stimulus_ids {
        let stimulus = research_settings
            .stimuli
            .items
            .iter()
            .find(|stimulus| stimulus.stimulus_id == *stimulus_id)
            .ok_or_else(|| {
                CommandError::invalid_contract(
                    "The resolved protocol references an unknown stimulus.",
                )
            })?;
        if !matches!(
            &stimulus.source,
            crate::research_contracts::StimulusSourceV1::WorkspaceFile { .. }
        ) {
            return Err(CommandError::unsupported_source(
                "Questionnaire-aware native Start currently accepts only workspace-file stimuli.",
            ));
        }
    }
    if stimulus_ids != expected_stimulus_ids {
        return Err(CommandError::invalid_contract(
            "workspaceFiles must exactly equal the selected participant protocol stimuli.",
        ));
    }
    Ok(())
}

fn validate_canonical_uuid(value: &str, label: &str) -> ResearchResult<()> {
    match uuid::Uuid::parse_str(value) {
        Ok(uuid) if uuid.to_string() == value => Ok(()),
        _ => Err(CommandError::invalid_contract(format!(
            "{label} must be a canonical UUID."
        ))),
    }
}

#[tauri::command]
pub fn research_start_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    request: StartRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    runtime.start_run(request)
}

#[tauri::command]
pub fn research_resume_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    request: ResumeRunRequest,
) -> ResearchResult<StartRunReceipt> {
    authorize(&window)?;
    runtime.resume_run(request)
}

#[tauri::command]
pub fn research_finalize_recovery(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    request: FinalizeRecoveryRequest,
) -> ResearchResult<FinalizeReceipt> {
    authorize(&window)?;
    runtime.finalize_recovery(request)
}

#[tauri::command]
pub fn research_run_status(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
) -> ResearchResult<RunStatus> {
    authorize(&window)?;
    Ok(runtime.status())
}

#[tauri::command]
pub fn research_set_stimulus_state(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    update: StimulusStateUpdate,
) -> ResearchResult<()> {
    authorize(&window)?;
    runtime.set_webview_stimulus_state(update)
}

#[tauri::command]
pub fn research_finish_run(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    run_id: String,
    outcome: FinishOutcome,
) -> ResearchResult<FinalizeReceipt> {
    authorize(&window)?;
    runtime.finish(&run_id, outcome)
}

#[tauri::command]
pub fn research_report_media_failure(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    report: MediaPlaybackFailureReport,
) -> ResearchResult<MediaPlaybackFailureReceipt> {
    authorize(&window)?;
    runtime.report_webview_media_failure(report)
}

#[tauri::command]
pub fn research_recoveries(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    workspace_id: String,
) -> ResearchResult<RecoveryListing> {
    authorize(&window)?;
    runtime.list_recoveries(&workspace_id)
}

#[tauri::command]
pub fn research_participant_states(
    window: WebviewWindow,
    runtime: State<'_, Arc<ResearchRuntime>>,
    workspace_id: String,
    settings: ResearchSettingsV1,
) -> ResearchResult<Vec<ParticipantTileStatus>> {
    authorize(&window)?;
    runtime.participant_states(&workspace_id, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_surface_contains_no_path_argument_types() {
        // Keep this assertion near the boundary as a visible security invariant.
        let names = [
            "research_choose_workspace",
            "research_open_workspace_location",
            "research_source_capabilities",
            "research_native_media_capability",
            "research_native_media_status",
            "research_native_media_prepare",
            "research_native_media_set_viewport",
            "research_native_media_play",
            "research_native_media_attest_decode",
            "research_native_media_pause",
            "research_native_media_stop",
            "research_native_protocol_capability",
            "research_protocol_preflight",
            "research_input_capability",
            "research_input_set_region",
            "research_input_begin_test",
            "research_input_begin_capture",
            "research_input_status",
            "research_input_cancel_setup",
            "research_workspace_status",
            "research_load_settings",
            "research_load_experiment",
            "research_load_experiment_package",
            "research_save_experiment_package",
            "research_rescan_stimuli",
            "research_import_stimuli",
            "research_workspace_media_url",
            "research_attest_workspace_decode",
            "research_save_settings",
            "research_store_questionnaire_asset",
            "research_storage_readiness",
            "research_export_assignment_plan",
            "research_lsl_readiness",
            "research_start_protocol_run",
            "research_resume_protocol_run",
            "research_finalize_protocol_recovery",
            "research_start_run",
            "research_resume_run",
            "research_finalize_recovery",
            "research_run_status",
            "research_set_stimulus_state",
            "research_finish_run",
            "research_report_media_failure",
            "research_recoveries",
            "research_participant_states",
        ];
        assert!(names.iter().all(|name| name.starts_with("research_")));
    }

    #[test]
    fn questionnaire_asset_store_request_is_closed_and_uses_camel_case() {
        let request = serde_json::from_value::<QuestionnaireAssetStoreRequest>(serde_json::json!({
            "workspaceId": "workspace-id",
            "familyId": "maia-2",
            "languageTag": "de",
            "format": "json",
            "sourceSha256": "0".repeat(64),
            "bytes": [123, 125]
        }))
        .unwrap();
        assert_eq!(request.workspace_id, "workspace-id");
        assert_eq!(request.family_id, "maia-2");
        assert_eq!(request.language_tag, "de");
        assert_eq!(request.format, "json");
        assert_eq!(request.bytes, vec![123, 125]);

        assert!(
            serde_json::from_value::<QuestionnaireAssetStoreRequest>(serde_json::json!({
                "workspaceId": "workspace-id",
                "familyId": "maia-2",
                "languageTag": "de",
                "format": "json",
                "sourceSha256": "0".repeat(64),
                "bytes": [123, 125],
                "path": "C:/outside.json"
            }))
            .is_err()
        );
    }

    #[test]
    fn settings_loader_distinguishes_strict_research_from_explicit_legacy() {
        let research = crate::research_contracts::tests::default_settings()
            .normalize_and_validate()
            .unwrap();
        let receipt = decode_settings_bytes(
            &crate::research_contracts::canonical_json(&research, &[]).unwrap(),
        )
        .unwrap();
        assert!(receipt.settings.is_some());
        assert!(receipt.legacy_settings.is_none());
        assert!(!receipt.report.requires_explicit_import);
        assert_eq!(receipt.report.source_kind, "researchV1");

        let v3 = crate::research_protocol::tests::external_settings();
        let v3_receipt =
            decode_settings_bytes(&crate::research_contracts::canonical_json(&v3, &[]).unwrap())
                .unwrap();
        assert!(matches!(
            v3_receipt.settings,
            Some(ResearchSettingsDocument::V3(_))
        ));
        assert!(v3_receipt.legacy_settings.is_none());
        assert!(!v3_receipt.report.requires_explicit_import);
        assert_eq!(v3_receipt.report.source_kind, "researchV3");

        let v2 = ResearchSettingsV2 {
            schema: crate::research_contracts::RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 2,
            experiment: research.experiment.clone(),
            stimuli: research.stimuli.clone(),
            input: research.input.clone(),
            visual: research.visual.clone(),
            advanced: research.advanced.clone(),
            output: research.output.clone(),
            questionnaires: crate::research_protocol::QuestionnaireSettingsV2 {
                algorithm_version: crate::research_protocol::QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION
                    .to_owned(),
                definitions: Vec::new(),
                modules: Vec::new(),
            },
        }
        .normalize_and_validate()
        .unwrap();
        let v2_receipt =
            decode_settings_bytes(&crate::research_contracts::canonical_json(&v2, &[]).unwrap())
                .unwrap();
        assert!(matches!(
            v2_receipt.settings,
            Some(ResearchSettingsDocument::V2(_))
        ));
        assert_eq!(v2_receipt.report.source_kind, "researchV2");

        let legacy = decode_settings_bytes(br#"{"version":1,"stepSize":0.2}"#).unwrap();
        assert!(legacy.settings.is_none());
        assert!(legacy.legacy_settings.is_some());
        assert!(legacy.report.requires_explicit_import);

        let malformed_research =
            br#"{"schema":"affect-research-settings","version":1,"unknown":true}"#;
        assert!(decode_settings_bytes(malformed_research).is_err());
        assert!(decode_settings_bytes(&[]).is_err());
        assert!(decode_settings_bytes(&vec![b' '; MAX_SETTINGS_DOCUMENT_BYTES + 1]).is_err());
    }

    #[test]
    fn selected_package_writer_replaces_only_a_regular_selected_file() {
        let root =
            std::env::temp_dir().join(format!("affect-research-package-writer-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let target = root.join("experiment.package.json");
        write_selected_package(&target, b"first\n").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first\n");
        write_selected_package(&target, b"second\n").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second\n");

        let directory_target = root.join("not-a-file.json");
        fs::create_dir(&directory_target).unwrap();
        assert!(write_selected_package(&directory_target, b"blocked\n").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

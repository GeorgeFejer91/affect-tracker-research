use crate::research_contracts::{
    canonical_json, normalize_identifier, resolve_assignment_plan_v1, validate_sha256,
    ResearchSettingsV1, ResolvedAssignmentPlanV1, RESEARCH_NAMESPACE,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{ExperimentPackageV1, EXPERIMENT_PACKAGE_FILE_NAME};
use crate::research_protocol::ResearchSettingsDocument;
use crate::research_video_geometry::{derive_native_display_geometry_v1, NativeDisplayGeometryV1};
use crate::research_workspace_contribution::{
    validate_video_catalogue_contribution, VideoCatalogueContribution,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::http::{header, Method, Request, Response, StatusCode};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

mod controlled_geometry;
mod stimulus_authoring;
pub(crate) use controlled_geometry::RunnerVideoBindingV3;

const MAX_SCAN_DEPTH: usize = 16;
const MAX_SCAN_FILES: usize = 10_000;
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "m4v", "avi", "mkv"];
const MAX_PROTOCOL_CHUNK: u64 = 8 * 1024 * 1024;
const MAX_QUESTIONNAIRE_SOURCE_BYTES: usize = 5 * 1024 * 1024;
const WORKSPACE_LIBRARY_NAMES: [&str; 4] = ["stimuli", "settings", "outputs", "recovery"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub selected: bool,
    pub workspace_id: Option<String>,
    pub display_name: Option<String>,
    pub namespace: &'static str,
    pub stimuli_count: usize,
    pub libraries_ready: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceLocation {
    WorkspaceRoot,
    VideoLibrary,
    ExperimentPackage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedStimulusSummary<G = NativeDisplayGeometryV1> {
    pub workspace_file_id: String,
    pub display_name: String,
    pub sha256: String,
    pub byte_length: u64,
    pub mime_type: String,
    pub duration_ms: Option<f64>,
    pub decode_status: DecodeStatus,
    pub decode_backend: Option<DecodeBackend>,
    pub decode_attestation: Option<DecodeEvidence>,
    pub decoded_positions_ms: Vec<f64>,
    pub display_geometry: Option<G>,
    pub source: Option<WorkspaceSourceContract>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSourceContract {
    pub kind: &'static str,
    pub relative_path: String,
    pub mime_type: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DecodeStatus {
    Unverified,
    AttestedUnqualified,
    AttestedQualified,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DecodeBackend {
    WebviewVideoFrameCallback,
    NativeGstPlay,
    NativeLibvlc,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DecodeEvidence {
    RepresentativeFramesV1,
    NativeDecodedSnapshotsV1,
    NativeDecodedSnapshotsV2,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanResult {
    pub workspace_id: String,
    pub stimuli: Vec<ScannedStimulusSummary>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportSelectionKind {
    Videos,
    Folder,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUrlReceipt {
    pub media_grant_id: String,
    pub workspace_file_id: String,
    pub media_url: String,
    pub byte_length: u64,
    pub mime_type: String,
    pub duration_ms: Option<f64>,
    pub decode_status: DecodeStatus,
    pub decode_backend: Option<DecodeBackend>,
    pub decode_attestation: Option<DecodeEvidence>,
    pub decoded_positions_ms: Vec<f64>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DecodeAttestationKind {
    AttestRepresentativeFramesV1,
    RevokeGrant,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecodeAttestationRequest {
    pub attestation_kind: DecodeAttestationKind,
    pub decode_backend: DecodeBackend,
    pub workspace_id: String,
    pub media_grant_id: String,
    pub workspace_file_id: String,
    pub sha256: String,
    pub byte_length: u64,
    pub mime_type: String,
    pub observed_duration_ms: Option<f64>,
    pub video_width: Option<u32>,
    pub video_height: Option<u32>,
    pub muted_playback_ms: Option<f64>,
    #[serde(default)]
    pub decoded_positions_ms: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentPlanExportReceipt {
    pub file_name: String,
    pub sha256: String,
    pub byte_length: u64,
    pub row_count: u64,
    pub plan_hash_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReadiness {
    pub available_bytes: u64,
    pub required_bytes: u64,
    pub sufficient: bool,
    pub write_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCapabilities {
    pub workspace_file: SourceCapability,
    pub repository_asset: SourceCapability,
    pub youtube: SourceCapability,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCapability {
    pub supported: bool,
    pub selection_enabled: bool,
    pub reason_code: &'static str,
    pub requires_decode_attestation: bool,
}

pub fn source_capabilities() -> SourceCapabilities {
    SourceCapabilities {
        workspace_file: SourceCapability {
            supported: true,
            selection_enabled: true,
            reason_code: "supported",
            requires_decode_attestation: true,
        },
        repository_asset: SourceCapability {
            supported: false,
            selection_enabled: false,
            reason_code: "repository-assets-not-packaged-in-alpha-1",
            requires_decode_attestation: true,
        },
        youtube: SourceCapability {
            supported: false,
            selection_enabled: false,
            reason_code: "youtube-tauri-feasibility-unqualified",
            requires_decode_attestation: true,
        },
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ScannedStimulus {
    pub id: String,
    pub path: PathBuf,
    pub logical_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub mime_type: String,
    pub duration_ms: Option<f64>,
    pub decode_status: DecodeStatus,
    pub decode_backend: Option<DecodeBackend>,
    pub decode_attestation: Option<DecodeEvidence>,
    pub decoded_positions_ms: Vec<f64>,
    pub display_geometry: Option<NativeDisplayGeometryV1>,
    pub native_decode_receipt_v2: Option<crate::research_native_media::NativeMediaDecodeReceiptV2>,
}

#[derive(Debug, Clone)]
struct MediaGrant {
    file: Arc<Mutex<File>>,
    workspace_file_id: String,
    sha256: String,
    mime_type: String,
    byte_length: u64,
}

/// Exact, locked workspace media authority passed only between Rust modules.
/// Neither the path nor the file handle is serializable, so the WebView can
/// receive only the opaque identifiers exposed by the native-media actor.
#[derive(Debug)]
#[cfg_attr(
    not(all(target_os = "windows", feature = "native-gstreamer")),
    allow(dead_code)
)]
pub(crate) struct NativeMediaGrant {
    pub(crate) media_grant_id: String,
    pub(crate) workspace_file_id: String,
    pub(crate) path: PathBuf,
    pub(crate) file: File,
    pub(crate) sha256: String,
    pub(crate) mime_type: String,
    pub(crate) byte_length: u64,
}

/// Exact native binding for one already-authored portable catalogue location.
/// This remains Rust-internal: the path and file handle never enter the recipe
/// or WebView, while Runner can address the currently verified opaque file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunnerVideoBinding {
    pub(crate) asset_id: String,
    pub(crate) annotation_id: String,
    pub(crate) source_relative_path: String,
    pub(crate) workspace_file_id: String,
    pub(crate) sha256: String,
    pub(crate) byte_length: u64,
    pub(crate) mime_type: String,
    pub(crate) duration_ms: u64,
    pub(crate) display_geometry: NativeDisplayGeometryV1,
}

#[derive(Debug)]
struct SelectedWorkspace {
    id: String,
    root: PathBuf,
    root_identity: DirectoryIdentity,
    libraries: WorkspaceLibraries,
    display_name: String,
    scanned: Vec<ScannedStimulus>,
    media_grants: HashMap<String, MediaGrant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspaceLibraries {
    stimuli: PathBuf,
    settings: PathBuf,
    outputs: PathBuf,
    recovery: PathBuf,
    package_assets: PathBuf,
    questionnaire_assets: PathBuf,
    identities: [DirectoryIdentity; 4],
    package_assets_identity: DirectoryIdentity,
    questionnaire_assets_identity: DirectoryIdentity,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectoryIdentity {
    #[cfg(target_os = "windows")]
    creation_time: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(not(any(target_os = "windows", unix)))]
    created: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum WorkspaceOpenTarget {
    OpenDirectory(PathBuf),
    RevealFile(PathBuf),
}

#[derive(Debug)]
pub struct WorkspaceService {
    selected: Mutex<Option<SelectedWorkspace>>,
}

impl WorkspaceService {
    pub fn new(app_data_dir: PathBuf) -> ResearchResult<Self> {
        let namespace = app_data_dir.join("affect-research").join("v1");
        fs::create_dir_all(&namespace).map_err(CommandError::io)?;
        Ok(Self {
            selected: Mutex::new(None),
        })
    }

    pub fn with_default_workspace(app_data_dir: PathBuf) -> ResearchResult<Self> {
        let service = Self::new(app_data_dir.clone())?;
        let workspace_path = app_data_dir.join("workspace");
        match fs::symlink_metadata(&workspace_path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err(CommandError::forbidden(
                    "The default workspace must be an ordinary directory.",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&workspace_path).map_err(CommandError::io)?;
            }
            Err(error) => return Err(CommandError::io(error)),
        }
        // Packaged Windows hosts may redirect app-data descendants into the
        // package's LocalCache. Resolve the OS-owned location after creation,
        // then apply the normal strict workspace/library validation there.
        let workspace = workspace_path.canonicalize().map_err(CommandError::io)?;
        service.select(workspace)?;
        Ok(service)
    }

    pub fn status(&self) -> WorkspaceStatus {
        let guard = self.lock_selected();
        match guard.as_ref() {
            Some(workspace) => {
                let libraries_ready = validate_selected_workspace(workspace).is_ok();
                WorkspaceStatus {
                    selected: true,
                    workspace_id: Some(workspace.id.clone()),
                    display_name: Some(workspace.display_name.clone()),
                    namespace: RESEARCH_NAMESPACE,
                    stimuli_count: workspace.scanned.len(),
                    libraries_ready,
                }
            }
            None => WorkspaceStatus {
                selected: false,
                workspace_id: None,
                display_name: None,
                namespace: RESEARCH_NAMESPACE,
                stimuli_count: 0,
                libraries_ready: false,
            },
        }
    }

    pub fn select(&self, path: PathBuf) -> ResearchResult<WorkspaceStatus> {
        let root = path
            .canonicalize()
            .map_err(|_| CommandError::forbidden("The selected workspace is unavailable."))?;
        if !root.is_dir() {
            return Err(CommandError::forbidden(
                "The selected workspace must be a directory.",
            ));
        }
        let libraries = ensure_workspace_libraries(&root)?;
        let root_identity =
            directory_identity(&fs::symlink_metadata(&root).map_err(CommandError::io)?);
        let display_name = root
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Research workspace")
            .to_owned();
        let selected = SelectedWorkspace {
            id: Uuid::new_v4().to_string(),
            root,
            root_identity,
            libraries,
            display_name,
            scanned: Vec::new(),
            media_grants: HashMap::new(),
        };
        *self.lock_selected() = Some(selected);
        Ok(self.status())
    }

    pub fn open_location(
        &self,
        workspace_id: &str,
        location: WorkspaceLocation,
    ) -> ResearchResult<()> {
        match self.resolve_open_location(workspace_id, location)? {
            WorkspaceOpenTarget::OpenDirectory(path) => {
                tauri_plugin_opener::open_path(path, None::<&str>).map_err(CommandError::io)
            }
            WorkspaceOpenTarget::RevealFile(path) => {
                tauri_plugin_opener::reveal_item_in_dir(path).map_err(CommandError::io)
            }
        }
    }

    fn resolve_open_location(
        &self,
        workspace_id: &str,
        location: WorkspaceLocation,
    ) -> ResearchResult<WorkspaceOpenTarget> {
        let guard = self.lock_selected();
        let workspace = selected_ref(&guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        Ok(match location {
            WorkspaceLocation::WorkspaceRoot => {
                WorkspaceOpenTarget::OpenDirectory(workspace.root.clone())
            }
            WorkspaceLocation::VideoLibrary => {
                WorkspaceOpenTarget::OpenDirectory(libraries.package_assets)
            }
            WorkspaceLocation::ExperimentPackage => {
                let package = workspace.root.join(EXPERIMENT_PACKAGE_FILE_NAME);
                match fs::symlink_metadata(&package) {
                    Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                        WorkspaceOpenTarget::RevealFile(package)
                    }
                    _ => WorkspaceOpenTarget::OpenDirectory(workspace.root.clone()),
                }
            }
        })
    }

    pub fn rescan(&self, workspace_id: &str) -> ResearchResult<RescanResult> {
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        workspace.scanned = scan_videos(&workspace.root)?;
        workspace.media_grants.clear();
        let stimuli = workspace.scanned.iter().map(scanned_summary).collect();
        Ok(RescanResult {
            workspace_id: workspace.id.clone(),
            stimuli,
        })
    }

    /// Scans the Planner's one canonical video library. Historical Run-side
    /// `stimuli/` readers remain unchanged; new authoring imparts no authority
    /// to that legacy directory.
    pub fn rescan_planner_videos(&self, workspace_id: &str) -> ResearchResult<RescanResult> {
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        workspace.scanned = scan_planner_videos(&libraries.package_assets)?;
        workspace.media_grants.clear();
        Ok(RescanResult {
            workspace_id: workspace.id.clone(),
            stimuli: workspace.scanned.iter().map(scanned_summary).collect(),
        })
    }

    /// Validates one P1 v2 catalogue against the exact currently selected,
    /// freshly readable and natively qualified Planner media closure. This is
    /// the safe Rust seam for P3 export and P7 persistence; it grants no path.
    pub fn validate_planner_video_catalogue(
        &self,
        workspace_id: &str,
        value: &serde_json::Value,
    ) -> ResearchResult<VideoCatalogueContribution> {
        let catalogue = validate_video_catalogue_contribution(value)?;
        if catalogue.version != 2 {
            return Err(CommandError::invalid_contract(
                "Current Planner catalogue authority requires video catalogue v2.",
            ));
        }
        let guard = self.lock_selected();
        let workspace = selected_ref(&guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        let current = scan_planner_videos(&libraries.package_assets)?;
        if catalogue.entries.len() != workspace.scanned.len()
            || catalogue.entries.len() != current.len()
        {
            return Err(CommandError::forbidden(
                "The current Planner video library does not match the accepted catalogue.",
            ));
        }
        for entry in &catalogue.entries {
            let matches = workspace
                .scanned
                .iter()
                .filter(|candidate| candidate.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let [candidate] = matches.as_slice() else {
                return Err(CommandError::forbidden(
                    "A catalogue location does not resolve to one current Planner video.",
                ));
            };
            let current_matches = current
                .iter()
                .filter(|observed| observed.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let [observed] = current_matches.as_slice() else {
                return Err(CommandError::forbidden(
                    "A catalogue location does not resolve to one current ordinary Planner video.",
                ));
            };
            let observed_duration_ms = candidate.duration_ms.filter(|value| {
                value.is_finite()
                    && *value >= 1.0
                    && value.fract() == 0.0
                    && *value <= crate::research_contracts::MAX_SAFE_INTEGER as f64
            });
            let observed_geometry = candidate.display_geometry.as_ref().ok_or_else(|| {
                CommandError::forbidden(
                    "A current Planner video has no verified oriented display geometry.",
                )
            })?;
            if candidate.decode_status != DecodeStatus::AttestedQualified
                || candidate.decode_backend != Some(DecodeBackend::NativeGstPlay)
                || candidate.decode_attestation != Some(DecodeEvidence::NativeDecodedSnapshotsV1)
                || observed.path != candidate.path
                || observed.sha256 != entry.sha256
                || observed.sha256 != candidate.sha256
                || observed.byte_length != entry.byte_length
                || observed.byte_length != candidate.byte_length
                || entry.asset_id != format!("asset-{}", observed.sha256)
                || entry.package_relative_path != format!("assets/{}", entry.source_relative_path)
                || observed_duration_ms.map(|value| value as u64) != Some(entry.duration_ms)
                || serde_json::to_value(observed_geometry).map_err(|_| {
                    CommandError::invalid_contract(
                        "Planner display geometry could not be validated.",
                    )
                })? != serde_json::to_value(&entry.geometry).map_err(|_| {
                    CommandError::invalid_contract(
                        "Catalogue display geometry could not be validated.",
                    )
                })?
            {
                return Err(CommandError::forbidden(
                    "A current Planner video no longer matches the accepted catalogue.",
                ));
            }
        }
        Ok(catalogue)
    }

    /// Rebinds one saved, strictly validated video catalogue to the exact
    /// currently selected and natively qualified Planner media closure.
    /// Portable browser/native provenance may differ, so only the reproducible
    /// oriented dimensions and reduced display aspect are compared. The actual
    /// native evidence and opaque file identifier are returned to Runner.
    pub(crate) fn validate_runner_video_catalogue(
        &self,
        workspace_id: &str,
        value: &serde_json::Value,
    ) -> ResearchResult<Vec<RunnerVideoBinding>> {
        let catalogue = validate_video_catalogue_contribution(value)?;
        let guard = self.lock_selected();
        let workspace = selected_ref(&guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        let current = scan_planner_videos(&libraries.package_assets)?;
        if catalogue.entries.len() != workspace.scanned.len()
            || catalogue.entries.len() != current.len()
        {
            return Err(CommandError::forbidden(
                "The current Runner video library does not match the saved catalogue.",
            ));
        }

        let mut bindings = Vec::with_capacity(catalogue.entries.len());
        for entry in catalogue.entries {
            let stored_matches = workspace
                .scanned
                .iter()
                .filter(|candidate| candidate.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let [candidate] = stored_matches.as_slice() else {
                return Err(CommandError::forbidden(
                    "A saved catalogue location does not resolve to one natively qualified video.",
                ));
            };
            let current_matches = current
                .iter()
                .filter(|observed| observed.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let [observed] = current_matches.as_slice() else {
                return Err(CommandError::forbidden(
                    "A saved catalogue location does not resolve to one current ordinary video.",
                ));
            };
            let duration_ms = candidate.duration_ms.filter(|duration| {
                duration.is_finite()
                    && *duration >= 1.0
                    && duration.fract() == 0.0
                    && *duration <= crate::research_contracts::MAX_SAFE_INTEGER as f64
            });
            let Some(duration_ms) = duration_ms.map(|duration| duration as u64) else {
                return Err(CommandError::forbidden(
                    "A saved catalogue video has no exact native duration.",
                ));
            };
            let geometry = candidate.display_geometry.as_ref().ok_or_else(|| {
                CommandError::forbidden(
                    "A saved catalogue video has no verified native oriented geometry.",
                )
            })?;
            let geometry_matches = entry.geometry.display_width_px
                == u64::from(geometry.display_width_px)
                && entry.geometry.display_height_px == u64::from(geometry.display_height_px)
                && entry.geometry.display_aspect.numerator
                    == u64::from(geometry.display_aspect.numerator)
                && entry.geometry.display_aspect.denominator
                    == u64::from(geometry.display_aspect.denominator);
            if candidate.decode_status != DecodeStatus::AttestedQualified
                || candidate.decode_backend != Some(DecodeBackend::NativeGstPlay)
                || candidate.decode_attestation != Some(DecodeEvidence::NativeDecodedSnapshotsV1)
                || observed.id != candidate.id
                || observed.path != candidate.path
                || observed.sha256 != candidate.sha256
                || observed.byte_length != candidate.byte_length
                || observed.mime_type != candidate.mime_type
                || entry.asset_id != format!("asset-{}", observed.sha256)
                || entry.sha256 != observed.sha256
                || entry.byte_length != observed.byte_length
                || entry.duration_ms != duration_ms
                || !geometry_matches
            {
                return Err(CommandError::forbidden(
                    "A current native Runner video no longer matches the saved catalogue.",
                ));
            }
            bindings.push(RunnerVideoBinding {
                asset_id: entry.asset_id,
                annotation_id: entry.annotation_id,
                source_relative_path: entry.source_relative_path,
                workspace_file_id: candidate.id.clone(),
                sha256: candidate.sha256.clone(),
                byte_length: candidate.byte_length,
                mime_type: candidate.mime_type.clone(),
                duration_ms,
                display_geometry: geometry.clone(),
            });
        }
        Ok(bindings)
    }

    /// Resolves the complete, declared package media closure beneath the fixed
    /// `assets/stimuli/` root. Any extra, missing, linked, unreadable, or
    /// byte-mismatched file fails before the catalogue can be qualified.
    pub fn rescan_package(
        &self,
        workspace_id: &str,
        package: &ExperimentPackageV1,
    ) -> ResearchResult<RescanResult> {
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        workspace.scanned = scan_package_videos(&libraries.package_assets, package)?;
        workspace.media_grants.clear();
        Ok(RescanResult {
            workspace_id: workspace.id.clone(),
            stimuli: workspace.scanned.iter().map(scanned_summary).collect(),
        })
    }

    pub fn save_settings_document(
        &self,
        workspace_id: &str,
        settings: ResearchSettingsDocument,
    ) -> ResearchResult<SavedSettingsReceipt> {
        let settings = settings.normalize_and_validate()?;
        let questionnaire_definitions = match &settings {
            ResearchSettingsDocument::V3(settings) => Some(&settings.questionnaires.definitions),
            ResearchSettingsDocument::V2(settings) => Some(&settings.questionnaires.definitions),
            ResearchSettingsDocument::V1(_) => None,
        };
        let questionnaire_tables = questionnaire_definitions
            .into_iter()
            .flatten()
            .map(|definition| {
                Ok((
                    format!(
                        "{}.{}.csv",
                        definition.questionnaire_id, definition.definition_sha256
                    ),
                    definition.canonical_csv_bytes()?,
                ))
            })
            .collect::<ResearchResult<Vec<_>>>()?;
        let bytes = canonical_json(&settings, &[])?;
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        if !questionnaire_tables.is_empty() {
            let questionnaire_directory = workspace.root.join("settings").join("questionnaires");
            ensure_owned_directory(&questionnaire_directory)?;
            for (file_name, table) in questionnaire_tables {
                write_create_new_or_verify(&questionnaire_directory.join(file_name), &table)?;
            }
        }
        let file_name = format!("{}.settings.json", settings.experiment_id());
        let target = workspace.root.join("settings").join(&file_name);
        write_replacing(&target, &bytes)?;
        Ok(SavedSettingsReceipt {
            workspace_id: workspace.id.clone(),
            file_name,
            settings_sha256: format!("{:x}", Sha256::digest(&bytes)),
        })
    }

    pub fn store_questionnaire_asset(
        &self,
        workspace_id: &str,
        family_id: &str,
        language_tag: &str,
        format: &str,
        source_sha256: &str,
        bytes: &[u8],
    ) -> ResearchResult<QuestionnaireAssetReceipt> {
        if bytes.is_empty() || bytes.len() > MAX_QUESTIONNAIRE_SOURCE_BYTES {
            return Err(CommandError::invalid_contract(
                "A questionnaire source must contain 1 byte–5 MiB.",
            ));
        }
        let safe_family = normalize_identifier(family_id, "questionnaire family ID")?;
        let safe_language = normalize_identifier(language_tag, "questionnaire language tag")?;
        if safe_family != family_id || safe_language != language_tag {
            return Err(CommandError::invalid_contract(
                "Questionnaire asset folders require canonical lowercase identifiers.",
            ));
        }
        let extension = match format {
            "csv" => "csv",
            "txt" => "txt",
            "json" => "json",
            _ => {
                return Err(CommandError::invalid_contract(
                    "Questionnaire source format must be csv, txt, or json.",
                ))
            }
        };
        validate_sha256(source_sha256, "questionnaire source SHA-256")?;
        let observed_sha256 = format!("{:x}", Sha256::digest(bytes));
        if observed_sha256 != source_sha256 {
            return Err(CommandError::invalid_contract(
                "Questionnaire source bytes do not match their declared SHA-256.",
            ));
        }
        let file_name = format!("{source_sha256}.{extension}");
        self.with_workspace(workspace_id, |root, _| {
            let libraries = validate_workspace_libraries(root)?;
            let family =
                ensure_exact_child_directory(&libraries.questionnaire_assets, &safe_family)?;
            let language = ensure_exact_child_directory(&family, &safe_language)?;
            let target = language.join(&file_name);
            if let Ok(metadata) = fs::symlink_metadata(&target) {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(CommandError::forbidden(
                        "A stored questionnaire source must be an ordinary file.",
                    ));
                }
            }
            write_create_new_or_verify(&target, bytes)?;
            let (stored_sha256, byte_length) = hash_file(&target)?;
            if stored_sha256 != source_sha256 || byte_length != bytes.len() as u64 {
                return Err(CommandError::forbidden(
                    "The stored questionnaire source does not match its import receipt.",
                ));
            }
            Ok(())
        })?;
        let relative_path =
            format!("assets/questionnaires/{safe_family}/{safe_language}/{file_name}");
        Ok(QuestionnaireAssetReceipt {
            workspace_id: workspace_id.to_owned(),
            family_id: safe_family,
            language_tag: safe_language,
            relative_path,
            source_sha256: source_sha256.to_owned(),
            byte_length: bytes.len() as u64,
        })
    }

    pub fn storage_readiness(
        &self,
        workspace_id: &str,
        required_bytes: u64,
    ) -> ResearchResult<StorageReadiness> {
        if required_bytes > crate::research_contracts::MAX_SAFE_INTEGER {
            return Err(CommandError::invalid_contract(
                "Estimated storage must fit the exact JSON integer range.",
            ));
        }
        self.with_workspace(workspace_id, |root, _| {
            let available_bytes = fs2::available_space(root)
                .map_err(CommandError::io)?
                .min(crate::research_contracts::MAX_SAFE_INTEGER);
            let libraries = validate_workspace_libraries(root)?;
            let write_ready = probe_storage_paths(&libraries).is_ok();
            Ok(StorageReadiness {
                available_bytes,
                required_bytes,
                sufficient: write_ready && available_bytes >= required_bytes,
                write_ready,
            })
        })
    }

    pub fn import_paths(
        &self,
        workspace_id: &str,
        selections: Vec<PathBuf>,
    ) -> ResearchResult<RescanResult> {
        let destination = self.with_workspace(workspace_id, |root, _| {
            let libraries = validate_workspace_libraries(root)?;
            Ok(libraries.package_assets)
        })?;
        let mut sources = collect_import_videos(selections)?;
        sources.sort_by(|left, right| {
            left.relative_path
                .cmp(&right.relative_path)
                .then_with(|| left.source.cmp(&right.source))
        });
        sources.dedup();
        for source in sources {
            import_planner_video(&source, &destination)?;
        }
        self.rescan_planner_videos(workspace_id)
    }

    pub fn issue_media_url(
        &self,
        workspace_id: &str,
        workspace_file_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_mime_type: &str,
    ) -> ResearchResult<MediaUrlReceipt> {
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        let candidate = scanned_candidate(
            &workspace.scanned,
            workspace_file_id,
            expected_sha256,
            expected_byte_length,
            expected_mime_type,
        )?
        .clone();
        let mut locked_file = open_read_locked(&candidate.path)?;
        let (observed_hash, observed_bytes) = hash_open_file(&mut locked_file)?;
        if observed_hash != expected_sha256 || observed_bytes != expected_byte_length {
            return Err(CommandError::forbidden(
                "The workspace stimulus changed after its latest verified scan.",
            ));
        }
        let token = Uuid::new_v4().simple().to_string();
        workspace.media_grants.insert(
            token.clone(),
            MediaGrant {
                file: Arc::new(Mutex::new(locked_file)),
                workspace_file_id: candidate.id.clone(),
                sha256: candidate.sha256.clone(),
                mime_type: candidate.mime_type.clone(),
                byte_length: candidate.byte_length,
            },
        );
        let media_url = if cfg!(any(target_os = "windows", target_os = "android")) {
            format!("http://research-media.localhost/{token}")
        } else {
            format!("research-media://localhost/{token}")
        };
        Ok(MediaUrlReceipt {
            media_grant_id: token,
            workspace_file_id: workspace_file_id.to_owned(),
            media_url,
            byte_length: candidate.byte_length,
            mime_type: candidate.mime_type.clone(),
            duration_ms: candidate.duration_ms,
            decode_status: candidate.decode_status,
            decode_backend: candidate.decode_backend,
            decode_attestation: candidate.decode_attestation,
            decoded_positions_ms: candidate.decoded_positions_ms.clone(),
        })
    }

    pub(crate) fn issue_native_media_grant(
        &self,
        workspace_id: &str,
        workspace_file_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_mime_type: &str,
    ) -> ResearchResult<NativeMediaGrant> {
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        let candidate = scanned_candidate(
            &workspace.scanned,
            workspace_file_id,
            expected_sha256,
            expected_byte_length,
            expected_mime_type,
        )?
        .clone();
        let mut locked_file = open_read_locked(&candidate.path)?;
        let (observed_hash, observed_bytes) = hash_open_file(&mut locked_file)?;
        if observed_hash != expected_sha256 || observed_bytes != expected_byte_length {
            return Err(CommandError::forbidden(
                "The workspace stimulus changed after its latest verified scan.",
            ));
        }
        Ok(NativeMediaGrant {
            media_grant_id: Uuid::new_v4().to_string(),
            workspace_file_id: candidate.id,
            path: candidate.path,
            file: locked_file,
            sha256: candidate.sha256,
            mime_type: candidate.mime_type,
            byte_length: candidate.byte_length,
        })
    }

    pub(crate) fn attest_native_decode(
        &self,
        workspace_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_mime_type: &str,
        receipt: &crate::research_native_media::NativeMediaDecodeReceiptV1,
    ) -> ResearchResult<ScannedStimulusSummary> {
        if receipt.decoded_snapshot_count != 3
            || receipt.decoded_positions_ms.len() != 3
            || receipt.video_width == 0
            || receipt.video_height == 0
            || receipt.video_width > 32_768
            || receipt.video_height > 32_768
            || receipt.display_metadata.encoded_width_px != receipt.video_width
            || receipt.display_metadata.encoded_height_px != receipt.video_height
        {
            return Err(CommandError::invalid_contract(
                "Native GstPlay decode evidence is incomplete.",
            ));
        }
        let display_geometry = derive_native_display_geometry_v1(&receipt.display_metadata)?;
        validate_native_positions(receipt.duration_ms, &receipt.decoded_positions_ms)?;
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        let candidate_index = workspace
            .scanned
            .iter()
            .position(|entry| {
                entry.id == receipt.workspace_file_id
                    && entry.sha256 == expected_sha256
                    && entry.byte_length == expected_byte_length
                    && entry.mime_type == expected_mime_type
            })
            .ok_or_else(|| {
                CommandError::forbidden(
                    "Native decode evidence does not match the latest workspace scan.",
                )
            })?;
        let candidate = &mut workspace.scanned[candidate_index];
        let (observed_hash, observed_bytes) = hash_file(&candidate.path)?;
        if observed_hash != expected_sha256 || observed_bytes != expected_byte_length {
            return Err(CommandError::forbidden(
                "The workspace stimulus changed during native decode preflight.",
            ));
        }
        candidate.duration_ms = Some(receipt.duration_ms.round());
        candidate.decode_status = DecodeStatus::AttestedQualified;
        candidate.decode_backend = Some(DecodeBackend::NativeGstPlay);
        candidate.decode_attestation = Some(DecodeEvidence::NativeDecodedSnapshotsV1);
        candidate.decoded_positions_ms = receipt.decoded_positions_ms.clone();
        candidate.display_geometry = Some(display_geometry);
        candidate.native_decode_receipt_v2 = None;
        Ok(scanned_summary(candidate))
    }

    /// Consumes one exact locked-file grant. WebView frame evidence remains
    /// explicitly unqualified and cannot satisfy a future GstPlay verifier.
    pub fn attest_workspace_decode(
        &self,
        request: DecodeAttestationRequest,
    ) -> ResearchResult<ScannedStimulusSummary> {
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, &request.workspace_id)?;
        validate_selected_workspace(workspace)?;
        let grant = workspace
            .media_grants
            .remove(&request.media_grant_id)
            .ok_or_else(|| CommandError::forbidden("The media probe grant is unavailable."))?;
        if grant.workspace_file_id != request.workspace_file_id
            || grant.sha256 != request.sha256
            || grant.byte_length != request.byte_length
            || grant.mime_type != request.mime_type
        {
            return Err(CommandError::forbidden(
                "Decode evidence does not match the exact native media grant.",
            ));
        }
        let candidate_index = workspace
            .scanned
            .iter()
            .position(|entry| {
                entry.id == request.workspace_file_id
                    && entry.sha256 == request.sha256
                    && entry.byte_length == request.byte_length
                    && entry.mime_type == request.mime_type
            })
            .ok_or_else(|| {
                CommandError::forbidden(
                    "The opaque workspace file and metadata do not match the latest native scan.",
                )
            })?;

        if request.attestation_kind == DecodeAttestationKind::RevokeGrant {
            if request.decode_backend != DecodeBackend::WebviewVideoFrameCallback
                || request.observed_duration_ms.is_some()
                || request.video_width.is_some()
                || request.video_height.is_some()
                || request.muted_playback_ms.is_some()
                || !request.decoded_positions_ms.is_empty()
            {
                return Err(CommandError::invalid_contract(
                    "A media-grant revocation may contain only its exact WebView identity.",
                ));
            }
            return Ok(scanned_summary(&workspace.scanned[candidate_index]));
        }
        if request.decode_backend != DecodeBackend::WebviewVideoFrameCallback {
            return Err(CommandError::invalid_contract(
                "This command accepts only unqualified WebView decoded-frame evidence.",
            ));
        }
        let (
            Some(observed_duration_ms),
            Some(video_width),
            Some(video_height),
            Some(muted_playback_ms),
        ) = (
            request.observed_duration_ms,
            request.video_width,
            request.video_height,
            request.muted_playback_ms,
        )
        else {
            return Err(CommandError::invalid_contract(
                "Representative-frame attestation requires complete duration, dimensions, and muted-playback evidence.",
            ));
        };
        if !observed_duration_ms.is_finite()
            || !(1.0..=86_400_000.0).contains(&observed_duration_ms)
            || video_width == 0
            || video_height == 0
            || video_width > 32_768
            || video_height > 32_768
            || !muted_playback_ms.is_finite()
            || !(50.0..=5_000.0).contains(&muted_playback_ms)
        {
            return Err(CommandError::invalid_contract(
                "Decode attestation requires finite duration, video dimensions, and a short muted playback probe.",
            ));
        }
        validate_representative_positions(observed_duration_ms, &request.decoded_positions_ms)?;
        let (observed_hash, observed_bytes) = {
            let mut locked_file = grant
                .file
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            hash_open_file(&mut locked_file)?
        };
        if observed_hash != request.sha256 || observed_bytes != request.byte_length {
            return Err(CommandError::forbidden(
                "The locked workspace stimulus changed during decode preflight.",
            ));
        }
        let candidate = &mut workspace.scanned[candidate_index];
        candidate.duration_ms = Some(observed_duration_ms);
        candidate.decode_status = DecodeStatus::AttestedUnqualified;
        candidate.decode_backend = Some(DecodeBackend::WebviewVideoFrameCallback);
        candidate.decode_attestation = Some(DecodeEvidence::RepresentativeFramesV1);
        candidate.decoded_positions_ms = request.decoded_positions_ms;
        candidate.display_geometry = None;
        candidate.native_decode_receipt_v2 = None;
        Ok(scanned_summary(candidate))
    }

    pub fn export_assignment_plan(
        &self,
        workspace_id: &str,
        settings: ResearchSettingsV1,
        plan: ResolvedAssignmentPlanV1,
    ) -> ResearchResult<AssignmentPlanExportReceipt> {
        let settings = settings.normalize_and_validate()?;
        let settings_sha256 = settings.canonical_sha256()?;
        plan.validate(&settings_sha256)?;
        if plan.seed != settings.stimuli.seed
            || plan.condition_order != settings.stimuli.condition_order
            || plan.stimuli != settings.stimuli.items
            || plan.pools != settings.stimuli.pools
            || plan.participant_ids.len() != settings.experiment.participant_count as usize
        {
            return Err(CommandError::invalid_contract(
                "The assignment export does not match the normalized settings.",
            ));
        }
        if plan != resolve_assignment_plan_v1(&settings)? {
            return Err(CommandError::invalid_contract(
                "The assignment export differs from the native balanced-v1 reconstruction.",
            ));
        }
        let row_count = plan
            .assignments
            .iter()
            .map(|assignment| assignment.slots.len() as u64)
            .sum::<u64>();
        if row_count > 10_000_000 {
            return Err(CommandError::invalid_contract(
                "The assignment export exceeds ten million rows.",
            ));
        }
        self.with_workspace(workspace_id, |root, _| {
            let file_name = format!("{}.assignment-plan.csv", settings.experiment.id);
            let target = root.join("settings").join(&file_name);
            let staging = root
                .join("settings")
                .join(format!(".{}.staging", Uuid::new_v4()));
            let mut writer = std::io::BufWriter::new(create_new(&staging)?);
            writer
                .write_all(
                    b"participantId,position,poolId,poolPosition,stimulusId,planHashSha256\n",
                )
                .map_err(CommandError::io)?;
            for assignment in &plan.assignments {
                for slot in &assignment.slots {
                    writeln!(
                        writer,
                        "{},{},{},{},{},{}",
                        assignment.participant_id,
                        slot.position,
                        slot.pool_id,
                        slot.pool_position,
                        slot.stimulus_id,
                        plan.plan_hash_sha256
                    )
                    .map_err(CommandError::io)?;
                }
            }
            writer.flush().map_err(CommandError::io)?;
            writer.get_ref().sync_all().map_err(CommandError::io)?;
            drop(writer);
            replace_with_staging(&staging, &target)?;
            let (sha256, byte_length) = hash_file(&target)?;
            Ok(AssignmentPlanExportReceipt {
                file_name,
                sha256,
                byte_length,
                row_count,
                plan_hash_sha256: plan.plan_hash_sha256.clone(),
            })
        })
    }

    pub(crate) fn protocol_response(
        &self,
        webview_label: &str,
        request: Request<Vec<u8>>,
    ) -> Response<Vec<u8>> {
        if webview_label != "research" || !matches!(*request.method(), Method::GET | Method::HEAD) {
            return protocol_error(StatusCode::FORBIDDEN);
        }
        let token = request.uri().path().trim_matches('/');
        if token.len() != 32 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return protocol_error(StatusCode::NOT_FOUND);
        }
        let grant = {
            let guard = self.lock_selected();
            guard.as_ref().and_then(|workspace| {
                validate_selected_workspace(workspace)
                    .ok()
                    .and_then(|_| workspace.media_grants.get(token).cloned())
            })
        };
        let Some(grant) = grant else {
            return protocol_error(StatusCode::NOT_FOUND);
        };
        serve_media(grant, request)
    }

    pub(crate) fn with_workspace<T>(
        &self,
        workspace_id: &str,
        action: impl FnOnce(&Path, &[ScannedStimulus]) -> ResearchResult<T>,
    ) -> ResearchResult<T> {
        let guard = self.lock_selected();
        let workspace = selected_ref(&guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        action(&workspace.root, &workspace.scanned)
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)] // Legacy acquisition adapter; active package protocol has its own path.
    pub(crate) fn verify_workspace_file(
        &self,
        workspace_id: &str,
        workspace_file_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_relative_path: &str,
        expected_mime_type: &str,
        expected_duration_ms: f64,
    ) -> ResearchResult<()> {
        self.with_workspace(workspace_id, |_, scanned| {
            let candidate = webview_attested_candidate(
                scanned,
                workspace_file_id,
                expected_sha256,
                expected_byte_length,
                expected_relative_path,
                expected_mime_type,
                expected_duration_ms,
            )?;
            let (observed_hash, observed_bytes) = hash_file(&candidate.path)?;
            if observed_hash != expected_sha256 || observed_bytes != expected_byte_length {
                return Err(CommandError::forbidden(
                    "A workspace stimulus changed after the latest scan.",
                ));
            }
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)] // Legacy acquisition adapter; active package protocol has its own path.
    pub(crate) fn verify_native_workspace_file(
        &self,
        workspace_id: &str,
        workspace_file_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_relative_path: &str,
        expected_mime_type: &str,
        expected_duration_ms: f64,
    ) -> ResearchResult<()> {
        self.with_workspace(workspace_id, |_, scanned| {
            let candidate = native_attested_candidate(
                scanned,
                workspace_file_id,
                expected_sha256,
                expected_byte_length,
                expected_relative_path,
                expected_mime_type,
                expected_duration_ms,
            )?;
            let (observed_hash, observed_bytes) = hash_file(&candidate.path)?;
            if observed_hash != expected_sha256 || observed_bytes != expected_byte_length {
                return Err(CommandError::forbidden(
                    "A natively qualified workspace stimulus changed after attestation.",
                ));
            }
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn resolve_native_package_file(
        &self,
        workspace_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_logical_path: &str,
        expected_mime_type: &str,
        expected_duration_ms: f64,
    ) -> ResearchResult<String> {
        self.with_workspace(workspace_id, |_, scanned| {
            let candidate = scanned
                .iter()
                .find(|entry| entry.logical_relative_path == expected_logical_path)
                .ok_or_else(|| {
                    CommandError::forbidden(
                        "The fixed package asset is absent from the latest native scan.",
                    )
                })?;
            native_attested_candidate(
                scanned,
                &candidate.id,
                expected_sha256,
                expected_byte_length,
                expected_logical_path,
                expected_mime_type,
                expected_duration_ms,
            )?;
            let (observed_hash, observed_bytes) = hash_file(&candidate.path)?;
            if observed_hash != expected_sha256 || observed_bytes != expected_byte_length {
                return Err(CommandError::forbidden(
                    "A fixed package asset changed after native decode qualification.",
                ));
            }
            Ok(candidate.id.clone())
        })
    }

    fn lock_selected(&self) -> MutexGuard<'_, Option<SelectedWorkspace>> {
        self.selected
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    pub(crate) fn mark_first_scanned_verified(&self, duration_ms: f64) {
        if let Some(entry) = self
            .lock_selected()
            .as_mut()
            .and_then(|workspace| workspace.scanned.first_mut())
        {
            entry.duration_ms = Some(duration_ms);
            entry.decode_status = DecodeStatus::AttestedUnqualified;
            entry.decode_backend = Some(DecodeBackend::WebviewVideoFrameCallback);
            entry.decode_attestation = Some(DecodeEvidence::RepresentativeFramesV1);
            entry.decoded_positions_ms = representative_positions_ms(duration_ms).to_vec();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSettingsReceipt {
    pub workspace_id: String,
    pub file_name: String,
    pub settings_sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionnaireAssetReceipt {
    pub workspace_id: String,
    pub family_id: String,
    pub language_tag: String,
    pub relative_path: String,
    pub source_sha256: String,
    pub byte_length: u64,
}

fn selected_ref<'a>(
    guard: &'a MutexGuard<'_, Option<SelectedWorkspace>>,
    workspace_id: &str,
) -> ResearchResult<&'a SelectedWorkspace> {
    let workspace = guard
        .as_ref()
        .ok_or_else(CommandError::workspace_required)?;
    if workspace.id != workspace_id {
        return Err(CommandError::workspace_required());
    }
    Ok(workspace)
}

fn selected_mut<'a>(
    guard: &'a mut MutexGuard<'_, Option<SelectedWorkspace>>,
    workspace_id: &str,
) -> ResearchResult<&'a mut SelectedWorkspace> {
    let workspace = guard
        .as_mut()
        .ok_or_else(CommandError::workspace_required)?;
    if workspace.id != workspace_id {
        return Err(CommandError::workspace_required());
    }
    Ok(workspace)
}

fn ensure_workspace_libraries(root: &Path) -> ResearchResult<WorkspaceLibraries> {
    for name in WORKSPACE_LIBRARY_NAMES {
        let child = root.join(name);
        match fs::symlink_metadata(&child) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&child).map_err(CommandError::io)?;
            }
            Err(error) => return Err(CommandError::io(error)),
        }
    }
    let assets = ensure_exact_child_directory(root, "assets")?;
    let _ = ensure_exact_child_directory(&assets, "stimuli")?;
    let _ = ensure_exact_child_directory(&assets, "questionnaires")?;
    validate_workspace_libraries(root)
}

fn validate_selected_workspace(
    workspace: &SelectedWorkspace,
) -> ResearchResult<WorkspaceLibraries> {
    let root_metadata = fs::symlink_metadata(&workspace.root).map_err(|_| {
        CommandError::forbidden(
            "The selected workspace or one of its required libraries is unavailable.",
        )
    })?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err(CommandError::forbidden(
            "The selected workspace or one of its required libraries is unavailable.",
        ));
    }
    let canonical_root = workspace.root.canonicalize().map_err(|_| {
        CommandError::forbidden(
            "The selected workspace or one of its required libraries is unavailable.",
        )
    })?;
    if canonical_root != workspace.root {
        return Err(CommandError::forbidden(
            "The selected workspace changed after it was selected.",
        ));
    }
    if directory_identity(&root_metadata) != workspace.root_identity {
        return Err(CommandError::forbidden(
            "The selected workspace changed after it was selected.",
        ));
    }
    let observed = validate_workspace_libraries(&canonical_root)?;
    if observed != workspace.libraries {
        return Err(CommandError::forbidden(
            "A required workspace library changed after the workspace was selected.",
        ));
    }
    Ok(observed)
}

fn validate_workspace_libraries(root: &Path) -> ResearchResult<WorkspaceLibraries> {
    let paths = WORKSPACE_LIBRARY_NAMES
        .map(|name| validate_exact_child_directory(root, name))
        .into_iter()
        .collect::<ResearchResult<Vec<_>>>()?;
    let assets = validate_exact_child_directory(root, "assets")?.0;
    let (package_assets, package_assets_identity) =
        validate_exact_child_directory(&assets, "stimuli")?;
    let (questionnaire_assets, questionnaire_assets_identity) =
        validate_exact_child_directory(&assets, "questionnaires")?;
    Ok(WorkspaceLibraries {
        stimuli: paths[0].0.clone(),
        settings: paths[1].0.clone(),
        outputs: paths[2].0.clone(),
        recovery: paths[3].0.clone(),
        package_assets,
        questionnaire_assets,
        identities: std::array::from_fn(|index| paths[index].1.clone()),
        package_assets_identity,
        questionnaire_assets_identity,
    })
}

fn validate_exact_child_directory(
    parent: &Path,
    name: &str,
) -> ResearchResult<(PathBuf, DirectoryIdentity)> {
    let child = parent.join(name);
    let metadata = fs::symlink_metadata(&child).map_err(|_| {
        CommandError::forbidden(
            "The selected workspace or one of its required libraries is unavailable.",
        )
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(CommandError::forbidden(
            "A required workspace library is not an ordinary directory.",
        ));
    }
    let canonical = child.canonicalize().map_err(|_| {
        CommandError::forbidden(
            "The selected workspace or one of its required libraries is unavailable.",
        )
    })?;
    if canonical != child || canonical.parent() != Some(parent) || !canonical.starts_with(parent) {
        return Err(CommandError::forbidden(
            "A required workspace library is not the exact canonical child of the selected parent.",
        ));
    }
    Ok((canonical, directory_identity(&metadata)))
}

fn ensure_exact_child_directory(parent: &Path, name: &str) -> ResearchResult<PathBuf> {
    let child = parent.join(name);
    match fs::symlink_metadata(&child) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&child).map_err(CommandError::io)?;
        }
        Err(error) => return Err(CommandError::io(error)),
    }
    validate_exact_child_directory(parent, name).map(|(path, _)| path)
}

#[cfg(target_os = "windows")]
fn directory_identity(metadata: &fs::Metadata) -> DirectoryIdentity {
    use std::os::windows::fs::MetadataExt;
    DirectoryIdentity {
        // Stable safe Rust does not currently expose the Windows file index.
        // Creation time detects ordinary same-path replacement without unsafe
        // platform calls; canonical-path validation remains the primary guard.
        creation_time: metadata.creation_time(),
    }
}

#[cfg(unix)]
fn directory_identity(metadata: &fs::Metadata) -> DirectoryIdentity {
    use std::os::unix::fs::MetadataExt;
    DirectoryIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(not(any(target_os = "windows", unix)))]
fn directory_identity(metadata: &fs::Metadata) -> DirectoryIdentity {
    DirectoryIdentity {
        created: metadata.created().ok(),
    }
}

fn probe_storage_paths(libraries: &WorkspaceLibraries) -> std::io::Result<()> {
    const PAYLOAD: &[u8] = b"affect-research-storage-readiness-v1";
    let token = Uuid::new_v4().simple().to_string();
    let recovery_probe = libraries.recovery.join(format!(".readiness-{token}.tmp"));
    let output_experiment = libraries.outputs.join(format!(".readiness-{token}"));
    let output_participant = output_experiment.join("P001");
    let output_session = output_participant.join("readiness-session");
    let output_probe = output_session.join("probe.tmp");

    let result = (|| -> std::io::Result<()> {
        durable_file_probe(&recovery_probe, PAYLOAD)?;
        fs::create_dir(&output_experiment)?;
        fs::create_dir(&output_participant)?;
        fs::create_dir(&output_session)?;
        durable_file_probe(&output_probe, PAYLOAD)
    })();

    let mut cleanup_error = None;
    for path in [&recovery_probe, &output_probe] {
        record_cleanup_error(&mut cleanup_error, remove_file_if_present(path));
    }
    for path in [&output_session, &output_participant, &output_experiment] {
        record_cleanup_error(&mut cleanup_error, remove_directory_if_present(path));
    }
    result.and_then(|()| cleanup_error.map_or(Ok(()), Err))
}

fn record_cleanup_error(slot: &mut Option<std::io::Error>, result: std::io::Result<()>) {
    if let Err(error) = result {
        slot.get_or_insert(error);
    }
}

fn remove_file_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn remove_directory_if_present(path: &Path) -> std::io::Result<()> {
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn durable_file_probe(path: &Path, payload: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(payload)?;
    file.sync_all()?;
    drop(file);
    let observed = fs::read(path)?;
    if observed != payload {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "storage readiness probe contents changed",
        ));
    }
    Ok(())
}

fn scan_package_videos(
    package_assets_root: &Path,
    package: &ExperimentPackageV1,
) -> ResearchResult<Vec<ScannedStimulus>> {
    let declared = package
        .assets
        .stimuli
        .iter()
        .map(|asset| (asset.relative_path.as_str(), asset))
        .collect::<BTreeMap<_, _>>();
    let mut observed = BTreeSet::new();
    let mut queue = VecDeque::from([(package_assets_root.to_owned(), 0usize)]);
    let mut files = Vec::with_capacity(declared.len());
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > MAX_SCAN_DEPTH {
            return Err(CommandError::forbidden(
                "The fixed package asset tree exceeds the supported folder depth.",
            ));
        }
        for entry in fs::read_dir(&directory).map_err(CommandError::io)? {
            let entry = entry.map_err(CommandError::io)?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(CommandError::io)?;
            if metadata.file_type().is_symlink() {
                return Err(CommandError::forbidden(
                    "The fixed package asset tree cannot contain symbolic links or junctions.",
                ));
            }
            if metadata.is_dir() {
                let canonical = path.canonicalize().map_err(CommandError::io)?;
                if !canonical.starts_with(package_assets_root) {
                    return Err(CommandError::forbidden(
                        "A fixed package asset directory escaped its root.",
                    ));
                }
                queue.push_back((canonical, depth + 1));
                continue;
            }
            if !metadata.is_file() {
                return Err(CommandError::forbidden(
                    "The fixed package asset tree contains a non-file entry.",
                ));
            }
            if files.len() >= MAX_SCAN_FILES {
                return Err(CommandError::forbidden(
                    "The fixed package asset tree exceeds 10000 files.",
                ));
            }
            let relative = path.strip_prefix(package_assets_root).map_err(|_| {
                CommandError::forbidden("A fixed package asset escaped its selected root.")
            })?;
            let relative = relative
                .components()
                .map(|component| {
                    component.as_os_str().to_str().ok_or_else(|| {
                        CommandError::forbidden("A fixed package asset path is not valid Unicode.")
                    })
                })
                .collect::<ResearchResult<Vec<_>>>()?
                .join("/");
            let package_path = format!("assets/stimuli/{relative}");
            let asset = declared.get(package_path.as_str()).ok_or_else(|| {
                CommandError::forbidden(format!(
                    "Undeclared fixed package asset {package_path} must be removed before Start."
                ))
            })?;
            let (sha256, byte_length) = hash_file(&path)?;
            if sha256 != asset.sha256 || byte_length != asset.byte_length {
                return Err(CommandError::forbidden(format!(
                    "Fixed package asset {package_path} differs from experiment.package.json."
                )));
            }
            observed.insert(package_path.clone());
            let logical_relative_path = package_path
                .strip_prefix("assets/")
                .expect("fixed package paths are beneath assets/")
                .to_owned();
            let mut opaque_hash = Sha256::new();
            opaque_hash.update(b"affect-research:package-workspace-file:v1\0");
            opaque_hash.update(package_path.as_bytes());
            opaque_hash.update([0]);
            opaque_hash.update(sha256.as_bytes());
            let opaque = format!("pa-{:x}", opaque_hash.finalize());
            files.push(ScannedStimulus {
                id: opaque[..27].to_owned(),
                path,
                logical_relative_path,
                sha256,
                byte_length,
                mime_type: asset.mime_type.clone(),
                duration_ms: None,
                decode_status: DecodeStatus::Unverified,
                decode_backend: None,
                decode_attestation: None,
                decoded_positions_ms: Vec::new(),
                display_geometry: None,
                native_decode_receipt_v2: None,
            });
        }
    }
    let missing = declared
        .keys()
        .filter(|path| !observed.contains(**path))
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(CommandError::forbidden(format!(
            "Missing declared fixed package assets: {}.",
            missing.join(", ")
        )));
    }
    files.sort_by(|left, right| left.logical_relative_path.cmp(&right.logical_relative_path));
    Ok(files)
}

fn scan_videos(root: &Path) -> ResearchResult<Vec<ScannedStimulus>> {
    let stimuli_root = root
        .join("stimuli")
        .canonicalize()
        .map_err(CommandError::io)?;
    if !stimuli_root.starts_with(root) {
        return Err(CommandError::forbidden(
            "The stimuli library resolves outside the selected workspace.",
        ));
    }
    let mut queue = VecDeque::from([(stimuli_root.clone(), 0usize)]);
    let mut files = Vec::new();
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > MAX_SCAN_DEPTH {
            return Err(CommandError::forbidden(
                "The stimuli library exceeds the supported folder depth.",
            ));
        }
        for entry in fs::read_dir(&directory).map_err(CommandError::io)? {
            let entry = entry.map_err(CommandError::io)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(CommandError::io)?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                let canonical = entry.path().canonicalize().map_err(CommandError::io)?;
                if !canonical.starts_with(&stimuli_root) {
                    return Err(CommandError::forbidden(
                        "A stimuli folder resolves outside the library.",
                    ));
                }
                queue.push_back((canonical, depth + 1));
                continue;
            }
            if !metadata.is_file() || !is_video(&entry.path()) {
                continue;
            }
            if files.len() >= MAX_SCAN_FILES {
                return Err(CommandError::forbidden(
                    "The stimuli library exceeds 10000 video files.",
                ));
            }
            let path = entry.path();
            let (sha256, byte_length) = hash_file(&path)?;
            let mime_type = video_mime_type(&path).to_owned();
            let relative = path
                .strip_prefix(&stimuli_root)
                .map_err(|_| CommandError::forbidden("A stimulus escaped its library."))?;
            let mut opaque_hash = Sha256::new();
            opaque_hash.update(b"affect-research:workspace-file:v1\0");
            opaque_hash.update(relative.to_string_lossy().as_bytes());
            opaque_hash.update([0]);
            opaque_hash.update(sha256.as_bytes());
            let opaque = format!("wf-{:x}", opaque_hash.finalize());
            files.push(ScannedStimulus {
                id: opaque[..27].to_owned(),
                path,
                logical_relative_path: logical_relative_path(&opaque[..27]),
                sha256,
                byte_length,
                mime_type,
                duration_ms: None,
                decode_status: DecodeStatus::Unverified,
                decode_backend: None,
                decode_attestation: None,
                decoded_positions_ms: Vec::new(),
                display_geometry: None,
                native_decode_receipt_v2: None,
            });
        }
    }
    files.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(files)
}

fn scan_planner_videos(package_assets_root: &Path) -> ResearchResult<Vec<ScannedStimulus>> {
    let mut queue = VecDeque::from([(package_assets_root.to_owned(), 0usize)]);
    let mut files = Vec::new();
    while let Some((directory, depth)) = queue.pop_front() {
        if depth > MAX_SCAN_DEPTH {
            return Err(CommandError::forbidden(
                "The Planner video library exceeds the supported folder depth.",
            ));
        }
        for entry in fs::read_dir(&directory).map_err(CommandError::io)? {
            let entry = entry.map_err(CommandError::io)?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(CommandError::io)?;
            if metadata.file_type().is_symlink() {
                return Err(CommandError::forbidden(
                    "The Planner video library cannot contain links or junctions.",
                ));
            }
            if metadata.is_dir() {
                let canonical = path.canonicalize().map_err(CommandError::io)?;
                if !canonical.starts_with(package_assets_root) {
                    return Err(CommandError::forbidden(
                        "A Planner video folder escaped assets/stimuli/.",
                    ));
                }
                queue.push_back((canonical, depth + 1));
                continue;
            }
            if !metadata.is_file() || !is_video(&path) {
                continue;
            }
            if files.len() >= MAX_SCAN_FILES {
                return Err(CommandError::forbidden(
                    "The Planner video library exceeds 10000 video files.",
                ));
            }
            let relative = path
                .strip_prefix(package_assets_root)
                .map_err(|_| CommandError::forbidden("A Planner video escaped assets/stimuli/."))?;
            let relative_path = portable_import_relative_path(relative)?;
            let logical_relative_path = format!("stimuli/{relative_path}");
            let (sha256, byte_length) = hash_file(&path)?;
            let mime_type = video_mime_type(&path).to_owned();
            let mut opaque_hash = Sha256::new();
            opaque_hash.update(b"affect-research:planner-workspace-file:v1\0");
            opaque_hash.update(logical_relative_path.as_bytes());
            opaque_hash.update([0]);
            opaque_hash.update(sha256.as_bytes());
            let opaque = format!("wf-{:x}", opaque_hash.finalize());
            files.push(ScannedStimulus {
                id: opaque[..27].to_owned(),
                path,
                logical_relative_path,
                sha256,
                byte_length,
                mime_type,
                duration_ms: None,
                decode_status: DecodeStatus::Unverified,
                decode_backend: None,
                decode_attestation: None,
                decoded_positions_ms: Vec::new(),
                display_geometry: None,
                native_decode_receipt_v2: None,
            });
        }
    }
    files.sort_by(|left, right| left.logical_relative_path.cmp(&right.logical_relative_path));
    Ok(files)
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn video_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "m4v" => "video/x-m4v",
        _ => "video/mp4",
    }
}

fn scanned_summary(entry: &ScannedStimulus) -> ScannedStimulusSummary {
    let source = entry
        .duration_ms
        .filter(|_| {
            let duration_ms = entry.duration_ms.unwrap_or_default();
            (entry.decode_status == DecodeStatus::AttestedUnqualified
                && entry.decode_backend == Some(DecodeBackend::WebviewVideoFrameCallback)
                && entry.decode_attestation == Some(DecodeEvidence::RepresentativeFramesV1)
                && validate_representative_positions(duration_ms, &entry.decoded_positions_ms)
                    .is_ok())
                || (entry.decode_status == DecodeStatus::AttestedQualified
                    && entry.decode_backend == Some(DecodeBackend::NativeGstPlay)
                    && entry.decode_attestation == Some(DecodeEvidence::NativeDecodedSnapshotsV1)
                    && validate_native_positions(duration_ms, &entry.decoded_positions_ms).is_ok())
        })
        .map(|duration_ms| WorkspaceSourceContract {
            kind: "workspaceFile",
            relative_path: entry.logical_relative_path.clone(),
            mime_type: entry.mime_type.clone(),
            sha256: entry.sha256.clone(),
            byte_length: entry.byte_length,
            duration_ms,
        });
    ScannedStimulusSummary {
        workspace_file_id: entry.id.clone(),
        display_name: entry
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("video")
            .to_owned(),
        sha256: entry.sha256.clone(),
        byte_length: entry.byte_length,
        mime_type: entry.mime_type.clone(),
        duration_ms: entry.duration_ms,
        decode_status: entry.decode_status,
        decode_backend: entry.decode_backend,
        decode_attestation: entry.decode_attestation,
        decoded_positions_ms: entry.decoded_positions_ms.clone(),
        display_geometry: entry.display_geometry.clone(),
        source,
    }
}

fn scanned_candidate<'a>(
    scanned: &'a [ScannedStimulus],
    workspace_file_id: &str,
    expected_sha256: &str,
    expected_byte_length: u64,
    expected_mime_type: &str,
) -> ResearchResult<&'a ScannedStimulus> {
    scanned
        .iter()
        .find(|entry| {
            entry.id == workspace_file_id
                && entry.sha256 == expected_sha256
                && entry.byte_length == expected_byte_length
                && entry.mime_type == expected_mime_type
        })
        .ok_or_else(|| {
            CommandError::forbidden(
                "The opaque workspace file and metadata do not match the latest native scan.",
            )
        })
}

#[cfg(test)] // Legacy acquisition adapter; active package protocol has its own path.
fn webview_attested_candidate<'a>(
    scanned: &'a [ScannedStimulus],
    workspace_file_id: &str,
    expected_sha256: &str,
    expected_byte_length: u64,
    expected_relative_path: &str,
    expected_mime_type: &str,
    expected_duration_ms: f64,
) -> ResearchResult<&'a ScannedStimulus> {
    if !expected_duration_ms.is_finite() || expected_duration_ms <= 0.0 {
        return Err(CommandError::invalid_contract(
            "A WebView-attested workspace stimulus requires a positive duration.",
        ));
    }
    if expected_relative_path
        != scanned
            .iter()
            .find(|entry| entry.id == workspace_file_id)
            .map(|entry| entry.logical_relative_path.as_str())
            .unwrap_or_default()
    {
        return Err(CommandError::invalid_contract(
            "Workspace settings must use the opaque logical source locator from Rescan.",
        ));
    }
    scanned
        .iter()
        .find(|entry| {
            entry.id == workspace_file_id
                && entry.sha256 == expected_sha256
                && entry.byte_length == expected_byte_length
                && entry.mime_type == expected_mime_type
                && entry.decode_status == DecodeStatus::AttestedUnqualified
                && entry.decode_backend == Some(DecodeBackend::WebviewVideoFrameCallback)
                && entry.decode_attestation == Some(DecodeEvidence::RepresentativeFramesV1)
                && entry
                    .duration_ms
                    .is_some_and(|duration| (duration - expected_duration_ms).abs() <= 0.5)
                && validate_representative_positions(
                    entry.duration_ms.unwrap_or_default(),
                    &entry.decoded_positions_ms,
                )
                .is_ok()
        })
        .ok_or_else(|| {
            CommandError::forbidden(
                "The opaque workspace file and its unqualified WebView attestation do not match the latest scan.",
            )
        })
}

#[allow(clippy::too_many_arguments)]
fn native_attested_candidate<'a>(
    scanned: &'a [ScannedStimulus],
    workspace_file_id: &str,
    expected_sha256: &str,
    expected_byte_length: u64,
    expected_relative_path: &str,
    expected_mime_type: &str,
    expected_duration_ms: f64,
) -> ResearchResult<&'a ScannedStimulus> {
    if !expected_duration_ms.is_finite() || expected_duration_ms < 10.0 {
        return Err(CommandError::invalid_contract(
            "A GstPlay-qualified workspace stimulus requires a complete-video duration.",
        ));
    }
    if expected_relative_path
        != scanned
            .iter()
            .find(|entry| entry.id == workspace_file_id)
            .map(|entry| entry.logical_relative_path.as_str())
            .unwrap_or_default()
    {
        return Err(CommandError::invalid_contract(
            "Workspace settings must use the opaque logical source locator from Rescan.",
        ));
    }
    scanned
        .iter()
        .find(|entry| {
            entry.id == workspace_file_id
                && entry.sha256 == expected_sha256
                && entry.byte_length == expected_byte_length
                && entry.mime_type == expected_mime_type
                && entry.decode_status == DecodeStatus::AttestedQualified
                && entry.decode_backend == Some(DecodeBackend::NativeGstPlay)
                && entry.decode_attestation == Some(DecodeEvidence::NativeDecodedSnapshotsV1)
                && entry
                    .duration_ms
                    .is_some_and(|duration| (duration - expected_duration_ms).abs() <= 0.5)
                && validate_native_positions(
                    entry.duration_ms.unwrap_or_default(),
                    &entry.decoded_positions_ms,
                )
                .is_ok()
        })
        .ok_or_else(|| {
            CommandError::forbidden(
                "The opaque workspace file and its native GstPlay attestation do not match the latest scan.",
            )
        })
}

fn representative_positions_ms(duration_ms: f64) -> [f64; 3] {
    let offset = (duration_ms * 0.1).min(250.0);
    [offset, duration_ms * 0.5, (duration_ms - offset).max(0.0)]
}

fn validate_representative_positions(duration_ms: f64, positions_ms: &[f64]) -> ResearchResult<()> {
    if !duration_ms.is_finite() || duration_ms <= 0.0 || positions_ms.len() != 3 {
        return Err(CommandError::invalid_contract(
            "Decode attestation requires near-start, midpoint, and near-end frames.",
        ));
    }
    let expected = representative_positions_ms(duration_ms);
    if positions_ms.iter().any(|position| !position.is_finite())
        || positions_ms
            .windows(2)
            .any(|positions| positions[1] - positions[0] < 1.0)
        || positions_ms
            .iter()
            .zip(expected)
            .any(|(observed, expected)| (observed - expected).abs() > 1.0)
    {
        return Err(CommandError::invalid_contract(
            "Decoded-frame positions must bind the expected near-start, midpoint, and near-end probes.",
        ));
    }
    Ok(())
}

fn validate_native_positions(duration_ms: f64, positions_ms: &[f64]) -> ResearchResult<()> {
    if !duration_ms.is_finite() || duration_ms < 10.0 || positions_ms.len() != 3 {
        return Err(CommandError::invalid_contract(
            "Native decode attestation requires three complete-video snapshots.",
        ));
    }
    let expected = representative_positions_ms(duration_ms);
    if positions_ms.iter().any(|position| !position.is_finite())
        || positions_ms
            .windows(2)
            .any(|positions| positions[1] - positions[0] < 1.0)
        || positions_ms
            .iter()
            .zip(expected)
            .any(|(observed, expected)| (observed - expected).abs() > 250.0)
    {
        return Err(CommandError::invalid_contract(
            "Native decoded snapshots must cover the expected start, midpoint, and end probes.",
        ));
    }
    Ok(())
}

fn logical_relative_path(workspace_file_id: &str) -> String {
    format!("stimuli/.workspace/{workspace_file_id}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ImportedVideo {
    source: PathBuf,
    relative_path: String,
}

fn collect_import_videos(selections: Vec<PathBuf>) -> ResearchResult<Vec<ImportedVideo>> {
    let mut videos = Vec::new();
    let mut queue = VecDeque::new();
    for selection in selections {
        let selected_metadata = fs::symlink_metadata(&selection)
            .map_err(|_| CommandError::forbidden("An imported selection is unavailable."))?;
        if selected_metadata.file_type().is_symlink() {
            return Err(CommandError::forbidden(
                "An imported selection cannot be a link or junction.",
            ));
        }
        let canonical = selection
            .canonicalize()
            .map_err(|_| CommandError::forbidden("An imported selection is unavailable."))?;
        if canonical.is_file() {
            if is_video(&canonical) {
                let name = canonical.file_name().ok_or_else(|| {
                    CommandError::forbidden("An imported video name is unavailable.")
                })?;
                videos.push(ImportedVideo {
                    relative_path: portable_import_relative_path(Path::new(name))?,
                    source: canonical,
                });
            }
        } else if canonical.is_dir() {
            let name = canonical.file_name().ok_or_else(|| {
                CommandError::forbidden("An imported folder name is unavailable.")
            })?;
            let prefix = portable_import_relative_path(Path::new(name))?;
            queue.push_back((canonical, prefix, 0usize));
        }
    }
    while let Some((directory, prefix, depth)) = queue.pop_front() {
        if depth > MAX_SCAN_DEPTH {
            return Err(CommandError::forbidden(
                "The imported folder exceeds the supported recursion depth.",
            ));
        }
        for entry in fs::read_dir(directory).map_err(CommandError::io)? {
            let entry = entry.map_err(CommandError::io)?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(CommandError::io)?;
            if metadata.file_type().is_symlink() {
                return Err(CommandError::forbidden(
                    "An imported folder cannot contain links or junctions.",
                ));
            }
            let name = entry.file_name();
            let relative_path = portable_import_relative_path(&Path::new(&prefix).join(name))?;
            if metadata.is_dir() {
                queue.push_back((path, relative_path, depth + 1));
            } else if metadata.is_file() && is_video(&path) {
                videos.push(ImportedVideo {
                    source: path,
                    relative_path,
                });
                if videos.len() > MAX_SCAN_FILES {
                    return Err(CommandError::forbidden(
                        "An import may contain at most 10000 videos.",
                    ));
                }
            }
        }
    }
    if videos.is_empty() {
        return Err(CommandError::forbidden(
            "The native selection contained no supported video files.",
        ));
    }
    Ok(videos)
}

fn import_planner_video(source: &ImportedVideo, destination: &Path) -> ResearchResult<()> {
    let (digest, _) = hash_file(&source.source)?;
    let mut parts = source.relative_path.split('/').collect::<Vec<_>>();
    let file_name = parts
        .pop()
        .ok_or_else(|| CommandError::forbidden("An imported video path is empty."))?;
    let mut parent = destination.to_owned();
    for part in parts {
        parent = ensure_exact_child_directory(&parent, part)?;
    }
    let target = parent.join(file_name);
    if source.source == target {
        return Ok(());
    }
    if target.exists() {
        let (existing_digest, _) = hash_file(&target)?;
        if existing_digest == digest {
            return Ok(());
        }
        return Err(CommandError::forbidden(
            "An imported video conflicts with an existing curated file.",
        ));
    }
    let staging = parent.join(format!(".{}.import", Uuid::new_v4()));
    let mut input = File::open(&source.source).map_err(CommandError::io)?;
    let mut output = create_new(&staging)?;
    std::io::copy(&mut input, &mut output).map_err(CommandError::io)?;
    output.sync_all().map_err(CommandError::io)?;
    drop(output);
    fs::rename(staging, target).map_err(CommandError::io)
}

// Frozen legacy authoring import used by the historical video-library v1
// editor. New Planner intake uses `import_planner_video` above.
fn import_video(source: &Path, destination: &Path) -> ResearchResult<()> {
    let (digest, _) = hash_file(source)?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_file_stem)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "video".to_owned());
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let target = destination.join(format!("{stem}-{}.{}", &digest[..8], extension));
    if target.exists() {
        let (existing_digest, _) = hash_file(&target)?;
        if existing_digest == digest {
            return Ok(());
        }
        return Err(CommandError::forbidden(
            "An imported video conflicts with an existing curated file.",
        ));
    }
    let staging = destination.join(format!(".{}.import", Uuid::new_v4()));
    let mut input = File::open(source).map_err(CommandError::io)?;
    let mut output = create_new(&staging)?;
    std::io::copy(&mut input, &mut output).map_err(CommandError::io)?;
    output.sync_all().map_err(CommandError::io)?;
    drop(output);
    fs::rename(staging, target).map_err(CommandError::io)
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_owned()
}

fn portable_import_relative_path(path: &Path) -> ResearchResult<String> {
    let parts = path
        .components()
        .map(|component| {
            let value = component.as_os_str().to_str().ok_or_else(|| {
                CommandError::forbidden("Imported video paths must be valid Unicode.")
            })?;
            let normalized = value.nfc().collect::<String>();
            if value != normalized
                || value.is_empty()
                || matches!(value, "." | "..")
                || value.ends_with(['.', ' '])
                || value.chars().any(|character| {
                    character.is_control()
                        || matches!(character, '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*')
                })
            {
                return Err(CommandError::forbidden(
                    "An imported video path is not portable canonical text.",
                ));
            }
            Ok(value.to_owned())
        })
        .collect::<ResearchResult<Vec<_>>>()?;
    if parts.is_empty() || parts.len() > MAX_SCAN_DEPTH + 2 {
        return Err(CommandError::forbidden(
            "An imported video path exceeds the supported folder depth.",
        ));
    }
    let relative = parts.join("/");
    if relative.len() > 2_048 {
        return Err(CommandError::forbidden(
            "An imported video path exceeds 2048 UTF-8 bytes.",
        ));
    }
    crate::research_workspace_contribution::video_annotation_id_from_relative_path_v1(&format!(
        "stimuli/{relative}"
    ))
    .map_err(|_| {
        CommandError::forbidden(
            "An imported video path cannot form a portable catalogue location ID.",
        )
    })?;
    Ok(relative)
}

fn serve_media(grant: MediaGrant, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut file = grant
        .file
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Ok(metadata) = file.metadata() else {
        return protocol_error(StatusCode::NOT_FOUND);
    };
    if !metadata.is_file() || metadata.len() != grant.byte_length || metadata.len() == 0 {
        return protocol_error(StatusCode::CONFLICT);
    }
    if *request.method() == Method::HEAD {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, grant.mime_type)
            .header(header::CONTENT_LENGTH, metadata.len())
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Vec::new())
            .unwrap_or_else(|_| protocol_error(StatusCode::INTERNAL_SERVER_ERROR));
    }
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let Some((start, requested_end)) = parse_byte_range(range, metadata.len()) else {
        return protocol_error(StatusCode::RANGE_NOT_SATISFIABLE);
    };
    let end = requested_end.min(start.saturating_add(MAX_PROTOCOL_CHUNK - 1));
    let length = end.saturating_sub(start).saturating_add(1);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return protocol_error(StatusCode::RANGE_NOT_SATISFIABLE);
    }
    let mut body = Vec::with_capacity(length as usize);
    if (&mut *file).take(length).read_to_end(&mut body).is_err() || body.len() as u64 != length {
        return protocol_error(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let partial = start > 0 || end + 1 < metadata.len() || range.is_some();
    let mut builder = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, grant.mime_type)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if partial {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", metadata.len()),
        );
    }
    builder
        .body(body)
        .unwrap_or_else(|_| protocol_error(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(target_os = "windows")]
fn open_read_locked(path: &Path) -> ResearchResult<File> {
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_SHARE_READ: playback may open another reader, but writers/deleters are denied
    // while an ephemeral Research media grant is alive.
    OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(path)
        .map_err(CommandError::io)
}

#[cfg(not(target_os = "windows"))]
fn open_read_locked(path: &Path) -> ResearchResult<File> {
    File::open(path).map_err(CommandError::io)
}

fn hash_open_file(file: &mut File) -> ResearchResult<(String, u64)> {
    file.seek(SeekFrom::Start(0)).map_err(CommandError::io)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut byte_length = 0u64;
    loop {
        let count = file.read(&mut buffer).map_err(CommandError::io)?;
        if count == 0 {
            break;
        }
        byte_length = byte_length.saturating_add(count as u64);
        digest.update(&buffer[..count]);
    }
    file.seek(SeekFrom::Start(0)).map_err(CommandError::io)?;
    Ok((format!("{:x}", digest.finalize()), byte_length))
}

fn parse_byte_range(header_value: Option<&str>, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let Some(value) = header_value else {
        return Some((0, length - 1));
    };
    let value = value.strip_prefix("bytes=")?;
    if value.contains(',') {
        return None;
    }
    let (start, end) = value.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(length);
        return (suffix > 0).then_some((length - suffix, length - 1));
    }
    let start = start.parse::<u64>().ok()?;
    if start >= length {
        return None;
    }
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    (end >= start).then_some((start, end))
}

fn protocol_error(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn create_new(path: &Path) -> ResearchResult<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(CommandError::io)
}

fn replace_with_staging(staging: &Path, target: &Path) -> ResearchResult<()> {
    if target.exists() {
        let parent = target
            .parent()
            .ok_or_else(|| CommandError::io("The destination library is invalid."))?;
        let backup = parent.join(format!(".{}.backup", Uuid::new_v4()));
        fs::rename(target, &backup).map_err(CommandError::io)?;
        if let Err(error) = fs::rename(staging, target) {
            let _ = fs::rename(&backup, target);
            return Err(CommandError::io(error));
        }
        let _ = fs::remove_file(backup);
    } else {
        fs::rename(staging, target).map_err(CommandError::io)?;
    }
    Ok(())
}

fn hash_file(path: &Path) -> ResearchResult<(String, u64)> {
    let mut file = File::open(path).map_err(CommandError::io)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut byte_length = 0u64;
    loop {
        let count = file.read(&mut buffer).map_err(CommandError::io)?;
        if count == 0 {
            break;
        }
        byte_length = byte_length.saturating_add(count as u64);
        digest.update(&buffer[..count]);
    }
    Ok((format!("{:x}", digest.finalize()), byte_length))
}

fn write_replacing(path: &Path, bytes: &[u8]) -> ResearchResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::io("The destination has no parent library."))?;
    let staging = parent.join(format!(".{}.staging", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging)
        .map_err(CommandError::io)?;
    file.write_all(bytes).map_err(CommandError::io)?;
    file.sync_all().map_err(CommandError::io)?;
    drop(file);
    if path.exists() {
        let backup = parent.join(format!(".{}.backup", Uuid::new_v4()));
        fs::rename(path, &backup).map_err(CommandError::io)?;
        if let Err(error) = fs::rename(&staging, path) {
            let _ = fs::rename(&backup, path);
            return Err(CommandError::io(error));
        }
        let _ = fs::remove_file(backup);
    } else {
        fs::rename(&staging, path).map_err(CommandError::io)?;
    }
    Ok(())
}

fn ensure_owned_directory(path: &Path) -> ResearchResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(CommandError::forbidden(
            "The questionnaire settings library is not a regular directory.",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(CommandError::io)?;
            let metadata = fs::symlink_metadata(path).map_err(CommandError::io)?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                Ok(())
            } else {
                Err(CommandError::forbidden(
                    "The questionnaire settings library could not be created safely.",
                ))
            }
        }
        Err(error) => Err(CommandError::io(error)),
    }
}

fn write_create_new_or_verify(path: &Path, bytes: &[u8]) -> ResearchResult<()> {
    let write_new = || -> std::io::Result<()> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
        file.write_all(bytes)?;
        file.sync_all()
    };
    match write_new() {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let existing = fs::read(path).map_err(CommandError::io)?;
            if existing == bytes {
                Ok(())
            } else {
                Err(CommandError::forbidden(
                    "A frozen questionnaire table conflicts with existing content.",
                ))
            }
        }
        Err(error) => Err(CommandError::io(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tauri_source_picker_exposes_only_the_owned_workspace_source() {
        let capabilities = source_capabilities();
        assert!(capabilities.workspace_file.supported);
        assert!(capabilities.workspace_file.selection_enabled);
        assert!(!capabilities.repository_asset.supported);
        assert!(!capabilities.repository_asset.selection_enabled);
        assert!(!capabilities.youtube.supported);
        assert!(!capabilities.youtube.selection_enabled);
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("affect-research-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn selecting_a_workspace_creates_required_libraries_and_asset_roots() {
        let base = temporary_directory("workspace");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        assert!(status.selected);
        assert!(status.libraries_ready);
        for library in ["stimuli", "settings", "outputs", "recovery"] {
            assert!(workspace.join(library).is_dir());
        }
        assert!(workspace.join("assets").join("stimuli").is_dir());
        assert!(workspace.join("assets").join("questionnaires").is_dir());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn questionnaire_sources_are_content_addressed_and_idempotent() {
        let base = temporary_directory("questionnaire-asset");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let bytes = b"format_version,questionnaire_id\nquestionnaire-csv-v1,maia-2-en\n";
        let source_sha256 = format!("{:x}", Sha256::digest(bytes));

        let receipt = service
            .store_questionnaire_asset(&workspace_id, "maia-2", "en", "csv", &source_sha256, bytes)
            .unwrap();
        let repeated = service
            .store_questionnaire_asset(&workspace_id, "maia-2", "en", "csv", &source_sha256, bytes)
            .unwrap();

        assert_eq!(repeated, receipt);
        assert_eq!(receipt.workspace_id, workspace_id);
        assert_eq!(receipt.family_id, "maia-2");
        assert_eq!(receipt.language_tag, "en");
        assert_eq!(receipt.source_sha256, source_sha256);
        assert_eq!(receipt.byte_length, bytes.len() as u64);
        assert_eq!(
            receipt.relative_path,
            format!("assets/questionnaires/maia-2/en/{source_sha256}.csv")
        );
        assert_eq!(
            fs::read(workspace.join(&receipt.relative_path)).unwrap(),
            bytes
        );
        let wire = serde_json::to_value(&receipt).unwrap();
        assert_eq!(wire["familyId"], "maia-2");
        assert_eq!(wire["languageTag"], "en");
        assert_eq!(wire["sourceSha256"], source_sha256);
        assert_eq!(wire["byteLength"], bytes.len() as u64);
        assert_eq!(wire.as_object().unwrap().len(), 6);
        assert!(!wire.to_string().contains("chosen"));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn questionnaire_source_storage_rejects_malformed_or_mismatched_inputs() {
        let base = temporary_directory("questionnaire-invalid");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let bytes = b"questionnaire";
        let source_sha256 = format!("{:x}", Sha256::digest(bytes));

        for (family_id, language_tag, format, digest, source) in [
            (
                "../maia-2",
                "en",
                "csv",
                source_sha256.as_str(),
                bytes.as_slice(),
            ),
            (
                "maia-2",
                "en/gb",
                "csv",
                source_sha256.as_str(),
                bytes.as_slice(),
            ),
            (
                "MAIA-2",
                "en",
                "csv",
                source_sha256.as_str(),
                bytes.as_slice(),
            ),
            (
                "maia-2",
                "en",
                "CSV",
                source_sha256.as_str(),
                bytes.as_slice(),
            ),
            ("maia-2", "en", "csv", "0", bytes.as_slice()),
            (
                "maia-2",
                "en",
                "csv",
                source_sha256.as_str(),
                b"changed".as_slice(),
            ),
            (
                "maia-2",
                "en",
                "csv",
                source_sha256.as_str(),
                b"".as_slice(),
            ),
        ] {
            let error = service
                .store_questionnaire_asset(
                    &workspace_id,
                    family_id,
                    language_tag,
                    format,
                    digest,
                    source,
                )
                .unwrap_err();
            assert_eq!(error.code, "invalid_research_contract");
        }

        let oversized = vec![b'x'; MAX_QUESTIONNAIRE_SOURCE_BYTES + 1];
        let oversized_sha256 = format!("{:x}", Sha256::digest(&oversized));
        let error = service
            .store_questionnaire_asset(
                &workspace_id,
                "maia-2",
                "en",
                "json",
                &oversized_sha256,
                &oversized,
            )
            .unwrap_err();
        assert_eq!(error.code, "invalid_research_contract");
        assert_eq!(
            fs::read_dir(workspace.join("assets").join("questionnaires"))
                .unwrap()
                .count(),
            0
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn questionnaire_source_storage_rejects_conflicting_content_and_missing_root() {
        let base = temporary_directory("questionnaire-conflict");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let bytes = b"questionnaire";
        let source_sha256 = format!("{:x}", Sha256::digest(bytes));
        let language = workspace
            .join("assets")
            .join("questionnaires")
            .join("tas-20")
            .join("de");
        fs::create_dir_all(&language).unwrap();
        fs::write(language.join(format!("{source_sha256}.txt")), b"conflict").unwrap();

        let error = service
            .store_questionnaire_asset(&workspace_id, "tas-20", "de", "txt", &source_sha256, bytes)
            .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");

        let non_file_target = language.join(format!("{source_sha256}.json"));
        fs::create_dir(&non_file_target).unwrap();
        let error = service
            .store_questionnaire_asset(&workspace_id, "tas-20", "de", "json", &source_sha256, bytes)
            .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        assert!(non_file_target.is_dir());

        let questionnaire_root = workspace.join("assets").join("questionnaires");
        fs::remove_dir_all(&questionnaire_root).unwrap();
        assert!(!service.status().libraries_ready);
        let error = service
            .store_questionnaire_asset(&workspace_id, "tas-20", "de", "txt", &source_sha256, bytes)
            .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        assert!(!questionnaire_root.exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn default_workspace_is_the_app_data_child_and_can_be_changed() {
        let base = temporary_directory("default-workspace");
        let app_data = base.join("app-data");
        let service = WorkspaceService::with_default_workspace(app_data.clone()).unwrap();
        let default_root = app_data.canonicalize().unwrap().join("workspace");
        let initial_status = service.status();

        assert!(initial_status.selected);
        assert!(initial_status.libraries_ready);
        assert_eq!(initial_status.display_name.as_deref(), Some("workspace"));
        for library in ["stimuli", "settings", "outputs", "recovery"] {
            assert!(default_root.join(library).is_dir());
        }
        assert!(default_root.join("assets").join("stimuli").is_dir());
        assert!(default_root.join("assets").join("questionnaires").is_dir());

        let replacement = base.join("chosen");
        fs::create_dir(&replacement).unwrap();
        let replacement_status = service.select(replacement).unwrap();
        assert!(replacement_status.selected);
        assert!(replacement_status.libraries_ready);
        assert_eq!(replacement_status.display_name.as_deref(), Some("chosen"));
        assert_ne!(replacement_status.workspace_id, initial_status.workspace_id);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn planner_import_preserves_nested_locations_and_does_not_collapse_equal_content() {
        let base = temporary_directory("planner-location-import");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        let sources = base.join("sources");
        let session_dash = sources.join("session-a");
        let session_underscore = sources.join("session_a");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&session_dash).unwrap();
        fs::create_dir_all(&session_underscore).unwrap();
        fs::write(session_dash.join("clip.mp4"), b"identical-video-bytes").unwrap();
        fs::write(
            session_underscore.join("clip.mp4"),
            b"identical-video-bytes",
        )
        .unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();

        let result = service
            .import_paths(
                &workspace_id,
                vec![session_underscore.clone(), session_dash.clone()],
            )
            .unwrap();
        assert_eq!(result.stimuli.len(), 2);
        assert_eq!(result.stimuli[0].sha256, result.stimuli[1].sha256);
        assert_ne!(
            result.stimuli[0].workspace_file_id,
            result.stimuli[1].workspace_file_id
        );
        assert_eq!(
            fs::read(
                workspace
                    .join("assets")
                    .join("stimuli")
                    .join("session-a")
                    .join("clip.mp4")
            )
            .unwrap(),
            b"identical-video-bytes"
        );
        assert_eq!(
            fs::read(
                workspace
                    .join("assets")
                    .join("stimuli")
                    .join("session_a")
                    .join("clip.mp4")
            )
            .unwrap(),
            b"identical-video-bytes"
        );
        let guard = service.lock_selected();
        let paths = guard
            .as_ref()
            .unwrap()
            .scanned
            .iter()
            .map(|entry| entry.logical_relative_path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            paths,
            ["stimuli/session-a/clip.mp4", "stimuli/session_a/clip.mp4"]
        );
        drop(guard);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn planner_catalogue_validation_rechecks_current_file_duration_and_geometry() {
        let base = temporary_directory("planner-catalogue-authority");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir_all(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let video = workspace
            .join("assets")
            .join("stimuli")
            .join("session_a")
            .join("clip.mp4");
        fs::create_dir_all(video.parent().unwrap()).unwrap();
        fs::write(&video, b"planner-video-bytes").unwrap();
        let scan = service.rescan_planner_videos(&workspace_id).unwrap();
        let item = &scan.stimuli[0];
        let summary = service
            .attest_native_decode(
                &workspace_id,
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
                    duration_ms: 1_000.25,
                    video_width: 1_920,
                    video_height: 1_080,
                    audio_stream_count: 1,
                    decoded_positions_ms: vec![100.0, 500.0, 900.0],
                    decoded_snapshot_count: 3,
                    display_metadata:
                        crate::research_video_geometry::NativeDisplayMetadataReceiptV1 {
                            schema: crate::research_video_geometry::NATIVE_DISPLAY_METADATA_SCHEMA,
                            version: 1,
                            encoded_width_px: 1_920,
                            encoded_height_px: 1_080,
                            pixel_aspect_ratio: crate::research_video_geometry::VideoRatioV1 {
                                numerator: 1,
                                denominator: 1,
                            },
                            orientation:
                                crate::research_video_geometry::NativeVideoOrientationV1::Identity,
                            snapshot_width_px: 1_920,
                            snapshot_height_px: 1_080,
                            snapshot_pixel_aspect_ratio:
                                crate::research_video_geometry::VideoRatioV1 {
                                    numerator: 1,
                                    denominator: 1,
                                },
                        },
                },
            )
            .unwrap();
        assert_eq!(summary.duration_ms, Some(1_000.0));
        let source = summary.source.as_ref().unwrap();
        let core = serde_json::json!({
            "schema": "affect-research-video-catalogue-contribution",
            "version": 2,
            "revision": 1,
            "annotationPolicy": "relative-path-reversible-v1",
            "entries": [{
                "assetId": format!("asset-{}", item.sha256),
                "annotationId": "session%5Fa_clip.mp4",
                "sourceRelativePath": source.relative_path,
                "packageRelativePath": format!("assets/{}", source.relative_path),
                "sha256": item.sha256,
                "byteLength": item.byte_length,
                "durationMs": 1_000,
                "geometry": summary.display_geometry
            }]
        });
        let mut catalogue = core.clone();
        catalogue.as_object_mut().unwrap().insert(
            "integritySha256".to_owned(),
            serde_json::json!(crate::research_contracts::canonical_sha256(&core, &[]).unwrap()),
        );
        assert_eq!(
            service
                .validate_planner_video_catalogue(&workspace_id, &catalogue)
                .unwrap()
                .entries[0]
                .annotation_id,
            "session%5Fa_clip.mp4"
        );

        let runner = service
            .validate_runner_video_catalogue(&workspace_id, &catalogue)
            .unwrap();
        assert_eq!(runner.len(), 1);
        assert_eq!(runner[0].workspace_file_id, item.workspace_file_id);
        assert_eq!(runner[0].asset_id, format!("asset-{}", item.sha256));
        assert_eq!(runner[0].annotation_id, "session%5Fa_clip.mp4");
        assert_eq!(runner[0].source_relative_path, source.relative_path);
        assert_eq!(runner[0].sha256, item.sha256);
        assert_eq!(runner[0].byte_length, item.byte_length);
        assert_eq!(runner[0].mime_type, item.mime_type);
        assert_eq!(runner[0].duration_ms, 1_000);
        assert_eq!(
            (
                runner[0].display_geometry.display_width_px,
                runner[0].display_geometry.display_height_px,
            ),
            (1_920, 1_080)
        );

        let mut browser_core = core.clone();
        browser_core["entries"][0]["geometry"]["source"] = serde_json::json!("browser-decoder");
        browser_core["entries"][0]["geometry"]["rotationDegrees"] = serde_json::Value::Null;
        browser_core["entries"][0]["geometry"]["pixelAspectRatio"] = serde_json::Value::Null;
        browser_core["entries"][0]["geometry"]["metadataInterpretation"] =
            serde_json::json!("decoder-oriented-display");
        let mut browser_catalogue = browser_core.clone();
        browser_catalogue.as_object_mut().unwrap().insert(
            "integritySha256".to_owned(),
            serde_json::json!(
                crate::research_contracts::canonical_sha256(&browser_core, &[]).unwrap()
            ),
        );
        let browser_runner = service
            .validate_runner_video_catalogue(&workspace_id, &browser_catalogue)
            .unwrap();
        assert_eq!(
            browser_runner[0].display_geometry.source,
            "native-gstplay-metadata"
        );

        let mut wrong_geometry_core = browser_core.clone();
        wrong_geometry_core["entries"][0]["geometry"]["displayWidthPx"] = serde_json::json!(1_280);
        wrong_geometry_core["entries"][0]["geometry"]["displayHeightPx"] = serde_json::json!(720);
        let mut wrong_geometry = wrong_geometry_core.clone();
        wrong_geometry.as_object_mut().unwrap().insert(
            "integritySha256".to_owned(),
            serde_json::json!(crate::research_contracts::canonical_sha256(
                &wrong_geometry_core,
                &[]
            )
            .unwrap()),
        );
        assert!(service
            .validate_runner_video_catalogue(&workspace_id, &wrong_geometry)
            .is_err());

        let extra = workspace
            .join("assets")
            .join("stimuli")
            .join("new-after-attestation.mp4");
        fs::write(&extra, b"new-video-outside-the-accepted-catalogue").unwrap();
        assert!(service
            .validate_planner_video_catalogue(&workspace_id, &catalogue)
            .is_err());
        fs::remove_file(&extra).unwrap();
        assert!(service
            .validate_planner_video_catalogue(&workspace_id, &catalogue)
            .is_ok());

        fs::write(&video, b"changed-planner-video").unwrap();
        assert!(service
            .validate_planner_video_catalogue(&workspace_id, &catalogue)
            .is_err());
        fs::write(&video, b"planner-video-bytes").unwrap();
        assert!(service
            .validate_planner_video_catalogue(&workspace_id, &catalogue)
            .is_ok());

        let linked_parent = video.parent().unwrap().to_owned();
        let external_parent = base.join("replacement-session");
        fs::create_dir(&external_parent).unwrap();
        fs::write(external_parent.join("clip.mp4"), b"planner-video-bytes").unwrap();
        fs::remove_dir_all(&linked_parent).unwrap();
        create_directory_link(&external_parent, &linked_parent);
        assert!(service
            .validate_planner_video_catalogue(&workspace_id, &catalogue)
            .is_err());
        remove_directory_link(&linked_parent);
        fs::remove_dir_all(&external_parent).unwrap();
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn workspace_location_wire_values_are_closed_and_camel_case() {
        assert_eq!(
            serde_json::from_str::<WorkspaceLocation>("\"workspaceRoot\"").unwrap(),
            WorkspaceLocation::WorkspaceRoot
        );
        assert_eq!(
            serde_json::from_str::<WorkspaceLocation>("\"videoLibrary\"").unwrap(),
            WorkspaceLocation::VideoLibrary
        );
        assert_eq!(
            serde_json::from_str::<WorkspaceLocation>("\"experimentPackage\"").unwrap(),
            WorkspaceLocation::ExperimentPackage
        );
        assert!(serde_json::from_str::<WorkspaceLocation>("\"settings\"").is_err());
    }

    #[test]
    fn workspace_open_locations_resolve_without_launching_the_os_opener() {
        let base = temporary_directory("open-locations");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let root = workspace.canonicalize().unwrap();
        let package = root.join(EXPERIMENT_PACKAGE_FILE_NAME);
        fs::write(&package, b"{}").unwrap();

        assert_eq!(
            service
                .resolve_open_location(&workspace_id, WorkspaceLocation::WorkspaceRoot)
                .unwrap(),
            WorkspaceOpenTarget::OpenDirectory(root.clone())
        );
        assert_eq!(
            service
                .resolve_open_location(&workspace_id, WorkspaceLocation::VideoLibrary)
                .unwrap(),
            WorkspaceOpenTarget::OpenDirectory(root.join("assets").join("stimuli"))
        );
        assert_eq!(
            service
                .resolve_open_location(&workspace_id, WorkspaceLocation::ExperimentPackage)
                .unwrap(),
            WorkspaceOpenTarget::RevealFile(package)
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn workspace_open_resolution_rejects_wrong_and_stale_workspace_ids() {
        let base = temporary_directory("open-stale-workspace");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let first = base.join("first");
        let second = base.join("second");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        let stale_id = service.select(first).unwrap().workspace_id.unwrap();

        let error = service
            .resolve_open_location(
                "not-the-selected-workspace",
                WorkspaceLocation::WorkspaceRoot,
            )
            .unwrap_err();
        assert_eq!(error.code, "workspace_required");

        service.select(second).unwrap();
        let error = service
            .resolve_open_location(&stale_id, WorkspaceLocation::WorkspaceRoot)
            .unwrap_err();
        assert_eq!(error.code, "workspace_required");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn workspace_open_resolution_rejects_a_replaced_video_library() {
        let base = temporary_directory("open-replaced-library");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let video_library = workspace.join("assets").join("stimuli");

        fs::remove_dir(&video_library).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::create_dir(&video_library).unwrap();

        let error = service
            .resolve_open_location(&workspace_id, WorkspaceLocation::VideoLibrary)
            .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn non_regular_package_entry_opens_the_project_root() {
        let base = temporary_directory("open-package-directory");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let root = workspace.canonicalize().unwrap();
        fs::create_dir(root.join(EXPERIMENT_PACKAGE_FILE_NAME)).unwrap();

        assert_eq!(
            service
                .resolve_open_location(&workspace_id, WorkspaceLocation::ExperimentPackage)
                .unwrap(),
            WorkspaceOpenTarget::OpenDirectory(root)
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(any(target_os = "windows", unix))]
    #[test]
    fn linked_package_entry_opens_the_project_root() {
        let base = temporary_directory("open-package-link");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        let external = base.join("external");
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(&external).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let root = workspace.canonicalize().unwrap();
        let package = workspace.join(EXPERIMENT_PACKAGE_FILE_NAME);
        create_directory_link(&external, &package);

        assert_eq!(
            service
                .resolve_open_location(&workspace_id, WorkspaceLocation::ExperimentPackage)
                .unwrap(),
            WorkspaceOpenTarget::OpenDirectory(root)
        );

        remove_directory_link(&package);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn v2_settings_save_freezes_content_addressed_questionnaire_tables() {
        use crate::research_protocol::{
            import_questionnaire_csv, QuestionnaireSettingsV2, QuestionnaireSourceKindV1,
            ResearchSettingsV2, QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
        };

        let base = temporary_directory("v2-settings");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let v1 = crate::research_contracts::tests::default_settings()
            .normalize_and_validate()
            .unwrap();
        let definition = import_questionnaire_csv(
            include_bytes!("../../site/questionnaires/questionnaire-template.csv"),
            QuestionnaireSourceKindV1::ResearcherCsv,
            "questionnaire-template.csv",
            None,
        )
        .unwrap()
        .definition;
        let settings = ResearchSettingsV2 {
            schema: crate::research_contracts::RESEARCH_SETTINGS_SCHEMA.to_owned(),
            version: 2,
            experiment: v1.experiment,
            stimuli: v1.stimuli,
            input: v1.input,
            visual: v1.visual,
            advanced: v1.advanced,
            output: v1.output,
            questionnaires: QuestionnaireSettingsV2 {
                algorithm_version: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION.to_owned(),
                definitions: vec![definition.clone()],
                modules: Vec::new(),
            },
        }
        .normalize_and_validate()
        .unwrap();
        let receipt = service
            .save_settings_document(
                &workspace_id,
                ResearchSettingsDocument::V2(settings.clone()),
            )
            .unwrap();
        assert_eq!(receipt.file_name, "video-affect-study.settings.json");
        let table = workspace
            .join("settings")
            .join("questionnaires")
            .join(format!(
                "{}.{}.csv",
                definition.questionnaire_id, definition.definition_sha256
            ));
        assert_eq!(
            fs::read(&table).unwrap(),
            definition.canonical_csv_bytes().unwrap()
        );
        service
            .save_settings_document(
                &workspace_id,
                ResearchSettingsDocument::V2(settings.clone()),
            )
            .unwrap();

        fs::write(&table, b"conflicting content").unwrap();
        let error = service
            .save_settings_document(&workspace_id, ResearchSettingsDocument::V2(settings))
            .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn v3_settings_save_persists_the_strict_document_and_questionnaire_table() {
        let base = temporary_directory("v3-settings");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let settings = crate::research_protocol::tests::external_settings();
        let definition = settings.questionnaires.definitions[0].clone();
        let document = ResearchSettingsDocument::V3(settings.clone());
        let expected_bytes = canonical_json(&document, &[]).unwrap();
        let receipt = service
            .save_settings_document(&workspace_id, document)
            .unwrap();
        assert_eq!(receipt.file_name, "video-affect-study.settings.json");
        assert_eq!(
            receipt.settings_sha256,
            format!("{:x}", Sha256::digest(&expected_bytes))
        );
        let saved = fs::read(workspace.join("settings").join(&receipt.file_name)).unwrap();
        assert_eq!(saved, expected_bytes);
        assert!(matches!(
            serde_json::from_slice::<ResearchSettingsDocument>(&saved).unwrap(),
            ResearchSettingsDocument::V3(candidate) if candidate == settings
        ));
        let table = workspace
            .join("settings")
            .join("questionnaires")
            .join(format!(
                "{}.{}.csv",
                definition.questionnaire_id, definition.definition_sha256
            ));
        assert_eq!(
            fs::read(&table).unwrap(),
            definition.canonical_csv_bytes().unwrap()
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn removed_library_is_not_recreated_and_disables_workspace_operations() {
        let base = temporary_directory("removed-library");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        let workspace_id = status.workspace_id.unwrap();

        fs::remove_dir(workspace.join("settings")).unwrap();

        assert!(!service.status().libraries_ready);
        let error = service.rescan(&workspace_id).unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        assert!(!workspace.join("settings").exists());
        assert!(!serde_json::to_string(&error).unwrap().contains("chosen"));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn same_path_directory_replacement_invalidates_the_selected_workspace() {
        let base = temporary_directory("replaced-library");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        let workspace_id = status.workspace_id.unwrap();
        let outputs = workspace.join("outputs");

        fs::remove_dir(&outputs).unwrap();
        // Windows stable Rust exposes creation time, rather than the directory
        // file ID; avoid timestamp-granularity ambiguity in this host test.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::create_dir(&outputs).unwrap();

        assert!(!service.status().libraries_ready);
        let error = service
            .with_workspace(&workspace_id, |_, _| Ok(()))
            .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn library_replaced_by_a_file_is_rejected_without_recreation() {
        let base = temporary_directory("file-library");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        let workspace_id = status.workspace_id.unwrap();
        let recovery = workspace.join("recovery");

        fs::remove_dir(&recovery).unwrap();
        fs::write(&recovery, b"not a directory").unwrap();

        assert!(!service.status().libraries_ready);
        let error = service.storage_readiness(&workspace_id, 1).unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        assert!(recovery.is_file());
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(any(target_os = "windows", unix))]
    #[test]
    fn library_replaced_by_a_link_outside_the_workspace_is_rejected() {
        let base = temporary_directory("linked-library");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        let external = base.join("external");
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(&external).unwrap();
        fs::write(external.join("must-remain.txt"), b"external").unwrap();
        let status = service.select(workspace.clone()).unwrap();
        let workspace_id = status.workspace_id.unwrap();
        let outputs = workspace.join("outputs");
        fs::remove_dir(&outputs).unwrap();
        create_directory_link(&external, &outputs);

        assert!(!service.status().libraries_ready);
        let error = service.storage_readiness(&workspace_id, 1).unwrap_err();
        assert_eq!(error.code, "forbidden_operation");

        remove_directory_link(&outputs);
        assert_eq!(
            fs::read(external.join("must-remain.txt")).unwrap(),
            b"external"
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn scan_ignores_non_video_files_and_never_returns_a_path() {
        let base = temporary_directory("scan");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        fs::write(workspace.join("stimuli").join("clip.mp4"), b"video").unwrap();
        fs::write(workspace.join("stimuli").join("notes.txt"), b"private").unwrap();
        let result = service
            .rescan(status.workspace_id.as_deref().unwrap())
            .unwrap();
        assert_eq!(result.stimuli.len(), 1);
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains("chosen"));
        assert!(!json.contains("clip.mp4/") && !json.contains("stimuli\\"));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn native_decode_attestation_is_distinct_from_webview_evidence_at_start_revalidation() {
        let base = temporary_directory("native-decode-attestation");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let workspace_id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        fs::write(workspace.join("stimuli").join("clip.mp4"), b"video-bytes").unwrap();
        let scan = service.rescan(&workspace_id).unwrap();
        let item = &scan.stimuli[0];
        let summary = service
            .attest_native_decode(
                &workspace_id,
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
                    duration_ms: 1_000.0,
                    video_width: 1_920,
                    video_height: 1_080,
                    audio_stream_count: 1,
                    decoded_positions_ms: vec![100.0, 500.0, 900.0],
                    decoded_snapshot_count: 3,
                    display_metadata:
                        crate::research_video_geometry::NativeDisplayMetadataReceiptV1 {
                            schema: crate::research_video_geometry::NATIVE_DISPLAY_METADATA_SCHEMA,
                            version: 1,
                            encoded_width_px: 1_920,
                            encoded_height_px: 1_080,
                            pixel_aspect_ratio: crate::research_video_geometry::VideoRatioV1 {
                                numerator: 1,
                                denominator: 1,
                            },
                            orientation:
                                crate::research_video_geometry::NativeVideoOrientationV1::Identity,
                            snapshot_width_px: 1_920,
                            snapshot_height_px: 1_080,
                            snapshot_pixel_aspect_ratio:
                                crate::research_video_geometry::VideoRatioV1 {
                                    numerator: 1,
                                    denominator: 1,
                                },
                        },
                },
            )
            .unwrap();
        let source = summary.source.unwrap();
        service
            .verify_native_workspace_file(
                &workspace_id,
                &item.workspace_file_id,
                &item.sha256,
                item.byte_length,
                &source.relative_path,
                &item.mime_type,
                source.duration_ms,
            )
            .unwrap();
        assert!(service
            .verify_workspace_file(
                &workspace_id,
                &item.workspace_file_id,
                &item.sha256,
                item.byte_length,
                &source.relative_path,
                &item.mime_type,
                source.duration_ms,
            )
            .is_err());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn namespace_is_dedicated_and_does_not_probe_legacy_storage() {
        let base = temporary_directory("namespace");
        let _service = WorkspaceService::new(base.clone()).unwrap();
        let namespace = base.join("affect-research").join("v1");
        assert!(namespace.ends_with(Path::new("affect-research/v1")));
        assert!(namespace.is_dir());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn storage_readiness_is_path_free_and_performs_a_durable_write_probe() {
        let base = temporary_directory("storage");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        let readiness = service
            .storage_readiness(status.workspace_id.as_deref().unwrap(), 1)
            .unwrap();
        assert!(readiness.write_ready);
        assert!(readiness.sufficient);
        assert!(readiness.available_bytes >= readiness.required_bytes);
        assert_eq!(fs::read_dir(workspace.join("recovery")).unwrap().count(), 0);
        assert_eq!(fs::read_dir(workspace.join("outputs")).unwrap().count(), 0);
        assert!(!serde_json::to_string(&readiness)
            .unwrap()
            .contains("chosen"));
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(target_os = "windows")]
    fn create_directory_link(target: &Path, link: &Path) {
        let output = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "junction creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(target_os = "windows")]
    fn remove_directory_link(path: &Path) {
        fs::remove_dir(path).unwrap();
    }

    #[cfg(unix)]
    fn remove_directory_link(path: &Path) {
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn media_protocol_uses_only_an_ephemeral_token_and_honors_byte_ranges() {
        let base = temporary_directory("media");
        {
            let service = WorkspaceService::new(base.join("app-data")).unwrap();
            let workspace = base.join("chosen");
            fs::create_dir(&workspace).unwrap();
            let status = service.select(workspace.clone()).unwrap();
            fs::write(workspace.join("stimuli").join("clip.mp4"), b"video").unwrap();
            let scan = service
                .rescan(status.workspace_id.as_deref().unwrap())
                .unwrap();
            let item = &scan.stimuli[0];
            assert_eq!(item.decode_status, DecodeStatus::Unverified);
            assert!(item.source.is_none());
            let receipt = service
                .issue_media_url(
                    status.workspace_id.as_deref().unwrap(),
                    &item.workspace_file_id,
                    &item.sha256,
                    item.byte_length,
                    &item.mime_type,
                )
                .unwrap();
            assert!(!receipt.media_url.contains("clip"));
            assert!(!receipt.media_url.contains("chosen"));
            let media_url = receipt.media_url.clone();
            let request = Request::builder()
                .method(Method::GET)
                .uri(&receipt.media_url)
                .header(header::RANGE, "bytes=1-3")
                .body(Vec::new())
                .unwrap();
            let response = service.protocol_response("research", request);
            assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(response.body(), b"ide");
            let verified = service
                .attest_workspace_decode(DecodeAttestationRequest {
                    attestation_kind: DecodeAttestationKind::AttestRepresentativeFramesV1,
                    decode_backend: DecodeBackend::WebviewVideoFrameCallback,
                    workspace_id: status.workspace_id.clone().unwrap(),
                    media_grant_id: receipt.media_grant_id.clone(),
                    workspace_file_id: item.workspace_file_id.clone(),
                    sha256: item.sha256.clone(),
                    byte_length: item.byte_length,
                    mime_type: item.mime_type.clone(),
                    observed_duration_ms: Some(1_000.0),
                    video_width: Some(1_920),
                    video_height: Some(1_080),
                    muted_playback_ms: Some(100.0),
                    decoded_positions_ms: vec![100.0, 500.0, 900.0],
                })
                .unwrap();
            assert_eq!(verified.decode_status, DecodeStatus::AttestedUnqualified);
            assert_eq!(
                verified.decode_backend,
                Some(DecodeBackend::WebviewVideoFrameCallback)
            );
            assert_eq!(
                verified.decode_attestation,
                Some(DecodeEvidence::RepresentativeFramesV1)
            );
            assert_eq!(verified.decoded_positions_ms, [100.0, 500.0, 900.0]);
            assert_eq!(verified.duration_ms, Some(1_000.0));
            assert!(verified.source.is_some());
            let boundary = serde_json::to_value(&verified).unwrap();
            assert_eq!(boundary["decodeStatus"], "attestedUnqualified");
            assert_eq!(boundary["decodeBackend"], "webviewVideoFrameCallback");
            assert_eq!(boundary["decodeAttestation"], "representativeFramesV1");
            let consumed = Request::builder()
                .method(Method::GET)
                .uri(media_url)
                .body(Vec::new())
                .unwrap();
            assert_eq!(
                service.protocol_response("research", consumed).status(),
                StatusCode::NOT_FOUND
            );
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn failed_and_explicitly_revoked_decode_attestations_consume_their_grants() {
        let base = temporary_directory("media-revoke");
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("chosen");
        fs::create_dir(&workspace).unwrap();
        let status = service.select(workspace.clone()).unwrap();
        fs::write(workspace.join("stimuli").join("clip.mp4"), b"video").unwrap();
        let item = service
            .rescan(status.workspace_id.as_deref().unwrap())
            .unwrap()
            .stimuli
            .remove(0);

        let invalid = service
            .issue_media_url(
                status.workspace_id.as_deref().unwrap(),
                &item.workspace_file_id,
                &item.sha256,
                item.byte_length,
                &item.mime_type,
            )
            .unwrap();
        let invalid_url = invalid.media_url.clone();
        let error = service
            .attest_workspace_decode(DecodeAttestationRequest {
                attestation_kind: DecodeAttestationKind::AttestRepresentativeFramesV1,
                decode_backend: DecodeBackend::WebviewVideoFrameCallback,
                workspace_id: status.workspace_id.clone().unwrap(),
                media_grant_id: invalid.media_grant_id,
                workspace_file_id: item.workspace_file_id.clone(),
                sha256: item.sha256.clone(),
                byte_length: item.byte_length,
                mime_type: item.mime_type.clone(),
                observed_duration_ms: Some(1_000.0),
                video_width: Some(1_920),
                video_height: Some(1_080),
                muted_playback_ms: Some(100.0),
                decoded_positions_ms: vec![100.0, 500.0, 500.0],
            })
            .unwrap_err();
        assert_eq!(error.code, "invalid_research_contract");
        let request = Request::builder()
            .method(Method::GET)
            .uri(invalid_url)
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            service.protocol_response("research", request).status(),
            StatusCode::NOT_FOUND
        );

        let revoked = service
            .issue_media_url(
                status.workspace_id.as_deref().unwrap(),
                &item.workspace_file_id,
                &item.sha256,
                item.byte_length,
                &item.mime_type,
            )
            .unwrap();
        let revoked_url = revoked.media_url.clone();
        let summary = service
            .attest_workspace_decode(DecodeAttestationRequest {
                attestation_kind: DecodeAttestationKind::RevokeGrant,
                decode_backend: DecodeBackend::WebviewVideoFrameCallback,
                workspace_id: status.workspace_id.unwrap(),
                media_grant_id: revoked.media_grant_id,
                workspace_file_id: item.workspace_file_id,
                sha256: item.sha256,
                byte_length: item.byte_length,
                mime_type: item.mime_type,
                observed_duration_ms: None,
                video_width: None,
                video_height: None,
                muted_playback_ms: None,
                decoded_positions_ms: Vec::new(),
            })
            .unwrap();
        assert_eq!(summary.decode_status, DecodeStatus::Unverified);
        let request = Request::builder()
            .method(Method::GET)
            .uri(revoked_url)
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            service.protocol_response("research", request).status(),
            StatusCode::NOT_FOUND
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn range_parser_rejects_multi_ranges_and_bounds_suffixes() {
        assert_eq!(parse_byte_range(Some("bytes=2-5"), 10), Some((2, 5)));
        assert_eq!(parse_byte_range(Some("bytes=-3"), 10), Some((7, 9)));
        assert_eq!(parse_byte_range(Some("bytes=10-"), 10), None);
        assert_eq!(parse_byte_range(Some("bytes=0-1,4-5"), 10), None);
    }
}

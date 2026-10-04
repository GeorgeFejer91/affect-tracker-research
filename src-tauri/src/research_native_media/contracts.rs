use serde::{Deserialize, Serialize};

pub const NATIVE_MEDIA_CAPABILITY_SCHEMA: &str = "affect-research-native-media-capability";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackMode {
    NativeLibvlc,
    #[default]
    UnqualifiedWebview,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackQualification {
    QualifiedNative,
    Unqualified,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeBundleState {
    NotStaged,
    Invalid,
    Verified,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaCapability {
    pub schema: &'static str,
    pub version: u32,
    pub backend: &'static str,
    pub api: &'static str,
    pub pinned_runtime_version: &'static str,
    pub bindings_version: &'static str,
    pub target: &'static str,
    pub runtime_installer_sha256: &'static str,
    pub runtime_tree_manifest_sha256: &'static str,
    pub default_playback_mode: PlaybackMode,
    pub unqualified_fallback_mode: PlaybackMode,
    pub runtime_bundle_state: RuntimeBundleState,
    pub runtime_integrity_verified: bool,
    pub runtime_file_count: Option<usize>,
    pub runtime_byte_length: Option<u64>,
    pub player_actor_ready: bool,
    pub qualified_start_available: bool,
    pub qualified_format_matrix_ready: bool,
    pub redistribution_review_ready: bool,
    pub ambient_runtime_allowed: bool,
    pub required_for_qualified_run: bool,
    pub renderer_receives_filesystem_paths: bool,
    pub reason_code: String,
}

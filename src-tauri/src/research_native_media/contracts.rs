#![cfg_attr(
    not(all(target_os = "windows", feature = "native-gstreamer")),
    allow(dead_code)
)]

use crate::research_error::{CommandError, ResearchResult};
use crate::research_video_geometry::NativeDisplayMetadataReceiptV1;
use serde::{Deserialize, Serialize};

pub const NATIVE_MEDIA_CAPABILITY_SCHEMA: &str = "affect-research-native-media-capability";
pub const NATIVE_MEDIA_STATUS_SCHEMA: &str = "affect-research-native-media-status";
pub const NATIVE_MEDIA_PREPARE_SCHEMA: &str = "affect-research-native-media-prepare-receipt";
pub const NATIVE_MEDIA_DECODE_SCHEMA: &str = "affect-research-native-media-decode-receipt";

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackMode {
    #[default]
    NativeGstPlay,
    NativeLibvlc,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeMediaViewportCssV1 {
    pub left_css_px: f64,
    pub top_css_px: f64,
    pub width_css_px: f64,
    pub height_css_px: f64,
    pub layout_revision: u64,
}

impl NativeMediaViewportCssV1 {
    pub fn to_physical(
        self,
        scale_factor: f64,
        window_width_px: u32,
        window_height_px: u32,
    ) -> ResearchResult<NativeMediaViewportPxV1> {
        let values = [
            self.left_css_px,
            self.top_css_px,
            self.width_css_px,
            self.height_css_px,
            scale_factor,
        ];
        if values.iter().any(|value| !value.is_finite())
            || self.left_css_px < 0.0
            || self.top_css_px < 0.0
            || self.width_css_px < 1.0
            || self.height_css_px < 1.0
            || !(0.5..=8.0).contains(&scale_factor)
        {
            return Err(CommandError::invalid_contract(
                "The native video viewport is malformed.",
            ));
        }

        let left = (self.left_css_px * scale_factor).round();
        let top = (self.top_css_px * scale_factor).round();
        let width = (self.width_css_px * scale_factor).round();
        let height = (self.height_css_px * scale_factor).round();
        let right = left + width;
        let bottom = top + height;
        if left > i32::MAX as f64
            || top > i32::MAX as f64
            || width > i32::MAX as f64
            || height > i32::MAX as f64
            || right > f64::from(window_width_px)
            || bottom > f64::from(window_height_px)
        {
            return Err(CommandError::invalid_contract(
                "The native video viewport must remain inside the Research window.",
            ));
        }
        Ok(NativeMediaViewportPxV1 {
            left_px: left as i32,
            top_px: top as i32,
            width_px: width as i32,
            height_px: height as i32,
            layout_revision: self.layout_revision,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaViewportPxV1 {
    pub left_px: i32,
    pub top_px: i32,
    pub width_px: i32,
    pub height_px: i32,
    pub layout_revision: u64,
}

impl NativeMediaViewportPxV1 {
    pub(crate) fn initial() -> Self {
        Self {
            left_px: 0,
            top_px: 0,
            width_px: 1,
            height_px: 1,
            layout_revision: 0,
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeMediaCommandFenceV1 {
    pub session_id: String,
    pub generation: u64,
}

impl NativeMediaCommandFenceV1 {
    pub(crate) fn validate(&self) -> ResearchResult<()> {
        if self.generation == 0 {
            return Err(CommandError::invalid_contract(
                "A native media command requires a positive generation.",
            ));
        }
        match uuid::Uuid::parse_str(&self.session_id) {
            Ok(id) if id.to_string() == self.session_id => Ok(()),
            _ => Err(CommandError::invalid_contract(
                "A native media command requires a canonical session ID.",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeMediaStateV1 {
    Idle,
    Preparing,
    Paused,
    Playing,
    Buffering,
    Ended,
    Failed,
    ShuttingDown,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaStatusV1 {
    pub schema: &'static str,
    pub version: u32,
    pub actor_ready: bool,
    pub sequence: u64,
    pub generation: u64,
    pub session_id: Option<String>,
    pub media_grant_id: Option<String>,
    pub workspace_file_id: Option<String>,
    pub state: NativeMediaStateV1,
    pub duration_ms: Option<f64>,
    pub position_ms: Option<f64>,
    pub video_width: Option<u32>,
    pub video_height: Option<u32>,
    pub audio_stream_count: Option<u32>,
    pub buffering_percent: Option<u8>,
    pub warning_count: u32,
    pub viewport: NativeMediaViewportPxV1,
    pub reason_code: Option<String>,
}

impl NativeMediaStatusV1 {
    pub(crate) fn ready() -> Self {
        Self {
            schema: NATIVE_MEDIA_STATUS_SCHEMA,
            version: 1,
            actor_ready: true,
            sequence: 1,
            generation: 0,
            session_id: None,
            media_grant_id: None,
            workspace_file_id: None,
            state: NativeMediaStateV1::Idle,
            duration_ms: None,
            position_ms: None,
            video_width: None,
            video_height: None,
            audio_stream_count: None,
            buffering_percent: None,
            warning_count: 0,
            viewport: NativeMediaViewportPxV1::initial(),
            reason_code: None,
        }
    }

    pub(crate) fn advance(&mut self) {
        self.sequence = self.sequence.saturating_add(1);
    }

    pub(crate) fn clear_media(&mut self) {
        self.session_id = None;
        self.media_grant_id = None;
        self.workspace_file_id = None;
        self.duration_ms = None;
        self.position_ms = None;
        self.video_width = None;
        self.video_height = None;
        self.audio_stream_count = None;
        self.buffering_percent = None;
        self.warning_count = 0;
        self.reason_code = None;
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaPrepareReceiptV1 {
    pub schema: &'static str,
    pub version: u32,
    pub session_id: String,
    pub generation: u64,
    pub media_grant_id: String,
    pub workspace_file_id: String,
    pub state: NativeMediaStateV1,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaDecodeReceiptV1 {
    pub schema: &'static str,
    pub version: u32,
    pub session_id: String,
    pub generation: u64,
    pub media_grant_id: String,
    pub workspace_file_id: String,
    pub duration_ms: f64,
    pub video_width: u32,
    pub video_height: u32,
    pub audio_stream_count: u32,
    pub decoded_positions_ms: Vec<f64>,
    pub decoded_snapshot_count: u32,
    pub display_metadata: NativeDisplayMetadataReceiptV1,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_viewport_is_scaled_and_bounded() {
        let viewport = NativeMediaViewportCssV1 {
            left_css_px: 10.0,
            top_css_px: 20.0,
            width_css_px: 320.0,
            height_css_px: 180.0,
            layout_revision: 7,
        }
        .to_physical(1.5, 900, 600)
        .unwrap();
        assert_eq!(viewport.left_px, 15);
        assert_eq!(viewport.top_px, 30);
        assert_eq!(viewport.width_px, 480);
        assert_eq!(viewport.height_px, 270);
        assert_eq!(viewport.layout_revision, 7);
    }

    #[test]
    fn viewport_rejects_nonfinite_or_out_of_window_geometry() {
        let mut viewport = NativeMediaViewportCssV1 {
            left_css_px: 0.0,
            top_css_px: 0.0,
            width_css_px: 100.0,
            height_css_px: 100.0,
            layout_revision: 1,
        };
        viewport.width_css_px = f64::NAN;
        assert_eq!(
            viewport.to_physical(1.0, 200, 200).unwrap_err().code,
            "invalid_research_contract"
        );
        viewport.width_css_px = 201.0;
        assert_eq!(
            viewport.to_physical(1.0, 200, 200).unwrap_err().code,
            "invalid_research_contract"
        );
    }

    #[test]
    fn command_fence_requires_canonical_uuid_and_positive_generation() {
        assert!(NativeMediaCommandFenceV1 {
            session_id: "00000000-0000-4000-8000-000000000000".to_owned(),
            generation: 1,
        }
        .validate()
        .is_ok());
        assert!(NativeMediaCommandFenceV1 {
            session_id: "NOT-A-UUID".to_owned(),
            generation: 1
        }
        .validate()
        .is_err());
        assert!(NativeMediaCommandFenceV1 {
            session_id: "00000000-0000-4000-8000-000000000000".to_owned(),
            generation: 0,
        }
        .validate()
        .is_err());
    }
}

#![allow(dead_code)]

use super::contracts::{
    NativeMediaCapability, PlaybackMode, RuntimeBundleState, NATIVE_MEDIA_CAPABILITY_SCHEMA,
};
use crate::research_platform::NATIVE_ACQUISITION_UNSUPPORTED_REASON;
use std::path::{Path, PathBuf};

const HTML_VIDEO_REASON: &str = "html-video-player-active";

pub(crate) struct InspectedCapability {
    public: NativeMediaCapability,
    runtime_root: PathBuf,
}

impl InspectedCapability {
    pub(crate) fn runtime_integrity_verified(&self) -> bool {
        self.public.runtime_integrity_verified
    }

    pub(crate) fn runtime_root(&self) -> &Path {
        &self.runtime_root
    }

    pub(crate) fn mark_actor_failed(&mut self, reason_code: &str) {
        self.public.player_actor_ready = false;
        self.public.qualified_start_available = false;
        self.public.reason_code = safe_reason(reason_code);
    }

    pub(crate) fn into_public(self) -> NativeMediaCapability {
        self.public
    }
}

pub(crate) fn pending_capability() -> NativeMediaCapability {
    html_video_capability("html-video-player-active")
}

pub(crate) fn inspect_capability(
    resource_dir: &Path,
    native_acquisition_supported: bool,
) -> InspectedCapability {
    inspect_capability_cancellable(resource_dir, native_acquisition_supported, &|| false)
}

pub(crate) fn inspect_capability_cancellable(
    resource_dir: &Path,
    native_acquisition_supported: bool,
    _canceled: &impl Fn() -> bool,
) -> InspectedCapability {
    let reason = if native_acquisition_supported {
        HTML_VIDEO_REASON
    } else {
        NATIVE_ACQUISITION_UNSUPPORTED_REASON
    };
    InspectedCapability {
        public: html_video_capability(reason),
        runtime_root: resource_dir.to_path_buf(),
    }
}

fn html_video_capability(reason_code: &str) -> NativeMediaCapability {
    NativeMediaCapability {
        schema: NATIVE_MEDIA_CAPABILITY_SCHEMA,
        version: 2,
        backend: "html-video-element",
        api: "research-media",
        pinned_runtime_version: "none",
        bindings_version: "webview",
        target: "tauri-webview",
        runtime_installer_sha256: "",
        runtime_tree_manifest_sha256: "",
        default_playback_mode: PlaybackMode::UnqualifiedWebview,
        unqualified_fallback_mode: PlaybackMode::UnqualifiedWebview,
        runtime_bundle_state: RuntimeBundleState::NotStaged,
        runtime_integrity_verified: false,
        runtime_file_count: None,
        runtime_byte_length: None,
        player_actor_ready: false,
        qualified_start_available: false,
        qualified_format_matrix_ready: false,
        redistribution_review_ready: false,
        ambient_runtime_allowed: false,
        required_for_qualified_run: false,
        renderer_receives_filesystem_paths: false,
        reason_code: safe_reason(reason_code),
    }
}

fn safe_reason(reason_code: &str) -> String {
    if !reason_code.is_empty()
        && reason_code.len() <= 96
        && reason_code
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        reason_code.to_owned()
    } else {
        HTML_VIDEO_REASON.to_owned()
    }
}

#[cfg(test)]
mod cancellation_tests {
    use super::*;

    #[test]
    fn inspection_reports_html_video_protocol_without_runtime_scan() {
        let capability =
            inspect_capability_cancellable(Path::new("not-opened"), true, &|| true).into_public();
        assert_eq!(capability.backend, "html-video-element");
        assert_eq!(capability.api, "research-media");
        assert_eq!(capability.reason_code, HTML_VIDEO_REASON);
        assert_eq!(
            capability.runtime_bundle_state,
            RuntimeBundleState::NotStaged
        );
        assert!(!capability.runtime_integrity_verified);
        assert!(!capability.player_actor_ready);
        assert!(!capability.qualified_start_available);
        assert_eq!(capability.runtime_file_count, None);
        assert_eq!(capability.runtime_byte_length, None);
        assert!(!capability.required_for_qualified_run);
    }
}

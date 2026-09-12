#![cfg_attr(
    not(all(target_os = "windows", feature = "native-gstreamer")),
    allow(dead_code)
)]

use super::contracts::{
    NativeMediaCapability, PlaybackMode, RuntimeBundleState, NATIVE_MEDIA_CAPABILITY_SCHEMA,
};
use crate::research_platform::NATIVE_ACQUISITION_UNSUPPORTED_REASON;
use std::path::{Path, PathBuf};

#[path = "../../native-media/runtime_manifest.rs"]
pub(crate) mod runtime_manifest;

use runtime_manifest::{
    verify_runtime_tree, PINNED_BINDINGS_SERIES, PINNED_GSTREAMER_VERSION, PINNED_INSTALLER_SHA256,
    PINNED_RUNTIME_MANIFEST_SHA256, PINNED_TARGET, RUNTIME_RELATIVE_ROOT,
};

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

/// Immediate fail-closed projection while the worker verifies the pinned tree.
/// NotStaged here makes no positive claim about a not-yet-inspected bundle;
/// the explicit pending reason distinguishes it from a completed absent check.
pub(crate) fn pending_capability() -> NativeMediaCapability {
    NativeMediaCapability {
        schema: NATIVE_MEDIA_CAPABILITY_SCHEMA,
        version: 2,
        backend: "gstreamer-gstplay",
        api: "gstplay",
        pinned_runtime_version: PINNED_GSTREAMER_VERSION,
        bindings_version: PINNED_BINDINGS_SERIES,
        target: PINNED_TARGET,
        runtime_installer_sha256: PINNED_INSTALLER_SHA256,
        runtime_tree_manifest_sha256: PINNED_RUNTIME_MANIFEST_SHA256,
        default_playback_mode: PlaybackMode::NativeGstPlay,
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
        required_for_qualified_run: true,
        renderer_receives_filesystem_paths: false,
        reason_code: "native-runtime-verification-pending".to_owned(),
    }
}

pub(crate) fn inspect_capability(
    resource_dir: &Path,
    native_acquisition_supported: bool,
) -> InspectedCapability {
    let runtime_root = resource_dir.join(RUNTIME_RELATIVE_ROOT);
    let (runtime_bundle_state, runtime_integrity_verified, file_count, byte_length, reason) =
        if !native_acquisition_supported {
            (
                RuntimeBundleState::NotStaged,
                false,
                None,
                None,
                NATIVE_ACQUISITION_UNSUPPORTED_REASON.to_owned(),
            )
        } else {
            match verify_runtime_tree(&runtime_root) {
                Ok(verified) => (
                    RuntimeBundleState::Verified,
                    true,
                    Some(verified.file_count),
                    Some(verified.byte_length),
                    "native-gstplay-actor-not-started".to_owned(),
                ),
                Err(error) => {
                    let state = if error.code.as_str() == "runtime-not-staged" {
                        RuntimeBundleState::NotStaged
                    } else {
                        RuntimeBundleState::Invalid
                    };
                    (state, false, None, None, error.code.as_str().to_owned())
                }
            }
        };

    InspectedCapability {
        public: NativeMediaCapability {
            runtime_bundle_state,
            runtime_integrity_verified,
            runtime_file_count: file_count,
            runtime_byte_length: byte_length,
            reason_code: reason,
            ..pending_capability()
        },
        runtime_root,
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
        "native-gstplay-actor-failed".to_owned()
    }
}

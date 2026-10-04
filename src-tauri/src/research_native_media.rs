#[path = "research_native_media/contracts.rs"]
mod contracts;

pub use contracts::{
    NativeMediaCapability, NativeMediaCommandFenceV1, NativeMediaPrepareReceiptV1,
    NativeMediaStateV1, NativeMediaStatusV1, NativeMediaViewportCssV1, NativeMediaViewportPxV1,
    PlaybackMode, PlaybackQualification,
};

use crate::research_error::{CommandError, ResearchResult};
use crate::research_platform::NATIVE_ACQUISITION_UNSUPPORTED_REASON;
use crate::research_workspace::NativeMediaGrant;
use contracts::{RuntimeBundleState, NATIVE_MEDIA_CAPABILITY_SCHEMA};

/// Fail-closed compatibility for saved native-playback contracts. No player,
/// runtime verifier, window parent, or startup thread is created.
pub struct NativeMediaService {
    native_acquisition_supported: bool,
}

impl NativeMediaService {
    pub fn unavailable(native_acquisition_supported: bool) -> Self {
        Self {
            native_acquisition_supported,
        }
    }

    #[cfg(test)]
    pub fn unavailable_for_tests() -> Self {
        Self::unavailable(true)
    }

    pub fn capability(&self) -> NativeMediaCapability {
        NativeMediaCapability {
            schema: NATIVE_MEDIA_CAPABILITY_SCHEMA,
            version: 2,
            backend: "html-video",
            api: "webview-video",
            pinned_runtime_version: "",
            bindings_version: "",
            target: "browser-webview",
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
            reason_code: if self.native_acquisition_supported {
                "html-video-playback-selected"
            } else {
                NATIVE_ACQUISITION_UNSUPPORTED_REASON
            }
            .to_owned(),
        }
    }

    pub fn authorize_playback(
        &self,
        playback_mode: PlaybackMode,
    ) -> ResearchResult<PlaybackQualification> {
        if !self.native_acquisition_supported {
            return Err(CommandError::native_acquisition_platform_unsupported());
        }
        match playback_mode {
            PlaybackMode::UnqualifiedWebview => Ok(PlaybackQualification::Unqualified),
            _ => self.unavailable_result(),
        }
    }

    pub fn status(&self) -> ResearchResult<NativeMediaStatusV1> {
        self.unavailable_result()
    }

    pub(crate) fn status_snapshot(&self) -> ResearchResult<NativeMediaStatusV1> {
        self.unavailable_result()
    }

    pub(crate) fn prepare(
        &self,
        _grant: NativeMediaGrant,
        _viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaPrepareReceiptV1> {
        self.unavailable_result()
    }

    pub fn set_viewport(
        &self,
        _fence: NativeMediaCommandFenceV1,
        _viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.unavailable_result()
    }

    pub fn play(&self, _fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        self.unavailable_result()
    }

    pub fn pause(&self, _fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        self.unavailable_result()
    }

    pub fn stop(&self, _fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        self.unavailable_result()
    }

    fn unavailable_result<T>(&self) -> ResearchResult<T> {
        Err(CommandError::native_media_unavailable(
            &self.capability().reason_code,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_service_never_claims_native_playback() {
        let service = NativeMediaService::unavailable_for_tests();
        let capability = service.capability();
        assert_eq!(capability.backend, "html-video");
        assert!(!capability.player_actor_ready);
        assert!(!capability.qualified_start_available);
        assert!(!capability.runtime_integrity_verified);
        assert!(service.status().is_err());
        assert!(service
            .authorize_playback(PlaybackMode::NativeLibvlc)
            .is_err());
        assert_eq!(
            service
                .authorize_playback(PlaybackMode::UnqualifiedWebview)
                .unwrap(),
            PlaybackQualification::Unqualified
        );
    }

    #[test]
    fn interface_only_platform_stays_unavailable() {
        let service = NativeMediaService::unavailable(false);
        assert_eq!(
            service.capability().reason_code,
            NATIVE_ACQUISITION_UNSUPPORTED_REASON
        );
        assert!(service
            .authorize_playback(PlaybackMode::UnqualifiedWebview)
            .is_err());
    }
}

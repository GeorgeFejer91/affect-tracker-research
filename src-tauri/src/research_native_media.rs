#[path = "research_native_media/capability.rs"]
mod capability;
#[path = "research_native_media/contracts.rs"]
mod contracts;
#[path = "research_native_media/state.rs"]
mod state;

#[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
#[path = "research_native_media/gst_actor.rs"]
mod gst_actor;

pub use contracts::{
    NativeMediaCapability, NativeMediaCommandFenceV1, NativeMediaDecodeReceiptV1,
    NativeMediaPrepareReceiptV1, NativeMediaStateV1, NativeMediaStatusV1, NativeMediaViewportCssV1,
    NativeMediaViewportPxV1, PlaybackMode, PlaybackQualification,
};

use crate::research_error::{CommandError, ResearchResult};
use crate::research_platform::NATIVE_ACQUISITION_SUPPORTED;
use crate::research_workspace::NativeMediaGrant;
use capability::inspect_capability;
use std::path::Path;

#[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
use gst_actor::{GstActorConfig, GstPlayActorHandle};

#[derive(Debug)]
pub struct NativeMediaService {
    capability: NativeMediaCapability,
    native_acquisition_supported: bool,
    #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
    actor: Option<GstPlayActorHandle>,
}

impl NativeMediaService {
    /// Constructs the production service. The optional native parent handle is
    /// obtained by the Tauri composition root and never crosses the command
    /// boundary exposed to the WebView.
    pub fn start(
        resource_dir: &Path,
        state_dir: &Path,
        parent_window_handle: Option<isize>,
    ) -> Self {
        Self::start_for_platform(
            resource_dir,
            state_dir,
            parent_window_handle,
            NATIVE_ACQUISITION_SUPPORTED,
        )
    }

    fn start_for_platform(
        resource_dir: &Path,
        state_dir: &Path,
        parent_window_handle: Option<isize>,
        native_acquisition_supported: bool,
    ) -> Self {
        let mut capability = inspect_capability(resource_dir, native_acquisition_supported);

        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        let actor = if capability.runtime_integrity_verified() && native_acquisition_supported {
            match parent_window_handle {
                Some(parent_window_handle) => {
                    let config = GstActorConfig::new(
                        capability.runtime_root().to_owned(),
                        state_dir
                            .join("affect-research")
                            .join("v1")
                            .join("gstreamer"),
                        parent_window_handle,
                    );
                    match GstPlayActorHandle::start(config) {
                        Ok(actor) => {
                            capability.mark_actor_ready();
                            Some(actor)
                        }
                        Err(error) => {
                            capability.mark_actor_failed(error.reason_code());
                            None
                        }
                    }
                }
                None => {
                    capability.mark_actor_failed("native-parent-window-unavailable");
                    None
                }
            }
        } else {
            None
        };

        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = (state_dir, parent_window_handle);
            if capability.runtime_integrity_verified() && native_acquisition_supported {
                capability.mark_actor_failed("native-gstreamer-feature-disabled");
            }
        }

        Self {
            capability: capability.into_public(),
            native_acquisition_supported,
            #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
            actor,
        }
    }

    #[cfg(test)]
    pub fn unavailable_for_tests() -> Self {
        Self::start_for_platform(
            Path::new("native-media-runtime-intentionally-absent"),
            Path::new("native-media-state-intentionally-absent"),
            None,
            true,
        )
    }

    pub fn capability(&self) -> NativeMediaCapability {
        self.capability.clone()
    }

    pub fn authorize_playback(
        &self,
        playback_mode: PlaybackMode,
    ) -> ResearchResult<PlaybackQualification> {
        if !self.native_acquisition_supported {
            return Err(CommandError::native_acquisition_platform_unsupported());
        }
        match playback_mode {
            PlaybackMode::NativeGstPlay if self.capability.qualified_start_available => {
                Ok(PlaybackQualification::QualifiedNative)
            }
            PlaybackMode::NativeGstPlay => Err(CommandError::native_media_unavailable(
                &self.capability.reason_code,
            )),
            PlaybackMode::NativeLibvlc => Err(CommandError::native_media_unavailable(
                "native-libvlc-backend-retired",
            )),
            PlaybackMode::UnqualifiedWebview => Ok(PlaybackQualification::Unqualified),
        }
    }

    pub fn status(&self) -> ResearchResult<NativeMediaStatusV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.status())
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        self.actor_unavailable()
    }

    /// Private, non-blocking status projection for the Rust acquisition
    /// coordinator. Unlike the public command, this never queues an actor
    /// request and therefore cannot stall the sampling deadline loop.
    pub(crate) fn status_snapshot(&self) -> ResearchResult<NativeMediaStatusV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| Ok(actor.status_snapshot()))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        self.actor_unavailable()
    }

    pub(crate) fn prepare(
        &self,
        grant: NativeMediaGrant,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaPrepareReceiptV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.prepare(grant, viewport))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = (grant, viewport);
            self.actor_unavailable()
        }
    }

    pub fn set_viewport(
        &self,
        fence: NativeMediaCommandFenceV1,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.set_viewport(fence, viewport))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = (fence, viewport);
            self.actor_unavailable()
        }
    }

    pub fn play(&self, fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.play(fence))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = fence;
            self.actor_unavailable()
        }
    }

    pub fn attest_decode(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaDecodeReceiptV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.attest_decode(fence))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = fence;
            self.actor_unavailable()
        }
    }

    pub fn pause(&self, fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.pause(fence))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = fence;
            self.actor_unavailable()
        }
    }

    pub fn stop(&self, fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.stop(fence))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = fence;
            self.actor_unavailable()
        }
    }

    pub fn shutdown(&self) {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        if let Some(actor) = &self.actor {
            actor.shutdown();
        }
    }

    #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
    fn with_actor<T>(
        &self,
        action: impl FnOnce(&GstPlayActorHandle) -> ResearchResult<T>,
    ) -> ResearchResult<T> {
        let actor = self
            .actor
            .as_ref()
            .ok_or_else(|| CommandError::native_media_unavailable(&self.capability.reason_code))?;
        action(actor)
    }

    #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
    fn actor_unavailable<T>(&self) -> ResearchResult<T> {
        Err(CommandError::native_media_unavailable(
            &self.capability.reason_code,
        ))
    }
}

impl Drop for NativeMediaService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::RuntimeBundleState;

    #[test]
    fn absent_runtime_is_truthful_and_native_start_fails_closed() {
        let media = NativeMediaService::unavailable_for_tests();
        let capability = media.capability();
        assert_eq!(
            capability.default_playback_mode,
            PlaybackMode::NativeGstPlay
        );
        assert_eq!(
            capability.runtime_bundle_state,
            RuntimeBundleState::NotStaged
        );
        assert!(!capability.qualified_start_available);
        let error = media
            .authorize_playback(PlaybackMode::NativeGstPlay)
            .unwrap_err();
        assert_eq!(error.code, "native_media_unavailable");
        assert_eq!(
            media
                .authorize_playback(PlaybackMode::UnqualifiedWebview)
                .unwrap(),
            PlaybackQualification::Unqualified
        );
        assert_eq!(media.status().unwrap_err().code, "native_media_unavailable");
    }

    #[test]
    fn playback_mode_defaults_to_qualified_native() {
        #[derive(serde::Deserialize)]
        struct Wrapper {
            #[serde(default)]
            mode: PlaybackMode,
        }
        let parsed: Wrapper = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.mode, PlaybackMode::NativeGstPlay);
    }

    #[test]
    fn interface_only_platform_skips_windows_runtime_and_rejects_every_playback_mode() {
        let media = NativeMediaService::start_for_platform(
            Path::new("even-if-a-windows-runtime-tree-were-present"),
            Path::new("unused-state"),
            None,
            false,
        );
        let capability = media.capability();
        assert_eq!(
            capability.runtime_bundle_state,
            RuntimeBundleState::NotStaged
        );
        assert!(!capability.runtime_integrity_verified);
        assert_eq!(
            capability.reason_code,
            crate::research_platform::NATIVE_ACQUISITION_UNSUPPORTED_REASON
        );
        assert!(!capability.qualified_start_available);
        for playback_mode in [
            PlaybackMode::NativeGstPlay,
            PlaybackMode::NativeLibvlc,
            PlaybackMode::UnqualifiedWebview,
        ] {
            let error = media.authorize_playback(playback_mode).unwrap_err();
            assert_eq!(error.code, "native_acquisition_platform_unsupported");
        }
    }

    #[test]
    fn machine_readable_pin_matches_the_compiled_verifier() {
        let pin: serde_json::Value =
            serde_json::from_str(include_str!("../native-media/gstreamer-runtime-v1.json"))
                .unwrap();
        assert_eq!(
            pin["runtimeVersion"],
            capability::runtime_manifest::PINNED_GSTREAMER_VERSION
        );
        assert_eq!(
            pin["bindingsSeries"],
            capability::runtime_manifest::PINNED_BINDINGS_SERIES
        );
        assert_eq!(pin["target"], capability::runtime_manifest::PINNED_TARGET);
        assert_eq!(
            pin["installer"]["sha256"],
            capability::runtime_manifest::PINNED_INSTALLER_SHA256
        );
        assert_eq!(
            pin["runtimeTree"]["manifestSha256"],
            capability::runtime_manifest::PINNED_RUNTIME_MANIFEST_SHA256
        );
        assert_eq!(
            pin["runtimeTree"]["fileCount"],
            capability::runtime_manifest::PINNED_RUNTIME_FILE_COUNT
        );
        assert_eq!(
            pin["runtimeTree"]["byteLength"],
            capability::runtime_manifest::PINNED_RUNTIME_BYTE_LENGTH
        );
        assert_eq!(pin["runtimeTree"]["requiredPeMachine"], "0x8664");
        assert_eq!(pin["runtimeTree"]["requiredOptionalHeaderMagic"], "0x020b");
        assert_eq!(pin["productName"], "Affect Research");
    }
}

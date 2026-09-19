#![allow(dead_code)]

#[path = "research_native_media/capability.rs"]
mod capability;
#[path = "research_native_media/contracts.rs"]
mod contracts;
#[path = "research_native_media/live_frame.rs"]
pub mod live_frame;

pub use contracts::{
    NativeMediaCapability, NativeMediaCommandFenceV1, NativeMediaDecodeReceiptV1,
    NativeMediaDecodeReceiptV2, NativeMediaPrepareReceiptV1, NativeMediaStateV1,
    NativeMediaStatusV1, NativeMediaViewportCssV1, NativeMediaViewportPxV1, PlaybackMode,
    PlaybackQualification,
};

use crate::research_error::{CommandError, ResearchResult};
use crate::research_platform::NATIVE_ACQUISITION_SUPPORTED;
use crate::research_workspace::NativeMediaGrant;
use capability::inspect_capability;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const HTML_VIDEO_REASON: &str = "html-video-player-active";

#[derive(Debug)]
struct ServiceState {
    capability: NativeMediaCapability,
}

/// Internal lifecycle projection, deliberately not an IPC or recipe contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeMediaShutdownStatus {
    NotRequested,
    Pending,
    Stalled,
    ReadyToJoin,
    Completed,
}

#[derive(Debug, Default)]
struct ServiceLifecycle {
    requested: AtomicBool,
    completed: AtomicBool,
}

#[derive(Debug)]
pub struct NativeMediaService {
    state: Arc<Mutex<ServiceState>>,
    native_acquisition_supported: bool,
    lifecycle: Arc<ServiceLifecycle>,
    parent: Mutex<Option<tauri::WebviewWindow>>,
}

impl NativeMediaService {
    pub(crate) fn snapshot_live_frame(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<live_frame::LiveFrame> {
        let _ = fence;
        self.actor_unavailable()
    }

    /// Legacy composition compatibility. HTML video is the only active player; this
    /// returns a fail-closed capability without probing for an external runtime.
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
        let _ = (state_dir, parent_window_handle);
        Self::from_capability(
            inspect_capability(resource_dir, native_acquisition_supported).into_public(),
            native_acquisition_supported,
            None,
        )
    }

    fn from_capability(
        capability: NativeMediaCapability,
        native_acquisition_supported: bool,
        parent: Option<tauri::WebviewWindow>,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(ServiceState { capability })),
            native_acquisition_supported,
            lifecycle: Arc::new(ServiceLifecycle::default()),
            parent: Mutex::new(parent),
        }
    }

    /// Returns immediately. The current Runner video authority is the
    /// WebView's HTMLVideoElement over the checked research-media protocol.
    pub fn start_async(
        resource_dir: PathBuf,
        state_dir: PathBuf,
        parent: tauri::WebviewWindow,
    ) -> Arc<Self> {
        let _ = state_dir;
        Arc::new(Self::from_capability(
            inspect_capability(&resource_dir, NATIVE_ACQUISITION_SUPPORTED).into_public(),
            NATIVE_ACQUISITION_SUPPORTED,
            Some(parent),
        ))
    }

    #[cfg(test)]
    pub fn unavailable_for_tests() -> Self {
        Self::start_for_platform(
            Path::new("html-video-runtime"),
            Path::new("html-video-state"),
            None,
            true,
        )
    }

    pub fn capability(&self) -> NativeMediaCapability {
        let mut capability = self
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .capability
            .clone();
        if self.lifecycle.requested.load(Ordering::Acquire) {
            capability.player_actor_ready = false;
            capability.qualified_start_available = false;
            capability.reason_code = match self.shutdown_status() {
                NativeMediaShutdownStatus::Completed => "native-media-shutdown-completed",
                _ => "native-media-shutdown-pending",
            }
            .to_owned();
        }
        capability
    }

    pub fn authorize_playback(
        &self,
        playback_mode: PlaybackMode,
    ) -> ResearchResult<PlaybackQualification> {
        match playback_mode {
            PlaybackMode::UnqualifiedWebview => Ok(PlaybackQualification::Unqualified),
            PlaybackMode::LegacyNativePlayer => {
                if !self.native_acquisition_supported {
                    Err(CommandError::native_acquisition_platform_unsupported())
                } else {
                    Err(CommandError::native_media_unavailable(
                        HTML_VIDEO_REASON,
                    ))
                }
            }
        }
    }

    pub fn status(&self) -> ResearchResult<NativeMediaStatusV1> {
        self.actor_unavailable()
    }

    /// Private, non-blocking status projection for the HTML-video compatibility surface.
    pub(crate) fn status_snapshot(&self) -> ResearchResult<NativeMediaStatusV1> {
        self.actor_unavailable()
    }

    pub(crate) fn prepare(
        &self,
        grant: NativeMediaGrant,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaPrepareReceiptV1> {
        let _ = (grant, viewport);
        self.actor_unavailable()
    }

    pub fn set_viewport(
        &self,
        fence: NativeMediaCommandFenceV1,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        let _ = (fence, viewport);
        self.actor_unavailable()
    }

    pub fn play(&self, fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        let _ = fence;
        self.actor_unavailable()
    }

    pub fn attest_decode(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaDecodeReceiptV1> {
        let _ = fence;
        self.actor_unavailable()
    }

    pub fn attest_decode_v2(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaDecodeReceiptV2> {
        let _ = fence;
        self.actor_unavailable()
    }

    pub fn pause(&self, fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        let _ = fence;
        self.actor_unavailable()
    }

    pub fn stop(&self, fence: NativeMediaCommandFenceV1) -> ResearchResult<NativeMediaStatusV1> {
        let _ = fence;
        self.actor_unavailable()
    }

    pub fn shutdown(&self) {
        self.request_shutdown();
    }

    pub fn request_shutdown(&self) {
        self.lifecycle.requested.store(true, Ordering::Release);
    }

    pub fn is_stopped(&self) -> bool {
        true
    }

    pub fn shutdown_status(&self) -> NativeMediaShutdownStatus {
        if self.lifecycle.completed.load(Ordering::Acquire) {
            NativeMediaShutdownStatus::Completed
        } else if self.lifecycle.requested.load(Ordering::Acquire) {
            NativeMediaShutdownStatus::ReadyToJoin
        } else {
            NativeMediaShutdownStatus::NotRequested
        }
    }

    pub fn finish_shutdown(&self) -> ResearchResult<()> {
        self.request_shutdown();
        self.parent.lock().unwrap_or_else(|p| p.into_inner()).take();
        self.lifecycle.completed.store(true, Ordering::Release);
        Ok(())
    }

    fn actor_unavailable<T>(&self) -> ResearchResult<T> {
        Err(CommandError::native_media_unavailable(
            &self.capability().reason_code,
        ))
    }
}

impl Drop for NativeMediaService {
    fn drop(&mut self) {
        self.request_shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::RuntimeBundleState;

    #[test]
    fn html_video_service_reports_protocol_and_shutdowns_immediately() {
        let media = NativeMediaService::unavailable_for_tests();
        let capability = media.capability();
        assert_eq!(capability.backend, "html-video-element");
        assert_eq!(capability.api, "research-media");
        assert_eq!(
            capability.default_playback_mode,
            PlaybackMode::UnqualifiedWebview
        );
        assert_eq!(
            capability.runtime_bundle_state,
            RuntimeBundleState::NotStaged
        );
        assert!(!capability.required_for_qualified_run);
        assert!(!capability.qualified_start_available);
        assert!(media.is_stopped());
        media.request_shutdown();
        assert_eq!(
            media.shutdown_status(),
            NativeMediaShutdownStatus::ReadyToJoin
        );
        media.finish_shutdown().unwrap();
        assert_eq!(
            media.shutdown_status(),
            NativeMediaShutdownStatus::Completed
        );
    }

    #[test]
    fn native_playback_fails_closed_while_webview_mode_remains_unqualified() {
        let media = NativeMediaService::unavailable_for_tests();
        let error = media
            .authorize_playback(PlaybackMode::LegacyNativePlayer)
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
    fn playback_mode_defaults_to_webview_compatible() {
        #[derive(serde::Deserialize)]
        struct Wrapper {
            #[serde(default)]
            mode: PlaybackMode,
        }
        let parsed: Wrapper = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.mode, PlaybackMode::UnqualifiedWebview);
    }

    #[test]
    fn interface_only_platform_rejects_native_modes() {
        let media = NativeMediaService::start_for_platform(
            Path::new("unused-runtime"),
            Path::new("unused-state"),
            None,
            false,
        );
        assert_eq!(
            media.capability().reason_code,
            crate::research_platform::NATIVE_ACQUISITION_UNSUPPORTED_REASON
        );
        let error = media
            .authorize_playback(PlaybackMode::LegacyNativePlayer)
            .unwrap_err();
        assert_eq!(error.code, "native_acquisition_platform_unsupported");
        assert_eq!(
            media
                .authorize_playback(PlaybackMode::UnqualifiedWebview)
                .unwrap(),
            PlaybackQualification::Unqualified
        );
    }
}

#[path = "research_native_media/capability.rs"]
mod capability;
#[path = "research_native_media/contracts.rs"]
mod contracts;
#[path = "research_native_media/live_frame.rs"]
pub mod live_frame;
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
use capability::{inspect_capability, pending_capability};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
use gst_actor::{GstActorConfig, GstPlayActorHandle};

#[derive(Debug)]
struct ServiceState {
    capability: NativeMediaCapability,
    #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
    actor: Option<Arc<GstPlayActorHandle>>,
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
    requested_at: Mutex<Option<Instant>>,
    completed: AtomicBool,
    initializer_failed: AtomicBool,
}

#[derive(Debug)]
pub struct NativeMediaService {
    state: Arc<Mutex<ServiceState>>,
    native_acquisition_supported: bool,
    lifecycle: Arc<ServiceLifecycle>,
    initializer: Mutex<Option<JoinHandle<()>>>,
    parent: Mutex<Option<tauri::WebviewWindow>>,
    finish: Mutex<()>,
}

impl NativeMediaService {
    pub(crate) fn snapshot_live_frame(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<live_frame::LiveFrame> {
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        {
            self.with_actor(|actor| actor.snapshot_live_frame(fence))
        }
        #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
        {
            let _ = fence;
            self.actor_unavailable()
        }
    }
    /// Legacy composition compatibility. A raw HWND cannot establish a parent
    /// lifetime: this path reports unavailable and never starts a native actor.
    /// Production composition must use start_async with a retained window.
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

        let _ = (state_dir, parent_window_handle);
        if capability.runtime_integrity_verified() && native_acquisition_supported {
            capability.mark_actor_failed("native-media-async-parent-required");
        }
        Self::from_capability(capability.into_public(), native_acquisition_supported, None)
    }

    fn from_capability(
        capability: NativeMediaCapability,
        native_acquisition_supported: bool,
        parent: Option<tauri::WebviewWindow>,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(ServiceState {
                capability,
                #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
                actor: None,
            })),
            native_acquisition_supported,
            lifecycle: Arc::new(ServiceLifecycle::default()),
            initializer: Mutex::new(None),
            parent: Mutex::new(parent),
            finish: Mutex::new(()),
        }
    }

    /// Returns before runtime verification or actor initialization. Main must
    /// keep the parent event loop pumping and veto close/exit until successful
    /// finish_shutdown; a Rust window clone does not veto OS destruction.
    pub fn start_async(
        resource_dir: PathBuf,
        state_dir: PathBuf,
        parent: tauri::WebviewWindow,
    ) -> Arc<Self> {
        let service = Arc::new(Self::from_capability(
            pending_capability(),
            NATIVE_ACQUISITION_SUPPORTED,
            Some(parent.clone()),
        ));
        let state = Arc::clone(&service.state);
        let lifecycle = Arc::clone(&service.lifecycle);
        let started = thread::Builder::new()
            .name("affect-native-media-startup".to_owned())
            .spawn(move || {
                let mut capability =
                    inspect_capability(&resource_dir, NATIVE_ACQUISITION_SUPPORTED);
                #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
                let actor = if capability.runtime_integrity_verified()
                    && !lifecycle.requested.load(Ordering::Acquire)
                {
                    match parent.hwnd() {
                        Ok(hwnd) => match GstPlayActorHandle::spawn(GstActorConfig::new(
                            capability.runtime_root().to_owned(),
                            state_dir
                                .join("affect-research")
                                .join("v1")
                                .join("gstreamer"),
                            hwnd.0 as isize,
                        )) {
                            Ok(actor) => {
                                capability.mark_actor_failed("native-gstplay-startup-pending");
                                Some(Arc::new(actor))
                            }
                            Err(error) => {
                                capability.mark_actor_failed(error.reason_code());
                                None
                            }
                        },
                        Err(_) => {
                            capability.mark_actor_failed("native-parent-window-unavailable");
                            None
                        }
                    }
                } else {
                    None
                };
                #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
                {
                    let _ = (&parent, &state_dir, &lifecycle);
                    if capability.runtime_integrity_verified() {
                        capability.mark_actor_failed("native-gstreamer-feature-disabled");
                    }
                }
                let mut state = state.lock().unwrap_or_else(|p| p.into_inner());
                state.capability = capability.into_public();
                #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
                {
                    state.actor = actor;
                    // Paired with request_shutdown's state lock: neither order
                    // can miss a shutdown requested during runtime inspection.
                    if lifecycle.requested.load(Ordering::Acquire) {
                        if let Some(actor) = &state.actor {
                            actor.request_shutdown();
                        }
                    }
                }
            });
        match started {
            Ok(join) => {
                *service
                    .initializer
                    .lock()
                    .unwrap_or_else(|p| p.into_inner()) = Some(join)
            }
            Err(_) => {
                service
                    .state
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .capability
                    .reason_code = "native-media-initializer-start-failed".to_owned()
            }
        }
        service
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
        let mut capability = self
            .state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .capability
            .clone();
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        if let Some(actor) = self.actor() {
            match actor.startup_result() {
                Some(Ok(())) if !actor.is_stopped() => {
                    capability.player_actor_ready = true;
                    capability.reason_code = "native-qualification-evidence-incomplete".to_owned();
                }
                Some(Err(error)) => {
                    actor.request_shutdown();
                    capability.reason_code = error.reason_code().to_owned();
                }
                _ => {}
            }
            if let Some(reason) = actor.failure_reason() {
                capability.player_actor_ready = false;
                capability.reason_code = reason.to_owned();
            }
        }
        if self.lifecycle.requested.load(Ordering::Acquire) {
            capability.player_actor_ready = false;
            capability.qualified_start_available = false;
            capability.reason_code = match self.shutdown_status() {
                NativeMediaShutdownStatus::Completed => "native-media-shutdown-completed",
                NativeMediaShutdownStatus::Stalled => "native-media-shutdown-stalled",
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
        if !self.native_acquisition_supported {
            return Err(CommandError::native_acquisition_platform_unsupported());
        }
        let capability = self.capability();
        match playback_mode {
            PlaybackMode::NativeGstPlay if capability.qualified_start_available => {
                Ok(PlaybackQualification::QualifiedNative)
            }
            PlaybackMode::NativeGstPlay => Err(CommandError::native_media_unavailable(
                &capability.reason_code,
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
        self.request_shutdown();
    }

    pub fn request_shutdown(&self) {
        if !self.lifecycle.requested.swap(true, Ordering::AcqRel) {
            *self
                .lifecycle
                .requested_at
                .lock()
                .unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
        }
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        if let Some(actor) = self.actor() {
            actor.request_shutdown();
        }
    }

    /// Observation only; completion is not reported until finish_shutdown joins.
    pub fn is_stopped(&self) -> bool {
        if self
            .initializer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .is_some_and(|join| !join.is_finished())
        {
            return false;
        }
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        if self.actor().is_some_and(|actor| !actor.is_stopped()) {
            return false;
        }
        true
    }

    pub fn shutdown_status(&self) -> NativeMediaShutdownStatus {
        if self.lifecycle.completed.load(Ordering::Acquire) {
            NativeMediaShutdownStatus::Completed
        } else if !self.lifecycle.requested.load(Ordering::Acquire) {
            NativeMediaShutdownStatus::NotRequested
        } else if self.is_stopped() {
            NativeMediaShutdownStatus::ReadyToJoin
        } else if self
            .lifecycle
            .requested_at
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_some_and(|at| at.elapsed() >= Duration::from_secs(5))
        {
            NativeMediaShutdownStatus::Stalled
        } else {
            NativeMediaShutdownStatus::Pending
        }
    }

    /// Never waits for a live worker. Main may release the parent only after
    /// this succeeds, not after acknowledgement, a deadline or is_stopped alone.
    pub fn finish_shutdown(&self) -> ResearchResult<()> {
        self.request_shutdown();
        let _finish = self.finish.lock().unwrap_or_else(|p| p.into_inner());
        if !self.is_stopped() {
            return Err(CommandError::native_media_unavailable(
                "native-media-shutdown-pending",
            ));
        }
        if let Some(join) = self
            .initializer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            if join.join().is_err() {
                self.lifecycle
                    .initializer_failed
                    .store(true, Ordering::Release);
            }
        }
        if self.lifecycle.initializer_failed.load(Ordering::Acquire) {
            return Err(CommandError::native_media_unavailable(
                "native-media-initializer-panicked",
            ));
        }
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        if let Some(actor) = self.actor() {
            actor.finish_shutdown()?;
        }
        self.parent.lock().unwrap_or_else(|p| p.into_inner()).take();
        self.lifecycle.completed.store(true, Ordering::Release);
        Ok(())
    }

    #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
    fn actor(&self) -> Option<Arc<GstPlayActorHandle>> {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .actor
            .clone()
    }

    #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
    fn with_actor<T>(
        &self,
        action: impl FnOnce(&GstPlayActorHandle) -> ResearchResult<T>,
    ) -> ResearchResult<T> {
        if self.lifecycle.requested.load(Ordering::Acquire) {
            return Err(CommandError::native_media_unavailable(
                "native-media-shutdown-pending",
            ));
        }
        let actor = self.actor().ok_or_else(|| {
            CommandError::native_media_unavailable(&self.capability().reason_code)
        })?;
        match actor.startup_result() {
            Some(Ok(())) if !actor.is_stopped() => action(&actor),
            Some(Err(error)) => {
                actor.request_shutdown();
                Err(CommandError::native_media_unavailable(error.reason_code()))
            }
            _ => Err(CommandError::native_media_unavailable(
                "native-gstplay-actor-unavailable",
            )),
        }
    }

    #[cfg(not(all(target_os = "windows", feature = "native-gstreamer")))]
    fn actor_unavailable<T>(&self) -> ResearchResult<T> {
        Err(CommandError::native_media_unavailable(
            &self.capability().reason_code,
        ))
    }
}

impl Drop for NativeMediaService {
    fn drop(&mut self) {
        self.request_shutdown();
        // A violated composition contract must not detach an initializer/actor
        // and release its parent. Normal close has already joined both via
        // finish_shutdown; this blocking safety backstop is never the UI path.
        if let Some(join) = self
            .initializer
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            let _ = join.join();
        }
        #[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
        if let Some(actor) = self.actor() {
            actor.join_for_drop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::RuntimeBundleState;

    #[test]
    fn pending_inspection_is_fail_closed_and_shutdown_does_not_wait() {
        let media = NativeMediaService::from_capability(pending_capability(), true, None);
        let (release, wait) = std::sync::mpsc::channel();
        *media.initializer.lock().unwrap() = Some(thread::spawn(move || {
            let _ = wait.recv();
        }));
        assert!(!media.capability().player_actor_ready);
        assert!(!media.capability().runtime_integrity_verified);
        assert!(!media.capability().qualified_start_available);
        assert!(media.status_snapshot().is_err());
        media.request_shutdown();
        media.request_shutdown();
        assert_eq!(media.shutdown_status(), NativeMediaShutdownStatus::Pending);
        assert!(!media.is_stopped());
        assert!(media.finish_shutdown().is_err());
        assert!(media.initializer.lock().unwrap().is_some());
        *media.lifecycle.requested_at.lock().unwrap() =
            Some(Instant::now() - Duration::from_secs(6));
        assert_eq!(media.shutdown_status(), NativeMediaShutdownStatus::Stalled);
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !media.is_stopped() && Instant::now() < deadline {
            thread::yield_now();
        }
        assert!(media.is_stopped());
        assert_eq!(
            media.shutdown_status(),
            NativeMediaShutdownStatus::ReadyToJoin
        );
        media.finish_shutdown().unwrap();
        media.finish_shutdown().unwrap();
        assert!(media.initializer.lock().unwrap().is_none());
        assert_eq!(
            media.shutdown_status(),
            NativeMediaShutdownStatus::Completed
        );
        assert!(!media.capability().qualified_start_available);
    }

    #[test]
    fn initializer_panic_is_not_hidden_by_repeated_finish() {
        let media = NativeMediaService::from_capability(pending_capability(), true, None);
        *media.initializer.lock().unwrap() =
            Some(thread::spawn(|| panic!("synthetic initializer failure")));
        let deadline = Instant::now() + Duration::from_secs(3);
        while !media.is_stopped() && Instant::now() < deadline {
            thread::yield_now();
        }
        assert!(media.is_stopped());
        assert!(media.finish_shutdown().is_err());
        assert!(media.finish_shutdown().is_err());
        assert_ne!(
            media.shutdown_status(),
            NativeMediaShutdownStatus::Completed
        );
    }

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

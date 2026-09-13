#[path = "gst_actor/flow.rs"]
mod flow;
#[path = "gst_actor/orientation.rs"]
mod orientation;
#[path = "gst_actor/runtime_environment.rs"]
mod runtime_environment;
#[path = "gst_actor/windows_renderer.rs"]
mod windows_renderer;

#[cfg(test)]
#[path = "gst_actor/diagnostic.rs"]
mod diagnostic;

use super::contracts::{
    NativeMediaCommandFenceV1, NativeMediaDecodeReceiptV1, NativeMediaDecodeReceiptV2,
    NativeMediaPrepareReceiptV1, NativeMediaStateV1, NativeMediaStatusV1, NativeMediaViewportPxV1,
    NATIVE_MEDIA_DECODE_SCHEMA, NATIVE_MEDIA_PREPARE_SCHEMA,
};
use super::state::{apply_generation_fenced_signal, BackendPlaybackState, MediaSignal};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_video_geometry::{
    derive_native_display_geometry_v2, ControlledRendererV2, NativeDisplayMetadataReceiptV1,
    NativeDisplayMetadataReceiptV2, NativeVideoOrientationV1, SourceOrientationTagV2,
    SourceOrientationV2, VideoRatioV1, NATIVE_DISPLAY_METADATA_SCHEMA,
};
use crate::research_workspace::NativeMediaGrant;
use flow::{Control, Fault, SignalSender};
use gst::prelude::*;
use gst_play::prelude::PlayStreamInfoExt;
use gstreamer as gst;
use gstreamer_play as gst_play;
use runtime_environment::PrivateRuntimeEnvironment;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_renderer::ChildVideoWindow;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const DECODE_PROBE_TIMEOUT: Duration = Duration::from_secs(25);
const EACH_SEEK_TIMEOUT: Duration = Duration::from_secs(5);
const ACTOR_TICK: Duration = Duration::from_millis(4);

#[derive(Debug)]
pub(super) struct GstActorConfig {
    runtime_root: PathBuf,
    state_root: PathBuf,
    parent_window_handle: isize,
}

impl GstActorConfig {
    pub(super) fn new(
        runtime_root: PathBuf,
        state_root: PathBuf,
        parent_window_handle: isize,
    ) -> Self {
        Self {
            runtime_root,
            state_root,
            parent_window_handle,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ActorInitError {
    reason_code: &'static str,
}

impl ActorInitError {
    fn new(reason_code: &'static str) -> Self {
        Self { reason_code }
    }

    pub(super) fn reason_code(self) -> &'static str {
        self.reason_code
    }
}

pub(super) struct GstPlayActorHandle {
    commands: mpsc::SyncSender<QueuedCommand>,
    status_snapshot: Arc<Mutex<NativeMediaStatusV1>>,
    join: Mutex<Option<JoinHandle<()>>>,
    control: Arc<Control>,
    startup: Mutex<ActorStartup>,
    join_failed: AtomicBool,
    admission: Mutex<()>,
}

struct ActorStartup {
    receiver: mpsc::Receiver<StartupSignal>,
    result: Option<Result<(), ActorInitError>>,
    started: Instant,
}

struct StartupSignal {
    result: Result<(), ActorInitError>,
    finished: Instant,
}

impl StartupSignal {
    fn new(result: Result<(), ActorInitError>) -> Self {
        Self {
            result,
            finished: Instant::now(),
        }
    }
}

impl std::fmt::Debug for GstPlayActorHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GstPlayActorHandle")
            .field(
                "shutdown_started",
                &self.control.shutdown.load(Ordering::Acquire),
            )
            .finish_non_exhaustive()
    }
}

impl GstPlayActorHandle {
    pub(super) fn snapshot_live_frame(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<super::live_frame::LiveFrame> {
        let admission = super::live_frame::Admission::acquire()?;
        self.request_with_timeout(
            |response| ActorCommand::SnapshotLiveFrame {
                fence,
                response,
                admission,
            },
            Duration::from_millis(300),
        )
    }
    /// Spawn without waiting for DLL/plugin initialization or cross-thread HWND
    /// messages. The composition owner must keep the parent event loop alive.
    pub(super) fn spawn(config: GstActorConfig) -> Result<Self, ActorInitError> {
        let started = Instant::now();
        let (command_sender, command_receiver) = mpsc::sync_channel(flow::COMMAND_CAPACITY);
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let status_snapshot = Arc::new(Mutex::new(NativeMediaStatusV1::ready()));
        let actor_status_snapshot = Arc::clone(&status_snapshot);
        let control = Arc::new(Control::default());
        let actor_control = Arc::clone(&control);
        let join = thread::Builder::new()
            .name("affect-research-gstplay".to_owned())
            .spawn(move || {
                actor_entry(
                    config,
                    command_receiver,
                    startup_sender,
                    actor_status_snapshot,
                    actor_control,
                )
            })
            .map_err(|_| ActorInitError::new("native-gstplay-thread-start-failed"))?;
        Ok(Self {
            commands: command_sender,
            status_snapshot,
            join: Mutex::new(Some(join)),
            control,
            startup: Mutex::new(ActorStartup {
                receiver: startup_receiver,
                result: None,
                started,
            }),
            join_failed: AtomicBool::new(false),
            admission: Mutex::new(()),
        })
    }

    /// A startup deadline fences admission, never detaches the actor. Even if
    /// foreign initialization stalls, its join and the parent's lease survive.
    pub(super) fn startup_result(&self) -> Option<Result<(), ActorInitError>> {
        let mut startup = self.startup.lock().unwrap_or_else(|p| p.into_inner());
        if startup.result.is_none() {
            startup.result = match startup.receiver.try_recv() {
                Ok(signal)
                    if signal.result.is_ok()
                        && signal.finished.saturating_duration_since(startup.started)
                            >= STARTUP_TIMEOUT =>
                {
                    Some(Err(ActorInitError::new("native-gstplay-startup-timeout")))
                }
                Ok(signal) => Some(signal.result),
                Err(mpsc::TryRecvError::Disconnected) => Some(Err(ActorInitError::new(
                    "native-gstplay-startup-disconnected",
                ))),
                Err(mpsc::TryRecvError::Empty) if startup.started.elapsed() >= STARTUP_TIMEOUT => {
                    Some(Err(ActorInitError::new("native-gstplay-startup-timeout")))
                }
                Err(mpsc::TryRecvError::Empty) => None,
            };
        }
        startup.result
    }

    pub(super) fn status(&self) -> ResearchResult<NativeMediaStatusV1> {
        self.request(|response| ActorCommand::Status { response })
    }

    /// Read-only in-process projection for Rust-owned acquisition workers. It
    /// never crosses IPC and cannot mutate or control the player actor.
    pub(super) fn status_snapshot(&self) -> NativeMediaStatusV1 {
        let _ = self.failure_reason();
        let mut status = self
            .status_snapshot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        project_fault(&self.control, &mut status);
        status.clone()
    }

    pub(super) fn failure_reason(&self) -> Option<&'static str> {
        if self.is_stopped() && !self.control.shutdown.load(Ordering::Acquire) {
            self.control.fail(Fault::ActorExited);
        }
        self.control.reason()
    }

    pub(super) fn prepare(
        &self,
        grant: NativeMediaGrant,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaPrepareReceiptV1> {
        self.request(move |response| ActorCommand::Prepare {
            grant,
            viewport,
            response,
        })
    }

    pub(super) fn set_viewport(
        &self,
        fence: NativeMediaCommandFenceV1,
        viewport: NativeMediaViewportPxV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.request(move |response| ActorCommand::SetViewport {
            fence,
            viewport,
            response,
        })
    }

    pub(super) fn play(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.request(move |response| ActorCommand::Play { fence, response })
    }

    pub(super) fn attest_decode(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaDecodeReceiptV1> {
        self.request_with_timeout(
            move |response| ActorCommand::AttestDecode { fence, response },
            DECODE_PROBE_TIMEOUT,
        )
    }

    pub(super) fn attest_decode_v2(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaDecodeReceiptV2> {
        self.request_with_timeout(
            move |response| ActorCommand::AttestDecodeV2 { fence, response },
            DECODE_PROBE_TIMEOUT,
        )
    }

    pub(super) fn pause(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.request(move |response| ActorCommand::Pause { fence, response })
    }

    pub(super) fn stop(
        &self,
        fence: NativeMediaCommandFenceV1,
    ) -> ResearchResult<NativeMediaStatusV1> {
        self.request(move |response| ActorCommand::Stop { fence, response })
    }

    pub(super) fn request_shutdown(&self) {
        let _admission = self.admission.lock().unwrap_or_else(|p| p.into_inner());
        // Independent of queue capacity. The actor cancels queued operations
        // at the next cooperative boundary; no successful command is invented.
        self.control.shutdown.store(true, Ordering::Release);
    }

    pub(super) fn is_stopped(&self) -> bool {
        self.join
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .is_none_or(JoinHandle::is_finished)
    }

    pub(super) fn finish_shutdown(&self) -> ResearchResult<()> {
        self.request_shutdown();
        let mut join = self
            .join
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if join.as_ref().is_some_and(|thread| !thread.is_finished()) {
            return Err(actor_unavailable("native-gstplay-shutdown-pending"));
        }
        if let Some(thread) = join.take() {
            if thread.join().is_err() {
                self.join_failed.store(true, Ordering::Release);
            }
        }
        if self.join_failed.load(Ordering::Acquire) {
            return Err(actor_unavailable("native-gstplay-actor-panicked"));
        }
        Ok(())
    }

    pub(super) fn join_for_drop(&self) {
        self.request_shutdown();
        if let Some(thread) = self.join.lock().unwrap_or_else(|p| p.into_inner()).take() {
            if thread.join().is_err() {
                self.join_failed.store(true, Ordering::Release);
            }
        }
    }

    fn request<T, F>(&self, build: F) -> ResearchResult<T>
    where
        T: Send + 'static,
        F: FnOnce(mpsc::SyncSender<ResearchResult<T>>) -> ActorCommand,
    {
        self.request_with_timeout(build, COMMAND_TIMEOUT)
    }

    fn request_with_timeout<T, F>(&self, build: F, timeout: Duration) -> ResearchResult<T>
    where
        T: Send + 'static,
        F: FnOnce(mpsc::SyncSender<ResearchResult<T>>) -> ActorCommand,
    {
        let admission = self.admission.lock().unwrap_or_else(|p| p.into_inner());
        if self.control.shutdown.load(Ordering::Acquire) {
            return Err(actor_unavailable("native-gstplay-actor-shutting-down"));
        }
        if let Some(reason) = self.control.reason() {
            return Err(actor_unavailable(reason));
        }
        match self.startup_result() {
            Some(Ok(())) => {}
            Some(Err(error)) => return Err(actor_unavailable(error.reason_code())),
            None => return Err(actor_unavailable("native-gstplay-startup-pending")),
        }
        let (response_sender, response_receiver) = mpsc::sync_channel(1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let _wait = ReplyWait(Arc::clone(&cancelled));
        if let Err(error) = self.commands.try_send(QueuedCommand {
            command: build(response_sender),
            deadline: Instant::now() + timeout,
            cancelled,
        }) {
            self.control.fail(match error {
                mpsc::TrySendError::Full(_) => Fault::CommandsFull,
                mpsc::TrySendError::Disconnected(_) => Fault::Disconnected,
            });
            return Err(actor_unavailable(
                self.control
                    .reason()
                    .unwrap_or("native-gstplay-admission-failed"),
            ));
        }
        drop(admission);
        let result = response_receiver.recv_timeout(timeout).map_err(|error| {
            actor_unavailable(self.control.reason().unwrap_or(match error {
                mpsc::RecvTimeoutError::Timeout => "native-gstplay-command-timeout",
                mpsc::RecvTimeoutError::Disconnected => "native-gstplay-command-cancelled",
            }))
        })?;
        if let Some(reason) = self.control.reason() {
            return Err(actor_unavailable(reason));
        }
        if self.control.shutdown.load(Ordering::Acquire) {
            return Err(actor_unavailable("native-gstplay-command-cancelled"));
        }
        result
    }
}

impl Drop for GstPlayActorHandle {
    fn drop(&mut self) {
        // Safety backstop for an owner violating the explicit finish contract:
        // never detach a thread which may still use the parent HWND. Normal
        // composition calls finish_shutdown after is_stopped, off this path.
        self.join_for_drop();
    }
}

enum ActorCommand {
    AttestDecodeV2 {
        fence: NativeMediaCommandFenceV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaDecodeReceiptV2>>,
    },
    SnapshotLiveFrame {
        fence: NativeMediaCommandFenceV1,
        response: mpsc::SyncSender<ResearchResult<super::live_frame::LiveFrame>>,
        admission: super::live_frame::Admission,
    },
    Status {
        response: mpsc::SyncSender<ResearchResult<NativeMediaStatusV1>>,
    },
    Prepare {
        grant: NativeMediaGrant,
        viewport: NativeMediaViewportPxV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaPrepareReceiptV1>>,
    },
    SetViewport {
        fence: NativeMediaCommandFenceV1,
        viewport: NativeMediaViewportPxV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaStatusV1>>,
    },
    Play {
        fence: NativeMediaCommandFenceV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaStatusV1>>,
    },
    AttestDecode {
        fence: NativeMediaCommandFenceV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaDecodeReceiptV1>>,
    },
    Pause {
        fence: NativeMediaCommandFenceV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaStatusV1>>,
    },
    Stop {
        fence: NativeMediaCommandFenceV1,
        response: mpsc::SyncSender<ResearchResult<NativeMediaStatusV1>>,
    },
}

struct QueuedCommand {
    command: ActorCommand,
    deadline: Instant,
    cancelled: Arc<AtomicBool>,
}

impl QueuedCommand {
    fn into_live(self, control: &Control) -> Option<ActorCommand> {
        if control.cancelled()
            || self.cancelled.load(Ordering::Acquire)
            || Instant::now() >= self.deadline
        {
            None
        } else {
            Some(self.command)
        }
    }
}

/// A timed-out/dropped waiter cannot start a queued mutation later. An already
/// executing foreign call cannot be revoked; its result remains unacknowledged.
struct ReplyWait(Arc<AtomicBool>);
impl Drop for ReplyWait {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

struct GenerationSignal {
    generation: u64,
    signal: MediaSignal,
}

struct ActivePlayer {
    _signal_adapter: gst_play::PlaySignalAdapter,
    play: gst_play::Play,
    _renderer: gst_play::PlayVideoOverlayVideoRenderer,
    _grant: NativeMediaGrant,
    sink: gst::Element,
    display_source_metadata: Arc<Mutex<VersionedMetadata>>,
    controlled_policy: Mutex<Option<(u64, SourceMetadata)>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SourceMetadata {
    stream_id: String,
    encoded_width_px: u32,
    encoded_height_px: u32,
    pixel_aspect_ratio: VideoRatioV1,
    orientation: NativeVideoOrientationV1,
    source_orientation: SourceOrientationV2,
}

struct VersionedMetadata {
    revision: u64,
    value: Result<SourceMetadata, &'static str>,
}

impl VersionedMetadata {
    fn update(&mut self, value: Result<SourceMetadata, &'static str>) {
        if self.value != value {
            match self.revision.checked_add(1) {
                Some(next) => {
                    self.revision = next;
                    self.value = value;
                }
                None => self.value = Err("native-display-metadata-revision-exhausted"),
            }
        }
    }
}

impl ActivePlayer {
    fn stop(&self) {
        self.play.stop();
    }

    fn metadata(&self) -> ResearchResult<(u64, SourceMetadata)> {
        let metadata = self
            .display_source_metadata
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        Ok((
            metadata.revision,
            metadata.value.clone().map_err(actor_unavailable)?,
        ))
    }

    fn ensure_policy_current(&self) -> ResearchResult<()> {
        let frozen = self
            .controlled_policy
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if let Some(expected) = frozen {
            let current_stream = self
                .play
                .current_video_track()
                .map(|track| track.stream_id().to_string());
            orientation::validate_policy_observation(
                &expected.1.stream_id,
                current_stream.as_deref(),
                self.metadata()? == expected,
                expected.1.source_orientation.controlled_rotation()?,
                sink_rotation(&self.sink)?,
            )
            .map_err(actor_unavailable)?;
        }
        Ok(())
    }

    fn configure_policy(
        &self,
        status: &NativeMediaStatusV1,
    ) -> ResearchResult<(u64, SourceMetadata)> {
        let metadata = self.metadata()?;
        if status.video_width != Some(metadata.1.encoded_width_px)
            || status.video_height != Some(metadata.1.encoded_height_px)
        {
            return Err(actor_unavailable("native-gstplay-display-metadata-stale"));
        }
        self.ensure_policy_current()?;
        let mut policy = self
            .controlled_policy
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if policy.is_none() {
            let method = orientation_method(metadata.1.source_orientation.controlled_rotation()?)?;
            self.sink.set_property("rotate-method", method);
            if sink_rotation(&self.sink)? != metadata.1.source_orientation.controlled_rotation()?
                || self.metadata()? != metadata
            {
                return Err(actor_unavailable("native-display-renderer-policy-mismatch"));
            }
            *policy = Some(metadata.clone());
        }
        // First configuration must check the selected track too, before show/play.
        // Release the guard: validation reads the now-frozen policy itself.
        drop(policy);
        self.ensure_policy_current()?;
        Ok(metadata)
    }
}

// This guard also runs during Rust unwinding. It does not catch a panic
// across foreign callbacks; process-abort/foreign hangs remain unqualified.
struct ActorExitGuard(Arc<Control>, Arc<Mutex<NativeMediaStatusV1>>);
impl Drop for ActorExitGuard {
    fn drop(&mut self) {
        self.0.generation.store(0, Ordering::Release);
        if thread::panicking() || !self.0.shutdown.load(Ordering::Acquire) {
            self.0.fail(Fault::ActorExited);
        }
        let mut status = self.1.lock().unwrap_or_else(|p| p.into_inner());
        project_fault(&self.0, &mut status);
    }
}

fn actor_entry(
    config: GstActorConfig,
    commands: mpsc::Receiver<QueuedCommand>,
    startup: mpsc::SyncSender<StartupSignal>,
    shared_status: Arc<Mutex<NativeMediaStatusV1>>,
    control: Arc<Control>,
) {
    let _exit = ActorExitGuard(Arc::clone(&control), Arc::clone(&shared_status));
    let result = initialize_and_run(config, commands, &startup, shared_status, &control);
    if let Err(reason_code) = result {
        let _ = startup.try_send(StartupSignal::new(Err(ActorInitError::new(reason_code))));
    }
}

fn initialize_and_run(
    config: GstActorConfig,
    commands: mpsc::Receiver<QueuedCommand>,
    startup: &mpsc::SyncSender<StartupSignal>,
    shared_status: Arc<Mutex<NativeMediaStatusV1>>,
    control: &Arc<Control>,
) -> Result<(), &'static str> {
    let runtime = PrivateRuntimeEnvironment::activate(&config.runtime_root, &config.state_root)?;
    #[cfg(test)]
    diagnostic::actor_phase("gstreamer-init-start");
    runtime.initialize_gstreamer()?;
    #[cfg(test)]
    diagnostic::actor_phase("gstreamer-init-done");
    let context = gst::glib::MainContext::new();
    context
        .with_thread_default(|| {
            #[cfg(test)]
            diagnostic::actor_phase("child-create-start");
            let child = ChildVideoWindow::create(config.parent_window_handle)?;
            #[cfg(test)]
            diagnostic::actor_phase("child-create-done");
            let _ = child.hide();
            let (signals_sender, signals_receiver) = SignalSender::channel(Arc::clone(control));
            let mut status = NativeMediaStatusV1::ready();
            publish_status_snapshot(&shared_status, &status);
            let mut active: Option<ActivePlayer> = None;
            startup
                .send(StartupSignal::new(Ok(())))
                .map_err(|_| "native-gstplay-startup-receiver-gone")?;

            let mut running = true;
            while running && !control.cancelled() {
                pump_context(&context, control);
                flow::budgeted(
                    || {
                        if let Ok(signal) = signals_receiver.try_recv() {
                            apply_admitted_signal(control, &mut status, signal);
                            true
                        } else {
                            false
                        }
                    },
                    flow::SIGNAL_BUDGET,
                    control,
                );
                if let Some(player) = &active {
                    if player.ensure_policy_current().is_err()
                        && !matches!(
                            status.state,
                            NativeMediaStateV1::Failed | NativeMediaStateV1::Idle
                        )
                    {
                        player.play.pause();
                        let _ = child.hide();
                        status.state = NativeMediaStateV1::Failed;
                        status.reason_code = Some("native-display-renderer-policy-stale".into());
                        status.advance();
                    }
                }
                project_fault(control, &mut status);
                publish_status_snapshot(&shared_status, &status);
                if control.cancelled() {
                    break;
                }
                child.pump_messages()?;

                match commands.recv_timeout(ACTOR_TICK) {
                    Ok(command) => {
                        if control.cancelled() {
                            break;
                        }
                        let Some(command) = command.into_live(control) else {
                            continue;
                        };
                        running = handle_command(
                            command,
                            &context,
                            &child,
                            &signals_sender,
                            &signals_receiver,
                            &mut active,
                            &mut status,
                        );
                        project_fault(control, &mut status);
                        publish_status_snapshot(&shared_status, &status);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        control.fail(Fault::Disconnected);
                        running = false;
                    }
                }
            }

            control.generation.store(0, Ordering::Release);
            status.state = NativeMediaStateV1::ShuttingDown;
            status.advance();
            project_fault(control, &mut status);
            publish_status_snapshot(&shared_status, &status);
            teardown_active(&mut active);
            let _ = child.hide();
            Ok::<(), &'static str>(())
        })
        .map_err(|_| "gstreamer-main-context-unavailable")??;
    drop(runtime);
    Ok(())
}

fn project_fault(control: &Control, status: &mut NativeMediaStatusV1) {
    if let Some(reason) = control.reason() {
        if status.state != NativeMediaStateV1::Failed
            || status.reason_code.as_deref() != Some(reason)
        {
            status.state = NativeMediaStateV1::Failed;
            status.actor_ready = false;
            status.reason_code = Some(reason.to_owned());
            status.advance();
        }
    }
}

fn apply_admitted_signal(
    control: &Control,
    status: &mut NativeMediaStatusV1,
    signal: GenerationSignal,
) {
    if !control.cancelled()
        && signal.generation != 0
        && signal.generation == control.generation.load(Ordering::Acquire)
    {
        let _ = apply_generation_fenced_signal(status, signal.generation, signal.signal);
    }
}

fn pump_context(context: &gst::glib::MainContext, control: &Control) {
    flow::budgeted(
        || {
            if !context.pending() {
                return false;
            }
            let _ = context.iteration(false);
            true
        },
        flow::CONTEXT_BUDGET,
        control,
    );
}

fn publish_status_snapshot(
    shared_status: &Arc<Mutex<NativeMediaStatusV1>>,
    status: &NativeMediaStatusV1,
) {
    *shared_status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = status.clone();
}

fn handle_command(
    command: ActorCommand,
    context: &gst::glib::MainContext,
    child: &ChildVideoWindow,
    signals: &SignalSender,
    signal_receiver: &mpsc::Receiver<GenerationSignal>,
    active: &mut Option<ActivePlayer>,
    status: &mut NativeMediaStatusV1,
) -> bool {
    match command {
        ActorCommand::Status { response } => {
            let _ = response.send(Ok(status.clone()));
        }
        ActorCommand::Prepare {
            grant,
            viewport,
            response,
        } => {
            let result = prepare_player(context, child, signals, active, status, grant, viewport);
            let _ = response.send(result);
        }
        ActorCommand::SetViewport {
            fence,
            viewport,
            response,
        } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                child.set_viewport(viewport).map_err(actor_unavailable)?;
                status.viewport = viewport;
                status.advance();
                Ok(status.clone())
            });
            let _ = response.send(result);
        }
        ActorCommand::Play { fence, response } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                if !matches!(status.state, NativeMediaStateV1::Paused) {
                    return Err(CommandError::invalid_contract(
                        "Native playback can begin only after media preparation reaches Paused.",
                    ));
                }
                let player = active
                    .as_ref()
                    .ok_or_else(|| actor_unavailable("native-gstplay-player-missing"))?;
                player.configure_policy(status)?;
                child.show().map_err(actor_unavailable)?;
                player.play.play();
                Ok(status.clone())
            });
            let _ = response.send(result);
        }
        ActorCommand::SnapshotLiveFrame {
            fence,
            response,
            admission,
        } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                let player = active
                    .as_ref()
                    .ok_or_else(|| actor_unavailable("native-gstplay-player-missing"))?;
                super::live_frame::capture(&player.play, status)
            });
            let _ = response.send(result);
            drop(admission);
        }
        ActorCommand::AttestDecodeV2 { fence, response } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                if status.state != NativeMediaStateV1::Paused {
                    return Err(CommandError::invalid_contract(
                        "Native decode attestation requires prepared, paused media.",
                    ));
                }
                let player = active
                    .as_ref()
                    .ok_or_else(|| actor_unavailable("native-gstplay-player-missing"))?;
                let metadata = player.configure_policy(status)?;
                let legacy = run_decode_probe(
                    context,
                    child,
                    signal_receiver,
                    player,
                    status,
                    &signals.control,
                )?;
                player.ensure_policy_current()?;
                let receipt = NativeDisplayMetadataReceiptV2 {
                    schema: NATIVE_DISPLAY_METADATA_SCHEMA.into(),
                    version: 2,
                    encoded_width_px: metadata.1.encoded_width_px,
                    encoded_height_px: metadata.1.encoded_height_px,
                    pixel_aspect_ratio: metadata.1.pixel_aspect_ratio,
                    source_orientation: metadata.1.source_orientation,
                    snapshot_width_px: legacy.display_metadata.snapshot_width_px,
                    snapshot_height_px: legacy.display_metadata.snapshot_height_px,
                    snapshot_pixel_aspect_ratio: legacy
                        .display_metadata
                        .snapshot_pixel_aspect_ratio,
                    snapshot_interpretation: "pre-renderer-square-pixel".into(),
                    renderer: ControlledRendererV2 {
                        sink_factory: "d3d11videosink".into(),
                        configured_rotation_degrees: metadata
                            .1
                            .source_orientation
                            .controlled_rotation()?,
                        readback_rotation_degrees: sink_rotation(&player.sink)?,
                    },
                };
                derive_native_display_geometry_v2(&receipt)?;
                Ok(NativeMediaDecodeReceiptV2 {
                    schema: NATIVE_MEDIA_DECODE_SCHEMA,
                    version: 2,
                    session_id: legacy.session_id,
                    generation: legacy.generation,
                    media_grant_id: legacy.media_grant_id,
                    workspace_file_id: legacy.workspace_file_id,
                    duration_ms: legacy.duration_ms,
                    video_width: legacy.video_width,
                    video_height: legacy.video_height,
                    audio_stream_count: legacy.audio_stream_count,
                    decoded_snapshot_count: legacy.decoded_snapshot_count,
                    decoded_positions_ms: legacy.decoded_positions_ms,
                    display_metadata: receipt,
                })
            });
            let _ = response.send(result);
        }
        ActorCommand::AttestDecode { fence, response } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                let player = active
                    .as_ref()
                    .ok_or_else(|| actor_unavailable("native-gstplay-player-missing"))?;
                run_decode_probe(
                    context,
                    child,
                    signal_receiver,
                    player,
                    status,
                    &signals.control,
                )
            });
            let _ = response.send(result);
        }
        ActorCommand::Pause { fence, response } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                if !matches!(
                    status.state,
                    NativeMediaStateV1::Playing | NativeMediaStateV1::Buffering
                ) {
                    return Err(CommandError::invalid_contract(
                        "Native playback can pause only while playing or buffering.",
                    ));
                }
                let player = active
                    .as_ref()
                    .ok_or_else(|| actor_unavailable("native-gstplay-player-missing"))?;
                player.play.pause();
                Ok(status.clone())
            });
            let _ = response.send(result);
        }
        ActorCommand::Stop { fence, response } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                signals.control.generation.store(0, Ordering::Release);
                teardown_active(active);
                child.hide().map_err(actor_unavailable)?;
                status.clear_media();
                status.state = NativeMediaStateV1::Idle;
                status.advance();
                Ok(status.clone())
            });
            let _ = response.send(result);
        }
    }
    true
}

fn prepare_player(
    context: &gst::glib::MainContext,
    child: &ChildVideoWindow,
    signals: &SignalSender,
    active: &mut Option<ActivePlayer>,
    status: &mut NativeMediaStatusV1,
    grant: NativeMediaGrant,
    viewport: NativeMediaViewportPxV1,
) -> ResearchResult<NativeMediaPrepareReceiptV1> {
    validate_grant(&grant)?;
    let uri = url::Url::from_file_path(&grant.path).map_err(|_| {
        CommandError::forbidden("The native media grant cannot be represented as a local URI.")
    })?;
    signals.control.generation.store(0, Ordering::Release);
    teardown_active(active);
    child.hide().map_err(actor_unavailable)?;
    child.set_viewport(viewport).map_err(actor_unavailable)?;

    let generation = status
        .generation
        .checked_add(1)
        .ok_or_else(|| actor_unavailable("native-gstplay-generation-exhausted"))?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let media_grant_id = grant.media_grant_id.clone();
    let workspace_file_id = grant.workspace_file_id.clone();
    let renderer = child.create_renderer().map_err(actor_unavailable)?;
    let sink = gst::ElementFactory::make("d3d11videosink")
        .build()
        .map_err(|_| actor_unavailable("native-display-controlled-sink-unavailable"))?;
    let property = sink
        .find_property("rotate-method")
        .ok_or_else(|| actor_unavailable("native-display-renderer-property-unavailable"))?;
    if property.value_type() != gst_play::gst_video::VideoOrientationMethod::static_type()
        || !property
            .flags()
            .contains(gst::glib::ParamFlags::READABLE | gst::glib::ParamFlags::WRITABLE)
    {
        return Err(actor_unavailable(
            "native-display-renderer-property-unavailable",
        ));
    }
    sink.set_property(
        "rotate-method",
        gst_play::gst_video::VideoOrientationMethod::Identity,
    );
    if sink_rotation(&sink)? != 0 {
        return Err(actor_unavailable("native-display-renderer-policy-mismatch"));
    }
    renderer.set_video_sink(Some(&sink));
    if renderer.video_sink().as_ref() != Some(&sink) {
        return Err(actor_unavailable(
            "native-display-controlled-sink-unavailable",
        ));
    }
    let play = gst_play::Play::new(Some(renderer.clone()));
    #[cfg(test)]
    diagnostic::mute_if_opted_in(&play);
    let signal_adapter = gst_play::PlaySignalAdapter::with_main_context(&play, context);
    let display_source_metadata = Arc::new(Mutex::new(VersionedMetadata {
        revision: 0,
        value: Err("native-gstplay-display-metadata-unavailable"),
    }));
    signals
        .control
        .generation
        .store(generation, Ordering::Release);
    connect_signals(
        &play,
        &signal_adapter,
        generation,
        signals.clone(),
        Arc::clone(&display_source_metadata),
    );

    status.clear_media();
    status.generation = generation;
    status.session_id = Some(session_id.clone());
    status.media_grant_id = Some(media_grant_id.clone());
    status.workspace_file_id = Some(workspace_file_id.clone());
    status.viewport = viewport;
    status.state = NativeMediaStateV1::Preparing;
    status.advance();

    play.set_uri(Some(uri.as_str()));
    play.pause();
    *active = Some(ActivePlayer {
        _signal_adapter: signal_adapter,
        play,
        _renderer: renderer,
        sink,
        controlled_policy: Mutex::new(None),
        _grant: grant,
        display_source_metadata,
    });

    Ok(NativeMediaPrepareReceiptV1 {
        schema: NATIVE_MEDIA_PREPARE_SCHEMA,
        version: 1,
        session_id,
        generation,
        media_grant_id,
        workspace_file_id,
        state: NativeMediaStateV1::Preparing,
    })
}

fn connect_signals(
    play: &gst_play::Play,
    adapter: &gst_play::PlaySignalAdapter,
    generation: u64,
    sender: SignalSender,
    display_source_metadata: Arc<Mutex<VersionedMetadata>>,
) {
    let next = sender.clone();
    adapter.connect_state_changed(move |_, state| {
        let mapped = match state {
            gst_play::PlayState::Stopped => BackendPlaybackState::Stopped,
            gst_play::PlayState::Buffering => BackendPlaybackState::Buffering,
            gst_play::PlayState::Paused => BackendPlaybackState::Paused,
            gst_play::PlayState::Playing => BackendPlaybackState::Playing,
            _ => BackendPlaybackState::Unknown,
        };
        let _ = next.send(GenerationSignal {
            generation,
            signal: MediaSignal::BackendState(mapped),
        });
    });
    let next = sender.clone();
    adapter.connect_buffering(move |_, percent| {
        let _ = next.send(GenerationSignal {
            generation,
            signal: MediaSignal::Buffering(percent),
        });
    });
    let next = sender.clone();
    adapter.connect_end_of_stream(move |_| {
        let _ = next.send(GenerationSignal {
            generation,
            signal: MediaSignal::EndOfStream,
        });
    });
    let next = sender.clone();
    adapter.connect_error(move |_, _, _| {
        let _ = next.send(GenerationSignal {
            generation,
            signal: MediaSignal::Error,
        });
    });
    let next = sender.clone();
    adapter.connect_warning(move |_, _, _| {
        let _ = next.send(GenerationSignal {
            generation,
            signal: MediaSignal::Warning,
        });
    });
    let next = sender.clone();
    adapter.connect_position_updated(move |_, position| {
        if let Some(position) = position {
            let _ = next.send(GenerationSignal {
                generation,
                signal: MediaSignal::PositionMs(clock_time_ms(position)),
            });
        }
    });
    let next = sender.clone();
    adapter.connect_seek_done(move |_, position| {
        let _ = next.send(GenerationSignal {
            generation,
            signal: MediaSignal::SeekDoneMs(clock_time_ms(position)),
        });
    });
    let weak_play = play.downgrade();
    adapter.connect_media_info_updated(move |_, info| {
        let video = weak_play
            .upgrade()
            .and_then(|play| play.current_video_track());
        let source_metadata = (|| {
            let stream = video
                .as_ref()
                .ok_or("native-gstplay-display-metadata-unavailable")?;
            let pixel_aspect_ratio = ratio_from_fraction(stream.pixel_aspect_ratio())
                .ok_or("native-gstplay-display-metadata-unavailable")?;
            let stream_tag = parse_source_tag(stream.tags().as_deref());
            let media_tag = parse_source_tag(info.tags().as_deref());
            let resolved = orientation::reconcile(stream_tag, media_tag)?;
            let source_orientation = SourceOrientationV2 {
                stream: wire_source_tag(stream_tag?),
                media: wire_source_tag(media_tag?),
            };
            let orientation = match resolved {
                orientation::SourceOrientation::Absent => NativeVideoOrientationV1::Missing,
                orientation::SourceOrientation::Explicit(0) => NativeVideoOrientationV1::Identity,
                orientation::SourceOrientation::Explicit(90) => {
                    NativeVideoOrientationV1::Rotate90Clockwise
                }
                orientation::SourceOrientation::Explicit(180) => {
                    NativeVideoOrientationV1::Rotate180
                }
                orientation::SourceOrientation::Explicit(270) => {
                    NativeVideoOrientationV1::Rotate90Counterclockwise
                }
                _ => return Err("native-display-orientation-unsupported"),
            };
            Ok(SourceMetadata {
                stream_id: stream.stream_id().to_string(),
                encoded_width_px: u32::try_from(stream.width())
                    .map_err(|_| "native-gstplay-display-metadata-unavailable")?,
                encoded_height_px: u32::try_from(stream.height())
                    .map_err(|_| "native-gstplay-display-metadata-unavailable")?,
                pixel_aspect_ratio,
                orientation,
                source_orientation,
            })
        })();
        display_source_metadata
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .update(source_metadata);
        let _ = sender.send(GenerationSignal {
            generation,
            signal: MediaSignal::MediaInfo {
                duration_ms: info.duration().map(clock_time_ms),
                video_width: video
                    .as_ref()
                    .and_then(|stream| u32::try_from(stream.width()).ok()),
                video_height: video
                    .as_ref()
                    .and_then(|stream| u32::try_from(stream.height()).ok()),
                audio_stream_count: info.number_of_audio_streams(),
            },
        });
    });
}

fn run_decode_probe(
    context: &gst::glib::MainContext,
    child: &ChildVideoWindow,
    signals: &mpsc::Receiver<GenerationSignal>,
    player: &ActivePlayer,
    status: &mut NativeMediaStatusV1,
    control: &Control,
) -> ResearchResult<NativeMediaDecodeReceiptV1> {
    if status.state != NativeMediaStateV1::Paused {
        return Err(CommandError::invalid_contract(
            "Native decode attestation requires prepared, paused media.",
        ));
    }
    let duration_ms = status
        .duration_ms
        .ok_or_else(|| actor_unavailable("native-gstplay-duration-unavailable"))?;
    let video_width = status
        .video_width
        .ok_or_else(|| actor_unavailable("native-gstplay-video-width-unavailable"))?;
    let video_height = status
        .video_height
        .ok_or_else(|| actor_unavailable("native-gstplay-video-height-unavailable"))?;
    let audio_stream_count = status.audio_stream_count.unwrap_or(0);
    let session_id = status
        .session_id
        .clone()
        .ok_or_else(|| actor_unavailable("native-gstplay-session-unavailable"))?;
    let media_grant_id = status
        .media_grant_id
        .clone()
        .ok_or_else(|| actor_unavailable("native-gstplay-grant-unavailable"))?;
    let workspace_file_id = status
        .workspace_file_id
        .clone()
        .ok_or_else(|| actor_unavailable("native-gstplay-workspace-file-unavailable"))?;
    let generation = status.generation;
    let expected_positions = representative_positions_ms(duration_ms)?;
    let mut decoded_positions_ms = Vec::with_capacity(expected_positions.len());
    let (_, source_metadata) = player.configure_policy(status)?;
    if source_metadata.encoded_width_px != video_width
        || source_metadata.encoded_height_px != video_height
    {
        return Err(actor_unavailable("native-gstplay-display-metadata-stale"));
    }
    let mut snapshot_geometry = None;

    for target_ms in expected_positions {
        player.ensure_policy_current()?;
        player.play.seek(clock_time_from_ms(target_ms));
        let observed_ms = wait_for_seek(
            context, child, signals, status, generation, target_ms, control,
        )?;
        player.ensure_policy_current()?;
        let snapshot = player
            .play
            .video_snapshot(gst_play::PlaySnapshotFormat::RawBgrx, None)
            .ok_or_else(|| actor_unavailable("native-gstplay-snapshot-unavailable"))?;
        let decoded_bytes = snapshot.buffer().map(|buffer| buffer.size()).unwrap_or(0);
        if decoded_bytes == 0 {
            return Err(actor_unavailable("native-gstplay-snapshot-empty"));
        }
        let caps = snapshot
            .caps()
            .ok_or_else(|| actor_unavailable("native-gstplay-snapshot-caps-unavailable"))?;
        let snapshot_info = gst_play::gst_video::VideoInfo::from_caps(caps)
            .map_err(|_| actor_unavailable("native-gstplay-snapshot-caps-invalid"))?;
        let observed_geometry = (
            snapshot_info.width(),
            snapshot_info.height(),
            ratio_from_fraction(snapshot_info.par())
                .ok_or_else(|| actor_unavailable("native-gstplay-snapshot-pixel-aspect-invalid"))?,
        );
        if snapshot_geometry
            .replace(observed_geometry)
            .is_some_and(|previous| previous != observed_geometry)
        {
            return Err(actor_unavailable(
                "native-gstplay-snapshot-geometry-unstable",
            ));
        }
        decoded_positions_ms.push(observed_ms);
    }
    let (snapshot_width_px, snapshot_height_px, snapshot_pixel_aspect_ratio) = snapshot_geometry
        .ok_or_else(|| actor_unavailable("native-gstplay-snapshot-geometry-unavailable"))?;

    player.play.seek(gst::ClockTime::ZERO);
    let _ = wait_for_seek(context, child, signals, status, generation, 0.0, control)?;
    player.ensure_policy_current()?;
    status.position_ms = Some(0.0);
    status.state = NativeMediaStateV1::Paused;
    status.advance();

    Ok(NativeMediaDecodeReceiptV1 {
        schema: NATIVE_MEDIA_DECODE_SCHEMA,
        version: 1,
        session_id,
        generation,
        media_grant_id,
        workspace_file_id,
        duration_ms,
        video_width,
        video_height,
        audio_stream_count,
        decoded_snapshot_count: decoded_positions_ms.len() as u32,
        decoded_positions_ms,
        display_metadata: NativeDisplayMetadataReceiptV1 {
            schema: NATIVE_DISPLAY_METADATA_SCHEMA,
            version: 1,
            encoded_width_px: source_metadata.encoded_width_px,
            encoded_height_px: source_metadata.encoded_height_px,
            pixel_aspect_ratio: source_metadata.pixel_aspect_ratio,
            orientation: source_metadata.orientation,
            snapshot_width_px,
            snapshot_height_px,
            snapshot_pixel_aspect_ratio,
        },
    })
}

fn ratio_from_fraction(value: gst::Fraction) -> Option<VideoRatioV1> {
    Some(VideoRatioV1 {
        numerator: u32::try_from(value.numer()).ok()?,
        denominator: u32::try_from(value.denom()).ok()?,
    })
}

fn orientation_method(degrees: u16) -> ResearchResult<gst_play::gst_video::VideoOrientationMethod> {
    use gst_play::gst_video::VideoOrientationMethod as Method;
    match degrees {
        0 => Ok(Method::Identity),
        90 => Ok(Method::_90r),
        180 => Ok(Method::_180),
        270 => Ok(Method::_90l),
        _ => Err(actor_unavailable("native-display-orientation-unsupported")),
    }
}

fn sink_rotation(sink: &gst::Element) -> ResearchResult<u16> {
    use gst_play::gst_video::VideoOrientationMethod as Method;
    match sink.property::<Method>("rotate-method") {
        Method::Identity => Ok(0),
        Method::_90r => Ok(90),
        Method::_180 => Ok(180),
        Method::_90l => Ok(270),
        _ => Err(actor_unavailable("native-display-renderer-policy-mismatch")),
    }
}

fn parse_source_tag(
    tags: Option<&gst::TagListRef>,
) -> Result<orientation::SourceOrientation, &'static str> {
    let Some(tags) = tags else {
        return orientation::parse_tag(0, None);
    };
    let count = tags.size_by_name("image-orientation");
    let value = tags
        .index_generic("image-orientation", 0)
        .and_then(|value| value.get::<&str>().ok());
    orientation::parse_tag(count, value)
}

fn wire_source_tag(value: orientation::SourceOrientation) -> SourceOrientationTagV2 {
    match value {
        orientation::SourceOrientation::Absent => SourceOrientationTagV2::Absent {},
        orientation::SourceOrientation::Explicit(rotation_degrees) => {
            SourceOrientationTagV2::Explicit { rotation_degrees }
        }
    }
}

fn wait_for_seek(
    context: &gst::glib::MainContext,
    child: &ChildVideoWindow,
    signals: &mpsc::Receiver<GenerationSignal>,
    status: &mut NativeMediaStatusV1,
    generation: u64,
    target_ms: f64,
    control: &Control,
) -> ResearchResult<f64> {
    let deadline = Instant::now() + EACH_SEEK_TIMEOUT;
    while Instant::now() < deadline {
        if control.cancelled() {
            return Err(actor_unavailable(
                control
                    .reason()
                    .unwrap_or("native-gstplay-actor-shutting-down"),
            ));
        }
        pump_context(context, control);
        child.pump_messages().map_err(actor_unavailable)?;
        match signals.recv_timeout(Duration::from_millis(2)) {
            Ok(next) => {
                let observed_seek = match &next.signal {
                    MediaSignal::SeekDoneMs(position_ms) if next.generation == generation => {
                        Some(*position_ms)
                    }
                    _ => None,
                };
                let _ = apply_generation_fenced_signal(status, next.generation, next.signal);
                if status.state == NativeMediaStateV1::Failed {
                    return Err(actor_unavailable("native-gstplay-seek-failed"));
                }
                if let Some(position_ms) = observed_seek {
                    let tolerance_ms = 250.0_f64.max(duration_tolerance(target_ms));
                    if (position_ms - target_ms).abs() <= tolerance_ms {
                        return Ok(position_ms);
                    }
                    return Err(actor_unavailable("native-gstplay-seek-position-mismatch"));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(actor_unavailable("native-gstplay-signal-channel-closed"));
            }
        }
    }
    Err(actor_unavailable("native-gstplay-seek-timeout"))
}

fn representative_positions_ms(duration_ms: f64) -> ResearchResult<[f64; 3]> {
    if !duration_ms.is_finite() || !(10.0..=86_400_000.0).contains(&duration_ms) {
        return Err(CommandError::invalid_contract(
            "Native decode attestation requires a finite complete-video duration.",
        ));
    }
    let offset = (duration_ms * 0.1).min(250.0);
    let positions = [offset, duration_ms * 0.5, duration_ms - offset];
    if positions
        .windows(2)
        .any(|window| window[1] - window[0] < 1.0)
    {
        return Err(CommandError::invalid_contract(
            "Native decode attestation requires three distinct frame positions.",
        ));
    }
    Ok(positions)
}

fn duration_tolerance(target_ms: f64) -> f64 {
    (target_ms.abs() * 0.001).clamp(1.0, 25.0)
}

fn clock_time_from_ms(value: f64) -> gst::ClockTime {
    gst::ClockTime::from_nseconds((value * 1_000_000.0).round() as u64)
}

fn validate_grant(grant: &NativeMediaGrant) -> ResearchResult<()> {
    let metadata = grant.file.metadata().map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() != grant.byte_length
        || grant.mime_type.is_empty()
        || grant.mime_type.len() > 128
        || grant.sha256.len() != 64
        || !grant
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(CommandError::forbidden(
            "The native media grant no longer matches its verified workspace identity.",
        ));
    }
    Ok(())
}

fn ensure_fence(
    status: &NativeMediaStatusV1,
    fence: &NativeMediaCommandFenceV1,
) -> ResearchResult<()> {
    fence.validate()?;
    if status.session_id.as_deref() != Some(fence.session_id.as_str())
        || status.generation != fence.generation
    {
        return Err(CommandError::forbidden(
            "The native media command is stale for the active generation.",
        ));
    }
    Ok(())
}

fn teardown_active(active: &mut Option<ActivePlayer>) {
    if let Some(player) = active.take() {
        player.stop();
        drop(player);
    }
}

fn clock_time_ms(value: gst::ClockTime) -> f64 {
    value.seconds_f64() * 1000.0
}

fn actor_unavailable(reason_code: &'static str) -> CommandError {
    CommandError::new(
        "native_media_actor",
        format!("The native media actor rejected the operation ({reason_code})."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_revision_changes_only_when_evidence_changes() {
        let mut metadata = VersionedMetadata {
            revision: 0,
            value: Err("unavailable"),
        };
        metadata.update(Err("unavailable"));
        assert_eq!(metadata.revision, 0);
        let source = SourceMetadata {
            stream_id: "video-0".into(),
            encoded_width_px: 1920,
            encoded_height_px: 1080,
            pixel_aspect_ratio: VideoRatioV1 {
                numerator: 1,
                denominator: 1,
            },
            orientation: NativeVideoOrientationV1::Missing,
            source_orientation: SourceOrientationV2 {
                stream: SourceOrientationTagV2::Absent {},
                media: SourceOrientationTagV2::Absent {},
            },
        };
        metadata.update(Ok(source.clone()));
        assert_eq!(metadata.revision, 1);
        metadata.update(Ok(source.clone()));
        assert_eq!(metadata.revision, 1);
        metadata.update(Ok(SourceMetadata {
            stream_id: "video-1".into(),
            ..source.clone()
        }));
        assert_eq!(metadata.revision, 2);
        metadata.update(Err("malformed"));
        assert_eq!(metadata.revision, 3);
        metadata.update(Ok(source));
        assert_eq!(metadata.revision, 4);
    }

    #[test]
    fn metadata_revision_exhaustion_never_restores_success() {
        let mut metadata = VersionedMetadata {
            revision: u64::MAX,
            value: Err("unavailable"),
        };
        metadata.update(Err("changed"));
        assert_eq!(metadata.revision, u64::MAX);
        assert_eq!(
            metadata.value,
            Err("native-display-metadata-revision-exhausted")
        );
        metadata.update(Err("changed-again"));
        assert_eq!(
            metadata.value,
            Err("native-display-metadata-revision-exhausted")
        );
    }

    struct HeldActor {
        actor: GstPlayActorHandle,
        release: mpsc::Sender<()>,
        startup: mpsc::SyncSender<StartupSignal>,
        commands: mpsc::Receiver<QueuedCommand>,
    }

    fn held_actor() -> HeldActor {
        let (commands, receiver) = mpsc::sync_channel(flow::COMMAND_CAPACITY);
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let (release, wait) = mpsc::channel();
        let join = thread::spawn(move || {
            let _ = wait.recv();
        });
        HeldActor {
            actor: GstPlayActorHandle {
                commands,
                status_snapshot: Arc::new(Mutex::new(NativeMediaStatusV1::ready())),
                join: Mutex::new(Some(join)),
                control: Arc::new(Control::default()),
                startup: Mutex::new(ActorStartup {
                    receiver: startup_receiver,
                    result: None,
                    started: Instant::now(),
                }),
                join_failed: AtomicBool::new(false),
                admission: Mutex::new(()),
            },
            release,
            startup: startup_sender,
            commands: receiver,
        }
    }

    fn release_actor(actor: &GstPlayActorHandle, release: mpsc::Sender<()>) {
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !actor.is_stopped() && Instant::now() < deadline {
            thread::yield_now();
        }
        assert!(actor.is_stopped());
        actor.finish_shutdown().unwrap();
        actor.finish_shutdown().unwrap();
        assert!(actor.join.lock().unwrap().is_none());
    }

    #[test]
    fn startup_timeout_retains_join_and_late_ready_cannot_reopen_admission() {
        let HeldActor {
            actor,
            release,
            startup,
            commands: _commands,
        } = held_actor();
        actor.startup.lock().unwrap().started = Instant::now() - STARTUP_TIMEOUT;
        assert_eq!(
            actor.startup_result().unwrap().unwrap_err().reason_code(),
            "native-gstplay-startup-timeout"
        );
        startup.send(StartupSignal::new(Ok(()))).unwrap();
        assert!(actor.startup_result().unwrap().is_err());
        assert!(actor.status().is_err());
        assert!(!actor.is_stopped());
        actor.request_shutdown();
        assert!(actor.finish_shutdown().is_err());
        assert!(actor.join.lock().unwrap().is_some());
        release_actor(&actor, release);
    }

    #[test]
    fn repeated_shutdown_fences_commands_without_waiting_for_thread_exit() {
        let HeldActor {
            actor,
            release,
            startup,
            commands,
        } = held_actor();
        startup.send(StartupSignal::new(Ok(()))).unwrap();
        actor.request_shutdown();
        actor.request_shutdown();
        assert!(actor.control.shutdown.load(Ordering::Acquire));
        assert!(matches!(
            commands.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert!(actor.status().is_err());
        assert!(!actor.is_stopped());
        assert!(actor.finish_shutdown().is_err());
        release_actor(&actor, release);
    }

    #[test]
    fn late_completion_is_rejected_even_before_first_status_poll() {
        let HeldActor {
            actor,
            release,
            startup,
            commands: _commands,
        } = held_actor();
        actor.startup.lock().unwrap().started = Instant::now() - STARTUP_TIMEOUT;
        startup.send(StartupSignal::new(Ok(()))).unwrap();
        assert_eq!(
            actor.startup_result().unwrap().unwrap_err().reason_code(),
            "native-gstplay-startup-timeout"
        );
        release_actor(&actor, release);
    }

    #[test]
    fn saturated_commands_fail_stop_without_blocking_shutdown() {
        let HeldActor {
            actor,
            release,
            startup,
            commands,
        } = held_actor();
        startup.send(StartupSignal::new(Ok(()))).unwrap();
        for _ in 0..flow::COMMAND_CAPACITY {
            let (response, _) = mpsc::sync_channel(1);
            assert!(actor
                .commands
                .try_send(QueuedCommand {
                    command: ActorCommand::Status { response },
                    deadline: Instant::now() + COMMAND_TIMEOUT,
                    cancelled: Arc::new(AtomicBool::new(false)),
                })
                .is_ok());
        }
        let stop = actor.stop(NativeMediaCommandFenceV1 {
            session_id: "00000000-0000-4000-8000-000000000000".to_owned(),
            generation: 1,
        });
        actor.request_shutdown();
        let snapshot = actor.status_snapshot();
        let reason = actor.control.reason();
        let shutdown = actor.control.shutdown.load(Ordering::Acquire);
        release_actor(&actor, release);
        assert!(stop.unwrap_err().message.contains("command-overload"));
        assert!(shutdown);
        assert_eq!(reason, Some("native-gstplay-command-overload"));
        assert_eq!(snapshot.state, NativeMediaStateV1::Failed);
        assert!(!snapshot.actor_ready);
        assert_eq!(commands.try_iter().count(), flow::COMMAND_CAPACITY);
    }

    #[test]
    fn disconnected_command_receiver_is_terminal_and_join_is_retained() {
        let HeldActor {
            actor,
            release,
            startup,
            commands,
        } = held_actor();
        startup.send(StartupSignal::new(Ok(()))).unwrap();
        drop(commands);
        let result = actor.status();
        let snapshot = actor.status_snapshot();
        release_actor(&actor, release);
        assert!(result.unwrap_err().message.contains("channel-disconnected"));
        assert_eq!(snapshot.state, NativeMediaStateV1::Failed);
    }

    #[test]
    fn dropped_or_expired_waiter_cannot_execute_queued_work() {
        let (response, _receiver) = mpsc::sync_channel(1);
        let cancelled = Arc::new(AtomicBool::new(false));
        let waiter = ReplyWait(Arc::clone(&cancelled));
        let queued = QueuedCommand {
            command: ActorCommand::Status { response },
            deadline: Instant::now() + COMMAND_TIMEOUT,
            cancelled,
        };
        drop(waiter);
        assert!(queued.into_live(&Control::default()).is_none());
        let (response, _receiver) = mpsc::sync_channel(1);
        let queued = QueuedCommand {
            command: ActorCommand::Status { response },
            deadline: Instant::now(),
            cancelled: Arc::new(AtomicBool::new(false)),
        };
        assert!(queued.into_live(&Control::default()).is_none());
    }

    #[test]
    fn live_queued_work_retains_fifo_order() {
        let (sender, receiver) = mpsc::sync_channel(2);
        let (first, first_reply) = mpsc::sync_channel(1);
        let (second, second_reply) = mpsc::sync_channel(1);
        for response in [first, second] {
            sender
                .try_send(QueuedCommand {
                    command: ActorCommand::Status { response },
                    deadline: Instant::now() + COMMAND_TIMEOUT,
                    cancelled: Arc::new(AtomicBool::new(false)),
                })
                .ok()
                .unwrap();
        }
        let mut status = NativeMediaStatusV1::ready();
        for sequence in [10, 11] {
            let ActorCommand::Status { response } = receiver
                .try_recv()
                .unwrap()
                .into_live(&Control::default())
                .unwrap()
            else {
                panic!("wrong command");
            };
            status.sequence = sequence;
            response.send(Ok(status.clone())).unwrap();
        }
        assert_eq!(first_reply.recv().unwrap().unwrap().sequence, 10);
        assert_eq!(second_reply.recv().unwrap().unwrap().sequence, 11);
    }

    #[test]
    fn shutdown_cancels_every_queued_waiter_without_executing_work() {
        let control = Control::default();
        let (sender, receiver) = mpsc::sync_channel(flow::COMMAND_CAPACITY);
        let mut replies = Vec::new();
        for _ in 0..flow::COMMAND_CAPACITY {
            let (response, reply) = mpsc::sync_channel(1);
            replies.push(reply);
            sender
                .try_send(QueuedCommand {
                    command: ActorCommand::Status { response },
                    deadline: Instant::now() + COMMAND_TIMEOUT,
                    cancelled: Arc::new(AtomicBool::new(false)),
                })
                .ok()
                .unwrap();
        }
        control.shutdown.store(true, Ordering::Release);
        for command in receiver.try_iter() {
            assert!(command.into_live(&control).is_none());
        }
        for reply in replies {
            assert!(matches!(
                reply.try_recv(),
                Err(mpsc::TryRecvError::Disconnected)
            ));
        }
    }

    #[test]
    fn already_queued_callback_cannot_revive_stopped_generation() {
        let control = Control::default();
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 1;
        let before = status.clone();
        apply_admitted_signal(
            &control,
            &mut status,
            GenerationSignal {
                generation: 1,
                signal: MediaSignal::BackendState(BackendPlaybackState::Playing),
            },
        );
        assert_eq!(status, before);
    }

    #[test]
    fn unwind_during_requested_shutdown_still_projects_terminal_failure() {
        let control = Arc::new(Control::default());
        control.shutdown.store(true, Ordering::Release);
        let status = Arc::new(Mutex::new(NativeMediaStatusV1::ready()));
        let guard = ActorExitGuard(Arc::clone(&control), Arc::clone(&status));
        let join = thread::spawn(move || {
            let _guard = guard;
            panic!("synthetic actor failure");
        });
        assert!(join.join().is_err());
        assert_eq!(control.reason(), Some("native-gstplay-actor-exited"));
        assert_eq!(status.lock().unwrap().state, NativeMediaStateV1::Failed);
    }

    #[test]
    fn unexpected_actor_exit_cannot_leave_playing_snapshot() {
        let HeldActor {
            actor,
            release,
            startup: _startup,
            commands: _commands,
        } = held_actor();
        actor.status_snapshot.lock().unwrap().state = NativeMediaStateV1::Playing;
        release.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !actor.is_stopped() && Instant::now() < deadline {
            thread::yield_now();
        }
        let snapshot = actor.status_snapshot();
        actor.finish_shutdown().unwrap();
        assert_eq!(snapshot.state, NativeMediaStateV1::Failed);
        assert_eq!(
            snapshot.reason_code.as_deref(),
            Some("native-gstplay-actor-exited")
        );
        assert_eq!(actor.status_snapshot(), snapshot);
    }

    #[test]
    fn clock_time_conversion_preserves_submillisecond_precision() {
        let time = gst::ClockTime::from_nseconds(1_234_567_890);
        assert!((clock_time_ms(time) - 1234.56789).abs() < 0.000_001);
    }

    #[test]
    fn stale_fence_is_rejected_without_exposing_identity() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 9;
        status.session_id = Some("00000000-0000-4000-8000-000000000000".to_owned());
        let error = ensure_fence(
            &status,
            &NativeMediaCommandFenceV1 {
                session_id: "11111111-1111-4111-8111-111111111111".to_owned(),
                generation: 9,
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "forbidden_operation");
        assert!(!error.message.contains("11111111"));
    }
}

#[path = "gst_actor/runtime_environment.rs"]
mod runtime_environment;
#[path = "gst_actor/windows_renderer.rs"]
mod windows_renderer;

use super::contracts::{
    NativeMediaCommandFenceV1, NativeMediaDecodeReceiptV1, NativeMediaPrepareReceiptV1,
    NativeMediaStateV1, NativeMediaStatusV1, NativeMediaViewportPxV1, NATIVE_MEDIA_DECODE_SCHEMA,
    NATIVE_MEDIA_PREPARE_SCHEMA,
};
use super::state::{apply_generation_fenced_signal, BackendPlaybackState, MediaSignal};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_workspace::NativeMediaGrant;
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
    commands: mpsc::Sender<ActorCommand>,
    status_snapshot: Arc<Mutex<NativeMediaStatusV1>>,
    join: Mutex<Option<JoinHandle<()>>>,
    shutdown_started: AtomicBool,
}

impl std::fmt::Debug for GstPlayActorHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GstPlayActorHandle")
            .field(
                "shutdown_started",
                &self.shutdown_started.load(Ordering::Acquire),
            )
            .finish_non_exhaustive()
    }
}

impl GstPlayActorHandle {
    pub(super) fn start(config: GstActorConfig) -> Result<Self, ActorInitError> {
        let (command_sender, command_receiver) = mpsc::channel();
        let (startup_sender, startup_receiver) = mpsc::sync_channel(1);
        let status_snapshot = Arc::new(Mutex::new(NativeMediaStatusV1::ready()));
        let actor_status_snapshot = Arc::clone(&status_snapshot);
        let join = thread::Builder::new()
            .name("affect-research-gstplay".to_owned())
            .spawn(move || {
                actor_entry(
                    config,
                    command_receiver,
                    startup_sender,
                    actor_status_snapshot,
                )
            })
            .map_err(|_| ActorInitError::new("native-gstplay-thread-start-failed"))?;
        match startup_receiver.recv_timeout(STARTUP_TIMEOUT) {
            Ok(Ok(())) => Ok(Self {
                commands: command_sender,
                status_snapshot,
                join: Mutex::new(Some(join)),
                shutdown_started: AtomicBool::new(false),
            }),
            Ok(Err(error)) => {
                let _ = join.join();
                Err(error)
            }
            Err(_) => {
                drop(command_sender);
                drop(join);
                Err(ActorInitError::new("native-gstplay-startup-timeout"))
            }
        }
    }

    pub(super) fn status(&self) -> ResearchResult<NativeMediaStatusV1> {
        self.request(|response| ActorCommand::Status { response })
    }

    /// Read-only in-process projection for Rust-owned acquisition workers. It
    /// never crosses IPC and cannot mutate or control the player actor.
    pub(super) fn status_snapshot(&self) -> NativeMediaStatusV1 {
        self.status_snapshot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
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

    pub(super) fn shutdown(&self) {
        if self.shutdown_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let (response_sender, response_receiver) = mpsc::sync_channel(1);
        let sent = self
            .commands
            .send(ActorCommand::Shutdown {
                response: response_sender,
            })
            .is_ok();
        let acknowledged = sent && response_receiver.recv_timeout(COMMAND_TIMEOUT).is_ok();
        let mut join = self
            .join
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if acknowledged {
            if let Some(thread) = join.take() {
                let _ = thread.join();
            }
        } else {
            // Dropping a still-running JoinHandle detaches rather than blocking
            // application shutdown indefinitely. The actor still observes the
            // disconnected command channel and performs its own teardown.
            let _ = join.take();
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
        if self.shutdown_started.load(Ordering::Acquire) {
            return Err(actor_unavailable("native-gstplay-actor-shutting-down"));
        }
        let (response_sender, response_receiver) = mpsc::sync_channel(1);
        self.commands
            .send(build(response_sender))
            .map_err(|_| actor_unavailable("native-gstplay-actor-disconnected"))?;
        response_receiver
            .recv_timeout(timeout)
            .map_err(|_| actor_unavailable("native-gstplay-command-timeout"))?
    }
}

impl Drop for GstPlayActorHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

enum ActorCommand {
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
    Shutdown {
        response: mpsc::SyncSender<()>,
    },
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
}

impl ActivePlayer {
    fn stop(&self) {
        self.play.stop();
    }
}

fn actor_entry(
    config: GstActorConfig,
    commands: mpsc::Receiver<ActorCommand>,
    startup: mpsc::SyncSender<Result<(), ActorInitError>>,
    shared_status: Arc<Mutex<NativeMediaStatusV1>>,
) {
    let result = initialize_and_run(config, commands, &startup, shared_status);
    if let Err(reason_code) = result {
        let _ = startup.send(Err(ActorInitError::new(reason_code)));
    }
}

fn initialize_and_run(
    config: GstActorConfig,
    commands: mpsc::Receiver<ActorCommand>,
    startup: &mpsc::SyncSender<Result<(), ActorInitError>>,
    shared_status: Arc<Mutex<NativeMediaStatusV1>>,
) -> Result<(), &'static str> {
    let runtime = PrivateRuntimeEnvironment::activate(&config.runtime_root, &config.state_root)?;
    runtime.initialize_gstreamer()?;
    let context = gst::glib::MainContext::new();
    context
        .with_thread_default(|| {
            let child = ChildVideoWindow::create(config.parent_window_handle)?;
            let _ = child.hide();
            let (signals_sender, signals_receiver) = mpsc::channel::<GenerationSignal>();
            let mut status = NativeMediaStatusV1::ready();
            publish_status_snapshot(&shared_status, &status);
            let mut active: Option<ActivePlayer> = None;
            startup
                .send(Ok(()))
                .map_err(|_| "native-gstplay-startup-receiver-gone")?;

            let mut running = true;
            while running {
                while context.pending() {
                    let _ = context.iteration(false);
                }
                while let Ok(signal) = signals_receiver.try_recv() {
                    let _ = apply_generation_fenced_signal(
                        &mut status,
                        signal.generation,
                        signal.signal,
                    );
                    publish_status_snapshot(&shared_status, &status);
                }
                child.pump_messages()?;

                match commands.recv_timeout(ACTOR_TICK) {
                    Ok(command) => {
                        running = handle_command(
                            command,
                            &context,
                            &child,
                            &signals_sender,
                            &signals_receiver,
                            &mut active,
                            &mut status,
                        );
                        publish_status_snapshot(&shared_status, &status);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => running = false,
                }
            }

            status.state = NativeMediaStateV1::ShuttingDown;
            status.advance();
            publish_status_snapshot(&shared_status, &status);
            teardown_active(&mut active);
            let _ = child.hide();
            Ok::<(), &'static str>(())
        })
        .map_err(|_| "gstreamer-main-context-unavailable")??;
    drop(runtime);
    Ok(())
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
    signals: &mpsc::Sender<GenerationSignal>,
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
                child.show().map_err(actor_unavailable)?;
                player.play.play();
                Ok(status.clone())
            });
            let _ = response.send(result);
        }
        ActorCommand::AttestDecode { fence, response } => {
            let result = ensure_fence(status, &fence).and_then(|_| {
                let player = active
                    .as_ref()
                    .ok_or_else(|| actor_unavailable("native-gstplay-player-missing"))?;
                run_decode_probe(context, child, signal_receiver, player, status)
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
                teardown_active(active);
                child.hide().map_err(actor_unavailable)?;
                status.clear_media();
                status.state = NativeMediaStateV1::Idle;
                status.advance();
                Ok(status.clone())
            });
            let _ = response.send(result);
        }
        ActorCommand::Shutdown { response } => {
            status.state = NativeMediaStateV1::ShuttingDown;
            status.advance();
            teardown_active(active);
            let _ = child.hide();
            let _ = response.send(());
            return false;
        }
    }
    true
}

fn prepare_player(
    context: &gst::glib::MainContext,
    child: &ChildVideoWindow,
    signals: &mpsc::Sender<GenerationSignal>,
    active: &mut Option<ActivePlayer>,
    status: &mut NativeMediaStatusV1,
    grant: NativeMediaGrant,
    viewport: NativeMediaViewportPxV1,
) -> ResearchResult<NativeMediaPrepareReceiptV1> {
    validate_grant(&grant)?;
    let uri = url::Url::from_file_path(&grant.path).map_err(|_| {
        CommandError::forbidden("The native media grant cannot be represented as a local URI.")
    })?;
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
    let play = gst_play::Play::new(Some(renderer.clone()));
    let signal_adapter = gst_play::PlaySignalAdapter::with_main_context(&play, context);
    connect_signals(&signal_adapter, generation, signals.clone());

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
        _grant: grant,
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
    adapter: &gst_play::PlaySignalAdapter,
    generation: u64,
    sender: mpsc::Sender<GenerationSignal>,
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
    adapter.connect_media_info_updated(move |_, info| {
        let video = info.video_streams().into_iter().next();
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

    for target_ms in expected_positions {
        player.play.seek(clock_time_from_ms(target_ms));
        let observed_ms = wait_for_seek(context, child, signals, status, generation, target_ms)?;
        let snapshot = player
            .play
            .video_snapshot(gst_play::PlaySnapshotFormat::RawBgrx, None)
            .ok_or_else(|| actor_unavailable("native-gstplay-snapshot-unavailable"))?;
        let decoded_bytes = snapshot.buffer().map(|buffer| buffer.size()).unwrap_or(0);
        if decoded_bytes == 0 {
            return Err(actor_unavailable("native-gstplay-snapshot-empty"));
        }
        decoded_positions_ms.push(observed_ms);
    }

    player.play.seek(gst::ClockTime::ZERO);
    let _ = wait_for_seek(context, child, signals, status, generation, 0.0)?;
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
    })
}

fn wait_for_seek(
    context: &gst::glib::MainContext,
    child: &ChildVideoWindow,
    signals: &mpsc::Receiver<GenerationSignal>,
    status: &mut NativeMediaStatusV1,
    generation: u64,
    target_ms: f64,
) -> ResearchResult<f64> {
    let deadline = Instant::now() + EACH_SEEK_TIMEOUT;
    while Instant::now() < deadline {
        while context.pending() {
            let _ = context.iteration(false);
        }
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

//! Same-PC transport control for the VLC player. These accepted
//! commands are not qualified Runner playback or recording evidence.
use super::{
    prepare_video, required_file, selected_master, sidecar_settings, wait_for_outlets, wait_for_rc,
    Result,
};
use affect_research::research_runner_master::MasterSelector;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PROTOCOL: &str = "flubber-vlc-control/v1";
const MAX_FRAME: usize = 16 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol: String,
    request_id: String,
    command: Action,
    generation: Option<u64>,
    video_path: Option<PathBuf>,
    master_sequence: Option<SequenceArm>,
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SequenceArm {
    master_path: PathBuf,
    participant_id: String,
    selector: MasterSelector,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Action {
    Arm,
    Start,
    Pause,
    Resume,
    Stop,
    Status,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SequenceReceipt {
    status: String,
    path: PathBuf,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply<'a> {
    protocol: &'static str,
    request_id: Option<&'a str>,
    ok: bool,
    state: &'static str,
    generation: u64,
    error: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sequence_receipt: Option<SequenceReceipt>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Armed,
    StartRequested,
    PauseRequested,
    StopRequested,
    Shutdown,
}
impl Phase {
    fn label(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Armed => "armed",
            Self::StartRequested => "start-requested",
            Self::PauseRequested => "pause-requested",
            Self::StopRequested => "stop-requested",
            Self::Shutdown => "shutdown",
        }
    }
}

trait Player {
    fn arm(&mut self, video: &Path, panel: Option<u32>, step: Option<u32>) -> Result<()>;
    fn arm_sequence(&mut self, request: &SequenceArm) -> Result<()>;
    fn start(&mut self) -> Result<()>;
    fn pause(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn alive(&mut self) -> Result<bool>;
    fn poll_sequence(&mut self) -> Result<Option<SequenceReceipt>>;
    fn shutdown(&mut self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Legacy,
    Sequence,
}

struct Controller<P: Player> {
    player: P,
    phase: Phase,
    generation: u64,
    mode: Option<Mode>,
    terminal_receipt: Option<SequenceReceipt>,
}
impl<P: Player> Controller<P> {
    fn new(player: P) -> Self {
        Self {
            player,
            phase: Phase::Idle,
            generation: 0,
            mode: None,
            terminal_receipt: None,
        }
    }

    fn reply<'a>(&self, id: Option<&'a str>, ok: bool, error: Option<&'static str>) -> Reply<'a> {
        Reply {
            protocol: PROTOCOL,
            request_id: id,
            ok,
            state: self.phase.label(),
            generation: self.generation,
            error,
            sequence_receipt: None,
        }
    }

    fn refresh_sequence(&mut self) -> Result<()> {
        if self.mode == Some(Mode::Sequence) && self.phase != Phase::Idle {
            if let Some(receipt) = self.player.poll_sequence()? {
                self.terminal_receipt = Some(receipt);
                self.phase = Phase::Idle;
                self.mode = None;
            }
        }
        Ok(())
    }

    fn handle<'a>(&mut self, request: &'a Request) -> Reply<'a> {
        let id = Some(request.request_id.as_str());
        if request.protocol != PROTOCOL
            || request.request_id.is_empty()
            || request.request_id.len() > 64
            || !request
                .request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
        {
            return self.reply(id, false, Some("invalid_request"));
        }
        if self.phase == Phase::Shutdown {
            return self.reply(id, false, Some("session_closed"));
        }
        if !matches!(request.command, Action::Arm)
            && (request.video_path.is_some()
                || request.master_sequence.is_some()
                || request.panel_percent.is_some()
                || request.step_percent.is_some())
        {
            return self.reply(id, false, Some("unexpected_fields"));
        }
        if matches!(request.command, Action::Arm) {
            if request.generation.is_some() || self.phase != Phase::Idle {
                return self.reply(id, false, Some("invalid_state"));
            }
            if request.master_sequence.is_some()
                && (request.video_path.is_some()
                    || request.panel_percent.is_some()
                    || request.step_percent.is_some())
            {
                return self.reply(id, false, Some("unexpected_fields"));
            }
            if self.generation == u64::MAX {
                return self.reply(id, false, Some("generation_exhausted"));
            }
            let mode = if let Some(sequence) = &request.master_sequence {
                if self.player.arm_sequence(sequence).is_err() {
                    self.player.shutdown();
                    return self.reply(id, false, Some("arm_failed"));
                }
                Mode::Sequence
            } else {
                let Some(video) = request.video_path.as_deref() else {
                    return self.reply(id, false, Some("video_required"));
                };
                if video.extension().is_some_and(|extension| {
                    extension.to_string_lossy().eq_ignore_ascii_case("json")
                }) {
                    return self.reply(id, false, Some("master_execution_unsupported"));
                }
                if self
                    .player
                    .arm(video, request.panel_percent, request.step_percent)
                    .is_err()
                {
                    self.player.shutdown();
                    return self.reply(id, false, Some("arm_failed"));
                }
                Mode::Legacy
            };
            self.generation += 1;
            self.phase = Phase::Armed;
            self.mode = Some(mode);
            self.terminal_receipt = None;
            return self.reply(id, true, None);
        }
        if !matches!(request.command, Action::Shutdown)
            && request.generation != Some(self.generation)
        {
            return self.reply(id, false, Some("stale_generation"));
        }
        if matches!(request.command, Action::Status) {
            if self.refresh_sequence().is_err() {
                return self.reply(id, false, Some("status_failed"));
            }
            let mut reply = self.reply(id, true, None);
            reply.sequence_receipt = self.terminal_receipt.clone();
            return reply;
        }
        if self.mode == Some(Mode::Sequence)
            && matches!(request.command, Action::Pause | Action::Resume)
        {
            return self.reply(id, false, Some("unsupported_command"));
        }
        let result = match request.command {
            Action::Start if self.phase == Phase::Armed => {
                self.player.start().map(|_| Phase::StartRequested)
            }
            Action::Pause if self.phase == Phase::StartRequested => {
                self.player.pause().map(|_| Phase::PauseRequested)
            }
            Action::Resume if self.phase == Phase::PauseRequested => {
                self.player.pause().map(|_| Phase::StartRequested)
            }
            Action::Stop if self.phase == Phase::StopRequested => Ok(Phase::StopRequested),
            Action::Stop if self.phase != Phase::Idle => self.player.stop().map(|_| {
                if self.mode == Some(Mode::Sequence) && self.phase == Phase::StartRequested {
                    Phase::StopRequested
                } else {
                    Phase::Idle
                }
            }),
            Action::Shutdown => {
                self.player.shutdown();
                self.phase = Phase::Shutdown;
                return self.reply(id, true, None);
            }
            _ => return self.reply(id, false, Some("invalid_state")),
        };
        match result {
            Ok(next) => {
                if next == Phase::Idle {
                    self.player.shutdown();
                    self.mode = None;
                }
                self.phase = next;
                self.reply(id, true, None)
            }
            Err(_) => {
                self.player.shutdown();
                self.phase = Phase::Idle;
                self.mode = None;
                self.reply(id, false, Some("player_command_failed"))
            }
        }
    }

    fn child_lost(&mut self) -> Reply<'static> {
        self.player.shutdown();
        self.phase = Phase::Idle;
        self.mode = None;
        self.reply(None, false, Some("child_lost"))
    }
}
impl<P: Player> Drop for Controller<P> {
    fn drop(&mut self) {
        self.player.shutdown();
    }
}

struct VlcPlayer {
    data_dir: PathBuf,
    child: Option<Child>,
    rc_port: Option<u16>,
    prepared: Option<PathBuf>,
    sequence_arm: Option<SequenceArm>,
    sequence_worker: Option<SequenceWorker>,
    sequence_completed: Option<Value>,
}

struct SequenceWorker {
    cancel: Arc<AtomicBool>,
    handle: thread::JoinHandle<Value>,
}

fn persist_sequence_receipt(root: &Path, receipt: &Value) -> Result<SequenceReceipt> {
    let receipts = root.join("control-receipts");
    fs::create_dir_all(&receipts)?;
    let receipts = receipts.canonicalize()?;
    if !receipts.starts_with(root.canonicalize()?) {
        return Err("Sequence receipt directory escapes player data".into());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let path = receipts.join(format!("sequence-{}-{stamp}.json", std::process::id()));
    if path.to_string_lossy().len() > 4096 {
        return Err("Sequence receipt path exceeds control frame bound".into());
    }
    let status = receipt["status"]
        .as_str()
        .filter(|value| matches!(*value, "ended" | "failed" | "stopped"))
        .ok_or("Selected sequence has no terminal status")?;
    let bytes = serde_json::to_vec(receipt)?;
    let staging = path.with_extension("json.tmp");
    let saved = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&staging, &path)?;
        Ok(())
    })();
    if saved.is_err() {
        let _ = fs::remove_file(staging);
    }
    saved?;
    let path = path.canonicalize()?;
    Ok(SequenceReceipt {
        status: status.into(),
        path,
        sha256: format!("{:x}", Sha256::digest(&bytes)),
    })
}
impl VlcPlayer {
    fn new(data_dir: Option<PathBuf>) -> Result<Self> {
        let data_dir = match data_dir {
            Some(path) => path,
            None => {
                PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
                    .join("VLC_Flubber_Player")
            }
        };
        Ok(Self {
            data_dir,
            child: None,
            rc_port: None,
            prepared: None,
            sequence_arm: None,
            sequence_worker: None,
            sequence_completed: None,
        })
    }

    fn rc(&self, command: &str) -> Result<()> {
        let port = self.rc_port.ok_or("VLC control is unavailable")?;
        let address: SocketAddr = format!("127.0.0.1:{port}").parse()?;
        let mut socket = TcpStream::connect_timeout(&address, Duration::from_millis(500))?;
        socket.set_write_timeout(Some(Duration::from_millis(500)))?;
        socket.write_all(command.as_bytes())?;
        socket.write_all(b"\n")?;
        Ok(())
    }
}
impl Player for VlcPlayer {
    fn arm(&mut self, video: &Path, panel: Option<u32>, step: Option<u32>) -> Result<()> {
        let install = env::current_exe()?
            .parent()
            .ok_or("Cannot locate player installation")?
            .to_path_buf();
        let vlc_dir = install.join("vlc");
        let vlc = required_file(vlc_dir.join("vlc.exe"))?;
        let svg = required_file(install.join("svg").join("flubber_svg.dll"))?;
        let lsl = required_file(install.join("lsl.dll"))?;
        required_file(install.join("plugins/video_filter/libflubber_plugin.dll"))?;
        let ffmpeg = required_file(install.join("ffmpeg/ffmpeg.exe"))?;
        let ffprobe = required_file(install.join("ffmpeg/ffprobe.exe"))?;
        let video = video.canonicalize()?;
        let (sidecar_panel, sidecar_step) = sidecar_settings(&video)?;
        let panel = panel.or(sidecar_panel).unwrap_or(25);
        let step = step.or(sidecar_step).unwrap_or(10);
        if !(1..=100).contains(&step) {
            return Err("stepPercent must be 1–100".into());
        }
        fs::create_dir_all(&self.data_dir)?;
        let (prepared, geometry) = prepare_video(
            &ffmpeg,
            &ffprobe,
            &video,
            &self.data_dir.join("media"),
            panel,
        )?;
        let recordings = self.data_dir.join("recordings");
        fs::create_dir_all(&recordings)?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
        let csv = recordings.join(format!("flubber-{stamp}-{}.csv", std::process::id()));
        let filename = video
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or("Video filename is unavailable")?;
        let reservation = TcpListener::bind("127.0.0.1:0")?;
        let port = reservation.local_addr()?.port();
        drop(reservation);
        let mut command = Command::new(vlc);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .args([
                "--no-one-instance",
                "--no-plugins-cache",
                "--avcodec-hw=none",
                "--no-video-title-show",
                "--no-osd",
                "--extraintf=flubberoutlet:rc",
                "-I",
                "dummy",
                "--video-filter=flubber",
                "--flubber-lsl",
                "--flubber-sentinel",
                "--vout=wingdi",
                "--key-nav-up=",
                "--key-nav-down=",
                "--key-nav-left=",
                "--key-nav-right=",
                "--key-jump+short=",
                "--key-jump-short=",
            ])
            .arg(format!("--rc-host=127.0.0.1:{port}"))
            .arg(format!("--flubber-panel-percent={panel}"))
            .arg(format!("--flubber-video-height={}", geometry.video_height))
            .arg(format!("--flubber-render-fps-num={}", geometry.rate.num))
            .arg(format!("--flubber-render-fps-den={}", geometry.rate.den))
            .arg(format!("--flubber-step-percent={step}"))
            .arg(format!("--flubber-marker-base={filename}"))
            .arg(format!("--flubber-csv={}", csv.display()))
            .env("VLC_PLUGIN_PATH", install.join("plugins"))
            .env("FLUBBER_SVG_DLL", svg)
            .env("FLUBBER_LSL_DLL", lsl);
        let mut path = OsString::from(vlc_dir.as_os_str());
        path.push(";");
        path.push(env::var_os("PATH").unwrap_or_default());
        command.env("PATH", path);
        let child = command.spawn()?;
        let pid = child.id();
        self.child = Some(child);
        let ready = wait_for_outlets(pid).and_then(|()| wait_for_rc(port));
        if let Err(error) = ready {
            self.shutdown();
            return Err(error);
        }
        self.rc_port = Some(port);
        self.prepared = Some(prepared);
        Ok(())
    }

    fn arm_sequence(&mut self, request: &SequenceArm) -> Result<()> {
        if request.participant_id.trim().is_empty() {
            return Err("Participant ID is required".into());
        }
        let master_path = request.master_path.canonicalize()?;
        selected_master::preflight_sequence(
            &master_path,
            &request.participant_id,
            request.selector.clone(),
        )?;
        fs::create_dir_all(&self.data_dir)?;
        self.data_dir = self.data_dir.canonicalize()?;
        self.sequence_arm = Some(SequenceArm {
            master_path,
            ..request.clone()
        });
        Ok(())
    }

    fn start(&mut self) -> Result<()> {
        if let Some(request) = self.sequence_arm.take() {
            let data_dir = self.data_dir.clone();
            let selector_json = serde_json::to_string(&request.selector)?;
            let cancel = Arc::new(AtomicBool::new(false));
            let worker_cancel = Arc::clone(&cancel);
            let handle = thread::spawn(move || {
                match selected_master::run_sequence_cancellable(
                    &request.master_path,
                    &request.participant_id,
                    &selector_json,
                    Some(data_dir),
                    Some(&worker_cancel),
                ) {
                    Ok(receipt) => receipt,
                    Err(error) => {
                        let status = if worker_cancel.load(Ordering::Acquire) {
                            "stopped"
                        } else {
                            "failed"
                        };
                        json!({"schema":"flubber-vlc-selected-sequence-status","version":1,"status":status,"error":error.to_string(),"sharedRunnerRecordingQualified":false})
                    }
                }
            });
            self.sequence_worker = Some(SequenceWorker { cancel, handle });
            return Ok(());
        }
        let prepared = self
            .prepared
            .as_ref()
            .ok_or("Prepared video is unavailable")?;
        let uri = url::Url::from_file_path(prepared)
            .map_err(|()| "Prepared video cannot be expressed as a file URI")?;
        self.rc(&format!("add {uri}"))
    }

    fn pause(&mut self) -> Result<()> {
        self.rc("pause")
    }

    fn stop(&mut self) -> Result<()> {
        if let Some(worker) = &self.sequence_worker {
            worker.cancel.store(true, Ordering::Release);
            return Ok(());
        }
        if self.sequence_arm.take().is_some() {
            return Ok(());
        }
        self.rc("stop")
    }

    fn alive(&mut self) -> Result<bool> {
        match self.child.as_mut() {
            Some(child) => Ok(child.try_wait()?.is_none()),
            None => Ok(false),
        }
    }

    fn poll_sequence(&mut self) -> Result<Option<SequenceReceipt>> {
        if self.sequence_completed.is_none() {
            if !self
                .sequence_worker
                .as_ref()
                .is_some_and(|worker| worker.handle.is_finished())
            {
                return Ok(None);
            }
            let worker = self
                .sequence_worker
                .take()
                .ok_or("Sequence worker disappeared")?;
            self.sequence_completed = Some(worker.handle.join().unwrap_or_else(|_| {
                json!({"schema":"flubber-vlc-selected-sequence-status","version":1,"status":"failed","error":"Sequence worker panicked","sharedRunnerRecordingQualified":false})
            }));
        }
        let receipt = persist_sequence_receipt(
            &self.data_dir,
            self.sequence_completed
                .as_ref()
                .ok_or("Sequence receipt disappeared")?,
        )?;
        self.sequence_completed = None;
        Ok(Some(receipt))
    }

    fn shutdown(&mut self) {
        if let Some(worker) = self.sequence_worker.take() {
            worker.cancel.store(true, Ordering::Release);
            if let Ok(receipt) = worker.handle.join() {
                let _ = persist_sequence_receipt(&self.data_dir, &receipt);
            }
        }
        self.sequence_arm = None;
        if let Some(receipt) = self.sequence_completed.take() {
            let _ = persist_sequence_receipt(&self.data_dir, &receipt);
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.rc_port = None;
        self.prepared = None;
    }
}

enum Frame {
    Line(Vec<u8>),
    TooLong,
    Eof,
}
fn read_frame(reader: &mut impl BufRead) -> io::Result<Frame> {
    let mut frame = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        if reader.read(&mut byte)? == 0 {
            return Ok(Frame::Eof);
        }
        if byte[0] == b'\n' {
            return Ok(Frame::Line(frame));
        }
        if frame.len() == MAX_FRAME {
            return Ok(Frame::TooLong);
        }
        frame.push(byte[0]);
    }
}

fn emit(writer: &mut impl Write, reply: &Reply<'_>) -> Result<()> {
    serde_json::to_writer(&mut *writer, reply)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}

pub(super) fn run(data_dir: Option<PathBuf>) -> Result<()> {
    let mut session = Controller::new(VlcPlayer::new(data_dir)?);
    let (sender, receiver) = mpsc::sync_channel(16);
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = BufReader::new(stdin.lock());
        loop {
            let frame = read_frame(&mut input);
            let done = matches!(&frame, Ok(Frame::Eof) | Err(_));
            if sender.send(frame).is_err() || done {
                break;
            }
        }
    });
    let stdout = io::stdout();
    let mut output = BufWriter::new(stdout.lock());
    emit(&mut output, &session.reply(None, true, None))?;
    loop {
        if session.mode == Some(Mode::Legacy)
            && session.phase != Phase::Idle
            && !session.player.alive()?
        {
            emit(&mut output, &session.child_lost())?;
            return Ok(());
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(Frame::Line(line))) => match serde_json::from_slice::<Request>(&line) {
                Ok(request) => {
                    let reply = session.handle(&request);
                    let closed = session.phase == Phase::Shutdown;
                    emit(&mut output, &reply)?;
                    if closed {
                        return Ok(());
                    }
                }
                Err(_) => emit(
                    &mut output,
                    &session.reply(None, false, Some("invalid_json")),
                )?,
            },
            Ok(Ok(Frame::TooLong)) => {
                emit(
                    &mut output,
                    &session.reply(None, false, Some("frame_too_long")),
                )?;
                return Ok(());
            }
            Ok(Ok(Frame::Eof)) => return Ok(()),
            Ok(Err(error)) => return Err(error.into()),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakePlayer {
        calls: Vec<&'static str>,
        fail: bool,
        terminal: Option<SequenceReceipt>,
    }
    impl Player for FakePlayer {
        fn arm(&mut self, _: &Path, _: Option<u32>, _: Option<u32>) -> Result<()> {
            self.calls.push("arm");
            if self.fail {
                Err("failed".into())
            } else {
                Ok(())
            }
        }
        fn arm_sequence(&mut self, _: &SequenceArm) -> Result<()> {
            self.calls.push("arm_sequence");
            if self.fail {
                Err("failed".into())
            } else {
                Ok(())
            }
        }
        fn start(&mut self) -> Result<()> {
            self.calls.push("start");
            Ok(())
        }
        fn pause(&mut self) -> Result<()> {
            self.calls.push("pause");
            Ok(())
        }
        fn stop(&mut self) -> Result<()> {
            self.calls.push("stop");
            Ok(())
        }
        fn alive(&mut self) -> Result<bool> {
            Ok(true)
        }
        fn poll_sequence(&mut self) -> Result<Option<SequenceReceipt>> {
            Ok(self.terminal.take())
        }
        fn shutdown(&mut self) {
            self.calls.push("shutdown");
        }
    }
    fn request(command: Action, generation: Option<u64>) -> Request {
        Request {
            protocol: PROTOCOL.into(),
            request_id: "r1".into(),
            command,
            generation,
            video_path: None,
            master_sequence: None,
            panel_percent: None,
            step_percent: None,
        }
    }

    #[test]
    fn master_sequence_arm_status_and_cooperative_stop_are_generation_fenced() {
        let mut controller = Controller::new(FakePlayer::default());
        let mut arm = request(Action::Arm, None);
        arm.master_sequence = Some(SequenceArm {
            master_path: PathBuf::from("master.json"),
            participant_id: "P001".into(),
            selector: MasterSelector {
                variant_id: "v1".into(),
                language_id: "en".into(),
                language_selection_path: vec![],
                presentation_target: "desktop".into(),
            },
        });
        arm.video_path = Some(PathBuf::from("video.mp4"));
        assert_eq!(controller.handle(&arm).error, Some("unexpected_fields"));
        arm.video_path = None;
        assert_eq!(controller.handle(&arm).state, "armed");
        assert_eq!(
            controller.handle(&request(Action::Status, Some(0))).error,
            Some("stale_generation")
        );
        assert_eq!(
            controller.handle(&request(Action::Start, Some(1))).state,
            "start-requested"
        );
        assert_eq!(
            controller.handle(&request(Action::Pause, Some(1))).error,
            Some("unsupported_command")
        );
        assert_eq!(
            controller.handle(&request(Action::Stop, Some(1))).state,
            "stop-requested"
        );
        assert_eq!(
            controller.handle(&request(Action::Status, Some(1))).state,
            "stop-requested"
        );
        controller.player.terminal = Some(SequenceReceipt {
            status: "stopped".into(),
            path: PathBuf::from("C:/owned/receipt.json"),
            sha256: "a".repeat(64),
        });
        let terminal_request = request(Action::Status, Some(1));
        let status = controller.handle(&terminal_request);
        assert_eq!(status.state, "idle");
        assert_eq!(status.sequence_receipt.unwrap().status, "stopped");
        assert_eq!(controller.player.calls, ["arm_sequence", "start", "stop"]);
    }

    #[test]
    fn sequence_request_is_typed_and_prestart_stop_has_no_terminal_receipt() {
        let wire = serde_json::json!({
            "protocol": PROTOCOL,
            "requestId": "arm-1",
            "command": "arm",
            "masterSequence": {
                "masterPath": "C:/study/master.json",
                "participantId": "P001",
                "selector": {
                    "variantId": "v1",
                    "languageId": "en",
                    "languageSelectionPath": [],
                    "presentationTarget": "desktop"
                }
            }
        });
        let arm: Request = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(arm.master_sequence.as_ref().unwrap().participant_id, "P001");
        let mut extra = wire;
        extra["masterSequence"]["unexpected"] = json!(true);
        assert!(serde_json::from_value::<Request>(extra).is_err());
        let mut controller = Controller::new(FakePlayer::default());
        assert!(controller.handle(&arm).ok);
        let stop_request = request(Action::Stop, Some(1));
        let stop = controller.handle(&stop_request);
        assert_eq!(stop.state, "idle");
        assert!(stop.sequence_receipt.is_none());
        assert_eq!(
            controller.player.calls,
            ["arm_sequence", "stop", "shutdown"]
        );
    }

    #[test]
    fn full_receipt_is_saved_outside_the_control_frame_with_exact_hash() {
        let root = env::temp_dir().join(format!(
            "flubber-control-receipt-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let receipt = json!({
            "schema":"flubber-vlc-selected-sequence-status",
            "version":1,
            "status":"stopped",
            "events": vec!["event"; MAX_FRAME],
            "sharedRunnerRecordingQualified":false
        });
        let reference = persist_sequence_receipt(&root, &receipt).unwrap();
        let bytes = fs::read(&reference.path).unwrap();
        assert!(bytes.len() > MAX_FRAME);
        assert_eq!(reference.status, "stopped");
        assert_eq!(reference.sha256, format!("{:x}", Sha256::digest(&bytes)));
        assert!(reference.path.starts_with(root.canonicalize().unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stdio_state_machine_correlates_and_rejects_stale_or_master_commands() {
        let mut controller = Controller::new(FakePlayer::default());
        let mut arm = request(Action::Arm, None);
        arm.video_path = Some(PathBuf::from("master.json"));
        assert_eq!(
            controller.handle(&arm).error,
            Some("master_execution_unsupported")
        );
        arm.video_path = Some(PathBuf::from("video.mp4"));
        let reply = controller.handle(&arm);
        assert!(reply.ok);
        assert_eq!(
            (reply.request_id, reply.generation, reply.state),
            (Some("r1"), 1, "armed")
        );
        assert_eq!(
            controller.handle(&request(Action::Start, Some(0))).error,
            Some("stale_generation")
        );
        assert_eq!(
            controller.handle(&request(Action::Start, Some(1))).state,
            "start-requested"
        );
        assert_eq!(
            controller.handle(&request(Action::Pause, Some(1))).state,
            "pause-requested"
        );
        assert_eq!(
            controller.handle(&request(Action::Resume, Some(1))).state,
            "start-requested"
        );
        assert_eq!(
            controller.handle(&request(Action::Stop, Some(1))).state,
            "idle"
        );
        assert!(controller.handle(&arm).ok);
        assert_eq!(
            controller.handle(&request(Action::Start, Some(1))).error,
            Some("stale_generation")
        );
        assert_eq!(
            controller.handle(&request(Action::Shutdown, None)).state,
            "shutdown"
        );
        assert_eq!(
            controller.player.calls,
            ["arm", "start", "pause", "pause", "stop", "shutdown", "arm", "shutdown"]
        );
    }

    #[test]
    fn invalid_frames_and_failed_arm_are_bounded() {
        let mut input = BufReader::new(&b"{}\n"[..]);
        assert!(matches!(read_frame(&mut input).unwrap(), Frame::Line(ref line) if line == b"{}"));
        assert!(matches!(read_frame(&mut input).unwrap(), Frame::Eof));
        let oversized = vec![b'a'; MAX_FRAME + 1];
        let oversized_line = [oversized, b"\n".to_vec()].concat();
        let mut input = BufReader::new(oversized_line.as_slice());
        assert!(matches!(read_frame(&mut input).unwrap(), Frame::TooLong));
        let mut controller = Controller::new(FakePlayer {
            fail: true,
            ..FakePlayer::default()
        });
        let mut arm = request(Action::Arm, None);
        arm.video_path = Some(PathBuf::from("video.mp4"));
        assert_eq!(controller.handle(&arm).error, Some("arm_failed"));
        assert_eq!(controller.phase, Phase::Idle);
        assert_eq!(controller.player.calls, ["arm", "shutdown"]);
    }

    #[test]
    fn child_loss_fences_the_session_and_tears_down_the_player() {
        let mut controller = Controller::new(FakePlayer::default());
        let mut arm = request(Action::Arm, None);
        arm.video_path = Some(PathBuf::from("video.mp4"));
        assert!(controller.handle(&arm).ok);
        let reply = controller.child_lost();
        assert_eq!(
            (reply.ok, reply.request_id, reply.error),
            (false, None, Some("child_lost"))
        );
        assert_eq!(controller.phase, Phase::Idle);
        assert_eq!(controller.player.calls, ["arm", "shutdown"]);
    }
}

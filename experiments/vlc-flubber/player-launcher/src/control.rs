//! Same-PC transport control for the legacy single-video player. These accepted
//! commands are not qualified Runner playback or recording evidence.
use super::{
    prepare_video, required_file, sidecar_settings, wait_for_outlets, wait_for_rc, Result,
};
use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
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
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Action {
    Arm,
    Start,
    Pause,
    Resume,
    Stop,
    Shutdown,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Armed,
    StartRequested,
    PauseRequested,
    Shutdown,
}
impl Phase {
    fn label(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Armed => "armed",
            Self::StartRequested => "start-requested",
            Self::PauseRequested => "pause-requested",
            Self::Shutdown => "shutdown",
        }
    }
}

trait Player {
    fn arm(&mut self, video: &Path, panel: Option<u32>, step: Option<u32>) -> Result<()>;
    fn start(&mut self) -> Result<()>;
    fn pause(&mut self) -> Result<()>;
    fn stop(&mut self) -> Result<()>;
    fn alive(&mut self) -> Result<bool>;
    fn shutdown(&mut self);
}

struct Controller<P: Player> {
    player: P,
    phase: Phase,
    generation: u64,
}
impl<P: Player> Controller<P> {
    fn new(player: P) -> Self {
        Self {
            player,
            phase: Phase::Idle,
            generation: 0,
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
        }
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
                || request.panel_percent.is_some()
                || request.step_percent.is_some())
        {
            return self.reply(id, false, Some("unexpected_fields"));
        }
        if matches!(request.command, Action::Arm) {
            if request.generation.is_some() || self.phase != Phase::Idle {
                return self.reply(id, false, Some("invalid_state"));
            }
            let Some(video) = request.video_path.as_deref() else {
                return self.reply(id, false, Some("video_required"));
            };
            if video
                .extension()
                .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("json"))
            {
                return self.reply(id, false, Some("master_execution_unsupported"));
            }
            if self.generation == u64::MAX {
                return self.reply(id, false, Some("generation_exhausted"));
            }
            if self
                .player
                .arm(video, request.panel_percent, request.step_percent)
                .is_err()
            {
                self.player.shutdown();
                return self.reply(id, false, Some("arm_failed"));
            }
            self.generation += 1;
            self.phase = Phase::Armed;
            return self.reply(id, true, None);
        }
        if !matches!(request.command, Action::Shutdown)
            && request.generation != Some(self.generation)
        {
            return self.reply(id, false, Some("stale_generation"));
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
            Action::Stop if self.phase != Phase::Idle => self.player.stop().map(|_| Phase::Idle),
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
                }
                self.phase = next;
                self.reply(id, true, None)
            }
            Err(_) => {
                self.player.shutdown();
                self.phase = Phase::Idle;
                self.reply(id, false, Some("player_command_failed"))
            }
        }
    }

    fn child_lost(&mut self) -> Reply<'static> {
        self.player.shutdown();
        self.phase = Phase::Idle;
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

    fn start(&mut self) -> Result<()> {
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
        self.rc("stop")
    }

    fn alive(&mut self) -> Result<bool> {
        match self.child.as_mut() {
            Some(child) => Ok(child.try_wait()?.is_none()),
            None => Ok(false),
        }
    }

    fn shutdown(&mut self) {
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
        if session.phase != Phase::Idle && !session.player.alive()? {
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
            panel_percent: None,
            step_percent: None,
        }
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

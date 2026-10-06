//! Same-PC supervised client for FlubberVLC's JSON-lines transport.
//! Research execution is not exposed by the Recorder shell.
use serde::{Deserialize, Serialize};
use std::io::{self, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const PROTOCOL: &str = "flubber-vlc-control/v1";
const MAX_FRAME: usize = 16 * 1024;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);
const ARM_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Action {
    Arm,
    Start,
    Pause,
    Resume,
    Stop,
    Shutdown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Phase {
    Idle,
    Armed,
    StartRequested,
    PauseRequested,
    Shutdown,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Request<'a> {
    protocol: &'static str,
    request_id: String,
    command: Action,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    video_path: Option<&'a Path>,
    #[serde(skip_serializing_if = "Option::is_none")]
    panel_percent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_percent: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reply {
    protocol: String,
    request_id: Option<String>,
    ok: bool,
    state: Phase,
    generation: u64,
    error: Option<String>,
}

enum Frame {
    Line(Vec<u8>),
    Eof,
    Invalid,
}

fn read_frame(reader: &mut impl Read) -> io::Result<Frame> {
    let mut line = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        if reader.read(&mut byte)? == 0 {
            return Ok(Frame::Eof);
        }
        if byte[0] == b'\n' {
            return Ok(Frame::Line(line));
        }
        if line.len() == MAX_FRAME {
            return Ok(Frame::Invalid);
        }
        line.push(byte[0]);
    }
}

fn validate_reply(
    bytes: &[u8],
    request_id: Option<&str>,
    expected_state: Phase,
    expected_generation: u64,
) -> Result<(), String> {
    let reply: Reply = serde_json::from_slice(bytes).map_err(|_| "Invalid player reply")?;
    if reply.protocol != PROTOCOL || reply.request_id.as_deref() != request_id {
        return Err("Uncorrelated player reply".into());
    }
    if !reply.ok {
        return Err(format!(
            "Player rejected command: {}",
            reply.error.as_deref().unwrap_or("unknown")
        ));
    }
    if reply.error.is_some()
        || reply.state != expected_state
        || reply.generation != expected_generation
    {
        return Err("Unexpected player state or generation".into());
    }
    Ok(())
}

pub(crate) struct ControlClient {
    child: Child,
    input: Option<ChildStdin>,
    frames: Option<Receiver<io::Result<Frame>>>,
    reader: Option<JoinHandle<()>>,
    request_number: u64,
    generation: u64,
    phase: Phase,
}

impl ControlClient {
    pub(crate) fn spawn(player: &Path) -> Result<Self, String> {
        let mut command = Command::new(player);
        command.arg("--control-stdio");
        Self::spawn_command(command)
    }

    fn spawn_command(mut command: Command) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Verified player could not start")?;
        let input = child.stdin.take().ok_or("Player stdin is unavailable")?;
        let output = child.stdout.take().ok_or("Player stdout is unavailable")?;
        let (sender, receiver) = mpsc::sync_channel(2);
        let reader = thread::spawn(move || {
            let mut output = BufReader::new(output);
            loop {
                let frame = read_frame(&mut output);
                let done = matches!(&frame, Ok(Frame::Eof | Frame::Invalid) | Err(_));
                if sender.send(frame).is_err() || done {
                    break;
                }
            }
        });
        let mut session = Self {
            child,
            input: Some(input),
            frames: Some(receiver),
            reader: Some(reader),
            request_number: 0,
            generation: 0,
            phase: Phase::Idle,
        };
        let result = session
            .receive(RESPONSE_TIMEOUT)
            .and_then(|line| validate_reply(&line, None, Phase::Idle, 0));
        if result.is_err() {
            session.terminate();
        }
        result.map(|_| session)
    }

    fn receive(&mut self, timeout: Duration) -> Result<Vec<u8>, String> {
        let frames = self.frames.as_ref().ok_or("Player connection is closed")?;
        match frames.recv_timeout(timeout) {
            Ok(Ok(Frame::Line(line))) => Ok(line),
            Ok(Ok(Frame::Invalid)) => Err("Player reply exceeds the frame limit".into()),
            Ok(Ok(Frame::Eof)) | Ok(Err(_)) | Err(RecvTimeoutError::Disconnected) => {
                Err("Player connection ended".into())
            }
            Err(RecvTimeoutError::Timeout) => Err("Player reply timed out".into()),
        }
    }

    fn expected(&self, action: Action) -> Result<(Phase, u64), String> {
        let next = match (self.phase, action) {
            (Phase::Idle, Action::Arm) => (
                Phase::Armed,
                self.generation
                    .checked_add(1)
                    .ok_or("Player generation exhausted")?,
            ),
            (Phase::Armed, Action::Start) | (Phase::PauseRequested, Action::Resume) => {
                (Phase::StartRequested, self.generation)
            }
            (Phase::StartRequested, Action::Pause) => (Phase::PauseRequested, self.generation),
            (Phase::Armed | Phase::StartRequested | Phase::PauseRequested, Action::Stop) => {
                (Phase::Idle, self.generation)
            }
            (_, Action::Shutdown) => (Phase::Shutdown, self.generation),
            _ => return Err("Player command is not valid in this state".into()),
        };
        Ok(next)
    }

    #[allow(dead_code)] // Protocol verbs are reserved for the future research execution pass.
    pub(crate) fn send(&mut self, action: Action, video_path: Option<&Path>) -> Result<(), String> {
        let (expected_phase, expected_generation) = self.expected(action)?;
        if (action == Action::Arm) != video_path.is_some() {
            return Err("Arm requires one video; other commands cannot carry a video".into());
        }
        if video_path.is_some_and(|path| {
            path.extension()
                .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("json"))
        }) {
            return Err("Planner masters cannot be armed as a single video".into());
        }
        self.request_number = self
            .request_number
            .checked_add(1)
            .ok_or("Player request limit reached")?;
        let id = format!("recorder-{}", self.request_number);
        let request = Request {
            protocol: PROTOCOL,
            request_id: id.clone(),
            command: action,
            generation: if matches!(action, Action::Arm | Action::Shutdown) {
                None
            } else {
                Some(self.generation)
            },
            video_path,
            panel_percent: None,
            step_percent: None,
        };
        let result = (|| {
            let input = self.input.as_mut().ok_or("Player connection is closed")?;
            serde_json::to_writer(&mut *input, &request)
                .map_err(|_| "Could not encode player command")?;
            input
                .write_all(b"\n")
                .map_err(|_| "Could not send player command")?;
            input
                .flush()
                .map_err(|_| "Could not flush player command")?;
            let timeout = if action == Action::Arm {
                ARM_TIMEOUT
            } else {
                RESPONSE_TIMEOUT
            };
            let line = self.receive(timeout)?;
            validate_reply(&line, Some(&id), expected_phase, expected_generation)
        })();
        if result.is_err() {
            self.terminate();
            return result;
        }
        self.phase = expected_phase;
        self.generation = expected_generation;
        if action == Action::Shutdown || action == Action::Stop {
            self.terminate();
        }
        Ok(())
    }

    pub(crate) fn alive(&mut self) -> bool {
        if self.reader.as_ref().is_some_and(JoinHandle::is_finished) {
            self.terminate();
            return false;
        }
        match self.child.try_wait() {
            Ok(None) => self.input.is_some(),
            Ok(Some(_)) | Err(_) => {
                self.terminate();
                false
            }
        }
    }

    fn terminate(&mut self) {
        self.input.take();
        self.frames.take();
        for _ in 0..40 {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }

    pub(crate) fn shutdown(&mut self) {
        if self.input.is_some() {
            let _ = self.send(Action::Shutdown, None);
        }
        self.terminate();
    }
}

impl Drop for ControlClient {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_validation_correlates_requests_and_fences_generation() {
        let reply = br#"{"protocol":"flubber-vlc-control/v1","requestId":"recorder-1","ok":true,"state":"armed","generation":1,"error":null}"#;
        assert!(validate_reply(reply, Some("recorder-1"), Phase::Armed, 1).is_ok());
        assert!(validate_reply(reply, Some("recorder-2"), Phase::Armed, 1).is_err());
        assert!(validate_reply(reply, Some("recorder-1"), Phase::Armed, 2).is_err());
        assert!(validate_reply(reply, Some("recorder-1"), Phase::StartRequested, 1).is_err());
    }

    #[test]
    fn frames_are_bounded_and_partial_replies_are_not_accepted() {
        assert!(
            matches!(read_frame(&mut &b"{}\n"[..]).unwrap(), Frame::Line(line) if line == b"{}")
        );
        assert!(matches!(read_frame(&mut &b"{}"[..]).unwrap(), Frame::Eof));
        let oversized = [vec![b'x'; MAX_FRAME + 1], vec![b'\n']].concat();
        assert!(matches!(
            read_frame(&mut oversized.as_slice()).unwrap(),
            Frame::Invalid
        ));
    }

    #[test]
    fn rejects_master_arm_and_invalid_transition_before_writing() {
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-Command", "[Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":null,\"ok\":true,\"state\":\"idle\",\"generation\":0,\"error\":null}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"recorder-1\",\"ok\":true,\"state\":\"shutdown\",\"generation\":0,\"error\":null}'); Start-Sleep -Seconds 30"]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        assert!(client.send(Action::Start, None).is_err());
        assert!(client
            .send(Action::Arm, Some(Path::new("master.json")))
            .is_err());
        client.shutdown();
        assert!(client.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn uncorrelated_reply_terminates_the_supervised_process() {
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-Command", "[Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":null,\"ok\":true,\"state\":\"idle\",\"generation\":0,\"error\":null}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"wrong\",\"ok\":true,\"state\":\"shutdown\",\"generation\":0,\"error\":null}'); Start-Sleep -Seconds 30"]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        assert!(client
            .send(Action::Shutdown, None)
            .unwrap_err()
            .contains("Uncorrelated"));
        assert!(client.child.try_wait().unwrap().is_some());
    }
}

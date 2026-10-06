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
    Status,
    Shutdown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Phase {
    Idle,
    Armed,
    StartRequested,
    PauseRequested,
    StopRequested,
    Shutdown,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MasterSequence<'a> {
    master_path: &'a Path,
    participant_id: &'a str,
    selector: &'a serde_json::Value,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    master_sequence: Option<MasterSequence<'a>>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SequenceOutcome {
    Ended,
    Failed,
    Stopped,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SequenceReceipt {
    pub(crate) status: SequenceOutcome,
    pub(crate) path: std::path::PathBuf,
    pub(crate) sha256: String,
}

#[derive(Debug)]
pub(crate) struct ControlStatus {
    pub(crate) state: Phase,
    pub(crate) receipt: Option<SequenceReceipt>,
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
    sequence_receipt: Option<SequenceReceipt>,
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

fn parse_reply(
    bytes: &[u8],
    request_id: Option<&str>,
    expected_generation: u64,
) -> Result<Reply, String> {
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
    if reply.error.is_some() || reply.generation != expected_generation {
        return Err("Unexpected player state or generation".into());
    }
    if let Some(receipt) = &reply.sequence_receipt {
        if reply.state != Phase::Idle
            || !receipt.path.is_absolute()
            || receipt.path.to_string_lossy().len() > 4096
            || receipt.sha256.len() != 64
            || !receipt
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("Invalid terminal sequence receipt reference".into());
        }
    }
    Ok(reply)
}

fn validate_reply(
    bytes: &[u8],
    request_id: Option<&str>,
    expected_state: Phase,
    expected_generation: u64,
) -> Result<(), String> {
    let reply = parse_reply(bytes, request_id, expected_generation)?;
    if reply.state != expected_state || reply.sequence_receipt.is_some() {
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
    sequence_armed: bool,
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
            sequence_armed: false,
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
            (Phase::Armed, Action::Stop) if self.sequence_armed => (Phase::Idle, self.generation),
            (Phase::StartRequested, Action::Stop) if self.sequence_armed => {
                (Phase::StopRequested, self.generation)
            }
            (Phase::Armed | Phase::StartRequested | Phase::PauseRequested, Action::Stop) => {
                (Phase::Idle, self.generation)
            }
            (_, Action::Shutdown) => (Phase::Shutdown, self.generation),
            _ => return Err("Player command is not valid in this state".into()),
        };
        Ok(next)
    }

    pub(crate) fn send(&mut self, action: Action, video_path: Option<&Path>) -> Result<(), String> {
        if self.sequence_armed && matches!(action, Action::Pause | Action::Resume) {
            return Err("Sequence pause and resume are unsupported".into());
        }
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
        self.exchange(
            action,
            video_path,
            None,
            expected_phase,
            expected_generation,
        )?;
        self.phase = expected_phase;
        self.generation = expected_generation;
        if action == Action::Shutdown || (action == Action::Stop && expected_phase == Phase::Idle) {
            self.sequence_armed = false;
        }
        if action == Action::Shutdown {
            self.terminate();
        }
        Ok(())
    }

    pub(crate) fn snapshot(&self) -> (Phase, u64) {
        (self.phase, self.generation)
    }

    #[allow(dead_code)] // Research Start remains closed in the Recorder UI.
    pub(crate) fn arm_master_sequence(
        &mut self,
        master_path: &Path,
        participant_id: &str,
        selector: &serde_json::Value,
    ) -> Result<(), String> {
        let (phase, generation) = self.expected(Action::Arm)?;
        if !master_path.is_file()
            || !master_path
                .extension()
                .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("json"))
            || participant_id.is_empty()
            || participant_id.len() > 16
            || !selector.is_object()
        {
            return Err("Invalid master sequence selection".into());
        }
        self.exchange(
            Action::Arm,
            None,
            Some(MasterSequence {
                master_path,
                participant_id,
                selector,
            }),
            phase,
            generation,
        )?;
        self.phase = phase;
        self.generation = generation;
        self.sequence_armed = true;
        Ok(())
    }

    #[allow(dead_code)] // The UI does not yet initiate a research sequence.
    pub(crate) fn status(&mut self) -> Result<ControlStatus, String> {
        if !self.sequence_armed {
            return Err("No master sequence is armed".into());
        }
        let reply = self.exchange(Action::Status, None, None, self.phase, self.generation)?;
        let valid = match (self.phase, reply.state) {
            (Phase::Armed, Phase::Armed)
            | (Phase::StartRequested, Phase::StartRequested)
            | (Phase::PauseRequested, Phase::PauseRequested)
            | (Phase::StopRequested, Phase::StopRequested) => reply.sequence_receipt.is_none(),
            (Phase::StartRequested | Phase::PauseRequested | Phase::StopRequested, Phase::Idle) => {
                reply.sequence_receipt.is_some()
            }
            _ => false,
        };
        if !valid {
            self.terminate();
            return Err("Unexpected sequence status or terminal receipt".into());
        }
        self.phase = reply.state;
        if self.phase == Phase::Idle {
            self.sequence_armed = false;
        }
        Ok(ControlStatus {
            state: self.phase,
            receipt: reply.sequence_receipt,
        })
    }

    fn exchange(
        &mut self,
        action: Action,
        video_path: Option<&Path>,
        master_sequence: Option<MasterSequence<'_>>,
        expected_phase: Phase,
        expected_generation: u64,
    ) -> Result<Reply, String> {
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
            master_sequence,
        };
        let result = (|| {
            let input = self.input.as_mut().ok_or("Player connection is closed")?;
            let frame =
                serde_json::to_vec(&request).map_err(|_| "Could not encode player command")?;
            if frame.len() > MAX_FRAME {
                return Err("Player command exceeds the frame limit".into());
            }
            input
                .write_all(&frame)
                .and_then(|()| input.write_all(b"\n"))
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
            let reply = parse_reply(&line, Some(&id), expected_generation)?;
            if action != Action::Status
                && (reply.state != expected_phase || reply.sequence_receipt.is_some())
            {
                return Err("Unexpected player state or generation".into());
            }
            Ok(reply)
        })();
        if result.is_err() {
            self.terminate();
            return result;
        }
        result
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
        if self.sequence_armed && self.input.is_none() && self.reader.is_none() {
            return;
        }
        self.input.take();
        self.frames.take();
        for _ in 0..40 {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
        if self.child.try_wait().ok().flatten().is_none() && self.sequence_armed {
            // The launcher owns VLC and reaps it after stdin EOF. Killing only
            // the launcher here would leave an active VLC child behind.
            self.reader.take();
            return;
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
    fn master_arm_is_exclusive_and_serializes_the_selector_object() {
        let selector = serde_json::json!({"language":"en","variantId":"variant-1"});
        let request = Request {
            protocol: PROTOCOL,
            request_id: "recorder-1".into(),
            command: Action::Arm,
            generation: None,
            video_path: None,
            panel_percent: None,
            step_percent: None,
            master_sequence: Some(MasterSequence {
                master_path: Path::new("C:\\study\\master.json"),
                participant_id: "P001",
                selector: &selector,
            }),
        };
        let wire = serde_json::to_value(request).unwrap();
        assert_eq!(
            wire["masterSequence"]["masterPath"],
            "C:\\study\\master.json"
        );
        assert_eq!(wire["masterSequence"]["participantId"], "P001");
        assert_eq!(wire["masterSequence"]["selector"], selector);
        assert!(wire.get("videoPath").is_none());
    }

    #[test]
    fn terminal_reference_is_bounded_and_status_is_generation_fenced() {
        let valid = serde_json::json!({
            "protocol": PROTOCOL,
            "requestId": "recorder-2",
            "ok": true,
            "state": "idle",
            "generation": 1,
            "error": null,
            "sequenceReceipt": {
                "status": "ended",
                "path": "C:\\study\\receipt.json",
                "sha256": "a".repeat(64)
            }
        });
        let bytes = serde_json::to_vec(&valid).unwrap();
        assert!(parse_reply(&bytes, Some("recorder-2"), 1).is_ok());
        assert!(parse_reply(&bytes, Some("recorder-2"), 2).is_err());
        assert!(parse_reply(&bytes, Some("recorder-3"), 1).is_err());
        for (field, value) in [
            ("status", serde_json::json!("unknown")),
            ("path", serde_json::json!("relative.json")),
            (
                "path",
                serde_json::json!(format!("C:\\{}", "x".repeat(4096))),
            ),
            ("sha256", serde_json::json!("bad")),
        ] {
            let mut malformed = valid.clone();
            malformed["sequenceReceipt"][field] = value;
            assert!(parse_reply(
                &serde_json::to_vec(&malformed).unwrap(),
                Some("recorder-2"),
                1
            )
            .is_err());
        }
        let mut premature = valid;
        premature["state"] = serde_json::json!("start-requested");
        assert!(parse_reply(
            &serde_json::to_vec(&premature).unwrap(),
            Some("recorder-2"),
            1
        )
        .is_err());
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
    fn legacy_stop_keeps_verified_connection_ready_for_rearm() {
        let script = r#"
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":null,"ok":true,"state":"idle","generation":0,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-1","ok":true,"state":"armed","generation":1,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-2","ok":true,"state":"start-requested","generation":1,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-3","ok":true,"state":"idle","generation":1,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-4","ok":true,"state":"armed","generation":2,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-5","ok":true,"state":"shutdown","generation":2,"error":null}')
"#;
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-Command", script]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        client
            .send(Action::Arm, Some(Path::new("video.mp4")))
            .unwrap();
        client.send(Action::Start, None).unwrap();
        client.send(Action::Stop, None).unwrap();
        assert_eq!(client.snapshot(), (Phase::Idle, 1));
        assert!(client.alive());
        client
            .send(Action::Arm, Some(Path::new("video.mp4")))
            .unwrap();
        assert_eq!(client.snapshot(), (Phase::Armed, 2));
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

    #[test]
    fn extra_status_frame_is_rejected_and_supervised_process_ends() {
        let master =
            std::env::temp_dir().join(format!("recorder-master-{}.json", std::process::id()));
        std::fs::write(&master, b"{}").unwrap();
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-Command", "[Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":null,\"ok\":true,\"state\":\"idle\",\"generation\":0,\"error\":null}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"recorder-1\",\"ok\":true,\"state\":\"armed\",\"generation\":1,\"error\":null}'); [Console]::WriteLine('{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"unsolicited\",\"ok\":true,\"state\":\"armed\",\"generation\":1,\"error\":null}'); [Console]::In.ReadLine() | Out-Null; while ($null -ne [Console]::In.ReadLine()) {}"]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        client
            .arm_master_sequence(&master, "P001", &serde_json::json!({"language":"en"}))
            .unwrap();
        assert!(client.status().unwrap_err().contains("Uncorrelated"));
        assert!(client.child.try_wait().unwrap().is_some());
        std::fs::remove_file(master).unwrap();
    }

    #[test]
    fn status_polling_reaches_a_correlated_terminal_receipt() {
        let master = std::env::temp_dir().join(format!(
            "recorder-status-master-{}.json",
            std::process::id()
        ));
        std::fs::write(&master, b"{}").unwrap();
        let receipt_path = std::env::temp_dir().join("recorder-sequence-receipt.json");
        let terminal = serde_json::json!({
            "protocol": PROTOCOL,
            "requestId": "recorder-4",
            "ok": true,
            "state": "idle",
            "generation": 1,
            "error": null,
            "sequenceReceipt": {"status":"ended","path":receipt_path,"sha256":"a".repeat(64)}
        });
        let script = format!(
            "[Console]::WriteLine('{{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":null,\"ok\":true,\"state\":\"idle\",\"generation\":0,\"error\":null}}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"recorder-1\",\"ok\":true,\"state\":\"armed\",\"generation\":1,\"error\":null}}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"recorder-2\",\"ok\":true,\"state\":\"start-requested\",\"generation\":1,\"error\":null}}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{{\"protocol\":\"flubber-vlc-control/v1\",\"requestId\":\"recorder-3\",\"ok\":true,\"state\":\"start-requested\",\"generation\":1,\"error\":null}}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{}')",
            terminal
        );
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-Command", &script]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        client
            .arm_master_sequence(&master, "P001", &serde_json::json!({"language":"en"}))
            .unwrap();
        client.send(Action::Start, None).unwrap();
        assert!(client.send(Action::Pause, None).is_err());
        assert!(client.send(Action::Resume, None).is_err());
        let active = client.status().unwrap();
        assert_eq!(active.state, Phase::StartRequested);
        assert!(active.receipt.is_none());
        let ended = client.status().unwrap();
        assert_eq!(ended.state, Phase::Idle);
        assert_eq!(ended.receipt.unwrap().status, SequenceOutcome::Ended);
        drop(client);
        std::fs::remove_file(master).unwrap();
    }

    #[test]
    fn stop_waits_for_terminal_status_before_rearming() {
        let master =
            std::env::temp_dir().join(format!("recorder-stop-master-{}.json", std::process::id()));
        std::fs::write(&master, b"{}").unwrap();
        let mut script = format!(
            "[Console]::WriteLine('{}');",
            serde_json::json!({"protocol":PROTOCOL,"requestId":null,"ok":true,"state":"idle","generation":0,"error":null})
        );
        for (id, state, receipt) in [
            (1, "armed", None),
            (2, "start-requested", None),
            (3, "stop-requested", None),
            (4, "stop-requested", None),
            (
                5,
                "idle",
                Some(
                    serde_json::json!({"status":"stopped","path":std::env::temp_dir().join("recorder-stopped.json"),"sha256":"b".repeat(64)}),
                ),
            ),
        ] {
            let reply = serde_json::json!({"protocol":PROTOCOL,"requestId":format!("recorder-{id}"),"ok":true,"state":state,"generation":1,"error":null,"sequenceReceipt":receipt});
            script.push_str(&format!(
                "[Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{}');",
                reply.to_string().replace('\'', "''")
            ));
        }
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-Command", &script]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        client
            .arm_master_sequence(&master, "P001", &serde_json::json!({"language":"en"}))
            .unwrap();
        client.send(Action::Start, None).unwrap();
        client.send(Action::Stop, None).unwrap();
        assert_eq!(client.phase, Phase::StopRequested);
        assert_eq!(client.status().unwrap().state, Phase::StopRequested);
        let terminal = client.status().unwrap();
        assert_eq!(terminal.state, Phase::Idle);
        assert_eq!(terminal.receipt.unwrap().status, SequenceOutcome::Stopped);
        drop(client);
        std::fs::remove_file(master).unwrap();
    }

    #[test]
    fn stop_before_start_returns_idle_without_a_sequence_receipt() {
        let master =
            std::env::temp_dir().join(format!("recorder-armed-master-{}.json", std::process::id()));
        std::fs::write(&master, b"{}").unwrap();
        let mut command = Command::new("powershell");
        let script = r#"
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":null,"ok":true,"state":"idle","generation":0,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-1","ok":true,"state":"armed","generation":1,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-2","ok":true,"state":"idle","generation":1,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-3","ok":true,"state":"armed","generation":2,"error":null}')
[Console]::In.ReadLine() | Out-Null
[Console]::WriteLine('{"protocol":"flubber-vlc-control/v1","requestId":"recorder-4","ok":true,"state":"shutdown","generation":2,"error":null}')
"#;
        command.args(["-NoProfile", "-Command", script]);
        let mut client = ControlClient::spawn_command(command).unwrap();
        client
            .arm_master_sequence(&master, "P001", &serde_json::json!({"language":"en"}))
            .unwrap();
        client.send(Action::Stop, None).unwrap();
        assert_eq!(client.phase, Phase::Idle);
        assert!(!client.sequence_armed);
        assert!(client.alive());
        client
            .arm_master_sequence(&master, "P001", &serde_json::json!({"language":"en"}))
            .unwrap();
        assert_eq!(client.snapshot(), (Phase::Armed, 2));
        client.shutdown();
        assert!(client.child.try_wait().unwrap().is_some());
        std::fs::remove_file(master).unwrap();
    }

    #[test]
    fn active_sequence_cleanup_survives_drop_shutdown_and_protocol_error() {
        for case in ["drop", "shutdown", "protocol-error"] {
            let root = std::env::temp_dir();
            let master = root.join(format!(
                "recorder-cleanup-{case}-{}.json",
                std::process::id()
            ));
            let marker = root.join(format!(
                "recorder-cleanup-{case}-{}.txt",
                std::process::id()
            ));
            let _ = std::fs::remove_file(&marker);
            std::fs::write(&master, b"{}").unwrap();
            let startup = serde_json::json!({"protocol":PROTOCOL,"requestId":null,"ok":true,"state":"idle","generation":0,"error":null});
            let armed = serde_json::json!({"protocol":PROTOCOL,"requestId":"recorder-1","ok":true,"state":"armed","generation":1,"error":null});
            let started = serde_json::json!({"protocol":PROTOCOL,"requestId":if case == "protocol-error" { "wrong" } else { "recorder-2" },"ok":true,"state":"start-requested","generation":1,"error":null});
            let script = format!(
                "[Console]::WriteLine('{}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{}'); [Console]::In.ReadLine() | Out-Null; [Console]::WriteLine('{}'); while ($null -ne [Console]::In.ReadLine()) {{}}; Start-Sleep -Milliseconds 2500; [IO.File]::WriteAllText('{}','cleaned')",
                startup,
                armed,
                started,
                marker.to_string_lossy().replace('\'', "''")
            );
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-Command", &script]);
            let mut client = ControlClient::spawn_command(command).unwrap();
            client
                .arm_master_sequence(&master, "P001", &serde_json::json!({"language":"en"}))
                .unwrap();
            if case == "protocol-error" {
                assert!(client
                    .send(Action::Start, None)
                    .unwrap_err()
                    .contains("Uncorrelated"));
            } else {
                client.send(Action::Start, None).unwrap();
            }
            if case == "shutdown" {
                client.input.take(); // Simulate a broken control pipe before Shutdown.
                client.shutdown();
            }
            drop(client);
            for _ in 0..200 {
                if marker.is_file() {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            assert_eq!(std::fs::read(&marker).unwrap(), b"cleaned");
            std::fs::remove_file(master).unwrap();
            std::fs::remove_file(marker).unwrap();
        }
    }
}

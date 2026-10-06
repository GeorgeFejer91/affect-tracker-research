//! Opt-in, supervised reports from the decoded VLC filter. RC writes are requests only.
use super::Result;
use serde::Deserialize;
use serde_json::json;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const PROTOCOL: &str = "flubber-vlc-runner-live/v1";
const PREFIX: &str = "FLUBBER_LIVE_V1 ";

#[derive(Debug)]
pub(super) struct Stopped;

impl std::fmt::Display for Stopped {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Supervising host stopped VLC playback")
    }
}

impl std::error::Error for Stopped {}

#[derive(Clone)]
pub(super) struct Binding {
    pub attempt_id: String,
    pub position: u32,
    pub generation: u64,
    pub workspace_file_id: String,
    pub asset_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Command {
    protocol: String,
    request_id: String,
    generation: u64,
    command: Action,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Action {
    Pause,
    Resume,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Frame {
    ended: bool,
    decoded_frames: u64,
    position_ms: u64,
}

fn parse_frame(line: &str, previous: Option<Frame>) -> Result<Option<Frame>> {
    let Some(frame) = line.strip_prefix(PREFIX) else {
        return Ok(None);
    };
    let mut parts = frame.trim_end().split(' ');
    let ended = match parts.next() {
        Some("playing") => false,
        Some("ended") => true,
        _ => return Err("Unknown decoded VLC frame state".into()),
    };
    let decoded_frames: u64 = parts.next().ok_or("Missing decoded frame count")?.parse()?;
    let position_ms: u64 = parts.next().ok_or("Missing decoded media time")?.parse()?;
    if parts.next().is_some()
        || decoded_frames == 0
        || previous.is_some_and(|last| {
            last.ended
                || decoded_frames < last.decoded_frames
                || position_ms < last.position_ms
                || (!ended && decoded_frames == last.decoded_frames)
                || (ended && decoded_frames != last.decoded_frames)
        })
        || (ended && previous.is_none())
    {
        return Err("Invalid decoded VLC frame progression".into());
    }
    Ok(Some(Frame {
        ended,
        decoded_frames,
        position_ms,
    }))
}

pub(super) fn emit(value: serde_json::Value) -> Result<()> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer(&mut output, &value)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

fn rc(port: u16, command: &str) -> Result<()> {
    let address = format!("127.0.0.1:{port}").parse()?;
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_millis(500))?;
    socket.set_write_timeout(Some(Duration::from_millis(500)))?;
    socket.write_all(command.as_bytes())?;
    socket.write_all(b"\n")?;
    Ok(())
}

fn controls(port: u16, binding: Binding, stopped: Arc<AtomicBool>) {
    let stdin = io::stdin();
    let mut input = BufReader::new(stdin.lock());
    loop {
        let mut bytes = Vec::new();
        let read = input
            .by_ref()
            .take(16 * 1024 + 1)
            .read_until(b'\n', &mut bytes);
        if !matches!(read, Ok(n) if n > 0 && bytes.last() == Some(&b'\n')) {
            stopped.store(true, Ordering::Release);
            let _ = rc(port, "quit");
            break;
        }
        let request = serde_json::from_slice::<Command>(&bytes);
        let Ok(request) = request else {
            let _ = emit(
                json!({"protocol":PROTOCOL,"kind":"command","ok":false,"error":"invalid_request"}),
            );
            continue;
        };
        let valid = request.protocol == PROTOCOL
            && request.generation == binding.generation
            && !request.request_id.is_empty()
            && request.request_id.len() <= 64
            && request
                .request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b));
        if !valid {
            let _ = emit(
                json!({"protocol":PROTOCOL,"kind":"command","requestId":request.request_id,"ok":false,"error":"stale_or_invalid_request"}),
            );
            continue;
        }
        let (accepted, state) = match request.command {
            Action::Pause | Action::Resume => (false, "unsupported"),
            Action::Stop => {
                stopped.store(true, Ordering::Release);
                let accepted = rc(port, "stop").and_then(|_| rc(port, "quit")).is_ok();
                (accepted, "stop-requested")
            }
        };
        let _ = emit(
            json!({"protocol":PROTOCOL,"kind":"command","requestId":request.request_id,"generation":binding.generation,"ok":accepted,"state":state}),
        );
        if matches!(request.command, Action::Stop) {
            break;
        }
    }
}

pub(super) fn forward(
    child: &mut Child,
    port: u16,
    binding: Binding,
    duration_ms: u64,
) -> Result<()> {
    let stdout = child
        .stdout
        .take()
        .ok_or("VLC decoded-frame pipe is absent")?;
    let deadline = Instant::now()
        .checked_add(Duration::from_millis(duration_ms).saturating_add(Duration::from_secs(120)))
        .ok_or("Live VLC deadline is not representable")?;
    let stopped = Arc::new(AtomicBool::new(false));
    let control_stopped = Arc::clone(&stopped);
    let control_binding = binding.clone();
    thread::spawn(move || controls(port, control_binding, control_stopped));
    let (sender, receiver) = mpsc::sync_channel(16);
    thread::spawn(move || {
        let mut input = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            let read = input.by_ref().take(257).read_until(b'\n', &mut bytes);
            let done = !matches!(&read, Ok(n) if *n > 0);
            if sender.send(read.map(|_| bytes)).is_err() || done {
                break;
            }
        }
    });
    let mut previous = None;
    let mut sequence = 0_u64;
    loop {
        if stopped.load(Ordering::Acquire) {
            return Err(Box::new(Stopped));
        }
        if Instant::now() >= deadline {
            return Err("Live VLC playback exceeded the selected duration deadline".into());
        }
        let bytes = match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(error)) => return Err(error.into()),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                return Err("VLC decoded-frame reader was lost".into())
            }
        };
        if bytes.is_empty() {
            break;
        }
        if bytes.last() != Some(&b'\n') {
            return Err("VLC stdout line exceeds live frame bound".into());
        }
        let line = std::str::from_utf8(&bytes)?;
        let Some(frame) = parse_frame(line, previous)? else {
            continue;
        };
        sequence = sequence
            .checked_add(1)
            .ok_or("VLC frame sequence exhausted")?;
        emit(
            json!({"protocol":PROTOCOL,"kind":"observation","observationSource":"decoded-render",
            "backend":"vlc","attemptId":binding.attempt_id,"position":binding.position,
            "generation":binding.generation,"workspaceFileId":binding.workspace_file_id,
            "assetSha256":binding.asset_sha256,"sequence":sequence,
            "state":if frame.ended {"ended"} else {"playing"},
            "positionMs":frame.position_ms,"decodedFrames":frame.decoded_frames}),
        )?;
        previous = Some(frame);
    }
    if stopped.load(Ordering::Acquire) && !previous.is_some_and(|frame| frame.ended) {
        return Err(Box::new(Stopped));
    }
    if !previous.is_some_and(|frame| frame.ended) {
        return Err("VLC exited without live decoded completion".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_frames_need_decoded_progress_and_terminal_sentinel() {
        assert!(parse_frame("VLC noise\n", None).unwrap().is_none());
        assert!(parse_frame("FLUBBER_LIVE_V1 ended 1 0\n", None).is_err());
        let first = parse_frame("FLUBBER_LIVE_V1 playing 1 0\n", None)
            .unwrap()
            .unwrap();
        assert!(parse_frame("FLUBBER_LIVE_V1 playing 1 0\n", Some(first)).is_err());
        let next = parse_frame("FLUBBER_LIVE_V1 playing 2 17\n", Some(first))
            .unwrap()
            .unwrap();
        assert!(parse_frame("FLUBBER_LIVE_V1 playing 3 16\n", Some(next)).is_err());
        let end = parse_frame("FLUBBER_LIVE_V1 ended 2 17\n", Some(next))
            .unwrap()
            .unwrap();
        assert!(parse_frame("FLUBBER_LIVE_V1 playing 3 34\n", Some(end)).is_err());
    }
}

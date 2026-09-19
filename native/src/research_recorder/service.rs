use super::xdf::{self, SampleFormat, StreamDescription, XdfWriter};
use super::{Discovery, RecordStartRequest, RecorderStatus, StreamChoice};
use crate::research_error::{CommandError, ResearchResult};
use labstream::{Buffer, Format, Inlet, Post, Query, StreamInfo};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, SyncSender, TrySendError},
    Arc, Mutex, MutexGuard,
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use uuid::Uuid;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const OWN_CAPACITY: usize = 4096;
fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|poison| poison.into_inner())
}
fn error(code: &'static str, message: &'static str) -> CommandError {
    CommandError::new(code, message)
}
fn io_error(_: std::io::Error) -> CommandError {
    error("recording_io", "The recording could not be written durably. Preserve the partial file and choose a new destination.")
}

#[derive(Default)]
struct Inner {
    discovery: Option<(String, BTreeMap<String, StreamInfo>)>,
    session: Option<Session>,
}
struct Session {
    samples: SyncSender<Packet>,
    control: mpsc::Sender<Control>,
    accepting: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    worker: JoinHandle<()>,
}
enum Control {
    Attach {
        state: StreamDescription,
        marker: StreamDescription,
        run_id: String,
        reply: mpsc::Sender<ResearchResult<()>>,
    },
}
struct Packet {
    id: u32,
    timestamp: f64,
    format: SampleFormat,
    channels: usize,
    values: Vec<u8>,
}
struct External {
    id: u32,
    inlet: Inlet,
    description: StreamDescription,
}

// A failed initialization must leave an explicit partial receipt, even when a
// sidecar collision or thread-spawn failure happens after reserving the XDF.
struct StartGuard {
    path: PathBuf,
    status: Arc<Mutex<RecorderStatus>>,
    armed: bool,
}
impl Drop for StartGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let mut status = lock(&self.status);
        status.active = false;
        status.phase = "failed".into();
        status.error=Some("Recorder initialization failed after reserving the XDF. Preserve the partial file and use a new destination.".into());
        let _ = write_receipt(&sidecar(&self.path, "recording.json"), &*status);
    }
}

#[derive(Default)]
pub struct RecorderService {
    inner: Mutex<Inner>,
    status: Arc<Mutex<RecorderStatus>>,
}

/// A bounded nonblocking copy of exactly the values successfully sent to LSL.
/// Queue overflow is an acquisition error, never an unreported dropped sample.
pub struct OwnRecording {
    sender: SyncSender<Packet>,
    accepting: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
}
impl OwnRecording {
    fn push(&self, packet: Packet) -> ResearchResult<()> {
        if !self.accepting.load(Ordering::Acquire) {
            return Err(error(
                "recording_stopped",
                "The selected recorder stopped accepting experiment samples.",
            ));
        }
        match self.sender.try_send(packet) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.overflow.store(true, Ordering::Release);
                Err(error(
                    "recording_overflow",
                    "The recorder could not keep up with experiment samples.",
                ))
            }
            Err(TrySendError::Disconnected(_)) => Err(error(
                "recording_disconnected",
                "The selected recorder is unavailable.",
            )),
        }
    }
    pub fn state(&self, timestamp: f64, values: &[f32; 8]) -> ResearchResult<()> {
        self.push(Packet {
            id: 1,
            timestamp,
            format: SampleFormat::Float32,
            channels: 8,
            values: values
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect(),
        })
    }
    pub fn marker(&self, timestamp: f64, value: &str) -> ResearchResult<()> {
        self.push(Packet {
            id: 2,
            timestamp,
            format: SampleFormat::String,
            channels: 1,
            values: xdf::text_sample(&[value.into()]).map_err(io_error)?,
        })
    }
}

impl RecorderService {
    pub fn status(&self) -> RecorderStatus {
        lock(&self.status).clone()
    }
    pub fn discover(&self) -> ResearchResult<Discovery> {
        let mut inner = lock(&self.inner);
        if self.status().active {
            return Err(error(
                "recording_active",
                "Stop recording before changing stream discovery.",
            ));
        }
        let found = labstream::resolve_all(&Query::all(), Duration::from_secs(2))
            .map_err(|_| error("lsl_discovery", "LSL stream discovery failed."))?;
        if found.len() > 128 {
            return Err(error("lsl_discovery_limit", "More than 128 streams were discovered; reduce the discovery scope on this network."));
        }
        let revision = Uuid::new_v4().to_string();
        let mut choices = Vec::new();
        let mut cache = BTreeMap::new();
        for info in found {
            let desc = description(&info)?;
            let key = Uuid::new_v4().to_string();
            choices.push(StreamChoice {
                key: key.clone(),
                name: desc.name,
                stream_type: desc.stream_type,
                source_id: desc.source_id,
                hostname: desc.hostname,
                channel_count: desc.channels,
                nominal_rate: desc.rate,
                channel_format: desc.format.name().into(),
            });
            cache.insert(key, info);
        }
        inner.discovery = Some((revision.clone(), cache));
        Ok(Discovery {
            revision,
            streams: choices,
        })
    }

    pub fn start_path(
        &self,
        request: RecordStartRequest,
        path: PathBuf,
    ) -> ResearchResult<RecorderStatus> {
        let recipe_hash = request.validate()?;
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("xdf"))
        {
            return Err(CommandError::invalid_contract(
                "The recording destination must have the .xdf extension.",
            ));
        }
        let mut inner = lock(&self.inner);
        if self.status().active {
            return Err(error("recording_active", "A recording is already active."));
        }
        if let Some(old) = inner.session.take() {
            let _ = old.worker.join();
        }
        let selected = selected_streams(&inner, &request)?;
        let mut external = Vec::new();
        for (index, info) in selected.into_iter().enumerate() {
            let inlet = Inlet::builder(&info)
                .buffer(Buffer::Samples(16384))
                .recover(false)
                .postprocess(Post::NONE)
                .open(CONNECT_TIMEOUT)
                .map_err(|_| {
                    error(
                        "lsl_stream_unavailable",
                        "A selected stream is unavailable. Discover and select it again.",
                    )
                })?;
            let full = description(inlet.info())?;
            let cached = description(&info)?;
            if full.name != cached.name
                || full.source_id != cached.source_id
                || full.hostname != cached.hostname
                || full.channels != cached.channels
                || full.format != cached.format
                || full.rate != cached.rate
            {
                return Err(error(
                    "lsl_stream_changed",
                    "A selected stream changed its metadata; select it again.",
                ));
            }
            if inlet.wait_for_time_correction(CONNECT_TIMEOUT).is_none() {
                return Err(error(
                    "lsl_clock_unavailable",
                    "A selected stream has no clock-offset measurement.",
                ));
            }
            external.push(External {
                id: index as u32 + 3,
                inlet,
                description: full,
            });
        }
        let recording_id = Uuid::new_v4().to_string();
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(io_error)?;
        let status = RecorderStatus {
            active: true,
            phase: if request.record_own {
                "awaiting-experiment"
            } else {
                "recording"
            }
            .into(),
            recording_id: Some(recording_id.clone()),
            recipe_sha256: Some(recipe_hash.clone()),
            file_name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned()),
            record_own: request.record_own,
            external_stream_count: external.len(),
            ..RecorderStatus::default()
        };
        *lock(&self.status) = status.clone();
        let mut guard = StartGuard {
            path: path.clone(),
            status: Arc::clone(&self.status),
            armed: true,
        };
        let mut writer =
            XdfWriter::new(BufWriter::new(file), &recording_id, &recipe_hash).map_err(io_error)?;
        for source in &external {
            writer
                .add_stream(source.id, source.description.clone())
                .map_err(io_error)?;
            offset(&mut writer, source)?;
        }
        writer.checkpoint().map_err(io_error)?;
        writer.output().get_ref().sync_all().map_err(io_error)?;
        let selections: Vec<_> = external
            .iter()
            .map(|source| (&source.id, &source.description))
            .collect();
        write_receipt(
            &sidecar(&path, "recording-start.json"),
            &serde_json::json!({"recording":status,"externalStreams":selections,"discoveryRevision":request.discovery_revision,"selectedKeys":request.stream_keys,"clockPolicy":"source-timestamps-with-offset-chunks","reconnectPolicy":"never","externalStringEncoding":"utf8-library-decoded"}),
        )?;
        let (samples_tx, samples_rx) = mpsc::sync_channel(OWN_CAPACITY);
        let (control_tx, control_rx) = mpsc::channel();
        let accepting = Arc::new(AtomicBool::new(true));
        let stopping = Arc::new(AtomicBool::new(false));
        let overflow = Arc::new(AtomicBool::new(false));
        let context = Worker {
            writer,
            external,
            samples: samples_rx,
            control: control_rx,
            status: Arc::clone(&self.status),
            accepting: Arc::clone(&accepting),
            stopping: Arc::clone(&stopping),
            overflow: Arc::clone(&overflow),
            path,
            own_bound: false,
        };
        let worker = std::thread::Builder::new()
            .name("runner-xdf-recorder".into())
            .spawn(move || context.run())
            .map_err(io_error)?;
        inner.session = Some(Session {
            samples: samples_tx,
            control: control_tx,
            accepting,
            stopping,
            overflow,
            worker,
        });
        guard.armed = false;
        Ok(self.status())
    }

    pub fn attach_own(
        &self,
        state: &StreamInfo,
        marker: &StreamInfo,
        recipe_hash: &str,
        run_id: &str,
    ) -> ResearchResult<Option<OwnRecording>> {
        let inner = lock(&self.inner);
        let status = self.status();
        if status.phase == "failed" && status.record_own {
            return Err(error("recording_failed", "The selected own-stream recording failed. Start a new recording before running the experiment."));
        }
        if !status.active || !status.record_own {
            return Ok(None);
        }
        if status.recipe_sha256.as_deref() != Some(recipe_hash) || status.run_id.is_some() {
            return Err(error(
                "recording_binding",
                "The recording belongs to another recipe or attempt. Start a new recording.",
            ));
        }
        let session = inner.session.as_ref().ok_or_else(|| {
            error(
                "recording_unavailable",
                "The recorder worker is unavailable.",
            )
        })?;
        let (reply_tx, reply_rx) = mpsc::channel();
        session
            .control
            .send(Control::Attach {
                state: description(state)?,
                marker: description(marker)?,
                run_id: run_id.into(),
                reply: reply_tx,
            })
            .map_err(|_| error("recording_unavailable", "The recorder worker stopped."))?;
        reply_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| {
                error(
                    "recording_timeout",
                    "The recorder could not bind this attempt.",
                )
            })??;
        Ok(Some(OwnRecording {
            sender: session.samples.clone(),
            accepting: Arc::clone(&session.accepting),
            overflow: Arc::clone(&session.overflow),
        }))
    }

    pub fn stop(&self) -> ResearchResult<RecorderStatus> {
        let mut inner = lock(&self.inner);
        if let Some(session) = inner.session.take() {
            session.accepting.store(false, Ordering::Release);
            session.stopping.store(true, Ordering::Release);
            if session.worker.join().is_err() {
                let mut status = lock(&self.status);
                status.active = false;
                status.phase = "failed".into();
                status.error = Some(
                    "The recorder worker ended unexpectedly; preserve the partial file.".into(),
                );
            }
        }
        Ok(self.status())
    }
    pub fn shutdown(&self) {
        let _ = self.stop();
    }
}
impl Drop for RecorderService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn selected_streams(
    inner: &Inner,
    request: &RecordStartRequest,
) -> ResearchResult<Vec<StreamInfo>> {
    if request.stream_keys.is_empty() {
        return Ok(Vec::new());
    }
    let (revision, cache) = inner.discovery.as_ref().ok_or_else(|| {
        error(
            "lsl_selection",
            "Discover external streams before selecting them.",
        )
    })?;
    if request.discovery_revision.as_ref() != Some(revision) {
        return Err(error(
            "lsl_selection_stale",
            "Stream discovery changed; select streams again.",
        ));
    }
    request
        .stream_keys
        .iter()
        .map(|key| {
            cache.get(key).cloned().ok_or_else(|| {
                error(
                    "lsl_selection",
                    "A selected stream is absent from this discovery receipt.",
                )
            })
        })
        .collect()
}
fn description(info: &StreamInfo) -> ResearchResult<StreamDescription> {
    let format = match info.format() {
        Format::Float32 => SampleFormat::Float32,
        Format::Double64 => SampleFormat::Double64,
        Format::Int8 => SampleFormat::Int8,
        Format::Int16 => SampleFormat::Int16,
        Format::Int32 => SampleFormat::Int32,
        Format::Int64 => SampleFormat::Int64,
        Format::String => SampleFormat::String,
        _ => {
            return Err(error(
                "lsl_format",
                "A discovered stream has an unsupported channel format.",
            ))
        }
    };
    let mut desc_xml = String::new();
    info.desc().write(&mut desc_xml, 0);
    if !(1..=512).contains(&info.channel_count())
        || !info.rate().is_finite()
        || info.rate() < 0.0
        || desc_xml.len() > 1024 * 1024
    {
        return Err(error(
            "lsl_metadata",
            "A stream exceeds the recorder metadata or channel limit.",
        ));
    }
    Ok(StreamDescription {
        name: info.name().into(),
        stream_type: info.stream_type().into(),
        source_id: info.source_id().into(),
        hostname: info.hostname().into(),
        channels: info.channel_count(),
        rate: info.rate(),
        format,
        desc_xml,
    })
}
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{suffix}"));
    PathBuf::from(name)
}
fn write_receipt(path: &Path, value: &impl Serialize) -> ResearchResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(io_error)?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|_| {
        error(
            "recording_receipt",
            "The recording receipt could not be serialized.",
        )
    })?;
    file.write_all(b"\n").map_err(io_error)?;
    file.sync_all().map_err(io_error)
}
fn offset(writer: &mut XdfWriter<BufWriter<File>>, source: &External) -> ResearchResult<()> {
    let offset = source.inlet.time_correction().ok_or_else(|| {
        error(
            "lsl_clock_unavailable",
            "A selected stream lost its clock-offset measurement.",
        )
    })?;
    writer
        .clock_offset(source.id, labstream::clock() - offset, offset)
        .map_err(io_error)
}

struct Worker {
    writer: XdfWriter<BufWriter<File>>,
    external: Vec<External>,
    samples: Receiver<Packet>,
    control: Receiver<Control>,
    status: Arc<Mutex<RecorderStatus>>,
    accepting: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    overflow: Arc<AtomicBool>,
    path: PathBuf,
    own_bound: bool,
}
impl Worker {
    fn run(mut self) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.record()))
            .unwrap_or_else(|_| {
                Err(error(
                    "recording_worker_failed",
                    "The recording worker ended unexpectedly. Preserve the partial file.",
                ))
            });
        self.accepting.store(false, Ordering::Release);
        let flush = self
            .writer
            .flush()
            .and_then(|_| self.writer.output().get_ref().sync_all())
            .map_err(io_error);
        let result = result.and(flush);
        let mut final_status = lock(&self.status).clone();
        final_status.active = false;
        match result {
            Ok(()) => {
                final_status.phase = "complete".into();
            }
            Err(failure) => {
                final_status.phase = "failed".into();
                final_status.error = Some(failure.message);
            }
        }
        if let Err(failure) = write_receipt(&sidecar(&self.path, "recording.json"), &final_status) {
            final_status.phase = "failed".into();
            final_status.error = Some(failure.message);
        }
        *lock(&self.status) = final_status;
    }
    fn write_packet(&mut self, packet: Packet) -> ResearchResult<()> {
        self.writer
            .sample(
                packet.id,
                packet.timestamp,
                packet.format,
                packet.channels,
                &packet.values,
            )
            .map_err(io_error)?;
        lock(&self.status).sample_count += 1;
        Ok(())
    }
    fn record(&mut self) -> ResearchResult<()> {
        let mut checkpoint = Instant::now();
        let mut clocks = Instant::now();
        loop {
            if self.overflow.load(Ordering::Acquire) {
                return Err(error(
                    "recording_overflow",
                    "Experiment samples exceeded the recorder queue. The recording is incomplete.",
                ));
            }
            while let Ok(Control::Attach {
                state,
                marker,
                run_id,
                reply,
            }) = self.control.try_recv()
            {
                let result = (|| {
                    if self.own_bound {
                        return Err(error(
                            "recording_binding",
                            "This recording already contains an experiment attempt.",
                        ));
                    }
                    self.writer.add_stream(1, state).map_err(io_error)?;
                    self.writer.add_stream(2, marker).map_err(io_error)?;
                    let now = labstream::clock();
                    self.writer.clock_offset(1, now, 0.0).map_err(io_error)?;
                    self.writer.clock_offset(2, now, 0.0).map_err(io_error)?;
                    self.writer.checkpoint().map_err(io_error)?;
                    self.writer
                        .output()
                        .get_ref()
                        .sync_all()
                        .map_err(io_error)?;
                    self.own_bound = true;
                    {
                        let mut status = lock(&self.status);
                        status.run_id = Some(run_id);
                        status.phase = "recording".into();
                    }
                    write_receipt(
                        &sidecar(&self.path, "recording-attempt.json"),
                        &*lock(&self.status),
                    )?;
                    Ok(())
                })();
                let _ = reply.send(result.clone());
                result?;
            }
            let stopping = self.stopping.load(Ordering::Acquire);
            // Stop closes the own producer barrier before draining its complete queue.
            for _ in 0..if stopping { OWN_CAPACITY } else { 256 } {
                match self.samples.try_recv() {
                    Ok(packet) => self.write_packet(packet)?,
                    Err(_) => break,
                }
            }
            for index in 0..self.external.len() {
                let count = if stopping {
                    self.external[index].inlet.available()
                } else {
                    128
                };
                for _ in 0..count {
                    let packet = pull(&mut self.external[index])?;
                    let Some(packet) = packet else { break };
                    self.write_packet(packet)?;
                }
                if self.external[index].inlet.dropped() != 0 {
                    return Err(error("lsl_buffer_overflow","A selected external stream dropped buffered samples. The recording is incomplete."));
                }
                if !stopping && self.external[index].inlet.is_finished() {
                    return Err(error(
                        "lsl_disconnected",
                        "A selected external stream disconnected. The recording is incomplete.",
                    ));
                }
            }
            if stopping {
                if lock(&self.status).record_own && !self.own_bound {
                    return Err(error(
                        "recording_unbound",
                        "Recording stopped before an experiment supplied its own streams.",
                    ));
                }
                for source in &self.external {
                    offset(&mut self.writer, source)?;
                }
                self.writer.finish().map_err(io_error)?;
                return Ok(());
            }
            if clocks.elapsed() >= Duration::from_secs(5) {
                for source in &self.external {
                    offset(&mut self.writer, source)?;
                }
                clocks = Instant::now();
            }
            if checkpoint.elapsed() >= Duration::from_secs(1) {
                self.writer.checkpoint().map_err(io_error)?;
                self.writer
                    .output()
                    .get_ref()
                    .sync_all()
                    .map_err(io_error)?;
                checkpoint = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}
fn pull(source: &mut External) -> ResearchResult<Option<Packet>> {
    macro_rules! numeric {
        ($ty:ty) => {
            source.inlet.pull::<$ty>(Duration::ZERO).map(|sample| {
                sample.map(|(at, values)| {
                    (
                        at,
                        values.len(),
                        values
                            .iter()
                            .flat_map(|value| value.to_le_bytes())
                            .collect::<Vec<u8>>(),
                    )
                })
            })
        };
    }
    let sample = match source.description.format {
        SampleFormat::Float32 => numeric!(f32),
        SampleFormat::Double64 => numeric!(f64),
        SampleFormat::Int8 => numeric!(i8),
        SampleFormat::Int16 => numeric!(i16),
        SampleFormat::Int32 => numeric!(i32),
        SampleFormat::Int64 => numeric!(i64),
        SampleFormat::String => {
            let value = source
                .inlet
                .pull_text(Duration::ZERO)
                .map_err(|_| error("lsl_pull", "A selected stream could not be read."))?;
            return value
                .map(|(timestamp, values)| {
                    Ok(Packet {
                        id: source.id,
                        timestamp,
                        format: source.description.format,
                        channels: values.len(),
                        values: xdf::text_sample(&values).map_err(io_error)?,
                    })
                })
                .transpose();
        }
    }
    .map_err(|_| error("lsl_pull", "A selected stream could not be read."))?;
    Ok(sample.map(|(timestamp, channels, values)| Packet {
        id: source.id,
        timestamp,
        format: source.description.format,
        channels,
        values,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn own_request() -> RecordStartRequest {
        RecordStartRequest {
            experiment_package_source_text: include_str!(
                "../../../test/fixtures/runner-lsl-package-v1.canonical.json"
            )
            .into(),
            record_own: true,
            discovery_revision: None,
            stream_keys: vec![],
        }
    }
    fn fixture_path(label: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("affect-runner-{label}-{}", Uuid::new_v4()));
        std::fs::create_dir(&folder).unwrap();
        folder.join("recording.xdf")
    }
    fn own_metadata() -> (StreamInfo, StreamInfo) {
        (
            StreamInfo::builder("Synthetic own state", "Affect", Format::Float32)
                .source_id("fixture-state")
                .rate(130.0)
                .channels((0..8).map(|i| labstream::Channel::new(&format!("channel-{i}"))))
                .build()
                .unwrap(),
            StreamInfo::builder("Synthetic own markers", "Markers", Format::String)
                .source_id("fixture-markers")
                .irregular()
                .channels([labstream::Channel::new("marker")])
                .build()
                .unwrap(),
        )
    }
    #[test]
    fn participant_prefixed_native_metadata_is_retained_in_xdf() {
        let request = own_request();
        let loaded = crate::research_experiment_package::parse_canonical_experiment_package_text(
            &request.experiment_package_source_text,
        )
        .unwrap();
        let effective = crate::research_runner_session::participant_lsl(
            &loaded.package.settings.advanced.lsl,
            "P001",
        )
        .unwrap();
        let (state, marker) = crate::research_lsl::build_stream_descriptions(
            &effective,
            130,
            "participant-xdf-fixture",
        )
        .unwrap();
        let path = std::env::var_os("AFFECT_RUNNER_PARTICIPANT_XDF_FIXTURE")
            .map(PathBuf::from)
            .unwrap_or_else(|| fixture_path("participant"));
        let service = RecorderService::default();
        let hash = request.validate().unwrap();
        service.start_path(request, path.clone()).unwrap();
        let tap = service
            .attach_own(&state, &marker, &hash, "participant-xdf-fixture")
            .unwrap()
            .unwrap();
        tap.marker(20.0, "session_started").unwrap();
        tap.state(20.125, &[0.5; 8]).unwrap();
        tap.marker(20.25, "session_completed").unwrap();
        assert_eq!(service.stop().unwrap().phase, "complete");
        let bytes = std::fs::read(&path).unwrap();
        for name in [&effective.state_stream, &effective.marker_stream] {
            assert!(bytes
                .windows(name.len())
                .any(|window| window == name.as_bytes()));
        }
    }

    #[test]
    fn own_worker_drains_terminal_marker_binds_recipe_and_never_overwrites() {
        let path = std::env::var_os("AFFECT_RUNNER_OWN_XDF_FIXTURE")
            .map(PathBuf::from)
            .unwrap_or_else(|| fixture_path("own"));
        let service = RecorderService::default();
        let request = own_request();
        let hash = request.validate().unwrap();
        service.start_path(request.clone(), path.clone()).unwrap();
        let (state, marker) = own_metadata();
        assert!(service
            .attach_own(&state, &marker, &"0".repeat(64), "run-1")
            .is_err());
        let tap = service
            .attach_own(&state, &marker, &hash, "run-1")
            .unwrap()
            .unwrap();
        assert!(service.attach_own(&state, &marker, &hash, "run-2").is_err());
        tap.marker(10.0, "session_started").unwrap();
        tap.state(10.125, &[0.25; 8]).unwrap();
        tap.marker(10.25, "session_completed").unwrap();
        let result = service.stop().unwrap();
        assert_eq!(result.phase, "complete");
        assert_eq!(result.sample_count, 3);
        assert_eq!(result.run_id.as_deref(), Some("run-1"));
        assert!(tap.marker(10.5, "late").is_err());
        let bytes = std::fs::read(&path).unwrap();
        assert!(service.start_path(request, path.clone()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let receipt: serde_json::Value =
            serde_json::from_slice(&std::fs::read(sidecar(&path, "recording.json")).unwrap())
                .unwrap();
        assert_eq!(receipt["recipeSha256"], hash);
        assert_eq!(receipt["phase"], "complete");
    }
    #[test]
    fn stopped_unbound_own_recording_is_explicitly_incomplete() {
        let service = RecorderService::default();
        let path = fixture_path("unbound");
        service.start_path(own_request(), path.clone()).unwrap();
        let result = service.stop().unwrap();
        assert_eq!(result.phase, "failed");
        assert_eq!(result.sample_count, 0);
        assert!(result.error.unwrap().contains("before an experiment"));
    }
    #[test]
    fn initialization_receipt_collision_preserves_evidence_and_reports_partial() {
        let service = RecorderService::default();
        let path = fixture_path("collision");
        let original = b"existing receipt";
        std::fs::write(sidecar(&path, "recording-start.json"), original).unwrap();
        assert!(service.start_path(own_request(), path.clone()).is_err());
        assert_eq!(
            std::fs::read(sidecar(&path, "recording-start.json")).unwrap(),
            original
        );
        let status = service.status();
        assert!(!status.active);
        assert_eq!(status.phase, "failed");
        assert!(sidecar(&path, "recording.json").exists());
    }
    #[test]
    #[ignore = "explicit synthetic local LSL transport exercise"]
    fn selected_external_loopback_and_own_streams_share_one_xdf() {
        assert_eq!(
            std::env::var("AFFECT_RUNNER_SYNTHETIC_LSL").as_deref(),
            Ok("1")
        );
        let path = std::env::var_os("AFFECT_RUNNER_LOOPBACK_XDF_FIXTURE")
            .map(PathBuf::from)
            .unwrap_or_else(|| fixture_path("loopback"));
        let source = Uuid::new_v4().to_string();
        let outlet = labstream::Outlet::new(
            StreamInfo::builder("Runner synthetic Int64", "Test", Format::Int64)
                .source_id(&source)
                .irregular()
                .channels([labstream::Channel::new("integer")])
                .build()
                .unwrap(),
        )
        .unwrap();
        let info = labstream::resolve_first(&Query::source_id(&source), CONNECT_TIMEOUT)
            .unwrap()
            .unwrap();
        let service = RecorderService::default();
        let key = Uuid::new_v4().to_string();
        let revision = Uuid::new_v4().to_string();
        lock(&service.inner).discovery =
            Some((revision.clone(), BTreeMap::from([(key.clone(), info)])));
        let mut request = own_request();
        request.discovery_revision = Some(revision);
        request.stream_keys.push(key);
        let hash = request.validate().unwrap();
        service.start_path(request, path.clone()).unwrap();
        assert!(outlet.wait_for_consumers(CONNECT_TIMEOUT));
        let (state, marker) = own_metadata();
        let tap = service
            .attach_own(&state, &marker, &hash, "synthetic-loopback")
            .unwrap()
            .unwrap();
        tap.marker(labstream::clock(), "session_started").unwrap();
        outlet.push_at(&[i64::MAX], labstream::clock()).unwrap();
        tap.state(labstream::clock(), &[0.5; 8]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while service.status().sample_count < 3 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(service.status().sample_count, 3);
        tap.marker(labstream::clock(), "session_completed").unwrap();
        let result = service.stop().unwrap();
        assert_eq!(result.phase, "complete", "{:?}", result.error);
        assert_eq!(result.sample_count, 4);
    }
    #[test]
    fn full_own_queue_fails_without_blocking_or_overwriting() {
        let (sender, _receiver) = mpsc::sync_channel(1);
        let overflow = Arc::new(AtomicBool::new(false));
        let tap = OwnRecording {
            sender,
            accepting: Arc::new(AtomicBool::new(true)),
            overflow: Arc::clone(&overflow),
        };
        tap.state(1.0, &[0.0; 8]).unwrap();
        assert!(tap.marker(2.0, "test").is_err());
        assert!(overflow.load(Ordering::Acquire));
    }
    #[test]
    fn stale_selection_cannot_bind_a_different_discovery() {
        let inner = Inner {
            discovery: Some(("new".into(), BTreeMap::new())),
            session: None,
        };
        let request = RecordStartRequest {
            experiment_package_source_text: String::new(),
            record_own: false,
            discovery_revision: Some("old".into()),
            stream_keys: vec![Uuid::new_v4().to_string()],
        };
        assert_eq!(
            selected_streams(&inner, &request).unwrap_err().code,
            "lsl_selection_stale"
        );
    }
}

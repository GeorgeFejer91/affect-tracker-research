//! C ABI between VLC's Qt GUI thread and Flubber's independent 30 Hz LSL worker.
//! All caller strings are copied before return; no VLC, Qt, or HWND pointer is retained.

use labstream::{Channel, Format, Outlet, StreamInfo};
use std::ffi::{c_char, c_int, c_void, CStr};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows_sys::Win32::System::Threading::{
    CreateWaitableTimerExW, SetWaitableTimer, WaitForSingleObject,
    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS,
};

const RATE: Duration = Duration::from_nanos(33_333_333);

#[derive(Clone)]
struct Snapshot {
    x: f32,
    y: f32,
    state: i32,
    media_ms: i64,
    name: String,
    path: Option<PathBuf>,
    interrupts: u64,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            x: 0.,
            y: 0.,
            state: 0,
            media_ms: 0,
            name: String::new(),
            path: None,
            interrupts: 0,
        }
    }
}

struct WorkerTimer(HANDLE);
impl WorkerTimer {
    fn new() -> Result<Self, &'static str> {
        // SAFETY: An unnamed, non-inheritable timer belongs only to this worker.
        let timer = unsafe {
            CreateWaitableTimerExW(
                std::ptr::null(),
                std::ptr::null(),
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                TIMER_ALL_ACCESS,
            )
        };
        if timer.is_null() {
            Err("high-resolution timer creation failed")
        } else {
            Ok(Self(timer))
        }
    }
    fn wait_until(&self, target: Instant) -> Result<(), &'static str> {
        let remaining = target.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(());
        }
        let due = -((remaining.as_nanos() / 100).max(1).min(i64::MAX as u128) as i64);
        // SAFETY: This worker owns the live timer and supplies a relative 100 ns due time.
        if unsafe { SetWaitableTimer(self.0, &due, 0, None, std::ptr::null(), 0) } == 0
            || unsafe { WaitForSingleObject(self.0, u32::MAX) } != WAIT_OBJECT_0
        {
            return Err("high-resolution timer wait failed");
        }
        Ok(())
    }
}
impl Drop for WorkerTimer {
    fn drop(&mut self) {
        // SAFETY: Drop occurs after this worker's final wait.
        unsafe { CloseHandle(self.0) };
    }
}

struct TimerPeriod;
impl TimerPeriod {
    fn new() -> Result<Self, &'static str> {
        // SAFETY: Paired by Drop and kept alive throughout the worker loop.
        if unsafe { timeBeginPeriod(1) } == 0 {
            Ok(Self)
        } else {
            Err("1 ms timer period unavailable")
        }
    }
}
impl Drop for TimerPeriod {
    fn drop(&mut self) {
        // SAFETY: Pairs exactly one successful timeBeginPeriod.
        unsafe { timeEndPeriod(1) };
    }
}

struct Session {
    name: String,
    path: Option<PathBuf>,
    origin: f64,
    paused_at: Option<f64>,
    last_state: i32,
}
impl Session {
    fn start(
        snapshot: &Snapshot,
        stamp: f64,
        markers: &Outlet,
        csv: &mpsc::SyncSender<CsvCommand>,
    ) -> Result<Self, String> {
        let name = if snapshot.name.is_empty() {
            "video"
        } else {
            &snapshot.name
        };
        let origin = stamp - snapshot.media_ms as f64 / 1000.;
        if let Some(path) = &snapshot.path {
            csv.try_send(CsvCommand::Open(path.clone()))
                .map_err(|e| e.to_string())?;
        }
        markers
            .push_text_at(&format!("{name}_Start"), origin)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            name: name.into(),
            path: snapshot.path.clone(),
            origin,
            paused_at: None,
            last_state: snapshot.state,
        })
    }
    fn marker(&self, markers: &Outlet, suffix: &str, stamp: f64) -> Result<(), String> {
        markers
            .push_text_at(&format!("{}_{}", self.name, suffix), stamp)
            .map_err(|e| e.to_string())
    }
    fn sample(
        &mut self,
        snapshot: &Snapshot,
        stamp: f64,
        markers: &Outlet,
        csv: &mpsc::SyncSender<CsvCommand>,
    ) -> Result<(), String> {
        if snapshot.state != self.last_state {
            match snapshot.state {
                4 => self.marker(markers, "Pause", stamp)?,
                3 if self.last_state == 4 => self.marker(markers, "Resume", stamp)?,
                2 => self.marker(markers, "BufferingStart", stamp)?,
                3 if self.last_state == 2 => self.marker(markers, "BufferingEnd", stamp)?,
                _ => {}
            }
            self.last_state = snapshot.state;
        }
        if snapshot.state != 3 {
            self.paused_at.get_or_insert(stamp);
            return Ok(());
        }
        if let Some(started) = self.paused_at.take() {
            self.origin += stamp - started;
        }
        if self.path.is_some() {
            csv.try_send(CsvCommand::Row(
                (stamp - self.origin).max(0.),
                snapshot.x,
                snapshot.y,
            ))
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    fn stop(
        self,
        markers: &Outlet,
        stamp: f64,
        suffix: Option<&str>,
        csv: &mpsc::SyncSender<CsvCommand>,
    ) -> Result<(), String> {
        if let Some(suffix) = suffix {
            self.marker(markers, suffix, stamp)?;
        }
        self.marker(markers, "Stop", stamp)?;
        if self.path.is_some() {
            csv.try_send(CsvCommand::Close).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

enum CsvCommand {
    Open(PathBuf),
    Row(f64, f32, f32),
    Close,
}
fn csv_writer(commands: mpsc::Receiver<CsvCommand>) -> Result<(), String> {
    let mut recording: Option<BufWriter<File>> = None;
    let mut pending = 0;
    let mut selected_path = std::env::var_os("VLC_FLUBBER_CSV_PATH").map(PathBuf::from);
    for command in commands {
        match command {
            CsvCommand::Open(path) => {
                if recording.is_some() {
                    return Err("CSV recording already open".into());
                }
                recording = Some(if let Some(selected) = selected_path.take() {
                    open_selected_csv(&path, &selected)?
                } else {
                    open_csv(&path)?
                });
                pending = 0;
            }
            CsvCommand::Row(time, x, y) => {
                if let Some(file) = &mut recording {
                    writeln!(file, "{time:.6},{x:.6},{y:.6}").map_err(|e| e.to_string())?;
                    pending += 1;
                    if pending >= 30 {
                        file.flush().map_err(|e| e.to_string())?;
                        pending = 0;
                    }
                }
            }
            CsvCommand::Close => {
                if let Some(mut file) = recording.take() {
                    file.flush().map_err(|e| e.to_string())?;
                }
                pending = 0;
            }
        }
    }
    if let Some(mut file) = recording {
        file.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn open_selected_csv(media: &Path, selected: &Path) -> Result<BufWriter<File>, String> {
    if !selected.is_absolute() || selected.extension().is_none_or(|ext| ext != "csv") {
        return Err("VLC_FLUBBER_CSV_PATH must be an absolute .csv path".into());
    }
    let media_parent = media
        .parent()
        .ok_or("media path has no parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let selected_parent = selected
        .parent()
        .ok_or("CSV path has no parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if media_parent != selected_parent {
        return Err("VLC_FLUBBER_CSV_PATH must be beside the media file".into());
    }
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(selected)
        .map_err(|e| e.to_string())?;
    let mut csv = BufWriter::new(file);
    csv.write_all(b"time_s,valence,arousal\n")
        .and_then(|_| csv.flush())
        .map_err(|e| e.to_string())?;
    Ok(csv)
}
fn open_csv(path: &Path) -> Result<BufWriter<File>, String> {
    let parent = path.parent().ok_or("media path has no parent")?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    for retry in 0..100_u32 {
        let filename = parent.join(format!(
            "{stem}-flubber-{stamp}-{}-{retry}.csv",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(filename)
        {
            Ok(file) => {
                let mut csv = BufWriter::new(file);
                csv.write_all(b"time_s,valence,arousal\n")
                    .map_err(|e| e.to_string())?;
                csv.flush().map_err(|e| e.to_string())?;
                return Ok(csv);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("no unique affect CSV name available".into())
}

fn worker(
    shared: Arc<Mutex<Snapshot>>,
    stop: mpsc::Receiver<()>,
    status: Arc<AtomicU8>,
) -> Result<(), String> {
    let source = format!("vlc-flubber-{}", std::process::id());
    let result: Result<(Outlet, Outlet, WorkerTimer, TimerPeriod), String> = (|| {
        let info = StreamInfo::builder("VLC_Flubber_Affect", "Affect", Format::Float32)
            .rate(30.)
            .source_id(&format!("{source}-affect"))
            .channels([
                Channel::new("valence").unit("normalized").kind("Affect"),
                Channel::new("arousal").unit("normalized").kind("Affect"),
            ])
            .build()
            .map_err(|e| e.to_string())?;
        let marker_info = StreamInfo::builder("VLC_Flubber_Markers", "Markers", Format::String)
            .irregular()
            .source_id(&format!("{source}-markers"))
            .channels([Channel::new("marker").kind("Markers")])
            .build()
            .map_err(|e| e.to_string())?;
        let affect = Outlet::new(info).map_err(|e| e.to_string())?;
        let markers = Outlet::new(marker_info).map_err(|e| e.to_string())?;
        let period = TimerPeriod::new().map_err(str::to_owned)?;
        let timer = WorkerTimer::new().map_err(str::to_owned)?;
        Ok((affect, markers, timer, period))
    })();
    let (affect, markers, timer, _period) = match result {
        Ok(value) => {
            status.store(1, Ordering::Release);
            value
        }
        Err(error) => {
            status.store(2, Ordering::Release);
            return Err(error);
        }
    };
    let (csv_tx, csv_rx) = mpsc::sync_channel(256);
    let csv_failure = Arc::new(Mutex::new(None::<String>));
    let writer_failure = Arc::clone(&csv_failure);
    let csv_thread = thread::spawn(move || {
        let result = csv_writer(csv_rx);
        if let Err(message) = &result {
            if let Ok(mut slot) = writer_failure.lock() {
                *slot = Some(message.clone());
            }
        }
        result
    });
    let run = (|| -> Result<(), String> {
        let mut session: Option<Session> = None;
        let mut last_interrupts = 0;
        let mut next = Instant::now();
        loop {
            if stop.try_recv().is_ok() {
                break;
            }
            if let Ok(failure) = csv_failure.lock() {
                if let Some(message) = failure.as_ref() {
                    return Err(format!("CSV writer: {message}"));
                }
            }
            let snapshot = shared.lock().map_err(|_| "affect lock poisoned")?.clone();
            let stamp = labstream::clock();
            if snapshot.interrupts != last_interrupts {
                if let Some(active) = &session {
                    active.marker(&markers, "Interrupt", stamp)?;
                }
                last_interrupts = snapshot.interrupts;
            }
            if let Some(active) = &session {
                if matches!(snapshot.state, 5..=7)
                    || snapshot.name != active.name
                    || snapshot.path != active.path
                {
                    let active = session.take().unwrap();
                    let suffix = match snapshot.state {
                        6 => Some("End"),
                        7 => Some("Error"),
                        _ => None,
                    };
                    active.stop(&markers, stamp, suffix, &csv_tx)?;
                }
            }
            if session.is_none() && snapshot.state == 3 && snapshot.media_ms > 0 {
                session = Some(Session::start(&snapshot, stamp, &markers, &csv_tx)?);
            }
            if let Some(active) = &mut session {
                active.sample(&snapshot, stamp, &markers, &csv_tx)?;
            }
            affect
                .push_at(&[snapshot.x, snapshot.y], stamp)
                .map_err(|e| e.to_string())?;
            next += RATE;
            if next > Instant::now() {
                timer.wait_until(next).map_err(str::to_owned)?;
            } else {
                next = Instant::now();
            }
        }
        if let Some(active) = session {
            active.stop(&markers, labstream::clock(), None, &csv_tx)?;
        }
        Ok(())
    })();
    drop(csv_tx);
    let writer = csv_thread
        .join()
        .unwrap_or_else(|_| Err("CSV writer panicked".into()));
    run.and(writer)
}

pub struct Bridge {
    shared: Arc<Mutex<Snapshot>>,
    stop: mpsc::Sender<()>,
    worker: Option<JoinHandle<Result<(), String>>>,
    status: Arc<AtomicU8>,
    error: Arc<Mutex<String>>,
}

/// Returns an owned handle immediately; poll status for asynchronous startup.
#[no_mangle]
pub extern "C" fn flubber_bridge_new() -> *mut c_void {
    std::panic::catch_unwind(|| {
        let shared = Arc::new(Mutex::new(Snapshot::default()));
        let (stop_tx, stop_rx) = mpsc::channel();
        let status = Arc::new(AtomicU8::new(0));
        let error = Arc::new(Mutex::new(String::new()));
        let worker_shared = Arc::clone(&shared);
        let worker_status = Arc::clone(&status);
        let worker_error = Arc::clone(&error);
        let thread = thread::spawn(move || {
            let result = worker(worker_shared, stop_rx, Arc::clone(&worker_status));
            if let Err(message) = &result {
                if let Ok(mut error) = worker_error.lock() {
                    *error = message.clone();
                }
                worker_status.store(2, Ordering::Release);
            }
            result
        });
        Box::into_raw(Box::new(Bridge {
            shared,
            stop: stop_tx,
            worker: Some(thread),
            status,
            error,
        }))
        .cast()
    })
    .unwrap_or(std::ptr::null_mut())
}

/// All caller-owned UTF-8 buffers are copied during this call.
#[no_mangle]
pub unsafe extern "C" fn flubber_bridge_update(
    bridge: *mut c_void,
    x: f32,
    y: f32,
    state: c_int,
    media_ms: i64,
    name: *const c_char,
    path: *const c_char,
) -> c_int {
    std::panic::catch_unwind(|| {
        if bridge.is_null() || name.is_null() || path.is_null() || !x.is_finite() || !y.is_finite()
        {
            return -1;
        }
        // SAFETY: Qt owns the handle and passes live zero-terminated buffers.
        let bridge = unsafe { &*(bridge as *const Bridge) };
        if bridge.status.load(Ordering::Acquire) == 2 {
            return -4;
        }
        let name = unsafe { CStr::from_ptr(name) }
            .to_string_lossy()
            .into_owned();
        let path = unsafe { CStr::from_ptr(path) }
            .to_string_lossy()
            .into_owned();
        if let Ok(mut shared) = bridge.shared.lock() {
            let interrupts = shared.interrupts;
            *shared = Snapshot {
                x: x.clamp(-1., 1.),
                y: y.clamp(-1., 1.),
                state,
                media_ms,
                name,
                path: if path.is_empty() {
                    None
                } else {
                    Some(PathBuf::from(path))
                },
                interrupts,
            };
            0
        } else {
            -2
        }
    })
    .unwrap_or(-3)
}

/// Queue one focus-loss marker for the live video session.
#[no_mangle]
pub unsafe extern "C" fn flubber_bridge_interrupt(bridge: *mut c_void) -> c_int {
    std::panic::catch_unwind(|| {
        if bridge.is_null() {
            return -1;
        }
        // SAFETY: Qt owns this handle until its timer has stopped.
        let bridge = unsafe { &*(bridge as *const Bridge) };
        if bridge.status.load(Ordering::Acquire) == 2 {
            return -4;
        }
        if let Ok(mut shared) = bridge.shared.lock() {
            shared.interrupts = shared.interrupts.wrapping_add(1);
            0
        } else {
            -2
        }
    })
    .unwrap_or(-3)
}

/// 0 starting, 1 outlets live, -1 worker failed.
#[no_mangle]
pub unsafe extern "C" fn flubber_bridge_status(bridge: *mut c_void) -> c_int {
    std::panic::catch_unwind(|| {
        if bridge.is_null() {
            return -1;
        }
        // SAFETY: Qt owns this handle until its timer has stopped.
        let bridge = unsafe { &*(bridge as *const Bridge) };
        match bridge.status.load(Ordering::Acquire) {
            0 => 0,
            1 => 1,
            _ => -1,
        }
    })
    .unwrap_or(-1)
}

/// Copy a terminal error into caller storage, including a zero terminator.
#[no_mangle]
pub unsafe extern "C" fn flubber_bridge_error(
    bridge: *mut c_void,
    out: *mut c_char,
    capacity: usize,
) -> usize {
    std::panic::catch_unwind(|| {
        if bridge.is_null() || out.is_null() || capacity == 0 {
            return 0;
        }
        // SAFETY: Qt owns the handle and supplies a writable buffer of capacity bytes.
        let bridge = unsafe { &*(bridge as *const Bridge) };
        let Ok(error) = bridge.error.lock() else {
            return 0;
        };
        let length = error.len().min(capacity - 1);
        // SAFETY: length is within the caller capacity and the buffers do not overlap.
        unsafe {
            std::ptr::copy_nonoverlapping(error.as_ptr(), out.cast(), length);
            *out.add(length) = 0;
        }
        length
    })
    .unwrap_or(0)
}

/// Qt stops its update timer before freeing; join closes outlets and CSV before DLL unload.
#[no_mangle]
pub unsafe extern "C" fn flubber_bridge_free(bridge: *mut c_void) {
    if bridge.is_null() {
        return;
    }
    let _ = std::panic::catch_unwind(|| {
        // SAFETY: Caller frees its unique owned handle exactly once.
        let mut bridge = unsafe { Box::from_raw(bridge as *mut Bridge) };
        let _ = bridge.stop.send(());
        if let Some(worker) = bridge.worker.take() {
            if let Err(error) = worker.join().unwrap_or_else(|_| Err("worker panic".into())) {
                eprintln!("Flubber bridge worker stopped: {error}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    #[test]
    fn csv_name_is_unique_and_header_is_exact() {
        let root = std::env::temp_dir().join(format!("flubber-bridge-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("source.mp4");
        let _first = open_csv(&path).unwrap();
        let _second = open_csv(&path).unwrap();
        let files: Vec<_> = std::fs::read_dir(&root).unwrap().collect();
        assert_eq!(files.len(), 2);
        for file in files {
            let file = file.unwrap().path();
            assert_eq!(
                std::fs::read_to_string(&file).unwrap(),
                "time_s,valence,arousal\n"
            );
            std::fs::remove_file(file).unwrap();
        }
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn selected_csv_is_same_folder_and_never_overwrites() {
        let root = std::env::temp_dir().join(format!("flubber-selected-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let media = root.join("source.mp4");
        let selected = root.join("session.csv");
        let _csv = open_selected_csv(&media, &selected).unwrap();
        assert!(open_selected_csv(&media, &selected).is_err());
        assert!(open_selected_csv(&media, &std::env::temp_dir().join("elsewhere.csv")).is_err());
        std::fs::remove_file(selected).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn live_bridge_emits_lsl_markers_and_video_csv() {
        use labstream::{Buffer, Inlet, Post, Query};
        let bridge = flubber_bridge_new();
        assert!(!bridge.is_null());
        let startup = Instant::now();
        while unsafe { flubber_bridge_status(bridge) } == 0
            && startup.elapsed() < Duration::from_secs(5)
        {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(unsafe { flubber_bridge_status(bridge) }, 1);
        let timeout = Duration::from_secs(3);
        let affect_info = labstream::resolve_first(&Query::name("VLC_Flubber_Affect"), timeout)
            .unwrap()
            .unwrap()
            .fetch(timeout)
            .unwrap();
        let marker_info = labstream::resolve_first(&Query::name("VLC_Flubber_Markers"), timeout)
            .unwrap()
            .unwrap()
            .fetch(timeout)
            .unwrap();
        let mut affect = Inlet::builder(&affect_info)
            .buffer(Buffer::Seconds(2.))
            .recover(false)
            .postprocess(Post::NONE)
            .open(timeout)
            .unwrap();
        let mut markers = Inlet::builder(&marker_info)
            .buffer(Buffer::Samples(16))
            .recover(false)
            .postprocess(Post::NONE)
            .open(timeout)
            .unwrap();
        let folder = std::env::temp_dir().join(format!("flubber-live-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let video = folder.join("clip.mp4");
        let path = CString::new(video.to_str().unwrap()).unwrap();
        let name = CString::new("clip.mp4").unwrap();
        let mut stamps = Vec::new();
        let start = Instant::now();
        let mut interrupted = false;
        while start.elapsed() < Duration::from_secs(2) {
            let media_ms = 40 + start.elapsed().as_millis() as i64;
            assert_eq!(
                unsafe {
                    flubber_bridge_update(
                        bridge,
                        0.25,
                        -0.5,
                        3,
                        media_ms,
                        name.as_ptr(),
                        path.as_ptr(),
                    )
                },
                0
            );
            if !interrupted && start.elapsed() >= Duration::from_secs(1) {
                assert_eq!(unsafe { flubber_bridge_interrupt(bridge) }, 0);
                interrupted = true;
            }
            if let Some((stamp, sample)) = affect.pull::<f32>(Duration::from_millis(40)).unwrap() {
                if sample == vec![0.25, -0.5] {
                    stamps.push(stamp);
                }
            }
        }
        assert!(stamps.len() >= 50, "only {} affect samples", stamps.len());
        let span = stamps.last().unwrap() - stamps.first().unwrap();
        let rate = (stamps.len() - 1) as f64 / span;
        assert!(
            (28.0..32.0).contains(&rate),
            "LSL sampling rate {rate:.2} Hz"
        );
        assert_eq!(
            unsafe {
                flubber_bridge_update(
                    bridge,
                    0.25,
                    -0.5,
                    0,
                    0,
                    name.as_ptr(),
                    CString::new("").unwrap().as_ptr(),
                )
            },
            0
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut labels = Vec::new();
        while Instant::now() < deadline && labels.len() < 3 {
            if let Some((_stamp, label)) = markers.pull_text(Duration::from_millis(100)).unwrap() {
                labels.push(label[0].clone());
            }
        }
        assert_eq!(
            labels,
            ["clip.mp4_Start", "clip.mp4_Interrupt", "clip.mp4_Stop"]
        );
        assert_eq!(unsafe { flubber_bridge_status(bridge) }, 1);
        unsafe { flubber_bridge_free(bridge) };
        let csv = std::fs::read_dir(&folder)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let data = std::fs::read_to_string(&csv).unwrap();
        assert!(data.starts_with("time_s,valence,arousal\n"));
        assert!(data.lines().count() >= 40);
        std::fs::remove_file(csv).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }
}

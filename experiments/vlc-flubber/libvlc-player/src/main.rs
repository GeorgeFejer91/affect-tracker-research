#![cfg(windows)]
#![deny(unsafe_op_in_unsafe_fn)]

use labstream::{Channel, Format, Outlet, StreamInfo};
use libloading::Library;
use serde::Deserialize;
use std::collections::VecDeque;
use std::env;
use std::ffi::{c_char, c_int, c_void, CString, OsStr};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::net::TcpListener;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{
    CloseHandle, HANDLE, HWND, LPARAM, LRESULT, POINT, RECT, WAIT_OBJECT_0, WPARAM,
};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, ClientToScreen, CreatePen, CreateSolidBrush, DeleteObject, Ellipse, EndPaint,
    GetMonitorInfoW, InvalidateRect, LineTo, MonitorFromWindow, MoveToEx, PatBlt, SelectObject,
    StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLACKNESS, DIB_RGB_COLORS, HDC,
    MONITORINFO, MONITOR_DEFAULTTONEAREST, PAINTSTRUCT, PS_SOLID, SRCCOPY,
};
use windows_sys::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, SetDllDirectoryW};
use windows_sys::Win32::System::Threading::{
    CreateWaitableTimerExW, GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation,
    SetWaitableTimer, WaitForSingleObject, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
    PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
    PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION, PROCESS_POWER_THROTTLING_STATE,
    TIMER_ALL_ACCESS,
};
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SetFocus, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RIGHT, VK_SPACE, VK_UP,
};
use windows_sys::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, MOUSE_MOVE_ABSOLUTE, RAWINPUT, RAWINPUTDEVICE,
    RAWINPUTHEADER, RIDEV_REMOVE, RID_INPUT, RIM_TYPEMOUSE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    ClipCursor, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect,
    GetForegroundWindow, GetMessageW, GetWindowLongPtrW, MoveWindow, PostMessageW, PostQuitMessage,
    RegisterClassW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowCursor, ShowWindow,
    TranslateMessage, CW_USEDEFAULT, GWLP_USERDATA, GWL_STYLE, MSG, SWP_FRAMECHANGED, SWP_NOZORDER,
    SWP_SHOWWINDOW, SW_HIDE, SW_SHOW, WM_ACTIVATEAPP, WM_APP, WM_CLOSE, WM_DESTROY, WM_INPUT,
    WM_KEYDOWN, WM_PAINT, WM_SIZE, WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_OVERLAPPEDWINDOW,
    WS_POPUP, WS_VISIBLE,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const RATE: Duration = Duration::from_nanos(33_333_333);
const POINTS: usize = 192;
const WAVES: usize = 16;
const WM_FLUBBER_TICK: u32 = WM_APP + 1;
const MAX_MOUSE_STEP: i32 = 150;

struct TimerResolution {
    policy_changed: bool,
}

impl TimerResolution {
    fn one_millisecond() -> Result<Self> {
        // SAFETY: This process requests the period for its two 30 Hz workers.
        if unsafe { timeBeginPeriod(1) } != 0 {
            return Err("Windows could not enable the 1 ms timer period".into());
        }
        // Windows 11 may ignore this request for an occluded window. Explicitly
        // keep the timer resolution while the always-on LSL outlet is live.
        let policy = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION
                | PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            StateMask: 0,
        };
        // SAFETY: This process owns the policy change and passes a fully
        // initialized structure of the documented size.
        let policy_changed = unsafe {
            SetProcessInformation(
                GetCurrentProcess(),
                ProcessPowerThrottling,
                (&policy as *const PROCESS_POWER_THROTTLING_STATE).cast(),
                std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
            ) != 0
        };
        if !policy_changed {
            eprintln!("Windows did not accept the timer resolution policy");
        }
        Ok(Self { policy_changed })
    }
}

impl Drop for TimerResolution {
    fn drop(&mut self) {
        if self.policy_changed {
            let reset = PROCESS_POWER_THROTTLING_STATE {
                Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask: 0,
                StateMask: 0,
            };
            // SAFETY: Restore the system-managed process policy before exit.
            unsafe {
                SetProcessInformation(
                    GetCurrentProcess(),
                    ProcessPowerThrottling,
                    (&reset as *const PROCESS_POWER_THROTTLING_STATE).cast(),
                    std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
                )
            };
        }
        // SAFETY: Pairs the successful request above on normal shutdown.
        unsafe { timeEndPeriod(1) };
    }
}

struct HighResTimer(HANDLE);

impl HighResTimer {
    fn new() -> Result<Self> {
        // SAFETY: The timer is unnamed, non-inheritable, and owned by this worker.
        let handle = unsafe {
            CreateWaitableTimerExW(
                null(),
                null(),
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                TIMER_ALL_ACCESS,
            )
        };
        if handle.is_null() {
            return Err("Could not create a high-resolution worker timer".into());
        }
        Ok(Self(handle))
    }

    fn wait_until(&self, target: Instant) -> Result<()> {
        let remaining = target.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(());
        }
        let ticks = (remaining.as_nanos() / 100).max(1).min(i64::MAX as u128) as i64;
        let relative_due_time = -ticks;
        // SAFETY: The handle remains live during the wait; negative due time
        // is relative and expressed in 100 ns units.
        if unsafe { SetWaitableTimer(self.0, &relative_due_time, 0, None, null(), 0) } == 0
            || unsafe { WaitForSingleObject(self.0, u32::MAX) } != WAIT_OBJECT_0
        {
            return Err("High-resolution worker timer failed".into());
        }
        Ok(())
    }
}

impl Drop for HighResTimer {
    fn drop(&mut self) {
        // SAFETY: Each worker owns exactly one timer handle.
        unsafe { CloseHandle(self.0) };
    }
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(std::iter::once(0)).collect()
}

fn win32_path(path: &Path) -> PathBuf {
    let path = path.to_string_lossy();
    if let Some(server_path) = path.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{server_path}"))
    } else {
        PathBuf::from(path.strip_prefix(r"\\?\").unwrap_or(&path))
    }
}

fn dll_function<T: Copy>(library: &Library, name: &[u8]) -> Result<T> {
    // SAFETY: The named VLC/resvg exports have the signatures declared below.
    Ok(unsafe { *library.get::<T>(name)? })
}

type LibvlcNew = unsafe extern "C" fn(c_int, *const *const c_char) -> *mut c_void;
type MediaNewPath = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void;
type PlayerNewFromMedia = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
type SetHwnd = unsafe extern "C" fn(*mut c_void, *mut c_void);
type PlayerPlay = unsafe extern "C" fn(*mut c_void) -> c_int;
type PlayerStop = unsafe extern "C" fn(*mut c_void);
type PlayerPause = unsafe extern "C" fn(*mut c_void, c_int);
type PlayerState = unsafe extern "C" fn(*mut c_void) -> c_int;
type PlayerTime = unsafe extern "C" fn(*mut c_void) -> i64;
type SetVolume = unsafe extern "C" fn(*mut c_void, c_int) -> c_int;
type Release = unsafe extern "C" fn(*mut c_void);

struct Vlc {
    _library: Library,
    instance: *mut c_void,
    media: *mut c_void,
    player: *mut c_void,
    media_new_path: MediaNewPath,
    player_new_from_media: PlayerNewFromMedia,
    set_hwnd: SetHwnd,
    play: PlayerPlay,
    stop: PlayerStop,
    set_pause: PlayerPause,
    state: PlayerState,
    time: PlayerTime,
    set_volume: SetVolume,
    release_player: Release,
    release_media: Release,
    release_instance: Release,
}

impl Vlc {
    fn new(directory: &Path) -> Result<Self> {
        let directory = win32_path(&fs::canonicalize(directory)?);
        let dll_path = directory.join("libvlc.dll");
        if !dll_path.is_file() || !directory.join("plugins").is_dir() {
            return Err("VLC directory must contain libvlc.dll and plugins".into());
        }
        // SAFETY: This process owns DLL search configuration before any VLC threads start.
        if unsafe { SetDllDirectoryW(wide(directory.as_os_str()).as_ptr()) } == 0 {
            return Err("Could not set VLC DLL directory".into());
        }
        env::set_var("VLC_PLUGIN_PATH", directory.join("plugins"));
        // SAFETY: This is the pinned VLC DLL in the explicitly selected directory.
        let library = unsafe { Library::new(dll_path)? };
        let new: LibvlcNew = dll_function(&library, b"libvlc_new\0")?;
        let media_new_path = dll_function(&library, b"libvlc_media_new_path\0")?;
        let player_new_from_media =
            dll_function(&library, b"libvlc_media_player_new_from_media\0")?;
        let set_hwnd = dll_function(&library, b"libvlc_media_player_set_hwnd\0")?;
        let play = dll_function(&library, b"libvlc_media_player_play\0")?;
        let stop = dll_function(&library, b"libvlc_media_player_stop\0")?;
        let set_pause = dll_function(&library, b"libvlc_media_player_set_pause\0")?;
        let state = dll_function(&library, b"libvlc_media_player_get_state\0")?;
        let time = dll_function(&library, b"libvlc_media_player_get_time\0")?;
        let set_volume = dll_function(&library, b"libvlc_audio_set_volume\0")?;
        let release_player = dll_function(&library, b"libvlc_media_player_release\0")?;
        let release_media = dll_function(&library, b"libvlc_media_release\0")?;
        let release_instance = dll_function(&library, b"libvlc_release\0")?;
        let mut options = vec![
            CString::new("--no-video-title-show")?,
            CString::new("--ignore-config")?,
            CString::new("--no-plugins-cache")?,
        ];
        if env::var_os("FLUBBER_DEBUG").is_some() {
            options.push(CString::new("--verbose=2")?);
        }
        let pointers: Vec<_> = options.iter().map(|option| option.as_ptr()).collect();
        // SAFETY: The argument storage remains alive during this constructor call.
        let instance = unsafe { new(pointers.len() as c_int, pointers.as_ptr()) };
        if instance.is_null() {
            return Err("LibVLC initialization failed".into());
        }
        Ok(Self {
            _library: library,
            instance,
            media: null_mut(),
            player: null_mut(),
            media_new_path,
            player_new_from_media,
            set_hwnd,
            play,
            stop,
            set_pause,
            state,
            time,
            set_volume,
            release_player,
            release_media,
            release_instance,
        })
    }

    fn open(&mut self, path: &Path, video_hwnd: HWND) -> Result<()> {
        self.close();
        let path = win32_path(&fs::canonicalize(path)?);
        let path = path.to_string_lossy();
        eprintln!("LibVLC media path: {path}");
        let path = CString::new(path.as_bytes())?;
        // SAFETY: The instance is live; the UTF-8 path remains alive for this call.
        self.media = unsafe { (self.media_new_path)(self.instance, path.as_ptr()) };
        if self.media.is_null() {
            return Err("LibVLC could not open the video path".into());
        }
        // SAFETY: The media is live until Vlc::drop.
        self.player = unsafe { (self.player_new_from_media)(self.media) };
        if self.player.is_null() {
            return Err("LibVLC could not create a video player".into());
        }
        // SAFETY: The child HWND stays alive until the player is stopped and released.
        unsafe { (self.set_hwnd)(self.player, video_hwnd) };
        // SAFETY: The player is live and has a valid child HWND.
        if unsafe { (self.play)(self.player) } != 0 {
            return Err("LibVLC could not start video playback".into());
        }
        Ok(())
    }

    fn state(&self) -> i32 {
        if self.player.is_null() {
            0
        } else {
            // SAFETY: The player is owned by this UI-thread Vlc object.
            unsafe { (self.state)(self.player) }
        }
    }

    fn time(&self) -> i64 {
        if self.player.is_null() {
            0
        } else {
            // SAFETY: The player is owned by this UI-thread Vlc object.
            unsafe { (self.time)(self.player) }.max(0)
        }
    }

    fn pause(&self, pause: bool) {
        if !self.player.is_null() {
            // SAFETY: The player is owned by this UI-thread Vlc object.
            unsafe { (self.set_pause)(self.player, i32::from(pause)) };
        }
    }

    fn stop(&self) {
        if !self.player.is_null() {
            // SAFETY: The player is owned by this UI-thread Vlc object.
            unsafe { (self.stop)(self.player) };
        }
    }

    fn volume(&self, percent: u32) -> Result<()> {
        if !self.player.is_null() {
            // SAFETY: The player is live and the bounded volume is in LibVLC's range.
            if unsafe { (self.set_volume)(self.player, percent.min(100) as c_int) } != 0 {
                return Err("LibVLC rejected the volume change".into());
            }
        }
        Ok(())
    }

    fn close(&mut self) {
        // SAFETY: This runs on the owning UI thread while the child HWND still
        // exists. Stop and release the player before the window is destroyed.
        unsafe {
            if !self.player.is_null() {
                (self.stop)(self.player);
                (self.release_player)(self.player);
                self.player = null_mut();
            }
            if !self.media.is_null() {
                (self.release_media)(self.media);
                self.media = null_mut();
            }
        }
    }
}

impl Drop for Vlc {
    fn drop(&mut self) {
        self.close();
        // SAFETY: The instance is owned by this UI-thread Vlc object.
        unsafe {
            (self.release_instance)(self.instance);
        }
    }
}

type RenderSvg = unsafe extern "C" fn(*const u8, usize, u32, u32, *mut u8, usize) -> i32;

struct Svg {
    _library: Library,
    render: RenderSvg,
}

impl Svg {
    fn new(path: &Path) -> Result<Self> {
        // SAFETY: The selected DLL exports the checked `flubber_svg_render` ABI.
        let library = unsafe { Library::new(path)? };
        let render = dll_function(&library, b"flubber_svg_render\0")?;
        Ok(Self {
            _library: library,
            render,
        })
    }

    fn render(&self, svg: &str, width: u32, height: u32, pixels: &mut [u8]) -> Result<()> {
        // SAFETY: `svg` and `pixels` are separate live Rust-owned buffers with
        // the exact lengths supplied here; the DLL renders synchronously.
        let result = unsafe {
            (self.render)(
                svg.as_ptr(),
                svg.len(),
                width,
                height,
                pixels.as_mut_ptr(),
                pixels.len(),
            )
        };
        if result != 0 {
            return Err("Native SVG rendering failed".into());
        }
        Ok(())
    }
}

#[derive(Default)]
struct Shared {
    valence: f32,
    arousal: f32,
    playing: bool,
}

fn apply_mouse_rating(shared: &mut Shared, dx: i32, dy: i32, client_height: i32) {
    // Match the reference task's 60%-of-screen travel and per-event step cap,
    // mapped onto this player's normalized [-1, 1] two-axis output.
    let full_scale = (client_height.max(1) as f32 * 0.6).max(1.0);
    let dx = dx.clamp(-MAX_MOUSE_STEP, MAX_MOUSE_STEP) as f32;
    let dy = dy.clamp(-MAX_MOUSE_STEP, MAX_MOUSE_STEP) as f32;
    shared.valence = (shared.valence + 2.0 * dx / full_scale).clamp(-1.0, 1.0);
    shared.arousal = (shared.arousal - 2.0 * dy / full_scale).clamp(-1.0, 1.0);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VideoMarker {
    Pause,
    Resume,
    Interrupt,
    BufferingStart,
    BufferingEnd,
    End,
    Error,
}

impl VideoMarker {
    fn suffix(self) -> &'static str {
        match self {
            Self::Pause => "Pause",
            Self::Resume => "Resume",
            Self::Interrupt => "Interrupt",
            Self::BufferingStart => "BufferingStart",
            Self::BufferingEnd => "BufferingEnd",
            Self::End => "End",
            Self::Error => "Error",
        }
    }
}

#[derive(Default)]
struct PlaybackEvents {
    paused: bool,
    buffering: bool,
    interrupted: bool,
}

impl PlaybackEvents {
    fn interrupt(&mut self) -> bool {
        if self.interrupted {
            false
        } else {
            self.interrupted = true;
            true
        }
    }

    fn observe(&mut self, state: i32, previous_state: i32) -> Vec<VideoMarker> {
        let mut events = Vec::new();
        if self.buffering && state != 2 {
            events.push(VideoMarker::BufferingEnd);
            self.buffering = false;
        }
        if state == 2 && !self.buffering {
            events.push(VideoMarker::BufferingStart);
            self.buffering = true;
        }
        if state == 4 && !self.paused {
            events.push(VideoMarker::Pause);
            self.paused = true;
        }
        if state == 3 && (self.paused || (self.interrupted && previous_state == 4)) {
            events.push(VideoMarker::Resume);
            self.paused = false;
            self.interrupted = false;
        }
        match state {
            6 => events.push(VideoMarker::End),
            7 => events.push(VideoMarker::Error),
            _ => {}
        }
        events
    }
}

enum SampleCommand {
    Start {
        media_ms: i64,
        observed_at: f64,
    },
    Marker {
        marker: VideoMarker,
        observed_at: f64,
    },
    Stop,
    Quit,
}

enum CsvCommand {
    Open {
        path: PathBuf,
        rows: Vec<(f64, [f32; 2])>,
    },
    Row(f64, [f32; 2]),
    Close,
    Quit,
}

enum RemoteCommand {
    Play,
    Pause,
    Stop,
    Volume(u32),
    Fullscreen,
    Quit,
}

fn remote_client(
    mut stream: std::net::TcpStream,
    commands: &mpsc::Sender<RemoteCommand>,
    shared: &Arc<Mutex<Shared>>,
) -> Result<()> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_millis(500)))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    let mut line = String::new();
    BufReader::new(&mut stream)
        .take(1024)
        .read_line(&mut line)?;
    match line.trim() {
        "is_playing" => {
            let playing = shared
                .lock()
                .map_err(|_| "Affect state lock poisoned")?
                .playing;
            stream.write_all(if playing { b"1\n" } else { b"0\n" })?;
        }
        "play" => commands.send(RemoteCommand::Play)?,
        "pause" => commands.send(RemoteCommand::Pause)?,
        "stop" => commands.send(RemoteCommand::Stop)?,
        "f on" => commands.send(RemoteCommand::Fullscreen)?,
        "quit" => commands.send(RemoteCommand::Quit)?,
        value if value.starts_with("volume ") => {
            let volume = value[7..].parse::<u32>()?;
            if volume > 256 {
                return Err("Volume is outside the RC range".into());
            }
            commands.send(RemoteCommand::Volume((volume * 100 + 128) / 256))?;
        }
        _ => return Err("Unknown local player command".into()),
    }
    Ok(())
}

fn remote_server(
    listener: TcpListener,
    commands: mpsc::Sender<RemoteCommand>,
    shared: Arc<Mutex<Shared>>,
    stop: Arc<AtomicBool>,
) -> Result<()> {
    listener.set_nonblocking(true)?;
    while !stop.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Err(error) = remote_client(stream, &commands, &shared) {
                    eprintln!("Ignored local player command: {error}");
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10))
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn csv_writer(commands: mpsc::Receiver<CsvCommand>) -> Result<()> {
    let mut recording: Option<BufWriter<File>> = None;
    for command in commands {
        match command {
            CsvCommand::Open { path, rows } => {
                if recording.is_some() {
                    return Err("CSV recording is already open".into());
                }
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut file = BufWriter::new(File::create_new(path)?);
                file.write_all(b"time_s,valence,arousal\n")?;
                for (time, values) in rows {
                    writeln!(file, "{time:.6},{:.6},{:.6}", values[0], values[1])?;
                }
                file.flush()?;
                recording = Some(file);
            }
            CsvCommand::Row(time, values) => {
                if let Some(file) = &mut recording {
                    writeln!(file, "{time:.6},{:.6},{:.6}", values[0], values[1])?;
                    file.flush()?;
                }
            }
            CsvCommand::Close => {
                if let Some(mut file) = recording.take() {
                    file.flush()?;
                }
            }
            CsvCommand::Quit => break,
        }
    }
    if let Some(mut file) = recording {
        file.flush()?;
    }
    Ok(())
}

fn sampler(
    shared: Arc<Mutex<Shared>>,
    commands: mpsc::Receiver<SampleCommand>,
    csv_commands: mpsc::SyncSender<CsvCommand>,
    ready: mpsc::Sender<std::result::Result<(), String>>,
    name: String,
    csv_path: Option<PathBuf>,
) -> Result<()> {
    let source = format!("vlc-flubber-{}", std::process::id());
    let state_info = StreamInfo::builder("VLC_Flubber_Affect", "Affect", Format::Float32)
        .rate(30.0)
        .source_id(&format!("{source}-affect"))
        .channels([
            Channel::new("valence").unit("normalized").kind("Affect"),
            Channel::new("arousal").unit("normalized").kind("Affect"),
        ])
        .build()?;
    let marker_info = StreamInfo::builder("VLC_Flubber_Markers", "Markers", Format::String)
        .irregular()
        .source_id(&format!("{source}-markers"))
        .channels([Channel::new("marker").kind("Markers")])
        .build()?;
    let affect = Outlet::new(state_info)?;
    let markers = Outlet::new(marker_info)?;
    ready.send(Ok(())).ok();
    let mut started = false;
    let mut recording_index = 0_u64;
    let mut samples = 0_u64;
    let mut recent = VecDeque::<(f64, [f32; 2])>::new();
    let mut origin = 0.0_f64;
    let mut pause_started = None::<f64>;
    let timer = HighResTimer::new()?;
    let mut next = Instant::now();
    loop {
        while let Ok(command) = commands.try_recv() {
            match command {
                SampleCommand::Start {
                    media_ms,
                    observed_at,
                } if !started => {
                    origin = observed_at - media_ms as f64 / 1000.0;
                    if let Some(path) = &csv_path {
                        recording_index += 1;
                        let path = if recording_index == 1 {
                            path.clone()
                        } else {
                            path.with_extension(format!("repeat{recording_index}.csv"))
                        };
                        let rows = recent
                            .iter()
                            .filter(|(stamp, _)| *stamp >= origin && *stamp <= observed_at)
                            .map(|(stamp, values)| (stamp - origin, *values))
                            .collect();
                        csv_commands.try_send(CsvCommand::Open { path, rows })?;
                    }
                    markers.push_text_at(&format!("{name}_Start"), origin)?;
                    recent.clear();
                    started = true;
                }
                SampleCommand::Stop if started => {
                    markers.push_text_at(&format!("{name}_Stop"), labstream::clock())?;
                    csv_commands.try_send(CsvCommand::Close)?;
                    started = false;
                }
                SampleCommand::Marker {
                    marker,
                    observed_at,
                } if started => {
                    markers.push_text_at(&format!("{name}_{}", marker.suffix()), observed_at)?;
                }
                SampleCommand::Quit => {
                    if started {
                        markers.push_text_at(&format!("{name}_Stop"), labstream::clock())?;
                    }
                    csv_commands.try_send(CsvCommand::Quit)?;
                    println!("Flubber LSL affect samples sent: {samples}");
                    return Ok(());
                }
                _ => {}
            }
        }
        let snapshot = shared.lock().map_err(|_| "Affect state lock poisoned")?;
        let values = [snapshot.valence, snapshot.arousal];
        let playing = snapshot.playing;
        drop(snapshot);
        let stamp = labstream::clock();
        if !started && playing {
            recent.push_back((stamp, values));
            while recent.front().is_some_and(|(old, _)| stamp - old > 5.0) {
                recent.pop_front();
            }
        } else if started && !playing {
            pause_started.get_or_insert(stamp);
        } else if started && playing {
            if let Some(paused_at) = pause_started.take() {
                origin += stamp - paused_at;
            }
            if csv_path.is_some() {
                csv_commands.try_send(CsvCommand::Row((stamp - origin).max(0.0), values))?;
            }
        }
        affect.push_at(&values, stamp)?;
        samples += 1;
        next += RATE;
        let now = Instant::now();
        if next > now {
            timer.wait_until(next)?;
        } else {
            next = now;
        }
    }
}

fn normalize(values: &mut [f64; POINTS]) {
    let low = values.iter().copied().fold(f64::INFINITY, f64::min);
    let high = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    for value in values {
        *value = (*value - low) / (high - low);
    }
}

struct Shape {
    rounded: [f64; POINTS],
    pointy: [f64; POINTS],
    phase_offset: [f64; WAVES],
    size_offset: [f64; WAVES],
}

impl Shape {
    fn new() -> Self {
        let mut rounded = [0.0; POINTS];
        let mut pointy = [0.0; POINTS];
        let mut phase_offset = [0.0; WAVES];
        let mut size_offset = [0.0; WAVES];
        for i in 0..POINTS {
            let theta = i as f64 * std::f64::consts::TAU / POINTS as f64;
            let distance = (i % (POINTS / WAVES)) as isize - (POINTS / WAVES / 2) as isize;
            rounded[i] = (WAVES as f64 * theta).cos();
            pointy[i] = (3.0 * std::f64::consts::PI / 4.0).sin()
                / (std::f64::consts::PI / 4.0
                    - 2.0 * std::f64::consts::PI * distance.abs() as f64 / POINTS as f64)
                    .sin();
        }
        normalize(&mut rounded);
        normalize(&mut pointy);
        for i in 0..WAVES {
            phase_offset[i] = std::f64::consts::PI * (12.9898 * (i + 1) as f64).sin();
            size_offset[i] = (78.233 * (i + 1) as f64).sin();
        }
        Self {
            rounded,
            pointy,
            phase_offset,
            size_offset,
        }
    }

    fn svg(
        &self,
        width: u32,
        height: u32,
        panel_width: u32,
        panel_height: u32,
        x: f64,
        y: f64,
        phase: f64,
    ) -> String {
        let radius = (panel_width as f64 * 0.15).min(panel_height as f64 * 0.38);
        let (cx, cy) = (width as f64 / 2.0, height as f64 / 2.0);
        let mix = (x + 1.0) / 2.0;
        let amplitude = 0.3 + 0.1 * y;
        let disorder = 0.4 * (1.0 - x);
        let scale = 0.9 + 0.1 * (0.5 + 0.5 * phase.sin());
        let anchors = [
            [255., 91., 104.],
            [93., 255., 176.],
            [255., 209., 102.],
            [92., 124., 250.],
        ];
        let weights = [(-x).max(0.0), x.max(0.0), y.max(0.0), (-y).max(0.0)];
        let total: f64 = weights.iter().sum();
        let saturation = x.hypot(y).clamp(0.0, 1.0);
        let mut color = [183_i32; 3];
        for channel in 0..3 {
            let directional = if total > 0.000001 {
                weights
                    .iter()
                    .enumerate()
                    .map(|(i, w)| w * anchors[i][channel])
                    .sum::<f64>()
                    / total
            } else {
                183.0
            };
            color[channel] = (183.0 + saturation * (directional - 183.0)).round() as i32;
        }
        use std::fmt::Write as _;
        let mut svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\"><rect width=\"100%\" height=\"100%\" fill=\"black\"/><path d=\""
        );
        for i in 0..POINTS {
            let wave_index = ((i + POINTS / WAVES / 2) / (POINTS / WAVES)) % WAVES;
            let theta = i as f64 * std::f64::consts::TAU / POINTS as f64;
            let profile = (1.0 - mix) * self.pointy[i] + mix * self.rounded[i];
            let wave = 0.5 + 0.5 * (phase + disorder * self.phase_offset[wave_index]).sin();
            let asymmetry = 1.0 + disorder * self.size_offset[wave_index];
            let r = radius * (1.0 + profile * amplitude * wave * asymmetry) * scale;
            let command = if i == 0 { 'M' } else { 'L' };
            write!(
                svg,
                "{command}{:.3} {:.3}",
                cx + r * theta.cos(),
                cy + r * theta.sin()
            )
            .unwrap();
        }
        write!(
            svg,
            "Z\" fill=\"rgb({},{},{})\" stroke=\"#f0f0f0\" stroke-width=\"1.5\"/></svg>",
            color[0], color[1], color[2]
        )
        .unwrap();
        svg
    }
}

#[derive(Default)]
struct Frame {
    width: i32,
    height: i32,
    pixels: Vec<u8>,
}

fn animate(
    svg_renderer: Svg,
    shape: Shape,
    shared: Arc<Mutex<Shared>>,
    panel_size: Arc<Mutex<(i32, i32)>>,
    frame: Arc<Mutex<Frame>>,
    pending: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    window_address: usize,
) -> Result<()> {
    let timer = HighResTimer::new()?;
    let mut next = Instant::now();
    let mut previous = next;
    let mut phase = 0.0;
    let mut frames = 0_u64;
    while !stop.load(Ordering::Acquire) {
        let now = Instant::now();
        let delta = now.duration_since(previous).as_secs_f64().min(0.2);
        previous = now;
        let (valence, arousal) = shared
            .lock()
            .map(|s| (s.valence, s.arousal))
            .map_err(|_| "Affect state lock poisoned")?;
        phase = (phase + std::f64::consts::TAU * (1.5 + arousal as f64) * delta)
            % std::f64::consts::TAU;
        let (panel_width, panel_height) = *panel_size
            .lock()
            .map_err(|_| "Flubber size lock poisoned")?;
        if panel_width > 0 && panel_height > 0 {
            let radius = (panel_width as f64 * 0.15).min(panel_height as f64 * 0.38);
            let width = ((radius * 2.6).ceil() as i32).clamp(1, panel_width) as u32;
            let height = ((radius * 2.6).ceil() as i32).clamp(1, panel_height) as u32;
            let bytes = (width as usize)
                .checked_mul(height as usize)
                .and_then(|n| n.checked_mul(4))
                .ok_or("Flubber surface overflow")?;
            if width > 8192 || height > 8192 || bytes > 64 * 1024 * 1024 {
                return Err("Flubber surface exceeds renderer limit".into());
            }
            let svg = shape.svg(
                width,
                height,
                panel_width as u32,
                panel_height as u32,
                valence as f64,
                arousal as f64,
                phase,
            );
            let mut pixels = vec![0_u8; bytes];
            svg_renderer.render(&svg, width, height, &mut pixels)?;
            for pixel in pixels.chunks_exact_mut(4) {
                pixel.swap(0, 2); // GDI BI_RGB expects BGRA, resvg returns RGBA.
            }
            {
                let mut latest = frame.lock().map_err(|_| "Flubber frame lock poisoned")?;
                *latest = Frame {
                    width: width as i32,
                    height: height as i32,
                    pixels,
                };
            }
            frames += 1;
            if !pending.swap(true, Ordering::AcqRel) {
                // SAFETY: Posting to the UI-owned HWND is safe while it is
                // live; a failed post during shutdown simply drops this frame.
                if unsafe { PostMessageW(window_address as HWND, WM_FLUBBER_TICK, 0, 0) } == 0 {
                    pending.store(false, Ordering::Release);
                }
            }
        }
        next += RATE;
        let now = Instant::now();
        if next > now {
            timer.wait_until(next)?;
        } else {
            next = now;
        }
    }
    println!("Flubber SVG frames rendered: {frames}");
    Ok(())
}

struct App {
    vlc: Vlc,
    armed_video: Option<PathBuf>,
    remote_commands: mpsc::Receiver<RemoteCommand>,
    volume_percent: u32,
    fullscreen: bool,
    exit_on_end: bool,
    shared: Arc<Mutex<Shared>>,
    frame: Arc<Mutex<Frame>>,
    panel_size: Arc<Mutex<(i32, i32)>>,
    commands: mpsc::Sender<SampleCommand>,
    video_hwnd: HWND,
    panel_width: i32,
    panel_height: i32,
    panel_top: i32,
    started: bool,
    last_state: i32,
    events: PlaybackEvents,
    mouse_active: bool,
    skip_next_mouse: bool,
    cursor_hide_calls: u32,
    panel_percent: u32,
    step: f32,
    close_at: Option<Instant>,
    ticks: u64,
    tick_pending: Arc<AtomicBool>,
    tick_stop: Arc<AtomicBool>,
    worker_failed: Arc<AtomicBool>,
}

impl App {
    fn marker(&self, marker: VideoMarker) {
        if self
            .commands
            .send(SampleCommand::Marker {
                marker,
                observed_at: labstream::clock(),
            })
            .is_err()
        {
            self.worker_failed.store(true, Ordering::Release);
        }
    }

    fn clip_mouse(hwnd: HWND) -> bool {
        let mut client = RECT::default();
        let mut top_left = POINT::default();
        // SAFETY: All coordinates refer to the live top-level player HWND.
        if unsafe { GetClientRect(hwnd, &mut client) } == 0
            || unsafe { ClientToScreen(hwnd, &mut top_left) } == 0
        {
            return false;
        }
        let mut bottom_right = POINT {
            x: client.right,
            y: client.bottom,
        };
        // SAFETY: ClipCursor receives a fully initialized screen-space rectangle.
        if unsafe { ClientToScreen(hwnd, &mut bottom_right) } == 0 {
            return false;
        }
        let screen = RECT {
            left: top_left.x,
            top: top_left.y,
            right: bottom_right.x,
            bottom: bottom_right.y,
        };
        unsafe { ClipCursor(&screen) != 0 }
    }

    fn capture_mouse(&mut self, hwnd: HWND) -> Result<()> {
        // Raw input is registered only for this window and only used while it
        // owns foreground focus. No background mouse movement is collected.
        if self.mouse_active || unsafe { GetForegroundWindow() } != hwnd {
            return Ok(());
        }
        if !Self::clip_mouse(hwnd) {
            return Err("Could not confine the rating pointer to the player".into());
        }
        self.cursor_hide_calls = 0;
        loop {
            // SAFETY: Balanced by the same number of ShowCursor(TRUE) calls in
            // release_mouse, including on focus loss and window destruction.
            let count = unsafe { ShowCursor(0) };
            self.cursor_hide_calls += 1;
            if count < 0 {
                break;
            }
            if self.cursor_hide_calls == 32 {
                self.release_mouse();
                return Err("Could not hide the rating pointer".into());
            }
        }
        self.mouse_active = true;
        self.skip_next_mouse = true;
        Ok(())
    }

    fn release_mouse(&mut self) {
        if self.cursor_hide_calls == 0 && !self.mouse_active {
            return;
        }
        // SAFETY: Release any global clip before the application loses focus.
        unsafe { ClipCursor(null()) };
        for _ in 0..self.cursor_hide_calls {
            // SAFETY: Each call balances one ShowCursor(FALSE) above.
            unsafe { ShowCursor(1) };
        }
        self.cursor_hide_calls = 0;
        self.mouse_active = false;
        self.skip_next_mouse = true;
    }

    fn interrupt(&mut self) {
        let was_rating = self.mouse_active;
        self.release_mouse();
        if was_rating
            && self.started
            && matches!(self.vlc.state(), 2 | 3)
            && self.events.interrupt()
        {
            self.marker(VideoMarker::Interrupt);
            self.vlc.pause(true);
        }
    }

    fn mouse(&mut self, raw_handle: LPARAM) {
        if !self.mouse_active || !self.started || self.vlc.state() != 3 {
            return;
        }
        let mut raw = RAWINPUT::default();
        let mut size = std::mem::size_of::<RAWINPUT>() as u32;
        // SAFETY: WM_INPUT's handle is valid during this callback; the stack
        // buffer is aligned for RAWINPUT and its declared size is exact.
        let read = unsafe {
            GetRawInputData(
                raw_handle as _,
                RID_INPUT,
                (&mut raw as *mut RAWINPUT).cast(),
                &mut size,
                std::mem::size_of::<RAWINPUTHEADER>() as u32,
            )
        };
        if read != std::mem::size_of::<RAWINPUT>() as u32 || raw.header.dwType != RIM_TYPEMOUSE {
            return;
        }
        // SAFETY: dwType identifies the active RAWINPUT union member as mouse.
        let mouse = unsafe { raw.data.mouse };
        if mouse.usFlags & MOUSE_MOVE_ABSOLUTE != 0 {
            return;
        }
        if self.skip_next_mouse {
            self.skip_next_mouse = false;
            return;
        }
        let mut shared = match self.shared.lock() {
            Ok(shared) => shared,
            Err(_) => {
                self.worker_failed.store(true, Ordering::Release);
                return;
            }
        };
        apply_mouse_rating(
            &mut shared,
            mouse.lLastX,
            mouse.lLastY,
            self.panel_top + self.panel_height,
        );
    }

    fn layout(&mut self, hwnd: HWND) {
        let mut rect = RECT::default();
        // SAFETY: `hwnd` is the live main window on its UI thread.
        unsafe { GetClientRect(hwnd, &mut rect) };
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        let video_height = height * 100 / (100 + self.panel_percent as i32);
        self.panel_width = width;
        self.panel_top = video_height;
        self.panel_height = height - video_height;
        if let Ok(mut size) = self.panel_size.lock() {
            *size = (width, self.panel_height);
        }
        // SAFETY: The child window belongs to the same thread and parent.
        unsafe { MoveWindow(self.video_hwnd, 0, 0, width, video_height, 1) };
        if self.mouse_active && !Self::clip_mouse(hwnd) {
            self.release_mouse();
            self.worker_failed.store(true, Ordering::Release);
        }
        // SAFETY: Requests a repaint of only our parent surface.
        unsafe { InvalidateRect(hwnd, null(), 0) };
    }

    fn tick(&mut self, hwnd: HWND) {
        if self.worker_failed.load(Ordering::Acquire) {
            self.vlc.stop();
            // SAFETY: A failed LSL/CSV writer must stop this experiment window.
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
            return;
        }
        if self
            .close_at
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            // SAFETY: Exit is posted to this window's own message loop.
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
            return;
        }
        // LibVLC and SetWindowPos may synchronously send window messages. Hide
        // the non-owning callback pointer while this mutable UI state is used.
        unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
        let mut quit_requested = false;
        let mut command_error = None;
        while let Ok(command) = self.remote_commands.try_recv() {
            let result = match command {
                RemoteCommand::Play => {
                    if let Some(path) = self.armed_video.clone() {
                        self.release_mouse();
                        if self.started {
                            self.commands.send(SampleCommand::Stop).ok();
                            self.started = false;
                        }
                        self.last_state = -1;
                        self.events = PlaybackEvents::default();
                        self.vlc
                            .open(&path, self.video_hwnd)
                            .and_then(|()| self.vlc.volume(self.volume_percent))
                            .map(|()| {
                                // Best effort: Recorder can issue Play while its
                                // separate experimenter window has focus.
                                unsafe { SetForegroundWindow(hwnd) };
                            })
                    } else {
                        Err("No video was armed".into())
                    }
                }
                RemoteCommand::Pause => {
                    let resume = self.vlc.state() != 3;
                    if resume {
                        unsafe { SetForegroundWindow(hwnd) };
                    }
                    self.vlc.pause(!resume);
                    Ok(())
                }
                RemoteCommand::Stop => {
                    self.vlc.stop();
                    Ok(())
                }
                RemoteCommand::Volume(percent) => {
                    self.volume_percent = percent;
                    self.vlc.volume(percent)
                }
                RemoteCommand::Fullscreen => {
                    self.fullscreen(hwnd);
                    Ok(())
                }
                RemoteCommand::Quit => {
                    quit_requested = true;
                    break;
                }
            };
            if let Err(error) = result {
                command_error = Some(error);
                break;
            }
        }
        unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, self as *mut App as isize) };
        if let Some(error) = command_error {
            eprintln!("Player command failed: {error}");
            self.worker_failed.store(true, Ordering::Release);
            return;
        }
        if quit_requested {
            // SAFETY: Request shutdown through the owning UI message loop.
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
            return;
        }
        let state = self.vlc.state();
        let previous_state = self.last_state;
        self.ticks += 1;
        if self.close_at.is_some() && self.ticks % 30 == 0 {
            eprintln!(
                "UI ticks: {}, LibVLC state: {state}, video time: {} ms",
                self.ticks,
                self.vlc.time()
            );
        }
        if state != self.last_state {
            eprintln!("LibVLC state: {state}, video time: {} ms", self.vlc.time());
            self.last_state = state;
        }
        let video_ms = self.vlc.time();
        let playing = state == 3;
        if playing && video_ms > 0 && !self.started {
            self.started = true;
            self.commands
                .send(SampleCommand::Start {
                    media_ms: video_ms,
                    observed_at: labstream::clock(),
                })
                .ok();
        }
        if self.started {
            for marker in self.events.observe(state, previous_state) {
                self.marker(marker);
            }
            if matches!(state, 5..=7) {
                self.started = false;
                self.commands.send(SampleCommand::Stop).ok();
            }
        }
        if playing && self.started {
            if unsafe { GetForegroundWindow() } != hwnd {
                self.interrupt();
            } else if let Err(error) = self.capture_mouse(hwnd) {
                eprintln!("Mouse rating capture failed: {error}");
                self.worker_failed.store(true, Ordering::Release);
            }
        } else {
            self.release_mouse();
        }
        if let Ok(mut shared) = self.shared.lock() {
            shared.playing = playing;
        }
        if self.exit_on_end && state == 6 {
            // SAFETY: A waited playback ends after its natural end marker.
            unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
        }
        // SAFETY: The HWND is live; WM_PAINT displays the latest worker frame.
        unsafe { InvalidateRect(hwnd, null(), 0) };
    }

    fn fullscreen(&mut self, hwnd: HWND) {
        if self.fullscreen {
            return;
        }
        // SAFETY: The main HWND is live on this UI thread. The monitor bounds
        // are queried before changing the host window style and position.
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if monitor.is_null() || GetMonitorInfoW(monitor, &mut info) == 0 {
                return;
            }
            let rect = info.rcMonitor;
            SetWindowLongPtrW(
                hwnd,
                GWL_STYLE,
                (WS_POPUP | WS_VISIBLE | WS_CLIPCHILDREN) as isize,
            );
            if SetWindowPos(
                hwnd,
                null_mut(),
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
                SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            ) != 0
            {
                self.fullscreen = true;
                self.layout(hwnd);
            }
        }
    }

    fn paint(&self, hwnd: HWND) {
        let mut paint = PAINTSTRUCT::default();
        // SAFETY: Standard BeginPaint/EndPaint pair on this UI thread.
        let dc = unsafe { BeginPaint(hwnd, &mut paint) };
        // SAFETY: Fill the allocated lower panel, leaving child video pixels untouched.
        unsafe {
            PatBlt(
                dc,
                0,
                self.panel_top,
                self.panel_width,
                self.panel_height,
                BLACKNESS,
            )
        };
        if let Ok(frame) = self.frame.lock() {
            if !frame.pixels.is_empty() && self.panel_width > 0 && self.panel_height > 0 {
                let info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: frame.width,
                        biHeight: -frame.height,
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB,
                        biSizeImage: 0,
                        biXPelsPerMeter: 0,
                        biYPelsPerMeter: 0,
                        biClrUsed: 0,
                        biClrImportant: 0,
                    },
                    bmiColors: [Default::default()],
                };
                // SAFETY: The bitmap dimensions and pointer match `frame.pixels`;
                // the lock prevents mutation throughout the synchronous GDI call.
                unsafe {
                    StretchDIBits(
                        dc,
                        (self.panel_width - frame.width) / 2,
                        self.panel_top + (self.panel_height - frame.height) / 2,
                        frame.width,
                        frame.height,
                        0,
                        0,
                        frame.width,
                        frame.height,
                        frame.pixels.as_ptr().cast(),
                        &info,
                        DIB_RGB_COLORS,
                        SRCCOPY,
                    );
                }
            }
        }
        self.paint_rating(dc);
        // SAFETY: Closes the paint operation opened above.
        unsafe { EndPaint(hwnd, &paint) };
    }

    fn paint_rating(&self, dc: HDC) {
        let side = (self.panel_height - 24).min(self.panel_width / 4).min(160);
        if side < 48 {
            return;
        }
        let (valence, arousal) = match self.shared.lock() {
            Ok(shared) => (shared.valence, shared.arousal),
            Err(_) => return,
        };
        let left = self.panel_width - side - 20;
        let top = self.panel_top + (self.panel_height - side) / 2;
        // SAFETY: The objects are selected only into this BeginPaint DC and
        // restored before deletion; all coordinates are within the panel.
        unsafe {
            let pen = CreatePen(PS_SOLID, 1, 0x0080_8080);
            if pen.is_null() {
                return;
            }
            let old_pen = SelectObject(dc, pen);
            for (x1, y1, x2, y2) in [
                (left, top, left + side, top),
                (left + side, top, left + side, top + side),
                (left + side, top + side, left, top + side),
                (left, top + side, left, top),
                (left + side / 2, top, left + side / 2, top + side),
                (left, top + side / 2, left + side, top + side / 2),
            ] {
                MoveToEx(dc, x1, y1, null_mut());
                LineTo(dc, x2, y2);
            }
            let x = left + ((valence + 1.0) * side as f32 / 2.0).round() as i32;
            let y = top + ((1.0 - arousal) * side as f32 / 2.0).round() as i32;
            let brush = CreateSolidBrush(0x00f0_f0f0);
            if !brush.is_null() {
                let old_brush = SelectObject(dc, brush);
                Ellipse(dc, x - 5, y - 5, x + 6, y + 6);
                SelectObject(dc, old_brush);
                DeleteObject(brush);
            }
            SelectObject(dc, old_pen);
            DeleteObject(pen);
        }
    }

    fn key(&mut self, key: u32) {
        let mut shared = match self.shared.lock() {
            Ok(shared) => shared,
            Err(_) => return,
        };
        match key as u16 {
            VK_LEFT => shared.valence = (shared.valence - self.step).max(-1.0),
            VK_RIGHT => shared.valence = (shared.valence + self.step).min(1.0),
            VK_UP => shared.arousal = (shared.arousal + self.step).min(1.0),
            VK_DOWN => shared.arousal = (shared.arousal - self.step).max(-1.0),
            VK_SPACE => self.vlc.pause(self.vlc.state() == 3),
            VK_ESCAPE => self.vlc.stop(),
            _ => {}
        }
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // SAFETY: The pointer is installed after CreateWindowExW and remains owned
    // by main until its GetMessage loop finishes. Callbacks run on that thread.
    let pointer = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut App;
    if !pointer.is_null() {
        // SAFETY: See the ownership invariant above.
        let app = unsafe { &mut *pointer };
        match message {
            WM_CLOSE => {
                // SAFETY: LibVLC close and window destruction may reenter this
                // procedure; nested messages must not alias `app`.
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
                app.tick_stop.store(true, Ordering::Release);
                app.release_mouse();
                if let Ok(mut shared) = app.shared.lock() {
                    shared.playing = false;
                }
                if app.started {
                    app.commands.send(SampleCommand::Stop).ok();
                    app.started = false;
                }
                app.vlc.close();
                // SAFETY: Player is released before its HWND is destroyed.
                unsafe { DestroyWindow(hwnd) };
                return 0;
            }
            WM_SIZE => {
                app.layout(hwnd);
                return 0;
            }
            WM_FLUBBER_TICK => {
                app.tick(hwnd);
                app.tick_pending.store(false, Ordering::Release);
                return 0;
            }
            WM_PAINT => {
                app.paint(hwnd);
                return 0;
            }
            WM_KEYDOWN => {
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
                app.key(wparam as u32);
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, pointer as isize) };
                return 0;
            }
            WM_ACTIVATEAPP if wparam == 0 => {
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
                app.interrupt();
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, pointer as isize) };
                return 0;
            }
            WM_INPUT => {
                app.mouse(lparam);
                // Foreground raw input must reach DefWindowProc for cleanup.
            }
            WM_DESTROY => {
                // SAFETY: Stop nested callbacks before releasing native VLC.
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
                app.tick_stop.store(true, Ordering::Release);
                app.release_mouse();
                app.vlc.close();
            }
            _ => {}
        }
    }
    if message == WM_DESTROY {
        // SAFETY: Normal exit from this window's UI message loop.
        unsafe { PostQuitMessage(0) };
        return 0;
    }
    // SAFETY: Unhandled messages use the default Win32 window procedure.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

struct Args {
    video: Option<PathBuf>,
    csv: Option<PathBuf>,
    arm: bool,
    wait: bool,
    headless: bool,
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Preset {
    schema: String,
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
}

fn ensure_preset_folder(root: &Path) -> Result<PathBuf> {
    let folder = root.join("presets");
    fs::create_dir_all(&folder)?;
    let default = folder.join("default.flubber.json");
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(default)
    {
        Ok(mut file) => file.write_all(
            b"{\"schema\":\"vlc-flubber-sidequest/v1\",\"panelPercent\":25,\"stepPercent\":10}\n",
        )?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.into()),
    }
    Ok(folder)
}

fn preset_settings(video: &Path, folder: &Path) -> Result<(Option<u32>, Option<u32>)> {
    let stem = video.file_stem().ok_or("Video filename has no stem")?;
    let candidates = [
        video.with_extension("flubber.json"),
        folder.join(stem).with_extension("flubber.json"),
        folder.join("default.flubber.json"),
    ];
    for path in candidates {
        if path.is_file() {
            if fs::metadata(&path)?.len() > 64 * 1024 {
                return Err(format!("Flubber preset exceeds 64 KiB: {}", path.display()).into());
            }
            let settings: Preset = serde_json::from_slice(&fs::read(&path)?)?;
            if settings.schema != "vlc-flubber-sidequest/v1" {
                return Err(format!("Unsupported Flubber preset: {}", path.display()).into());
            }
            return Ok((settings.panel_percent, settings.step_percent));
        }
    }
    Ok((None, None))
}

impl Args {
    fn parse() -> Result<Self> {
        let mut args = env::args_os().skip(1);
        let mut parsed = Self {
            video: None,
            csv: None,
            arm: false,
            wait: false,
            headless: false,
            panel_percent: None,
            step_percent: None,
        };
        while let Some(arg) = args.next() {
            match arg.to_str() {
                Some("--arm") => parsed.arm = true,
                Some("--wait") => parsed.wait = true,
                Some("--headless") => parsed.headless = true,
                Some("--panel-percent") => {
                    parsed.panel_percent = Some(
                        args.next()
                            .ok_or("--panel-percent needs a value")?
                            .to_string_lossy()
                            .parse()?,
                    );
                }
                Some("--step-percent") => {
                    parsed.step_percent = Some(
                        args.next()
                            .ok_or("--step-percent needs a value")?
                            .to_string_lossy()
                            .parse()?,
                    );
                }
                Some("--help" | "-h") => {
                    println!("FlubberVLC [VIDEO] [CSV-in-video-folder] [--arm] [--wait] [--panel-percent 25] [--step-percent 10]");
                    std::process::exit(0);
                }
                Some(flag) if flag.starts_with('-') => {
                    return Err(format!("Unknown option: {flag}").into())
                }
                _ if parsed.video.is_none() => parsed.video = Some(PathBuf::from(arg)),
                _ if parsed.csv.is_none() => parsed.csv = Some(PathBuf::from(arg)),
                _ => return Err("Too many positional paths".into()),
            }
        }
        if parsed
            .panel_percent
            .is_some_and(|value| !(10..=100).contains(&value))
            || parsed
                .step_percent
                .is_some_and(|value| !(1..=100).contains(&value))
        {
            return Err("Flubber panel must be 10–100%, and step must be 1–100%".into());
        }
        if parsed.arm && (parsed.video.is_none() || parsed.wait) {
            return Err("--arm requires a video and cannot be combined with --wait".into());
        }
        if parsed.wait && parsed.video.is_none() {
            return Err("--wait requires a video".into());
        }
        if parsed.headless && parsed.video.is_some() {
            return Err("Hidden LibVLC video output is unsupported; run the player visibly".into());
        }
        if let Some(video) = &parsed.video {
            parsed.video = Some(fs::canonicalize(video)?);
        }
        Ok(parsed)
    }
}

fn run() -> Result<()> {
    let args = Args::parse()?;
    let _timer_resolution = TimerResolution::one_millisecond()?;
    let video = args.video.clone();
    let shared_data_root =
        PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player");
    let preset_folder = ensure_preset_folder(&shared_data_root)?;
    let (preset_panel, preset_step) = video
        .as_ref()
        .map(|path| preset_settings(path, &preset_folder))
        .transpose()?
        .unwrap_or((None, None));
    let panel_percent = args.panel_percent.or(preset_panel).unwrap_or(25);
    let step_percent = args.step_percent.or(preset_step).unwrap_or(10);
    if !(10..=100).contains(&panel_percent) || !(1..=100).contains(&step_percent) {
        return Err("Flubber panel must be 10–100%, and step must be 1–100%".into());
    }
    let csv_path = video
        .as_ref()
        .map(|video| -> Result<PathBuf> {
            let folder = video.parent().ok_or("Video has no parent folder")?;
            if let Some(csv) = args.csv.as_ref() {
                let path = if csv.is_absolute() {
                    csv.clone()
                } else {
                    folder.join(csv)
                };
                if path
                    .parent()
                    .ok_or("CSV has no parent folder")?
                    .canonicalize()?
                    != folder
                {
                    return Err("Affect CSV must be beside the played video".into());
                }
                Ok(path)
            } else {
                let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
                let stem: String = video
                    .file_stem()
                    .ok_or("Video has no filename stem")?
                    .to_string_lossy()
                    .chars()
                    .take(80)
                    .collect();
                Ok(folder.join(format!("{stem}-flubber-{stamp}-{}.csv", std::process::id())))
            }
        })
        .transpose()?;
    let readiness_csv = csv_path.clone();
    let listener = if args.arm {
        Some(TcpListener::bind("127.0.0.1:0")?)
    } else {
        None
    };
    let rc_port = listener
        .as_ref()
        .map(|listener| listener.local_addr().map(|address| address.port()))
        .transpose()?;
    let executable = env::current_exe()?;
    let base = executable.parent().ok_or("Executable has no parent")?;
    let vlc_dir = env::var_os("FLUBBER_VLC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("vlc"));
    let svg_path = env::var_os("FLUBBER_SVG_DLL")
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("svg/flubber_svg.dll"));
    let test_exit_after = env::var("FLUBBER_TEST_EXIT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|millis| (1000..=30_000).contains(millis))
        .map(Duration::from_millis);
    let test_hidden = env::var_os("FLUBBER_TEST_HIDDEN").is_some();
    let name = video
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".into());
    let shared = Arc::new(Mutex::new(Shared::default()));
    let frame = Arc::new(Mutex::new(Frame::default()));
    let panel_size = Arc::new(Mutex::new((0, 0)));
    let worker_failed = Arc::new(AtomicBool::new(false));
    let (command_tx, command_rx) = mpsc::channel();
    let (remote_tx, remote_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (csv_tx, csv_rx) = mpsc::sync_channel(64);
    let csv_failure = Arc::clone(&worker_failed);
    let csv_worker = thread::spawn(move || {
        let result = csv_writer(csv_rx);
        if result.is_err() {
            csv_failure.store(true, Ordering::Release);
        }
        result
    });
    let worker_shared = Arc::clone(&shared);
    let lsl_failure = Arc::clone(&worker_failed);
    let worker = thread::spawn(move || {
        let result = sampler(worker_shared, command_rx, csv_tx, ready_tx, name, csv_path);
        if result.is_err() {
            lsl_failure.store(true, Ordering::Release);
        }
        result
    });
    ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "LSL outlet startup timed out")??;
    if !args.arm {
        println!("Flubber LSL outlets online at 30 Hz");
    }

    // SAFETY: Set once, before any Win32 window is created, so pixels map to
    // physical display pixels including on high-DPI monitors.
    unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let svg_renderer = Svg::new(&svg_path)?;
    let mut app = Box::new(App {
        vlc: Vlc::new(&vlc_dir)?,
        armed_video: video.clone(),
        remote_commands: remote_rx,
        volume_percent: 100,
        fullscreen: false,
        exit_on_end: args.wait,
        shared: Arc::clone(&shared),
        frame: Arc::clone(&frame),
        panel_size: Arc::clone(&panel_size),
        commands: command_tx.clone(),
        video_hwnd: null_mut(),
        panel_width: 0,
        panel_height: 0,
        panel_top: 0,
        started: false,
        last_state: -1,
        events: PlaybackEvents::default(),
        mouse_active: false,
        skip_next_mouse: true,
        cursor_hide_calls: 0,
        panel_percent,
        step: step_percent as f32 / 100.0,
        close_at: None,
        ticks: 0,
        tick_pending: Arc::new(AtomicBool::new(false)),
        tick_stop: Arc::new(AtomicBool::new(false)),
        worker_failed,
    });
    let class = wide(OsStr::new("FlubberLibVlcPrototype"));
    let title = wide(OsStr::new("Flubber VLC Player"));
    let static_class = wide(OsStr::new("STATIC"));
    // SAFETY: The module handle and class strings remain valid for registration.
    let instance = unsafe { GetModuleHandleW(null()) };
    let window_class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: instance,
        lpszClassName: class.as_ptr(),
        ..Default::default()
    };
    // SAFETY: The class callback is valid for the process lifetime.
    if unsafe { RegisterClassW(&window_class) } == 0 {
        return Err("Could not register the player window class".into());
    }
    // SAFETY: Creates the owned top-level window on this UI thread.
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            1280,
            900,
            null_mut(),
            null_mut(),
            instance,
            null(),
        )
    };
    if hwnd.is_null() {
        return Err("Could not create the player window".into());
    }
    // SAFETY: Creates the video child inside the top-level window.
    let video_hwnd = unsafe {
        CreateWindowExW(
            0,
            static_class.as_ptr(),
            null(),
            WS_CHILD | WS_VISIBLE,
            0,
            0,
            1280,
            720,
            hwnd,
            null_mut(),
            instance,
            null(),
        )
    };
    if video_hwnd.is_null() {
        // SAFETY: A failed child creation leaves a live parent to destroy.
        unsafe { DestroyWindow(hwnd) };
        return Err("Could not create the video surface".into());
    }
    app.video_hwnd = video_hwnd;
    let mouse_device = RAWINPUTDEVICE {
        usUsagePage: 1,
        usUsage: 2,
        dwFlags: 0,
        hwndTarget: hwnd,
    };
    // SAFETY: This process registers only the generic mouse for its own
    // foreground player window; no background-input flag is requested.
    if unsafe {
        RegisterRawInputDevices(
            &mouse_device,
            1,
            std::mem::size_of::<RAWINPUTDEVICE>() as u32,
        )
    } == 0
    {
        unsafe { DestroyWindow(hwnd) };
        command_tx.send(SampleCommand::Quit).ok();
        worker.join().map_err(|_| "LSL worker panicked")??;
        csv_worker.join().map_err(|_| "CSV worker panicked")??;
        return Err("Could not register the rating mouse".into());
    }
    // SAFETY: `app` remains boxed at a stable address until the message loop ends.
    unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, (&mut *app as *mut App) as isize) };
    app.layout(hwnd);
    // The video child must be visible before LibVLC creates its native vout.
    unsafe {
        ShowWindow(
            hwnd,
            if test_hidden || args.headless {
                SW_HIDE
            } else {
                SW_SHOW
            },
        )
    };
    if let Some(video) = video.as_ref().filter(|_| !args.arm) {
        if let Err(error) = app.vlc.open(&video, video_hwnd) {
            app.vlc.close();
            // SAFETY: No animation thread exists yet; clear callback ownership
            // and destroy both windows before returning the open error.
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                DestroyWindow(hwnd);
            }
            command_tx.send(SampleCommand::Quit).ok();
            let lsl_result = worker.join().map_err(|_| "LSL worker panicked")?;
            let csv_result = csv_worker.join().map_err(|_| "CSV worker panicked")?;
            lsl_result?;
            csv_result?;
            return Err(error);
        }
    }
    app.close_at = test_exit_after.map(|delay| Instant::now() + delay);
    // SAFETY: The visible player is the participant's active rating surface.
    // SetFocus alone cannot activate a new top-level process window.
    if !test_hidden {
        unsafe { SetForegroundWindow(hwnd) };
    }
    unsafe { SetFocus(hwnd) };
    let pending = Arc::clone(&app.tick_pending);
    let stop = Arc::clone(&app.tick_stop);
    let animation_failure = Arc::clone(&app.worker_failed);
    let window_address = hwnd as usize;
    let animation = thread::spawn(move || {
        let result = animate(
            svg_renderer,
            Shape::new(),
            shared,
            panel_size,
            frame,
            pending,
            stop,
            window_address,
        );
        if result.is_err() {
            animation_failure.store(true, Ordering::Release);
            // SAFETY: Wake the UI so a failed renderer stops playback even if
            // it can no longer produce animation ticks.
            unsafe { PostMessageW(window_address as HWND, WM_FLUBBER_TICK, 0, 0) };
        }
        result
    });
    let server = listener.map(|listener| {
        let shared = Arc::clone(&app.shared);
        let stop = Arc::clone(&app.tick_stop);
        let failed = Arc::clone(&app.worker_failed);
        thread::spawn(move || {
            let result = remote_server(listener, remote_tx, shared, stop);
            if result.is_err() {
                failed.store(true, Ordering::Release);
            }
            result
        })
    });
    if args.arm {
        let source = video.as_ref().ok_or("Armed video missing")?;
        let csv = readiness_csv.as_ref().ok_or("Armed CSV missing")?;
        println!("VLC PID: {}", std::process::id());
        println!(
            "VLC RC: 127.0.0.1:{}",
            rc_port.ok_or("Local control port missing")?
        );
        println!("Source video: {}", source.display());
        println!("Affect CSV: {}", csv.display());
        println!("Affect time-series CSV: {}", csv.display());
        println!("Flubber LSL outlets are online; playback is waiting for a play command.");
        std::io::stdout().flush()?;
    }
    let mut message = MSG::default();
    // SAFETY: Ordinary single-threaded Win32 message loop for owned window.
    while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    let mouse_device = RAWINPUTDEVICE {
        dwFlags: RIDEV_REMOVE,
        hwndTarget: null_mut(),
        ..mouse_device
    };
    // SAFETY: Unregister the same mouse collection after the owned HWND exits.
    unsafe {
        RegisterRawInputDevices(
            &mouse_device,
            1,
            std::mem::size_of::<RAWINPUTDEVICE>() as u32,
        )
    };
    app.tick_stop.store(true, Ordering::Release);
    animation
        .join()
        .map_err(|_| "Flubber animation clock panicked")??;
    if let Some(server) = server {
        server
            .join()
            .map_err(|_| "Local command server panicked")??;
    }
    command_tx.send(SampleCommand::Quit).ok();
    let lsl_result = worker.join().map_err(|_| "LSL worker panicked")?;
    let csv_result = csv_worker.join().map_err(|_| "CSV worker panicked")?;
    lsl_result?;
    csv_result?;
    // Normal WM_CLOSE released the player before destroying its child HWND.
    drop(app);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Flubber VLC prototype: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_mouse_rating, PlaybackEvents, Shared, VideoMarker};

    #[test]
    fn mouse_movement_drives_both_normalized_axes_with_bounded_steps() {
        let mut rating = Shared::default();
        apply_mouse_rating(&mut rating, 150, -150, 1_000);
        assert!((rating.valence - 0.5).abs() < 0.0001);
        assert!((rating.arousal - 0.5).abs() < 0.0001);
        apply_mouse_rating(&mut rating, 10_000, -10_000, 1_000);
        assert_eq!(rating.valence, 1.0);
        assert_eq!(rating.arousal, 1.0);
        apply_mouse_rating(&mut rating, -10_000, 10_000, 1_000);
        assert_eq!(rating.valence, 0.5);
        assert_eq!(rating.arousal, 0.5);
    }

    #[test]
    fn observed_vlc_transitions_emit_control_markers_once_and_in_order() {
        let mut events = PlaybackEvents::default();
        assert!(events.observe(3, 2).is_empty());
        assert!(events.interrupt());
        assert!(!events.interrupt());
        assert_eq!(events.observe(4, 3), [VideoMarker::Pause]);
        assert!(events.observe(4, 4).is_empty());
        assert_eq!(events.observe(3, 4), [VideoMarker::Resume]);
        assert_eq!(events.observe(2, 3), [VideoMarker::BufferingStart]);
        assert_eq!(events.observe(3, 2), [VideoMarker::BufferingEnd]);
        assert_eq!(events.observe(6, 3), [VideoMarker::End]);
    }
}

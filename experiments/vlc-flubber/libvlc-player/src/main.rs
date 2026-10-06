#![cfg(windows)]
#![deny(unsafe_op_in_unsafe_fn)]

use labstream::{Channel, Format, Outlet, StreamInfo};
use libloading::Library;
use std::collections::VecDeque;
use std::env;
use std::ffi::{c_char, c_int, c_void, CString, OsStr};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, EndPaint, InvalidateRect, PatBlt, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, BLACKNESS, DIB_RGB_COLORS, PAINTSTRUCT, SRCCOPY,
};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, SetDllDirectoryW};
use windows_sys::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SetFocus, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RIGHT, VK_SPACE, VK_UP,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetMessageW,
    GetWindowLongPtrW, MoveWindow, PostMessageW, PostQuitMessage, RegisterClassW,
    SetWindowLongPtrW, ShowWindow, TranslateMessage, CW_USEDEFAULT, GWLP_USERDATA, MSG, SW_HIDE,
    SW_SHOW, WM_APP, WM_CLOSE, WM_DESTROY, WM_KEYDOWN, WM_PAINT, WM_SIZE, WNDCLASSW, WS_CHILD,
    WS_CLIPCHILDREN, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const RATE: Duration = Duration::from_nanos(33_333_333);
const POINTS: usize = 192;
const WAVES: usize = 16;
const WM_FLUBBER_TICK: u32 = WM_APP + 1;

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
        let release_player = dll_function(&library, b"libvlc_media_player_release\0")?;
        let release_media = dll_function(&library, b"libvlc_media_release\0")?;
        let release_instance = dll_function(&library, b"libvlc_release\0")?;
        let mut options = vec![
            CString::new("--no-video-title-show")?,
            CString::new("--ignore-config")?,
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
            release_player,
            release_media,
            release_instance,
        })
    }

    fn open(&mut self, path: &Path, video_hwnd: HWND) -> Result<()> {
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

enum SampleCommand {
    Start { media_ms: i64, observed_at: f64 },
    Stop,
    Quit,
}

fn sampler(
    shared: Arc<Mutex<Shared>>,
    commands: mpsc::Receiver<SampleCommand>,
    ready: mpsc::Sender<std::result::Result<(), String>>,
    name: String,
    csv_path: Option<PathBuf>,
) -> Result<()> {
    let source = format!(
        "vlc-flubber-libvlc-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );
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
    let mut recording: Option<BufWriter<File>> = None;
    let mut started = false;
    let mut samples = 0_u64;
    let mut recent = VecDeque::<(f64, [f32; 2])>::new();
    let mut origin = 0.0_f64;
    let mut pause_started = None::<f64>;
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
                        if let Some(parent) = path.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        let mut file = BufWriter::new(File::create(path)?);
                        file.write_all(b"time_s,valence,arousal\n")?;
                        for &(stamp, values) in &recent {
                            if stamp >= origin && stamp <= observed_at {
                                writeln!(
                                    file,
                                    "{:.6},{:.6},{:.6}",
                                    stamp - origin,
                                    values[0],
                                    values[1]
                                )?;
                            }
                        }
                        file.flush()?;
                        recording = Some(file);
                    }
                    markers.push_text_at(&format!("{name}_Start"), origin)?;
                    recent.clear();
                    started = true;
                }
                SampleCommand::Stop if started => {
                    markers.push_text_at(&format!("{name}_Stop"), labstream::clock())?;
                    if let Some(mut file) = recording.take() {
                        file.flush()?;
                    }
                    started = false;
                }
                SampleCommand::Quit => {
                    if started {
                        markers.push_text_at(&format!("{name}_Stop"), labstream::clock())?;
                    }
                    if let Some(mut file) = recording.take() {
                        file.flush()?;
                    }
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
        affect.push_at(&values, stamp)?;
        samples += 1;
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
            if let Some(file) = &mut recording {
                writeln!(
                    file,
                    "{:.6},{:.6},{:.6}",
                    (stamp - origin).max(0.0),
                    values[0],
                    values[1]
                )?;
                file.flush()?;
            }
        }
        next += RATE;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
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
            thread::sleep(next - now);
        } else {
            next = now;
        }
    }
    println!("Flubber SVG frames rendered: {frames}");
    Ok(())
}

struct App {
    vlc: Vlc,
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
    panel_percent: u32,
    step: f32,
    close_at: Option<Instant>,
    ticks: u64,
    tick_pending: Arc<AtomicBool>,
    tick_stop: Arc<AtomicBool>,
    sampler_failed: Arc<AtomicBool>,
}

impl App {
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
        // SAFETY: Requests a repaint of only our parent surface.
        unsafe { InvalidateRect(hwnd, null(), 0) };
    }

    fn tick(&mut self, hwnd: HWND) {
        if self.sampler_failed.load(Ordering::Acquire) {
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
        let state = self.vlc.state();
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
        } else if self.started && matches!(state, 5..=7) {
            self.started = false;
            self.commands.send(SampleCommand::Stop).ok();
        }
        if let Ok(mut shared) = self.shared.lock() {
            shared.playing = playing;
        }
        // SAFETY: The HWND is live; WM_PAINT displays the latest worker frame.
        unsafe { InvalidateRect(hwnd, null(), 0) };
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
        // SAFETY: Closes the paint operation opened above.
        unsafe { EndPaint(hwnd, &paint) };
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
                app.tick_stop.store(true, Ordering::Release);
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
                app.key(wparam as u32);
                return 0;
            }
            WM_DESTROY => {
                app.tick_stop.store(true, Ordering::Release);
                app.vlc.close();
                // SAFETY: Clear the non-owning callback pointer before Box<App> drops.
                unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
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

fn run() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let video = args.next().map(PathBuf::from);
    let csv_path = args.next().map(PathBuf::from).or_else(|| {
        video.as_ref().map(|video| {
            let mut path = video.to_path_buf();
            path.set_extension("flubber.csv");
            path
        })
    });
    if args.next().is_some() {
        return Err("Usage: flubber-libvlc-prototype.exe [VIDEO] [CSV]".into());
    }
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
    let sampler_failed = Arc::new(AtomicBool::new(false));
    let (command_tx, command_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let worker_shared = Arc::clone(&shared);
    let worker_failure = Arc::clone(&sampler_failed);
    let worker = thread::spawn(move || {
        let result = sampler(worker_shared, command_rx, ready_tx, name, csv_path);
        if result.is_err() {
            worker_failure.store(true, Ordering::Release);
        }
        result
    });
    ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "LSL outlet startup timed out")??;
    println!("Flubber LSL outlets online at 30 Hz");

    // SAFETY: Set once, before any Win32 window is created, so pixels map to
    // physical display pixels including on high-DPI monitors.
    unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let svg_renderer = Svg::new(&svg_path)?;
    let mut app = Box::new(App {
        vlc: Vlc::new(&vlc_dir)?,
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
        panel_percent: 25,
        step: 0.1,
        close_at: None,
        ticks: 0,
        tick_pending: Arc::new(AtomicBool::new(false)),
        tick_stop: Arc::new(AtomicBool::new(false)),
        sampler_failed,
    });
    let class = wide(OsStr::new("FlubberLibVlcPrototype"));
    let title = wide(OsStr::new("Flubber VLC prototype"));
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
    // SAFETY: `app` remains boxed at a stable address until the message loop ends.
    unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, (&mut *app as *mut App) as isize) };
    app.layout(hwnd);
    // The video child must be visible before LibVLC creates its native vout.
    unsafe { ShowWindow(hwnd, if test_hidden { SW_HIDE } else { SW_SHOW }) };
    if let Some(video) = video {
        if let Err(error) = app.vlc.open(&video, video_hwnd) {
            app.vlc.close();
            // SAFETY: No animation thread exists yet; clear callback ownership
            // and destroy both windows before returning the open error.
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                DestroyWindow(hwnd);
            }
            command_tx.send(SampleCommand::Quit).ok();
            worker.join().map_err(|_| "LSL worker panicked")??;
            return Err(error);
        }
    }
    app.close_at = test_exit_after.map(|delay| Instant::now() + delay);
    // SAFETY: The focus target is our live main window.
    unsafe { SetFocus(hwnd) };
    let pending = Arc::clone(&app.tick_pending);
    let stop = Arc::clone(&app.tick_stop);
    let window_address = hwnd as usize;
    let animation = thread::spawn(move || {
        animate(
            svg_renderer,
            Shape::new(),
            shared,
            panel_size,
            frame,
            pending,
            stop,
            window_address,
        )
    });
    let mut message = MSG::default();
    // SAFETY: Ordinary single-threaded Win32 message loop for owned window.
    while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    app.tick_stop.store(true, Ordering::Release);
    animation
        .join()
        .map_err(|_| "Flubber animation clock panicked")??;
    command_tx.send(SampleCommand::Quit).ok();
    worker.join().map_err(|_| "LSL worker panicked")??;
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

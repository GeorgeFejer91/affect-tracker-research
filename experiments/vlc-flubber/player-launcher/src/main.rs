use affect_research::research_runner_master::{MasterSelector, PreparedMaster};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs::{self, File};
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

mod control;
mod live;
mod selected_master;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Default)]
struct Args {
    control_stdio: bool,
    inspect_master: Option<PathBuf>,
    play_master_video: Option<PathBuf>,
    live_binding_json: Option<String>,
    play_master_sequence: Option<PathBuf>,
    participant: Option<String>,
    selector_json: Option<String>,
    entry_id: Option<String>,
    video: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
    headless: bool,
    wait: bool,
    arm: bool,
    selected_master_video: bool,
    master_duration_ms: Option<u64>,
    live: Option<live::Binding>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sidecar {
    schema: String,
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
}

#[derive(Deserialize)]
struct Probe {
    streams: Vec<VideoStream>,
}

#[derive(Deserialize)]
struct VideoStream {
    width: u32,
    height: u32,
    r_frame_rate: String,
    #[serde(default)]
    avg_frame_rate: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FrameRate {
    num: u32,
    den: u32,
}

struct Geometry {
    width: u32,
    video_height: u32,
    panel_height: u32,
    rate: FrameRate,
}

fn parse_args() -> Result<Args> {
    parse_args_from(env::args_os().skip(1))
}

fn parse_args_from(mut args: impl Iterator<Item = OsString>) -> Result<Args> {
    let mut parsed = Args::default();
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--control-stdio") if !parsed.control_stdio => parsed.control_stdio = true,
            Some("--inspect-master") if parsed.inspect_master.is_none() => {
                parsed.inspect_master = Some(PathBuf::from(value(&mut args, "--inspect-master")?))
            }
            Some("--play-master-video") if parsed.play_master_video.is_none() => {
                parsed.play_master_video =
                    Some(PathBuf::from(value(&mut args, "--play-master-video")?))
            }
            Some("--live-binding-json") if parsed.live_binding_json.is_none() => {
                parsed.live_binding_json = Some(
                    value(&mut args, "--live-binding-json")?
                        .into_string()
                        .map_err(|_| "--live-binding-json must be valid text")?,
                )
            }
            Some("--play-master-sequence") if parsed.play_master_sequence.is_none() => {
                parsed.play_master_sequence =
                    Some(PathBuf::from(value(&mut args, "--play-master-sequence")?))
            }
            Some("--participant") if parsed.participant.is_none() => {
                parsed.participant = Some(
                    value(&mut args, "--participant")?
                        .into_string()
                        .map_err(|_| "--participant must be valid text")?,
                )
            }
            Some("--selector-json") if parsed.selector_json.is_none() => {
                parsed.selector_json = Some(
                    value(&mut args, "--selector-json")?
                        .into_string()
                        .map_err(|_| "--selector-json must be valid text")?,
                )
            }
            Some("--entry-id") if parsed.entry_id.is_none() => {
                parsed.entry_id = Some(
                    value(&mut args, "--entry-id")?
                        .into_string()
                        .map_err(|_| "--entry-id must be valid text")?,
                )
            }
            Some("--video") => parsed.video = Some(PathBuf::from(value(&mut args, "--video")?)),
            Some("--data-dir") => {
                parsed.data_dir = Some(PathBuf::from(value(&mut args, "--data-dir")?))
            }
            Some("--panel-percent") => {
                parsed.panel_percent = Some(
                    value(&mut args, "--panel-percent")?
                        .to_string_lossy()
                        .parse()?,
                );
            }
            Some("--step-percent") => {
                parsed.step_percent = Some(
                    value(&mut args, "--step-percent")?
                        .to_string_lossy()
                        .parse()?,
                );
            }
            Some("--headless") => parsed.headless = true,
            Some("--wait") => parsed.wait = true,
            Some("--arm") => parsed.arm = true,
            Some("--help") | Some("-h") => {
                println!("FlubberVLC [video] [--panel-percent 25] [--step-percent 10] [--data-dir PATH] [--headless --wait] [--arm]");
                println!(
                    "FlubberVLC --inspect-master PATH --participant P001 --selector-json JSON"
                );
                println!("FlubberVLC --play-master-video PATH --participant P001 --selector-json JSON --entry-id ENTRY_ID [--data-dir PATH]");
                println!("Add --live-binding-json JSON for supervised decoded-frame reports and stdin pause/resume/stop requests.");
                println!("FlubberVLC --play-master-sequence PATH --participant P001 --selector-json JSON [--data-dir PATH]");
                println!("FlubberVLC --control-stdio [--data-dir PATH]");
                println!("Inspection validates a saved Planner master and prints its selected plan without starting VLC.");
                println!("Without a video, opens VLC with its Flubber LSL outlets already online.");
                println!("Use --control-stdio for a supervised same-PC player session.");
                std::process::exit(0);
            }
            _ if parsed.video.is_none() && !arg.to_string_lossy().starts_with('-') => {
                parsed.video = Some(PathBuf::from(arg))
            }
            _ => {
                return Err(
                    format!("Unknown or duplicate argument: {}", arg.to_string_lossy()).into(),
                )
            }
        }
    }
    if parsed.control_stdio {
        if parsed.inspect_master.is_some()
            || parsed.play_master_video.is_some()
            || parsed.live_binding_json.is_some()
            || parsed.play_master_sequence.is_some()
            || parsed.participant.is_some()
            || parsed.selector_json.is_some()
            || parsed.entry_id.is_some()
            || parsed.video.is_some()
            || parsed.panel_percent.is_some()
            || parsed.step_percent.is_some()
            || parsed.headless
            || parsed.wait
            || parsed.arm
        {
            return Err("--control-stdio accepts only --data-dir".into());
        }
        return Ok(parsed);
    }
    if parsed.inspect_master.is_some() {
        if parsed.participant.is_none()
            || parsed.selector_json.is_none()
            || parsed.entry_id.is_some()
            || parsed.play_master_video.is_some()
            || parsed.live_binding_json.is_some()
            || parsed.play_master_sequence.is_some()
            || parsed.video.is_some()
            || parsed.data_dir.is_some()
            || parsed.panel_percent.is_some()
            || parsed.step_percent.is_some()
            || parsed.headless
            || parsed.wait
            || parsed.arm
        {
            return Err("--inspect-master requires --participant and --selector-json and cannot be combined with playback options".into());
        }
        return Ok(parsed);
    }
    if parsed.play_master_video.is_some() {
        if parsed.participant.is_none()
            || parsed.selector_json.is_none()
            || parsed.entry_id.is_none()
            || parsed.play_master_sequence.is_some()
            || parsed.video.is_some()
            || parsed.panel_percent.is_some()
            || parsed.step_percent.is_some()
            || parsed.headless
            || parsed.wait
            || parsed.arm
        {
            return Err("--play-master-video requires participant, selector and entry ID, and cannot be combined with legacy playback options".into());
        }
        return Ok(parsed);
    }
    if parsed.play_master_sequence.is_some() {
        if parsed.participant.is_none()
            || parsed.selector_json.is_none()
            || parsed.entry_id.is_some()
            || parsed.video.is_some()
            || parsed.live_binding_json.is_some()
            || parsed.panel_percent.is_some()
            || parsed.step_percent.is_some()
            || parsed.headless
            || parsed.wait
            || parsed.arm
        {
            return Err("--play-master-sequence requires participant and selector, and cannot be combined with legacy playback options".into());
        }
        return Ok(parsed);
    }
    if parsed.participant.is_some() || parsed.selector_json.is_some() || parsed.entry_id.is_some() {
        return Err("Selection options require --inspect-master, --play-master-video, or --play-master-sequence".into());
    }
    if parsed.live_binding_json.is_some() {
        return Err("--live-binding-json requires --play-master-video".into());
    }
    if parsed.arm {
        return Err("--arm direct RC is retired; use --control-stdio".into());
    }
    if parsed.wait && parsed.video.is_none() {
        return Err("--wait requires a video".into());
    }
    if parsed.arm && (parsed.video.is_none() || parsed.wait) {
        return Err("--arm requires a video and cannot be combined with --wait".into());
    }
    Ok(parsed)
}

fn value(args: &mut impl Iterator<Item = OsString>, flag: &str) -> Result<OsString> {
    args.next()
        .ok_or_else(|| format!("{flag} requires a value").into())
}

fn parse_fps(rate: &str) -> Result<FrameRate> {
    let (num, den) = rate.split_once('/').ok_or("Invalid video frame rate")?;
    let num: u32 = num.parse()?;
    let den: u32 = den.parse()?;
    if num == 0 || den == 0 || num > 12_000_000 || den > 100_000 || num as f64 / den as f64 > 120.0
    {
        return Err("Video frame rate must be above zero and at most 120 fps".into());
    }
    let (mut a, mut b) = (num, den);
    while b != 0 {
        (a, b) = (b, a % b);
    }
    Ok(FrameRate {
        num: num / a,
        den: den / a,
    })
}

fn geometry(stream: &VideoStream, panel_percent: u32) -> Result<Geometry> {
    if !(10..=100).contains(&panel_percent)
        || stream.width < 64
        || stream.height < 64
        || stream.width > 8192
        || stream.height > 8192
    {
        return Err("Unsupported video size or Flubber panel ratio".into());
    }
    let width = (stream.width + 1) & !1;
    let video_height = (stream.height + 1) & !1;
    let panel_height = (video_height * panel_percent).div_ceil(200) * 2;
    let rate = parse_fps(&stream.avg_frame_rate).or_else(|_| parse_fps(&stream.r_frame_rate))?;
    if (width as u64) * (panel_height as u64) * 4 > 64 * 1024 * 1024
        || video_height + panel_height > 8192
    {
        return Err("Flubber panel exceeds the native renderer limit".into());
    }
    Ok(Geometry {
        width,
        video_height,
        panel_height,
        rate,
    })
}

fn probe(ffprobe: &Path, video: &Path, cancel: Option<&Arc<AtomicBool>>) -> Result<VideoStream> {
    if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
        return Err("Selected sequence stopped before FFprobe".into());
    }
    let mut child = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,avg_frame_rate",
            "-of",
            "json",
        ])
        .arg(video)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    if let Some(flag) = cancel {
        loop {
            if flag.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Selected sequence stopped; FFprobe child reaped".into());
            }
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error.into());
                }
            }
        }
    }
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(format!("FFprobe could not read {}", video.display()).into());
    }
    let parsed: Probe = serde_json::from_slice(&output.stdout)?;
    parsed
        .streams
        .into_iter()
        .next()
        .ok_or_else(|| "Video has no picture stream".into())
}

fn sha256_prefix(path: &Path, cancel: Option<&Arc<AtomicBool>>) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            return Err("Selected sequence stopped while hashing video".into());
        }
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize())[..16].to_owned())
}

fn sidecar_settings(video: &Path) -> Result<(Option<u32>, Option<u32>)> {
    let sidecar = video.with_extension("flubber.json");
    if !sidecar.exists() {
        return Ok((None, None));
    }
    let settings: Sidecar = serde_json::from_slice(&fs::read(&sidecar)?)?;
    if settings.schema != "vlc-flubber-sidequest/v1" {
        return Err(format!("Unsupported Flubber settings: {}", sidecar.display()).into());
    }
    Ok((settings.panel_percent, settings.step_percent))
}

fn prepare_video(
    ffmpeg: &Path,
    ffprobe: &Path,
    source: &Path,
    media_dir: &Path,
    panel_percent: u32,
) -> Result<(PathBuf, Geometry)> {
    prepare_video_cancellable(ffmpeg, ffprobe, source, media_dir, panel_percent, None)
}

fn prepare_video_cancellable(
    ffmpeg: &Path,
    ffprobe: &Path,
    source: &Path,
    media_dir: &Path,
    panel_percent: u32,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(PathBuf, Geometry)> {
    let geometry = geometry(&probe(ffprobe, source, cancel)?, panel_percent)?;
    fs::create_dir_all(media_dir)?;
    let stem = source
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or("Video filename is unavailable")?;
    let hash = sha256_prefix(source, cancel)?;
    let output = media_dir.join(format!(
        "{stem}-{hash}-p{panel_percent}-f{}-{}-lead5-tail2-v2.mkv",
        geometry.rate.num, geometry.rate.den
    ));
    if output.is_file() {
        let existing = probe(ffprobe, &output, cancel)?;
        if existing.width == geometry.width
            && existing.height == geometry.video_height + geometry.panel_height
            && parse_fps(&existing.r_frame_rate)? == geometry.rate
        {
            return Ok((output, geometry));
        }
        return Err(
            "Prepared video cache has unexpected geometry; remove it before retrying".into(),
        );
    }
    let temporary = media_dir.join(format!("{stem}-{hash}-{}.partial.mkv", std::process::id()));
    let filter = format!(
        "fps={},pad={}:{}:0:0:black,drawbox=x=0:y={}:w=4:h=4:color=white:t=fill,tpad=start_duration=5:start_mode=add:stop_duration=2:stop_mode=add",
        format!("{}/{}", geometry.rate.num, geometry.rate.den),
        geometry.width,
        geometry.video_height + geometry.panel_height,
        geometry.video_height
    );
    if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
        return Err("Selected sequence stopped before FFmpeg".into());
    }
    let mut child = Command::new(ffmpeg)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(source)
        .args(["-itsoffset", "5", "-i"])
        .arg(source)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-map",
            "1:s?",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-vf",
        ])
        .arg(filter)
        .args([
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-c:s",
            "copy",
            "-fps_mode",
            "cfr",
            "-y",
        ])
        .arg(&temporary)
        .spawn()?;
    let status = wait_for_preparation_child(&mut child, cancel);
    if status.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    let status = status?;
    if !status.success() {
        let _ = fs::remove_file(&temporary);
        return Err("FFmpeg could not prepare the video".into());
    }
    let verified = match probe(ffprobe, &temporary, cancel) {
        Ok(verified) => verified,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
    };
    if verified.width != geometry.width
        || verified.height != geometry.video_height + geometry.panel_height
        || parse_fps(&verified.r_frame_rate)? != geometry.rate
    {
        let _ = fs::remove_file(&temporary);
        return Err("FFmpeg output did not match the requested Flubber layout".into());
    }
    if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
        let _ = fs::remove_file(&temporary);
        return Err("Selected sequence stopped before prepared-video commit".into());
    }
    if let Err(error) = fs::rename(&temporary, &output) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    Ok((output, geometry))
}

fn wait_for_preparation_child(
    child: &mut Child,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<ExitStatus> {
    let Some(flag) = cancel else {
        return Ok(child.wait()?);
    };
    loop {
        if flag.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Selected sequence stopped; preparation child reaped".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        }
    }
}

fn required_file(path: PathBuf) -> Result<PathBuf> {
    if !path.is_file() {
        return Err(format!("Missing bundled file: {}", path.display()).into());
    }
    Ok(path)
}

fn wait_for_outlets(pid: u32) -> Result<()> {
    use labstream::Query;

    let affect = format!("vlc-flubber-{pid}-affect");
    let markers = format!("vlc-flubber-{pid}-markers");
    let mut observed = Vec::new();
    for _ in 0..20 {
        let found = labstream::resolve_all(&Query::all(), Duration::from_millis(250))?;
        observed.clear();
        observed.extend(found.iter().map(|info| info.source_id().to_owned()));
        let affect_ready = found
            .iter()
            .any(|info| info.name() == "VLC_Flubber_Affect" && info.source_id() == affect);
        let markers_ready = found
            .iter()
            .any(|info| info.name() == "VLC_Flubber_Markers" && info.source_id() == markers);
        if affect_ready && markers_ready {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(format!("VLC did not expose both Flubber LSL outlets; observed {observed:?}").into())
}

fn wait_for_rc(port: u16) -> Result<()> {
    let address = format!("127.0.0.1:{port}").parse()?;
    for _ in 0..30 {
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("VLC did not open its local control port".into())
}

fn rc_interface(live: bool) -> &'static str {
    if live {
        "--extraintf=rc"
    } else {
        "--extraintf=flubberoutlet:rc"
    }
}

fn run() -> Result<()> {
    let args = parse_args()?;
    if let Some(master) = &args.play_master_sequence {
        let result = selected_master::run_sequence(
            master,
            args.participant.as_deref().ok_or("Missing participant")?,
            args.selector_json.as_deref().ok_or("Missing selector")?,
            args.data_dir.clone(),
        );
        match result {
            Ok(receipt) => {
                let failed = receipt["status"] == "failed";
                println!("{receipt}");
                if failed {
                    return Err("Selected master sequence failed; see its event receipt".into());
                }
            }
            Err(error) => {
                println!(
                    "{}",
                    serde_json::json!({"schema":"flubber-vlc-selected-sequence-status","version":1,"status":"failed","error":error.to_string()})
                );
                return Err(error);
            }
        }
        return Ok(());
    }
    if let Some(master) = &args.play_master_video {
        let participant = args.participant.as_deref().ok_or("Missing participant")?;
        let selector = args.selector_json.as_deref().ok_or("Missing selector")?;
        let entry_id = args.entry_id.as_deref().ok_or("Missing entry ID")?;
        let result = if let Some(binding) = args.live_binding_json.as_deref() {
            selected_master::run_live(
                master,
                participant,
                selector,
                entry_id,
                args.data_dir.clone(),
                binding,
            )
        } else {
            selected_master::run(
                master,
                participant,
                selector,
                entry_id,
                args.data_dir.clone(),
            )
        };
        match result {
            Ok(receipt) if args.live_binding_json.is_some() => live::emit(serde_json::json!({
                "protocol":"flubber-vlc-runner-live/v1","kind":"terminal","status":"ended",
                "selectedVideoReceipt":receipt
            }))?,
            Ok(receipt) => println!("{}", receipt),
            Err(error) => {
                if args.live_binding_json.is_some() {
                    let status = if error.downcast_ref::<live::Stopped>().is_some() {
                        "stopped"
                    } else {
                        "failed"
                    };
                    live::emit(serde_json::json!({
                        "protocol":"flubber-vlc-runner-live/v1","kind":"terminal",
                        "status":status,"error":error.to_string()
                    }))?;
                } else {
                    println!(
                        "{}",
                        serde_json::json!({"schema":"flubber-vlc-selected-video-status","version":1,"status":"failed","error":error.to_string()})
                    );
                }
                return Err(error);
            }
        }
        return Ok(());
    }
    run_with_args(args)
}

fn run_with_args(args: Args) -> Result<()> {
    run_with_args_cancellable(args, None)
}

fn wait_for_selected_child(
    child: &mut Child,
    duration_ms: u64,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<ExitStatus> {
    let Some(deadline) = Instant::now()
        .checked_add(Duration::from_millis(duration_ms).saturating_add(Duration::from_secs(120)))
    else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Selected video deadline is not representable".into());
    };
    loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Selected sequence stopped; VLC child reaped".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Selected video did not reach a terminal state before its deadline".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn run_with_args_cancellable(args: Args, cancel: Option<&Arc<AtomicBool>>) -> Result<()> {
    if args.control_stdio {
        return control::run(args.data_dir);
    }
    if let Some(master) = &args.inspect_master {
        let selector: MasterSelector =
            serde_json::from_str(args.selector_json.as_deref().ok_or("Missing selector")?)?;
        let prepared = PreparedMaster::read_file(
            master,
            args.participant.as_deref().ok_or("Missing participant")?,
            selector,
        )?;
        println!("{}", serde_json::to_string(&prepared.plan)?);
        return Ok(());
    }
    if args.video.as_ref().is_some_and(|path| {
        path.extension()
            .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("json"))
    }) {
        return Err("Planner masters must use --inspect-master; execution is not supported".into());
    }
    let install = env::current_exe()?
        .parent()
        .ok_or("Cannot locate player installation")?
        .to_path_buf();
    let vlc_dir = install.join("vlc");
    let vlc = required_file(vlc_dir.join("vlc.exe"))?;
    let svg = required_file(install.join("svg").join("flubber_svg.dll"))?;
    let lsl = required_file(install.join("lsl.dll"))?;
    required_file(
        install
            .join("plugins")
            .join("video_filter")
            .join("libflubber_plugin.dll"),
    )?;
    let data_dir = if let Some(path) = args.data_dir {
        path
    } else {
        PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player")
    };
    fs::create_dir_all(&data_dir)?;
    let mut command = Command::new(vlc);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.args([
        "--no-one-instance",
        "--no-plugins-cache",
        "--avcodec-hw=none",
        "--no-video-title-show",
        "--no-osd",
    ]);
    let rc_port = if args.arm || args.live.is_some() {
        let reservation = TcpListener::bind("127.0.0.1:0")?;
        let port = reservation.local_addr()?.port();
        drop(reservation);
        command.arg(rc_interface(args.live.is_some()));
        command.arg(format!("--rc-host=127.0.0.1:{port}"));
        command.args(["-I", "dummy"]);
        Some(port)
    } else {
        command.arg("--extraintf=flubberoutlet");
        None
    };
    command.env("VLC_PLUGIN_PATH", install.join("plugins"));
    command.env("FLUBBER_SVG_DLL", svg);
    command.env("FLUBBER_LSL_DLL", lsl);
    let old_path = env::var_os("PATH").unwrap_or_default();
    let mut path = OsString::from(vlc_dir.as_os_str());
    path.push(";");
    path.push(old_path);
    command.env("PATH", path);
    if let Some(video) = args.video {
        let video = video.canonicalize()?;
        let (sidecar_panel, sidecar_step) = sidecar_settings(&video)?;
        let panel = args.panel_percent.or(sidecar_panel).unwrap_or(25);
        let step = args.step_percent.or(sidecar_step).unwrap_or(10);
        if !(1..=100).contains(&step) {
            return Err("stepPercent must be 1–100".into());
        }
        let ffmpeg = required_file(install.join("ffmpeg").join("ffmpeg.exe"))?;
        let ffprobe = required_file(install.join("ffmpeg").join("ffprobe.exe"))?;
        if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            return Err("Selected sequence stopped before video preparation".into());
        }
        let (prepared, geometry) = prepare_video_cancellable(
            &ffmpeg,
            &ffprobe,
            &video,
            &data_dir.join("media"),
            panel,
            cancel,
        )?;
        if cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
            return Err("Selected sequence stopped before VLC launch".into());
        }
        let recordings = data_dir.join("recordings");
        fs::create_dir_all(&recordings)?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
        let csv = recordings.join(format!("flubber-{stamp}-{}.csv", std::process::id()));
        let filename = video
            .file_name()
            .and_then(OsStr::to_str)
            .ok_or("Video filename is unavailable")?;
        command
            .args([
                "--video-filter=flubber",
                "--flubber-sentinel",
                "--vout=wingdi",
                "--key-nav-up=",
                "--key-nav-down=",
                "--key-nav-left=",
                "--key-nav-right=",
                "--key-jump+short=",
                "--key-jump-short=",
            ])
            .arg(format!("--flubber-panel-percent={panel}"))
            .arg(format!("--flubber-video-height={}", geometry.video_height))
            .arg(format!("--flubber-render-fps-num={}", geometry.rate.num))
            .arg(format!("--flubber-render-fps-den={}", geometry.rate.den))
            .arg(format!("--flubber-step-percent={step}"))
            .arg(format!("--flubber-marker-base={filename}"))
            .arg(format!("--flubber-csv={}", csv.display()));
        if args.live.is_some() {
            command.arg("--flubber-live-stdout");
        }
        if !args.selected_master_video {
            command.arg("--flubber-lsl");
        } else {
            command.arg("--flubber-terminal-receipt");
        }
        if !args.arm {
            command.arg("--play-and-exit");
        }
        if args.headless {
            if !args.arm {
                command.args(["-I", "dummy"]);
            }
            command.args(["--vout=yuv", "--yuv-file=NUL", "--aout=dummy"]);
        }
        if !args.arm {
            command.arg(&prepared);
        }
        if args.live.is_some() {
            command.stdout(Stdio::piped());
        }
        let mut child = command.spawn()?;
        if let Err(error) = (if args.selected_master_video {
            Ok(())
        } else {
            wait_for_outlets(child.id())
        })
        .and_then(|()| {
            if let Some(port) = rc_port {
                wait_for_rc(port)
            } else {
                Ok(())
            }
        }) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        if !args.selected_master_video {
            println!("VLC PID: {}", child.id());
            if rc_port.is_some() {
                println!("Prepared video: {}", prepared.display());
            }
            println!("Affect CSV: {}", csv.display());
            println!(
                "Affect time-series CSV: {}",
                csv.with_file_name(format!(
                    "{}-timeseries.csv",
                    csv.file_stem().unwrap_or_default().to_string_lossy()
                ))
                .display()
            );
            if args.arm {
                println!(
                    "Flubber LSL outlets are online; playback is waiting for an RC add command."
                );
            }
        }
        if args.wait {
            if let Some(binding) = args.live {
                let port = rc_port.ok_or("Live VLC control port is absent")?;
                let duration_ms = args
                    .master_duration_ms
                    .ok_or("Live VLC duration is absent")?;
                if let Err(error) = live::forward(&mut child, port, binding, duration_ms) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
            let status = if let Some(duration_ms) = args.master_duration_ms {
                wait_for_selected_child(&mut child, duration_ms, cancel)?
            } else {
                child.wait()?
            };
            if !status.success() {
                return Err("VLC playback failed".into());
            }
            let series = csv.with_file_name(format!(
                "{}-timeseries.csv",
                csv.file_stem().unwrap_or_default().to_string_lossy()
            ));
            if !csv.is_file() || !series.is_file() {
                return Err("VLC did not write both affect CSV files".into());
            }
            let events = fs::read_to_string(&csv)?;
            let values = fs::read_to_string(&series)?;
            if !terminal_csv_complete(&events, &values, args.selected_master_video) {
                return Err("VLC affect CSV files are incomplete".into());
            }
        }
    } else {
        if args.headless {
            command.args(["-I", "dummy"]);
        }
        let mut child = command.spawn()?;
        if let Err(error) = wait_for_outlets(child.id()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        println!("VLC PID: {}", child.id());
        println!("Flubber affect and marker LSL outlets are online before video.");
    }
    Ok(())
}

fn terminal_csv_complete(events: &str, values: &str, require_decoded_end: bool) -> bool {
    let mut last = events.lines().rev();
    last.next()
        .is_some_and(|line| line.starts_with("video_end,"))
        && (!require_decoded_end
            || last
                .next()
                .is_some_and(|line| line.starts_with("video_complete,")))
        && events.lines().any(|line| line.starts_with("video_start,"))
        && values.lines().next() == Some("time_s,valence,arousal")
        && values.lines().count() >= 2
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Flubber VLC: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        geometry, parse_args_from, parse_fps, run_with_args, terminal_csv_complete, Args,
        FrameRate, VideoStream,
    };
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn selected_child_is_reaped_when_stop_is_signalled() {
        let mut child = Command::new("powershell")
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&cancel);
        let stopper = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            signal.store(true, Ordering::Release);
        });
        assert!(super::wait_for_selected_child(&mut child, 5_000, Some(&cancel)).is_err());
        stopper.join().unwrap();
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn preparation_child_is_reaped_when_stop_is_signalled() {
        let mut child = Command::new("powershell")
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let cancel = Arc::new(AtomicBool::new(true));
        assert!(super::wait_for_preparation_child(&mut child, Some(&cancel)).is_err());
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn converts_fractional_rate_and_preserves_even_layout() {
        let source = VideoStream {
            width: 641,
            height: 361,
            r_frame_rate: "30000/1001".into(),
            avg_frame_rate: "30000/1001".into(),
        };
        let result = geometry(&source, 25).unwrap();
        assert_eq!(
            (
                result.width,
                result.video_height,
                result.panel_height,
                result.rate
            ),
            (
                642,
                362,
                92,
                FrameRate {
                    num: 30000,
                    den: 1001
                }
            )
        );
        assert!(parse_fps("0/0").is_err());
    }

    #[test]
    fn master_inspection_succeeds_without_a_vlc_installation() {
        let path = std::env::temp_dir().join(format!(
            "flubber-inspect-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(
            &path,
            include_str!("../../../../test/fixtures/planner-recipe-current-v1.canonical.json"),
        )
        .unwrap();
        let args = Args {
            inspect_master: Some(path.clone()),
            participant: Some("P001".into()),
            selector_json: Some(r#"{"variantId":"variant-3","languageId":"en","languageSelectionPath":["both","en"],"presentationTarget":"desktop-screen"}"#.into()),
            ..Args::default()
        };
        let result = run_with_args(args);
        fs::remove_file(path).unwrap();
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn inspection_options_are_exclusive_and_require_an_explicit_selection() {
        let selector = r#"{"variantId":"variant-3","languageId":"en","languageSelectionPath":["both","en"],"presentationTarget":"desktop-screen"}"#;
        let args = [
            "--inspect-master",
            "master.json",
            "--participant",
            "P001",
            "--selector-json",
            selector,
        ];
        let parsed = parse_args_from(args.into_iter().map(OsString::from)).unwrap();
        assert_eq!(parsed.inspect_master, Some(PathBuf::from("master.json")));
        assert!(parse_args_from(
            ["--inspect-master", "master.json"]
                .into_iter()
                .map(OsString::from)
        )
        .is_err());
        assert!(parse_args_from(
            args.into_iter()
                .chain(["--video", "video.mp4"])
                .map(OsString::from)
        )
        .is_err());
        assert!(parse_args_from(
            ["--selector-json", selector]
                .into_iter()
                .map(OsString::from)
        )
        .is_err());
    }

    #[test]
    fn selected_master_video_requires_one_explicit_occurrence() {
        let selector = r#"{"variantId":"variant-3","languageId":"en","languageSelectionPath":["both","en"],"presentationTarget":"desktop-screen"}"#;
        let args = [
            "--play-master-video",
            "experiment.json",
            "--participant",
            "P001",
            "--selector-json",
            selector,
            "--entry-id",
            "variant-3-entry-15",
        ];
        let parsed = parse_args_from(args.into_iter().map(OsString::from)).unwrap();
        assert_eq!(
            parsed.play_master_video,
            Some(PathBuf::from("experiment.json"))
        );
        assert_eq!(parsed.entry_id.as_deref(), Some("variant-3-entry-15"));
        assert!(parse_args_from(args[..6].iter().copied().map(OsString::from)).is_err());
        assert!(parse_args_from(
            args.into_iter()
                .chain(["--video", "clip.mp4"])
                .map(OsString::from)
        )
        .is_err());
    }

    #[test]
    fn selected_master_sequence_requires_selection_without_entry_id() {
        let selector = r#"{"variantId":"variant-3","languageId":"en","languageSelectionPath":["both","en"],"presentationTarget":"desktop-screen"}"#;
        let args = [
            "--play-master-sequence",
            "experiment.json",
            "--participant",
            "P001",
            "--selector-json",
            selector,
        ];
        let parsed = parse_args_from(args.into_iter().map(OsString::from)).unwrap();
        assert_eq!(
            parsed.play_master_sequence,
            Some(PathBuf::from("experiment.json"))
        );
        assert!(parse_args_from(args[..4].iter().copied().map(OsString::from)).is_err());
        assert!(parse_args_from(
            args.into_iter()
                .chain(["--entry-id", "video-a"])
                .map(OsString::from)
        )
        .is_err());
    }

    #[test]
    fn selected_master_terminal_requires_decoded_completion_not_shutdown_only() {
        let values = "time_s,valence,arousal\n0,0,0\n";
        let interrupted = "video_start,0,0,0,0\nvideo_end,100,0,0,0\n";
        let ended = "video_start,0,0,0,0\nvideo_complete,100,0,0,0\nvideo_end,100,0,0,0\n";
        assert!(!terminal_csv_complete(interrupted, values, true));
        assert!(terminal_csv_complete(ended, values, true));
        assert!(terminal_csv_complete(interrupted, values, false));
    }

    #[test]
    fn stdio_control_cannot_mix_with_legacy_video_or_master_modes() {
        let parsed = parse_args_from(
            ["--control-stdio", "--data-dir", "C:\\data"]
                .into_iter()
                .map(OsString::from),
        )
        .unwrap();
        assert!(parsed.control_stdio);
        assert!(parse_args_from(
            ["--control-stdio", "--video", "clip.mp4"]
                .into_iter()
                .map(OsString::from)
        )
        .is_err());
        assert!(parse_args_from(
            ["--control-stdio", "--inspect-master", "master.json"]
                .into_iter()
                .map(OsString::from)
        )
        .is_err());
        assert!(parse_args_from(
            ["--arm", "--video", "clip.mp4"]
                .into_iter()
                .map(OsString::from)
        )
        .is_err());
    }

    #[test]
    fn live_observation_is_opt_in_only_for_one_selected_master_video() {
        assert_eq!(super::rc_interface(true), "--extraintf=rc");
        assert_eq!(super::rc_interface(false), "--extraintf=flubberoutlet:rc");
        let selected = [
            "--play-master-video",
            "master.json",
            "--participant",
            "P001",
            "--selector-json",
            "{}",
            "--entry-id",
            "video-1",
            "--live-binding-json",
            "{}",
        ];
        let parsed = parse_args_from(selected.into_iter().map(OsString::from)).unwrap();
        assert_eq!(parsed.live_binding_json.as_deref(), Some("{}"));
        assert!(parse_args_from(
            [
                "--play-master-sequence",
                "master.json",
                "--participant",
                "P001",
                "--selector-json",
                "{}",
                "--live-binding-json",
                "{}"
            ]
            .into_iter()
            .map(OsString::from)
        )
        .is_err());
        assert!(parse_args_from(
            ["--control-stdio", "--live-binding-json", "{}"]
                .into_iter()
                .map(OsString::from)
        )
        .is_err());
    }
}

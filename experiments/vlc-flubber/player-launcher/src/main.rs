use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Default)]
struct Args {
    video: Option<PathBuf>,
    data_dir: Option<PathBuf>,
    panel_percent: Option<u32>,
    step_percent: Option<u32>,
    headless: bool,
    wait: bool,
    arm: bool,
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
    let mut parsed = Args::default();
    let mut args = env::args_os().skip(1);
    while let Some(arg) = args.next() {
        match arg.to_str() {
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
                println!("Without a video, opens VLC with its Flubber LSL outlets already online.");
                println!("--arm prepares the video and opens an idle, LSL-ready VLC RC player.");
                std::process::exit(0);
            }
            _ if parsed.video.is_none() => parsed.video = Some(PathBuf::from(arg)),
            _ => {
                return Err(
                    format!("Unknown or duplicate argument: {}", arg.to_string_lossy()).into(),
                )
            }
        }
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
    let scale = (1080.0 / stream.height as f64)
        .max(1.0)
        .min(8192.0 / stream.width as f64);
    let width = ((stream.width as f64 * scale).ceil() as u32 + 1) & !1;
    let video_height = ((stream.height as f64 * scale).ceil() as u32 + 1) & !1;
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

fn probe(ffprobe: &Path, video: &Path) -> Result<VideoStream> {
    let output = Command::new(ffprobe)
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
        .output()?;
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

fn sha256_prefix(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize())[..16].to_owned())
}

fn read_settings(path: &Path) -> Result<(Option<u32>, Option<u32>)> {
    let settings: Sidecar = serde_json::from_slice(&fs::read(path)?)?;
    if settings.schema != "vlc-flubber-sidequest/v1" {
        return Err(format!("Unsupported Flubber settings: {}", path.display()).into());
    }
    Ok((settings.panel_percent, settings.step_percent))
}

fn ensure_preset_folder(data_dir: &Path) -> Result<PathBuf> {
    let folder = data_dir.join("presets");
    fs::create_dir_all(&folder)?;
    let default = folder.join("default.flubber.json");
    if !default.exists() {
        match OpenOptions::new().write(true).create_new(true).open(&default) {
            Ok(mut file) => file.write_all(b"{\"schema\":\"vlc-flubber-sidequest/v1\",\"panelPercent\":25,\"stepPercent\":10}\n")?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error.into()),
        }
    }
    Ok(folder)
}

fn preset_settings(video: &Path, data_dir: &Path) -> Result<(Option<u32>, Option<u32>)> {
    let folder = ensure_preset_folder(data_dir)?;
    let default = folder.join("default.flubber.json");
    let stem = video
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or("Video stem is unavailable")?;
    let candidates = [
        video.with_extension("flubber.json"),
        folder.join(format!("{stem}.flubber.json")),
        default,
    ];
    for path in candidates {
        if path.is_file() {
            return read_settings(&path);
        }
    }
    Ok((None, None))
}

fn prepare_video(
    ffmpeg: &Path,
    ffprobe: &Path,
    source: &Path,
    media_dir: &Path,
    panel_percent: u32,
) -> Result<(PathBuf, Geometry)> {
    let geometry = geometry(&probe(ffprobe, source)?, panel_percent)?;
    fs::create_dir_all(media_dir)?;
    let stem = source
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or("Video filename is unavailable")?;
    let hash = sha256_prefix(source)?;
    let output = media_dir.join(format!(
        "{stem}-{hash}-p{panel_percent}-f{}-{}-lead5-tail2-v3.mkv",
        geometry.rate.num, geometry.rate.den
    ));
    if output.is_file() {
        let existing = probe(ffprobe, &output)?;
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
        "fps={},scale={}:{}:flags=lanczos,pad={}:{}:0:0:black,drawbox=x=0:y={}:w=4:h=4:color=white:t=fill,tpad=start_duration=5:start_mode=add:stop_duration=2:stop_mode=add",
        format!("{}/{}", geometry.rate.num, geometry.rate.den),
        geometry.width,
        geometry.video_height,
        geometry.width,
        geometry.video_height + geometry.panel_height,
        geometry.video_height
    );
    let status = Command::new(ffmpeg)
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
        .status()?;
    if !status.success() {
        return Err("FFmpeg could not prepare the video".into());
    }
    let verified = probe(ffprobe, &temporary)?;
    if verified.width != geometry.width
        || verified.height != geometry.video_height + geometry.panel_height
        || parse_fps(&verified.r_frame_rate)? != geometry.rate
    {
        return Err("FFmpeg output did not match the requested Flubber layout".into());
    }
    fs::rename(&temporary, &output)?;
    Ok((output, geometry))
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
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
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
        if Instant::now() >= deadline {
            break;
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

fn run() -> Result<()> {
    let args = parse_args()?;
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
    let preset_root =
        PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player");
    let data_dir = if let Some(path) = args.data_dir {
        path
    } else {
        PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player")
    };
    fs::create_dir_all(&data_dir)?;
    ensure_preset_folder(&preset_root)?;
    let mut command = Command::new(vlc);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.args([
        "--no-one-instance",
        "--no-plugins-cache",
        "--avcodec-hw=none",
        "--embedded-video",
        "--no-video-title-show",
    ]);
    let rc_port = if args.arm {
        let reservation = TcpListener::bind("127.0.0.1:0")?;
        let port = reservation.local_addr()?.port();
        drop(reservation);
        command.arg("--extraintf=flubberoutlet:rc");
        command.arg(format!("--rc-host=127.0.0.1:{port}"));
        if !args.headless {
            command.arg("--fullscreen");
        }
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
        let (sidecar_panel, sidecar_step) = preset_settings(&video, &preset_root)?;
        let panel = args.panel_percent.or(sidecar_panel).unwrap_or(25);
        let step = args.step_percent.or(sidecar_step).unwrap_or(10);
        if !(1..=100).contains(&step) {
            return Err("stepPercent must be 1–100".into());
        }
        let ffmpeg = required_file(install.join("ffmpeg").join("ffmpeg.exe"))?;
        let ffprobe = required_file(install.join("ffmpeg").join("ffprobe.exe"))?;
        let (prepared, geometry) =
            prepare_video(&ffmpeg, &ffprobe, &video, &data_dir.join("media"), panel)?;
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
                "--flubber-lsl",
                "--flubber-sentinel",
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
        if args.wait {
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
        let mut child = command.spawn()?;
        if let Err(error) = wait_for_outlets(child.id()).and_then(|()| {
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
        println!("VLC PID: {}", child.id());
        if let Some(port) = rc_port {
            println!("VLC RC: 127.0.0.1:{port}");
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
            println!("Flubber LSL outlets are online; playback is waiting for an RC add command.");
        }
        if args.wait {
            if !child.wait()?.success() {
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
            if !events
                .lines()
                .last()
                .is_some_and(|line| line.starts_with("video_end,"))
                || values.lines().next() != Some("time_s,valence,arousal")
                || values.lines().count() < 2
            {
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

fn main() {
    if let Err(error) = run() {
        eprintln!("Flubber VLC: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{geometry, parse_fps, FrameRate, VideoStream};

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
                1918,
                1080,
                270,
                FrameRate {
                    num: 30000,
                    den: 1001
                }
            )
        );
        assert!(parse_fps("0/0").is_err());
    }
}

//! Independent end-to-end receiver for the installed VLC SVG player.

use labstream::{Buffer, Inlet, Post, Query};
use std::env;
use std::error::Error;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn line_value<'a>(output: &'a str, prefix: &str) -> Result<&'a str> {
    output
        .lines()
        .find_map(|line| line.strip_prefix(prefix))
        .ok_or_else(|| format!("Launcher omitted {prefix}").into())
}

fn run() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let player_dir = PathBuf::from(args.next().ok_or("Expected installed player directory")?);
    let video = PathBuf::from(args.next().ok_or("Expected source video path")?).canonicalize()?;
    let data_dir = PathBuf::from(args.next().ok_or("Expected data directory")?);
    if args.next().is_some() {
        return Err("Unexpected argument".into());
    }
    let mut launcher = Command::new(player_dir.join("FlubberVLC.exe"))
        .arg(&video)
        .arg("--headless")
        .arg("--data-dir")
        .arg(data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut reader = BufReader::new(
        launcher
            .stdout
            .take()
            .ok_or("Launcher stdout unavailable")?,
    );
    let mut launch = String::new();
    for _ in 0..3 {
        if reader.read_line(&mut launch)? == 0 {
            return Err("Launcher exited before announcing VLC and CSV".into());
        }
    }
    let pid: u32 = line_value(&launch, "VLC PID: ")?.parse()?;
    println!("Checking VLC PID {pid}");
    let csv = PathBuf::from(line_value(&launch, "Affect CSV: ")?);
    let source = format!("vlc-flubber-{pid}");
    let timeout = Duration::from_secs(5);
    let affect_id = format!("{source}-affect");
    let marker_id = format!("{source}-markers");
    let started = Instant::now();
    let (affect, markers) = loop {
        let all = labstream::resolve_all(&Query::all(), Duration::from_millis(250))?;
        let affect = all.iter().find(|info| info.source_id() == affect_id);
        let markers = all.iter().find(|info| info.source_id() == marker_id);
        if let (Some(affect), Some(markers)) = (affect, markers) {
            break (affect.fetch(timeout)?, markers.fetch(timeout)?);
        }
        if started.elapsed() >= Duration::from_secs(8) {
            let observed: Vec<_> = all.iter().map(|info| info.source_id()).collect();
            return Err(format!(
                "Installed VLC outlets were not discovered; observed {observed:?}"
            )
            .into());
        }
        thread::sleep(Duration::from_millis(100));
    };
    if affect.name() != "VLC_Flubber_Affect" || markers.name() != "VLC_Flubber_Markers" {
        return Err("Discovered VLC stream names differ".into());
    }
    let mut marker_inlet = Inlet::builder(&markers)
        .buffer(Buffer::Samples(32))
        .recover(false)
        .postprocess(Post::NONE)
        .open(timeout)?;
    let mut affect_inlet = Inlet::builder(&affect)
        .buffer(Buffer::Seconds(30.0))
        .recover(false)
        .postprocess(Post::NONE)
        .open(timeout)?;
    let mut samples = 0_usize;
    let mut labels = Vec::new();
    let mut last_stamp = 0.0_f64;
    let deadline = Instant::now() + Duration::from_secs(30);
    let filename = video
        .file_name()
        .ok_or("Source video filename is unavailable")?
        .to_string_lossy();
    let start = format!("{filename}_Start");
    let stop = format!("{filename}_Stop");
    while Instant::now() < deadline && !labels.contains(&stop) {
        if let Some((stamp, values)) = affect_inlet.pull::<f32>(Duration::from_millis(100))? {
            if values.len() != 2
                || !(-1.0..=1.0).contains(&values[0])
                || !(-1.0..=1.0).contains(&values[1])
                || stamp < last_stamp
            {
                return Err("Invalid or nonmonotonic VLC affect sample".into());
            }
            last_stamp = stamp;
            samples += 1;
        }
        if let Some((_, values)) = marker_inlet.pull_text(Duration::from_millis(50))? {
            labels.extend(values);
        }
    }
    if labels != [start.as_str(), stop.as_str()] || samples == 0 {
        return Err(format!("Incomplete LSL playback: {samples} samples, {labels:?}").into());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    let events = loop {
        if let Ok(events) = fs::read_to_string(&csv) {
            if events
                .lines()
                .last()
                .is_some_and(|line| line.starts_with("video_end,"))
            {
                break events;
            }
        }
        if Instant::now() >= deadline {
            return Err("VLC did not close its event CSV".into());
        }
        thread::sleep(Duration::from_millis(100));
    };
    println!("Installed SVG VLC LSL loopback passed: {samples} affect samples, {labels:?}, {} event rows", events.lines().count() - 1);
    if !launcher.wait()?.success() {
        return Err("Launcher process failed".into());
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Installed SVG VLC LSL loopback failed: {error}");
        std::process::exit(1);
    }
}

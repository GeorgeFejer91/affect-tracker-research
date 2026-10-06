use flubbercorder_native::Session;
use std::env;
use std::error::Error;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    let recipe = PathBuf::from(args.next().ok_or("Expected recipe JSON path")?);
    let player = PathBuf::from(args.next().ok_or("Expected installed player directory")?);
    let recorder = PathBuf::from(args.next().ok_or("Expected recorder runtime directory")?);
    let data = PathBuf::from(args.next().ok_or("Expected output directory")?);
    let limit = args
        .next()
        .map(|value| value.to_string_lossy().parse::<u64>())
        .transpose()?
        .unwrap_or(600);
    if args.next().is_some() || !(1..=3600).contains(&limit) {
        return Err(
            "Usage: flubbercorder-native RECIPE PLAYER_DIR RECORDER_DIR DATA_DIR [TIMEOUT_SECONDS]"
                .into(),
        );
    }
    let mut session = Session::arm(&recipe, &player, &recorder, &data, false)?;
    println!(
        "Recorder subscribed before playback; VLC PID {}",
        session.vlc_pid()
    );
    session.start()?;
    let deadline = Instant::now() + Duration::from_secs(limit);
    while !session.is_complete() && Instant::now() < deadline {
        session.tick()?;
        thread::sleep(Duration::from_millis(20));
    }
    if !session.is_complete() {
        session.stop()?;
        return Err("Experiment exceeded its playback deadline".into());
    }
    let preview = session.snapshot();
    let summary = session.summary().ok_or("Missing XDF summary")?;
    println!(
        "XDF: {} | affect samples: {} | markers: {} | live preview: {} samples, {} markers",
        summary.xdf.display(),
        summary.affect_samples,
        summary.markers.join(", "),
        preview.history.len(),
        preview.markers.len()
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Flubbercorder: {error}");
        std::process::exit(1);
    }
}

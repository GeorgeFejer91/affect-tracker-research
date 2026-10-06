use labstream::{Buffer, Inlet, Post, Query};
use std::error::Error;
use std::time::{Duration, Instant};

fn run() -> Result<(), Box<dyn Error>> {
    let seconds = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "12".into())
        .parse::<u64>()?;
    let timeout = Duration::from_secs(15);
    let affect = labstream::resolve_first(&Query::name("VLC_Flubber_Affect"), timeout)?
        .ok_or("Flubber affect LSL outlet not discovered")?
        .fetch(timeout)?;
    let markers = labstream::resolve_first(&Query::name("VLC_Flubber_Markers"), timeout)?
        .ok_or("Flubber marker LSL outlet not discovered")?
        .fetch(timeout)?;
    if !affect.source_id().starts_with("vlc-flubber-libvlc-")
        || !markers.source_id().starts_with("vlc-flubber-libvlc-")
    {
        return Err("Unexpected Flubber LSL source".into());
    }
    let mut affect = Inlet::builder(&affect)
        .buffer(Buffer::Seconds(2.0))
        .recover(false)
        .postprocess(Post::NONE)
        .open(timeout)?;
    let mut markers = Inlet::builder(&markers)
        .buffer(Buffer::Samples(16))
        .recover(false)
        .postprocess(Post::NONE)
        .open(timeout)?;
    let start = Instant::now();
    let mut stamps = Vec::new();
    let mut labels = Vec::new();
    while start.elapsed() < Duration::from_secs(seconds) {
        if let Some((stamp, values)) = affect.pull::<f32>(Duration::from_millis(100))? {
            if values.len() != 2 {
                return Err("Affect outlet is not two channels".into());
            }
            stamps.push(stamp);
        }
        while let Some((stamp, value)) = markers.pull_text(Duration::ZERO)? {
            labels.push((stamp, value));
        }
    }
    if stamps.len() < seconds.saturating_sub(2) as usize * 25 {
        return Err(format!("Only {} affect samples received", stamps.len()).into());
    }
    let span = stamps.last().unwrap() - stamps.first().unwrap();
    println!(
        "samples={} span_s={span:.3} rate_hz={:.3} markers={labels:?}",
        stamps.len(),
        (stamps.len() - 1) as f64 / span
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Flubber LSL probe: {error}");
        std::process::exit(1);
    }
}

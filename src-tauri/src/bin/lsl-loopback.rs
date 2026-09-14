use labstream::{Buffer, Channel, Format, Inlet, Outlet, Post, Query, StreamInfo};
use serde::Serialize;
use std::{
    error::Error,
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use uuid::Uuid;

const CHANNEL_LABELS: [&str; 8] = [
    "current_valence",
    "current_arousal",
    "target_valence",
    "target_arousal",
    "radius",
    "angle_degrees",
    "animation_active",
    "input_active",
];

const SAMPLE_RATE_HZ: u16 = 130;
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy)]
struct LslState {
    current_valence: f32,
    current_arousal: f32,
    target_valence: f32,
    target_arousal: f32,
    radius: f32,
    angle_degrees: f32,
    animation_active: bool,
    input_active: bool,
}

impl LslState {
    fn values(self) -> [f32; 8] {
        [
            self.current_valence,
            self.current_arousal,
            self.target_valence,
            self.target_arousal,
            self.radius,
            self.angle_degrees,
            u8::from(self.animation_active) as f32,
            u8::from(self.input_active) as f32,
        ]
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    schema: &'static str,
    version: u8,
    claim: &'static str,
    platform: String,
    commit: Option<String>,
    app_version: &'static str,
    run_id: String,
    source_id: String,
    sample_rate_hz: u16,
    channel_labels: [&'static str; 8],
    state_stream: StreamReceipt,
    marker_stream: StreamReceipt,
    rounds: Vec<RoundReceipt>,
    invalid_marker_rejected: bool,
    duration_ms: u128,
    limitations: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamReceipt {
    name: String,
    stream_type: String,
    source_id: String,
    format: String,
    rate: f64,
    regular: bool,
    channels: Vec<ChannelReceipt>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChannelReceipt {
    label: String,
    unit: String,
    kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoundReceipt {
    label: &'static str,
    marker: &'static str,
    sent_state_at: f64,
    received_state_at: f64,
    sent_marker_at: f64,
    received_marker_at: f64,
    received_state: Vec<f32>,
    received_marker: Vec<String>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let output = std::env::args_os().nth(1).map(PathBuf::from);
    let started = Instant::now();
    let run_id = format!("standalone-loopback-{}", Uuid::new_v4());
    let source_id = format!("affect-research-loopback-{}", Uuid::new_v4());
    let state_source = format!("{source_id}:state:{run_id}");
    let marker_source = format!("{source_id}:markers:{run_id}");

    let state_info = StreamInfo::builder("AffectState", "Affect", Format::Float32)
        .rate(f64::from(SAMPLE_RATE_HZ))
        .source_id(&state_source)
        .channels(CHANNEL_LABELS.map(|label| {
            Channel::new(label)
                .unit(if label == "angle_degrees" {
                    "degrees"
                } else if matches!(label, "animation_active" | "input_active") {
                    "boolean"
                } else {
                    "normalized"
                })
                .kind("Affect")
        }))
        .build()?;
    let marker_info = StreamInfo::builder("AffectMarkers", "Markers", Format::String)
        .irregular()
        .source_id(&marker_source)
        .channels([Channel::new("marker").kind("Markers")])
        .build()?;

    let state_outlet = Outlet::new(state_info)?;
    let marker_outlet = Outlet::new(marker_info)?;

    let discovered_state = labstream::resolve_first(&Query::source_id(&state_source), TIMEOUT)?
        .ok_or_else(|| failure("state outlet was not discoverable"))?;
    let discovered_marker = labstream::resolve_first(&Query::source_id(&marker_source), TIMEOUT)?
        .ok_or_else(|| failure("marker outlet was not discoverable"))?;
    let state_wire = discovered_state.fetch(TIMEOUT)?;
    let marker_wire = discovered_marker.fetch(TIMEOUT)?;
    assert_wire_metadata(&state_wire, &marker_wire, &source_id, &run_id)?;

    let mut state_inlet = Inlet::builder(&state_wire)
        .buffer(Buffer::Seconds(1.0))
        .recover(false)
        .postprocess(Post::NONE)
        .open(TIMEOUT)?;
    let mut marker_inlet = Inlet::builder(&marker_wire)
        .buffer(Buffer::Samples(16))
        .recover(false)
        .postprocess(Post::NONE)
        .open(TIMEOUT)?;

    if !state_outlet.wait_for_consumers(TIMEOUT) || !marker_outlet.wait_for_consumers(TIMEOUT) {
        return Err(
            failure("both LSL outlets must observe their local inlets before sample push").into(),
        );
    }

    let rounds = vec![
        push_and_receive(
            "first",
            &state_outlet,
            &marker_outlet,
            &mut state_inlet,
            &mut marker_inlet,
            LslState {
                current_valence: -0.75,
                current_arousal: 0.25,
                target_valence: 1.0,
                target_arousal: -1.0,
                radius: 0.5,
                angle_degrees: 270.0,
                animation_active: true,
                input_active: false,
            },
            "stimulus_started:stimulus-001",
        )?,
        push_and_receive(
            "second",
            &state_outlet,
            &marker_outlet,
            &mut state_inlet,
            &mut marker_inlet,
            LslState {
                current_valence: 0.5,
                current_arousal: -0.5,
                target_valence: 0.0,
                target_arousal: 0.75,
                radius: 0.25,
                angle_degrees: 90.0,
                animation_active: false,
                input_active: true,
            },
            "session_completed",
        )?,
    ];
    if rounds[1].sent_state_at < rounds[0].sent_state_at
        || rounds[1].sent_marker_at < rounds[0].sent_marker_at
    {
        return Err(failure("LSL clock timestamps moved backward").into());
    }

    let invalid_marker_rejected = validate_marker("participant free text").is_err();
    if !invalid_marker_rejected {
        return Err(failure("invalid marker text was accepted").into());
    }
    if marker_inlet
        .pull_text(Duration::from_millis(100))?
        .is_some()
    {
        return Err(failure("invalid marker unexpectedly appeared on the marker stream").into());
    }

    let receipt = Receipt {
        schema: "affect-research-standalone-lsl-loopback",
        version: 1,
        claim: "standalone labstream LSL loopback only; does not qualify Runner playback, Tauri command wiring, XDF recording, LabRecorder, packaging, or research readiness",
        platform: std::env::consts::OS.to_owned(),
        commit: option_env!("AFFECT_TRACKER_BUILD_COMMIT").map(str::to_owned).or_else(|| {
            std::env::var("GITHUB_SHA")
                .ok()
                .or_else(|| std::env::var("AFFECT_RESEARCH_COMMIT").ok())
        }),
        app_version: env!("CARGO_PKG_VERSION"),
        run_id,
        source_id,
        sample_rate_hz: SAMPLE_RATE_HZ,
        channel_labels: CHANNEL_LABELS,
        state_stream: describe(&state_wire),
        marker_stream: describe(&marker_wire),
        rounds,
        invalid_marker_rejected,
        duration_ms: started.elapsed().as_millis(),
        limitations: vec![
            "same-machine loopback through labstream",
            "does not launch the Experiment Runner",
            "does not exercise native video playback or the sampling scheduler",
            "does not write or verify XDF",
            "does not use an independent external LabRecorder receiver",
        ],
    };
    let text = serde_json::to_string_pretty(&receipt)? + "\n";
    if let Some(path) = output {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, text)?;
    } else {
        print!("{text}");
    }
    Ok(())
}

fn push_and_receive(
    label: &'static str,
    state_outlet: &Outlet,
    marker_outlet: &Outlet,
    state_inlet: &mut Inlet,
    marker_inlet: &mut Inlet,
    state: LslState,
    marker: &'static str,
) -> Result<RoundReceipt, Box<dyn Error>> {
    validate_marker(marker)?;
    let values = state.values();
    let sent_state_at = labstream::clock();
    state_outlet.push_at(&values, sent_state_at)?;
    let sent_marker_at = labstream::clock();
    marker_outlet.push_text_at(marker, sent_marker_at)?;
    let (received_state_at, received_state) = state_inlet
        .pull::<f32>(TIMEOUT)?
        .ok_or_else(|| failure("state sample was not received"))?;
    let (received_marker_at, received_marker) = marker_inlet
        .pull_text(TIMEOUT)?
        .ok_or_else(|| failure("marker sample was not received"))?;
    if received_state != values {
        return Err(failure("received state sample does not match pushed LSL values").into());
    }
    if received_marker != vec![marker.to_owned()] {
        return Err(failure("received marker does not match pushed LSL marker").into());
    }
    if (received_state_at - sent_state_at).abs() > f64::EPSILON
        || (received_marker_at - sent_marker_at).abs() > f64::EPSILON
    {
        return Err(failure("received LSL timestamps do not match pushed timestamps").into());
    }
    Ok(RoundReceipt {
        label,
        marker,
        sent_state_at,
        received_state_at,
        sent_marker_at,
        received_marker_at,
        received_state,
        received_marker,
    })
}

fn assert_wire_metadata(
    state: &StreamInfo,
    marker: &StreamInfo,
    source_id: &str,
    run_id: &str,
) -> Result<(), Box<dyn Error>> {
    expect(state.name() == "AffectState", "state stream name drifted")?;
    expect(state.stream_type() == "Affect", "state stream type drifted")?;
    expect(
        state.source_id() == format!("{source_id}:state:{run_id}"),
        "state source_id drifted",
    )?;
    expect(state.format() == Format::Float32, "state format drifted")?;
    expect(state.rate() == 130.0, "state sample rate drifted")?;
    expect(state.is_regular(), "state stream must be regular")?;
    expect(state.channel_count() == 8, "state channel count drifted")?;
    expect(
        state
            .channels()
            .iter()
            .map(|channel| channel.label.as_str())
            .eq(CHANNEL_LABELS),
        "state channel order drifted",
    )?;
    expect(
        state
            .channels()
            .iter()
            .map(|channel| channel.unit.as_str())
            .eq([
                "normalized",
                "normalized",
                "normalized",
                "normalized",
                "normalized",
                "degrees",
                "boolean",
                "boolean",
            ]),
        "state channel units drifted",
    )?;
    expect(
        state
            .channels()
            .iter()
            .all(|channel| channel.kind == "Affect"),
        "state channel kind drifted",
    )?;

    expect(
        marker.name() == "AffectMarkers",
        "marker stream name drifted",
    )?;
    expect(
        marker.stream_type() == "Markers",
        "marker stream type drifted",
    )?;
    expect(
        marker.source_id() == format!("{source_id}:markers:{run_id}"),
        "marker source_id drifted",
    )?;
    expect(marker.format() == Format::String, "marker format drifted")?;
    expect(marker.rate() == 0.0, "marker rate drifted")?;
    expect(!marker.is_regular(), "marker stream must be irregular")?;
    expect(marker.channel_count() == 1, "marker channel count drifted")?;
    expect(
        marker.channels() == vec![Channel::new("marker").kind("Markers")],
        "marker channel metadata drifted",
    )?;
    Ok(())
}

fn describe(info: &StreamInfo) -> StreamReceipt {
    StreamReceipt {
        name: info.name().to_owned(),
        stream_type: info.stream_type().to_owned(),
        source_id: info.source_id().to_owned(),
        format: format!("{:?}", info.format()),
        rate: info.rate(),
        regular: info.is_regular(),
        channels: info
            .channels()
            .iter()
            .map(|channel| ChannelReceipt {
                label: channel.label.clone(),
                unit: channel.unit.clone(),
                kind: channel.kind.clone(),
            })
            .collect(),
    }
}

fn validate_marker(marker: &str) -> Result<(), std::io::Error> {
    if marker.is_empty()
        || marker.len() > 256
        || !marker
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-' | b'.'))
    {
        return Err(failure("marker must be a bounded semantic code"));
    }
    Ok(())
}

fn expect(condition: bool, message: &'static str) -> Result<(), std::io::Error> {
    if condition {
        Ok(())
    } else {
        Err(failure(message))
    }
}

fn failure(message: &'static str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, message)
}

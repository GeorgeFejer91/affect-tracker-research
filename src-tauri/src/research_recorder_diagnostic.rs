#![cfg(all(feature = "lsl-streaming", target_os = "windows"))]

use crate::research_error::{CommandError, ResearchResult};
use crate::research_lsl::LslState;
use crate::research_recorder::{RecordStartRequest, RecorderService, RecorderStatus};
use crate::research_runner_master::{
    forms::FormAnswers,
    information::{startup_bundle, ContentKind, PreparedTransfer, CHUNK_BYTES},
    lsl::MasterLslService,
    markers::{MarkerEvent, MasterMarkers},
    runtime::MasterChoice,
    MasterSelector, MasterStepKind, PreparedMaster,
};
use labstream::{Channel, Format, Outlet, StreamInfo};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use uuid::Uuid;

const SAMPLE_RATE_HZ: u16 = 130;
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingDiagnosticReceipt {
    schema: &'static str,
    version: u8,
    claim: &'static str,
    platform: &'static str,
    commit: Option<String>,
    app_version: &'static str,
    xdf_path: String,
    xdf_sha256: String,
    xdf_byte_length: u64,
    recording_status: RecorderStatus,
    participant_id: &'static str,
    run_id: String,
    attempt_id: String,
    recipe_source_byte_sha256: String,
    plan_identity_sha256: String,
    sample_rate_hz: u16,
    expected_sample_count: u64,
    external_sample_count: u64,
    selected_external_stream: ExternalReceipt,
    completed_step_count: usize,
    information_payloads: InformationPayloadReceipt,
    limitations: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalReceipt {
    name: &'static str,
    stream_type: &'static str,
    source_id: String,
    channel_format: &'static str,
    channel_count: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InformationPayloadReceipt {
    startup: u64,
    observations: u64,
    responses: u64,
    outcome: u64,
    affect_state_samples: u64,
}

pub fn run(xdf_path: PathBuf, receipt_path: PathBuf) -> ResearchResult<()> {
    if xdf_path.extension().is_none_or(|value| value != "xdf") {
        return Err(CommandError::invalid_contract(
            "Diagnostic XDF output must use the .xdf extension.",
        ));
    }
    if receipt_path.extension().is_none_or(|value| value != "json") {
        return Err(CommandError::invalid_contract(
            "Diagnostic receipt output must use the .json extension.",
        ));
    }
    if let Some(parent) = xdf_path.parent() {
        fs::create_dir_all(parent).map_err(CommandError::io)?;
    }
    if let Some(parent) = receipt_path.parent() {
        fs::create_dir_all(parent).map_err(CommandError::io)?;
    }

    let source = include_str!("../../test/fixtures/runner-master-lsl-synthetic-v1.canonical.json");
    let participant_id = "P001";
    let prepared = PreparedMaster::read(
        source,
        participant_id,
        MasterSelector {
            variant_id: "variant-3".into(),
            language_id: "en".into(),
            language_selection_path: vec!["both".into(), "en".into()],
            presentation_target: "desktop-screen".into(),
        },
    )?;
    let run_id = format!("diagnostic-run-{}", Uuid::new_v4());
    let attempt_id = format!("diagnostic-attempt-{}", Uuid::new_v4());
    let external_source_id = format!("diagnostic-external-{}", Uuid::new_v4());
    let external_outlet = Outlet::new(
        StreamInfo::builder(
            "Runner diagnostic external Int64",
            "Diagnostic",
            Format::Int64,
        )
        .source_id(&external_source_id)
        .irregular()
        .channels([Channel::new("integer").kind("Diagnostic")])
        .build()
        .map_err(|_| CommandError::io("The diagnostic external LSL metadata was rejected."))?,
    )
    .map_err(|_| CommandError::io("The diagnostic external LSL outlet could not start."))?;

    let recorder = RecorderService::default();
    let (discovery_revision, external_key) = discover_external(&recorder, &external_source_id)?;
    let request = RecordStartRequest {
        experiment_package_source_text: source.into(),
        record_own: true,
        discovery_revision: Some(discovery_revision),
        stream_keys: vec![external_key],
    };
    let recipe_hash = request.validate()?;
    if recipe_hash != prepared.plan.recipe_source_byte_sha256 {
        return Err(CommandError::new(
            "diagnostic_identity",
            "Prepared master identity differs from recorder recipe identity.",
        ));
    }
    recorder.start_path(request, xdf_path.clone())?;
    if !external_outlet.wait_for_consumers(DISCOVERY_TIMEOUT) {
        return Err(CommandError::new(
            "diagnostic_external_lsl",
            "The recorder did not connect to the selected external diagnostic stream.",
        ));
    }

    let mut markers = MasterMarkers::new(&prepared.plan, &run_id, &attempt_id)?;
    let settings = crate::research_runner_session::participant_lsl(
        &prepared.loaded.recipe.policy().lsl,
        participant_id,
    )?;
    let startup = startup_bundle(
        &prepared,
        &markers,
        &settings,
        serde_json::json!({"participantId":participant_id,"participantCode":"TP","age":30,"gender":"X","handedness":"R"}),
    );
    let mut expected = framed_count(&startup)?;
    let mut payloads = InformationPayloadReceipt {
        startup: 1,
        observations: 0,
        responses: 0,
        outcome: 0,
        affect_state_samples: 0,
    };
    let mut service = MasterLslService::start(
        &settings,
        SAMPLE_RATE_HZ,
        &run_id,
        &recipe_hash,
        &recorder,
        &attempt_id,
        PreparedTransfer::new(&startup)?,
    )?;

    let mut monotonic_ms = 0.0;
    service.observe(&markers.observe(MarkerEvent::SessionStart, None, None, monotonic_ms)?)?;
    expected += 3;
    payloads.observations += 1;
    let mut external_samples = 0u64;
    for step in &prepared.plan.steps {
        let execution = format!("execution-diagnostic-{}", step.position);
        let (start, end) = match step.kind {
            MasterStepKind::Questionnaire => (MarkerEvent::FormStart, MarkerEvent::FormEnd),
            MasterStepKind::Interval => (MarkerEvent::IsiStart, MarkerEvent::IsiEnd),
            MasterStepKind::Video => (MarkerEvent::VideoStart, MarkerEvent::VideoEnd),
        };
        monotonic_ms += 1.0;
        service.observe(&markers.observe(
            start,
            Some(&step.entry_id),
            Some(&execution),
            monotonic_ms,
        )?)?;
        expected += 3;
        payloads.observations += 1;
        monotonic_ms += step.duration_ms.unwrap_or(250) as f64;
        match step.kind {
            MasterStepKind::Questionnaire => {
                let now = Instant::now();
                let choices = step.payload["definition"]["items"]
                    .as_array()
                    .ok_or_else(|| {
                        CommandError::invalid_contract(
                            "Diagnostic questionnaire definition has no items.",
                        )
                    })?
                    .iter()
                    .map(|item| MasterChoice {
                        item_id: item["itemId"].as_str().unwrap_or_default().into(),
                        option_id: item["options"][0]
                            .get("optionId")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .into(),
                    })
                    .collect();
                let mut record = FormAnswers::default().replace(
                    step,
                    choices,
                    true,
                    now,
                    now + Duration::from_millis(125),
                )?;
                record["runId"] = serde_json::json!(run_id);
                record["attemptId"] = serde_json::json!(attempt_id);
                record["participantId"] = serde_json::json!(participant_id);
                record["recipeSourceByteSha256"] =
                    serde_json::json!(prepared.plan.recipe_source_byte_sha256);
                record["planIdentitySha256"] =
                    serde_json::json!(prepared.plan.plan_identity_sha256);
                record["monotonicMs"] = serde_json::json!(monotonic_ms);
                service.record(ContentKind::Responses, &record)?;
                expected += 3;
                payloads.responses += 1;
            }
            MasterStepKind::Video => {
                service.state(LslState {
                    current_valence: 0.25,
                    current_arousal: -0.5,
                    target_valence: 0.25,
                    target_arousal: -0.5,
                    radius: 0.5590169943749475,
                    angle_degrees: 296.565051177078,
                    animation_active: true,
                    input_active: true,
                })?;
                expected += 1;
                payloads.affect_state_samples += 1;
                external_outlet
                    .push_at(&[i64::from(step.position)], labstream::clock())
                    .map_err(|_| {
                        CommandError::io("The diagnostic external LSL sample was rejected.")
                    })?;
                external_samples += 1;
                expected += 1;
            }
            MasterStepKind::Interval => {}
        }
        service.observe(&markers.observe(
            end,
            Some(&step.entry_id),
            Some(&execution),
            monotonic_ms,
        )?)?;
        expected += 3;
        payloads.observations += 1;
    }
    service.observe(&markers.observe(MarkerEvent::Complete, None, None, monotonic_ms + 1.0)?)?;
    expected += 3;
    payloads.observations += 1;
    let outcome = serde_json::json!({"schema":"affect-runner-outcome","version":1,"protocolOutcome":"completed","completedStepCount":prepared.plan.steps.len(),"failureCode":null,"monotonicMs":monotonic_ms+2.0,"localCheckpoint":"durable","recordingFinalization":"pending"});
    service.record(ContentKind::Outcome, &outcome)?;
    expected += 3;
    payloads.outcome = 1;
    wait_for_samples(&recorder, expected, DISCOVERY_TIMEOUT)?;
    drop(service);
    let status = recorder.stop()?;
    if status.phase != "complete" || status.sample_count != expected {
        return Err(CommandError::new(
            "diagnostic_recording",
            format!(
                "Diagnostic recording ended as {} with {} samples; expected {expected}.",
                status.phase, status.sample_count
            ),
        ));
    }

    let metadata = fs::metadata(&xdf_path).map_err(CommandError::io)?;
    let xdf_sha256 = sha256_file(&xdf_path)?;
    let receipt = RecordingDiagnosticReceipt {
        schema: "affect-runner-master-recording-diagnostic",
        version: 1,
        claim: "non-interactive Runner master recording/XDF diagnostic; validates real RecorderService, own master LSL state/marker recording, selected external LSL stream capture, information framing, durable XDF footer path, and receipts; does not qualify installed GUI playback, Tauri command wiring, external LabRecorder, full-duration timing, or research readiness",
        platform: std::env::consts::OS,
        commit: option_env!("AFFECT_TRACKER_BUILD_COMMIT")
            .map(str::to_owned)
            .or_else(|| std::env::var("GITHUB_SHA").ok())
            .or_else(|| std::env::var("AFFECT_RESEARCH_COMMIT").ok()),
        app_version: env!("CARGO_PKG_VERSION"),
        xdf_path: xdf_path.display().to_string(),
        xdf_sha256,
        xdf_byte_length: metadata.len(),
        recording_status: status,
        participant_id,
        run_id,
        attempt_id,
        recipe_source_byte_sha256: prepared.plan.recipe_source_byte_sha256,
        plan_identity_sha256: prepared.plan.plan_identity_sha256,
        sample_rate_hz: SAMPLE_RATE_HZ,
        expected_sample_count: expected,
        external_sample_count: external_samples,
        selected_external_stream: ExternalReceipt {
            name: "Runner diagnostic external Int64",
            stream_type: "Diagnostic",
            source_id: external_source_id,
            channel_format: "int64",
            channel_count: 1,
        },
        completed_step_count: prepared.plan.steps.len(),
        information_payloads: payloads,
        limitations: vec![
            "does not launch the installed Tauri Runner window",
            "does not exercise native video playback or display geometry",
            "does not exercise physical keyboard/gamepad acquisition timing",
            "does not use an independent external LabRecorder process",
            "does not run for the full research-session duration",
            "does not qualify GitHub Pages browser CSV output",
        ],
    };
    write_json_new(&receipt_path, &receipt)
}

fn framed_count(value: &impl Serialize) -> ResearchResult<u64> {
    Ok(2 + crate::research_contracts::canonical_json(value, &[])?
        .len()
        .div_ceil(CHUNK_BYTES) as u64)
}

fn discover_external(
    recorder: &RecorderService,
    source_id: &str,
) -> ResearchResult<(String, String)> {
    let deadline = Instant::now() + DISCOVERY_TIMEOUT;
    loop {
        let discovery = recorder.discover()?;
        if let Some(choice) = discovery
            .streams
            .into_iter()
            .find(|choice| choice.source_id == source_id)
        {
            return Ok((discovery.revision, choice.key));
        }
        if Instant::now() >= deadline {
            return Err(CommandError::new(
                "diagnostic_discovery",
                "The recorder did not discover the synthetic external LSL stream.",
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn wait_for_samples(
    recorder: &RecorderService,
    expected: u64,
    timeout: Duration,
) -> ResearchResult<()> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if recorder.status().sample_count >= expected {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err(CommandError::new(
        "diagnostic_recording",
        format!(
            "Recorder did not observe {expected} diagnostic samples before timeout; observed {}.",
            recorder.status().sample_count
        ),
    ))
}

fn sha256_file(path: &Path) -> ResearchResult<String> {
    let bytes = fs::read(path).map_err(CommandError::io)?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

fn write_json_new(path: &Path, value: &impl Serialize) -> ResearchResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(CommandError::io)?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|_| {
        CommandError::new(
            "diagnostic_receipt",
            "The diagnostic receipt could not be serialized.",
        )
    })?;
    file.write_all(b"\n").map_err(CommandError::io)?;
    file.sync_all().map_err(CommandError::io)
}

//! One explicit Planner-master video occurrence, without claiming a Runner session.
use super::{live, run_with_args_cancellable, Args, Result};
use affect_research::research_runner_master::{
    MasterSelector, MasterStep, MasterStepKind, PreparedMaster,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn selected_asset<'a>(steps: &'a [MasterStep], entry_id: &str) -> Result<&'a Value> {
    let matches: Vec<_> = steps
        .iter()
        .filter(|step| step.entry_id == entry_id && step.kind == MasterStepKind::Video)
        .collect();
    let [step] = matches.as_slice() else {
        return Err("Choose one exact saved video occurrence entry ID".into());
    };
    Ok(&step.payload["asset"])
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveHostBinding {
    attempt_id: String,
    generation: u64,
    workspace_file_id: String,
}

fn asset_path(master: &Path, asset: &Value) -> Result<PathBuf> {
    let relative = asset["packageRelativePath"]
        .as_str()
        .ok_or("Selected video has no package-relative path")?;
    if !relative.starts_with("assets/stimuli/") {
        return Err("Selected video is outside the saved asset root".into());
    }
    let master = master.canonicalize()?;
    let root = master
        .parent()
        .ok_or("Master has no containing directory")?;
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(name) = component else {
            return Err("Selected video path is not portable".into());
        };
        target.push(name);
        if fs::symlink_metadata(&target)?.file_attributes() & 0x400 != 0 {
            return Err("Selected video path contains a link".into());
        }
    }
    let resolved = target.canonicalize()?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err("Selected video does not resolve to a saved asset file".into());
    }
    Ok(resolved)
}

fn copy_verified_cancellable(
    source: &Path,
    destination: &Path,
    expected_bytes: u64,
    expected_sha: &str,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<()> {
    let result = (|| {
        let mut input = File::open(source)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        let mut digest = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            if cancelled(cancel) {
                return Err("Selected sequence stopped while copying video".into());
            }
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read as u64)
                .ok_or("Selected video is too large")?;
            if total > expected_bytes {
                return Err("Selected video byte length changed".into());
            }
            digest.update(&buffer[..read]);
            output.write_all(&buffer[..read])?;
        }
        output.sync_all()?;
        if total != expected_bytes || format!("{:x}", digest.finalize()) != expected_sha {
            return Err("Selected video bytes do not match the saved master".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn file_sha256(path: &Path, cancel: Option<&Arc<AtomicBool>>) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if cancelled(cancel) {
            return Err("Selected sequence stopped while hashing master".into());
        }
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SequenceBinding {
    pub(super) master_file_byte_sha256: String,
    pub(super) recipe_source_byte_sha256: String,
    pub(super) plan_identity_sha256: String,
    pub(super) participant_id: String,
    pub(super) selector: Value,
}

impl SequenceBinding {
    pub(super) fn terminal_error(&self, status: &str, error: &str) -> Value {
        json!({
            "schema":"flubber-vlc-selected-sequence-status",
            "version":1,
            "status":status,
            "error":error,
            "recipeSourceByteSha256":self.recipe_source_byte_sha256,
            "masterFileByteSha256":self.master_file_byte_sha256,
            "planIdentitySha256":self.plan_identity_sha256,
            "participantId":self.participant_id,
            "selector":self.selector,
            "sharedRunnerRecordingQualified":false
        })
    }
}

fn read_sequence(
    master: &Path,
    participant: &str,
    selector: MasterSelector,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(PreparedMaster, SequenceBinding)> {
    let before = file_sha256(master, cancel)?;
    let prepared = PreparedMaster::read_file(master, participant, selector)?;
    sequence_occurrences(&prepared.plan.steps)?;
    if file_sha256(master, cancel)? != before {
        return Err("Saved master changed during sequence selection".into());
    }
    let binding = SequenceBinding {
        master_file_byte_sha256: before,
        recipe_source_byte_sha256: prepared.plan.recipe_source_byte_sha256.clone(),
        plan_identity_sha256: prepared.plan.plan_identity_sha256.clone(),
        participant_id: prepared.plan.participant_id.clone(),
        selector: serde_json::to_value(&prepared.plan.selector)?,
    };
    Ok((prepared, binding))
}

pub(super) fn verify_sequence_binding(
    master: &Path,
    participant: &str,
    selector: MasterSelector,
    expected: &SequenceBinding,
) -> Result<()> {
    if file_sha256(master, None)? != expected.master_file_byte_sha256 {
        return Err("Saved master changed after Arm".into());
    }
    let (_, current) = read_sequence(master, participant, selector, None)?;
    if &current != expected {
        return Err("Selected plan changed after Arm".into());
    }
    Ok(())
}

pub(super) fn run(
    master: &Path,
    participant: &str,
    selector_json: &str,
    entry_id: &str,
    data_dir: Option<PathBuf>,
) -> Result<Value> {
    run_cancellable(
        master,
        participant,
        selector_json,
        entry_id,
        data_dir,
        None,
        None,
    )
}

pub(super) fn run_live(
    master: &Path,
    participant: &str,
    selector_json: &str,
    entry_id: &str,
    data_dir: Option<PathBuf>,
    binding_json: &str,
) -> Result<Value> {
    let binding: LiveHostBinding = serde_json::from_str(binding_json)?;
    if binding.attempt_id.is_empty()
        || binding.attempt_id.len() > 128
        || !binding
            .attempt_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
        || binding.generation == 0
        || binding.workspace_file_id.is_empty()
        || binding.workspace_file_id.len() > 128
        || !binding
            .workspace_file_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
    {
        return Err("Live Runner binding needs attempt, generation, and workspace file".into());
    }
    run_cancellable(
        master,
        participant,
        selector_json,
        entry_id,
        data_dir,
        None,
        Some(binding),
    )
}

fn run_cancellable(
    master: &Path,
    participant: &str,
    selector_json: &str,
    entry_id: &str,
    data_dir: Option<PathBuf>,
    cancel: Option<&Arc<AtomicBool>>,
    live_host: Option<LiveHostBinding>,
) -> Result<Value> {
    if cancelled(cancel) {
        return Err("Selected sequence stopped before video binding".into());
    }
    let selector: MasterSelector = serde_json::from_str(selector_json)?;
    let master_sha = file_sha256(master, cancel)?;
    let prepared = PreparedMaster::read_file(master, participant, selector)?;
    let asset = selected_asset(&prepared.plan.steps, entry_id)?;
    let live_position = if live_host.is_some() {
        Some(
            prepared
                .plan
                .steps
                .iter()
                .find(|step| step.entry_id == entry_id && step.kind == MasterStepKind::Video)
                .ok_or("Selected live occurrence disappeared")?
                .position,
        )
    } else {
        None
    };
    let expected_sha = asset["sha256"]
        .as_str()
        .ok_or("Selected video has no hash")?;
    let expected_bytes = asset["byteLength"]
        .as_u64()
        .ok_or("Selected video has no length")?;
    let duration_ms = asset["durationMs"]
        .as_u64()
        .ok_or("Selected video has no duration")?;
    let source = asset_path(master, asset)?;
    let root = match data_dir {
        Some(path) => path,
        None => PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player"),
    };
    let runs = root.join("selected-master");
    fs::create_dir_all(&runs)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let run_dir = runs.join(format!("{}-{stamp}", std::process::id()));
    fs::create_dir(&run_dir)?;
    let run_dir = run_dir.canonicalize()?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 12
                && value.bytes().all(|b| b.is_ascii_alphanumeric())
        })
        .ok_or("Selected video has no usable extension")?;
    let copy = run_dir.join(format!("selected.{extension}"));
    copy_verified_cancellable(&source, &copy, expected_bytes, expected_sha, cancel)?;
    if !matches!(asset_path(master, asset), Ok(current) if current == source)
        || !matches!(file_sha256(master, cancel), Ok(current) if current == master_sha)
    {
        let _ = fs::remove_file(&copy);
        return Err("Saved master or selected video changed during binding".into());
    }
    let playback = run_with_args_cancellable(
        Args {
            video: Some(copy.clone()),
            data_dir: Some(run_dir.clone()),
            wait: true,
            selected_master_video: true,
            master_duration_ms: Some(duration_ms),
            live: live_host
                .zip(live_position)
                .map(|(host, position)| live::Binding {
                    attempt_id: host.attempt_id,
                    position,
                    generation: host.generation,
                    workspace_file_id: host.workspace_file_id,
                    asset_sha256: expected_sha.to_owned(),
                }),
            ..Args::default()
        },
        cancel,
    );
    let _ = fs::remove_file(copy);
    playback?;
    Ok(json!({
        "schema":"flubber-vlc-selected-video-status",
        "version":1,
        "status":"ended",
        "terminalObservation":"decoded-sentinel-video-complete",
        "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,
        "masterFileByteSha256":master_sha,
        "planIdentitySha256":prepared.plan.plan_identity_sha256,
        "participantId":prepared.plan.participant_id,
        "selector":prepared.plan.selector,
        "entryId":entry_id,
        "assetId":asset["assetId"],
        "assetSha256":expected_sha,
        "assetByteLength":expected_bytes,
        "evidenceDirectory":run_dir,
        "sharedRunnerRecordingQualified":false
    }))
}

fn cancelled(cancel: Option<&Arc<AtomicBool>>) -> bool {
    cancel.is_some_and(|flag| flag.load(Ordering::Acquire))
}

fn wait_interval(duration: Duration, cancel: Option<&Arc<AtomicBool>>) -> Result<bool> {
    let deadline = Instant::now()
        .checked_add(duration)
        .ok_or("ISI deadline is not representable")?;
    loop {
        if cancelled(cancel) {
            return Ok(false);
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return Ok(true);
        };
        thread::sleep(remaining.min(Duration::from_millis(20)));
    }
}

#[derive(Debug)]
struct SequenceOccurrence<'a> {
    generation: u64,
    step: &'a MasterStep,
}

fn sequence_occurrences(steps: &[MasterStep]) -> Result<Vec<SequenceOccurrence<'_>>> {
    if steps.is_empty() {
        return Err("Selected master has no executable steps".into());
    }
    steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let generation = u64::try_from(index + 1)?;
            if u64::from(step.position) != generation {
                return Err("Selected master step order is not contiguous".into());
            }
            match step.kind {
                MasterStepKind::Questionnaire => {
                    return Err(format!(
                        "Questionnaire step {} is unsupported by the VLC player",
                        step.entry_id
                    )
                    .into());
                }
                MasterStepKind::Video if !step.payload["asset"].is_object() => {
                    return Err(
                        format!("Video step {} has no selected asset", step.entry_id).into(),
                    );
                }
                MasterStepKind::Video | MasterStepKind::Interval => {}
            }
            if step.duration_ms.is_none() {
                return Err(format!("Step {} has no declared duration", step.entry_id).into());
            }
            Ok(SequenceOccurrence { generation, step })
        })
        .collect()
}

pub(super) fn preflight_sequence(
    master: &Path,
    participant: &str,
    selector: MasterSelector,
) -> Result<SequenceBinding> {
    read_sequence(master, participant, selector, None).map(|(_, binding)| binding)
}

fn unix_ms() -> Result<u64> {
    Ok(u64::try_from(
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis(),
    )?)
}

fn video_csv_times(evidence_directory: &Path) -> Result<(PathBuf, i64, i64)> {
    let mut csvs = Vec::new();
    for entry in fs::read_dir(evidence_directory.join("recordings"))? {
        let path = entry?.path();
        if path.extension().is_some_and(|extension| extension == "csv")
            && !path
                .file_stem()
                .is_some_and(|stem| stem.to_string_lossy().ends_with("-timeseries"))
        {
            csvs.push(path);
        }
    }
    let [csv] = csvs.as_slice() else {
        return Err("Selected occurrence must have exactly one event CSV".into());
    };
    let mut start = None;
    let mut complete = None;
    let mut end = None;
    for (index, line) in fs::read_to_string(csv)?.lines().enumerate() {
        let mut columns = line.split(',');
        let event = columns.next().unwrap_or_default();
        if !matches!(event, "video_start" | "video_complete" | "video_end") {
            continue;
        }
        let media_ms: i64 = columns
            .next()
            .ok_or("VLC event has no media time")?
            .parse()?;
        if media_ms < 0 {
            return Err("VLC event has a negative media time".into());
        }
        let slot = match event {
            "video_start" => &mut start,
            "video_complete" => &mut complete,
            _ => &mut end,
        };
        if slot.replace((index, media_ms)).is_some() {
            return Err("VLC event CSV repeats a terminal event".into());
        }
    }
    let (Some((start_index, start_ms)), Some((complete_index, complete_ms)), Some((end_index, _))) =
        (start, complete, end)
    else {
        return Err("VLC event CSV lacks decoded start or completion".into());
    };
    if !(start_index < complete_index && complete_index < end_index) {
        return Err("VLC event CSV has an invalid playback order".into());
    }
    Ok((csv.clone(), start_ms, complete_ms))
}

fn sequence_receipt(
    prepared: &PreparedMaster,
    master_sha: &str,
    run_dir: &Path,
    events: &[Value],
    status: &str,
) -> Value {
    json!({
        "schema":"flubber-vlc-selected-sequence-status",
        "version":1,
        "status":status,
        "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,
        "masterFileByteSha256":master_sha,
        "planIdentitySha256":prepared.plan.plan_identity_sha256,
        "participantId":prepared.plan.participant_id,
        "selector":prepared.plan.selector,
        "evidenceDirectory":run_dir,
        "events":events,
        "sharedRunnerRecordingQualified":false
    })
}

pub(super) fn run_sequence(
    master: &Path,
    participant: &str,
    selector_json: &str,
    data_dir: Option<PathBuf>,
) -> Result<Value> {
    run_sequence_cancellable(master, participant, selector_json, data_dir, None, None)
}

pub(super) fn run_sequence_cancellable(
    master: &Path,
    participant: &str,
    selector_json: &str,
    data_dir: Option<PathBuf>,
    cancel: Option<&Arc<AtomicBool>>,
    expected: Option<&SequenceBinding>,
) -> Result<Value> {
    if cancelled(cancel) {
        return Err("Selected sequence stopped before preflight".into());
    }
    let selector: MasterSelector = serde_json::from_str(selector_json)?;
    // Preflight the entire selected chronology before opening any media. A form
    // requires its own participant UI; skipping it would change the experiment.
    let (prepared, binding) = read_sequence(master, participant, selector, cancel)?;
    if expected.is_some_and(|armed| armed != &binding) {
        return Err("Arm-bound master or selected plan changed before playback".into());
    }
    let master_sha = binding.master_file_byte_sha256;
    let occurrences = sequence_occurrences(&prepared.plan.steps)?;
    let root = match data_dir {
        Some(path) => path,
        None => PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("VLC_Flubber_Player"),
    };
    let runs = root.join("selected-sequence");
    fs::create_dir_all(&runs)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let run_dir = runs.join(format!("{}-{stamp}", std::process::id()));
    fs::create_dir(&run_dir)?;
    let run_dir = run_dir.canonicalize()?;
    let mut events = Vec::new();
    for occurrence in occurrences {
        let step = occurrence.step;
        let generation = occurrence.generation;
        if cancelled(cancel) {
            events.push(json!({"event":"stopped","position":step.position,"entryId":step.entry_id,"generation":generation,"observedAtUnixMs":unix_ms()?}));
            return Ok(sequence_receipt(
                &prepared,
                &master_sha,
                &run_dir,
                &events,
                "stopped",
            ));
        }
        let executed = (|| -> Result<Vec<Value>> {
            if file_sha256(master, cancel)? != master_sha {
                return Err("Saved master changed after sequence selection".into());
            }
            let result = match step.kind {
                MasterStepKind::Video => {
                    let step_dir = run_dir.join(format!("step-{}-{generation}", step.position));
                    let receipt = run_cancellable(
                        master,
                        participant,
                        selector_json,
                        &step.entry_id,
                        Some(step_dir),
                        cancel,
                        None,
                    )?;
                    if receipt["masterFileByteSha256"].as_str() != Some(master_sha.as_str())
                        || receipt["planIdentitySha256"].as_str()
                            != Some(prepared.plan.plan_identity_sha256.as_str())
                    {
                        return Err("Selected video no longer matches the sequence plan".into());
                    }
                    let evidence = receipt["evidenceDirectory"]
                        .as_str()
                        .ok_or("Selected video has no evidence directory")?;
                    let (csv, start_ms, complete_ms) = video_csv_times(Path::new(evidence))?;
                    let confirmed = unix_ms()?;
                    vec![
                        json!({"event":"videoStart","position":step.position,"entryId":step.entry_id,"generation":generation,"sourceCode":step.source_code,"assetSha256":receipt["assetSha256"],"mediaTimeMs":start_ms,"confirmedAtUnixMs":confirmed,"observationSource":"plugin-csv-post-run","eventCsvPath":csv}),
                        json!({"event":"videoEnd","position":step.position,"entryId":step.entry_id,"generation":generation,"sourceCode":step.source_code,"assetSha256":receipt["assetSha256"],"mediaTimeMs":complete_ms,"confirmedAtUnixMs":confirmed,"observationSource":"plugin-csv-post-run","eventCsvPath":csv}),
                    ]
                }
                MasterStepKind::Interval => {
                    let started = unix_ms()?;
                    let clock = Instant::now();
                    if !wait_interval(
                        Duration::from_millis(step.duration_ms.ok_or("ISI has no duration")?),
                        cancel,
                    )? {
                        return Err("Selected sequence stopped during ISI".into());
                    }
                    let ended = unix_ms()?;
                    vec![
                        json!({"event":"isiStart","position":step.position,"entryId":step.entry_id,"generation":generation,"sourceCode":step.source_code,"observedAtUnixMs":started,"observationSource":"launcher-clock"}),
                        json!({"event":"isiEnd","position":step.position,"entryId":step.entry_id,"generation":generation,"sourceCode":step.source_code,"observedAtUnixMs":ended,"elapsedMs":clock.elapsed().as_secs_f64()*1000.,"observationSource":"launcher-clock"}),
                    ]
                }
                MasterStepKind::Questionnaire => unreachable!("forms were rejected in preflight"),
            };
            Ok(result)
        })();
        match executed {
            Ok(step_events) => events.extend(step_events),
            Err(error) => {
                if cancelled(cancel) {
                    events.push(json!({"event":"stopped","position":step.position,"entryId":step.entry_id,"generation":generation,"kind":step.kind,"observedAtUnixMs":unix_ms()?,"reason":error.to_string()}));
                    return Ok(sequence_receipt(
                        &prepared,
                        &master_sha,
                        &run_dir,
                        &events,
                        "stopped",
                    ));
                }
                events.push(json!({"event":"failure","position":step.position,"entryId":step.entry_id,"generation":generation,"kind":step.kind,"observedAtUnixMs":unix_ms()?,"reason":error.to_string()}));
                return Ok(sequence_receipt(
                    &prepared,
                    &master_sha,
                    &run_dir,
                    &events,
                    "failed",
                ));
            }
        }
        if cancelled(cancel) {
            events.push(json!({"event":"stopped","position":step.position,"entryId":step.entry_id,"generation":generation,"kind":step.kind,"observedAtUnixMs":unix_ms()?}));
            return Ok(sequence_receipt(
                &prepared,
                &master_sha,
                &run_dir,
                &events,
                "stopped",
            ));
        }
        if !matches!(file_sha256(master, cancel), Ok(current) if current == master_sha) {
            events.push(json!({"event":"failure","position":step.position,"entryId":step.entry_id,"generation":generation,"kind":step.kind,"observedAtUnixMs":unix_ms()?,"reason":"Saved master changed during sequence execution"}));
            return Ok(sequence_receipt(
                &prepared,
                &master_sha,
                &run_dir,
                &events,
                "failed",
            ));
        }
    }
    Ok(sequence_receipt(
        &prepared,
        &master_sha,
        &run_dir,
        &events,
        "ended",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_binding_rejects_unbounded_or_missing_host_identity_before_file_access() {
        let invalid = [
            r#"{"attemptId":"","generation":1,"workspaceFileId":"wf-1"}"#,
            r#"{"attemptId":"a","generation":0,"workspaceFileId":"wf-1"}"#,
            r#"{"attemptId":"a","generation":1,"workspaceFileId":"../other"}"#,
            r#"{"attemptId":"a","generation":1,"workspaceFileId":"wf-1","assetSha256":"spoof"}"#,
        ];
        for binding in invalid {
            let error = run_live(
                Path::new("absent-master.json"),
                "P001",
                "{}",
                "video-1",
                None,
                binding,
            )
            .unwrap_err();
            assert!(
                error.to_string().contains("Live Runner binding")
                    || error.to_string().contains("unknown field")
            );
        }
    }

    #[test]
    fn interval_wait_observes_cooperative_stop_before_duration() {
        let cancel = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&cancel);
        let stopper = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            signal.store(true, Ordering::Release);
        });
        let started = Instant::now();
        assert!(!wait_interval(Duration::from_secs(2), Some(&cancel)).unwrap());
        stopper.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn selected_occurrence_requires_exact_video_entry() {
        let steps = vec![MasterStep {
            position: 1,
            entry_id: "video-1".into(),
            kind: MasterStepKind::Video,
            source_code: None,
            duration_ms: Some(1000),
            payload: json!({"asset":{"sha256":"abc"}}),
        }];
        assert_eq!(selected_asset(&steps, "video-1").unwrap()["sha256"], "abc");
        assert!(selected_asset(&steps, "video-2").is_err());
    }

    #[test]
    fn sequence_preserves_repeated_video_occurrences_and_isi_order() {
        let video = |position: u32, entry_id: &str| MasterStep {
            position,
            entry_id: entry_id.into(),
            kind: MasterStepKind::Video,
            source_code: Some("V".into()),
            duration_ms: Some(1000),
            payload: json!({"asset":{"assetId":"same-video"}}),
        };
        let steps = vec![
            video(1, "video-a"),
            MasterStep {
                position: 2,
                entry_id: "isi-a".into(),
                kind: MasterStepKind::Interval,
                source_code: Some("I".into()),
                duration_ms: Some(25),
                payload: json!({"definition":{"durationMs":25}}),
            },
            video(3, "video-b"),
        ];
        let selected = sequence_occurrences(&steps).unwrap();
        assert_eq!(
            selected
                .iter()
                .map(|row| (row.generation, row.step.entry_id.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, "video-a"), (2, "isi-a"), (3, "video-b")]
        );
        assert_eq!(
            selected[0].step.payload["asset"],
            selected[2].step.payload["asset"]
        );
        let mut with_form = steps;
        with_form.push(MasterStep {
            position: 4,
            entry_id: "form-a".into(),
            kind: MasterStepKind::Questionnaire,
            source_code: None,
            duration_ms: None,
            payload: json!({}),
        });
        assert!(sequence_occurrences(&with_form)
            .unwrap_err()
            .to_string()
            .contains("form-a"));
    }

    #[test]
    fn video_events_require_one_ordered_decoded_completion() {
        let root = env::temp_dir().join(format!(
            "flubber-events-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let recordings = root.join("recordings");
        fs::create_dir_all(&recordings).unwrap();
        let csv = recordings.join("video.csv");
        fs::write(
            recordings.join("video-timeseries.csv"),
            "time_s,valence,arousal\n",
        )
        .unwrap();
        fs::write(
            &csv,
            "video_start,0,0,0,0\nvideo_complete,990,0,0,0\nvideo_end,990,0,0,0\n",
        )
        .unwrap();
        assert_eq!(video_csv_times(&root).unwrap(), (csv.clone(), 0, 990));
        fs::write(
            &csv,
            "video_end,990,0,0,0\nvideo_start,0,0,0,0\nvideo_complete,990,0,0,0\n",
        )
        .unwrap();
        assert!(video_csv_times(&root).is_err());
        fs::write(&csv, "video_start,0,0,0,0\nvideo_end,990,0,0,0\n").unwrap();
        assert!(video_csv_times(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copied_bytes_must_match_full_saved_identity() {
        let root = env::temp_dir().join(format!(
            "flubber-selected-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let source = root.join("source.mp4");
        let copy = root.join("copy.mp4");
        fs::write(&source, b"selected video").unwrap();
        let hash = format!("{:x}", Sha256::digest(b"selected video"));
        copy_verified_cancellable(&source, &copy, 14, &hash, None).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), b"selected video");
        let changed = root.join("changed.mp4");
        assert!(copy_verified_cancellable(&source, &changed, 14, &"0".repeat(64), None).is_err());
        assert!(!changed.exists());
        let short = root.join("short.mp4");
        assert!(copy_verified_cancellable(&source, &short, 13, &hash, None).is_err());
        assert!(!short.exists());
        let cancelled = root.join("cancelled.mp4");
        let stop = Arc::new(AtomicBool::new(true));
        assert!(copy_verified_cancellable(&source, &cancelled, 14, &hash, Some(&stop)).is_err());
        assert!(!cancelled.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn asset_path_rejects_traversal() {
        let root = env::temp_dir().join(format!(
            "flubber-path-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("assets/stimuli")).unwrap();
        let master = root.join("experiment.json");
        let file = root.join("assets/stimuli/video.mp4");
        fs::write(&master, b"{}").unwrap();
        fs::write(&file, b"video").unwrap();
        assert_eq!(
            asset_path(
                &master,
                &json!({"packageRelativePath":"assets/stimuli/video.mp4"})
            )
            .unwrap(),
            file.canonicalize().unwrap()
        );
        assert!(asset_path(
            &master,
            &json!({"packageRelativePath":"assets/stimuli/../video.mp4"})
        )
        .is_err());
        assert!(asset_path(&master, &json!({"packageRelativePath":"../video.mp4"})).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

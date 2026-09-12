//! Dedicated master attempt storage. No legacy manifest or recovery schema is widened.
use super::PreparedMaster;
use crate::research_contracts::canonical_json;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_run_storage::{
    acquire_attempt_lock, checked_run_child, count_previous_attempts, require_same_run_directory,
    CheckedRunDirectory, RunOutputDirectories,
};
use crate::research_runner_session::{recipe_directory_name, RunnerDocument};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
};

const SAMPLE_COLUMNS: &[&str] = &[
    "sequence",
    "runId",
    "attemptId",
    "participantId",
    "recipeSourceByteSha256",
    "planIdentitySha256",
    "entryId",
    "executionId",
    "monotonicMs",
    "lslTimeSeconds",
    "mediaTimeMs",
    "sampleRateHz",
    "scheduledElapsedMs",
    "observedElapsedMs",
    "schedulerLatenessMs",
    "schedulerJitterMs",
    "stateAnchorAgeMs",
    "missedSlotsBefore",
    "valence",
    "arousal",
    "radius",
    "angleDegrees",
    "inputActive",
    "animationActive",
    "inputKind",
    "feedbackVisible",
    "oscillationFrequency",
    "edgeSmoothness",
    "projectionAmplitude",
    "pulseSynchrony",
    "waveSizeVariation",
    "saturation",
];

pub(crate) struct MasterStorage {
    directories: RunOutputDirectories,
    session: PathBuf,
    session_identity: CheckedRunDirectory,
    session_name: String,
    _lock: File,
    events: BufWriter<File>,
    samples: BufWriter<File>,
    diagnostics: BufWriter<File>,
    responses: BufWriter<File>,
    csv: Option<BufWriter<File>>,
    tsv: Option<BufWriter<File>>,
    pub receipt: Value,
    terminal: bool,
}

impl MasterStorage {
    pub(crate) fn create(
        root: &Path,
        prepared: &PreparedMaster,
        run_id: &str,
        participant: Value,
        rerun_confirmed: bool,
    ) -> ResearchResult<Self> {
        RunnerDocument::read(&prepared.loaded.canonical_source_text)?.ensure_directory(root)?;
        let directories = RunOutputDirectories::prepare(
            root,
            &recipe_directory_name(&prepared.plan.recipe_source_byte_sha256)?,
            &prepared.plan.participant_id,
        )?;
        let lock = acquire_attempt_lock(&directories.participant.path)?;
        directories.revalidate()?;
        let previous = count_previous_attempts(&directories.participant.path)?;
        if previous > 0 && !rerun_confirmed {
            return Err(CommandError::forbidden("This participant has already been used in this experiment. Confirm a new attempt in Session settings."));
        }
        let attempt = previous
            .checked_add(1)
            .filter(|n| *n <= 999999)
            .ok_or_else(|| CommandError::forbidden("Master attempt number exceeds its bound."))?;
        let attempt_id = format!("attempt-{}", uuid::Uuid::new_v4());
        let session_name = format!("{}_{}_R{attempt:02}", prepared.plan.participant_id, run_id);
        let session = directories.create_session(&session_name)?;
        let session_identity = checked_run_child(&directories.participant, &session_name)?;
        let mut receipt = json!({"schema":"affect-runner-master-attempt","version":prepared.plan.version,"runId":run_id,"attemptId":attempt_id,"attemptNumber":attempt,
            "participantId":prepared.plan.participant_id,"participant":participant,
            "recipeSourceByteSha256":prepared.plan.recipe_source_byte_sha256,"planIdentitySha256":prepared.plan.plan_identity_sha256,
            "buildCommit":env!("AFFECT_TRACKER_BUILD_COMMIT"),"appVersion":env!("CARGO_PKG_VERSION"),
            "outputDirectory":format!("outputs/{}/{}/{}", recipe_directory_name(&prepared.plan.recipe_source_byte_sha256)?, prepared.plan.participant_id, session_name),
            "status":"prepared","completedStepCount":0});
        if matches!(prepared.plan.version, 2 | 3) {
            receipt.as_object_mut().unwrap().remove("participant");
        }
        write_new(
            &session.join("experiment.master.json"),
            prepared.loaded.canonical_source_text.as_bytes(),
        )?;
        write_new(
            &session.join(format!("master-plan.v{}.json", prepared.plan.version)),
            &canonical_json(&prepared.plan, &[])?,
        )?;
        write_new(
            &session.join(format!("master-attempt.v{}.json", prepared.plan.version)),
            &canonical_json(&receipt, &[])?,
        )?;
        let events = writer(&session, "master-events.v1.jsonl")?;
        let samples = writer(&session, "master-samples.v1.jsonl")?;
        let diagnostics = writer(&session, "master-diagnostics.v1.jsonl")?;
        let responses = writer(
            &session,
            &format!(
                "master-responses.v{}.jsonl",
                if prepared.plan.version == 1 { 1 } else { 2 }
            ),
        )?;
        let csv = prepared
            .loaded
            .recipe
            .policy()
            .output
            .csv
            .then(|| writer(&session, "master-samples.csv"))
            .transpose()?;
        let tsv = prepared
            .loaded
            .recipe
            .policy()
            .output
            .tsv
            .then(|| writer(&session, "master-samples.tsv"))
            .transpose()?;
        let mut storage = Self {
            directories,
            session,
            session_identity,
            session_name,
            _lock: lock,
            events,
            samples,
            diagnostics,
            responses,
            csv,
            tsv,
            receipt,
            terminal: false,
        };
        let columns = SAMPLE_COLUMNS;
        if let Some(csv) = &mut storage.csv {
            writeln!(csv, "{}", columns.join(",")).map_err(CommandError::io)?;
        }
        if let Some(tsv) = &mut storage.tsv {
            writeln!(tsv, "{}", columns.join("\t")).map_err(CommandError::io)?;
        }
        storage.checkpoint()?;
        Ok(storage)
    }
    fn revalidate(&self) -> ResearchResult<()> {
        self.directories.revalidate()?;
        require_same_run_directory(
            &self.session_identity,
            checked_run_child(&self.directories.participant, &self.session_name)?,
        )?;
        Ok(())
    }
    pub(crate) fn profile(&mut self, value: &Value) -> ResearchResult<()> {
        self.revalidate()?;
        write_new(
            &self.session.join("master-stream-profile.v1.json"),
            &canonical_json(value, &[])?,
        )
    }
    pub(crate) fn event(&mut self, value: &Value) -> ResearchResult<()> {
        append(&mut self.events, value)?;
        self.checkpoint()
    }
    pub(crate) fn diagnostic(&mut self, value: &Value) -> ResearchResult<()> {
        append(&mut self.diagnostics, value)
    }
    pub(crate) fn responses(&mut self, value: &Value) -> ResearchResult<()> {
        append(&mut self.responses, value)?;
        self.checkpoint()
    }
    pub(crate) fn sample(&mut self, value: &Value) -> ResearchResult<()> {
        append(&mut self.samples, value)?;
        let columns = SAMPLE_COLUMNS;
        for (target, separator) in [(&mut self.csv, ','), (&mut self.tsv, '\t')] {
            if let Some(target) = target {
                let row = columns
                    .iter()
                    .map(|key| table_cell(&value[*key], separator))
                    .collect::<Vec<_>>()
                    .join(&separator.to_string());
                writeln!(target, "{row}").map_err(CommandError::io)?;
            }
        }
        Ok(())
    }
    pub(crate) fn checkpoint(&mut self) -> ResearchResult<()> {
        self.revalidate()?;
        for writer in [
            &mut self.events,
            &mut self.samples,
            &mut self.diagnostics,
            &mut self.responses,
        ] {
            sync(writer)?;
        }
        if let Some(writer) = &mut self.csv {
            sync(writer)?;
        }
        if let Some(writer) = &mut self.tsv {
            sync(writer)?;
        }
        Ok(())
    }
    pub(crate) fn finish(
        &mut self,
        status: &str,
        completed_steps: usize,
        failure: Option<&str>,
    ) -> ResearchResult<Value> {
        if !matches!(status, "completed" | "stopped" | "failed") {
            return Err(CommandError::invalid_contract(
                "Invalid master completion status.",
            ));
        }
        if self.terminal {
            return Err(CommandError::forbidden("Master attempt already finalized."));
        }
        self.checkpoint()?;
        let mut receipt = self.receipt.clone();
        receipt["status"] = json!(status);
        receipt["completedStepCount"] = json!(completed_steps);
        receipt["failureCode"] = json!(failure);
        let mut files = Vec::new();
        for entry in fs::read_dir(&self.session).map_err(CommandError::io)? {
            let entry = entry.map_err(CommandError::io)?;
            let metadata = entry.file_type().map_err(CommandError::io)?;
            if !metadata.is_file() || metadata.is_symlink() {
                return Err(CommandError::forbidden(
                    "Master attempt contains a nonordinary artifact.",
                ));
            }
            let mut file = File::open(entry.path()).map_err(CommandError::io)?;
            let mut hash = Sha256::new();
            let mut bytes = 0u64;
            let mut buffer = [0u8; 65536];
            loop {
                let n = file.read(&mut buffer).map_err(CommandError::io)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
                bytes += n as u64;
            }
            files.push(json!({"fileName":entry.file_name().to_string_lossy(),"sha256":format!("{:x}",hash.finalize()),"byteLength":bytes}));
        }
        files.sort_by(|a, b| a["fileName"].as_str().cmp(&b["fileName"].as_str()));
        receipt["files"] = json!(files);
        self.revalidate()?;
        write_new(
            &self.session.join(format!(
                "master-result.v{}.json",
                receipt["version"]
                    .as_u64()
                    .ok_or_else(|| CommandError::invalid_contract("Missing attempt version."))?
            )),
            &canonical_json(&receipt, &[])?,
        )?;
        self.terminal = true;
        self.receipt = receipt.clone();
        Ok(receipt)
    }
}
fn writer(root: &Path, name: &str) -> ResearchResult<BufWriter<File>> {
    Ok(BufWriter::new(
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(name))
            .map_err(CommandError::io)?,
    ))
}
fn write_new(path: &Path, bytes: &[u8]) -> ResearchResult<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(CommandError::io)?;
    file.write_all(bytes).map_err(CommandError::io)?;
    file.sync_all().map_err(CommandError::io)
}
fn append(writer: &mut BufWriter<File>, value: &Value) -> ResearchResult<()> {
    writer
        .write_all(&canonical_json(value, &[])?)
        .map_err(CommandError::io)?;
    writer.write_all(b"\n").map_err(CommandError::io)
}
fn sync(writer: &mut BufWriter<File>) -> ResearchResult<()> {
    writer.flush().map_err(CommandError::io)?;
    writer.get_ref().sync_all().map_err(CommandError::io)
}
fn table_cell(value: &Value, separator: char) -> String {
    let text = match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if text.contains([separator, '"', '\r', '\n']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

pub(crate) fn history(root: &Path, source: &str) -> ResearchResult<Value> {
    let document = RunnerDocument::read(source)?;
    if !matches!(document, RunnerDocument::Master(_)) {
        return Err(CommandError::invalid_contract(
            "Master history requires a complete Planner recipe.",
        ));
    }
    let directory = document.ensure_directory(root)?;
    let mut participants = Vec::new();
    let mut inspected = 0usize;
    for entry in fs::read_dir(&directory.path).map_err(CommandError::io)? {
        inspected += 1;
        if inspected > 100_100 {
            return Err(CommandError::forbidden(
                "Experiment history exceeds its inspection bound.",
            ));
        }
        let entry = entry.map_err(CommandError::io)?;
        let name = entry.file_name();
        let Some(id) = name.to_str() else {
            continue;
        };
        if super::validate_master_participant(id).is_err() {
            continue;
        }
        let participant = checked_run_child(&directory, id)?;
        let mut attempts = 0u32;
        for attempt in fs::read_dir(&participant.path).map_err(CommandError::io)? {
            inspected += 1;
            if inspected > 200_000 {
                return Err(CommandError::forbidden(
                    "Experiment attempt history exceeds its inspection bound.",
                ));
            }
            let attempt = attempt.map_err(CommandError::io)?;
            if attempt.file_type().map_err(CommandError::io)?.is_dir() {
                let name = attempt.file_name();
                let name = name.to_str().ok_or_else(|| {
                    CommandError::forbidden("Attempt directory has an invalid name.")
                })?;
                checked_run_child(&participant, name)?;
                attempts += 1;
            }
        }
        if attempts > 0 {
            participants
                .push(json!({"participantId":id,"state":"used","latestAttemptNumber":attempts}));
        }
    }
    participants.sort_by(|a, b| {
        a["participantId"]
            .as_str()
            .cmp(&b["participantId"].as_str())
    });
    Ok(
        json!({"schema":"affect-runner-master-history","version":1,"recipeSourceByteSha256":document.source_hash(),"participants":participants}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn prepared(source: &str) -> PreparedMaster {
        PreparedMaster::read(
            source,
            "P001",
            crate::research_runner_master::MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap()
    }
    #[test]
    fn source_folders_isolate_history_and_never_overwrite_attempts() {
        let root =
            std::env::temp_dir().join(format!("affect-master-storage-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("outputs")).unwrap();
        let first = prepared(include_str!(
            "../../../test/fixtures/planner-recipe-locations-current-v1.canonical.json"
        ));
        let other = prepared(include_str!(
            "../../../test/fixtures/runner-master-lsl-synthetic-v1.canonical.json"
        ));
        let mut storage = MasterStorage::create(
            &root,
            &first,
            "run-storage",
            json!({"participantId":"P001"}),
            false,
        )
        .unwrap();
        assert!(MasterStorage::create(&root, &first, "run-collision", Value::Null, true).is_err());
        let snapshot = storage.session.join("experiment.master.json");
        let original = fs::read(&snapshot).unwrap();
        assert_eq!(
            history(&root, &first.loaded.canonical_source_text).unwrap()["participants"][0]
                ["participantId"],
            "P001"
        );
        assert!(
            history(&root, &other.loaded.canonical_source_text).unwrap()["participants"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let result = storage.finish("stopped", 0, None).unwrap();
        assert_eq!(result["status"], "stopped");
        assert!(storage.finish("completed", 10, None).is_err());
        drop(storage);
        assert!(
            MasterStorage::create(&root, &first, "run-unconfirmed", Value::Null, false).is_err()
        );
        let second = MasterStorage::create(&root, &first, "run-second", Value::Null, true).unwrap();
        assert_eq!(second.receipt["attemptNumber"], 2);
        let separate =
            MasterStorage::create(&root, &other, "run-other", Value::Null, false).unwrap();
        assert_eq!(separate.receipt["attemptNumber"], 1);
        assert_eq!(fs::read(snapshot).unwrap(), original);
        drop(second);
        drop(separate);
        fs::remove_dir_all(root).unwrap();
    }
}

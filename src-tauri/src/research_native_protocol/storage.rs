//! Durable pending-finalization support for historical package attempts.
//!
//! New participant attempts use the current Runner path. This module reads
//! existing recovery journals and completes previously durable transactions.

use super::records::{PackageRecoveryJournalV1, RunOutputV4};
use crate::research_contracts::canonical_json;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_run_storage::{
    acquire_attempt_lock, checked_run_child, checked_run_root, RunOutputDirectories,
};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;

const SETTINGS_FILE: &str = "settings.snapshot.json";
const EXPERIMENT_SOURCE_FILE: &str = "experiment.json";
const EXPERIMENT_PLAN_FILE: &str = "experiment-plan.snapshot.json";
const PACKAGE_FILE: &str = "experiment.package.json";
const PROTOCOL_PLAN_FILE: &str = "protocol-plan.snapshot.json";
const EVENTS_FILE: &str = "events.jsonl";
const MANIFEST_FILE: &str = "manifest.json";
const RATINGS_CSV_PARTIAL: &str = "ratings.partial.csv";
const RATINGS_TSV_PARTIAL: &str = "ratings.partial.tsv";
const RATINGS_CSV_FINAL: &str = "ratings.csv";
const RATINGS_TSV_FINAL: &str = "ratings.tsv";
const QUESTIONNAIRE_CSV_PARTIAL: &str = "questionnaire.partial.csv";
const QUESTIONNAIRE_TSV_PARTIAL: &str = "questionnaire.partial.tsv";
const QUESTIONNAIRE_CSV_FINAL: &str = "questionnaire.csv";
const QUESTIONNAIRE_TSV_FINAL: &str = "questionnaire.tsv";

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinalFileReceipt {
    pub file_name: String,
    pub sha256: String,
    pub byte_length: u64,
}

pub(super) struct FinalizePendingStorageRequest<'a> {
    pub(super) workspace_root: &'a Path,
    pub(super) package_source: &'a [u8],
    pub(super) settings: &'a [u8],
    pub(super) experiment_source: &'a [u8],
    pub(super) experiment_plan: &'a [u8],
    pub(super) protocol_plan: &'a [u8],
    pub(super) journal: &'a PackageRecoveryJournalV1,
}

fn require_ordinary_file(path: &Path, parent: &Path) -> ResearchResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| CommandError::forbidden("A required recovery artifact is unavailable."))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CommandError::forbidden(
            "A required recovery artifact is not an ordinary file.",
        ));
    }
    let canonical = path.canonicalize().map_err(CommandError::io)?;
    if canonical != path || canonical.parent() != Some(parent) {
        return Err(CommandError::forbidden(
            "A required recovery artifact escaped its exact directory.",
        ));
    }
    Ok(())
}

fn verify_exact_file(path: &Path, expected: &[u8], label: &str) -> ResearchResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("A frozen artifact has no parent directory."))?;
    require_ordinary_file(path, parent)?;
    let observed = fs::read(path).map_err(CommandError::io)?;
    if observed != expected {
        return Err(CommandError::invalid_contract(format!(
            "Recovered {label} bytes differ from the exact experiment package selection."
        )));
    }
    Ok(())
}

pub(super) fn read_latest_journal(path: &Path) -> ResearchResult<Option<PackageRecoveryJournalV1>> {
    let metadata = fs::metadata(path).map_err(CommandError::io)?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
        return Ok(None);
    }
    let mut reader = BufReader::new(File::open(path).map_err(CommandError::io)?);
    let mut line = Vec::new();
    let mut latest = None;
    loop {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(CommandError::io)?;
        if read == 0 {
            break;
        }
        if !line.ends_with(b"\n") {
            break;
        }
        line.pop();
        if line.is_empty() {
            return Err(CommandError::invalid_contract(
                "The package recovery journal contains an empty record.",
            ));
        }
        latest = Some(
            serde_json::from_slice::<PackageRecoveryJournalV1>(&line).map_err(|_| {
                CommandError::invalid_contract(
                    "The package recovery journal contains an invalid complete record.",
                )
            })?,
        );
    }
    Ok(latest)
}

fn attempt_output_identity(
    root: &Path,
    journal: &PackageRecoveryJournalV1,
) -> ResearchResult<String> {
    let key = crate::research_runner_session::recipe_directory_name(
        &journal.package.canonical_source_byte_sha256,
    )?;
    let outputs = checked_run_child(&checked_run_root(root)?, "outputs")?;
    if outputs
        .path
        .join(&key)
        .try_exists()
        .map_err(CommandError::io)?
    {
        let recipe = checked_run_child(&outputs, &key)?;
        if recipe
            .path
            .join(&journal.participant_id)
            .try_exists()
            .map_err(CommandError::io)?
        {
            let participant = checked_run_child(&recipe, &journal.participant_id)?;
            if participant
                .path
                .join(&journal.session_stem)
                .try_exists()
                .map_err(CommandError::io)?
            {
                checked_run_child(&participant, &journal.session_stem)?;
                return Ok(key);
            }
        }
    }
    Ok(journal.experiment_id.clone())
}

pub(super) fn finalize_pending_storage(
    request: FinalizePendingStorageRequest<'_>,
) -> ResearchResult<Vec<FinalFileReceipt>> {
    let pending = request
        .journal
        .pending_finalization
        .as_ref()
        .ok_or_else(|| {
            CommandError::invalid_contract(
                "The package recovery has no durable terminal transaction to finalize.",
            )
        })?;
    let directories = RunOutputDirectories::prepare(
        request.workspace_root,
        &attempt_output_identity(request.workspace_root, request.journal)?,
        &request.journal.participant_id,
    )?;
    let _attempt_lock = acquire_attempt_lock(&directories.participant.path)?;
    directories.revalidate()?;
    let session = checked_run_child(&directories.participant, &request.journal.session_stem)?;
    let recovery = checked_run_child(&checked_run_root(request.workspace_root)?, "recovery")?;
    let recovery_path = recovery
        .path
        .join(format!("{}.package.jsonl", request.journal.recovery_id));
    require_ordinary_file(&recovery_path, &recovery.path)?;
    let latest = read_latest_journal(&recovery_path)?.ok_or_else(|| {
        CommandError::invalid_contract("The pending package recovery journal is empty.")
    })?;
    if latest != *request.journal {
        return Err(CommandError::invalid_contract(
            "The pending package recovery changed while finalization was prepared.",
        ));
    }
    for (name, expected) in [
        (SETTINGS_FILE, request.settings),
        (EXPERIMENT_SOURCE_FILE, request.experiment_source),
        (EXPERIMENT_PLAN_FILE, request.experiment_plan),
        (PACKAGE_FILE, request.package_source),
        (PROTOCOL_PLAN_FILE, request.protocol_plan),
    ] {
        verify_exact_file(&session.path.join(name), expected, name)?;
    }
    let terminal_line = last_complete_line(&session.path.join(EVENTS_FILE))?;
    if format!("{:x}", Sha256::digest(&terminal_line)) != pending.terminal_event_sha256 {
        return Err(CommandError::invalid_contract(
            "The durable terminal event differs from the pending finalization transaction.",
        ));
    }

    for output in &pending.manifest.outputs {
        let final_path = session.path.join(&output.file_name);
        if let Some(partial_name) = partial_name(&output.file_name) {
            let partial_path = session.path.join(partial_name);
            match (partial_path.exists(), final_path.exists()) {
                (true, false) => {
                    verify_output_receipt(&partial_path, output)?;
                    fs::rename(&partial_path, &final_path).map_err(CommandError::io)?;
                }
                (false, true) => verify_output_receipt(&final_path, output)?,
                (true, true) => {
                    return Err(CommandError::forbidden(
                        "Both partial and finalized forms of one run artifact exist.",
                    ));
                }
                (false, false) => {
                    return Err(CommandError::invalid_contract(
                        "A pending finalization artifact is missing.",
                    ));
                }
            }
        } else {
            verify_output_receipt(&final_path, output)?;
        }
    }
    repair_manifest_prefix(
        &session.path.join(MANIFEST_FILE),
        &canonical_json(&pending.manifest, &[])?,
    )?;
    let files = finalized_receipts_at(&session.path)?;
    fs::remove_file(&recovery_path).map_err(CommandError::io)?;
    Ok(files)
}

fn partial_name(final_name: &str) -> Option<&'static str> {
    match final_name {
        RATINGS_CSV_FINAL => Some(RATINGS_CSV_PARTIAL),
        RATINGS_TSV_FINAL => Some(RATINGS_TSV_PARTIAL),
        QUESTIONNAIRE_CSV_FINAL => Some(QUESTIONNAIRE_CSV_PARTIAL),
        QUESTIONNAIRE_TSV_FINAL => Some(QUESTIONNAIRE_TSV_PARTIAL),
        _ => None,
    }
}

fn verify_output_receipt(path: &Path, output: &RunOutputV4) -> ResearchResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("A pending output has no parent directory."))?;
    require_ordinary_file(path, parent)?;
    let (sha256, byte_length) = file_digest(path)?;
    if sha256 != output.sha256 || byte_length != output.byte_length {
        return Err(CommandError::invalid_contract(
            "A pending output differs from its frozen manifest receipt.",
        ));
    }
    Ok(())
}

fn last_complete_line(path: &Path) -> ResearchResult<Vec<u8>> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("The event stream has no parent directory."))?;
    require_ordinary_file(path, parent)?;
    let mut reader = BufReader::new(File::open(path).map_err(CommandError::io)?);
    let mut line = Vec::new();
    let mut latest = Vec::new();
    loop {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(CommandError::io)?;
        if read == 0 {
            break;
        }
        if !line.ends_with(b"\n") {
            return Err(CommandError::invalid_contract(
                "The pending event stream has a torn terminal record.",
            ));
        }
        latest.clone_from(&line);
    }
    if latest.is_empty() {
        return Err(CommandError::invalid_contract(
            "The pending event stream has no terminal record.",
        ));
    }
    Ok(latest)
}

fn repair_manifest_prefix(path: &Path, expected: &[u8]) -> ResearchResult<()> {
    if !path.exists() {
        return write_new_synced(path, expected);
    }
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("The manifest has no parent directory."))?;
    require_ordinary_file(path, parent)?;
    let observed = fs::read(path).map_err(CommandError::io)?;
    if observed.len() > expected.len() || observed != expected[..observed.len()] {
        return Err(CommandError::forbidden(
            "The existing manifest is not an exact prefix of the frozen pending manifest.",
        ));
    }
    if observed.len() < expected.len() {
        let mut file = OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(CommandError::io)?;
        file.write_all(&expected[observed.len()..])
            .map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)?;
    }
    Ok(())
}

fn finalized_receipts_at(session_dir: &Path) -> ResearchResult<Vec<FinalFileReceipt>> {
    let mut names = [
        SETTINGS_FILE,
        EXPERIMENT_SOURCE_FILE,
        EXPERIMENT_PLAN_FILE,
        PACKAGE_FILE,
        PROTOCOL_PLAN_FILE,
        EVENTS_FILE,
        RATINGS_CSV_FINAL,
        RATINGS_TSV_FINAL,
        QUESTIONNAIRE_CSV_FINAL,
        QUESTIONNAIRE_TSV_FINAL,
        MANIFEST_FILE,
    ]
    .into_iter()
    .filter(|name| session_dir.join(name).is_file())
    .collect::<Vec<_>>();
    names.sort_unstable();
    names
        .into_iter()
        .map(|name| {
            let receipt = file_digest(&session_dir.join(name))?;
            Ok(FinalFileReceipt {
                file_name: name.to_owned(),
                sha256: receipt.0,
                byte_length: receipt.1,
            })
        })
        .collect()
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> ResearchResult<()> {
    let mut file = create_new_file(path)?;
    file.write_all(bytes).map_err(CommandError::io)?;
    file.sync_all().map_err(CommandError::io)
}

fn create_new_file(path: &Path) -> ResearchResult<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(CommandError::io)
}

fn file_digest(path: &Path) -> ResearchResult<(String, u64)> {
    let mut file = File::open(path).map_err(CommandError::io)?;
    let metadata = file.metadata().map_err(CommandError::io)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(CommandError::io)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok((format!("{:x}", digest.finalize()), metadata.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_manifest_repair_accepts_only_an_exact_prefix() {
        let root = std::env::temp_dir().join(format!(
            "affect-research-manifest-repair-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let path = root.join(MANIFEST_FILE);
        let expected = br#"{"schema":"manifest","version":4}"#;
        fs::write(&path, &expected[..12]).unwrap();
        repair_manifest_prefix(&path, expected).unwrap();
        assert_eq!(fs::read(&path).unwrap(), expected);
        fs::write(&path, b"divergent").unwrap();
        assert!(repair_manifest_prefix(&path, expected).is_err());
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}

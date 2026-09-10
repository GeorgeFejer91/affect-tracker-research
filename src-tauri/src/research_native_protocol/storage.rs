//! Durable artifacts for one native experiment-package attempt.
//!
//! This module owns filenames, table serialization, create-new semantics,
//! recovery-journal durability, and the final manifest commit point. It has no
//! protocol-transition or UI responsibilities.

use super::records::{
    PackageRecoveryJournalV1, ResearchRunManifestV4, RunOutputKindV4, RunOutputV4,
};
use crate::research_contracts::{
    canonical_json, ResearchEventV1, ResearchSampleV1, SampleStimulusIdentityV1,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_protocol::{QuestionnaireResponseV1, ResearchEventV2};
use crate::research_run_storage::{
    acquire_attempt_lock, checked_run_child, checked_run_root, count_previous_attempts,
    RunOutputDirectories,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

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

pub(super) struct PackageRunStorage {
    session_dir: PathBuf,
    recovery_path: PathBuf,
    ratings_csv: Option<BufWriter<File>>,
    ratings_tsv: Option<BufWriter<File>>,
    events: BufWriter<File>,
    pub(super) journal: PackageRecoveryJournalV1,
    _attempt_lock: File,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinalFileReceipt {
    pub file_name: String,
    pub sha256: String,
    pub byte_length: u64,
}

pub(super) struct NewStorageRequest<'a> {
    pub(super) workspace_root: &'a Path,
    pub(super) session_stem: &'a str,
    pub(super) package_source: &'a [u8],
    pub(super) settings: &'a [u8],
    pub(super) experiment_source: &'a [u8],
    pub(super) experiment_plan: &'a [u8],
    pub(super) protocol_plan: &'a [u8],
    pub(super) journal: PackageRecoveryJournalV1,
    pub(super) csv: bool,
    pub(super) tsv: bool,
}

pub(super) struct ResumeStorageRequest<'a> {
    pub(super) workspace_root: &'a Path,
    pub(super) package_source: &'a [u8],
    pub(super) settings: &'a [u8],
    pub(super) experiment_source: &'a [u8],
    pub(super) experiment_plan: &'a [u8],
    pub(super) protocol_plan: &'a [u8],
    pub(super) journal: PackageRecoveryJournalV1,
    pub(super) csv: bool,
    pub(super) tsv: bool,
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

pub(super) struct PreparedAttempt {
    directories: RunOutputDirectories,
    attempt_lock: File,
    pub(super) attempt_number: u32,
}

pub(super) fn prepare_attempt(
    workspace_root: &Path,
    experiment_id: &str,
    participant_id: &str,
    rerun_confirmed: bool,
) -> ResearchResult<PreparedAttempt> {
    let directories = RunOutputDirectories::prepare(workspace_root, experiment_id, participant_id)?;
    let attempt_lock = acquire_attempt_lock(&directories.participant.path)?;
    directories.revalidate()?;
    let previous = count_previous_attempts(&directories.participant.path)?;
    if previous > 0 && !rerun_confirmed {
        return Err(CommandError::forbidden(
            "This participant already has an attempt; explicit rerun confirmation is required.",
        ));
    }
    let attempt_number = previous.checked_add(1).ok_or_else(|| {
        CommandError::forbidden("The participant attempt counter cannot be incremented.")
    })?;
    if attempt_number > 999_999 {
        return Err(CommandError::forbidden(
            "The participant attempt counter exceeds the supported range.",
        ));
    }
    Ok(PreparedAttempt {
        directories,
        attempt_lock,
        attempt_number,
    })
}

impl PackageRunStorage {
    pub(super) fn create(
        prepared: PreparedAttempt,
        request: NewStorageRequest<'_>,
    ) -> ResearchResult<Self> {
        if !request.csv && !request.tsv {
            return Err(CommandError::invalid_contract(
                "At least one ratings output format is required.",
            ));
        }
        if prepared.attempt_number != request.journal.attempt_number {
            return Err(CommandError::invalid_contract(
                "The reserved attempt does not match the recovery journal.",
            ));
        }
        prepared.directories.revalidate()?;
        let session_dir = prepared.directories.create_session(request.session_stem)?;
        let recovery_path = request
            .workspace_root
            .join("recovery")
            .join(format!("{}.package.jsonl", request.journal.recovery_id));
        let mut guard = SessionCreationGuard::new(session_dir.clone(), recovery_path.clone());

        write_new_synced(&session_dir.join(SETTINGS_FILE), request.settings)?;
        write_new_synced(
            &session_dir.join(EXPERIMENT_SOURCE_FILE),
            request.experiment_source,
        )?;
        write_new_synced(
            &session_dir.join(EXPERIMENT_PLAN_FILE),
            request.experiment_plan,
        )?;
        write_new_synced(&session_dir.join(PACKAGE_FILE), request.package_source)?;
        write_new_synced(&session_dir.join(PROTOCOL_PLAN_FILE), request.protocol_plan)?;

        let ratings_csv = request
            .csv
            .then(|| {
                create_table(
                    &session_dir.join(RATINGS_CSV_PARTIAL),
                    &sample_headers(),
                    b',',
                )
            })
            .transpose()?;
        let ratings_tsv = request
            .tsv
            .then(|| {
                create_table(
                    &session_dir.join(RATINGS_TSV_PARTIAL),
                    &sample_headers(),
                    b'\t',
                )
            })
            .transpose()?;
        let events = BufWriter::new(create_new_file(&session_dir.join(EVENTS_FILE))?);
        append_journal(&recovery_path, &request.journal, true)?;
        guard.disarm();
        Ok(Self {
            session_dir,
            recovery_path,
            ratings_csv,
            ratings_tsv,
            events,
            journal: request.journal,
            _attempt_lock: prepared.attempt_lock,
        })
    }

    pub(super) fn resume(request: ResumeStorageRequest<'_>) -> ResearchResult<Self> {
        if !request.csv && !request.tsv {
            return Err(CommandError::invalid_contract(
                "At least one ratings output format is required.",
            ));
        }
        let directories = RunOutputDirectories::prepare(
            request.workspace_root,
            &request.journal.experiment_id,
            &request.journal.participant_id,
        )?;
        let attempt_lock = acquire_attempt_lock(&directories.participant.path)?;
        directories.revalidate()?;
        let session = checked_run_child(&directories.participant, &request.journal.session_stem)?;
        let recovery = checked_run_child(&checked_run_root(request.workspace_root)?, "recovery")?;
        let recovery_path = recovery
            .path
            .join(format!("{}.package.jsonl", request.journal.recovery_id));
        require_ordinary_file(&recovery_path, &recovery.path)?;
        let durable_journal = read_latest_journal(&recovery_path)?.ok_or_else(|| {
            CommandError::invalid_contract("The selected package recovery journal is empty.")
        })?;
        if durable_journal.run_id != request.journal.run_id
            || durable_journal.partial_sample_count != request.journal.partial_sample_count
            || durable_journal.partial_event_count != request.journal.partial_event_count
            || durable_journal.safe_protocol_step_position
                != request.journal.safe_protocol_step_position
            || durable_journal.pending_finalization != request.journal.pending_finalization
        {
            return Err(CommandError::invalid_contract(
                "The package recovery journal changed while Resume was being prepared.",
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
        if session.path.join(MANIFEST_FILE).exists()
            || [
                RATINGS_CSV_FINAL,
                RATINGS_TSV_FINAL,
                QUESTIONNAIRE_CSV_FINAL,
                QUESTIONNAIRE_TSV_FINAL,
            ]
            .iter()
            .any(|name| session.path.join(name).exists())
        {
            return Err(CommandError::forbidden(
                "A resumable package attempt cannot contain finalized artifacts.",
            ));
        }

        let ratings_csv = if request.csv {
            Some(resume_sample_table(
                &session.path.join(RATINGS_CSV_PARTIAL),
                b',',
                &request.journal,
            )?)
        } else {
            require_absent(&session.path.join(RATINGS_CSV_PARTIAL))?;
            None
        };
        let ratings_tsv = if request.tsv {
            Some(resume_sample_table(
                &session.path.join(RATINGS_TSV_PARTIAL),
                b'\t',
                &request.journal,
            )?)
        } else {
            require_absent(&session.path.join(RATINGS_TSV_PARTIAL))?;
            None
        };
        if request.csv && request.tsv {
            let csv_digest = sample_table_prefix_digest(
                &session.path.join(RATINGS_CSV_PARTIAL),
                b',',
                &request.journal,
            )?;
            let tsv_digest = sample_table_prefix_digest(
                &session.path.join(RATINGS_TSV_PARTIAL),
                b'\t',
                &request.journal,
            )?;
            if csv_digest != tsv_digest {
                return Err(CommandError::invalid_contract(
                    "Recovered CSV and TSV rating prefixes are not cell-identical.",
                ));
            }
        }
        let events = resume_events(&session.path.join(EVENTS_FILE), &request.journal)?;
        Ok(Self {
            session_dir: session.path,
            recovery_path,
            ratings_csv,
            ratings_tsv,
            events,
            journal: request.journal,
            _attempt_lock: attempt_lock,
        })
    }

    pub(super) fn write_sample(&mut self, sample: &ResearchSampleV1) -> ResearchResult<()> {
        sample.validate()?;
        let values = sample_values(sample)?;
        if let Some(writer) = &mut self.ratings_csv {
            write_delimited(writer, &values, b',')?;
        }
        if let Some(writer) = &mut self.ratings_tsv {
            write_delimited(writer, &values, b'\t')?;
        }
        Ok(())
    }

    pub(super) fn write_event(&mut self, event: &ResearchEventV2) -> ResearchResult<Vec<u8>> {
        event.validate()?;
        let mut line = canonical_json(event, &[])?;
        line.push(b'\n');
        self.events.write_all(&line).map_err(CommandError::io)?;
        self.events.flush().map_err(CommandError::io)?;
        self.events
            .get_ref()
            .sync_data()
            .map_err(CommandError::io)?;
        Ok(line)
    }

    pub(super) fn checkpoint(&mut self) -> ResearchResult<()> {
        flush_table(self.ratings_csv.as_mut())?;
        flush_table(self.ratings_tsv.as_mut())?;
        append_journal(&self.recovery_path, &self.journal, false)
    }

    pub(super) fn prepare_outputs(
        &mut self,
        questionnaire_responses: &[QuestionnaireResponseV1],
    ) -> ResearchResult<Vec<RunOutputV4>> {
        flush_table(self.ratings_csv.as_mut())?;
        flush_table(self.ratings_tsv.as_mut())?;
        self.events.flush().map_err(CommandError::io)?;
        self.events
            .get_ref()
            .sync_data()
            .map_err(CommandError::io)?;
        if self.ratings_csv.is_some() {
            self.ratings_csv.take();
        }
        if self.ratings_tsv.is_some() {
            self.ratings_tsv.take();
        }

        let mut outputs = vec![
            file_receipt(
                &self.session_dir,
                RunOutputKindV4::Settings,
                SETTINGS_FILE,
                None,
            )?,
            file_receipt(
                &self.session_dir,
                RunOutputKindV4::ExperimentSource,
                EXPERIMENT_SOURCE_FILE,
                None,
            )?,
            file_receipt(
                &self.session_dir,
                RunOutputKindV4::ExperimentPlan,
                EXPERIMENT_PLAN_FILE,
                None,
            )?,
            file_receipt(
                &self.session_dir,
                RunOutputKindV4::ExperimentPackage,
                PACKAGE_FILE,
                None,
            )?,
            file_receipt(
                &self.session_dir,
                RunOutputKindV4::ProtocolPlan,
                PROTOCOL_PLAN_FILE,
                None,
            )?,
            file_receipt(
                &self.session_dir,
                RunOutputKindV4::Events,
                EVENTS_FILE,
                None,
            )?,
        ];
        if self.session_dir.join(RATINGS_CSV_PARTIAL).is_file() {
            outputs.push(file_receipt(
                &self.session_dir,
                RunOutputKindV4::RatingsCsv,
                RATINGS_CSV_PARTIAL,
                Some(self.journal.partial_sample_count),
            )?);
        }
        if self.session_dir.join(RATINGS_TSV_PARTIAL).is_file() {
            outputs.push(file_receipt(
                &self.session_dir,
                RunOutputKindV4::RatingsTsv,
                RATINGS_TSV_PARTIAL,
                Some(self.journal.partial_sample_count),
            )?);
        }
        if self.session_dir.join(RATINGS_CSV_PARTIAL).is_file() {
            write_questionnaire_table(
                &self.session_dir.join(QUESTIONNAIRE_CSV_PARTIAL),
                questionnaire_responses,
                b',',
            )?;
            outputs.push(file_receipt(
                &self.session_dir,
                RunOutputKindV4::QuestionnaireCsv,
                QUESTIONNAIRE_CSV_PARTIAL,
                Some(questionnaire_responses.len() as u64),
            )?);
        }
        if self.session_dir.join(RATINGS_TSV_PARTIAL).is_file() {
            write_questionnaire_table(
                &self.session_dir.join(QUESTIONNAIRE_TSV_PARTIAL),
                questionnaire_responses,
                b'\t',
            )?;
            outputs.push(file_receipt(
                &self.session_dir,
                RunOutputKindV4::QuestionnaireTsv,
                QUESTIONNAIRE_TSV_PARTIAL,
                Some(questionnaire_responses.len() as u64),
            )?);
        }
        for output in &mut outputs {
            output.file_name = final_name(&output.file_name).to_owned();
        }
        Ok(outputs)
    }

    pub(super) fn persist_pending_finalization(&mut self) -> ResearchResult<()> {
        append_journal(&self.recovery_path, &self.journal, false)
    }

    pub(super) fn commit_manifest(
        &mut self,
        manifest: &ResearchRunManifestV4,
    ) -> ResearchResult<()> {
        rename_create_new(
            &self.session_dir.join(RATINGS_CSV_PARTIAL),
            &self.session_dir.join(RATINGS_CSV_FINAL),
        )?;
        rename_create_new(
            &self.session_dir.join(RATINGS_TSV_PARTIAL),
            &self.session_dir.join(RATINGS_TSV_FINAL),
        )?;
        rename_create_new(
            &self.session_dir.join(QUESTIONNAIRE_CSV_PARTIAL),
            &self.session_dir.join(QUESTIONNAIRE_CSV_FINAL),
        )?;
        rename_create_new(
            &self.session_dir.join(QUESTIONNAIRE_TSV_PARTIAL),
            &self.session_dir.join(QUESTIONNAIRE_TSV_FINAL),
        )?;
        write_new_synced(
            &self.session_dir.join(MANIFEST_FILE),
            &canonical_json(manifest, &[])?,
        )?;
        match fs::remove_file(&self.recovery_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(CommandError::io(error)),
        }
    }

    pub(super) fn finalized_file_receipts(&self) -> ResearchResult<Vec<FinalFileReceipt>> {
        finalized_receipts_at(&self.session_dir)
    }
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

fn require_absent(path: &Path) -> ResearchResult<()> {
    if path.exists() {
        return Err(CommandError::invalid_contract(
            "A disabled rating format unexpectedly exists in the recovered attempt.",
        ));
    }
    Ok(())
}

fn resume_sample_table(
    path: &Path,
    delimiter: u8,
    journal: &PackageRecoveryJournalV1,
) -> ResearchResult<BufWriter<File>> {
    let durable_end = validate_sample_table_prefix(path, delimiter, journal, false)?.0;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(CommandError::io)?;
    file.set_len(durable_end).map_err(CommandError::io)?;
    file.sync_data().map_err(CommandError::io)?;
    drop(file);
    let append = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(CommandError::io)?;
    Ok(BufWriter::new(append))
}

fn sample_table_prefix_digest(
    path: &Path,
    delimiter: u8,
    journal: &PackageRecoveryJournalV1,
) -> ResearchResult<String> {
    validate_sample_table_prefix(path, delimiter, journal, true).map(|(_, digest)| digest)
}

fn validate_sample_table_prefix(
    path: &Path,
    delimiter: u8,
    journal: &PackageRecoveryJournalV1,
    exact_length: bool,
) -> ResearchResult<(u64, String)> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("A rating table has no parent directory."))?;
    require_ordinary_file(path, parent)?;
    let mut reader = BufReader::new(File::open(path).map_err(CommandError::io)?);
    let expected_header = delimited_line(
        &sample_headers()
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>(),
        delimiter,
    )?;
    let mut line = Vec::new();
    reader
        .read_until(b'\n', &mut line)
        .map_err(CommandError::io)?;
    if line != expected_header {
        return Err(CommandError::invalid_contract(
            "A recovered ratings table header differs from the canonical schema.",
        ));
    }
    let mut offset = line.len() as u64;
    let mut digest = Sha256::new();
    for sequence in 1..=journal.partial_sample_count {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(CommandError::io)?;
        if read == 0 || !line.ends_with(b"\n") {
            return Err(CommandError::invalid_contract(
                "A recovered ratings table is shorter than its durable journal prefix.",
            ));
        }
        let values = parse_delimited_line(&line, delimiter)?;
        let sample = sample_from_cells(&values)?;
        sample.validate()?;
        let canonical_values = sample_values(&sample)?;
        if canonical_values
            .iter()
            .map(String::as_bytes)
            .ne(values.iter().map(Vec::as_slice))
            || sample.sequence != sequence
            || sample.run_id != journal.run_id
            || sample.participant_id != journal.participant_id
            || sample.attempt_number != journal.attempt_number
            || sample.settings_sha256 != journal.settings_sha256
            || sample.assignment_plan_sha256 != journal.assignment_plan_sha256
        {
            return Err(CommandError::invalid_contract(
                "A recovered ratings row is malformed or crosses the durable run identity.",
            ));
        }
        for value in canonical_values {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        }
        offset = offset.saturating_add(read as u64);
    }
    if exact_length {
        let metadata = reader.get_ref().metadata().map_err(CommandError::io)?;
        if metadata.len() != offset {
            return Err(CommandError::invalid_contract(
                "A recovered rating format contains bytes beyond the reconciled durable prefix.",
            ));
        }
    }
    Ok((offset, format!("{:x}", digest.finalize())))
}

fn sample_from_cells(values: &[Vec<u8>]) -> ResearchResult<ResearchSampleV1> {
    if values.len() != sample_headers().len() {
        return Err(CommandError::invalid_contract(
            "A recovered ratings row has the wrong column count.",
        ));
    }
    let required = |index, label| cell_text(values, index, label);
    let optional_string = |index, label| {
        let value = required(index, label)?;
        Ok::<Option<String>, CommandError>((!value.is_empty()).then(|| value.to_owned()))
    };
    Ok(ResearchSampleV1 {
        schema: required(0, "schema")?.to_owned(),
        version: parse_cell(values, 1, "version")?,
        sequence: parse_cell(values, 2, "sequence")?,
        run_id: required(3, "runId")?.to_owned(),
        participant_id: required(4, "participantId")?.to_owned(),
        attempt_number: parse_cell(values, 5, "attemptNumber")?,
        settings_sha256: required(6, "settingsSha256")?.to_owned(),
        assignment_plan_sha256: required(7, "assignmentPlanSha256")?.to_owned(),
        stimulus_position: parse_cell(values, 8, "stimulusPosition")?,
        stimulus_identity: SampleStimulusIdentityV1 {
            kind: parse_enum_cell(values, 9, "stimulusKind")?,
            stimulus_id: required(10, "stimulusId")?.to_owned(),
            sha256: optional_string(11, "stimulusSha256")?,
            byte_length: parse_optional_cell(values, 12, "stimulusByteLength")?,
            duration_ms: parse_cell(values, 13, "stimulusDurationMs")?,
            url: optional_string(14, "stimulusUrl")?,
            video_id: optional_string(15, "stimulusVideoId")?,
        },
        wall_time_utc: required(16, "wallTimeUtc")?.to_owned(),
        monotonic_time_ns: required(17, "monotonicTimeNs")?.to_owned(),
        lsl_time_seconds: parse_optional_cell(values, 18, "lslTimeSeconds")?,
        sample_rate_hz: parse_cell(values, 19, "sampleRateHz")?,
        scheduled_elapsed_ms: parse_cell(values, 20, "scheduledElapsedMs")?,
        observed_elapsed_ms: parse_cell(values, 21, "observedElapsedMs")?,
        scheduler_lateness_ms: parse_cell(values, 22, "schedulerLatenessMs")?,
        scheduler_jitter_ms: parse_cell(values, 23, "schedulerJitterMs")?,
        state_anchor_age_ms: parse_cell(values, 24, "stateAnchorAgeMs")?,
        missed_slots_before: parse_cell(values, 25, "missedSlotsBefore")?,
        media_time_ms: parse_cell(values, 26, "mediaTimeMs")?,
        current_valence: parse_cell(values, 27, "currentValence")?,
        current_arousal: parse_cell(values, 28, "currentArousal")?,
        target_valence: parse_cell(values, 29, "targetValence")?,
        target_arousal: parse_cell(values, 30, "targetArousal")?,
        radius: parse_cell(values, 31, "radius")?,
        angle_degrees: parse_cell(values, 32, "angleDegrees")?,
        oscillation_frequency: parse_cell(values, 33, "oscillationFrequency")?,
        edge_smoothness: parse_cell(values, 34, "edgeSmoothness")?,
        projection_amplitude: parse_cell(values, 35, "projectionAmplitude")?,
        pulse_synchrony: parse_cell(values, 36, "pulseSynchrony")?,
        wave_size_variation: parse_cell(values, 37, "waveSizeVariation")?,
        saturation: parse_cell(values, 38, "saturation")?,
        animation_active: parse_cell(values, 39, "animationActive")?,
        input_active: parse_cell(values, 40, "inputActive")?,
        input_kind: parse_enum_cell(values, 41, "inputKind")?,
        feedback_visible: parse_cell(values, 42, "feedbackVisible")?,
    })
}

fn cell_text<'a>(values: &'a [Vec<u8>], index: usize, label: &str) -> ResearchResult<&'a str> {
    std::str::from_utf8(&values[index]).map_err(|_| {
        CommandError::invalid_contract(format!(
            "A recovered ratings row contains invalid UTF-8 in {label}."
        ))
    })
}

fn parse_cell<T>(values: &[Vec<u8>], index: usize, label: &str) -> ResearchResult<T>
where
    T: std::str::FromStr,
{
    cell_text(values, index, label)?.parse::<T>().map_err(|_| {
        CommandError::invalid_contract(format!(
            "A recovered ratings row contains an invalid {label}."
        ))
    })
}

fn parse_optional_cell<T>(
    values: &[Vec<u8>],
    index: usize,
    label: &str,
) -> ResearchResult<Option<T>>
where
    T: std::str::FromStr,
{
    let value = cell_text(values, index, label)?;
    if value.is_empty() {
        Ok(None)
    } else {
        value.parse::<T>().map(Some).map_err(|_| {
            CommandError::invalid_contract(format!(
                "A recovered ratings row contains an invalid {label}."
            ))
        })
    }
}

fn parse_enum_cell<T>(values: &[Vec<u8>], index: usize, label: &str) -> ResearchResult<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(serde_json::Value::String(
        cell_text(values, index, label)?.to_owned(),
    ))
    .map_err(|_| {
        CommandError::invalid_contract(format!(
            "A recovered ratings row contains an invalid {label}."
        ))
    })
}

fn resume_events(
    path: &Path,
    journal: &PackageRecoveryJournalV1,
) -> ResearchResult<BufWriter<File>> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::forbidden("The event journal has no parent directory."))?;
    require_ordinary_file(path, parent)?;
    let mut reader = BufReader::new(File::open(path).map_err(CommandError::io)?);
    let mut line = Vec::new();
    let mut durable_end = 0u64;
    for sequence in 1..=journal.partial_event_count {
        line.clear();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(CommandError::io)?;
        if read == 0 || !line.ends_with(b"\n") {
            return Err(CommandError::invalid_contract(
                "The recovered event stream is shorter than its durable journal prefix.",
            ));
        }
        let event = serde_json::from_slice::<ResearchEventV2>(&line[..line.len() - 1])
            .map_err(|_| CommandError::invalid_contract("A recovered event record is invalid."))?;
        event.validate()?;
        if event.sequence != sequence
            || event.run_id != journal.run_id
            || event.participant_id != journal.participant_id
            || event.attempt_number != journal.attempt_number
            || event.settings_sha256 != journal.settings_sha256
            || event.assignment_plan_sha256 != journal.assignment_plan_sha256
            || event.protocol_plan_sha256 != journal.protocol_plan_sha256
        {
            return Err(CommandError::invalid_contract(
                "A recovered event record crosses the durable run identity.",
            ));
        }
        durable_end = durable_end.saturating_add(read as u64);
    }
    drop(reader);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(CommandError::io)?;
    file.set_len(durable_end).map_err(CommandError::io)?;
    file.sync_data().map_err(CommandError::io)?;
    drop(file);
    let append = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(CommandError::io)?;
    Ok(BufWriter::new(append))
}

fn delimited_line(values: &[String], delimiter: u8) -> ResearchResult<Vec<u8>> {
    let mut cursor = BufWriter::new(Vec::new());
    write_delimited(&mut cursor, values, delimiter)?;
    cursor.flush().map_err(CommandError::io)?;
    cursor
        .into_inner()
        .map_err(|error| CommandError::io(error.into_error()))
}

fn parse_delimited_line(line: &[u8], delimiter: u8) -> ResearchResult<Vec<Vec<u8>>> {
    if !line.ends_with(b"\n") {
        return Err(CommandError::invalid_contract(
            "A delimited record is not newline-terminated.",
        ));
    }
    let mut values = Vec::new();
    let mut value = Vec::new();
    let mut quoted = false;
    let mut quote_closed = false;
    let mut index = 0usize;
    while index < line.len() - 1 {
        let byte = line[index];
        if quoted {
            if byte == b'"' {
                if line.get(index + 1) == Some(&b'"') {
                    value.push(b'"');
                    index += 2;
                    continue;
                }
                quoted = false;
                quote_closed = true;
            } else if matches!(byte, b'\r' | b'\n') {
                return Err(CommandError::invalid_contract(
                    "Recovered rating cells cannot contain physical newlines.",
                ));
            } else {
                value.push(byte);
            }
        } else if quote_closed {
            if byte != delimiter {
                return Err(CommandError::invalid_contract(
                    "A recovered ratings row contains bytes after a closing quote.",
                ));
            }
            values.push(std::mem::take(&mut value));
            quote_closed = false;
        } else if byte == delimiter {
            values.push(std::mem::take(&mut value));
        } else if byte == b'"' {
            if !value.is_empty() {
                return Err(CommandError::invalid_contract(
                    "A recovered ratings row contains malformed quoting.",
                ));
            }
            quoted = true;
        } else if matches!(byte, b'\r' | b'\n') {
            return Err(CommandError::invalid_contract(
                "A recovered ratings row contains an unexpected line break.",
            ));
        } else {
            value.push(byte);
        }
        index += 1;
    }
    if quoted {
        return Err(CommandError::invalid_contract(
            "A recovered ratings row contains an unterminated quoted cell.",
        ));
    }
    values.push(value);
    Ok(values)
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
        &request.journal.experiment_id,
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

fn append_journal(
    path: &Path,
    journal: &PackageRecoveryJournalV1,
    create_new: bool,
) -> ResearchResult<()> {
    if !create_new {
        truncate_torn_tail(path)?;
    }
    let mut options = OpenOptions::new();
    options.write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.append(true);
    }
    let mut file = options.open(path).map_err(CommandError::io)?;
    let mut bytes = canonical_json(journal, &[])?;
    bytes.push(b'\n');
    file.write_all(&bytes).map_err(CommandError::io)?;
    file.sync_data().map_err(CommandError::io)
}

fn truncate_torn_tail(path: &Path) -> ResearchResult<()> {
    let bytes = fs::read(path).map_err(CommandError::io)?;
    if bytes.is_empty() || bytes.ends_with(b"\n") {
        return Ok(());
    }
    let length = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |position| position + 1);
    let file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(CommandError::io)?;
    file.set_len(length as u64).map_err(CommandError::io)?;
    file.sync_data().map_err(CommandError::io)
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

fn create_table(path: &Path, headers: &[&str], delimiter: u8) -> ResearchResult<BufWriter<File>> {
    let mut writer = BufWriter::new(create_new_file(path)?);
    write_delimited(
        &mut writer,
        &headers
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>(),
        delimiter,
    )?;
    writer.flush().map_err(CommandError::io)?;
    writer.get_ref().sync_data().map_err(CommandError::io)?;
    Ok(writer)
}

fn flush_table(writer: Option<&mut BufWriter<File>>) -> ResearchResult<()> {
    if let Some(writer) = writer {
        writer.flush().map_err(CommandError::io)?;
        writer.get_ref().sync_data().map_err(CommandError::io)?;
    }
    Ok(())
}

fn write_questionnaire_table(
    path: &Path,
    responses: &[QuestionnaireResponseV1],
    delimiter: u8,
) -> ResearchResult<()> {
    let mut writer = create_table(path, &questionnaire_headers(), delimiter)?;
    for response in responses {
        response.validate()?;
        write_delimited(&mut writer, &questionnaire_values(response)?, delimiter)?;
    }
    writer.flush().map_err(CommandError::io)?;
    writer.get_ref().sync_data().map_err(CommandError::io)
}

fn file_receipt(
    root: &Path,
    kind: RunOutputKindV4,
    source_name: &str,
    row_count: Option<u64>,
) -> ResearchResult<RunOutputV4> {
    let (sha256, byte_length) = file_digest(&root.join(source_name))?;
    Ok(RunOutputV4 {
        kind,
        file_name: source_name.to_owned(),
        sha256,
        byte_length,
        row_count,
    })
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

fn rename_create_new(source: &Path, target: &Path) -> ResearchResult<()> {
    if !source.exists() {
        return Ok(());
    }
    if target.exists() {
        return Err(CommandError::forbidden(
            "A finalized run artifact already exists; no file was overwritten.",
        ));
    }
    fs::rename(source, target).map_err(CommandError::io)
}

fn final_name(name: &str) -> &str {
    match name {
        RATINGS_CSV_PARTIAL => RATINGS_CSV_FINAL,
        RATINGS_TSV_PARTIAL => RATINGS_TSV_FINAL,
        QUESTIONNAIRE_CSV_PARTIAL => QUESTIONNAIRE_CSV_FINAL,
        QUESTIONNAIRE_TSV_PARTIAL => QUESTIONNAIRE_TSV_FINAL,
        _ => name,
    }
}

fn sample_headers() -> [&'static str; 43] {
    [
        "schema",
        "version",
        "sequence",
        "runId",
        "participantId",
        "attemptNumber",
        "settingsSha256",
        "assignmentPlanSha256",
        "stimulusPosition",
        "stimulusKind",
        "stimulusId",
        "stimulusSha256",
        "stimulusByteLength",
        "stimulusDurationMs",
        "stimulusUrl",
        "stimulusVideoId",
        "wallTimeUtc",
        "monotonicTimeNs",
        "lslTimeSeconds",
        "sampleRateHz",
        "scheduledElapsedMs",
        "observedElapsedMs",
        "schedulerLatenessMs",
        "schedulerJitterMs",
        "stateAnchorAgeMs",
        "missedSlotsBefore",
        "mediaTimeMs",
        "currentValence",
        "currentArousal",
        "targetValence",
        "targetArousal",
        "radius",
        "angleDegrees",
        "oscillationFrequency",
        "edgeSmoothness",
        "projectionAmplitude",
        "pulseSynchrony",
        "waveSizeVariation",
        "saturation",
        "animationActive",
        "inputActive",
        "inputKind",
        "feedbackVisible",
    ]
}

fn sample_values(sample: &ResearchSampleV1) -> ResearchResult<Vec<String>> {
    let identity = &sample.stimulus_identity;
    Ok(vec![
        sample.schema.clone(),
        sample.version.to_string(),
        sample.sequence.to_string(),
        sample.run_id.clone(),
        sample.participant_id.clone(),
        sample.attempt_number.to_string(),
        sample.settings_sha256.clone(),
        sample.assignment_plan_sha256.clone(),
        sample.stimulus_position.to_string(),
        enum_cell(identity.kind)?,
        identity.stimulus_id.clone(),
        identity.sha256.clone().unwrap_or_default(),
        identity
            .byte_length
            .map(|value| value.to_string())
            .unwrap_or_default(),
        number_cell(identity.duration_ms),
        identity.url.clone().unwrap_or_default(),
        identity.video_id.clone().unwrap_or_default(),
        sample.wall_time_utc.clone(),
        sample.monotonic_time_ns.clone(),
        sample.lsl_time_seconds.map(number_cell).unwrap_or_default(),
        sample.sample_rate_hz.to_string(),
        number_cell(sample.scheduled_elapsed_ms),
        number_cell(sample.observed_elapsed_ms),
        number_cell(sample.scheduler_lateness_ms),
        number_cell(sample.scheduler_jitter_ms),
        number_cell(sample.state_anchor_age_ms),
        sample.missed_slots_before.to_string(),
        number_cell(sample.media_time_ms),
        number_cell(sample.current_valence),
        number_cell(sample.current_arousal),
        number_cell(sample.target_valence),
        number_cell(sample.target_arousal),
        number_cell(sample.radius),
        number_cell(sample.angle_degrees),
        number_cell(sample.oscillation_frequency),
        number_cell(sample.edge_smoothness),
        number_cell(sample.projection_amplitude),
        number_cell(sample.pulse_synchrony),
        number_cell(sample.wave_size_variation),
        number_cell(sample.saturation),
        sample.animation_active.to_string(),
        sample.input_active.to_string(),
        enum_cell(sample.input_kind)?,
        sample.feedback_visible.to_string(),
    ])
}

fn questionnaire_headers() -> [&'static str; 25] {
    [
        "schema",
        "version",
        "sequence",
        "runId",
        "participantId",
        "attemptNumber",
        "settingsSha256",
        "assignmentPlanSha256",
        "protocolPlanSha256",
        "protocolStepPosition",
        "moduleId",
        "questionnaireId",
        "questionnaireVersion",
        "definitionSha256",
        "itemId",
        "itemOrder",
        "optionId",
        "optionOrder",
        "responseLabel",
        "scoreValue",
        "subscale",
        "status",
        "wallTimeUtc",
        "monotonicTimeNs",
        "responseLatencyMs",
    ]
}

fn questionnaire_values(response: &QuestionnaireResponseV1) -> ResearchResult<Vec<String>> {
    Ok(vec![
        response.schema.clone(),
        response.version.to_string(),
        response.sequence.to_string(),
        response.run_id.clone(),
        response.participant_id.clone(),
        response.attempt_number.to_string(),
        response.settings_sha256.clone(),
        response.assignment_plan_sha256.clone(),
        response.protocol_plan_sha256.clone(),
        response.protocol_step_position.to_string(),
        response.module_id.clone(),
        response.questionnaire_id.clone(),
        response.questionnaire_version.clone(),
        response.definition_sha256.clone(),
        response.item_id.clone(),
        response.item_order.to_string(),
        response.option_id.clone(),
        response.option_order.to_string(),
        response.response_label.clone(),
        response.score_value.map(number_cell).unwrap_or_default(),
        response.subscale.clone().unwrap_or_default(),
        enum_cell(response.status)?,
        response.wall_time_utc.clone(),
        response.monotonic_time_ns.clone(),
        number_cell(response.response_latency_ms),
    ])
}

fn enum_cell<T: Serialize>(value: T) -> ResearchResult<String> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| CommandError::io("A tabular enum value could not be serialized."))
}

fn number_cell(value: f64) -> String {
    if value == 0.0 {
        "0".to_owned()
    } else {
        value.to_string()
    }
}

fn write_delimited<W: Write>(
    writer: &mut W,
    values: &[String],
    delimiter: u8,
) -> ResearchResult<()> {
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            writer.write_all(&[delimiter]).map_err(CommandError::io)?;
        }
        let quoted = value
            .bytes()
            .any(|byte| byte == delimiter || matches!(byte, b'"' | b'\r' | b'\n'));
        if quoted {
            writer.write_all(b"\"").map_err(CommandError::io)?;
            writer
                .write_all(value.replace('"', "\"\"").as_bytes())
                .map_err(CommandError::io)?;
            writer.write_all(b"\"").map_err(CommandError::io)?;
        } else {
            writer
                .write_all(value.as_bytes())
                .map_err(CommandError::io)?;
        }
    }
    writer.write_all(b"\n").map_err(CommandError::io)
}

struct SessionCreationGuard {
    session_dir: PathBuf,
    recovery_path: PathBuf,
    armed: bool,
}

impl SessionCreationGuard {
    fn new(session_dir: PathBuf, recovery_path: PathBuf) -> Self {
        Self {
            session_dir,
            recovery_path,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for SessionCreationGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let _ = fs::remove_file(&self.recovery_path);
        if self.session_dir.parent().is_some() {
            let _ = fs::remove_dir_all(&self.session_dir);
        }
    }
}

// Keeps imports for schema-level compatibility checks close to serialization.
#[allow(dead_code)]
fn _legacy_event_shape(_: &ResearchEventV1, _: &SampleStimulusIdentityV1) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::{
        GenderCodeV1, HandednessCodeV1, InputKindV1, RecoverySummaryV1, StimulusSourceKindV1,
    };
    use crate::research_native_protocol::records::{
        ExperimentPackageRunReceiptV1, PACKAGE_RECOVERY_JOURNAL_SCHEMA,
    };
    use crate::research_protocol::{RunPlaybackModeV3, RunPlaybackQualificationV3};

    fn sample(sequence: u64) -> ResearchSampleV1 {
        ResearchSampleV1 {
            schema: crate::research_contracts::RESEARCH_SAMPLE_SCHEMA.to_owned(),
            version: 1,
            sequence,
            run_id: "11111111-1111-4111-8111-111111111111".to_owned(),
            participant_id: "P001".to_owned(),
            attempt_number: 1,
            settings_sha256: "a".repeat(64),
            assignment_plan_sha256: "b".repeat(64),
            stimulus_position: 1,
            stimulus_identity: SampleStimulusIdentityV1 {
                kind: StimulusSourceKindV1::WorkspaceFile,
                stimulus_id: "calm-01".to_owned(),
                sha256: Some("c".repeat(64)),
                byte_length: Some(1_024),
                duration_ms: 1_000.0,
                url: None,
                video_id: None,
            },
            wall_time_utc: "2026-09-10T12:00:00.000Z".to_owned(),
            monotonic_time_ns: sequence.to_string(),
            lsl_time_seconds: None,
            sample_rate_hz: 130,
            scheduled_elapsed_ms: 0.0,
            observed_elapsed_ms: 0.0,
            scheduler_lateness_ms: 0.0,
            scheduler_jitter_ms: 0.0,
            state_anchor_age_ms: 0.0,
            missed_slots_before: 0,
            media_time_ms: 0.0,
            current_valence: 0.0,
            current_arousal: 0.0,
            target_valence: 0.0,
            target_arousal: 0.0,
            radius: 0.0,
            angle_degrees: 0.0,
            oscillation_frequency: 0.5,
            edge_smoothness: 0.0,
            projection_amplitude: 0.2,
            pulse_synchrony: 0.2,
            wave_size_variation: 0.0,
            saturation: 0.0,
            animation_active: true,
            input_active: false,
            input_kind: InputKindV1::Digital,
            feedback_visible: true,
        }
    }

    fn journal(partial_sample_count: u64) -> PackageRecoveryJournalV1 {
        PackageRecoveryJournalV1 {
            schema: PACKAGE_RECOVERY_JOURNAL_SCHEMA.to_owned(),
            version: 1,
            recovery_id: "22222222-2222-4222-8222-222222222222".to_owned(),
            run_id: sample(1).run_id,
            experiment_id: "video-affect-v1".to_owned(),
            participant_id: "P001".to_owned(),
            participant_code: "EF".to_owned(),
            age: 27,
            gender: GenderCodeV1::W,
            handedness: HandednessCodeV1::R,
            attempt_number: 1,
            session_stem: "P001_EF_A27_GW_HR_20260910T120000000Z_R01".to_owned(),
            started_at: "2026-09-10T12:00:00.000Z".to_owned(),
            playback_mode: RunPlaybackModeV3::NativeGstPlay,
            playback_qualification: RunPlaybackQualificationV3::QualifiedNative,
            package: ExperimentPackageRunReceiptV1 {
                canonical_source_byte_sha256: "d".repeat(64),
                package_definition_sha256: "e".repeat(64),
                package_id: "demo-package".to_owned(),
                language_id: "en".to_owned(),
                language_selection_path: vec!["en".to_owned()],
                assignment_sha256: "f".repeat(64),
                asset_bindings_sha256: "1".repeat(64),
            },
            settings_sha256: "a".repeat(64),
            assignment_plan_sha256: "b".repeat(64),
            protocol_plan_sha256: "2".repeat(64),
            definition_hashes: Vec::new(),
            partial_sample_count,
            partial_event_count: 0,
            submitted_response_count: 0,
            submitted_responses: Vec::new(),
            safe_protocol_step_position: 0,
            active_questionnaire_draft: None,
            last_monotonic_time_ns: partial_sample_count.to_string(),
            gap_event_count: 0,
            missed_slot_count: 0,
            recovery: RecoverySummaryV1 {
                resumed: false,
                source_run_id: None,
                restarted_stimulus_ids: Vec::new(),
            },
            pending_finalization: None,
        }
    }

    #[test]
    fn sample_and_questionnaire_columns_match_browser_contracts() {
        assert_eq!(sample_headers().len(), 43);
        assert_eq!(sample_headers()[9], "stimulusKind");
        assert_eq!(questionnaire_headers().len(), 25);
        assert_eq!(questionnaire_headers()[24], "responseLatencyMs");
    }

    #[test]
    fn torn_journal_tail_is_ignored_and_removed_before_append() {
        let root =
            std::env::temp_dir().join(format!("affect-research-journal-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("journal.jsonl");
        fs::write(&path, b"{\"ok\":true}\n{\"torn\"").unwrap();
        truncate_torn_tail(&path).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"ok\":true}\n");
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn delimiter_parser_round_trips_quotes_and_rejects_post_quote_bytes() {
        for delimiter in [b',', b'\t'] {
            let values = vec![
                "plain".to_owned(),
                format!("contains{}delimiter", delimiter as char),
                "say \"yes\"".to_owned(),
                String::new(),
            ];
            let line = delimited_line(&values, delimiter).unwrap();
            let decoded = parse_delimited_line(&line, delimiter).unwrap();
            assert!(values
                .iter()
                .map(String::as_bytes)
                .eq(decoded.iter().map(Vec::as_slice)));
        }
        assert!(parse_delimited_line(b"\"closed\"trailing,value\n", b',').is_err());
        assert!(parse_delimited_line(b"\"unterminated,value\n", b',').is_err());
    }

    #[test]
    fn recovered_sample_rows_are_fully_typed_canonical_and_trimmed_to_journal() {
        let root = std::env::temp_dir().join(format!(
            "affect-research-rating-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let path = root.join(RATINGS_CSV_PARTIAL);
        let header = delimited_line(
            &sample_headers()
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>(),
            b',',
        )
        .unwrap();
        let first = delimited_line(&sample_values(&sample(1)).unwrap(), b',').unwrap();
        let second = delimited_line(&sample_values(&sample(2)).unwrap(), b',').unwrap();
        let mut bytes = [header.as_slice(), first.as_slice(), second.as_slice()].concat();
        bytes.extend_from_slice(b"torn");
        fs::write(&path, bytes).unwrap();
        drop(resume_sample_table(&path, b',', &journal(1)).unwrap());
        assert_eq!(fs::read(&path).unwrap(), [header, first].concat());

        let mut corrupt = sample_values(&sample(1)).unwrap();
        corrupt[27] = "2".to_owned();
        fs::write(
            &path,
            [
                delimited_line(
                    &sample_headers()
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect::<Vec<_>>(),
                    b',',
                )
                .unwrap(),
                delimited_line(&corrupt, b',').unwrap(),
            ]
            .concat(),
        )
        .unwrap();
        assert!(resume_sample_table(&path, b',', &journal(1)).is_err());
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }

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

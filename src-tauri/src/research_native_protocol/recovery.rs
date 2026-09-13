//! Recovery discovery and exact ExperimentPackageV1 rebinding.
//!
//! This module reads only the selected workspace's recovery library. It never
//! starts input, media, timing, or LSL and never exposes filesystem paths.

use super::compiler::{compile_package_selection, CompiledPackageSelectionV1};
use super::records::PackageRecoveryJournalV1;
use super::records::ResearchRunManifestV4;
use super::storage::read_latest_journal;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::LoadedExperimentPackageReceipt;
use crate::research_run_storage::{checked_run_child, checked_run_root};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_RECOVERY_FILES: usize = 100_000;

pub(super) struct BoundPackageRecovery {
    pub(super) journal: PackageRecoveryJournalV1,
    pub(super) selection: CompiledPackageSelectionV1,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageRecoverySummaryV1 {
    pub recovery_id: String,
    pub run_id: String,
    pub participant_id: String,
    pub attempt_number: u32,
    pub settings_sha256: String,
    pub assignment_plan_sha256: String,
    pub protocol_plan_sha256: String,
    pub package_id: String,
    pub package_definition_sha256: String,
    pub language_id: String,
    pub language_selection_path: Vec<String>,
    pub assignment_sha256: String,
    pub safe_protocol_step_position: u32,
    pub protocol_step_count: u32,
    pub resumable: bool,
    pub finalization_pending: bool,
    pub completion_status: Option<crate::research_contracts::CompletionStatusV1>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageRecoveryListingV1 {
    pub schema: &'static str,
    pub version: u32,
    pub package_source_byte_sha256: String,
    pub recoveries: Vec<PackageRecoverySummaryV1>,
    pub participants: Vec<PackageParticipantStatusV1>,
    pub quarantined_count: u32,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PackageParticipantStateV1 {
    Available,
    Active,
    Partial,
    Complete,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageParticipantStatusV1 {
    pub participant_id: String,
    pub state: PackageParticipantStateV1,
    pub latest_attempt_number: Option<u32>,
    pub recovery_id: Option<String>,
    pub finalization_pending: bool,
}

pub(super) fn load_bound_recovery(
    workspace_root: &Path,
    loaded: &LoadedExperimentPackageReceipt,
    recovery_id: &str,
) -> ResearchResult<BoundPackageRecovery> {
    validate_recovery_id(recovery_id)?;
    let recovery_root = recovery_root(workspace_root)?;
    let path = exact_recovery_path(&recovery_root, recovery_id)?;
    let journal = read_latest_journal(&path)?.ok_or_else(|| {
        CommandError::invalid_contract("The selected package recovery journal is empty.")
    })?;
    if journal.recovery_id != recovery_id
        || journal.package.canonical_source_byte_sha256 != loaded.canonical_source_byte_sha256
    {
        return Err(CommandError::invalid_contract(
            "The selected recovery does not bind the exact experiment package bytes.",
        ));
    }
    let selection = compile_package_selection(
        &loaded.package,
        &loaded.canonical_source_byte_sha256,
        &journal.package.language_id,
        &journal.package.language_selection_path,
        &journal.participant_id,
    )?;
    journal.validate_bindings(&selection)?;
    validate_recovery_provenance(&journal)?;
    Ok(BoundPackageRecovery { journal, selection })
}

pub(super) fn list_bound_recoveries(
    workspace_root: &Path,
    loaded: &LoadedExperimentPackageReceipt,
) -> ResearchResult<PackageRecoveryListingV1> {
    let recovery_root = recovery_root(workspace_root)?;
    let mut recoveries = Vec::new();
    let mut quarantined_count = 0u32;
    let mut observed = 0usize;
    for entry in fs::read_dir(&recovery_root).map_err(CommandError::io)? {
        let entry = entry.map_err(CommandError::io)?;
        observed += 1;
        if observed > MAX_RECOVERY_FILES {
            return Err(CommandError::forbidden(
                "The recovery library exceeds its bounded file count.",
            ));
        }
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            quarantined_count = quarantined_count.saturating_add(1);
            continue;
        };
        let Some(recovery_id) = file_name.strip_suffix(".package.jsonl") else {
            continue;
        };
        let candidate = (|| -> ResearchResult<Option<PackageRecoverySummaryV1>> {
            validate_recovery_id(recovery_id)?;
            let path = exact_recovery_path(&recovery_root, recovery_id)?;
            let Some(journal) = read_latest_journal(&path)? else {
                return Err(CommandError::invalid_contract(
                    "A package recovery journal is empty.",
                ));
            };
            if journal.package.canonical_source_byte_sha256 != loaded.canonical_source_byte_sha256 {
                return Ok(None);
            }
            let selection = compile_package_selection(
                &loaded.package,
                &loaded.canonical_source_byte_sha256,
                &journal.package.language_id,
                &journal.package.language_selection_path,
                &journal.participant_id,
            )?;
            journal.validate_bindings(&selection)?;
            validate_recovery_provenance(&journal)?;
            let pending = journal.pending_finalization.as_ref();
            Ok(Some(PackageRecoverySummaryV1 {
                recovery_id: journal.recovery_id.clone(),
                run_id: journal.run_id.clone(),
                participant_id: journal.participant_id.clone(),
                attempt_number: journal.attempt_number,
                settings_sha256: journal.settings_sha256.clone(),
                assignment_plan_sha256: journal.assignment_plan_sha256.clone(),
                protocol_plan_sha256: journal.protocol_plan_sha256.clone(),
                package_id: journal.package.package_id.clone(),
                package_definition_sha256: journal.package.package_definition_sha256.clone(),
                language_id: journal.package.language_id.clone(),
                language_selection_path: journal.package.language_selection_path.clone(),
                assignment_sha256: journal.package.assignment_sha256.clone(),
                safe_protocol_step_position: journal.safe_protocol_step_position,
                protocol_step_count: selection.protocol_plan.steps.len() as u32,
                resumable: pending.is_none()
                    && journal.safe_protocol_step_position
                        < selection.protocol_plan.steps.len() as u32,
                finalization_pending: pending.is_some(),
                completion_status: pending.map(|value| value.completion_status),
            }))
        })();
        match candidate {
            Ok(Some(summary)) => recoveries.push(summary),
            Ok(None) => {}
            Err(_) => quarantined_count = quarantined_count.saturating_add(1),
        }
    }
    recoveries.sort_by(|left, right| {
        left.participant_id
            .cmp(&right.participant_id)
            .then(left.attempt_number.cmp(&right.attempt_number))
            .then(left.recovery_id.cmp(&right.recovery_id))
    });
    let (participants, output_quarantine) =
        participant_states(workspace_root, loaded, &recoveries)?;
    quarantined_count = quarantined_count.saturating_add(output_quarantine);
    Ok(PackageRecoveryListingV1 {
        schema: "affect-research-package-recovery-listing",
        version: 1,
        package_source_byte_sha256: loaded.canonical_source_byte_sha256.clone(),
        recoveries,
        participants,
        quarantined_count,
    })
}

fn participant_states(
    workspace_root: &Path,
    loaded: &LoadedExperimentPackageReceipt,
    recoveries: &[PackageRecoverySummaryV1],
) -> ResearchResult<(Vec<PackageParticipantStatusV1>, u32)> {
    let mut quarantined = 0u32;
    let participant_ids = loaded
        .package
        .settings
        .external_protocol
        .definition
        .schedules
        .iter()
        .map(|schedule| schedule.participant_id.clone())
        .collect::<Vec<_>>();
    let outputs_root = checked_run_child(&checked_run_root(workspace_root)?, "outputs")?;
    // New JSON-scoped output folders and preserved historical attempts.
    let mut experiment_roots = Vec::new();
    for key in [
        crate::research_runner_session::recipe_directory_name(
            &loaded.canonical_source_byte_sha256,
        )?,
        loaded.package.settings.experiment.id.clone(),
    ] {
        if outputs_root
            .path
            .join(&key)
            .try_exists()
            .map_err(CommandError::io)?
        {
            experiment_roots.push(checked_run_child(&outputs_root, &key)?);
        }
    }
    let mut participants = Vec::with_capacity(participant_ids.len());
    let mut observed_attempts = 0usize;
    for participant_id in participant_ids {
        let mut state = PackageParticipantStateV1::Available;
        let mut latest_attempt = None;
        for experiment_root in &experiment_roots {
            let participant_path = experiment_root.path.join(&participant_id);
            if participant_path.exists() {
                let participant_root = checked_run_child(experiment_root, &participant_id)?;
                for entry in fs::read_dir(&participant_root.path).map_err(CommandError::io)? {
                    observed_attempts += 1;
                    if observed_attempts > MAX_RECOVERY_FILES {
                        return Err(CommandError::forbidden(
                            "The participant history exceeds its bounded entry count.",
                        ));
                    }
                    let entry = entry.map_err(CommandError::io)?;
                    let metadata = fs::symlink_metadata(entry.path()).map_err(CommandError::io)?;
                    if !metadata.is_dir() || metadata.file_type().is_symlink() {
                        continue;
                    }
                    let Some(stem) = entry.file_name().to_str().map(str::to_owned) else {
                        continue;
                    };
                    let session = checked_run_child(&participant_root, &stem)?;
                    let package_path = session.path.join("experiment.package.json");
                    let owns_package = crate::research_runner_session::read_ordinary(
                        &package_path,
                        &session.path,
                        64 * 1024 * 1024,
                    )
                    .ok()
                    .is_some_and(|bytes| bytes == loaded.canonical_source_text.as_bytes());
                    if !owns_package {
                        if experiment_root
                            .path
                            .file_name()
                            .and_then(|name| name.to_str())
                            == Some(
                                crate::research_runner_session::recipe_directory_name(
                                    &loaded.canonical_source_byte_sha256,
                                )?
                                .as_str(),
                            )
                        {
                            // An unreadable/unfinished attempt in this exact recipe's
                            // folder must never make a used number look available.
                            quarantined = quarantined.saturating_add(1);
                            latest_attempt = Some(
                                latest_attempt
                                    .unwrap_or(0)
                                    .max(attempt_from_stem(&stem).unwrap_or(1)),
                            );
                            state = PackageParticipantStateV1::Partial;
                        }
                        continue;
                    }
                    let attempt = attempt_from_stem(&stem).unwrap_or(1);
                    let observed_state = match crate::research_runner_session::read_ordinary(
                        &session.path.join("manifest.json"),
                        &session.path,
                        8 * 1024 * 1024,
                    ) {
                        Ok(bytes) if bytes.len() <= 8 * 1024 * 1024 => {
                            match serde_json::from_slice::<ResearchRunManifestV4>(&bytes) {
                                Ok(manifest) => {
                                    let selection = compile_package_selection(
                                        &loaded.package,
                                        &loaded.canonical_source_byte_sha256,
                                        &manifest.experiment_package.language_id,
                                        &manifest.experiment_package.language_selection_path,
                                        &participant_id,
                                    );
                                    match selection.and_then(|selection| {
                                        manifest.validate_bindings(&selection)
                                    }) {
                                        Ok(()) => match manifest.completion_status {
                                            crate::research_contracts::CompletionStatusV1::Completed => {
                                                PackageParticipantStateV1::Complete
                                            }
                                            crate::research_contracts::CompletionStatusV1::Partial => {
                                                PackageParticipantStateV1::Partial
                                            }
                                        },
                                        Err(_) => {
                                            quarantined = quarantined.saturating_add(1);
                                            PackageParticipantStateV1::Partial
                                        }
                                    }
                                }
                                Err(_) => {
                                    quarantined = quarantined.saturating_add(1);
                                    PackageParticipantStateV1::Partial
                                }
                            }
                        }
                        _ => PackageParticipantStateV1::Partial,
                    };
                    if latest_attempt.is_none_or(|current| attempt >= current) {
                        latest_attempt = Some(attempt);
                        state = observed_state;
                    }
                }
            }
        }
        let newest_recovery = recoveries
            .iter()
            .filter(|recovery| recovery.participant_id == participant_id)
            .max_by_key(|recovery| recovery.attempt_number);
        let selected_recovery = newest_recovery.filter(|recovery| {
            latest_attempt.is_none_or(|current| recovery.attempt_number >= current)
        });
        if let Some(recovery) = selected_recovery {
            latest_attempt = Some(recovery.attempt_number);
            state = PackageParticipantStateV1::Partial;
        }
        participants.push(PackageParticipantStatusV1 {
            participant_id,
            state,
            latest_attempt_number: latest_attempt,
            recovery_id: selected_recovery.map(|recovery| recovery.recovery_id.clone()),
            finalization_pending: selected_recovery
                .is_some_and(|recovery| recovery.finalization_pending),
        });
    }
    Ok((participants, quarantined))
}

fn attempt_from_stem(stem: &str) -> Option<u32> {
    stem.rsplit_once("_R")
        .and_then(|(_, attempt)| attempt.parse::<u32>().ok())
        .filter(|attempt| *attempt > 0)
}

fn recovery_root(workspace_root: &Path) -> ResearchResult<PathBuf> {
    Ok(checked_run_child(&checked_run_root(workspace_root)?, "recovery")?.path)
}

fn exact_recovery_path(recovery_root: &Path, recovery_id: &str) -> ResearchResult<PathBuf> {
    let path = recovery_root.join(format!("{recovery_id}.package.jsonl"));
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| CommandError::forbidden("The selected recovery journal is unavailable."))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CommandError::forbidden(
            "The selected recovery journal is not an ordinary file.",
        ));
    }
    let canonical = path.canonicalize().map_err(CommandError::io)?;
    if canonical != path || canonical.parent() != Some(recovery_root) {
        return Err(CommandError::forbidden(
            "The selected recovery journal escaped the recovery library.",
        ));
    }
    Ok(path)
}

fn validate_recovery_id(value: &str) -> ResearchResult<()> {
    let parsed = Uuid::parse_str(value)
        .map_err(|_| CommandError::invalid_contract("Recovery ID must be a canonical UUID."))?;
    if parsed.to_string() != value {
        return Err(CommandError::invalid_contract(
            "Recovery ID must be a lowercase canonical UUID.",
        ));
    }
    Ok(())
}

fn validate_recovery_provenance(journal: &PackageRecoveryJournalV1) -> ResearchResult<()> {
    if journal.recovery.resumed != journal.recovery.source_run_id.is_some()
        || journal
            .recovery
            .source_run_id
            .as_deref()
            .is_some_and(|source| source != journal.run_id)
        || (!journal.recovery.resumed && !journal.recovery.restarted_stimulus_ids.is_empty())
    {
        return Err(CommandError::invalid_contract(
            "The package recovery provenance is inconsistent.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod participant_history_tests {
    use super::*;
    use crate::research_experiment_package::parse_canonical_experiment_package_text;
    use crate::research_runner_session::ensure_recipe_directory;

    #[test]
    fn used_numbers_are_json_scoped_and_include_interrupted_and_legacy_attempts() {
        let root = std::env::temp_dir().join(format!("runner-history-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("outputs")).unwrap();
        fs::create_dir(root.join("recovery")).unwrap();
        let source = include_str!("../../../test/fixtures/experiment-package-v1.canonical.json");
        let loaded = parse_canonical_experiment_package_text(source).unwrap();
        let folder = ensure_recipe_directory(&root, &loaded).unwrap();
        fs::create_dir_all(folder.path.join("P001").join("interrupted_R01")).unwrap();
        // Even a crash before the package copy finishes must mark this number used.
        let first = list_bound_recoveries(&root, &loaded).unwrap();
        assert_eq!(
            first.participants[0].state,
            PackageParticipantStateV1::Partial
        );
        assert_eq!(
            first.participants[1].state,
            PackageParticipantStateV1::Available
        );
        let mut other = loaded.package.clone();
        other.package_id = "another-json".into();
        other.integrity.package_definition_sha256 = other.package_definition_sha256().unwrap();
        let other_source = String::from_utf8(other.canonical_file_bytes().unwrap()).unwrap();
        let other = parse_canonical_experiment_package_text(&other_source).unwrap();
        ensure_recipe_directory(&root, &other).unwrap();
        assert!(list_bound_recoveries(&root, &other)
            .unwrap()
            .participants
            .iter()
            .all(|p| p.state == PackageParticipantStateV1::Available));
        let legacy = root
            .join("outputs")
            .join(&loaded.package.settings.experiment.id)
            .join("P002")
            .join("legacy_R01");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("experiment.package.json"), source).unwrap();
        assert_eq!(
            list_bound_recoveries(&root, &loaded).unwrap().participants[1].state,
            PackageParticipantStateV1::Partial
        );
        assert!(list_bound_recoveries(&root, &other)
            .unwrap()
            .participants
            .iter()
            .all(|p| p.state == PackageParticipantStateV1::Available));
    }
}

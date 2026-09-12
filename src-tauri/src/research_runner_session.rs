//! Runner-only selection, recipe output identity and effective LSL naming.
//! These receipts do not modify Planner bytes or the frozen v1/v4 contracts.
use crate::research_contracts::ResearchLslSettingsV1;
use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::{
    parse_canonical_experiment_package_text, LoadedExperimentPackageReceipt,
};
use crate::research_native_protocol::runtime::PackageProtocolRuntime;
use crate::research_run_storage::{
    acquire_attempt_lock, checked_run_child, checked_run_root, ensure_checked_run_child,
    CheckedRunDirectory,
};
use crate::research_workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, sync::Arc};
use tauri::{Manager, State, WebviewWindow};

pub(crate) const SESSION_FILE: &str = "runner-session.v1.json";

pub(crate) fn recipe_directory_name(hash: &str) -> ResearchResult<String> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
    {
        return Err(CommandError::invalid_contract(
            "Recipe folder requires a SHA-256 identity.",
        ));
    }
    Ok(format!("recipe-{hash}"))
}

pub(crate) fn participant_label(id: &str) -> ResearchResult<String> {
    let digits = id.strip_prefix('P').filter(|digits| {
        (3..=6).contains(&digits.len()) && digits.bytes().all(|c| c.is_ascii_digit())
    });
    let number = digits
        .and_then(|digits| digits.parse::<u32>().ok())
        .filter(|n| (1..=100_000).contains(n))
        .ok_or_else(|| CommandError::invalid_contract("Select a declared participant number."))?;
    Ok(format!("P{number:02}"))
}

pub(crate) fn participant_lsl(
    settings: &ResearchLslSettingsV1,
    participant_id: &str,
) -> ResearchResult<ResearchLslSettingsV1> {
    let prefix = participant_label(participant_id)?;
    let mut effective = settings.clone();
    effective.state_stream = format!("{prefix}_{}", settings.state_stream);
    effective.marker_stream = format!("{prefix}_{}", settings.marker_stream);
    Ok(effective)
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RunnerSessionV1 {
    schema: String,
    version: u8,
    package_source_byte_sha256: String,
    run_id: String,
    participant_id: String,
    participant_number: String,
    lsl: ResearchLslSettingsV1,
}
impl RunnerSessionV1 {
    pub(crate) fn new(
        hash: &str,
        run_id: &str,
        participant_id: &str,
        lsl: &ResearchLslSettingsV1,
    ) -> ResearchResult<Self> {
        recipe_directory_name(hash)?;
        Ok(Self {
            schema: "affect-runner-session".into(),
            version: 1,
            package_source_byte_sha256: hash.into(),
            run_id: run_id.into(),
            participant_id: participant_id.into(),
            participant_number: participant_label(participant_id)?,
            lsl: participant_lsl(lsl, participant_id)?,
        })
    }
}

pub(crate) fn read_ordinary(path: &Path, parent: &Path, limit: u64) -> ResearchResult<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(CommandError::io)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > limit
        || path.canonicalize().map_err(CommandError::io)? != path
        || path.parent() != Some(parent)
    {
        return Err(CommandError::forbidden(
            "Runner session file is not an ordinary bounded file in its recipe folder.",
        ));
    }
    use std::io::Read;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(CommandError::io)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    if bytes.len() as u64 > limit {
        return Err(CommandError::forbidden(
            "Runner session file exceeds its size bound.",
        ));
    }
    Ok(bytes)
}

pub(crate) fn ensure_recipe_directory(
    root: &Path,
    loaded: &LoadedExperimentPackageReceipt,
) -> ResearchResult<CheckedRunDirectory> {
    let outputs = checked_run_child(&checked_run_root(root)?, "outputs")?;
    let directory = ensure_checked_run_child(
        &outputs,
        &recipe_directory_name(&loaded.canonical_source_byte_sha256)?,
    )?;
    let _lock = acquire_attempt_lock(&directory.path)?;
    let path = directory.path.join("experiment.package.json");
    if !path.try_exists().map_err(CommandError::io)? {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(CommandError::io)?;
        file.write_all(loaded.canonical_source_text.as_bytes())
            .map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)?;
    }
    if read_ordinary(&path, &directory.path, 64 * 1024 * 1024)?
        != loaded.canonical_source_text.as_bytes()
    {
        return Err(CommandError::forbidden(
            "The recipe output folder contains different experiment bytes.",
        ));
    }
    Ok(directory)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionReceipt {
    schema: &'static str,
    version: u8,
    package_source_byte_sha256: String,
    participant_id: Option<String>,
    output_directory: String,
}

fn selection(
    root: &Path,
    source: &str,
    participant_id: Option<String>,
) -> ResearchResult<SelectionReceipt> {
    let loaded = parse_canonical_experiment_package_text(source)?;
    let valid = |id: &str| {
        loaded
            .package
            .settings
            .external_protocol
            .definition
            .schedules
            .iter()
            .any(|s| s.participant_id == id)
    };
    if participant_id.as_deref().is_some_and(|id| !valid(id)) {
        return Err(CommandError::invalid_contract(
            "This JSON has no schedule for that participant number.",
        ));
    }
    let directory = ensure_recipe_directory(root, &loaded)?;
    let _lock = acquire_attempt_lock(&directory.path)?;
    let path = directory.path.join("participant.selection.json");
    let participant_id = if let Some(id) = participant_id {
        let bytes = serde_json::to_vec(&id).map_err(|_| {
            CommandError::invalid_contract("Could not retain participant selection.")
        })?;
        let temporary = directory
            .path
            .join(format!("selection-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(CommandError::io)?;
            file.write_all(&bytes).map_err(CommandError::io)?;
            file.sync_all().map_err(CommandError::io)?;
            // Never follow a replaced preference file or junction.
            if path.try_exists().map_err(CommandError::io)? {
                read_ordinary(&path, &directory.path, 128)?;
            }
            fs::rename(&temporary, &path).map_err(CommandError::io)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        Some(id)
    } else if path.try_exists().map_err(CommandError::io)? {
        let id: String = serde_json::from_slice(&read_ordinary(&path, &directory.path, 128)?)
            .map_err(|_| {
                CommandError::invalid_contract("The retained participant number is invalid.")
            })?;
        if !valid(&id) {
            return Err(CommandError::invalid_contract(
                "The retained participant is absent from this JSON.",
            ));
        }
        Some(id)
    } else {
        None
    };
    Ok(SelectionReceipt {
        schema: "affect-runner-selection",
        version: 1,
        package_source_byte_sha256: loaded.canonical_source_byte_sha256.clone(),
        participant_id,
        output_directory: format!(
            "outputs/{}",
            recipe_directory_name(&loaded.canonical_source_byte_sha256)?
        ),
    })
}

#[tauri::command]
pub async fn research_runner_selection(
    window: WebviewWindow,
    workspace: State<'_, Arc<WorkspaceService>>,
    runtime: State<'_, Arc<PackageProtocolRuntime>>,
    workspace_id: String,
    source_text: String,
    participant_id: Option<String>,
) -> ResearchResult<SelectionReceipt> {
    if window.label() != "research"
        || window.try_state::<DesktopRole>().as_deref() != Some(&DesktopRole::Runner)
    {
        return Err(CommandError::forbidden(
            "Only Experiment Runner owns participant selection.",
        ));
    }
    let workspace = Arc::clone(&workspace);
    let runtime = Arc::clone(&runtime);
    tauri::async_runtime::spawn_blocking(move || {
        runtime.while_idle(|| {
            workspace.with_workspace(&workspace_id, |root, _| {
                selection(root, &source_text, participant_id)
            })
        })
    })
    .await
    .map_err(|_| CommandError::forbidden("Participant selection could not finish."))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_retained_and_outputs_are_isolated_by_exact_json() {
        let root_path =
            std::env::temp_dir().join(format!("affect-runner-selection-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root_path.join("outputs")).unwrap();
        let root = root_path.as_path();
        let source = include_str!("../../test/fixtures/experiment-package-v1.canonical.json");
        let a = selection(root, source, Some("P001".into())).unwrap();
        assert_eq!(
            selection(root, source, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P001")
        );
        assert!(selection(root, source, Some("P999999".into())).is_err());
        assert_ne!(
            recipe_directory_name(&"a".repeat(64)).unwrap(),
            recipe_directory_name(&"b".repeat(64)).unwrap()
        );
        assert!(root
            .join(&a.output_directory)
            .join("experiment.package.json")
            .is_file());
        assert_eq!(
            selection(root, source, Some("P002".into()))
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P002")
        );
        let loaded = parse_canonical_experiment_package_text(source).unwrap();
        let mut changed = loaded.package.clone();
        changed.package_id = "another-json-same-experiment-id".into();
        changed.integrity.package_definition_sha256 = changed.package_definition_sha256().unwrap();
        let changed_source = String::from_utf8(changed.canonical_file_bytes().unwrap()).unwrap();
        let b = selection(root, &changed_source, None).unwrap();
        assert_ne!(a.output_directory, b.output_directory);
        assert_eq!(b.participant_id, None);
        assert_eq!(
            selection(root, source, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P002")
        );
        let snapshot = root
            .join(&b.output_directory)
            .join("experiment.package.json");
        fs::write(snapshot, b"corrupt").unwrap();
        assert!(selection(root, &changed_source, None).is_err());
        assert!(recipe_directory_name("../escape").is_err());
    }
    #[test]
    fn participant_names_preserve_the_other_lsl_fields_and_original() {
        let lsl = ResearchLslSettingsV1 {
            enabled: true,
            state_stream: "AffectState".into(),
            marker_stream: "Events".into(),
            stream_type: "Affect".into(),
            source_id: "original".into(),
        };
        let effective = participant_lsl(&lsl, "P001").unwrap();
        assert_eq!(effective.state_stream, "P01_AffectState");
        assert_eq!(effective.marker_stream, "P01_Events");
        assert_eq!(effective.source_id, lsl.source_id);
        assert_eq!(effective.stream_type, lsl.stream_type);
        assert_eq!(lsl.state_stream, "AffectState");
        assert_eq!(participant_label("P100000").unwrap(), "P100000");
        assert!(participant_label("P000").is_err());
    }
}

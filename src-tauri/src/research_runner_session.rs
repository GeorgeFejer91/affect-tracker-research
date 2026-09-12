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

pub(crate) enum RunnerDocument {
    Package(Box<LoadedExperimentPackageReceipt>),
    Master(Box<crate::research_planner_recipe_supported::LoadedSupportedPlannerRecipe>),
}
impl RunnerDocument {
    pub(crate) fn read(source: &str) -> ResearchResult<Self> {
        // P7 bounds and canonical-byte checks precede exact schema dispatch.
        // Each owner validates its own complete version; no fallback or repair.
        let value = crate::research_planner_recipe::read_value(source.as_bytes())?;
        match value["schema"].as_str() {
            Some("affect-research-planner-recipe") => Ok(Self::Master(Box::new(
                crate::research_planner_recipe_supported::parse_supported_planner_recipe_bytes(
                    source.as_bytes(),
                )?,
            ))),
            Some("affect-research-experiment-package") => Ok(Self::Package(Box::new(
                parse_canonical_experiment_package_text(source)?,
            ))),
            _ => Err(CommandError::invalid_contract(
                "Runner requires a supported complete master or experiment package.",
            )),
        }
    }
    pub(crate) fn source_hash(&self) -> &str {
        match self {
            Self::Package(p) => &p.canonical_source_byte_sha256,
            Self::Master(p) => &p.canonical_source_byte_sha256,
        }
    }
    pub(crate) fn lsl_enabled(&self) -> bool {
        match self {
            Self::Package(p) => p.package.settings.advanced.lsl.enabled,
            Self::Master(p) => p.recipe.policy().lsl.enabled,
        }
    }
    fn valid_participant(&self, id: &str) -> bool {
        match self {
            Self::Package(p) => p
                .package
                .settings
                .external_protocol
                .definition
                .schedules
                .iter()
                .any(|s| s.participant_id == id),
            Self::Master(_) => {
                crate::research_runner_master::validate_master_participant(id).is_ok()
            }
        }
    }
    pub(crate) fn ensure_directory(&self, root: &Path) -> ResearchResult<CheckedRunDirectory> {
        match self {
            Self::Package(p) => ensure_recipe_directory(root, p),
            Self::Master(p) => ensure_source_directory(
                root,
                &p.canonical_source_byte_sha256,
                &p.canonical_source_text,
                "experiment.master.json",
            ),
        }
    }
}

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
    ensure_source_directory(
        root,
        &loaded.canonical_source_byte_sha256,
        &loaded.canonical_source_text,
        "experiment.package.json",
    )
}

fn ensure_source_directory(
    root: &Path,
    hash: &str,
    source: &str,
    snapshot_name: &str,
) -> ResearchResult<CheckedRunDirectory> {
    let outputs = checked_run_child(&checked_run_root(root)?, "outputs")?;
    let directory = ensure_checked_run_child(&outputs, &recipe_directory_name(hash)?)?;
    let _lock = acquire_attempt_lock(&directory.path)?;
    let path = directory.path.join(snapshot_name);
    if !path.try_exists().map_err(CommandError::io)? {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(CommandError::io)?;
        file.write_all(source.as_bytes())
            .map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)?;
    }
    if read_ordinary(&path, &directory.path, 64 * 1024 * 1024)? != source.as_bytes() {
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
    let loaded = RunnerDocument::read(source)?;
    let valid = |id: &str| loaded.valid_participant(id);
    if participant_id.as_deref().is_some_and(|id| !valid(id)) {
        return Err(CommandError::invalid_contract(
            "This JSON has no schedule for that participant number.",
        ));
    }
    let directory = loaded.ensure_directory(root)?;
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
        package_source_byte_sha256: loaded.source_hash().into(),
        participant_id,
        output_directory: format!("outputs/{}", recipe_directory_name(loaded.source_hash())?),
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
    const MASTER_V2: &str =
        include_str!("../../test/fixtures/runner-master-v2-owner.canonical.json");
    #[test]
    fn supported_master_intake_is_closed_and_preserves_exact_source_and_policy() {
        use crate::research_planner_recipe_supported::SupportedPlannerRecipe;
        let document = RunnerDocument::read(MASTER_V2).unwrap();
        let RunnerDocument::Master(master) = &document else {
            panic!("Expected master");
        };
        assert!(matches!(master.recipe, SupportedPlannerRecipe::V2(_)));
        assert_eq!(master.canonical_source_text, MASTER_V2);
        assert_eq!(document.source_hash(), master.canonical_source_byte_sha256);
        assert_eq!(document.lsl_enabled(), master.recipe.policy().lsl.enabled);
        assert!(document.valid_participant("P001"));
        assert!(document.valid_participant("P100000"));
        for id in ["P01", "P0001", "P000", "P100001", "../P001"] {
            assert!(!document.valid_participant(id));
        }
        assert!(RunnerDocument::read(MASTER_V2.trim_end()).is_err());
        let value: serde_json::Value = serde_json::from_str(MASTER_V2).unwrap();
        for version in [
            serde_json::json!(1),
            serde_json::json!(3),
            serde_json::json!("2"),
        ] {
            let mut wrong = value.clone();
            wrong["version"] = version;
            let mut bytes = crate::research_contracts::canonical_json(&wrong, &[]).unwrap();
            bytes.push(b'\n');
            assert!(RunnerDocument::read(std::str::from_utf8(&bytes).unwrap()).is_err());
        }
        let mut wrong = value;
        wrong["segments"]["P2"]["questionnaires"]["definitions"][0]["title"] =
            serde_json::json!("Changed without owner integrity");
        let mut bytes = crate::research_contracts::canonical_json(&wrong, &[]).unwrap();
        bytes.push(b'\n');
        assert!(RunnerDocument::read(std::str::from_utf8(&bytes).unwrap()).is_err());
        let v1 = RunnerDocument::read(include_str!(
            "../../test/fixtures/planner-recipe-current-v1.canonical.json"
        ))
        .unwrap();
        assert!(
            matches!(v1,RunnerDocument::Master(p) if matches!(p.recipe,SupportedPlannerRecipe::V1(_)))
        );
        assert!(matches!(
            RunnerDocument::read(include_str!(
                "../../test/fixtures/experiment-package-v1.canonical.json"
            ))
            .unwrap(),
            RunnerDocument::Package(_)
        ));
    }
    #[test]
    fn two_master_v2_sources_isolate_selection_history_and_reject_changed_snapshots() {
        use crate::research_runner_master::{
            storage::{history, MasterStorage},
            MasterSelector, PreparedMaster,
        };
        let root = std::env::temp_dir().join(format!("runner-v2-session-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("outputs")).unwrap();
        let other = include_str!("../../test/fixtures/planner-recipe-v2-locations.canonical.json");
        let a = selection(&root, MASTER_V2, Some("P001".into())).unwrap();
        let b = selection(&root, other, Some("P002".into())).unwrap();
        assert_ne!(a.output_directory, b.output_directory);
        assert_eq!(
            selection(&root, MASTER_V2, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P001")
        );
        assert_eq!(
            selection(&root, other, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P002")
        );
        let prepared = PreparedMaster::read(
            MASTER_V2,
            "P001",
            MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        let attempt = MasterStorage::create(
            &root,
            &prepared,
            "run-session-isolation",
            serde_json::Value::Null,
            false,
        )
        .unwrap();
        drop(attempt);
        assert_eq!(
            history(&root, MASTER_V2).unwrap()["participants"][0]["participantId"],
            "P001"
        );
        assert!(history(&root, other).unwrap()["participants"]
            .as_array()
            .unwrap()
            .is_empty());
        let snapshot = root
            .join(&a.output_directory)
            .join("experiment.master.json");
        assert_eq!(fs::read(&snapshot).unwrap(), MASTER_V2.as_bytes());
        fs::write(&snapshot, b"corrupt").unwrap();
        assert!(selection(&root, MASTER_V2, None).is_err());
        assert_eq!(
            fs::read(
                root.join(&b.output_directory)
                    .join("experiment.master.json")
            )
            .unwrap(),
            other.as_bytes()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn master_v3_and_v2_sources_isolate_selection_history_and_reject_changed_snapshots() {
        use crate::research_runner_master::{
            storage::{history, MasterStorage},
            MasterSelector, PreparedMaster,
        };
        let root = std::env::temp_dir().join(format!("runner-v2-session-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("outputs")).unwrap();
        let other = include_str!("../../test/fixtures/planner-recipe-v2-locations.canonical.json");
        let a = selection(
            &root,
            include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json"),
            Some("P001".into()),
        )
        .unwrap();
        let b = selection(&root, other, Some("P002".into())).unwrap();
        assert_ne!(a.output_directory, b.output_directory);
        assert_eq!(
            selection(
                &root,
                include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json"),
                None
            )
            .unwrap()
            .participant_id
            .as_deref(),
            Some("P001")
        );
        assert_eq!(
            selection(&root, other, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P002")
        );
        let prepared = PreparedMaster::read(
            include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json"),
            "P001",
            MasterSelector {
                variant_id: "variant-3".into(),
                language_id: "en".into(),
                language_selection_path: vec!["both".into(), "en".into()],
                presentation_target: "desktop-screen".into(),
            },
        )
        .unwrap();
        let attempt = MasterStorage::create(
            &root,
            &prepared,
            "run-session-isolation",
            serde_json::Value::Null,
            false,
        )
        .unwrap();
        drop(attempt);
        assert_eq!(
            history(
                &root,
                include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json")
            )
            .unwrap()["participants"][0]["participantId"],
            "P001"
        );
        assert!(history(&root, other).unwrap()["participants"]
            .as_array()
            .unwrap()
            .is_empty());
        let snapshot = root
            .join(&a.output_directory)
            .join("experiment.master.json");
        assert_eq!(
            fs::read(&snapshot).unwrap(),
            include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json").as_bytes()
        );
        fs::write(&snapshot, b"corrupt").unwrap();
        assert!(selection(
            &root,
            include_str!("../../test/fixtures/runner-master-v3-owner.canonical.json"),
            None
        )
        .is_err());
        assert_eq!(
            fs::read(
                root.join(&b.output_directory)
                    .join("experiment.master.json")
            )
            .unwrap(),
            other.as_bytes()
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn complete_master_selection_retains_exact_source_in_its_own_folder() {
        let root =
            std::env::temp_dir().join(format!("runner-master-output-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("outputs")).unwrap();
        let master =
            include_str!("../../test/fixtures/planner-recipe-locations-current-v1.canonical.json");
        let legacy = include_str!("../../test/fixtures/experiment-package-v1.canonical.json");
        let a = selection(&root, master, Some("P100000".into())).unwrap();
        let b = selection(&root, legacy, Some("P001".into())).unwrap();
        assert_ne!(a.output_directory, b.output_directory);
        assert_eq!(
            selection(&root, master, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P100000")
        );
        assert_eq!(
            selection(&root, legacy, None)
                .unwrap()
                .participant_id
                .as_deref(),
            Some("P001")
        );
        assert_eq!(
            fs::read(
                root.join(&a.output_directory)
                    .join("experiment.master.json")
            )
            .unwrap(),
            master.as_bytes()
        );
        fs::remove_dir_all(root).unwrap();
    }
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

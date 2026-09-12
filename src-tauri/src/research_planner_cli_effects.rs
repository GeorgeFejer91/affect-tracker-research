//! Internal execution only: the broker owns authorization, single-use grants,
//! request serialization and public projections. No paths/bytes enter via Serde.
//! Call without a broker lock; the guard must acquire and release its own lock.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe_file::{
    write_new_planner_recipe, write_new_supported_planner_recipe, PlannerRecipeWriteError,
    SavedPlannerRecipeFile,
};
use crate::research_workspace::{
    QuestionnaireAssetReceipt, RescanResult, WorkspaceService, WorkspaceStatus,
};
use std::path::PathBuf;

pub(crate) enum NativeEffect {
    SelectWorkspace {
        path: PathBuf,
    },
    ImportVideos {
        workspace_id: String,
        paths: Vec<PathBuf>,
    },
    ImportVideoFolder {
        workspace_id: String,
        path: PathBuf,
    },
    RescanVideoLibrary {
        workspace_id: String,
    },
    StoreQuestionnaire {
        workspace_id: String,
        family_id: String,
        language_tag: String,
        format: String,
        source_sha256: String,
        bytes: Vec<u8>,
    },
    WriteRecipe {
        directory: PathBuf,
        source_text: String,
    },
    WriteSupportedRecipe {
        directory: PathBuf,
        source_text: String,
    },
}

pub(crate) enum NativeEffectReceipt {
    Workspace(WorkspaceStatus),
    VideoLibrary(RescanResult),
    Questionnaire(QuestionnaireAssetReceipt),
    Recipe(SavedPlannerRecipeFile),
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NativeEffectFailureClass {
    EffectNotInvoked,
    MayHaveChangedWorkspace,
    NoRecipePublished,
    RecipePublishedUnverified { basename: String },
}

#[derive(Debug)]
pub(crate) struct NativeEffectFailure {
    pub(crate) class: NativeEffectFailureClass,
    pub(crate) error: CommandError,
}

pub(crate) struct NativeEffectOutcome {
    pub(crate) result: Result<NativeEffectReceipt, NativeEffectFailure>,
    /// Supersession prevents adoption; it cannot erase a completed native effect.
    pub(crate) superseded: Option<CommandError>,
}

fn workspace_failure(error: CommandError) -> NativeEffectFailure {
    NativeEffectFailure {
        class: NativeEffectFailureClass::MayHaveChangedWorkspace,
        error,
    }
}

fn recipe_failure(failure: PlannerRecipeWriteError) -> NativeEffectFailure {
    NativeEffectFailure {
        class: match failure.published_basename {
            Some(basename) => NativeEffectFailureClass::RecipePublishedUnverified { basename },
            None => NativeEffectFailureClass::NoRecipePublished,
        },
        error: failure.error,
    }
}

/// Consume an already-authorized effect exactly once. This is not an atomic
/// transaction with authoring state: cancellation during I/O is observed after
/// the service returns, preserving its actual receipt or failure. The broker
/// must retain that outcome and must not retry a superseded mutation blindly.
pub(crate) fn execute_native_effect(
    workspace: &WorkspaceService,
    effect: NativeEffect,
    check_current: impl Fn() -> ResearchResult<()>,
) -> NativeEffectOutcome {
    if let Err(error) = check_current() {
        return NativeEffectOutcome {
            result: Err(NativeEffectFailure {
                class: NativeEffectFailureClass::EffectNotInvoked,
                error,
            }),
            superseded: None,
        };
    }
    let result = match effect {
        NativeEffect::SelectWorkspace { path } => workspace
            .select(path)
            .map(NativeEffectReceipt::Workspace)
            .map_err(workspace_failure),
        NativeEffect::ImportVideos {
            workspace_id,
            paths,
        } => workspace
            .import_paths(&workspace_id, paths)
            .map(NativeEffectReceipt::VideoLibrary)
            .map_err(workspace_failure),
        NativeEffect::ImportVideoFolder { workspace_id, path } => workspace
            .import_paths(&workspace_id, vec![path])
            .map(NativeEffectReceipt::VideoLibrary)
            .map_err(workspace_failure),
        NativeEffect::RescanVideoLibrary { workspace_id } => workspace
            .rescan_planner_videos(&workspace_id)
            .map(NativeEffectReceipt::VideoLibrary)
            .map_err(workspace_failure),
        NativeEffect::StoreQuestionnaire {
            workspace_id,
            family_id,
            language_tag,
            format,
            source_sha256,
            bytes,
        } => workspace
            .store_questionnaire_asset(
                &workspace_id,
                &family_id,
                &language_tag,
                &format,
                &source_sha256,
                &bytes,
            )
            .map(NativeEffectReceipt::Questionnaire)
            .map_err(workspace_failure),
        NativeEffect::WriteRecipe {
            directory,
            source_text,
        } => write_new_planner_recipe(&directory, &source_text)
            .map(NativeEffectReceipt::Recipe)
            .map_err(recipe_failure),
        NativeEffect::WriteSupportedRecipe {
            directory,
            source_text,
        } => write_new_supported_planner_recipe(&directory, &source_text)
            .map(NativeEffectReceipt::Recipe)
            .map_err(recipe_failure),
    };
    NativeEffectOutcome {
        result,
        superseded: check_current().err(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{cell::Cell, fs};

    struct Fixture {
        root: PathBuf,
        service: WorkspaceService,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("affect-cli-effects-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            let service = WorkspaceService::new(root.join("app")).unwrap();
            Self { root, service }
        }
        fn select(&self) -> String {
            let path = self.root.join("study");
            fs::create_dir(&path).unwrap();
            let outcome = execute_native_effect(
                &self.service,
                NativeEffect::SelectWorkspace { path },
                || Ok(()),
            );
            assert!(outcome.superseded.is_none());
            match outcome.result.unwrap() {
                NativeEffectReceipt::Workspace(receipt) => receipt.workspace_id.unwrap(),
                _ => panic!("Wrong native receipt"),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }
    fn stale() -> CommandError {
        CommandError::new("stale_revision", "Test revision changed.")
    }

    #[test]
    fn early_guard_never_enters_the_native_service() {
        let fixture = Fixture::new();
        let path = fixture.root.join("study");
        fs::create_dir(&path).unwrap();
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::SelectWorkspace { path: path.clone() },
            || Err(stale()),
        );
        assert_eq!(
            outcome.result.err().unwrap().class,
            NativeEffectFailureClass::EffectNotInvoked
        );
        assert!(outcome.superseded.is_none());
        assert!(!fixture.service.status().selected);
        assert_eq!(fs::read_dir(path).unwrap().count(), 0);
    }

    #[test]
    fn late_guard_preserves_selected_workspace_receipt() {
        let fixture = Fixture::new();
        let path = fixture.root.join("study");
        fs::create_dir(&path).unwrap();
        let checks = Cell::new(0);
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::SelectWorkspace { path },
            || {
                checks.set(checks.get() + 1);
                // Status takes the actual workspace lock: the helper holds no lock here.
                if fixture.service.status().selected {
                    Err(stale())
                } else {
                    Ok(())
                }
            },
        );
        assert_eq!(checks.get(), 2);
        assert_eq!(outcome.superseded, Some(stale()));
        match outcome.result.unwrap() {
            NativeEffectReceipt::Workspace(receipt) => {
                assert_eq!(receipt.workspace_id, fixture.service.status().workspace_id)
            }
            _ => panic!("Lost workspace receipt"),
        }
    }

    #[test]
    fn imports_and_rescan_return_owner_receipts_without_decode_claims() {
        let fixture = Fixture::new();
        let workspace_id = fixture.select();
        let folder = fixture.root.join("source");
        fs::create_dir(&folder).unwrap();
        let path = folder.join("synthetic.mp4");
        fs::write(&path, b"synthetic storage test, not playable media").unwrap();
        for effect in [
            NativeEffect::ImportVideos {
                workspace_id: workspace_id.clone(),
                paths: vec![path],
            },
            NativeEffect::ImportVideoFolder {
                workspace_id: workspace_id.clone(),
                path: folder,
            },
            NativeEffect::RescanVideoLibrary {
                workspace_id: workspace_id.clone(),
            },
        ] {
            let outcome = execute_native_effect(&fixture.service, effect, || Ok(()));
            assert!(outcome.superseded.is_none());
            match outcome.result.unwrap() {
                NativeEffectReceipt::VideoLibrary(receipt) => {
                    assert_eq!(receipt.workspace_id, workspace_id);
                    assert!(!receipt.stimuli.is_empty());
                    assert!(receipt.stimuli.iter().all(|item| item.decode_status
                        == crate::research_workspace::DecodeStatus::Unverified));
                }
                _ => panic!("Wrong native receipt"),
            }
        }
    }

    #[test]
    fn source_receipt_preserves_exact_bytes_and_late_supersession() {
        let fixture = Fixture::new();
        let workspace_id = fixture.select();
        let bytes = b"synthetic test source, not an instrument".to_vec();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let checks = Cell::new(0);
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::StoreQuestionnaire {
                workspace_id,
                family_id: "test-source".into(),
                language_tag: "en".into(),
                format: "txt".into(),
                source_sha256: hash.clone(),
                bytes: bytes.clone(),
            },
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 1 {
                    Ok(())
                } else {
                    Err(stale())
                }
            },
        );
        assert_eq!(outcome.superseded, Some(stale()));
        match outcome.result.unwrap() {
            NativeEffectReceipt::Questionnaire(receipt) => {
                assert_eq!(receipt.source_sha256, hash);
                assert_eq!(
                    fs::read(fixture.root.join("study").join(receipt.relative_path)).unwrap(),
                    bytes
                );
            }
            _ => panic!("Lost source receipt"),
        }
    }

    #[test]
    fn failed_workspace_effect_retains_native_error_and_late_guard() {
        let fixture = Fixture::new();
        let checks = Cell::new(0);
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::RescanVideoLibrary {
                workspace_id: "missing".into(),
            },
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 1 {
                    Ok(())
                } else {
                    Err(stale())
                }
            },
        );
        let failure = outcome.result.err().unwrap();
        assert_eq!(
            failure.class,
            NativeEffectFailureClass::MayHaveChangedWorkspace
        );
        assert_eq!(
            failure.error,
            fixture
                .service
                .rescan_planner_videos("missing")
                .unwrap_err()
        );
        assert_eq!(outcome.superseded, Some(stale()));
    }

    #[test]
    fn recipe_write_preserves_exact_published_bytes_even_when_superseded() {
        let fixture = Fixture::new();
        let source =
            include_str!("../../test/fixtures/planner-recipe-xr-current-v1.canonical.json");
        let checks = Cell::new(0);
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::WriteRecipe {
                directory: fixture.root.clone(),
                source_text: source.into(),
            },
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 1 {
                    Ok(())
                } else {
                    Err(stale())
                }
            },
        );
        assert_eq!(outcome.superseded, Some(stale()));
        match outcome.result.unwrap() {
            NativeEffectReceipt::Recipe(receipt) => {
                assert_eq!(
                    fs::read(fixture.root.join(receipt.basename)).unwrap(),
                    source.as_bytes()
                );
            }
            _ => panic!("Lost recipe publication receipt"),
        }
    }

    #[test]
    fn invalid_recipe_reports_no_publication() {
        let fixture = Fixture::new();
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::WriteRecipe {
                directory: fixture.root.clone(),
                source_text: "{}".into(),
            },
            || Ok(()),
        );
        assert_eq!(
            outcome.result.err().unwrap().class,
            NativeEffectFailureClass::NoRecipePublished
        );
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1); // app-data only
    }

    #[test]
    fn supported_recipe_effect_preserves_v1_rejection_and_late_v2_receipt() {
        let fixture = Fixture::new();
        let source = include_str!("../../test/fixtures/planner-recipe-v2-mixed.canonical.json");
        let legacy = execute_native_effect(
            &fixture.service,
            NativeEffect::WriteRecipe {
                directory: fixture.root.clone(),
                source_text: source.into(),
            },
            || Ok(()),
        );
        assert_eq!(
            legacy.result.err().unwrap().class,
            NativeEffectFailureClass::NoRecipePublished
        );
        let rejected = execute_native_effect(
            &fixture.service,
            NativeEffect::WriteSupportedRecipe {
                directory: fixture.root.clone(),
                source_text: source.into(),
            },
            || Err(stale()),
        );
        assert_eq!(
            rejected.result.err().unwrap().class,
            NativeEffectFailureClass::EffectNotInvoked
        );
        assert_eq!(fs::read_dir(&fixture.root).unwrap().count(), 1);
        let checks = Cell::new(0);
        let outcome = execute_native_effect(
            &fixture.service,
            NativeEffect::WriteSupportedRecipe {
                directory: fixture.root.clone(),
                source_text: source.into(),
            },
            || {
                checks.set(checks.get() + 1);
                if checks.get() == 1 {
                    Ok(())
                } else {
                    Err(stale())
                }
            },
        );
        assert_eq!(outcome.superseded, Some(stale()));
        match outcome.result.unwrap() {
            NativeEffectReceipt::Recipe(receipt) => {
                let path = fixture.root.join(receipt.basename);
                assert_eq!(fs::read(&path).unwrap(), source.as_bytes());
                assert_eq!(
                    crate::research_planner_recipe_file::read_supported_planner_recipe_file(&path)
                        .unwrap()
                        .recipe
                        .version(),
                    2
                );
            }
            _ => panic!("Lost supported recipe receipt"),
        }
    }

    #[test]
    fn writer_unverified_publication_error_retains_original_error_and_basename() {
        // Deterministic mapping check; actual publication/readback faults remain
        // covered by the existing recipe writer's own filesystem tests.
        let error = CommandError::new("verification_failed", "Test readback failure.");
        let failure = recipe_failure(PlannerRecipeWriteError {
            error: error.clone(),
            published_basename: Some("recipe.json".into()),
        });
        assert_eq!(failure.error, error);
        assert_eq!(
            failure.class,
            NativeEffectFailureClass::RecipePublishedUnverified {
                basename: "recipe.json".into()
            }
        );
    }
}

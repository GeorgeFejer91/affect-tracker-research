//! Runner's local file bookmark. Paths never cross the renderer boundary.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe_file::read_supported_planner_recipe_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Bookmark {
    version: u8,
    path: PathBuf,
}

pub(crate) struct RunnerRecentExperiment {
    file: PathBuf,
    pending: Mutex<Option<(PathBuf, String)>>,
}

impl RunnerRecentExperiment {
    pub fn new(app_data: PathBuf) -> Self {
        Self {
            file: app_data.join("runner-previous-experiment.json"),
            pending: Mutex::new(None),
        }
    }

    fn bookmark(&self) -> ResearchResult<Bookmark> {
        let mut bytes = Vec::new();
        fs::File::open(&self.file)
            .map_err(CommandError::io)?
            .take(65_537)
            .read_to_end(&mut bytes)
            .map_err(CommandError::io)?;
        let value: Bookmark = serde_json::from_slice(&bytes).map_err(|_| {
            CommandError::invalid_contract(
                "Previous experiment bookmark is invalid. Load a file again.",
            )
        })?;
        if bytes.len() > 65_536 || value.version != 1 || !value.path.is_absolute() {
            return Err(CommandError::invalid_contract(
                "Previous experiment bookmark is invalid. Load a file again.",
            ));
        }
        Ok(value)
    }

    pub fn status(&self) -> Value {
        match self.bookmark() {
            Ok(value) => {
                json!({"available":true,"basename":value.path.file_name().map(|name|name.to_string_lossy())})
            }
            Err(_) => json!({"available":false,"basename":null}),
        }
    }

    pub fn selected(&self, path: &Path, document: &Value) -> ResearchResult<()> {
        if !path.is_absolute() {
            return Err(CommandError::forbidden(
                "Select a local absolute experiment path.",
            ));
        }
        let hash = document["document"]["canonicalSourceByteSha256"]
            .as_str()
            .ok_or_else(|| {
                CommandError::invalid_contract("Loaded experiment has no source identity.")
            })?;
        *self
            .pending
            .lock()
            .map_err(|_| CommandError::forbidden("Previous experiment state is unavailable."))? =
            Some((path.to_owned(), hash.to_owned()));
        Ok(())
    }

    pub fn load(&self) -> ResearchResult<Value> {
        let bookmark = self.bookmark().map_err(|_| {
            CommandError::forbidden(
                "No previous experiment is available. Load an experiment file first.",
            )
        })?;
        let document = read_supported_planner_recipe_path(&bookmark.path)
            .map_err(|_| CommandError::forbidden("The previous experiment is missing, inaccessible or invalid. Use Load experiment file to locate a valid JSON."))?;
        self.selected(&bookmark.path, &document)?;
        Ok(document)
    }

    pub fn selected_directory(&self) -> ResearchResult<PathBuf> {
        let pending = self.pending.lock().map_err(|_| {
            CommandError::forbidden("Previous experiment state is unavailable.")
        })?;
        pending.as_ref().and_then(|(path, _)| path.parent()).map(Path::to_owned)
            .ok_or_else(|| CommandError::forbidden("Load an experiment file first."))
    }

    /// Persist only after the frontend has accepted the exact native source.
    pub fn confirm(&self, source_sha256: &str) -> ResearchResult<Value> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| CommandError::forbidden("Previous experiment state is unavailable."))?;
        let (path, _) = pending
            .as_ref()
            .filter(|(_, hash)| hash == source_sha256)
            .ok_or_else(|| {
                CommandError::forbidden(
                    "The loaded experiment changed before it could be remembered.",
                )
            })?;
        let parent = self.file.parent().expect("bookmark has parent");
        fs::create_dir_all(parent).map_err(CommandError::io)?;
        let temporary = parent.join(format!("runner-previous-{}.tmp", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec(&Bookmark {
            version: 1,
            path: path.clone(),
        })
        .map_err(CommandError::io)?;
        let result = (|| {
            use std::io::Write;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(CommandError::io)?;
            file.write_all(&bytes).map_err(CommandError::io)?;
            file.sync_all().map_err(CommandError::io)?;
            drop(file);
            fs::rename(&temporary, &self.file).map_err(CommandError::io)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result?;
        *pending = None;
        Ok(self.status())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("affect-runner-recent-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    const FIRST: &[u8] =
        include_bytes!("../../test/fixtures/runner-master-v3-owner.canonical.json");
    const SECOND: &[u8] =
        include_bytes!("../../test/fixtures/planner-recipe-current-v1.canonical.json");
    fn hash(value: &Value) -> &str {
        value["document"]["canonicalSourceByteSha256"]
            .as_str()
            .unwrap()
    }

    #[test]
    fn confirmed_bookmark_survives_restart_and_reads_current_file_bytes() {
        let root = Scratch::new();
        let path = root.0.join("experiment.json");
        fs::write(&path, FIRST).unwrap();
        let recent = RunnerRecentExperiment::new(root.0.clone());
        assert_eq!(recent.status()["available"], false);
        assert!(recent.selected_directory().is_err());
        let first = read_supported_planner_recipe_path(&path).unwrap();
        recent.selected(&path, &first).unwrap();
        assert_eq!(recent.selected_directory().unwrap(), root.0);
        assert_eq!(recent.status()["available"], false);
        assert!(recent.confirm("wrong-source").is_err());
        assert_eq!(
            recent.confirm(hash(&first)).unwrap()["basename"],
            "experiment.json"
        );
        let restarted = RunnerRecentExperiment::new(root.0.clone());
        assert_eq!(restarted.load().unwrap(), first);
        assert_eq!(restarted.selected_directory().unwrap(), root.0);
        fs::write(&path, SECOND).unwrap();
        let changed = restarted.load().unwrap();
        assert_ne!(hash(&changed), hash(&first));
        assert!(restarted.confirm(hash(&first)).is_err());
        assert_eq!(
            restarted.confirm(hash(&changed)).unwrap()["available"],
            true
        );
        fs::write(&path, b"invalid JSON").unwrap();
        assert!(restarted.load().is_err());
        fs::remove_file(&path).unwrap();
        assert!(restarted.load().is_err());
    }

    #[test]
    fn rejected_or_unconfirmed_selection_preserves_last_successful_file() {
        let root = Scratch::new();
        let recent = RunnerRecentExperiment::new(root.0.clone());
        let first = root.0.join("first.json");
        let second = root.0.join("second.json");
        fs::write(&first, FIRST).unwrap();
        fs::write(&second, SECOND).unwrap();
        let document = read_supported_planner_recipe_path(&first).unwrap();
        recent.selected(&first, &document).unwrap();
        recent.confirm(hash(&document)).unwrap();
        recent
            .selected(
                &second,
                &read_supported_planner_recipe_path(&second).unwrap(),
            )
            .unwrap();
        let restarted = RunnerRecentExperiment::new(root.0.clone());
        assert_eq!(restarted.status()["basename"], "first.json");
        assert_eq!(restarted.load().unwrap(), document);
    }

    #[test]
    fn malformed_or_future_bookmark_is_unavailable() {
        let root = Scratch::new();
        let recent = RunnerRecentExperiment::new(root.0.clone());
        for source in ["not-json", "{\"version\":2,\"path\":\"relative.json\"}"] {
            fs::write(&recent.file, source).unwrap();
            assert_eq!(recent.status()["available"], false);
            assert!(recent.load().is_err());
        }
    }
}

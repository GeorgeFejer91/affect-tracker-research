//! Runner's local file bookmark. Paths never cross the renderer boundary.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe_file::read_supported_planner_recipe_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
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

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecentFiles {
    version: u8,
    paths: Vec<PathBuf>,
}
const MAX_HISTORY_BYTES: u64 = 4 * 1024 * 1024;
fn path_id(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    format!("recent-{:x}", Sha256::digest(normalized.as_bytes()))
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

    fn history(&self) -> ResearchResult<RecentFiles> {
        let file = match fs::File::open(&self.file) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RecentFiles {
                    version: 2,
                    paths: Vec::new(),
                })
            }
            Err(error) => return Err(CommandError::io(error)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_HISTORY_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(CommandError::io)?;
        let invalid = || {
            CommandError::invalid_contract(
                "Recent experiment history is invalid. Load a new experiment to continue.",
            )
        };
        if bytes.len() as u64 > MAX_HISTORY_BYTES {
            return Err(invalid());
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        let history = match value["version"].as_u64() {
            Some(1) => {
                let bookmark: Bookmark = serde_json::from_value(value).map_err(|_| invalid())?;
                RecentFiles {
                    version: 2,
                    paths: vec![bookmark.path],
                }
            }
            Some(2) => serde_json::from_value::<RecentFiles>(value).map_err(|_| invalid())?,
            _ => return Err(invalid()),
        };
        if history.paths.len() > 10000
            || history.paths.iter().any(|p| !p.is_absolute())
            || history
                .paths
                .iter()
                .map(|p| path_id(p))
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != history.paths.len()
        {
            return Err(invalid());
        }
        Ok(history)
    }

    pub fn list(&self) -> ResearchResult<Value> {
        let history = self.history()?;
        Ok(
            json!({"schema":"affect-runner-recent-experiments","version":1,"entries":history.paths.iter().map(|path| json!({
            "id":path_id(path),"basename":path.file_name().map(|n|n.to_string_lossy()),
            "folderName":path.parent().and_then(|p|p.file_name()).map(|n|n.to_string_lossy()),
            "available":path.is_file()
        })).collect::<Vec<_>>() }),
        )
    }

    pub fn status(&self) -> Value {
        match self
            .history()
            .ok()
            .and_then(|value| value.paths.into_iter().next())
        {
            Some(path) => {
                json!({"available":true,"basename":path.file_name().map(|name|name.to_string_lossy())})
            }
            None => json!({"available":false,"basename":null}),
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
        let history = self.history()?;
        let path = history.paths.first().ok_or_else(|| {
            CommandError::forbidden(
                "No previous experiment is available. Load a new experiment first.",
            )
        })?;
        self.load_path(path)
    }

    pub fn load_id(&self, id: &str) -> ResearchResult<Value> {
        let history = self.history()?;
        let path = history
            .paths
            .iter()
            .find(|path| path_id(path) == id)
            .ok_or_else(|| {
                CommandError::forbidden("This experiment is no longer in the recent-file list.")
            })?;
        self.load_path(path)
    }

    fn load_path(&self, path: &Path) -> ResearchResult<Value> {
        let document = read_supported_planner_recipe_path(path).map_err(|_| CommandError::forbidden(
            "The previous experiment is missing, inaccessible or invalid. Choose another previous file or load a new experiment."))?;
        self.selected(path, &document)?;
        Ok(document)
    }

    pub fn selected_directory(&self) -> ResearchResult<PathBuf> {
        let pending = self
            .pending
            .lock()
            .map_err(|_| CommandError::forbidden("Previous experiment state is unavailable."))?;
        pending
            .as_ref()
            .and_then(|(path, _)| path.parent())
            .map(Path::to_owned)
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
        let mut history = self.history()?;
        history
            .paths
            .retain(|previous| path_id(previous) != path_id(path));
        history.paths.insert(0, path.clone());
        if history.paths.len() > 10000 {
            return Err(CommandError::forbidden(
                "Recent-file history is full; existing entries were preserved.",
            ));
        }
        let bytes = serde_json::to_vec(&history).map_err(CommandError::io)?;
        if bytes.len() as u64 > MAX_HISTORY_BYTES {
            return Err(CommandError::forbidden(
                "Recent-file history is full; existing entries were preserved.",
            ));
        }
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
    #[test]
    fn recent_list_migrates_preserves_all_files_and_orders_only_confirmed_loads() {
        let root = Scratch::new();
        let first = root.0.join("one").join("experiment.json");
        let second = root.0.join("two").join("experiment.json");
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        fs::create_dir_all(second.parent().unwrap()).unwrap();
        fs::write(&first, FIRST).unwrap();
        fs::write(&second, SECOND).unwrap();
        let recent = RunnerRecentExperiment::new(root.0.clone());
        fs::write(
            &recent.file,
            serde_json::to_vec(&Bookmark {
                version: 1,
                path: first.clone(),
            })
            .unwrap(),
        )
        .unwrap();
        let list = recent.list().unwrap();
        assert_eq!(list["entries"].as_array().unwrap().len(), 1);
        assert_eq!(list["entries"][0]["folderName"], "one");
        let first_id = list["entries"][0]["id"].as_str().unwrap().to_owned();
        assert_eq!(
            recent.load_id(&first_id).unwrap(),
            read_supported_planner_recipe_path(&first).unwrap()
        );
        assert!(recent.load_id("../../not-a-bookmark").is_err());
        let document = read_supported_planner_recipe_path(&second).unwrap();
        recent.selected(&second, &document).unwrap();
        assert_eq!(recent.list().unwrap(), list);
        assert!(recent.confirm("wrong").is_err());
        recent.confirm(hash(&document)).unwrap();
        let restarted = RunnerRecentExperiment::new(root.0.clone());
        let list = restarted.list().unwrap();
        assert_eq!(list["entries"].as_array().unwrap().len(), 2);
        assert_eq!(list["entries"][0]["folderName"], "two");
        assert_eq!(list["entries"][1]["id"], first_id);
        assert!(!list
            .to_string()
            .contains(&root.0.to_string_lossy().replace('\\', "\\\\")));
        let loaded = restarted.load_id(&first_id).unwrap();
        restarted.confirm(hash(&loaded)).unwrap();
        assert_eq!(restarted.list().unwrap()["entries"][0]["id"], first_id);
        assert_eq!(
            restarted.list().unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let history: Value = serde_json::from_slice(&fs::read(&restarted.file).unwrap()).unwrap();
        assert_eq!(history["version"], 2);
        fs::remove_file(&first).unwrap();
        assert_eq!(restarted.list().unwrap()["entries"][0]["available"], false);
        assert!(restarted.load().is_err());
        assert_eq!(
            restarted.list().unwrap()["entries"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
}

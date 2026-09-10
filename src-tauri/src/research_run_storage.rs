//! Shared safe output-directory and create-new attempt primitives.
//!
//! Both the historical runner and the package protocol runtime use this one
//! policy boundary so path, junction, lock, and attempt-number semantics cannot
//! drift between run formats.

use crate::research_error::{CommandError, ResearchResult};
use fs2::FileExt;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunDirectoryIdentity {
    creation_time: u64,
}

#[cfg(unix)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunDirectoryIdentity {
    device: u64,
    inode: u64,
}

#[cfg(not(any(target_os = "windows", unix)))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunDirectoryIdentity {
    created: Option<std::time::SystemTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CheckedRunDirectory {
    pub(crate) path: PathBuf,
    identity: RunDirectoryIdentity,
}

#[derive(Debug)]
pub(crate) struct RunOutputDirectories {
    pub(crate) workspace: CheckedRunDirectory,
    pub(crate) outputs: CheckedRunDirectory,
    pub(crate) experiment: CheckedRunDirectory,
    pub(crate) participant: CheckedRunDirectory,
}

impl RunOutputDirectories {
    pub(crate) fn prepare(
        workspace_root: &Path,
        experiment_id: &str,
        participant_id: &str,
    ) -> ResearchResult<Self> {
        if !is_safe_component(experiment_id) || !is_safe_component(participant_id) {
            return Err(CommandError::invalid_contract(
                "The run output identity contains an unsafe directory component.",
            ));
        }
        let workspace = checked_run_root(workspace_root)?;
        let outputs = checked_run_child(&workspace, "outputs")?;
        let experiment = ensure_checked_run_child(&outputs, experiment_id)?;
        let participant = ensure_checked_run_child(&experiment, participant_id)?;
        let directories = Self {
            workspace,
            outputs,
            experiment,
            participant,
        };
        directories.revalidate()?;
        Ok(directories)
    }

    pub(crate) fn revalidate(&self) -> ResearchResult<()> {
        require_same_run_directory(&self.workspace, checked_run_root(&self.workspace.path)?)?;
        require_same_run_directory(
            &self.outputs,
            checked_run_child(&self.workspace, "outputs")?,
        )?;
        let experiment_name = checked_run_directory_name(&self.experiment)?;
        require_same_run_directory(
            &self.experiment,
            checked_run_child(&self.outputs, experiment_name)?,
        )?;
        let participant_name = checked_run_directory_name(&self.participant)?;
        require_same_run_directory(
            &self.participant,
            checked_run_child(&self.experiment, participant_name)?,
        )
    }

    pub(crate) fn create_session(&self, session_stem: &str) -> ResearchResult<PathBuf> {
        if !is_safe_component(session_stem) {
            return Err(CommandError::invalid_contract(
                "The run session identity contains an unsafe directory component.",
            ));
        }
        self.revalidate()?;
        let session_path = self.participant.path.join(session_stem);
        fs::create_dir(&session_path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                CommandError::forbidden("The new run destination already exists.")
            } else {
                CommandError::io(error)
            }
        })?;
        let session = checked_run_child(&self.participant, session_stem)?;
        self.revalidate()?;
        require_same_run_directory(
            &session,
            checked_run_child(&self.participant, session_stem)?,
        )?;
        Ok(session.path)
    }
}

pub(crate) fn checked_run_root(path: &Path) -> ResearchResult<CheckedRunDirectory> {
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        CommandError::forbidden("The selected workspace output root is unavailable.")
    })?;
    require_ordinary_run_directory(&metadata)?;
    let canonical = path.canonicalize().map_err(|_| {
        CommandError::forbidden("The selected workspace output root is unavailable.")
    })?;
    Ok(CheckedRunDirectory {
        path: canonical,
        identity: run_directory_identity(&metadata),
    })
}

pub(crate) fn ensure_checked_run_child(
    parent: &CheckedRunDirectory,
    name: &str,
) -> ResearchResult<CheckedRunDirectory> {
    if !is_safe_component(name) {
        return Err(CommandError::invalid_contract(
            "The run output identity contains an unsafe directory component.",
        ));
    }
    let child = parent.path.join(name);
    match fs::symlink_metadata(&child) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&child).map_err(|create_error| {
                if create_error.kind() == std::io::ErrorKind::AlreadyExists {
                    CommandError::forbidden(
                        "A run output directory changed while it was being created.",
                    )
                } else {
                    CommandError::io(create_error)
                }
            })?;
        }
        Err(error) => return Err(CommandError::io(error)),
    }
    checked_run_child(parent, name)
}

pub(crate) fn checked_run_child(
    parent: &CheckedRunDirectory,
    name: &str,
) -> ResearchResult<CheckedRunDirectory> {
    let child = parent.path.join(name);
    let metadata = fs::symlink_metadata(&child)
        .map_err(|_| CommandError::forbidden("A required run output directory is unavailable."))?;
    require_ordinary_run_directory(&metadata)?;
    let canonical = child
        .canonicalize()
        .map_err(|_| CommandError::forbidden("A required run output directory is unavailable."))?;
    if canonical != child
        || canonical.parent() != Some(parent.path.as_path())
        || !canonical.starts_with(&parent.path)
    {
        return Err(CommandError::forbidden(
            "A run output directory is not the exact canonical child of its selected parent.",
        ));
    }
    Ok(CheckedRunDirectory {
        path: canonical,
        identity: run_directory_identity(&metadata),
    })
}

fn require_ordinary_run_directory(metadata: &fs::Metadata) -> ResearchResult<()> {
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(CommandError::forbidden(
            "A run output path component is not an ordinary directory.",
        ));
    }
    Ok(())
}

pub(crate) fn checked_run_directory_name(directory: &CheckedRunDirectory) -> ResearchResult<&str> {
    directory
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| CommandError::forbidden("A run output directory name is invalid."))
}

pub(crate) fn require_same_run_directory(
    expected: &CheckedRunDirectory,
    observed: CheckedRunDirectory,
) -> ResearchResult<()> {
    if observed != *expected {
        return Err(CommandError::forbidden(
            "A run output directory changed while the attempt was being prepared.",
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn run_directory_identity(metadata: &fs::Metadata) -> RunDirectoryIdentity {
    use std::os::windows::fs::MetadataExt;
    RunDirectoryIdentity {
        creation_time: metadata.creation_time(),
    }
}

#[cfg(unix)]
fn run_directory_identity(metadata: &fs::Metadata) -> RunDirectoryIdentity {
    use std::os::unix::fs::MetadataExt;
    RunDirectoryIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(not(any(target_os = "windows", unix)))]
fn run_directory_identity(metadata: &fs::Metadata) -> RunDirectoryIdentity {
    RunDirectoryIdentity {
        created: metadata.created().ok(),
    }
}

pub(crate) fn count_previous_attempts(participant_root: &Path) -> ResearchResult<u32> {
    let mut count = 0u32;
    for entry in fs::read_dir(participant_root).map_err(CommandError::io)? {
        if entry
            .map_err(CommandError::io)?
            .file_type()
            .map_err(CommandError::io)?
            .is_dir()
        {
            count = count.saturating_add(1);
        }
    }
    Ok(count)
}

pub(crate) fn acquire_attempt_lock(participant_root: &Path) -> ResearchResult<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(participant_root.join(".affect-research-attempt.lock"))
        .map_err(CommandError::io)?;
    file.try_lock_exclusive().map_err(|_| {
        CommandError::forbidden(
            "Another Affect Research process owns this participant's attempt lock.",
        )
    })?;
    Ok(file)
}

pub(crate) fn is_safe_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 240
        && value != "."
        && value != ".."
        && !value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
                )
        })
}

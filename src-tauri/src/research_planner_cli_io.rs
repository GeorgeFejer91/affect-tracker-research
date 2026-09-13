//! Native-only selection grants for the inherited-I/O Planner CLI.
//! The broker owns active-request/CAS checks and exact effect/retry receipts.
//! Paths never serialize. Claims are one-use; this module performs no writes,
//! media attestation, source compilation or editor mutation.
use crate::research_error::{CommandError, ResearchResult};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

pub(crate) const MAX_CLI_IO_REQUESTS: usize = 256;
pub(crate) const MAX_CLI_VIDEO_PATHS: usize = 256;
pub(crate) const MAX_CLI_PATH_BYTES: usize = 4096;
pub(crate) const MAX_CLI_RETAINED_PATH_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_CLI_QUESTIONNAIRE_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_CLI_LOGICAL_NAME_BYTES: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CliIoPurpose {
    SelectWorkspace,
    ImportVideos,
    ImportVideoFolder,
    ImportQuestionnaire,
    SaveRecipe,
    OpenRecipe,
}

/// Constructed by the native broker from the FULL canonical external request,
/// including revision and non-path arguments. Never trust a renderer fingerprint.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct CliIoRequestBinding {
    pub session_id: Uuid,
    pub request_id: Uuid,
    pub request_sha256: [u8; 32],
}

/// Closed native input. No Serialize/Debug implementation can leak these paths.
pub(crate) enum CliIoSelection {
    SelectWorkspace { directory: String },
    ImportVideos { paths: Vec<String> },
    ImportVideoFolder { directory: String },
    ImportQuestionnaire { path: String },
    SaveRecipe { directory: String },
    OpenRecipe { path: String },
}

impl CliIoSelection {
    fn purpose(&self) -> CliIoPurpose {
        match self {
            Self::SelectWorkspace { .. } => CliIoPurpose::SelectWorkspace,
            Self::ImportVideos { .. } => CliIoPurpose::ImportVideos,
            Self::ImportVideoFolder { .. } => CliIoPurpose::ImportVideoFolder,
            Self::ImportQuestionnaire { .. } => CliIoPurpose::ImportQuestionnaire,
            Self::SaveRecipe { .. } => CliIoPurpose::SaveRecipe,
            Self::OpenRecipe { .. } => CliIoPurpose::OpenRecipe,
        }
    }

    fn paths(&self) -> &[String] {
        match self {
            Self::SelectWorkspace { directory }
            | Self::ImportVideoFolder { directory }
            | Self::SaveRecipe { directory } => std::slice::from_ref(directory),
            Self::ImportVideos { paths } => paths,
            Self::ImportQuestionnaire { path } | Self::OpenRecipe { path } => {
                std::slice::from_ref(path)
            }
        }
    }

    fn fingerprint(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(b"affect-planner-cli-selection-v1\0");
        hash.update([self.purpose() as u8]);
        for path in self.paths() {
            hash.update((path.len() as u64).to_le_bytes());
            hash.update(path.as_bytes());
        }
        hash.finalize().into()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliIoGrantReceipt {
    pub grant_id: Uuid,
    pub purpose: CliIoPurpose,
}

/// Rust-only authority for existing Workspace/S7 services. ImportQuestionnaire
/// cannot yield a path: its dedicated claim returns one bounded byte snapshot.
pub(crate) enum CliIoTarget {
    SelectWorkspace { directory: PathBuf },
    ImportVideos { paths: Vec<PathBuf> },
    ImportVideoFolder { directory: PathBuf },
    SaveRecipe { directory: PathBuf },
    OpenRecipe { path: PathBuf },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CliQuestionnaireFormat {
    Csv,
    Txt,
    Json,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliQuestionnaireSource {
    pub grant_id: Uuid,
    pub logical_name: String,
    pub format: CliQuestionnaireFormat,
    pub byte_length: usize,
    pub sha256: String,
    // Hex expands at most to 8 MiB. A JSON integer array or escaped string can
    // exceed the broker's 16 MiB frame limit for a valid 4 MiB source snapshot.
    pub bytes_hex: String,
}

enum GrantState {
    Available(Vec<PathBuf>),
    Consumed,
    Revoked,
}

struct GrantRecord {
    binding: CliIoRequestBinding,
    selection_sha256: [u8; 32],
    admission: ResearchResult<CliIoGrantReceipt>,
    retained_bytes: usize,
    state: GrantState,
}

/// Wrap in the broker's mutex. The helper has no independent session/thread.
pub(crate) struct PlannerCliIoGrants {
    session_id: Uuid,
    closed: bool,
    records: HashMap<Uuid, GrantRecord>,
    retained_path_bytes: usize,
}

fn failure(code: &str, message: &str) -> CommandError {
    CommandError::new(code, message)
}

impl PlannerCliIoGrants {
    pub(crate) fn new(session_id: Uuid) -> Self {
        Self {
            session_id,
            closed: false,
            records: HashMap::new(),
            retained_path_bytes: 0,
        }
    }

    fn check_session(&self, binding: &CliIoRequestBinding) -> ResearchResult<()> {
        if self.closed {
            return Err(failure(
                "session_closed",
                "Planner file selections are closed.",
            ));
        }
        if binding.session_id != self.session_id
            || binding.session_id.is_nil()
            || binding.request_id.is_nil()
        {
            return Err(failure(
                "stale_session",
                "File selection has no matching Planner session/request.",
            ));
        }
        Ok(())
    }

    pub(crate) fn issue(
        &mut self,
        binding: CliIoRequestBinding,
        selection: CliIoSelection,
    ) -> ResearchResult<CliIoGrantReceipt> {
        self.check_session(&binding)?;
        let selection_sha256 = selection.fingerprint();
        if let Some(record) = self.records.get(&binding.request_id) {
            if record.binding != binding || record.selection_sha256 != selection_sha256 {
                return Err(failure(
                    "request_id_reused",
                    "The request identity was reused with different selection content.",
                ));
            }
            return record.admission.clone();
        }
        if self.records.len() >= MAX_CLI_IO_REQUESTS {
            return Err(failure(
                "session_capacity",
                "File-selection request retention is full. Start a new session.",
            ));
        }
        let purpose = selection.purpose();
        let prepared = prepare_selection(&selection).and_then(|paths| {
            // Conservative path-payload charge, independent of native encoding.
            // Record/vector allocation overhead is separately bounded by counts.
            let retained_bytes = paths
                .iter()
                .map(|path| path.as_os_str().len() * 2)
                .sum::<usize>();
            if retained_bytes > MAX_CLI_RETAINED_PATH_BYTES.saturating_sub(self.retained_path_bytes)
            {
                return Err(failure(
                    "session_capacity",
                    "Retained file-selection paths exceed 1 MiB.",
                ));
            }
            Ok((paths, retained_bytes))
        });
        let (admission, state, retained_bytes) = match prepared {
            Ok((paths, count)) => {
                let grant = CliIoGrantReceipt {
                    grant_id: Uuid::new_v4(),
                    purpose,
                };
                (Ok(grant), GrantState::Available(paths), count)
            }
            Err(error) => (Err(error), GrantState::Revoked, 0),
        };
        self.retained_path_bytes += retained_bytes;
        self.records.insert(
            binding.request_id,
            GrantRecord {
                binding,
                selection_sha256,
                admission: admission.clone(),
                retained_bytes,
                state,
            },
        );
        admission
    }

    fn take(
        &mut self,
        binding: &CliIoRequestBinding,
        grant_id: Uuid,
        purpose: CliIoPurpose,
    ) -> ResearchResult<Vec<PathBuf>> {
        self.check_session(binding)?;
        let record = self.records.get_mut(&binding.request_id).ok_or_else(|| {
            failure(
                "unknown_grant",
                "No selection grant exists for this request.",
            )
        })?;
        if record.binding != *binding {
            return Err(failure(
                "request_id_reused",
                "The file-selection request no longer matches.",
            ));
        }
        let receipt = record.admission.as_ref().map_err(Clone::clone)?;
        if receipt.grant_id != grant_id || receipt.purpose != purpose {
            return Err(failure(
                "grant_mismatch",
                "The selection grant or its purpose does not match this request.",
            ));
        }
        match &record.state {
            GrantState::Consumed => {
                return Err(failure(
                    "grant_consumed",
                    "This request already claimed its selection. Reconcile its retained result.",
                ))
            }
            GrantState::Revoked => {
                return Err(failure(
                    "grant_revoked",
                    "This request's file selection was revoked.",
                ))
            }
            GrantState::Available(_) => {}
        }
        let GrantState::Available(paths) =
            std::mem::replace(&mut record.state, GrantState::Consumed)
        else {
            unreachable!()
        };
        self.retained_path_bytes -= record.retained_bytes;
        record.retained_bytes = 0;
        // Consume BEFORE revalidation or read: a failure is not permission to
        // repeat a native effect on the same grant. The broker retains outcomes.
        validate_current_paths(&paths, purpose)?;
        Ok(paths)
    }

    pub(crate) fn claim(
        &mut self,
        binding: &CliIoRequestBinding,
        grant_id: Uuid,
        purpose: CliIoPurpose,
    ) -> ResearchResult<CliIoTarget> {
        if purpose == CliIoPurpose::ImportQuestionnaire {
            return Err(failure(
                "grant_mismatch",
                "Questionnaire grants return bounded source bytes, not a path.",
            ));
        }
        let mut paths = self.take(binding, grant_id, purpose)?;
        if purpose == CliIoPurpose::ImportVideos {
            return Ok(CliIoTarget::ImportVideos { paths });
        }
        let path = paths.remove(0);
        Ok(match purpose {
            CliIoPurpose::SelectWorkspace => CliIoTarget::SelectWorkspace { directory: path },
            CliIoPurpose::ImportVideoFolder => CliIoTarget::ImportVideoFolder { directory: path },
            CliIoPurpose::SaveRecipe => CliIoTarget::SaveRecipe { directory: path },
            CliIoPurpose::OpenRecipe => CliIoTarget::OpenRecipe { path },
            CliIoPurpose::ImportVideos | CliIoPurpose::ImportQuestionnaire => unreachable!(),
        })
    }

    pub(crate) fn claim_questionnaire_source(
        &mut self,
        binding: &CliIoRequestBinding,
        grant_id: Uuid,
    ) -> ResearchResult<CliQuestionnaireSource> {
        let paths = self.take(binding, grant_id, CliIoPurpose::ImportQuestionnaire)?;
        let (logical_name, format) = questionnaire_name(&paths[0])?;
        let bytes = read_questionnaire_bytes(&paths[0])?;
        Ok(CliQuestionnaireSource {
            grant_id,
            logical_name,
            format,
            byte_length: bytes.len(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes_hex: hex_bytes(&bytes),
        })
    }

    /// Revokes an already issued request. Cancellation before issue remains the
    /// broker's admission gate; it must never issue a canceled queued command.
    pub(crate) fn revoke_request(&mut self, request_id: Uuid) -> bool {
        let Some(record) = self.records.get_mut(&request_id) else {
            return false;
        };
        self.retained_path_bytes -= record.retained_bytes;
        record.retained_bytes = 0;
        record.state = GrantState::Revoked;
        true
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.records.clear();
        self.retained_path_bytes = 0;
    }
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        metadata.file_type().is_symlink()
    }
}

fn input_path(source: &str) -> ResearchResult<PathBuf> {
    if source.is_empty()
        || source.len() > MAX_CLI_PATH_BYTES
        || source.chars().any(char::is_control)
    {
        return Err(failure(
            "invalid_selection",
            "Paths require 1–4096 UTF-8 bytes without control characters.",
        ));
    }
    let path = Path::new(source);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(failure(
            "invalid_selection",
            "Select an absolute ordinary path without dot/parent components.",
        ));
    }
    #[cfg(target_os = "windows")]
    {
        use std::path::Prefix;
        if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_)))
        {
            return Err(failure(
                "invalid_selection",
                "Select a local drive path; device, verbatim and network paths are unsupported.",
            ));
        }
        for component in source[2..]
            .split(['/', '\\'])
            .filter(|part| !part.is_empty())
        {
            let stem = component.split('.').next().unwrap_or("").to_uppercase();
            let reserved = matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            ) || ["COM", "LPT"].iter().any(|prefix| {
                stem.strip_prefix(prefix).is_some_and(|tail| {
                    matches!(
                        tail,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            });
            if component.contains([':', '*', '?', '"', '<', '>', '|'])
                || component.ends_with(['.', ' '])
                || component == "."
                || component == ".."
                || reserved
            {
                return Err(failure("invalid_selection", "Path components must be ordinary names without device aliases or alternate streams."));
            }
        }
    }
    Ok(path.to_path_buf())
}

// Same explicit namespace boundary as the existing S7 file service: inspect
// each ancestor, but do not claim adversarial handle-pinned directory traversal.
fn require_unlinked_path(path: &Path) -> ResearchResult<Metadata> {
    let metadata = fs::symlink_metadata(path).map_err(CommandError::io)?;
    for ancestor in path.ancestors().filter(|path| !path.as_os_str().is_empty()) {
        if is_link(&fs::symlink_metadata(ancestor).map_err(CommandError::io)?) {
            return Err(failure(
                "invalid_selection",
                "Selected files/folders and their ancestors must not be links or reparse points.",
            ));
        }
    }
    Ok(metadata)
}

fn is_directory(purpose: CliIoPurpose) -> bool {
    matches!(
        purpose,
        CliIoPurpose::SelectWorkspace | CliIoPurpose::ImportVideoFolder | CliIoPurpose::SaveRecipe
    )
}

fn validate_current_paths(paths: &[PathBuf], purpose: CliIoPurpose) -> ResearchResult<()> {
    for path in paths {
        let metadata = require_unlinked_path(path)?;
        if if is_directory(purpose) {
            !metadata.is_dir()
        } else {
            !metadata.is_file()
        } {
            return Err(failure(
                "invalid_selection",
                "The selected path has the wrong file or directory type.",
            ));
        }
        if purpose == CliIoPurpose::ImportQuestionnaire {
            questionnaire_name(path)?;
            if metadata.len() == 0 || metadata.len() > MAX_CLI_QUESTIONNAIRE_BYTES as u64 {
                return Err(failure(
                    "invalid_selection",
                    "Questionnaire sources require 1 byte–4 MiB.",
                ));
            }
        }
    }
    Ok(())
}

fn prepare_selection(selection: &CliIoSelection) -> ResearchResult<Vec<PathBuf>> {
    let source_paths = selection.paths();
    if source_paths.is_empty() || source_paths.len() > MAX_CLI_VIDEO_PATHS {
        return Err(failure(
            "invalid_selection",
            "Select 1–256 video paths, or exactly one path for another purpose.",
        ));
    }
    let mut paths = Vec::with_capacity(source_paths.len());
    let mut seen = HashSet::new();
    for source in source_paths {
        let input = input_path(source)?;
        validate_current_paths(std::slice::from_ref(&input), selection.purpose())?;
        let path = fs::canonicalize(&input).map_err(CommandError::io)?;
        validate_current_paths(std::slice::from_ref(&path), selection.purpose())?;
        if !seen.insert(path.clone()) {
            return Err(failure(
                "invalid_selection",
                "A file selection contains a repeated path.",
            ));
        }
        paths.push(path);
    }
    Ok(paths)
}

fn questionnaire_name(path: &Path) -> ResearchResult<(String, CliQuestionnaireFormat)> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            failure(
                "invalid_selection",
                "Questionnaire source requires a Unicode basename.",
            )
        })?;
    if name.is_empty()
        || name.len() > MAX_CLI_LOGICAL_NAME_BYTES
        || name.chars().any(char::is_control)
    {
        return Err(failure(
            "invalid_selection",
            "Questionnaire basename exceeds its supported bounds.",
        ));
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = match extension.as_str() {
        "csv" => CliQuestionnaireFormat::Csv,
        "txt" => CliQuestionnaireFormat::Txt,
        "json" => CliQuestionnaireFormat::Json,
        _ => {
            return Err(failure(
                "unsupported_source",
                "Import a questionnaire CSV, TXT or JSON source.",
            ))
        }
    };
    Ok((name.to_owned(), format))
}

fn read_questionnaire_bytes(path: &Path) -> ResearchResult<Vec<u8>> {
    validate_current_paths(&[path.to_path_buf()], CliIoPurpose::ImportQuestionnaire)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Safe std extension; open the final object without following a reparse
        // replacement, and deny simultaneous write/delete sharing while reading.
        options.custom_flags(0x0020_0000).share_mode(0x0000_0001);
    }
    let mut file = options.open(path).map_err(CommandError::io)?;
    let before = file.metadata().map_err(CommandError::io)?;
    if is_link(&before)
        || !before.is_file()
        || before.len() == 0
        || before.len() > MAX_CLI_QUESTIONNAIRE_BYTES as u64
    {
        return Err(failure(
            "invalid_selection",
            "Questionnaire source must remain an ordinary 1 byte–4 MiB file.",
        ));
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&mut file)
        .take((MAX_CLI_QUESTIONNAIRE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    let after = file.metadata().map_err(CommandError::io)?;
    if bytes.len() as u64 != before.len()
        || after.len() != before.len()
        || after.modified().ok() != before.modified().ok()
    {
        return Err(failure(
            "source_changed",
            "The questionnaire source changed during its bounded read.",
        ));
    }
    validate_current_paths(&[path.to_path_buf()], CliIoPurpose::ImportQuestionnaire)?;
    Ok(bytes)
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 15) as usize] as char);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory {
        path: PathBuf,
        parent: PathBuf,
    }
    impl TestDirectory {
        fn new() -> Self {
            let parent = std::env::temp_dir().canonicalize().unwrap();
            let path = parent.join(format!("affect-planner-cli-io-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self { path, parent }
        }
        fn file(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.path.join(name);
            fs::write(&path, bytes).unwrap();
            external(&path)
        }
        fn folder(&self, name: &str) -> String {
            let path = self.path.join(name);
            fs::create_dir(&path).unwrap();
            external(&path)
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            // Only the exact newly created, absolute fixture child is removed.
            if self.path.is_absolute()
                && self.path.parent() == Some(self.parent.as_path())
                && self
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("affect-planner-cli-io-")
            {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }
    fn external(path: &Path) -> String {
        let value = path.to_str().unwrap();
        #[cfg(target_os = "windows")]
        let value = value.strip_prefix("\\\\?\\").unwrap_or(value);
        value.to_owned()
    }
    fn binding(session_id: Uuid) -> CliIoRequestBinding {
        CliIoRequestBinding {
            session_id,
            request_id: Uuid::new_v4(),
            request_sha256: [7; 32],
        }
    }
    fn code<T>(result: ResearchResult<T>) -> String {
        result.err().expect("Expected failure").code
    }
    fn store() -> (PlannerCliIoGrants, CliIoRequestBinding) {
        let id = Uuid::new_v4();
        (PlannerCliIoGrants::new(id), binding(id))
    }

    #[test]
    fn each_purpose_returns_only_an_opaque_receipt_and_the_correct_native_target() {
        let temp = TestDirectory::new();
        let directory = temp.folder("workspace");
        let video = temp.file("clip.mp4", b"not decode evidence");
        let recipe = temp.file("recipe.json", b"{}");
        let (mut grants, request) = store();
        for purpose in [
            CliIoPurpose::SelectWorkspace,
            CliIoPurpose::ImportVideos,
            CliIoPurpose::ImportVideoFolder,
            CliIoPurpose::SaveRecipe,
            CliIoPurpose::OpenRecipe,
        ] {
            let selection = match purpose {
                CliIoPurpose::SelectWorkspace => CliIoSelection::SelectWorkspace {
                    directory: directory.clone(),
                },
                CliIoPurpose::ImportVideos => CliIoSelection::ImportVideos {
                    paths: vec![video.clone()],
                },
                CliIoPurpose::ImportVideoFolder => CliIoSelection::ImportVideoFolder {
                    directory: directory.clone(),
                },
                CliIoPurpose::SaveRecipe => CliIoSelection::SaveRecipe {
                    directory: directory.clone(),
                },
                CliIoPurpose::OpenRecipe => CliIoSelection::OpenRecipe {
                    path: recipe.clone(),
                },
                _ => unreachable!(),
            };
            let request = binding(request.session_id);
            let receipt = grants.issue(request, selection).unwrap();
            assert_eq!(receipt.purpose, purpose);
            let public = serde_json::to_value(&receipt).unwrap();
            assert_eq!(public.as_object().unwrap().len(), 2);
            assert!(public.get("grantId").is_some());
            assert!(!public.to_string().contains(&directory));
            assert!(!public.to_string().contains("clip.mp4"));
            let path = match grants
                .claim(&request, receipt.grant_id, purpose)
                .ok()
                .unwrap()
            {
                CliIoTarget::SelectWorkspace { directory }
                | CliIoTarget::ImportVideoFolder { directory }
                | CliIoTarget::SaveRecipe { directory } => directory,
                CliIoTarget::ImportVideos { paths } => {
                    assert_eq!(paths.len(), 1);
                    paths[0].clone()
                }
                CliIoTarget::OpenRecipe { path } => path,
            };
            assert!(path.is_absolute());
            assert!(path.exists());
            assert_eq!(
                code(grants.claim(&request, receipt.grant_id, purpose)),
                "grant_consumed"
            );
        }
        assert_eq!(
            fs::read_dir(Path::new(&directory)).unwrap().count(),
            0,
            "Helper does not create workspace layout or output files"
        );
        assert_eq!(fs::read(&video).unwrap(), b"not decode evidence");
    }

    #[test]
    fn exact_byte_reads_preserve_bom_unicode_invalid_utf8_and_declared_formats_without_compiling() {
        let temp = TestDirectory::new();
        let (mut grants, request) = store();
        for (name, bytes, format) in [
            (
                "Fragebogen.CSV",
                b"\xef\xbb\xbfitem,option\r\n\xc3\xa4,1\r\n".as_slice(),
                CliQuestionnaireFormat::Csv,
            ),
            (
                "source.txt",
                b"raw\x00\xffnot compiled".as_slice(),
                CliQuestionnaireFormat::Txt,
            ),
            (
                "source.json",
                b"{not valid JSON".as_slice(),
                CliQuestionnaireFormat::Json,
            ),
        ] {
            let path = temp.file(name, bytes);
            let request = binding(request.session_id);
            let receipt = grants
                .issue(
                    request,
                    CliIoSelection::ImportQuestionnaire { path: path.clone() },
                )
                .unwrap();
            assert_eq!(
                code(grants.claim(
                    &request,
                    receipt.grant_id,
                    CliIoPurpose::ImportQuestionnaire
                )),
                "grant_mismatch"
            );
            let source = grants
                .claim_questionnaire_source(&request, receipt.grant_id)
                .unwrap();
            assert_eq!(source.logical_name, name);
            assert_eq!(source.format, format);
            assert_eq!(source.byte_length, bytes.len());
            assert_eq!(source.sha256, format!("{:x}", Sha256::digest(bytes)));
            assert_eq!(source.bytes_hex, hex_bytes(bytes));
            assert_eq!(source.grant_id, receipt.grant_id);
            let public = serde_json::to_value(&source).unwrap();
            assert_eq!(public.as_object().unwrap().len(), 6);
            assert!(!public.to_string().contains(&external(&temp.path)));
            assert_eq!(
                code(grants.claim_questionnaire_source(&request, receipt.grant_id)),
                "grant_consumed"
            );
            assert_eq!(fs::read(path).unwrap(), bytes);
        }
    }

    #[test]
    fn repeated_requests_retain_the_grant_without_rereading_and_changed_reuse_rejects() {
        let temp = TestDirectory::new();
        let path = temp.file("video.mp4", b"source");
        let (mut grants, request) = store();
        let first = grants
            .issue(
                request,
                CliIoSelection::ImportVideos {
                    paths: vec![path.clone()],
                },
            )
            .unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(
            grants
                .issue(
                    request,
                    CliIoSelection::ImportVideos {
                        paths: vec![path.clone()]
                    }
                )
                .unwrap(),
            first
        );
        assert_eq!(
            code(grants.issue(
                CliIoRequestBinding {
                    request_sha256: [8; 32],
                    ..request
                },
                CliIoSelection::ImportVideos {
                    paths: vec![path.clone()]
                }
            )),
            "request_id_reused"
        );
        assert_eq!(
            code(grants.issue(request, CliIoSelection::OpenRecipe { path: path.clone() })),
            "request_id_reused"
        );
        assert_eq!(
            code(grants.issue(
                request,
                CliIoSelection::ImportVideos {
                    paths: vec![temp.file("other.mp4", b"other")]
                }
            )),
            "request_id_reused"
        );
        assert_eq!(
            code(grants.claim(&request, first.grant_id, first.purpose)),
            "research_io"
        );
        fs::write(&path, b"recreated").unwrap();
        assert_eq!(
            code(grants.claim(&request, first.grant_id, first.purpose)),
            "grant_consumed"
        );
        assert_eq!(
            grants
                .issue(request, CliIoSelection::ImportVideos { paths: vec![path] })
                .unwrap(),
            first
        );
    }

    #[test]
    fn errors_are_retained_without_revalidation_and_request_identity_is_not_evicted() {
        let temp = TestDirectory::new();
        let path = external(&temp.path.join("later.csv"));
        let (mut grants, request) = store();
        let error = grants
            .issue(
                request,
                CliIoSelection::ImportQuestionnaire { path: path.clone() },
            )
            .unwrap_err();
        fs::write(&path, b"later file").unwrap();
        assert_eq!(
            grants
                .issue(
                    request,
                    CliIoSelection::ImportQuestionnaire { path: path.clone() }
                )
                .unwrap_err(),
            error
        );
        assert_eq!(
            code(grants.issue(request, CliIoSelection::OpenRecipe { path })),
            "request_id_reused"
        );
        assert_eq!(grants.records.len(), 1);
    }

    #[test]
    fn session_request_fingerprint_grant_and_purpose_are_all_required_before_consumption() {
        let temp = TestDirectory::new();
        let directory = temp.folder("out");
        let (mut grants, request) = store();
        let receipt = grants
            .issue(request, CliIoSelection::SaveRecipe { directory })
            .unwrap();
        assert_eq!(
            code(grants.claim(
                &CliIoRequestBinding {
                    session_id: Uuid::new_v4(),
                    ..request
                },
                receipt.grant_id,
                receipt.purpose
            )),
            "stale_session"
        );
        assert_eq!(
            code(grants.claim(
                &binding(request.session_id),
                receipt.grant_id,
                receipt.purpose
            )),
            "unknown_grant"
        );
        assert_eq!(
            code(grants.claim(
                &CliIoRequestBinding {
                    request_sha256: [8; 32],
                    ..request
                },
                receipt.grant_id,
                receipt.purpose
            )),
            "request_id_reused"
        );
        assert_eq!(
            code(grants.claim(&request, Uuid::new_v4(), receipt.purpose)),
            "grant_mismatch"
        );
        assert_eq!(
            code(grants.claim(&request, receipt.grant_id, CliIoPurpose::SelectWorkspace)),
            "grant_mismatch"
        );
        assert!(grants
            .claim(&request, receipt.grant_id, receipt.purpose)
            .is_ok());
    }

    #[test]
    fn cancellation_and_close_revoke_all_paths_without_reopening_or_reapplying() {
        let temp = TestDirectory::new();
        let directory = temp.folder("out");
        let (mut grants, request) = store();
        let receipt = grants
            .issue(
                request,
                CliIoSelection::SaveRecipe {
                    directory: directory.clone(),
                },
            )
            .unwrap();
        assert!(grants.retained_path_bytes > 0);
        assert!(grants.revoke_request(request.request_id));
        assert_eq!(grants.retained_path_bytes, 0);
        assert_eq!(
            code(grants.claim(&request, receipt.grant_id, receipt.purpose)),
            "grant_revoked"
        );
        assert_eq!(
            grants
                .issue(
                    request,
                    CliIoSelection::SaveRecipe {
                        directory: directory.clone()
                    }
                )
                .unwrap(),
            receipt
        );
        grants.close();
        assert!(grants.records.is_empty());
        assert_eq!(
            code(grants.issue(request, CliIoSelection::SaveRecipe { directory })),
            "session_closed"
        );
        assert_eq!(
            code(grants.claim(&request, receipt.grant_id, receipt.purpose)),
            "session_closed"
        );
    }

    #[test]
    fn request_retention_capacity_never_evicts_an_earlier_identity() {
        let temp = TestDirectory::new();
        let directory = temp.folder("out");
        let (mut grants, initial) = store();
        let first = grants
            .issue(
                initial,
                CliIoSelection::SaveRecipe {
                    directory: directory.clone(),
                },
            )
            .unwrap();
        grants
            .claim(&initial, first.grant_id, first.purpose)
            .ok()
            .unwrap();
        for _ in 1..MAX_CLI_IO_REQUESTS {
            let request = binding(initial.session_id);
            grants
                .issue(
                    request,
                    CliIoSelection::SaveRecipe {
                        directory: directory.clone(),
                    },
                )
                .unwrap();
            grants.revoke_request(request.request_id);
        }
        assert_eq!(
            code(grants.issue(
                binding(initial.session_id),
                CliIoSelection::SaveRecipe {
                    directory: directory.clone()
                }
            )),
            "session_capacity"
        );
        assert_eq!(grants.records.len(), MAX_CLI_IO_REQUESTS);
        assert_eq!(
            grants
                .issue(initial, CliIoSelection::SaveRecipe { directory })
                .unwrap(),
            first
        );
        assert_eq!(
            code(grants.claim(&initial, first.grant_id, first.purpose)),
            "grant_consumed"
        );
    }

    #[test]
    fn selection_count_length_duplicates_and_file_kind_are_bounded() {
        let temp = TestDirectory::new();
        let directory = temp.folder("dir");
        let file = temp.file("clip.mp4", b"x");
        let (mut grants, request) = store();
        let cases = [
            CliIoSelection::ImportVideos { paths: vec![] },
            CliIoSelection::ImportVideos {
                paths: vec![file.clone(); MAX_CLI_VIDEO_PATHS + 1],
            },
            CliIoSelection::ImportVideos {
                paths: vec![file.clone(), file.clone()],
            },
            CliIoSelection::SaveRecipe {
                directory: file.clone(),
            },
            CliIoSelection::OpenRecipe { path: directory },
            CliIoSelection::ImportVideos {
                paths: vec!["x".repeat(MAX_CLI_PATH_BYTES + 1)],
            },
            CliIoSelection::OpenRecipe {
                path: "relative.json".into(),
            },
            CliIoSelection::OpenRecipe { path: "\0".into() },
        ];
        for selection in cases {
            assert_eq!(
                code(grants.issue(binding(request.session_id), selection)),
                "invalid_selection"
            );
        }
        assert_eq!(grants.retained_path_bytes, 0);
        let paths = (0..MAX_CLI_VIDEO_PATHS)
            .map(|i| temp.file(&format!("v{i}.mp4"), b"x"))
            .collect::<Vec<_>>();
        let receipt = grants
            .issue(
                request,
                CliIoSelection::ImportVideos {
                    paths: paths.clone(),
                },
            )
            .unwrap();
        let CliIoTarget::ImportVideos { paths: observed } = grants
            .claim(&request, receipt.grant_id, receipt.purpose)
            .ok()
            .unwrap()
        else {
            panic!("wrong target")
        };
        assert_eq!(
            observed,
            paths
                .iter()
                .map(|path| Path::new(path).canonicalize().unwrap())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn retained_path_budget_is_bounded_and_capacity_rejections_remain_retained() {
        let temp = TestDirectory::new();
        let directory = temp.folder("out");
        let (mut grants, request) = store();
        // Deterministically exercise the accounting edge without platform path-length dependence.
        grants.retained_path_bytes = MAX_CLI_RETAINED_PATH_BYTES;
        let error = grants
            .issue(
                request,
                CliIoSelection::SaveRecipe {
                    directory: directory.clone(),
                },
            )
            .unwrap_err();
        assert_eq!(error.code, "session_capacity");
        grants.retained_path_bytes = 0;
        assert_eq!(
            grants
                .issue(request, CliIoSelection::SaveRecipe { directory })
                .unwrap_err(),
            error
        );
    }

    #[test]
    fn questionnaire_byte_limit_and_extensions_apply_at_issue_and_claim() {
        let temp = TestDirectory::new();
        let (mut grants, initial) = store();
        for (name, size) in [
            ("empty.csv", 0),
            ("large.json", MAX_CLI_QUESTIONNAIRE_BYTES + 1),
            ("wrong.pdf", 1),
        ] {
            let path = temp.file(name, &vec![b'x'; size]);
            let request = binding(initial.session_id);
            assert!(grants
                .issue(request, CliIoSelection::ImportQuestionnaire { path })
                .is_err());
        }
        let path = temp.file("limit.txt", &vec![0xff; MAX_CLI_QUESTIONNAIRE_BYTES]);
        let receipt = grants
            .issue(initial, CliIoSelection::ImportQuestionnaire { path })
            .unwrap();
        let source = grants
            .claim_questionnaire_source(&initial, receipt.grant_id)
            .unwrap();
        assert_eq!(source.byte_length, MAX_CLI_QUESTIONNAIRE_BYTES);
        assert_eq!(source.bytes_hex.len(), MAX_CLI_QUESTIONNAIRE_BYTES * 2);
        assert!(serde_json::to_vec(&source).unwrap().len() < 16 * 1024 * 1024);
        let path = temp.file("changed.csv", b"x");
        let request = binding(initial.session_id);
        let receipt = grants
            .issue(
                request,
                CliIoSelection::ImportQuestionnaire { path: path.clone() },
            )
            .unwrap();
        fs::write(path, []).unwrap();
        assert_eq!(
            code(grants.claim_questionnaire_source(&request, receipt.grant_id)),
            "invalid_selection"
        );
        assert_eq!(
            code(grants.claim_questionnaire_source(&request, receipt.grant_id)),
            "grant_consumed"
        );
    }

    #[test]
    fn errors_never_include_private_paths() {
        let (mut grants, request) = store();
        let error = grants
            .issue(
                request,
                CliIoSelection::OpenRecipe {
                    path: "C:\\private\\missing-recipe.json".into(),
                },
            )
            .unwrap_err();
        let encoded = serde_json::to_string(&error).unwrap();
        assert!(!encoded.contains("private"));
        assert!(!encoded.contains("missing-recipe"));
    }

    #[test]
    fn native_claim_rechecks_file_kind_and_cannot_retry_a_repaired_path() {
        let temp = TestDirectory::new();
        let (mut grants, initial) = store();
        for directory in [false, true] {
            let path = if directory {
                temp.folder("selected-directory")
            } else {
                temp.file("selected-file.json", b"{}")
            };
            let request = binding(initial.session_id);
            let selection = if directory {
                CliIoSelection::SaveRecipe {
                    directory: path.clone(),
                }
            } else {
                CliIoSelection::OpenRecipe { path: path.clone() }
            };
            let receipt = grants.issue(request, selection).unwrap();
            // Change only the newly created fixture entry, never an external selection.
            if directory {
                fs::remove_dir(&path).unwrap();
                fs::write(&path, b"replacement").unwrap();
            } else {
                fs::remove_file(&path).unwrap();
                fs::create_dir(&path).unwrap();
            }
            assert_eq!(
                code(grants.claim(&request, receipt.grant_id, receipt.purpose)),
                "invalid_selection"
            );
            if directory {
                fs::remove_file(&path).unwrap();
                fs::create_dir(&path).unwrap();
            } else {
                fs::remove_dir(&path).unwrap();
                fs::write(&path, b"{}").unwrap();
            }
            assert_eq!(
                code(grants.claim(&request, receipt.grant_id, receipt.purpose)),
                "grant_consumed"
            );
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn questionnaire_snapshots_at_claim_and_refuses_an_existing_writer() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = TestDirectory::new();
        let path = temp.file("source.csv", b"before");
        let (mut grants, request) = store();
        let receipt = grants
            .issue(
                request,
                CliIoSelection::ImportQuestionnaire { path: path.clone() },
            )
            .unwrap();
        fs::write(&path, b"at claim").unwrap();
        let source = grants
            .claim_questionnaire_source(&request, receipt.grant_id)
            .unwrap();
        assert_eq!(source.bytes_hex, hex_bytes(b"at claim"));
        assert_eq!(source.sha256, format!("{:x}", Sha256::digest(b"at claim")));

        let second = binding(request.session_id);
        let receipt = grants
            .issue(
                second,
                CliIoSelection::ImportQuestionnaire { path: path.clone() },
            )
            .unwrap();
        let writer = OpenOptions::new()
            .write(true)
            .share_mode(0x7)
            .open(&path)
            .unwrap();
        assert_eq!(
            code(grants.claim_questionnaire_source(&second, receipt.grant_id)),
            "research_io"
        );
        drop(writer);
        assert_eq!(
            code(grants.claim_questionnaire_source(&second, receipt.grant_id)),
            "grant_consumed"
        );
        assert_eq!(fs::read(path).unwrap(), b"at claim");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_path_aliases_devices_alternate_streams_and_network_prefixes_reject() {
        for path in [
            "C:relative",
            "\\root-relative",
            "\\\\server\\share\\file",
            "\\\\?\\C:\\file",
            "\\\\.\\C:\\file",
            "C:\\dir\\file:stream",
            "C:\\dir\\NUL.csv",
            "C:\\COM¹.txt",
            "C:\\dir.\\x",
            "C:\\dir \\x",
            "C:\\dir\\.\\x",
            "C:\\dir\\..\\x",
        ] {
            assert!(input_path(path).is_err(), "alias accepted: {path}");
        }
    }

    #[cfg(target_os = "windows")]
    fn junction(path: &Path, target: &Path) {
        use std::os::windows::process::CommandExt;
        let quote = |path: &Path| format!("'{}'", external(path).replace('\'', "''"));
        let script = format!(
            "New-Item -ItemType Junction -Path {} -Target {} -ErrorAction Stop | Out-Null",
            quote(path),
            quote(target)
        );
        let result = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x0800_0000)
            .output()
            .unwrap();
        assert!(result.status.success(), "fixture junction creation failed");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn junctions_and_replaced_ancestors_reject_before_questionnaire_read_or_native_dispatch() {
        let temp = TestDirectory::new();
        let original = temp.path.join("original");
        fs::create_dir(&original).unwrap();
        fs::write(original.join("source.csv"), b"original").unwrap();
        let linked = temp.path.join("linked");
        junction(&linked, &original);
        let (mut grants, request) = store();
        assert_eq!(
            code(grants.issue(
                binding(request.session_id),
                CliIoSelection::SelectWorkspace {
                    directory: external(&linked)
                }
            )),
            "invalid_selection"
        );
        assert_eq!(
            code(grants.issue(
                binding(request.session_id),
                CliIoSelection::ImportQuestionnaire {
                    path: external(&linked.join("source.csv"))
                }
            )),
            "invalid_selection"
        );
        let receipt = grants
            .issue(
                request,
                CliIoSelection::ImportQuestionnaire {
                    path: external(&original.join("source.csv")),
                },
            )
            .unwrap();
        let moved = temp.path.join("moved");
        fs::rename(&original, &moved).unwrap();
        junction(&original, &moved);
        assert_eq!(
            code(grants.claim_questionnaire_source(&request, receipt.grant_id)),
            "invalid_selection"
        );
        assert_eq!(
            code(grants.claim_questionnaire_source(&request, receipt.grant_id)),
            "grant_consumed"
        );
        assert_eq!(fs::read(moved.join("source.csv")).unwrap(), b"original");
    }
}

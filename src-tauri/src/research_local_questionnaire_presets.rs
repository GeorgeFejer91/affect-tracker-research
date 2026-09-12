//! Researcher-installed sources, never public bundled questionnaire content.
//! The host supplies its established app-data root, not a renderer path. Each
//! study receives its own copy through the existing workspace asset store.
use crate::research_error::{CommandError, ResearchResult};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, Metadata, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;
use uuid::Uuid;

const DIRECTORY: &str = "questionnaire-presets";
pub const GERMAN_TAS_PRESET_ID: &str = "tas-20-de-handrack-2016-local";
const TAS: Preset<'static> = Preset {
    id: GERMAN_TAS_PRESET_ID,
    sha256: "7b32c878cf83d2b0348498355402f1a8d1db5853aeffeaf2f74863ea701eef92",
    bytes: 124_978,
};

#[derive(Clone, Copy)]
struct Preset<'a> {
    id: &'a str,
    sha256: &'a str,
    bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalQuestionnairePresetReceipt {
    pub preset_id: String,
    pub family_id: &'static str,
    pub language_tag: &'static str,
    pub logical_name: &'static str,
    pub source_sha256: String,
    pub byte_length: u64,
    pub usage_scope: &'static str,
    pub public_reuse_verified: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalQuestionnairePresetSource {
    pub receipt: LocalQuestionnairePresetReceipt,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Identity {
    #[cfg(windows)]
    created: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(not(any(windows, unix)))]
    created: Option<SystemTime>,
}

fn identity(metadata: &Metadata) -> Identity {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Identity {
            created: metadata.creation_time(),
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Identity {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }
    #[cfg(not(any(windows, unix)))]
    {
        Identity {
            created: metadata.created().ok(),
        }
    }
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn forbidden() -> CommandError {
    CommandError::forbidden("The local questionnaire preset is unavailable, changed or not an ordinary verified source.")
}

fn metadata_if_present(path: &Path) -> ResearchResult<Option<Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CommandError::io(error)),
    }
}

fn directory(path: &Path) -> ResearchResult<Identity> {
    let metadata = fs::symlink_metadata(path).map_err(CommandError::io)?;
    if !metadata.is_dir()
        || is_link(&metadata)
        || path.canonicalize().map_err(CommandError::io)? != path
    {
        return Err(forbidden());
    }
    Ok(identity(&metadata))
}

fn create_child(parent: &Path, name: &str) -> ResearchResult<PathBuf> {
    let before = directory(parent)?;
    let child = parent.join(name);
    match fs::create_dir(&child) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(CommandError::io(error)),
    }
    directory(&child)?;
    if directory(parent)? != before {
        return Err(forbidden());
    }
    Ok(child)
}

#[derive(PartialEq, Eq)]
struct FileStamp {
    identity: Identity,
    bytes: u64,
    modified: SystemTime,
}

fn file_stamp(metadata: &Metadata) -> ResearchResult<FileStamp> {
    if !metadata.is_file() || is_link(metadata) {
        return Err(forbidden());
    }
    Ok(FileStamp {
        identity: identity(metadata),
        bytes: metadata.len(),
        modified: metadata.modified().map_err(CommandError::io)?,
    })
}

fn preset(id: &str) -> ResearchResult<Preset<'static>> {
    if id == TAS.id {
        Ok(TAS)
    } else {
        Err(CommandError::invalid_contract(
            "Unknown researcher-local questionnaire preset.",
        ))
    }
}

fn receipt(spec: Preset<'_>) -> LocalQuestionnairePresetReceipt {
    LocalQuestionnairePresetReceipt {
        preset_id: spec.id.to_owned(),
        family_id: "tas-20",
        language_tag: "de",
        logical_name: "tas-20-de-handrack-2016-local.csv",
        source_sha256: spec.sha256.to_owned(),
        byte_length: spec.bytes,
        usage_scope: "researcherLocal",
        public_reuse_verified: false,
    }
}

fn validate_bytes(bytes: &[u8], spec: Preset<'_>) -> ResearchResult<()> {
    if bytes.len() as u64 != spec.bytes || format!("{:x}", Sha256::digest(bytes)) != spec.sha256 {
        return Err(CommandError::invalid_contract(
            "Local questionnaire bytes do not match the fixed source size and hash.",
        ));
    }
    Ok(())
}

/// Hash and return the same bounded snapshot. Pre/post ordinary-path and metadata
/// checks reject replacement; Windows denies shared writes/deletes while open.
fn read_exact(
    path: &Path,
    spec: Preset<'_>,
    before_open: impl FnOnce(),
) -> ResearchResult<Vec<u8>> {
    let before = file_stamp(&fs::symlink_metadata(path).map_err(CommandError::io)?)?;
    if before.bytes != spec.bytes || path.canonicalize().map_err(CommandError::io)? != path {
        return Err(forbidden());
    }
    before_open();
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ, FILE_FLAG_OPEN_REPARSE_POINT. Safe std APIs only.
        options.share_mode(1).custom_flags(0x0020_0000);
    }
    let file = options.open(path).map_err(CommandError::io)?;
    if file_stamp(&file.metadata().map_err(CommandError::io)?)? != before {
        return Err(forbidden());
    }
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(spec.bytes as usize + 1)
        .map_err(|_| forbidden())?;
    (&file)
        .take(spec.bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    validate_bytes(&bytes, spec)?;
    if file_stamp(&file.metadata().map_err(CommandError::io)?)? != before
        || file_stamp(&fs::symlink_metadata(path).map_err(CommandError::io)?)? != before
        || path.canonicalize().map_err(CommandError::io)? != path
    {
        return Err(forbidden());
    }
    Ok(bytes)
}

struct StagedPreset {
    path: PathBuf,
    parent_identity: Identity,
}
impl Drop for StagedPreset {
    fn drop(&mut self) {
        if self
            .path
            .parent()
            .is_some_and(|parent| directory(parent).ok().as_ref() == Some(&self.parent_identity))
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub struct LocalQuestionnairePresetStore {
    root: PathBuf,
    identity: Identity,
    operation: Mutex<()>,
}
impl LocalQuestionnairePresetStore {
    /// The host creates and selects its established app-data root. OS-managed
    /// redirection is resolved once here; every child thereafter must be exact.
    pub fn new(app_data_root: PathBuf) -> ResearchResult<Self> {
        let base = app_data_root.canonicalize().map_err(CommandError::io)?;
        directory(&base)?;
        let root = create_child(&base, DIRECTORY)?;
        let identity = directory(&root)?;
        Ok(Self {
            root,
            identity,
            operation: Mutex::new(()),
        })
    }
    fn check_root(&self) -> ResearchResult<()> {
        if directory(&self.root)? != self.identity {
            return Err(forbidden());
        }
        Ok(())
    }
    fn read_spec(
        &self,
        spec: Preset<'_>,
    ) -> ResearchResult<Option<LocalQuestionnairePresetSource>> {
        self.check_root()?;
        let folder = self.root.join(spec.id);
        if metadata_if_present(&folder)?.is_none() {
            self.check_root()?;
            return Ok(None);
        }
        let folder_identity = directory(&folder)?;
        let path = folder.join(format!("{}.csv", spec.sha256));
        if metadata_if_present(&path)?.is_none() {
            self.check_root()?;
            if directory(&folder)? != folder_identity {
                return Err(forbidden());
            }
            return Ok(None);
        }
        let bytes = read_exact(&path, spec, || {})?;
        self.check_root()?;
        if directory(&folder)? != folder_identity {
            return Err(forbidden());
        }
        Ok(Some(LocalQuestionnairePresetSource {
            receipt: receipt(spec),
            bytes,
        }))
    }
    pub fn read(&self, preset_id: &str) -> ResearchResult<Option<LocalQuestionnairePresetSource>> {
        let spec = preset(preset_id)?;
        let _guard = self.operation.lock().map_err(|_| forbidden())?;
        self.read_spec(spec)
    }
    fn install_spec(
        &self,
        spec: Preset<'_>,
        bytes: &[u8],
    ) -> ResearchResult<LocalQuestionnairePresetReceipt> {
        validate_bytes(bytes, spec)?;
        self.check_root()?;
        if let Some(existing) = self.read_spec(spec)? {
            return Ok(existing.receipt);
        }
        let folder = create_child(&self.root, spec.id)?;
        let folder_identity = directory(&folder)?;
        let path = folder.join(format!("{}.csv", spec.sha256));
        let staging_path = folder.join(format!(".preset-{}.staging", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging_path)
            .map_err(CommandError::io)?;
        let staged = StagedPreset {
            path: staging_path,
            parent_identity: folder_identity.clone(),
        };
        file.write_all(bytes).map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)?;
        drop(file);
        read_exact(&staged.path, spec, || {})?;
        self.check_root()?;
        if directory(&folder)? != folder_identity {
            return Err(forbidden());
        }
        // Atomic no-clobber publication, matching the approved S7 pattern. No
        // rename/replace fallback on filesystems without hard-link support.
        match fs::hard_link(&staged.path, &path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(CommandError::io(error)),
        }
        let installed = self.read_spec(spec)?.ok_or_else(forbidden)?;
        Ok(installed.receipt)
    }
    pub fn install(
        &self,
        preset_id: &str,
        bytes: &[u8],
    ) -> ResearchResult<LocalQuestionnairePresetReceipt> {
        let spec = preset(preset_id)?;
        let _guard = self.operation.lock().map_err(|_| forbidden())?;
        self.install_spec(spec, bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("affect-local-preset-test-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root.canonicalize().unwrap())
        }
        fn store(&self) -> LocalQuestionnairePresetStore {
            LocalQuestionnairePresetStore::new(self.0.clone()).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn synthetic_spec(hash: &str, count: usize) -> Preset<'_> {
        Preset {
            sha256: hash,
            bytes: count as u64,
            ..TAS
        }
    }

    #[test]
    fn missing_and_unknown_presets_are_distinct_and_read_creates_no_asset() {
        let fixture = Fixture::new();
        let store = fixture.store();
        assert!(store.read(TAS.id).unwrap().is_none());
        assert!(store.read("../other").is_err());
        assert!(store.install("unknown", b"anything").is_err());
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 0);
    }
    #[test]
    fn installation_is_atomic_no_clobber_and_reusable_across_service_instances() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let second = fixture.store();
        let bytes = b"Synthetic test source, not TAS item text";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let spec = synthetic_spec(&hash, bytes.len());
        let first = store.install_spec(spec, bytes).unwrap();
        assert_eq!(second.install_spec(spec, bytes).unwrap(), first);
        assert!(second.read_spec(spec).unwrap().unwrap().bytes == bytes);
        assert_eq!(fs::read_dir(store.root.join(spec.id)).unwrap().count(), 1);
        assert!(!first.public_reuse_verified);
        assert_eq!(first.usage_scope, "researcherLocal");
        let wire = serde_json::to_value(first).unwrap();
        assert_eq!(wire.as_object().unwrap().len(), 8);
        assert!(wire.get("path").is_none());
    }
    #[test]
    fn wrong_source_size_hash_corrupt_destination_and_missing_root_fail_closed() {
        let fixture = Fixture::new();
        let store = fixture.store();
        let bytes = b"synthetic";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let spec = synthetic_spec(&hash, bytes.len());
        assert!(store.install(TAS.id, bytes).is_err());
        store.install_spec(spec, bytes).unwrap();
        let path = store.root.join(spec.id).join(format!("{hash}.csv"));
        fs::write(&path, b"tampered!").unwrap();
        assert!(store.read_spec(spec).is_err());
        assert!(store.install_spec(spec, bytes).is_err());
        assert!(fs::read(&path).unwrap() == b"tampered!");
        fs::write(&path, b"longer corrupt source").unwrap();
        assert!(store.read_spec(spec).is_err());
        fs::rename(&store.root, fixture.0.join("moved")).unwrap();
        assert!(store.read(TAS.id).is_err());
    }
    #[test]
    fn change_after_metadata_check_is_rejected_without_returning_bytes() {
        let fixture = Fixture::new();
        let path = fixture.0.join("source.csv");
        let bytes = b"original";
        fs::write(&path, bytes).unwrap();
        let hash = format!("{:x}", Sha256::digest(bytes));
        assert!(read_exact(&path, synthetic_spec(&hash, bytes.len()), || {
            fs::write(&path, b"changed!").unwrap();
        })
        .is_err());
    }
    #[test]
    fn simultaneous_installers_publish_only_complete_identical_content() {
        let fixture = Fixture::new();
        let bytes = b"parallel synthetic source";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let spec = synthetic_spec(&hash, bytes.len());
        let first = fixture.store();
        let second = fixture.store();
        std::thread::scope(|scope| {
            let a = scope.spawn(|| first.install_spec(spec, bytes));
            let b = scope.spawn(|| second.install_spec(spec, bytes));
            assert_eq!(a.join().unwrap().unwrap(), b.join().unwrap().unwrap());
        });
        assert_eq!(fs::read_dir(first.root.join(spec.id)).unwrap().count(), 1);
    }
    #[cfg(windows)]
    #[test]
    fn directory_junction_cannot_redirect_preset_sources() {
        use std::os::windows::process::CommandExt;
        let fixture = Fixture::new();
        let store = fixture.store();
        let other = fixture.0.join("other");
        fs::create_dir(&other).unwrap();
        let link = store.root.join(TAS.id);
        let output = std::process::Command::new("cmd.exe")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&other)
            .creation_flags(0x0800_0000)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(store.read(TAS.id).is_err());
        fs::remove_dir(&link).unwrap();
    }
    #[test]
    #[ignore = "Requires explicitly supplied researcher-local CSV; never bundled in the repository"]
    fn verified_external_german_tas_source_installs_and_reads_exactly() {
        let path = std::env::var_os("AFFECT_LOCAL_TAS_SOURCE")
            .expect("Set AFFECT_LOCAL_TAS_SOURCE explicitly");
        let bytes = fs::read(path).unwrap();
        let fixture = Fixture::new();
        let store = fixture.store();
        let installed = store.install(TAS.id, &bytes).unwrap();
        assert_eq!(installed.source_sha256, TAS.sha256);
        assert_eq!(installed.byte_length, TAS.bytes);
        let loaded = fixture.store().read(TAS.id).unwrap().unwrap();
        assert!(loaded.bytes == bytes);
        assert_eq!(loaded.receipt, installed);
        println!(
            "local preset verified: {} bytes, source {}",
            installed.byte_length, installed.source_sha256
        );
    }
}

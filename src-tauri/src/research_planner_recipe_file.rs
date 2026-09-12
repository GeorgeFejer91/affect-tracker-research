//! Native Planner document files. Callers retain directory/path authority;
//! only basenames and exact content receipts may cross into the renderer.
//! The JS authoring compiler remains the only fresh recipe compiler.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe::{
    parse_planner_recipe_bytes, parse_planner_recipe_file, LoadedPlannerRecipe,
    SavedPlannerRecipeReceipt, MAX_BYTES,
};
use crate::research_planner_recipe_supported::{
    parse_supported_planner_recipe_bytes, LoadedSupportedPlannerRecipe,
};
use serde::Serialize;
use std::fs::{self, Metadata, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use time::{OffsetDateTime, UtcOffset};
use uuid::Uuid;

const MAX_NAME_ATTEMPTS: usize = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedPlannerRecipeFile {
    pub basename: String,
    pub receipt: SavedPlannerRecipeReceipt,
}

/// Native CLI callers preserve this distinction. A published file must not be
/// blindly retried as though the operation had rejected before writing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannerRecipeWriteError {
    pub error: CommandError,
    pub published_basename: Option<String>,
}

impl From<CommandError> for PlannerRecipeWriteError {
    fn from(error: CommandError) -> Self {
        Self {
            error,
            published_basename: None,
        }
    }
}

impl PlannerRecipeWriteError {
    /// Preserve the established GUI error envelope without exposing a path.
    pub(crate) fn into_command_error(self) -> CommandError {
        match self.published_basename {
            Some(basename) => CommandError::new("recipe_file_written_unverified", format!(
                "The new recipe file {basename:?} was written, but final verification failed. It has not been marked saved. Inspect that file before retrying."
            )),
            None => self.error,
        }
    }
}

pub(crate) fn planner_recipe_filename(
    recipe_id: &str,
    now: OffsetDateTime,
) -> ResearchResult<String> {
    let id = recipe_id.as_bytes();
    if id.is_empty()
        || id.len() > 128
        || !id[0].is_ascii_alphanumeric()
        || id
            .iter()
            .any(|b| !(b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_' || *b == b'-'))
    {
        return Err(CommandError::invalid_contract(
            "Recipe ID requires 1–128 lowercase identifier characters.",
        ));
    }
    let now = now.to_offset(UtcOffset::UTC);
    if !(1..=9999).contains(&now.year()) {
        return Err(CommandError::invalid_contract(
            "Recipe filename requires a valid UTC date in years 0001–9999.",
        ));
    }
    Ok(format!(
        "{recipe_id}_{:04}-{:02}-{:02}_{:02}-{:02}-{:02}-{:03}Z.json",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond(),
    ))
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions and other reparse points, not just symlinks.
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        metadata.file_type().is_symlink()
    }
}

fn require_unlinked_path(path: &Path) -> ResearchResult<Metadata> {
    let metadata = fs::symlink_metadata(path).map_err(CommandError::io)?;
    for ancestor in path.ancestors().filter(|p| !p.as_os_str().is_empty()) {
        if is_link(&fs::symlink_metadata(ancestor).map_err(CommandError::io)?) {
            return Err(CommandError::forbidden(
                "Recipe files and folders must not be links or reparse points.",
            ));
        }
    }
    Ok(metadata)
}

fn require_directory(path: &Path) -> ResearchResult<()> {
    if !require_unlinked_path(path)?.is_dir() {
        return Err(CommandError::forbidden("Select an existing recipe folder."));
    }
    Ok(())
}

fn read_recipe_bytes(path: &Path) -> ResearchResult<Vec<u8>> {
    if !require_unlinked_path(path)?.is_file() {
        return Err(CommandError::invalid_contract(
            "Select a regular recipe file.",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the final object itself; never follow a replaced final reparse point.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).map_err(CommandError::io)?;
    let metadata = file.metadata().map_err(CommandError::io)?;
    if is_link(&metadata)
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_BYTES as u64
    {
        return Err(CommandError::invalid_contract(
            "Recipe must be a regular file containing 1 byte to 16 MiB.",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    if bytes.len() as u64 != metadata.len() {
        return Err(CommandError::invalid_contract(
            "Recipe changed while reading its bytes.",
        ));
    }
    Ok(bytes)
}

/// Strict master/legacy dispatch over one bounded native byte snapshot. Opening
/// authored JSON does not create a workspace or grant access to declared media.
pub(crate) fn read_planner_recipe_path(path: &Path) -> ResearchResult<serde_json::Value> {
    parse_planner_recipe_file(&read_recipe_bytes(path)?)
}

/// Additive master-only intake. Legacy package dispatch remains unchanged above.
pub(crate) fn read_supported_planner_recipe_file(
    path: &Path,
) -> ResearchResult<LoadedSupportedPlannerRecipe> {
    parse_supported_planner_recipe_bytes(&read_recipe_bytes(path)?)
}

/// Select strict parsing by entrypoint while keeping one filesystem writer.
/// This private trait does not let callers inject a parser or bypass validation.
trait FileRecipeDocument: Sized {
    fn parse(bytes: &[u8]) -> ResearchResult<Self>;
    fn source_text(&self) -> &str;
    fn save_receipt(&self) -> SavedPlannerRecipeReceipt;
}

impl FileRecipeDocument for LoadedPlannerRecipe {
    fn parse(bytes: &[u8]) -> ResearchResult<Self> {
        parse_planner_recipe_bytes(bytes)
    }
    fn source_text(&self) -> &str {
        &self.canonical_source_text
    }
    fn save_receipt(&self) -> SavedPlannerRecipeReceipt {
        SavedPlannerRecipeReceipt::from_loaded(self)
    }
}

impl FileRecipeDocument for LoadedSupportedPlannerRecipe {
    fn parse(bytes: &[u8]) -> ResearchResult<Self> {
        parse_supported_planner_recipe_bytes(bytes)
    }
    fn source_text(&self) -> &str {
        &self.canonical_source_text
    }
    fn save_receipt(&self) -> SavedPlannerRecipeReceipt {
        SavedPlannerRecipeReceipt {
            schema: "affect-research-planner-recipe-save-receipt".into(),
            // Receipt version is independent of the saved recipe's version.
            version: 1,
            recipe_id: self.recipe.recipe_id().into(),
            definition_sha256: self.recipe.definition_sha256().into(),
            canonical_source_byte_sha256: self.canonical_source_byte_sha256.clone(),
            byte_length: self.canonical_source_text.len() as u64,
        }
    }
}

struct StagedRecipe(PathBuf);

impl Drop for StagedRecipe {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn stage_recipe(
    directory: &Path,
    document: &impl FileRecipeDocument,
) -> ResearchResult<StagedRecipe> {
    require_directory(directory)?;
    let path = directory.join(format!(".affect-research-{}.staging", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(CommandError::io)?;
    let staged = StagedRecipe(path);
    let result = (|| {
        file.write_all(document.source_text().as_bytes())
            .map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)
    })();
    drop(file);
    result?;
    verify_saved(&staged.0, document)?;
    Ok(staged)
}

fn verify_saved<D: FileRecipeDocument>(
    path: &Path,
    expected: &D,
) -> ResearchResult<SavedPlannerRecipeReceipt> {
    let observed = D::parse(&read_recipe_bytes(path)?)?;
    let receipt = observed.save_receipt();
    if observed.source_text() != expected.source_text() || receipt != expected.save_receipt() {
        return Err(CommandError::invalid_contract(
            "Saved bytes do not match the prepared recipe.",
        ));
    }
    Ok(receipt)
}

fn verify_published(
    path: &Path,
    expected: &impl FileRecipeDocument,
    basename: String,
) -> Result<SavedPlannerRecipeReceipt, PlannerRecipeWriteError> {
    verify_saved(path, expected).map_err(|error| PlannerRecipeWriteError {
        error,
        published_basename: Some(basename),
    })
}

fn destination_exists(path: &Path) -> ResearchResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true), // Includes directories and dangling links: never follow/replace them.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(CommandError::io(error)),
    }
}

fn already_exists() -> CommandError {
    CommandError::new(
        "recipe_destination_exists",
        "A file already uses this name. Choose a new recipe filename.",
    )
}

/// Publish a complete staged file with an atomic no-clobber link operation.
/// There is deliberately no rename/replace fallback on filesystems without
/// hard-link support. This guarantees a prior destination is never overwritten.
fn publish_new(staged: &StagedRecipe, path: &Path) -> ResearchResult<bool> {
    if destination_exists(path)? {
        return Ok(false);
    }
    match fs::hard_link(&staged.0, path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(CommandError::io(error)),
    }
}

/// A user-selected native destination is still create-new only. In particular,
/// a dialog's replace confirmation never authorizes this writer to overwrite.
pub(crate) fn write_selected_planner_recipe(
    path: &Path,
    source_text: &str,
) -> Result<SavedPlannerRecipeReceipt, PlannerRecipeWriteError> {
    let expected = parse_planner_recipe_bytes(source_text.as_bytes())?;
    let basename = path
        .file_name()
        .ok_or_else(|| CommandError::forbidden("Select a recipe filename."))?
        .to_string_lossy()
        .into_owned();
    let directory = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    require_directory(directory)?;
    if destination_exists(path)? {
        return Err(already_exists().into());
    }
    let staged = stage_recipe(directory, &expected)?;
    require_directory(directory)?;
    if !publish_new(&staged, path)? {
        return Err(already_exists().into());
    }
    // A final readback failure does not remove a possibly externally changed
    // destination. No receipt is returned; callers must not mark it saved.
    verify_published(path, &expected, basename)
}

pub(crate) fn write_new_planner_recipe(
    directory: &Path,
    source_text: &str,
) -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError> {
    write_new_at(directory, source_text, OffsetDateTime::now_utc())
}

pub(crate) fn write_new_supported_planner_recipe(
    directory: &Path,
    source_text: &str,
) -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError> {
    write_new_supported_at(directory, source_text, OffsetDateTime::now_utc())
}

fn write_new_supported_at(
    directory: &Path,
    source_text: &str,
    now: OffsetDateTime,
) -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError> {
    let expected = parse_supported_planner_recipe_bytes(source_text.as_bytes())?;
    write_new_document_at(directory, &expected, now)
}

fn write_new_at(
    directory: &Path,
    source_text: &str,
    now: OffsetDateTime,
) -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError> {
    let expected = parse_planner_recipe_bytes(source_text.as_bytes())?;
    write_new_document_at(directory, &expected, now)
}

fn write_new_document_at(
    directory: &Path,
    expected: &impl FileRecipeDocument,
    now: OffsetDateTime,
) -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError> {
    let filename = planner_recipe_filename(&expected.save_receipt().recipe_id, now)?;
    let stem = filename
        .strip_suffix(".json")
        .expect("Generated JSON extension");
    let staged = stage_recipe(directory, expected)?;
    for attempt in 0..MAX_NAME_ATTEMPTS {
        let basename = if attempt == 0 {
            filename.clone()
        } else {
            format!("{stem}_{attempt:03}.json")
        };
        let path = directory.join(&basename);
        require_directory(directory)?;
        if publish_new(&staged, &path)? {
            return Ok(SavedPlannerRecipeFile {
                receipt: verify_published(&path, expected, basename.clone())?,
                basename,
            });
        }
    }
    Err(CommandError::new(
        "recipe_filename_collisions",
        "Too many recipe versions use this timestamp. Retry with a new timestamp.",
    )
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    const SOURCE: &str =
        include_str!("../../test/fixtures/planner-recipe-xr-current-v1.canonical.json");
    const V2_SOURCE: &str =
        include_str!("../../test/fixtures/planner-recipe-v2-mixed.canonical.json");

    struct TestDirectory(PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("affect-planner-file-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn assert_no_staging(&self) {
            assert!(fs::read_dir(&self.0).unwrap().all(|e| !e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".staging")));
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let result = fs::remove_dir_all(&self.0);
            if !std::thread::panicking() {
                result.unwrap();
            }
        }
    }

    #[test]
    fn supported_files_preserve_v1_and_all_v2_fixture_bytes_and_receipt_shape() {
        use sha2::{Digest, Sha256};
        let root = TestDirectory::new();
        for source in [
            SOURCE,
            V2_SOURCE,
            include_str!("../../test/fixtures/planner-recipe-v2-locations.canonical.json"),
            include_str!("../../test/fixtures/planner-recipe-v2-xr.canonical.json"),
        ] {
            let saved = write_new_supported_planner_recipe(&root.0, source).unwrap();
            let path = root.0.join(&saved.basename);
            let loaded = read_supported_planner_recipe_file(&path).unwrap();
            assert_eq!(fs::read(&path).unwrap(), source.as_bytes());
            assert_eq!(loaded.canonical_source_text, source);
            assert_eq!(
                saved.receipt.canonical_source_byte_sha256,
                format!("{:x}", Sha256::digest(source.as_bytes()))
            );
            assert_eq!(saved.receipt.byte_length, source.len() as u64);
            assert_eq!(saved.receipt.recipe_id, loaded.recipe.recipe_id());
            assert_eq!(
                saved.receipt.definition_sha256,
                loaded.recipe.definition_sha256()
            );
            let wire = serde_json::to_value(&saved.receipt).unwrap();
            assert_eq!(wire.as_object().unwrap().len(), 6);
            assert_eq!(
                wire["schema"],
                "affect-research-planner-recipe-save-receipt"
            );
            assert_eq!(wire["version"], 1);
            if source == SOURCE {
                assert_eq!(loaded.recipe.version(), 1);
                let old = parse_planner_recipe_bytes(source.as_bytes()).unwrap();
                assert_eq!(saved.receipt, SavedPlannerRecipeReceipt::from_loaded(&old));
            } else {
                assert_eq!(loaded.recipe.version(), 2);
                assert!(read_planner_recipe_path(&path).is_err());
                assert!(write_new_planner_recipe(&root.0, source).is_err());
                assert!(
                    write_selected_planner_recipe(&root.0.join("v1-only.json"), source).is_err()
                );
                assert!(!root.0.join("v1-only.json").exists());
            }
        }
        root.assert_no_staging();
    }

    #[test]
    fn supported_reader_and_writer_reject_unknown_malformed_and_bad_integrity() {
        let root = TestDirectory::new();
        let path = root.0.join("input.json");
        let original: serde_json::Value = serde_json::from_str(V2_SOURCE).unwrap();
        let mut invalid = vec![
            String::new(),
            "{}\n".into(),
            " ".repeat(MAX_BYTES + 1),
            V2_SOURCE.replacen(
                "\"recipeId\":",
                "\"recipeId\":\"duplicate\",\"recipeId\":",
                1,
            ),
            include_str!("../../test/fixtures/experiment-package-v1.canonical.json").into(),
        ];
        for kind in ["version", "field", "definition", "reproduction"] {
            let mut value = original.clone();
            match kind {
                "version" => value["version"] = serde_json::json!(99),
                "field" => value["unknown"] = serde_json::json!(true),
                "definition" => {
                    value["integrity"]["definitionSha256"] = serde_json::json!("0".repeat(64))
                }
                _ => value["integrity"]["reproductionSha256"] = serde_json::json!("0".repeat(64)),
            }
            let mut bytes = crate::research_contracts::canonical_json(&value, &[]).unwrap();
            bytes.push(b'\n');
            invalid.push(String::from_utf8(bytes).unwrap());
        }
        for source in invalid {
            fs::write(&path, &source).unwrap();
            assert!(read_supported_planner_recipe_file(&path).is_err());
            let error = write_new_supported_planner_recipe(&root.0, &source).unwrap_err();
            assert!(error.published_basename.is_none());
            assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
        }
        assert!(read_supported_planner_recipe_file(&root.0).is_err());
        root.assert_no_staging();
    }

    #[test]
    fn supported_parallel_writes_and_clock_rollback_preserve_prior_files() {
        let root = TestDirectory::new();
        let loaded = parse_supported_planner_recipe_bytes(V2_SOURCE.as_bytes()).unwrap();
        let first =
            planner_recipe_filename(loaded.recipe.recipe_id(), OffsetDateTime::UNIX_EPOCH).unwrap();
        fs::write(root.0.join(&first), b"prior file").unwrap();
        let saved = std::thread::scope(|scope| {
            let jobs: Vec<_> = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        write_new_supported_at(&root.0, V2_SOURCE, OffsetDateTime::UNIX_EPOCH)
                            .unwrap()
                    })
                })
                .collect();
            jobs.into_iter()
                .map(|job| job.join().unwrap())
                .collect::<Vec<_>>()
        });
        let mut names: Vec<_> = saved.iter().map(|file| &file.basename).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 4);
        assert_eq!(fs::read(root.0.join(first)).unwrap(), b"prior file");
        let earlier = write_new_supported_at(
            &root.0,
            V2_SOURCE,
            OffsetDateTime::UNIX_EPOCH - time::Duration::seconds(1),
        )
        .unwrap();
        for file in saved.into_iter().chain([earlier]) {
            assert_eq!(
                fs::read(root.0.join(&file.basename)).unwrap(),
                V2_SOURCE.as_bytes()
            );
            assert_eq!(file.receipt, loaded.save_receipt());
        }
        root.assert_no_staging();
    }

    #[test]
    fn supported_publication_denies_receipt_after_external_byte_change() {
        let root = TestDirectory::new();
        let loaded = parse_supported_planner_recipe_bytes(V2_SOURCE.as_bytes()).unwrap();
        let staged = stage_recipe(&root.0, &loaded).unwrap();
        let basename = "v2-unverified.json";
        let path = root.0.join(basename);
        assert!(publish_new(&staged, &path).unwrap());
        fs::write(&path, b"external change after publication").unwrap();
        let failure = verify_published(&path, &loaded, basename.into()).unwrap_err();
        assert_eq!(failure.published_basename.as_deref(), Some(basename));
        assert_eq!(
            failure.into_command_error().code,
            "recipe_file_written_unverified"
        );
        assert_eq!(
            fs::read(&path).unwrap(),
            b"external change after publication"
        );
        drop(staged);
        root.assert_no_staging();
    }

    #[test]
    fn filenames_match_shared_js_fixtures_and_reject_path_syntax() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../test/fixtures/planner-recipe-filenames.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let now = OffsetDateTime::from_unix_timestamp_nanos(
                i128::from(fixture["unixMilliseconds"].as_i64().unwrap()) * 1_000_000,
            )
            .unwrap();
            assert_eq!(
                planner_recipe_filename(fixture["recipeId"].as_str().unwrap(), now).unwrap(),
                fixture["filename"]
            );
            assert_eq!(
                planner_recipe_filename(
                    fixture["recipeId"].as_str().unwrap(),
                    now.to_offset(UtcOffset::from_hms(2, 0, 0).unwrap())
                )
                .unwrap(),
                fixture["filename"]
            );
        }
        for id in [
            "",
            "../recipe",
            "a/b",
            "a\\b",
            "C:recipe",
            "a.json",
            "a ",
            "UPPER",
            "ä",
            "_a",
            &"a".repeat(129),
        ] {
            assert!(planner_recipe_filename(id, OffsetDateTime::UNIX_EPOCH).is_err());
        }
        assert!(
            planner_recipe_filename("a", time::macros::datetime!(0000-01-01 0:00 UTC)).is_err()
        );
        assert!(planner_recipe_filename(&"a".repeat(128), OffsetDateTime::UNIX_EPOCH).is_ok());
    }

    #[test]
    fn bounded_reader_dispatches_master_and_legacy_without_media_access() {
        let root = TestDirectory::new();
        let target = root.0.join("source.json");
        fs::write(&target, SOURCE).unwrap();
        assert_eq!(
            read_planner_recipe_path(&target).unwrap()["kind"],
            "planner-recipe-v1"
        );
        fs::write(
            &target,
            include_bytes!("../../test/fixtures/experiment-package-v1.canonical.json"),
        )
        .unwrap();
        assert_eq!(
            read_planner_recipe_path(&target).unwrap()["kind"],
            "experiment-package-v1"
        );
        for source in [
            String::new(),
            "{}\n".to_owned(),
            SOURCE.replacen("{", "{\"unknown\":true,", 1),
            SOURCE.replacen(
                "\"recipeId\":",
                "\"recipeId\":\"duplicate\",\"recipeId\":",
                1,
            ),
        ] {
            fs::write(&target, source).unwrap();
            assert!(read_planner_recipe_path(&target).is_err());
        }
        File::create(&target)
            .unwrap()
            .set_len(MAX_BYTES as u64 + 1)
            .unwrap();
        assert!(read_planner_recipe_path(&target).is_err());
        assert!(read_planner_recipe_path(&root.0).is_err());
    }

    #[test]
    fn selected_save_acknowledges_exact_bytes_and_never_replaces_any_destination() {
        let root = TestDirectory::new();
        let target = root.0.join("chosen-recipe.json");
        let expected = parse_planner_recipe_bytes(SOURCE.as_bytes()).unwrap();
        let receipt = write_selected_planner_recipe(&target, SOURCE).unwrap();
        assert_eq!(receipt, SavedPlannerRecipeReceipt::from_loaded(&expected));
        assert_eq!(fs::read(&target).unwrap(), SOURCE.as_bytes());
        assert_eq!(
            write_selected_planner_recipe(&target, SOURCE)
                .unwrap_err()
                .error
                .code,
            "recipe_destination_exists"
        );
        assert!(write_selected_planner_recipe(&target, "{}\n").is_err());
        assert_eq!(fs::read(&target).unwrap(), SOURCE.as_bytes());
        let empty = root.0.join("empty.json");
        fs::write(&empty, []).unwrap();
        assert!(write_selected_planner_recipe(&empty, SOURCE).is_err());
        assert_eq!(fs::metadata(&empty).unwrap().len(), 0);
        let directory = root.0.join("folder.json");
        fs::create_dir(&directory).unwrap();
        assert!(write_selected_planner_recipe(&directory, SOURCE).is_err());
        assert!(
            write_selected_planner_recipe(&root.0.join("missing").join("recipe.json"), SOURCE)
                .is_err()
        );
        root.assert_no_staging();
    }

    #[test]
    fn invalid_source_creates_no_version_or_staging_file() {
        let root = TestDirectory::new();
        for source in [
            "{}\n".to_owned(),
            SOURCE.replacen("{", "{\"unknown\":true,", 1),
            SOURCE.replacen(
                "\"recipeId\":",
                "\"recipeId\":\"duplicate\",\"recipeId\":",
                1,
            ),
            " ".repeat(MAX_BYTES + 1),
        ] {
            assert!(write_new_planner_recipe(&root.0, &source).is_err());
            assert!(write_selected_planner_recipe(&root.0.join("invalid.json"), &source).is_err());
            assert_eq!(fs::read_dir(&root.0).unwrap().count(), 0);
        }
    }

    #[test]
    fn timestamp_collisions_and_parallel_writers_preserve_all_versions() {
        let root = TestDirectory::new();
        let results = std::thread::scope(|scope| {
            let threads: Vec<_> = (0..8)
                .map(|_| {
                    scope.spawn(|| {
                        write_new_at(&root.0, SOURCE, OffsetDateTime::UNIX_EPOCH).unwrap()
                    })
                })
                .collect();
            threads
                .into_iter()
                .map(|t| t.join().unwrap())
                .collect::<Vec<_>>()
        });
        let mut names: Vec<_> = results.iter().map(|r| r.basename.clone()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), 8);
        let expected = parse_planner_recipe_bytes(SOURCE.as_bytes()).unwrap();
        let first = planner_recipe_filename(&expected.recipe.recipe_id, OffsetDateTime::UNIX_EPOCH)
            .unwrap();
        assert!(names.contains(&first));
        assert!(names.contains(&first.replace(".json", "_007.json")));
        for result in results {
            assert_eq!(
                result.receipt,
                SavedPlannerRecipeReceipt::from_loaded(&expected)
            );
            assert_eq!(
                fs::read(root.0.join(result.basename)).unwrap(),
                SOURCE.as_bytes()
            );
        }
        root.assert_no_staging();
    }

    #[test]
    fn exhausted_timestamp_names_fail_closed_without_replacing_sentinels() {
        let root = TestDirectory::new();
        let expected = parse_planner_recipe_bytes(SOURCE.as_bytes()).unwrap();
        let first = planner_recipe_filename(&expected.recipe.recipe_id, OffsetDateTime::UNIX_EPOCH)
            .unwrap();
        for attempt in 0..MAX_NAME_ATTEMPTS {
            let name = if attempt == 0 {
                first.clone()
            } else {
                first.replace(".json", &format!("_{attempt:03}.json"))
            };
            fs::write(root.0.join(name), b"keep").unwrap();
        }
        assert_eq!(
            write_new_at(&root.0, SOURCE, OffsetDateTime::UNIX_EPOCH)
                .unwrap_err()
                .error
                .code,
            "recipe_filename_collisions"
        );
        for entry in fs::read_dir(&root.0).unwrap() {
            assert_eq!(fs::read(entry.unwrap().path()).unwrap(), b"keep");
        }
        root.assert_no_staging();
    }

    #[test]
    fn publication_race_never_clobbers_a_destination_created_after_staging() {
        let root = TestDirectory::new();
        let expected = parse_planner_recipe_bytes(SOURCE.as_bytes()).unwrap();
        let staged = stage_recipe(&root.0, &expected).unwrap();
        let target = root.0.join("raced.json");
        fs::write(&target, b"other writer").unwrap();
        assert!(!publish_new(&staged, &target).unwrap());
        assert_eq!(fs::read(&target).unwrap(), b"other writer");
        assert!(verify_saved(&target, &expected).is_err());
        drop(staged);
        root.assert_no_staging();
    }

    #[test]
    fn failed_final_verification_reports_the_published_basename_without_a_receipt() {
        let root = TestDirectory::new();
        let expected = parse_planner_recipe_bytes(SOURCE.as_bytes()).unwrap();
        let staged = stage_recipe(&root.0, &expected).unwrap();
        let basename = "written-but-unverified.json";
        let target = root.0.join(basename);
        assert!(publish_new(&staged, &target).unwrap());
        // Fault injection at the real publication/readback boundary.
        fs::write(&target, b"external change").unwrap();
        let error = verify_published(&target, &expected, basename.to_owned()).unwrap_err();
        assert_eq!(error.published_basename.as_deref(), Some(basename));
        let wire = serde_json::to_value(&error).unwrap();
        assert_eq!(wire["publishedBasename"], basename);
        assert!(wire.get("receipt").is_none());
        assert!(!wire
            .to_string()
            .contains(&root.0.to_string_lossy().to_string()));
        let gui = error.into_command_error();
        assert_eq!(gui.code, "recipe_file_written_unverified");
        assert!(gui.message.contains(basename));
        assert_eq!(fs::read(&target).unwrap(), b"external change");
        let rejected = write_new_planner_recipe(&root.0, "{}\n").unwrap_err();
        assert!(rejected.published_basename.is_none());
        assert_eq!(
            rejected.into_command_error().code,
            "invalid_research_contract"
        );
        drop(staged);
        root.assert_no_staging();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn junction_destinations_and_linked_parent_directories_are_rejected() {
        use std::os::windows::process::CommandExt;
        let root = TestDirectory::new();
        let actual = root.0.join("actual");
        let junction = root.0.join("linked.json");
        fs::create_dir(&actual).unwrap();
        fs::write(actual.join("source.json"), SOURCE).unwrap();
        // Test-only Windows junction fixture; no privilege, desktop interaction
        // or application shell API. Paths are passed as environment data.
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                "New-Item -ItemType Junction -Path $env:AFFECT_TEST_LINK -Target $env:AFFECT_TEST_TARGET -ErrorAction Stop | Out-Null"])
            .env("AFFECT_TEST_LINK", &junction)
            .env("AFFECT_TEST_TARGET", &actual)
            .creation_flags(0x0800_0000)
            .status().unwrap();
        assert!(status.success());
        assert!(is_link(&fs::symlink_metadata(&junction).unwrap()));
        assert!(read_planner_recipe_path(&junction.join("source.json")).is_err());
        assert!(read_supported_planner_recipe_file(&junction.join("source.json")).is_err());
        assert!(write_new_supported_planner_recipe(&junction, V2_SOURCE).is_err());
        assert!(write_new_planner_recipe(&junction, SOURCE).is_err());
        assert!(write_selected_planner_recipe(&junction.join("new.json"), SOURCE).is_err());
        assert!(write_selected_planner_recipe(&junction, SOURCE).is_err());
        assert_eq!(
            fs::read(actual.join("source.json")).unwrap(),
            SOURCE.as_bytes()
        );
        assert_eq!(fs::read_dir(&actual).unwrap().count(), 1);
        fs::remove_file(actual.join("source.json")).unwrap();
        fs::remove_dir(&actual).unwrap();
        assert!(write_selected_planner_recipe(&junction, SOURCE).is_err());
        // Rust's Windows directory removal requires the junction target to
        // exist. Restore the empty test target before unlinking the fixture.
        fs::create_dir(&actual).unwrap();
        fs::remove_dir(&junction).unwrap();
        root.assert_no_staging();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn locked_native_file_is_preserved_and_read_fails_without_receipt() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = TestDirectory::new();
        let target = root.0.join("locked.json");
        fs::write(&target, SOURCE).unwrap();
        let locked = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        assert!(write_selected_planner_recipe(&target, SOURCE).is_err());
        assert!(read_planner_recipe_path(&target).is_err());
        assert!(read_supported_planner_recipe_file(&target).is_err());
        drop(locked);
        assert_eq!(fs::read(&target).unwrap(), SOURCE.as_bytes());
        root.assert_no_staging();
    }
}

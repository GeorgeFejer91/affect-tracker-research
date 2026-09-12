//! Native Planner document files. Callers retain directory/path authority;
//! only basenames and exact content receipts may cross into the renderer.
//! The JS authoring compiler remains the only fresh recipe compiler.
use crate::research_error::{CommandError, ResearchResult};
use crate::research_planner_recipe::{
    parse_planner_recipe_bytes, parse_planner_recipe_file, LoadedPlannerRecipe,
    SavedPlannerRecipeReceipt, MAX_BYTES,
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

struct StagedRecipe(PathBuf);

impl Drop for StagedRecipe {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn stage_recipe(directory: &Path, document: &LoadedPlannerRecipe) -> ResearchResult<StagedRecipe> {
    require_directory(directory)?;
    let path = directory.join(format!(".affect-research-{}.staging", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(CommandError::io)?;
    let staged = StagedRecipe(path);
    let result = (|| {
        file.write_all(document.canonical_source_text.as_bytes())
            .map_err(CommandError::io)?;
        file.sync_all().map_err(CommandError::io)
    })();
    drop(file);
    result?;
    verify_saved(&staged.0, document)?;
    Ok(staged)
}

fn verify_saved(
    path: &Path,
    expected: &LoadedPlannerRecipe,
) -> ResearchResult<SavedPlannerRecipeReceipt> {
    let observed = parse_planner_recipe_bytes(&read_recipe_bytes(path)?)?;
    if observed.canonical_source_text != expected.canonical_source_text
        || observed.canonical_source_byte_sha256 != expected.canonical_source_byte_sha256
    {
        return Err(CommandError::invalid_contract(
            "Saved bytes do not match the prepared recipe.",
        ));
    }
    Ok(SavedPlannerRecipeReceipt::from_loaded(&observed))
}

fn verify_published(
    path: &Path,
    expected: &LoadedPlannerRecipe,
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

fn write_new_at(
    directory: &Path,
    source_text: &str,
    now: OffsetDateTime,
) -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError> {
    let expected = parse_planner_recipe_bytes(source_text.as_bytes())?;
    let filename = planner_recipe_filename(&expected.recipe.recipe_id, now)?;
    let stem = filename
        .strip_suffix(".json")
        .expect("Generated JSON extension");
    let staged = stage_recipe(directory, &expected)?;
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
                receipt: verify_published(&path, &expected, basename.clone())?,
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
        drop(locked);
        assert_eq!(fs::read(&target).unwrap(), SOURCE.as_bytes());
        root.assert_no_staging();
    }
}

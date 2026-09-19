use super::*;
use crate::research_stimulus_order::{
    document_bytes, variants::StoredStimulusOrder, AuthoringReceipt, VideoIdentity, VideoLibrary,
    LIBRARY_FILE, MAX_DOCUMENT_BYTES, ORDER_FILE,
};

fn ordinary(path: &Path) -> ResearchResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(CommandError::io)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(CommandError::forbidden(
                "Library entries cannot be reparse points.",
            ));
        }
    }
    if metadata.file_type().is_symlink() {
        return Err(CommandError::forbidden(
            "Library entries cannot be symbolic links.",
        ));
    }
    Ok(())
}
fn authoring_video(path: &Path) -> bool {
    is_video(path)
        || path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("ogv"))
}
fn collect_authoring_sources(selections: Vec<PathBuf>) -> ResearchResult<Vec<PathBuf>> {
    let mut pending: VecDeque<_> = selections.into_iter().map(|path| (path, 0usize)).collect();
    let mut files = Vec::new();
    let mut count = 0;
    while let Some((path, depth)) = pending.pop_front() {
        count += 1;
        if count > 10000 || depth > 16 {
            return Err(CommandError::forbidden(
                "Video import exceeds 10000 entries or 16 directory levels.",
            ));
        }
        ordinary(&path)?;
        let metadata = fs::symlink_metadata(&path).map_err(CommandError::io)?;
        if metadata.is_file() && authoring_video(&path) {
            files.push(path);
        } else if metadata.is_dir() {
            for child in fs::read_dir(path).map_err(CommandError::io)? {
                pending.push_back((child.map_err(CommandError::io)?.path(), depth + 1));
                if pending.len() + count > 10000 {
                    return Err(CommandError::forbidden(
                        "Video import exceeds 10000 entries.",
                    ));
                }
            }
        }
    }
    if files.is_empty() {
        return Err(CommandError::forbidden(
            "The selection contained no supported complete-video files.",
        ));
    }
    Ok(files)
}
fn scan(root: &Path) -> ResearchResult<VideoLibrary> {
    let mut pending = VecDeque::from([(root.to_path_buf(), String::new(), 0usize)]);
    let mut entries = Vec::new();
    let mut count = 0;
    while let Some((directory, prefix, depth)) = pending.pop_front() {
        if depth > 16 {
            return Err(CommandError::forbidden(
                "Video library exceeds 16 directory levels.",
            ));
        }
        ordinary(&directory)?;
        for child in fs::read_dir(&directory).map_err(CommandError::io)? {
            let child = child.map_err(CommandError::io)?;
            count += 1;
            if count > 10000 {
                return Err(CommandError::forbidden(
                    "Video library exceeds 10000 entries.",
                ));
            }
            let path = child.path();
            ordinary(&path)?;
            let name = child
                .file_name()
                .into_string()
                .map_err(|_| CommandError::forbidden("Video names must be valid Unicode."))?;
            let relative = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            let metadata = fs::symlink_metadata(&path).map_err(CommandError::io)?;
            if metadata.is_dir() {
                pending.push_back((path, relative, depth + 1));
            } else if metadata.is_file() && authoring_video(&path) {
                let (sha256, byte_length) = hash_file(&path)?;
                entries.push(VideoIdentity {
                    relative_path: format!("assets/stimuli/{relative}"),
                    sha256,
                    byte_length,
                });
            } else {
                return Err(CommandError::forbidden("The video folder must contain only supported complete videos. Keep authoring documents beside assets/stimuli/."));
            }
        }
    }
    let library = VideoLibrary::create(entries)?;
    if document_bytes(&library)?.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(CommandError::invalid_contract(
            "Video library annotation exceeds 5 MiB.",
        ));
    }
    Ok(library)
}
fn read_document<T: for<'de> Deserialize<'de> + Serialize>(path: &Path) -> ResearchResult<T> {
    ordinary(path)?;
    let file = File::open(path).map_err(CommandError::io)?;
    if !file.metadata().map_err(CommandError::io)?.is_file() {
        return Err(CommandError::forbidden(
            "Authoring documents must be ordinary files.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(CommandError::io)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(CommandError::invalid_contract(
            "Authoring document exceeds 5 MiB.",
        ));
    }
    let value: T = serde_json::from_slice(&bytes)
        .map_err(|_| CommandError::invalid_contract("Authoring document is malformed."))?;
    if document_bytes(&value)? != bytes {
        return Err(CommandError::invalid_contract(
            "Authoring document must be canonical JSON with one LF.",
        ));
    }
    Ok(value)
}
fn store<T: Serialize>(path: &Path, value: &T) -> ResearchResult<()> {
    let exists = match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(CommandError::io(error)),
    };
    if exists {
        ordinary(path)?;
        if !path.is_file() {
            return Err(CommandError::forbidden(
                "Authoring destination must be an ordinary file.",
            ));
        }
    }
    let bytes = document_bytes(value)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(CommandError::invalid_contract(
            "Authoring document exceeds 5 MiB.",
        ));
    }
    write_replacing(path, &bytes)?;
    if fs::read(path).map_err(CommandError::io)? != bytes {
        return Err(CommandError::forbidden("Authoring write readback differs."));
    }
    Ok(())
}
impl WorkspaceService {
    pub fn video_library(
        &self,
        workspace_id: &str,
        confirm: bool,
    ) -> ResearchResult<AuthoringReceipt> {
        self.with_workspace(workspace_id, |root, _| {
            let folders = validate_workspace_libraries(root)?;
            let assets = folders.package_assets.parent().ok_or_else(|| CommandError::forbidden("Video asset directory is unavailable."))?;
            let library = scan(&folders.package_assets)?;
            if confirm { store(&assets.join(LIBRARY_FILE), &library)?; }
            let design_path = assets.join(ORDER_FILE);
            let (design, design_error) = if design_path.try_exists().map_err(CommandError::io)? {
                match read_document::<StoredStimulusOrder>(&design_path).and_then(|design| { design.validate(&library)?; Ok(design) }) {
                    Ok(design) => (Some(design), None),
                    Err(_) => (None, Some("Saved variant design could not be matched to this library. Existing file preserved; review and confirm a new table.".into())),
                }
            } else { (None, None) };
            Ok(AuthoringReceipt { library, design, design_error })
        })
    }
    pub fn save_stimulus_order<T: Into<StoredStimulusOrder>>(
        &self,
        workspace_id: &str,
        document: T,
    ) -> ResearchResult<AuthoringReceipt> {
        let document = document.into();
        self.with_workspace(workspace_id, |root, _| {
            let folders = validate_workspace_libraries(root)?;
            let assets = folders
                .package_assets
                .parent()
                .ok_or_else(|| CommandError::forbidden("Video asset directory is unavailable."))?;
            let library = read_document::<VideoLibrary>(&assets.join(LIBRARY_FILE))?;
            library.validate()?;
            if scan(&folders.package_assets)? != library {
                return Err(CommandError::forbidden(
                    "Video files changed. Confirm the current library in Segment 1 again.",
                ));
            }
            document.validate(&library)?;
            store(&assets.join(ORDER_FILE), &document)?;
            Ok(AuthoringReceipt {
                library,
                design: Some(document),
                design_error: None,
            })
        })
    }
    pub fn import_authoring_videos(
        &self,
        workspace_id: &str,
        selections: Vec<PathBuf>,
    ) -> ResearchResult<AuthoringReceipt> {
        self.with_workspace(workspace_id, |root, _| {
            let folders = validate_workspace_libraries(root)?;
            scan(&folders.package_assets)?;
            let destination = ensure_exact_child_directory(&folders.package_assets, "imported")?;
            let mut sources = collect_authoring_sources(selections)?;
            sources.sort();
            sources.dedup();
            for source in sources {
                import_video(&source, &destination)?;
            }
            Ok(())
        })?;
        self.video_library(workspace_id, false)
    }
    pub fn export_video_library(
        &self,
        workspace_id: &str,
        expected_sha256: &str,
        format: crate::research_stimulus_order::export::LibraryFormat,
    ) -> ResearchResult<Vec<u8>> {
        let receipt = self.video_library(workspace_id, false)?;
        if receipt.library.integrity_sha256 != expected_sha256 {
            return Err(CommandError::forbidden(
                "Video library changed. Confirm Segment 1 before exporting.",
            ));
        }
        Ok(crate::research_stimulus_order::export::library_bytes(
            &receipt.library,
            format,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn named_design_is_saved_and_reopened_without_legacy_reinterpretation() {
        use crate::research_stimulus_order::variants::{
            IsiDefinition, VariantDocument, VariantDraft,
        };
        use crate::research_stimulus_order::VariantColumn;
        let base = std::env::temp_dir().join(format!("research-named-order-{}", Uuid::new_v4()));
        let root = base.join("workspace");
        fs::create_dir_all(&root).unwrap();
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let id = service.select(root.clone()).unwrap().workspace_id.unwrap();
        fs::write(
            root.join("assets/stimuli/one.mp4"),
            b"synthetic video identity",
        )
        .unwrap();
        let library = service.video_library(&id, true).unwrap().library;
        let video = library.videos[0].annotation_id.clone();
        let draft = VariantDraft {
            columns: vec![VariantColumn {
                variant_id: "variant-1".into(),
                title: "Variant 1".into(),
            }],
            rows: vec![vec![video.clone()], vec!["ISI1".into()], vec![video]],
            entry_ids: (1..=3)
                .map(|n| vec![format!("variant-1-entry-{n}")])
                .collect(),
            isi_definitions: vec![IsiDefinition {
                isi_id: "ISI1".into(),
                duration_ms: 500,
            }],
            next_isi_ordinal: 2,
        };
        let document = VariantDocument::create(draft, &library).unwrap();
        assert_eq!(
            service
                .save_stimulus_order(&id, document.clone())
                .unwrap()
                .design,
            Some(document.clone().into())
        );
        assert_eq!(
            service.video_library(&id, false).unwrap().design,
            Some(document.into())
        );
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn library_is_stable_and_metadata_stays_outside_video_closure() {
        let root = std::env::temp_dir().join(format!("research-order-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("a.mp4"), b"a").unwrap();
        let first = scan(&root).unwrap();
        first.validate().unwrap();
        assert_eq!(first, scan(&root).unwrap());
        fs::write(root.join("extra.json"), b"{}").unwrap();
        assert!(scan(&root).is_err());
        fs::remove_file(root.join("extra.json")).unwrap();
        fs::write(root.join("a.mp4"), b"changed").unwrap();
        assert_ne!(first, scan(&root).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn video_import_uses_the_authoring_folder_and_is_idempotent() {
        let base = std::env::temp_dir().join(format!("research-order-import-{}", Uuid::new_v4()));
        let root = base.join("workspace");
        let source = base.join("source");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("one.ogv"), b"one").unwrap();
        fs::write(source.join("two.mkv"), b"two").unwrap();
        fs::write(source.join("notes.txt"), b"ignored").unwrap();
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let id = service.select(root.clone()).unwrap().workspace_id.unwrap();
        let first = service
            .import_authoring_videos(&id, vec![source.clone()])
            .unwrap();
        assert_eq!(first.library.videos.len(), 2);
        assert!(first
            .library
            .videos
            .iter()
            .all(|video| video.relative_path.starts_with("assets/stimuli/imported/")));
        let second = service.import_authoring_videos(&id, vec![source]).unwrap();
        assert_eq!(first.library, second.library);
        assert!(!root.join("assets").join(LIBRARY_FILE).exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn workspace_confirmation_save_reload_and_changed_video_rejection() {
        use crate::research_stimulus_order::{
            digest, OrderedVideo, StimulusOrderDocument, Variant, VariantColumn,
        };
        let base = std::env::temp_dir().join(format!("research-order-store-{}", Uuid::new_v4()));
        let root = base.join("workspace");
        fs::create_dir_all(&root).unwrap();
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let id = service.select(root.clone()).unwrap().workspace_id.unwrap();
        let video = root.join("assets/stimuli/one.mp4");
        fs::write(&video, b"complete video fixture").unwrap();
        let receipt = service.video_library(&id, true).unwrap();
        let library = receipt.library;
        let mut variant = Variant {
            variant_id: "variant-1".into(),
            title: "Variant 1".into(),
            videos: vec![OrderedVideo {
                stimulus_id: library.videos[0].annotation_id.clone(),
                isi_after_ms: 500,
            }],
            version_sha256: String::new(),
        };
        variant.version_sha256 = digest(&variant, &["versionSha256"]).unwrap();
        let mut design = StimulusOrderDocument {
            schema: "affect-research-stimulus-order".into(),
            version: 1,
            library_sha256: library.integrity_sha256.clone(),
            columns: vec![VariantColumn {
                variant_id: variant.variant_id.clone(),
                title: variant.title.clone(),
            }],
            rows: vec![
                vec![library.videos[0].annotation_id.clone()],
                vec!["500".into()],
            ],
            variants: vec![variant],
            integrity_sha256: String::new(),
        };
        design.integrity_sha256 = digest(&design, &["integritySha256"]).unwrap();
        assert_eq!(
            service
                .save_stimulus_order(&id, design.clone())
                .unwrap()
                .design,
            Some(design.clone().into())
        );
        assert_eq!(
            service.video_library(&id, false).unwrap().design,
            Some(design.clone().into())
        );
        assert!(!root.join("assets/stimuli").join(LIBRARY_FILE).exists());
        let saved_path = root.join("assets").join(ORDER_FILE);
        let saved = fs::read(&saved_path).unwrap();
        fs::write(&video, b"changed").unwrap();
        assert!(service.save_stimulus_order(&id, design.clone()).is_err());
        assert_eq!(fs::read(&saved_path).unwrap(), saved);
        assert!(service
            .video_library(&id, false)
            .unwrap()
            .design_error
            .is_some());
        fs::write(root.join("assets").join(LIBRARY_FILE), b"{}").unwrap();
        assert!(service.save_stimulus_order(&id, design).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}

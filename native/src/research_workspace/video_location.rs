use super::*;

impl WorkspaceService {
    pub(crate) fn reveal_video_location(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> ResearchResult<()> {
        let path = self.resolve_video_location(workspace_id, relative_path)?;
        tauri_plugin_opener::reveal_item_in_dir(path).map_err(CommandError::io)
    }

    fn resolve_video_location(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> ResearchResult<PathBuf> {
        let guard = self.lock_selected();
        let workspace = selected_ref(&guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        let relative = relative_path
            .strip_prefix("assets/stimuli/")
            .ok_or_else(|| {
                CommandError::forbidden("The video must be inside this experiment's video library.")
            })?;
        if portable_import_relative_path(Path::new(relative))? != relative
            || !is_video(Path::new(relative))
        {
            return Err(CommandError::forbidden(
                "The video location is not a supported library path.",
            ));
        }
        let mut parts = relative.split('/').collect::<Vec<_>>();
        let file_name = parts
            .pop()
            .ok_or_else(|| CommandError::forbidden("Missing video filename."))?;
        let mut parent = libraries.package_assets;
        for part in parts {
            parent = validate_exact_child_directory(&parent, part)?.0;
        }
        let file = parent.join(file_name);
        let metadata = fs::symlink_metadata(&file).map_err(|_| {
            CommandError::forbidden(
                "The video file is missing or unavailable in this experiment's video library.",
            )
        })?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || file.canonicalize().map_err(CommandError::io)? != file
        {
            return Err(CommandError::forbidden(
                "The video location must be an ordinary file in this experiment's video library.",
            ));
        }
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_location_resolves_exact_nested_file_without_opening_explorer() {
        let base = std::env::temp_dir().join(format!("runner-video-location-{}", Uuid::new_v4()));
        fs::create_dir(&base).unwrap();
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let workspace = base.join("project");
        fs::create_dir(&workspace).unwrap();
        let id = service
            .select(workspace.clone())
            .unwrap()
            .workspace_id
            .unwrap();
        let nested = workspace.join("assets/stimuli/session A");
        fs::create_dir(&nested).unwrap();
        let video = nested.join("clip%5F #1.mp4");
        fs::write(&video, b"preview location fixture").unwrap();
        assert_eq!(
            service
                .resolve_video_location(&id, "assets/stimuli/session A/clip%5F #1.mp4")
                .unwrap(),
            video.canonicalize().unwrap()
        );
        for path in [
            "assets/stimuli/missing.mp4",
            "assets/stimuli/../settings/private.mp4",
            "assets/stimuli/session A/./clip%5F #1.mp4",
            "assets/stimuli//clip.mp4",
            "assets/stimuli/session A",
            "assets/stimuli/clip.exe",
            "C:/other/clip.mp4",
            "https://example.com/clip.mp4",
            "assets/stimuli/C:/clip.mp4",
            "assets/stimuli/session A\\clip%5F #1.mp4",
        ] {
            assert!(
                service.resolve_video_location(&id, path).is_err(),
                "accepted {path}"
            );
        }
        service.select(base.clone()).unwrap();
        assert!(service
            .resolve_video_location(&id, "assets/stimuli/session A/clip%5F #1.mp4")
            .is_err());
        fs::remove_dir_all(base).unwrap();
    }
}

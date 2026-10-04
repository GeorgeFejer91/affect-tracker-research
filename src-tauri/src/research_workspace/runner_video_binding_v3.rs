//! Bind a saved browser-video catalogue to the exact current workspace files.
use super::*;
use crate::research_workspace_contribution::v3::{
    validate_video_catalogue_contribution_v3, VideoDisplayGeometryV3,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RunnerVideoBindingV3 {
    pub(crate) asset_id: String,
    pub(crate) annotation_id: String,
    pub(crate) source_relative_path: String,
    pub(crate) workspace_file_id: String,
    pub(crate) sha256: String,
    pub(crate) byte_length: u64,
    pub(crate) mime_type: String,
    pub(crate) duration_ms: u64,
    pub(crate) display_geometry: VideoDisplayGeometryV3,
}

impl WorkspaceService {
    pub fn validate_planner_video_catalogue_v3(
        &self,
        workspace_id: &str,
        value: &serde_json::Value,
    ) -> ResearchResult<crate::research_workspace_contribution::v3::VideoCatalogueContributionV3>
    {
        self.validate_runner_video_catalogue_v3(workspace_id, value)?;
        validate_video_catalogue_contribution_v3(value)
    }

    pub(crate) fn validate_runner_video_catalogue_v3(
        &self,
        workspace_id: &str,
        value: &serde_json::Value,
    ) -> ResearchResult<Vec<RunnerVideoBindingV3>> {
        let catalogue = validate_video_catalogue_contribution_v3(value)?;
        let guard = self.lock_selected();
        let workspace = selected_ref(&guard, workspace_id)?;
        let libraries = validate_selected_workspace(workspace)?;
        let current = scan_planner_videos(&libraries.package_assets)?;
        if catalogue.entries.len() != workspace.scanned.len()
            || catalogue.entries.len() != current.len()
        {
            return Err(CommandError::forbidden(
                "The current Runner video library does not match the saved catalogue.",
            ));
        }

        let mut bindings = Vec::with_capacity(catalogue.entries.len());
        for entry in catalogue.entries {
            let stored = workspace
                .scanned
                .iter()
                .filter(|video| video.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let observed = current
                .iter()
                .filter(|video| video.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let ([candidate], [observed]) = (stored.as_slice(), observed.as_slice()) else {
                return Err(CommandError::forbidden(
                    "A saved catalogue location is not uniquely bound to a current video.",
                ));
            };
            if observed.id != candidate.id
                || observed.path != candidate.path
                || observed.sha256 != candidate.sha256
                || observed.byte_length != candidate.byte_length
                || observed.mime_type != candidate.mime_type
                || entry.asset_id != format!("asset-{}", observed.sha256)
                || entry.sha256 != observed.sha256
                || entry.byte_length != observed.byte_length
            {
                return Err(CommandError::forbidden(
                    "The current video file no longer matches the saved catalogue.",
                ));
            }
            bindings.push(RunnerVideoBindingV3 {
                asset_id: entry.asset_id,
                annotation_id: entry.annotation_id,
                source_relative_path: entry.source_relative_path,
                workspace_file_id: candidate.id.clone(),
                sha256: candidate.sha256.clone(),
                byte_length: candidate.byte_length,
                mime_type: candidate.mime_type.clone(),
                duration_ms: entry.duration_ms,
                display_geometry: entry.geometry,
            });
        }
        Ok(bindings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::canonical_sha256;
    use serde_json::json;

    #[test]
    fn saved_browser_video_is_bound_to_the_current_file_hash() {
        let base = std::env::temp_dir().join(format!(
            "affect-runner-browser-binding-{}",
            uuid::Uuid::new_v4()
        ));
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let root = base.join("project");
        let video = root.join("assets/stimuli/clip.mp4");
        fs::create_dir_all(video.parent().unwrap()).unwrap();
        fs::write(&video, b"prepared-video").unwrap();
        let workspace_id = service.select(root).unwrap().workspace_id.unwrap();
        let scan = service.rescan_planner_videos(&workspace_id).unwrap();
        let item = &scan.stimuli[0];
        let mut catalogue = json!({
            "schema": "affect-research-video-catalogue-contribution",
            "version": 3,
            "revision": 1,
            "annotationPolicy": "relative-path-reversible-v1",
            "entries": [{
                "assetId": format!("asset-{}", item.sha256),
                "annotationId": "clip.mp4",
                "sourceRelativePath": "stimuli/clip.mp4",
                "packageRelativePath": "assets/stimuli/clip.mp4",
                "sha256": item.sha256,
                "byteLength": item.byte_length,
                "durationMs": 1000,
                "geometry": {
                    "status": "verified",
                    "source": "browser-decoder",
                    "displayWidthPx": 1920,
                    "displayHeightPx": 1080,
                    "displayAspect": {"numerator": 16, "denominator": 9},
                    "rotationDegrees": null,
                    "pixelAspectRatio": null,
                    "metadataInterpretation": "decoder-oriented-display"
                }
            }]
        });
        catalogue["integritySha256"] = canonical_sha256(&catalogue, &[]).unwrap().into();
        let bound = service
            .validate_runner_video_catalogue_v3(&workspace_id, &catalogue)
            .unwrap();
        assert_eq!(bound[0].sha256, item.sha256);

        fs::write(video, b"changed-video").unwrap();
        assert!(service
            .validate_runner_video_catalogue_v3(&workspace_id, &catalogue)
            .is_err());
    }
}

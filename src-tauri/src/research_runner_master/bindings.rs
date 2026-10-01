//! Retain the owner's complete versioned proof through playback preparation.
use super::PreparedMaster;
use crate::{
    research_error::{CommandError, ResearchResult},
    research_workspace::{
        NativeMediaGrant, RunnerVideoBinding, RunnerVideoBindingV3, WorkspaceService,
    },
};

pub(crate) enum MasterVideoBinding {
    Historical(RunnerVideoBinding),
    V3(RunnerVideoBindingV3),
}

pub(crate) fn bind_master_media(
    workspace: &WorkspaceService,
    workspace_id: &str,
    prepared: &PreparedMaster,
) -> ResearchResult<Vec<MasterVideoBinding>> {
    if uses_prepared_browser_playback(prepared)? {
        return Ok(Vec::new());
    }
    let catalogue = &prepared.loaded.recipe.segment("P1")?["videoCatalogue"];
    match if matches!(prepared.plan.version, 4 | 5) {
        if prepared.loaded.recipe.segment("P1")?["version"] == 3 {
            3
        } else {
            2
        }
    } else {
        prepared.plan.version
    } {
        1 | 2 => workspace
            .validate_runner_video_catalogue(workspace_id, catalogue)
            .map(|values| {
                values
                    .into_iter()
                    .map(MasterVideoBinding::Historical)
                    .collect()
            }),
        3 => workspace
            .validate_runner_video_catalogue_v3(workspace_id, catalogue)
            .map(|values| values.into_iter().map(MasterVideoBinding::V3).collect()),
        _ => Err(CommandError::invalid_contract(
            "Unsupported master media binding version.",
        )),
    }
}

pub(crate) fn uses_prepared_browser_playback(prepared: &PreparedMaster) -> ResearchResult<bool> {
    let catalogue = &prepared.loaded.recipe.segment("P1")?["videoCatalogue"];
    if catalogue["version"] != 4 {
        return Ok(false);
    }
    let entries = catalogue["entries"].as_array().ok_or_else(|| {
        CommandError::invalid_contract("Prepared browser playback requires a video catalogue.")
    })?;
    if entries.is_empty()
        || entries
            .iter()
            .any(|entry| !entry["preparedPlayback"].is_object())
    {
        return Err(CommandError::invalid_contract(
            "Prepared browser playback requires every video to carry preparedPlayback.",
        ));
    }
    Ok(true)
}

impl MasterVideoBinding {
    pub(crate) fn matches(&self, asset: &serde_json::Value) -> bool {
        let (id, path) = match self {
            Self::Historical(value) => (&value.asset_id, &value.source_relative_path),
            Self::V3(value) => (&value.asset_id, &value.source_relative_path),
        };
        asset["assetId"] == *id && asset["sourceRelativePath"] == *path
    }
    pub(crate) fn workspace_file_id(&self) -> &str {
        match self {
            Self::Historical(value) => &value.workspace_file_id,
            Self::V3(value) => &value.workspace_file_id,
        }
    }
    pub(crate) fn issue_grant(
        &self,
        workspace: &WorkspaceService,
        workspace_id: &str,
    ) -> ResearchResult<NativeMediaGrant> {
        let (id, hash, bytes, mime) = match self {
            Self::Historical(value) => (
                &value.workspace_file_id,
                &value.sha256,
                value.byte_length,
                &value.mime_type,
            ),
            Self::V3(value) => (
                &value.workspace_file_id,
                &value.sha256,
                value.byte_length,
                &value.mime_type,
            ),
        };
        workspace.issue_native_media_grant(workspace_id, id, hash, bytes, mime)
    }
}

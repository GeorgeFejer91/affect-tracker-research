//! Explicit P1 successor; historical readers and types remain closed.
use super::{
    invalid, validate_entry_identity, validate_geometry, validate_study, StudyIdentity,
    VideoCatalogueEntry, VideoDisplayGeometry, WorkspaceRelativeLayout, VIDEO_CATALOGUE_SCHEMA,
    VIDEO_LOCATION_ID_POLICY_V1, WORKSPACE_CONTRIBUTION_SCHEMA,
};
use crate::research_contracts::{canonical_sha256, MAX_SAFE_INTEGER, MAX_STIMULI};
use crate::research_error::ResearchResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub type VideoDisplayGeometryV3 = VideoDisplayGeometry;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoCatalogueContributionV3 {
    pub schema: String,
    pub version: u32,
    pub revision: u64,
    pub annotation_policy: String,
    pub entries: Vec<VideoCatalogueEntry<VideoDisplayGeometryV3>>,
    pub integrity_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceContributionV3 {
    pub schema: String,
    pub version: u32,
    pub study: StudyIdentity,
    pub workspace_layout: WorkspaceRelativeLayout,
    pub video_catalogue: VideoCatalogueContributionV3,
}
pub fn validate_video_catalogue_contribution_v3(
    value: &Value,
) -> ResearchResult<VideoCatalogueContributionV3> {
    let document: VideoCatalogueContributionV3 = serde_json::from_value(value.clone())
        .map_err(|_| invalid("Invalid catalogue v3 shape."))?;
    if document.schema != VIDEO_CATALOGUE_SCHEMA
        || document.version != 3
        || document.revision == 0
        || document.revision > MAX_SAFE_INTEGER
        || document.annotation_policy != VIDEO_LOCATION_ID_POLICY_V1
        || document.entries.is_empty()
        || document.entries.len() > MAX_STIMULI
    {
        return Err(invalid("Invalid catalogue v3 header."));
    }
    let mut locations = BTreeSet::new();
    let mut paths = BTreeSet::new();
    let mut content = BTreeMap::new();
    for (i, entry) in document.entries.iter().enumerate() {
        validate_entry_identity(entry, 3)?;
        validate_geometry(&entry.geometry)?;
        if !locations.insert(&entry.annotation_id) || !paths.insert(&entry.package_relative_path) {
            return Err(invalid("Duplicate catalogue v3 location."));
        }
        if i > 0 {
            let previous = &document.entries[i - 1];
            if previous
                .annotation_id
                .encode_utf16()
                .cmp(entry.annotation_id.encode_utf16())
                .then_with(|| previous.asset_id.cmp(&entry.asset_id))
                .is_gt()
            {
                return Err(invalid("Noncanonical catalogue v3 ordering."));
            }
        }
        let metadata = (
            &entry.sha256,
            entry.byte_length,
            entry.duration_ms,
            &entry.geometry,
        );
        if content
            .insert(&entry.asset_id, metadata)
            .is_some_and(|before| before != metadata)
        {
            return Err(invalid(
                "Shared content has conflicting geometry/provenance.",
            ));
        }
    }
    if canonical_sha256(&document, &["integritySha256"])? != document.integrity_sha256 {
        return Err(invalid("Catalogue v3 integrity mismatch."));
    }
    Ok(document)
}
pub fn validate_workspace_contribution_v3(
    value: &Value,
) -> ResearchResult<WorkspaceContributionV3> {
    let document: WorkspaceContributionV3 = serde_json::from_value(value.clone())
        .map_err(|_| invalid("Invalid workspace v3 shape."))?;
    if document.schema != WORKSPACE_CONTRIBUTION_SCHEMA
        || document.version != 3
        || document.workspace_layout.asset_root != "assets"
        || document.workspace_layout.video_library != "assets/stimuli"
        || document.workspace_layout.project_file != "experiment.package.json"
    {
        return Err(invalid("Invalid workspace v3 header/layout."));
    }
    validate_study(&document.study)?;
    validate_video_catalogue_contribution_v3(&value["videoCatalogue"])?;
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::canonical_json;
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../test/fixtures/controlled-video-geometry-v3.json"
        ))
        .unwrap()
    }
    #[test]
    fn shared_js_workspace_and_sequence_remain_canonical() {
        let f = fixture();
        let workspace = validate_workspace_contribution_v3(&f["workspace"]).unwrap();
        assert_eq!(
            canonical_json(&workspace, &[]).unwrap(),
            canonical_json(&f["workspace"], &[]).unwrap()
        );
        assert!(super::super::validate_workspace_contribution(&f["workspace"]).is_err());
        assert!(super::super::validate_video_catalogue_contribution(
            &f["workspace"]["videoCatalogue"]
        )
        .is_err());
        let reproduced =
            crate::research_stimulus_order::reproduction::validate_and_reproduce_saved_variants_v3(
                &workspace,
                &f["contribution"],
                &"f".repeat(64),
            )
            .unwrap();
        assert_eq!(reproduced, f["reproduction"]);
    }
    #[test]
    fn invalid_browser_geometry_never_passes_with_rehashed_catalogue() {
        for mode in 0..6 {
            let mut value = fixture()["workspace"]["videoCatalogue"].clone();
            let geometry = &mut value["entries"][0]["geometry"];
            match mode {
                0 => geometry["source"] = "unknown".into(),
                1 => geometry["rotationDegrees"] = 90.into(),
                2 => {
                    geometry["pixelAspectRatio"] =
                        serde_json::json!({"numerator":1,"denominator":1})
                }
                3 => geometry["displayWidthPx"] = 0.into(),
                4 => value["version"] = 2.into(),
                _ => value["entries"][0]["annotationId"] = "wrong".into(),
            }
            value["integritySha256"] = canonical_sha256(&value, &["integritySha256"])
                .unwrap()
                .into();
            assert!(
                validate_video_catalogue_contribution_v3(&value).is_err(),
                "case {mode}"
            );
        }
    }
}

//! Additive controlled-native proof cache and exact catalogue-v3 live binding.
use super::*;
use crate::research_native_media::NativeMediaDecodeReceiptV2;
use crate::research_video_geometry::{derive_native_display_geometry_v2, NativeDisplayGeometryV2};
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::canonical_sha256;
    use crate::research_video_geometry::SourceOrientationTagV2;

    fn rehash(value: &mut serde_json::Value) {
        value.as_object_mut().unwrap().remove("integritySha256");
        value["integritySha256"] = canonical_sha256(value, &[]).unwrap().into();
    }

    #[test]
    fn controlled_catalogue_binds_full_proof_and_rejects_changed_content_or_cache() {
        let base = std::env::temp_dir().join(format!("affect-p1-controlled-{}", Uuid::new_v4()));
        let service = WorkspaceService::new(base.join("app-data")).unwrap();
        let root = base.join("workspace");
        fs::create_dir_all(&root).unwrap();
        let workspace_id = service.select(root.clone()).unwrap().workspace_id.unwrap();
        let path = root.join("assets/stimuli/clip.mp4");
        fs::write(&path, b"controlled-proof-test-video").unwrap();
        let scan = service.rescan_planner_videos(&workspace_id).unwrap();
        let item = &scan.stimuli[0];
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/controlled-video-geometry-v3.json"
        ))
        .unwrap();
        let receipt = NativeMediaDecodeReceiptV2 {
            schema: "affect-research-native-media-decode-receipt",
            version: 2,
            session_id: Uuid::new_v4().to_string(),
            generation: 1,
            media_grant_id: Uuid::new_v4().to_string(),
            workspace_file_id: item.workspace_file_id.clone(),
            duration_ms: 1000.25,
            video_width: 1920,
            video_height: 1080,
            audio_stream_count: 1,
            decoded_snapshot_count: 3,
            decoded_positions_ms: vec![100.0, 500.0, 900.0],
            display_metadata: serde_json::from_value(
                fixture["workspace"]["videoCatalogue"]["entries"][0]["geometry"]
                    ["nativeDisplayMetadata"]
                    .clone(),
            )
            .unwrap(),
        };
        let mut receipt = receipt;
        receipt.video_width = receipt.display_metadata.encoded_width_px;
        receipt.video_height = receipt.display_metadata.encoded_height_px;
        let summary = service
            .attest_native_decode_v2(
                &workspace_id,
                &item.sha256,
                item.byte_length,
                &item.mime_type,
                &receipt,
            )
            .unwrap();
        assert_eq!(
            summary.decode_attestation,
            Some(DecodeEvidence::NativeDecodedSnapshotsV2)
        );
        assert!(summary.source.is_some());
        let mut catalogue = serde_json::json!({
            "schema": "affect-research-video-catalogue-contribution", "version": 3,
            "revision": 1, "annotationPolicy": "relative-path-reversible-v1",
            "entries": [{ "assetId": format!("asset-{}", item.sha256), "annotationId": "clip.mp4",
                "sourceRelativePath": "stimuli/clip.mp4", "packageRelativePath": "assets/stimuli/clip.mp4",
                "sha256": item.sha256, "byteLength": item.byte_length, "durationMs": 1000,
                "geometry": summary.display_geometry }]
        });
        rehash(&mut catalogue);
        let binding = service
            .validate_runner_video_catalogue_v3(&workspace_id, &catalogue)
            .unwrap();
        assert_eq!(binding[0].workspace_file_id, item.workspace_file_id);
        assert!(matches!(
            binding[0].display_geometry,
            VideoDisplayGeometryV3::Controlled(_)
        ));
        assert!(service
            .validate_runner_video_catalogue(&workspace_id, &catalogue)
            .is_err());

        let mut provenance_change = receipt.display_metadata.clone();
        provenance_change.source_orientation.stream = SourceOrientationTagV2::Explicit {
            rotation_degrees: 0,
        };
        provenance_change.source_orientation.media = SourceOrientationTagV2::Explicit {
            rotation_degrees: 0,
        };
        let altered = derive_native_display_geometry_v2(&provenance_change).unwrap();
        let mut different = catalogue.clone();
        different["entries"][0]["geometry"] = serde_json::to_value(altered).unwrap();
        rehash(&mut different);
        assert!(service
            .validate_runner_video_catalogue_v3(&workspace_id, &different)
            .is_err());

        let mut invalid_receipt = receipt.clone();
        invalid_receipt.generation = 0;
        assert!(service
            .attest_native_decode_v2(
                &workspace_id,
                &item.sha256,
                item.byte_length,
                &item.mime_type,
                &invalid_receipt
            )
            .is_err());
        invalid_receipt = receipt.clone();
        invalid_receipt.workspace_file_id = "wrong-file".to_owned();
        assert!(service
            .attest_native_decode_v2(
                &workspace_id,
                &item.sha256,
                item.byte_length,
                &item.mime_type,
                &invalid_receipt
            )
            .is_err());
        {
            let mut guard = service.lock_selected();
            let cached = guard.as_mut().unwrap().scanned[0]
                .native_decode_receipt_v2
                .as_mut()
                .unwrap();
            cached.display_metadata.renderer.readback_rotation_degrees = 90;
        }
        assert!(service
            .validate_runner_video_catalogue_v3(&workspace_id, &catalogue)
            .is_err());
        service
            .attest_native_decode_v2(
                &workspace_id,
                &item.sha256,
                item.byte_length,
                &item.mime_type,
                &receipt,
            )
            .unwrap();
        fs::write(&path, b"changed-video-content").unwrap();
        assert!(service
            .validate_runner_video_catalogue_v3(&workspace_id, &catalogue)
            .is_err());
        service.rescan_planner_videos(&workspace_id).unwrap();
        assert!(service
            .validate_runner_video_catalogue_v3(&workspace_id, &catalogue)
            .is_err());
        drop(service);
        fs::remove_dir_all(base).unwrap();
    }
}

fn validate_receipt(
    receipt: &NativeMediaDecodeReceiptV2,
) -> ResearchResult<NativeDisplayGeometryV2> {
    if receipt.schema != "affect-research-native-media-decode-receipt"
        || receipt.version != 2
        || receipt.generation == 0
        || [&receipt.session_id, &receipt.media_grant_id]
            .iter()
            .any(|id| Uuid::parse_str(id).map_or(true, |value| value.to_string() != **id))
        || receipt.decoded_snapshot_count != 3
        || receipt.decoded_positions_ms.len() != 3
        || receipt.video_width != receipt.display_metadata.encoded_width_px
        || receipt.video_height != receipt.display_metadata.encoded_height_px
    {
        return Err(CommandError::invalid_contract(
            "Native controlled decode receipt is incomplete.",
        ));
    }
    validate_native_positions(receipt.duration_ms, &receipt.decoded_positions_ms)?;
    derive_native_display_geometry_v2(&receipt.display_metadata)
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

    pub(crate) fn attest_native_decode_v2(
        &self,
        workspace_id: &str,
        expected_sha256: &str,
        expected_byte_length: u64,
        expected_mime_type: &str,
        receipt: &NativeMediaDecodeReceiptV2,
    ) -> ResearchResult<ScannedStimulusSummary<NativeDisplayGeometryV2>> {
        let geometry = validate_receipt(receipt)?;
        let mut guard = self.lock_selected();
        let workspace = selected_mut(&mut guard, workspace_id)?;
        validate_selected_workspace(workspace)?;
        let candidate = workspace
            .scanned
            .iter_mut()
            .find(|entry| {
                entry.id == receipt.workspace_file_id
                    && entry.sha256 == expected_sha256
                    && entry.byte_length == expected_byte_length
                    && entry.mime_type == expected_mime_type
            })
            .ok_or_else(|| {
                CommandError::forbidden(
                    "Native controlled evidence does not match the latest workspace scan.",
                )
            })?;
        let (hash, bytes) = hash_file(&candidate.path)?;
        if hash != expected_sha256 || bytes != expected_byte_length {
            return Err(CommandError::forbidden(
                "The workspace stimulus changed during native decode preflight.",
            ));
        }
        candidate.duration_ms = Some(receipt.duration_ms.round());
        candidate.decode_status = DecodeStatus::AttestedQualified;
        candidate.decode_backend = Some(DecodeBackend::NativeGstPlay);
        candidate.decode_attestation = Some(DecodeEvidence::NativeDecodedSnapshotsV2);
        candidate.decoded_positions_ms = receipt.decoded_positions_ms.clone();
        candidate.display_geometry = None;
        candidate.native_decode_receipt_v2 = Some(receipt.clone());
        let old = scanned_summary(candidate);
        Ok(ScannedStimulusSummary {
            workspace_file_id: old.workspace_file_id,
            display_name: old.display_name,
            sha256: old.sha256,
            byte_length: old.byte_length,
            mime_type: old.mime_type,
            duration_ms: old.duration_ms,
            decode_status: old.decode_status,
            decode_backend: old.decode_backend,
            decode_attestation: old.decode_attestation,
            decoded_positions_ms: old.decoded_positions_ms,
            display_geometry: Some(geometry),
            source: Some(WorkspaceSourceContract {
                kind: "workspaceFile",
                relative_path: candidate.logical_relative_path.clone(),
                mime_type: candidate.mime_type.clone(),
                sha256: candidate.sha256.clone(),
                byte_length: candidate.byte_length,
                duration_ms: receipt.duration_ms.round(),
            }),
        })
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
                .filter(|v| v.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let [candidate] = stored.as_slice() else {
                return Err(CommandError::forbidden(
                    "Catalogue location is not uniquely bound to a qualified video.",
                ));
            };
            let observed = current
                .iter()
                .filter(|v| v.logical_relative_path == entry.source_relative_path)
                .collect::<Vec<_>>();
            let [observed] = observed.as_slice() else {
                return Err(CommandError::forbidden(
                    "Catalogue location is not uniquely bound to a current video.",
                ));
            };
            let native_geometry = match &entry.geometry {
                VideoDisplayGeometryV3::Controlled(_) => {
                    let receipt = candidate.native_decode_receipt_v2.as_ref().ok_or_else(|| {
                        CommandError::forbidden("Video lacks fresh controlled native proof.")
                    })?;
                    if candidate.decode_attestation
                        != Some(DecodeEvidence::NativeDecodedSnapshotsV2)
                        || receipt.workspace_file_id != candidate.id
                        || candidate.duration_ms != Some(receipt.duration_ms.round())
                        || candidate.decoded_positions_ms != receipt.decoded_positions_ms
                    {
                        return Err(CommandError::forbidden(
                            "Controlled native proof cache is inconsistent.",
                        ));
                    }
                    VideoDisplayGeometryV3::Controlled(validate_receipt(receipt)?)
                }
                VideoDisplayGeometryV3::Historical(_) => {
                    if candidate.decode_attestation
                        != Some(DecodeEvidence::NativeDecodedSnapshotsV1)
                    {
                        return Err(CommandError::forbidden(
                            "Historical geometry has no exact historical native proof.",
                        ));
                    }
                    let geometry = candidate.display_geometry.as_ref().ok_or_else(|| {
                        CommandError::forbidden("Historical native geometry is missing.")
                    })?;
                    VideoDisplayGeometryV3::Historical(
                        serde_json::from_value(serde_json::to_value(geometry).map_err(|_| {
                            CommandError::invalid_contract("Invalid historical geometry.")
                        })?)
                        .map_err(|_| {
                            CommandError::invalid_contract("Invalid historical geometry.")
                        })?,
                    )
                }
            };
            if candidate.decode_status != DecodeStatus::AttestedQualified
                || candidate.decode_backend != Some(DecodeBackend::NativeGstPlay)
                || observed.id != candidate.id
                || observed.path != candidate.path
                || observed.sha256 != candidate.sha256
                || observed.byte_length != candidate.byte_length
                || observed.mime_type != candidate.mime_type
                || entry.asset_id != format!("asset-{}", observed.sha256)
                || entry.sha256 != observed.sha256
                || entry.byte_length != observed.byte_length
                || candidate.duration_ms != Some(entry.duration_ms as f64)
                || validate_native_positions(
                    entry.duration_ms as f64,
                    &candidate.decoded_positions_ms,
                )
                .is_err()
                || entry.geometry != native_geometry
            {
                return Err(CommandError::forbidden(
                    "Current native video does not exactly match the saved catalogue proof.",
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
                display_geometry: native_geometry,
            });
        }
        Ok(bindings)
    }
}

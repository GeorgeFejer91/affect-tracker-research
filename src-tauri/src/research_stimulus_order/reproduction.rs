//! Pure P3 projections for complete Planner recipe reproduction; no Runner IO.
use super::{
    digest, invalid,
    location_variants::{LocationLibrary, LocationVideo, VariantDesignV2},
    variants::VariantDesign,
    VideoIdentity, VideoLibrary,
};
use crate::research_contracts::MAX_SAFE_INTEGER;
use crate::research_error::ResearchResult;
use crate::research_workspace_contribution::{
    validate_video_catalogue_contribution, VideoCatalogueContribution,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn validated_videos(
    contribution: &Value,
    catalogue: &VideoCatalogueContribution,
) -> ResearchResult<Vec<LocationVideo>> {
    validate_video_catalogue_contribution(
        &serde_json::to_value(catalogue).map_err(|_| invalid("Cannot encode catalogue."))?,
    )?;
    match contribution["version"].as_u64() {
        Some(2) if catalogue.version == 2 => {
            let design: VariantDesignV2 = serde_json::from_value(contribution.clone())
                .map_err(|_| invalid("Invalid P3 version 2 contribution."))?;
            design.validate(catalogue)?;
            Ok(LocationLibrary::from_catalogue(catalogue)?.videos)
        }
        Some(1) if catalogue.version == 1 => {
            let library = VideoLibrary::create(
                catalogue
                    .entries
                    .iter()
                    .map(|entry| VideoIdentity {
                        relative_path: entry.package_relative_path.clone(),
                        sha256: entry.sha256.clone(),
                        byte_length: entry.byte_length,
                    })
                    .collect(),
            )?;
            let design: VariantDesign = serde_json::from_value(contribution.clone())
                .map_err(|_| invalid("Invalid P3 version 1 contribution."))?;
            design.validate(&library)?;
            library
                .videos
                .into_iter()
                .map(|video| {
                    let source = catalogue
                        .entries
                        .iter()
                        .find(|entry| entry.package_relative_path == video.relative_path)
                        .ok_or_else(|| invalid("Missing catalogue metadata."))?;
                    Ok(LocationVideo {
                        annotation_id: video.annotation_id,
                        asset_id: source.asset_id.clone(),
                        relative_path: video.relative_path,
                        sha256: video.sha256,
                        byte_length: video.byte_length,
                        duration_ms: source.duration_ms,
                    })
                })
                .collect()
        }
        _ => Err(invalid("P3 and P1 reference versions do not match.")),
    }
}
pub fn validate_variant_contribution(
    contribution: &Value,
    catalogue: &VideoCatalogueContribution,
) -> ResearchResult<()> {
    validated_videos(contribution, catalogue).map(|_| ())
}
pub fn validate_and_reproduce_saved_variants(
    workspace: &crate::research_workspace_contribution::WorkspaceContribution,
    contribution: &Value,
    definition_sha256: &str,
) -> ResearchResult<Value> {
    crate::research_workspace_contribution::validate_workspace_contribution(
        &serde_json::to_value(workspace).map_err(|_| invalid("Cannot encode workspace."))?,
    )?;
    validate_variant_contribution(contribution, &workspace.video_catalogue)?;
    let variants = contribution["variants"].as_array().ok_or_else(|| invalid("Missing variant array."))?
        .iter().map(|variant| {
            let variant_id = variant["variantId"].as_str().ok_or_else(|| invalid("Missing variant identity."))?;
            let projection = reconstruct_variant(contribution, variant_id, &workspace.video_catalogue, definition_sha256)?;
            Ok(json!({"variantId":variant_id,"versionSha256":variant["versionSha256"],"timeline":projection["timeline"],"markerProfile":projection["profile"]}))
        }).collect::<ResearchResult<Vec<_>>>()?;
    Ok(json!({"variants":variants}))
}
/// Returns exactly the JS owner's `{timeline,profile}` projection for one variant.
pub fn reconstruct_variant(
    contribution: &Value,
    variant_id: &str,
    catalogue: &VideoCatalogueContribution,
    recipe_sha256: &str,
) -> ResearchResult<Value> {
    let videos = validated_videos(contribution, catalogue)?;
    if recipe_sha256.len() != 64
        || !recipe_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(
            "A marker profile requires the complete recipe SHA-256.",
        ));
    }
    let variant = contribution["variants"]
        .as_array()
        .and_then(|variants| {
            variants
                .iter()
                .find(|variant| variant["variantId"] == variant_id)
        })
        .ok_or_else(|| invalid("Unknown variant."))?;
    let entries = variant["entries"]
        .as_array()
        .ok_or_else(|| invalid("Missing variant entries."))?;
    let mut elapsed = 0u64;
    let mut events = Vec::new();
    let mut profile_entries = Vec::new();
    let mut codebook = Vec::new();
    let mut codes = BTreeMap::new();
    for (position, entry) in entries.iter().enumerate() {
        let reference = entry["referenceId"]
            .as_str()
            .ok_or_else(|| invalid("Missing entry reference."))?;
        let entry_id = entry["entryId"]
            .as_str()
            .ok_or_else(|| invalid("Missing occurrence ID."))?;
        let kind = entry["kind"]
            .as_str()
            .ok_or_else(|| invalid("Missing entry kind."))?;
        let (duration, identity) = if kind == "video" {
            let source = videos
                .iter()
                .find(|video| video.annotation_id == reference)
                .ok_or_else(|| invalid("Missing video source."))?;
            let identity = if contribution["version"] == 2 {
                digest(
                    &json!({"annotationId":source.annotation_id,"assetId":source.asset_id}),
                    &[],
                )?
            } else {
                source.sha256.clone()
            };
            (source.duration_ms, identity)
        } else {
            let source = contribution["isiDefinitions"]
                .as_array()
                .and_then(|definitions| definitions.iter().find(|isi| isi["isiId"] == reference))
                .ok_or_else(|| invalid("Missing ISI source."))?;
            (
                source["durationMs"]
                    .as_u64()
                    .ok_or_else(|| invalid("Invalid ISI duration."))?,
                digest(source, &[])?,
            )
        };
        let end = elapsed
            .checked_add(duration)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid("Planned duration exceeds safe integer bounds."))?;
        for (boundary, offset) in [("start", elapsed), ("end", end)] {
            events.push(json!({"variantId":variant_id,"entryId":entry_id,"kind":kind,"referenceId":reference,"position":position+1,
                "eventId":format!("{entry_id}-{boundary}"),"eventType":format!("{kind}{}",if boundary=="start" {"Start"}else{"End"}),"plannedOffsetMs":offset}));
        }
        elapsed = end;
        let key = format!("{kind}:{reference}");
        let source_code = codes.entry(key).or_insert_with(|| {
            let code = format!("source-{}", codebook.len()+1);
            codebook.push(json!({"sourceCode":code,"kind":kind,"identitySha256":identity,"durationMs":duration})); code
        });
        profile_entries.push(json!({"entryId":entry_id,"sourceCode":source_code}));
    }
    Ok(
        json!({"timeline":{"variantId":variant_id,"versionSha256":variant["versionSha256"],"plannedDurationMs":elapsed,"events":events},
        "profile":{"recipeSha256":recipe_sha256,"variantId":variant_id,"variantVersionSha256":variant["versionSha256"],"entries":profile_entries,"codebook":codebook}}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    #[test]
    fn both_reference_versions_reproduce_js_timelines_profiles_and_export_bytes() {
        for (input, expected) in [
            (
                include_str!("../../../test/fixtures/variant-reproduction-v1.json"),
                include_str!("../../../test/fixtures/variant-native-reproduction-v1.json"),
            ),
            (
                include_str!("../../../test/fixtures/variant-reproduction-v2.json"),
                include_str!("../../../test/fixtures/variant-native-reproduction-v2.json"),
            ),
        ] {
            let fixture: Value = serde_json::from_str(input).unwrap();
            let golden: Value = serde_json::from_str(expected).unwrap();
            let catalogue =
                validate_video_catalogue_contribution(&fixture["workspace"]["videoCatalogue"])
                    .unwrap();
            let workspace =
                crate::research_workspace_contribution::validate_workspace_contribution(
                    &fixture["workspace"],
                )
                .unwrap();
            let complete = validate_and_reproduce_saved_variants(
                &workspace,
                &fixture["contribution"],
                &"f".repeat(64),
            )
            .unwrap();
            let expected_variants: Vec<Value> = golden["projections"].as_array().unwrap().iter().map(|projection| json!({
                "variantId":projection["timeline"]["variantId"],"versionSha256":projection["timeline"]["versionSha256"],
                "timeline":projection["timeline"],"markerProfile":projection["profile"]
            })).collect();
            assert_eq!(complete, json!({"variants":expected_variants}));
            assert!(validate_and_reproduce_saved_variants(
                &workspace,
                &fixture["contribution"],
                "not-a-hash"
            )
            .is_err());
            for projection in golden["projections"].as_array().unwrap() {
                let variant_id = projection["timeline"]["variantId"].as_str().unwrap();
                assert_eq!(
                    reconstruct_variant(
                        &fixture["contribution"],
                        variant_id,
                        &catalogue,
                        &"f".repeat(64)
                    )
                    .unwrap(),
                    *projection
                );
            }
            if catalogue.version == 2 {
                for (format, key) in [
                    (super::super::export::LibraryFormat::Csv, "csvSha256"),
                    (super::super::export::LibraryFormat::Xlsx, "xlsxSha256"),
                ] {
                    let bytes = super::super::export::catalogue_bytes(
                        &catalogue,
                        fixture["contribution"]["librarySha256"].as_str().unwrap(),
                        format,
                    )
                    .unwrap();
                    assert_eq!(format!("{:x}", Sha256::digest(bytes)), golden[key]);
                    assert!(super::super::export::catalogue_bytes(
                        &catalogue,
                        &"e".repeat(64),
                        format
                    )
                    .is_err());
                }
            }
        }
    }
}

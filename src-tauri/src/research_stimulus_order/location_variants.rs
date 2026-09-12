//! P3 v2 location/content references. Historical v1 types remain closed.
use super::variants::{marker_contract, numbered, IsiDefinition, VariantDraft};
use super::{digest, invalid, VariantColumn};
use crate::research_error::ResearchResult;
use crate::research_workspace_contribution::{
    validate_video_catalogue_contribution, VideoCatalogueContribution,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocationVideo {
    pub annotation_id: String,
    pub asset_id: String,
    pub relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocationLibrary {
    pub schema: String,
    pub version: u8,
    pub videos: Vec<LocationVideo>,
    pub integrity_sha256: String,
}
impl LocationLibrary {
    pub fn from_catalogue(catalogue: &VideoCatalogueContribution) -> ResearchResult<Self> {
        let value = serde_json::to_value(catalogue)
            .map_err(|_| invalid("Cannot encode video catalogue."))?;
        let source = validate_video_catalogue_contribution(&value)?;
        if source.version != 2 {
            return Err(invalid("Location references require catalogue version 2."));
        }
        let mut library = Self {
            schema: "affect-research-video-library".into(),
            version: 2,
            videos: source
                .entries
                .into_iter()
                .map(|entry| LocationVideo {
                    annotation_id: entry.annotation_id,
                    asset_id: entry.asset_id,
                    relative_path: entry.package_relative_path,
                    sha256: entry.sha256,
                    byte_length: entry.byte_length,
                    duration_ms: entry.duration_ms,
                })
                .collect(),
            integrity_sha256: String::new(),
        };
        library.integrity_sha256 = digest(&library, &["integritySha256"])?;
        Ok(library)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LocationEntry {
    Video {
        entry_id: String,
        reference_id: String,
        asset_id: String,
    },
    Isi {
        entry_id: String,
        reference_id: String,
    },
}
impl LocationEntry {
    fn entry_id(&self) -> &str {
        match self {
            Self::Video { entry_id, .. } | Self::Isi { entry_id, .. } => entry_id,
        }
    }
    fn reference_id(&self) -> &str {
        match self {
            Self::Video { reference_id, .. } | Self::Isi { reference_id, .. } => reference_id,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocationVariant {
    pub variant_id: String,
    pub title: String,
    pub entries: Vec<LocationEntry>,
    pub version_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantDesignV2 {
    pub schema: String,
    pub version: u8,
    pub library_sha256: String,
    pub isi_definitions: Vec<IsiDefinition>,
    pub variants: Vec<LocationVariant>,
    pub allocation: Value,
    pub marker_contract: Value,
    pub integrity_sha256: String,
}
impl VariantDesignV2 {
    pub fn create(
        draft: &VariantDraft,
        catalogue: &VideoCatalogueContribution,
    ) -> ResearchResult<Self> {
        draft.validate_cell_bytes(6144)?;
        let library = LocationLibrary::from_catalogue(catalogue)?;
        if draft.isi_definitions.iter().any(|isi| {
            library
                .videos
                .iter()
                .any(|video| video.annotation_id == isi.isi_id)
        }) {
            return Err(invalid("Video and ISI identities collide."));
        }
        let mut variants = Vec::new();
        for (c, column) in draft.columns.iter().enumerate() {
            let last = draft
                .rows
                .iter()
                .rposition(|row| !row[c].is_empty())
                .ok_or_else(|| invalid("Every variant needs at least one video."))?;
            let mut entries = Vec::new();
            let mut identities = Vec::new();
            let mut has_video = false;
            for (r, row) in draft.rows[..=last].iter().enumerate() {
                let reference_id = row[c].clone();
                let entry_id = draft.entry_ids[r][c].clone();
                if let Some(video) = library
                    .videos
                    .iter()
                    .find(|video| video.annotation_id == reference_id)
                {
                    entries.push(LocationEntry::Video {
                        entry_id,
                        reference_id,
                        asset_id: video.asset_id.clone(),
                    });
                    identities.push(
                        serde_json::to_value(video)
                            .map_err(|_| invalid("Cannot encode video identity."))?,
                    );
                    has_video = true;
                } else if let Some(isi) = draft
                    .isi_definitions
                    .iter()
                    .find(|isi| isi.isi_id == reference_id)
                {
                    entries.push(LocationEntry::Isi {
                        entry_id,
                        reference_id,
                    });
                    identities.push(
                        serde_json::to_value(isi)
                            .map_err(|_| invalid("Cannot encode ISI identity."))?,
                    );
                } else {
                    return Err(invalid(
                        "Use exact video annotations or named ISIs without interior blanks.",
                    ));
                }
            }
            if !has_video {
                return Err(invalid("Every variant needs at least one video."));
            }
            let version_sha256 = digest(
                &json!({"variantId":column.variant_id,"title":column.title,"entries":entries,"identities":identities}),
                &[],
            )?;
            variants.push(LocationVariant {
                variant_id: column.variant_id.clone(),
                title: column.title.clone(),
                entries,
                version_sha256,
            });
        }
        let mut marker_contract = marker_contract();
        marker_contract["version"] = json!(2);
        marker_contract["sourceIdentity"] = json!("video-location-content-pair-sha256-v1");
        let mut value = Self {
            schema: "affect-research-variant-design".into(),
            version: 2,
            library_sha256: library.integrity_sha256,
            isi_definitions: draft.isi_definitions.clone(),
            variants,
            allocation: json!({"kind":"runnerAssigned"}),
            marker_contract,
            integrity_sha256: String::new(),
        };
        value.integrity_sha256 = digest(&value, &["integritySha256"])?;
        Ok(value)
    }
    pub fn validate(&self, catalogue: &VideoCatalogueContribution) -> ResearchResult<()> {
        if self.variants.is_empty()
            || self.variants.len() > 64
            || self.isi_definitions.len() > 1024
            || self
                .variants
                .iter()
                .any(|variant| variant.entries.is_empty() || variant.entries.len() > 1024)
        {
            return Err(invalid("Invalid location variant arrays."));
        }
        let height = self
            .variants
            .iter()
            .map(|variant| variant.entries.len())
            .max()
            .unwrap_or(0);
        if height * self.variants.len() > 32000 {
            return Err(invalid("Variant table exceeds cell bounds."));
        }
        let used_ids = self
            .variants
            .iter()
            .map(|variant| {
                let prefix = format!("{}-entry-", variant.variant_id);
                variant
                    .entries
                    .iter()
                    .map(|entry| {
                        numbered(entry.entry_id(), &prefix)
                            .ok_or_else(|| invalid("Invalid occurrence identity."))
                    })
                    .collect::<ResearchResult<BTreeSet<_>>>()
            })
            .collect::<ResearchResult<Vec<_>>>()?;
        let mut next_ids = vec![1; self.variants.len()];
        let mut rows = Vec::new();
        let mut entry_ids = Vec::new();
        for r in 0..height {
            rows.push(
                self.variants
                    .iter()
                    .map(|variant| {
                        variant
                            .entries
                            .get(r)
                            .map_or(String::new(), |entry| entry.reference_id().into())
                    })
                    .collect(),
            );
            entry_ids.push(
                self.variants
                    .iter()
                    .enumerate()
                    .map(|(c, variant)| {
                        variant.entries.get(r).map_or_else(
                            || {
                                while used_ids[c].contains(&next_ids[c]) {
                                    next_ids[c] += 1;
                                }
                                let id = format!("{}-entry-{}", variant.variant_id, next_ids[c]);
                                next_ids[c] += 1;
                                id
                            },
                            |entry| entry.entry_id().into(),
                        )
                    })
                    .collect(),
            );
        }
        let next_isi_ordinal = self
            .isi_definitions
            .iter()
            .map(|isi| numbered(&isi.isi_id, "ISI").ok_or_else(|| invalid("Invalid ISI identity.")))
            .collect::<ResearchResult<Vec<_>>>()?
            .into_iter()
            .max()
            .unwrap_or(0)
            + 1;
        let draft = VariantDraft {
            columns: self
                .variants
                .iter()
                .map(|variant| VariantColumn {
                    variant_id: variant.variant_id.clone(),
                    title: variant.title.clone(),
                })
                .collect(),
            rows,
            entry_ids,
            isi_definitions: self.isi_definitions.clone(),
            next_isi_ordinal,
        };
        if Self::create(&draft, catalogue)? != *self {
            return Err(invalid(
                "Variant location/content pairs or integrity do not match.",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_location_fixture_matches_javascript_and_rejects_wrong_pairs() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../test/fixtures/variant-reproduction-v2.json"
        ))
        .unwrap();
        let catalogue =
            validate_video_catalogue_contribution(&fixture["workspace"]["videoCatalogue"]).unwrap();
        let draft: VariantDraft = serde_json::from_value(fixture["draft"].clone()).unwrap();
        let design: VariantDesignV2 =
            serde_json::from_value(fixture["contribution"].clone()).unwrap();
        assert_eq!(VariantDesignV2::create(&draft, &catalogue).unwrap(), design);
        design.validate(&catalogue).unwrap();
        let mut high_ordinal = draft.clone();
        high_ordinal.entry_ids[0][2] = "variant-2-entry-999999".into();
        VariantDesignV2::create(&high_ordinal, &catalogue)
            .unwrap()
            .validate(&catalogue)
            .unwrap();
        let mut wrong = design.clone();
        if let LocationEntry::Video { asset_id, .. } = &mut wrong.variants[0].entries[2] {
            *asset_id = format!("asset-{}", "e".repeat(64));
        }
        assert!(wrong.validate(&catalogue).is_err());
        for mutate in [
            "missing-asset",
            "isi-asset",
            "version",
            "allocation",
            "occurrence",
            "kind",
        ] {
            let mut value = fixture["contribution"].clone();
            match mutate {
                "missing-asset" => {
                    value["variants"][0]["entries"][2]
                        .as_object_mut()
                        .unwrap()
                        .remove("assetId");
                }
                "isi-asset" => value["variants"][0]["entries"][0]["assetId"] = json!("asset-wrong"),
                "version" => value["version"] = json!(1),
                "allocation" => value["allocation"] = json!({"kind":"cyclicByOrdinal"}),
                "occurrence" => {
                    value["variants"][0]["entries"][3]["entryId"] =
                        value["variants"][0]["entries"][2]["entryId"].clone()
                }
                _ => value["variants"][0]["entries"][2]["kind"] = json!("isi"),
            }
            assert!(
                serde_json::from_value::<VariantDesignV2>(value)
                    .map_or(true, |invalid| invalid.validate(&catalogue).is_err()),
                "{mutate}"
            );
        }
        assert!(
            serde_json::from_value::<super::super::variants::VariantDesign>(
                fixture["contribution"].clone()
            )
            .is_err()
        );
    }
}

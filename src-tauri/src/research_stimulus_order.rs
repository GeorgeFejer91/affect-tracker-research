//! Setup authoring documents; never participant allocation or Run authority.
use crate::research_contracts::{canonical_json, MAX_SAFE_INTEGER};
use crate::research_error::{CommandError, ResearchResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub mod export;
pub mod variants;
pub const LIBRARY_FILE: &str = "video-library.annotations.json";
pub const ORDER_FILE: &str = "stimulus-order.design.json";
pub const MAX_DOCUMENT_BYTES: u64 = 5 * 1024 * 1024;

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}
pub fn digest<T: Serialize>(value: &T, omitted: &[&str]) -> ResearchResult<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(canonical_json(value, omitted)?)
    ))
}
pub fn document_bytes<T: Serialize>(value: &T) -> ResearchResult<Vec<u8>> {
    let mut bytes = canonical_json(value, &[])?;
    bytes.push(b'\n');
    Ok(bytes)
}
fn safe_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && !value.chars().any(|c| {
            c.is_control()
                || matches!(c,
        '\u{00ad}' | '\u{0600}'..='\u{0605}' | '\u{061c}' | '\u{06dd}' | '\u{070f}' |
        '\u{0890}'..='\u{0891}' | '\u{08e2}' | '\u{180e}' | '\u{200b}'..='\u{200f}' |
        '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206f}' |
        '\u{feff}' | '\u{fff9}'..='\u{fffb}' | '\u{110bd}' | '\u{110cd}' |
        '\u{13430}'..='\u{1343f}' | '\u{1bca0}'..='\u{1bca3}' | '\u{1d173}'..='\u{1d17a}' |
        '\u{e0001}' | '\u{e0020}'..='\u{e007f}')
        })
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoIdentity {
    pub relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoAnnotation {
    pub annotation_id: String,
    pub relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoLibrary {
    pub schema: String,
    pub version: u8,
    pub videos: Vec<VideoAnnotation>,
    pub integrity_sha256: String,
}
impl VideoLibrary {
    pub fn create(mut entries: Vec<VideoIdentity>) -> ResearchResult<Self> {
        if entries.len() > 10000 {
            return Err(invalid("Video library exceeds 10000 videos."));
        }
        entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        let mut ids = BTreeSet::new();
        let mut paths = BTreeSet::new();
        let mut videos = Vec::new();
        for entry in entries {
            if !safe_text(&entry.relative_path, 2048)
                || !entry.relative_path.starts_with("assets/stimuli/")
                || entry.relative_path.split('/').count() > 18
                || entry.relative_path.split('/').any(|s| {
                    s.is_empty()
                        || s == "."
                        || s == ".."
                        || s.ends_with(['.', ' '])
                        || s.contains(['<', '>', ':', '"', '\\', '|', '?', '*'])
                })
                || entry.sha256.len() != 64
                || !entry
                    .sha256
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                || entry.byte_length == 0
                || entry.byte_length > MAX_SAFE_INTEGER
            {
                return Err(invalid(
                    "Video identity contains an invalid path, hash or byte length.",
                ));
            }
            let annotation_id = format!("video-{}", &digest(&entry, &[])?[..16]);
            if !ids.insert(annotation_id.clone()) || !paths.insert(entry.relative_path.clone()) {
                return Err(invalid("Video identities or paths collide."));
            }
            videos.push(VideoAnnotation {
                annotation_id,
                relative_path: entry.relative_path,
                sha256: entry.sha256,
                byte_length: entry.byte_length,
            });
        }
        let mut library = Self {
            schema: "affect-research-video-library".into(),
            version: 1,
            videos,
            integrity_sha256: String::new(),
        };
        library.integrity_sha256 = digest(&library, &["integritySha256"])?;
        Ok(library)
    }
    pub fn validate(&self) -> ResearchResult<()> {
        let expected = Self::create(
            self.videos
                .iter()
                .map(|v| VideoIdentity {
                    relative_path: v.relative_path.clone(),
                    sha256: v.sha256.clone(),
                    byte_length: v.byte_length,
                })
                .collect(),
        )?;
        if &expected != self {
            return Err(invalid(
                "Video annotation identity or library fingerprint does not match.",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantColumn {
    pub variant_id: String,
    pub title: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderedVideo {
    pub stimulus_id: String,
    pub isi_after_ms: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub variant_id: String,
    pub title: String,
    pub videos: Vec<OrderedVideo>,
    pub version_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StimulusOrderDocument {
    pub schema: String,
    pub version: u8,
    pub library_sha256: String,
    pub columns: Vec<VariantColumn>,
    pub rows: Vec<Vec<String>>,
    pub variants: Vec<Variant>,
    pub integrity_sha256: String,
}
impl StimulusOrderDocument {
    pub fn validate(&self, library: &VideoLibrary) -> ResearchResult<()> {
        library.validate()?;
        if self.schema != "affect-research-stimulus-order"
            || self.version != 1
            || self.library_sha256 != library.integrity_sha256
            || self.columns.is_empty()
            || self.columns.len() > 64
            || self.rows.is_empty()
            || self.rows.len() > 1024
            || self.rows.len() * self.columns.len() > 32000
            || self
                .rows
                .iter()
                .any(|r| r.len() != self.columns.len() || r.iter().any(|c| c.len() > 80))
        {
            return Err(invalid("The order is invalid or belongs to a different library. Confirm the current library and review the table."));
        }
        let mut ids = BTreeSet::new();
        let mut names = BTreeSet::new();
        let mut expected = Vec::new();
        let known: BTreeSet<_> = library
            .videos
            .iter()
            .map(|v| v.annotation_id.as_str())
            .collect();
        for (c, column) in self.columns.iter().enumerate() {
            let suffix = column.variant_id.strip_prefix("variant-").unwrap_or("");
            if suffix.is_empty()
                || suffix.len() > 6
                || suffix.starts_with('0')
                || !suffix.bytes().all(|b| b.is_ascii_digit())
                || !ids.insert(&column.variant_id)
                || !safe_text(&column.title, 120)
                || column.title.trim() != column.title
                || !names.insert(&column.title)
            {
                return Err(invalid(
                    "Variant identities and names must be valid and distinct.",
                ));
            }
            let last = self
                .rows
                .iter()
                .rposition(|row| !row[c].is_empty())
                .ok_or_else(|| invalid("Every variant needs at least one video."))?;
            let mut videos: Vec<OrderedVideo> = Vec::new();
            let mut seen = BTreeSet::new();
            let mut previous_video = false;
            for row in &self.rows[..=last] {
                let cell = &row[c];
                if known.contains(cell.as_str()) {
                    if !seen.insert(cell) {
                        return Err(invalid("A video may occur only once in a variant."));
                    }
                    videos.push(OrderedVideo {
                        stimulus_id: cell.clone(),
                        isi_after_ms: 0,
                    });
                    previous_video = true;
                } else {
                    if cell.is_empty()
                        || !cell.bytes().all(|b| b.is_ascii_digit())
                        || (cell.len() > 1 && cell.starts_with('0'))
                        || !previous_video
                    {
                        return Err(invalid("Use known video annotations or an ISI directly after a video, without gaps."));
                    }
                    let milliseconds = cell
                        .parse::<u32>()
                        .map_err(|_| invalid("ISI must be from 0 to 3600000 ms."))?;
                    if milliseconds > 3600000 {
                        return Err(invalid("ISI must be from 0 to 3600000 ms."));
                    }
                    let video = videos
                        .last_mut()
                        .ok_or_else(|| invalid("An ISI must follow a video."))?;
                    video.isi_after_ms = milliseconds;
                    previous_video = false;
                }
            }
            let mut variant = Variant {
                variant_id: column.variant_id.clone(),
                title: column.title.clone(),
                videos,
                version_sha256: String::new(),
            };
            variant.version_sha256 = digest(&variant, &["versionSha256"])?;
            expected.push(variant);
        }
        if self.variants != expected || self.integrity_sha256 != digest(self, &["integritySha256"])?
        {
            return Err(invalid(
                "Variant version annotation or order fingerprint does not match.",
            ));
        }
        Ok(())
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringReceipt {
    pub library: VideoLibrary,
    pub design: Option<variants::StoredStimulusOrder>,
    pub design_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        library: VideoLibrary,
        design: StimulusOrderDocument,
        csv_sha256: String,
        xlsx_sha256: String,
    }
    #[test]
    fn javascript_fixture_has_identical_rust_annotations_order_and_spreadsheets() {
        let fixture: Fixture =
            serde_json::from_str(include_str!("../../test/fixtures/stimulus-order-v1.json"))
                .unwrap();
        fixture.library.validate().unwrap();
        fixture.design.validate(&fixture.library).unwrap();
        for (format, expected) in [
            (export::LibraryFormat::Csv, fixture.csv_sha256),
            (export::LibraryFormat::Xlsx, fixture.xlsx_sha256),
        ] {
            assert_eq!(
                format!(
                    "{:x}",
                    Sha256::digest(export::library_bytes(&fixture.library, format))
                ),
                expected
            );
        }
        let mut changed = fixture.design.clone();
        changed.variants[0].version_sha256 = "0".repeat(64);
        assert!(changed.validate(&fixture.library).is_err());
        let mut changed = fixture.design.clone();
        changed.rows[1][0] = "501".into();
        assert!(changed.validate(&fixture.library).is_err());
        let mut changed = fixture.design.clone();
        changed.rows[1][0].clear();
        assert!(changed.validate(&fixture.library).is_err());
        let mut changed = fixture.design.clone();
        changed.rows[0][0] = "500".into();
        assert!(changed.validate(&fixture.library).is_err());
        let mut changed = fixture.design.clone();
        changed.rows[2][0] = changed.rows[0][0].clone();
        assert!(changed.validate(&fixture.library).is_err());
    }
}

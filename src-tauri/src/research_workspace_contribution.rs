use crate::research_contracts::{canonical_sha256, MAX_SAFE_INTEGER, MAX_STIMULI};
use crate::research_error::{CommandError, ResearchResult};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use unicode_normalization::UnicodeNormalization;

pub const VIDEO_CATALOGUE_SCHEMA: &str = "affect-research-video-catalogue-contribution";
pub const WORKSPACE_CONTRIBUTION_SCHEMA: &str = "affect-research-workspace-contribution";
pub const VIDEO_LOCATION_ID_POLICY_V1: &str = "relative-path-reversible-v1";
pub const VIDEO_LOCATION_ID_MAX_BYTES: usize = 6_144;

fn invalid(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}

fn deserialize_required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoRatio {
    pub numerator: u64,
    pub denominator: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoDisplayGeometry {
    pub status: String,
    pub source: String,
    pub display_width_px: u64,
    pub display_height_px: u64,
    pub display_aspect: VideoRatio,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub rotation_degrees: Option<u16>,
    #[serde(deserialize_with = "deserialize_required_option")]
    pub pixel_aspect_ratio: Option<VideoRatio>,
    pub metadata_interpretation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoCatalogueEntry {
    pub asset_id: String,
    pub annotation_id: String,
    pub source_relative_path: String,
    pub package_relative_path: String,
    pub sha256: String,
    pub byte_length: u64,
    pub duration_ms: u64,
    pub geometry: VideoDisplayGeometry,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoCatalogueContribution {
    pub schema: String,
    pub version: u32,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub annotation_policy: Option<String>,
    pub entries: Vec<VideoCatalogueEntry>,
    pub integrity_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StudyIdentity {
    pub schema: String,
    pub version: u32,
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceRelativeLayout {
    pub asset_root: String,
    pub video_library: String,
    pub project_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceContribution {
    pub schema: String,
    pub version: u32,
    pub study: StudyIdentity,
    pub workspace_layout: WorkspaceRelativeLayout,
    pub video_catalogue: VideoCatalogueContribution,
}

fn safe_text(value: &str, maximum_bytes: usize, label: &str) -> ResearchResult<()> {
    let normalized: String = value.nfc().collect();
    if value.is_empty()
        || value.as_bytes().len() > maximum_bytes
        || value != value.trim_matches(is_ecmascript_trim_character)
        || value != normalized
        || value.chars().any(is_control_or_format)
    {
        return Err(invalid(format!(
            "{label} must be bounded, trimmed NFC text without control characters."
        )));
    }
    Ok(())
}

fn is_ecmascript_trim_character(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'
            | '\u{000a}'
            | '\u{000b}'
            | '\u{000c}'
            | '\u{000d}'
            | '\u{0020}'
            | '\u{00a0}'
            | '\u{1680}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    ) || ('\u{2000}'..='\u{200a}').contains(&character)
}

fn is_control_or_format(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{00ad}'
                | '\u{061c}'
                | '\u{06dd}'
                | '\u{070f}'
                | '\u{08e2}'
                | '\u{180e}'
                | '\u{feff}'
        )
        || ('\u{0600}'..='\u{0605}').contains(&character)
        || ('\u{0890}'..='\u{0891}').contains(&character)
        || ('\u{200b}'..='\u{200f}').contains(&character)
        || ('\u{202a}'..='\u{202e}').contains(&character)
        || ('\u{2060}'..='\u{2064}').contains(&character)
        || ('\u{2066}'..='\u{206f}').contains(&character)
        || ('\u{fff9}'..='\u{fffb}').contains(&character)
        || ('\u{110bd}'..='\u{110bd}').contains(&character)
        || ('\u{110cd}'..='\u{110cd}').contains(&character)
        || ('\u{13430}'..='\u{1343f}').contains(&character)
        || ('\u{1bca0}'..='\u{1bca3}').contains(&character)
        || ('\u{1d173}'..='\u{1d17a}').contains(&character)
        || character == '\u{e0001}'
        || ('\u{e0020}'..='\u{e007f}').contains(&character)
}

fn portable_path(
    value: &str,
    prefix: &str,
    label: &str,
    trimmed_components: bool,
) -> ResearchResult<()> {
    safe_text(value, 2_048, label)?;
    if !value.starts_with(prefix)
        || value.split('/').any(|part| {
            part.is_empty()
                || matches!(part, "." | "..")
                || (trimmed_components && part != part.trim_matches(is_ecmascript_trim_character))
                || part.ends_with(['.', ' '])
                || part.chars().any(|character| {
                    matches!(character, '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*')
                })
        })
    {
        return Err(invalid(format!("{label} must remain beneath {prefix}.")));
    }
    Ok(())
}

pub fn video_annotation_id_from_relative_path_v1(value: &str) -> ResearchResult<String> {
    portable_path(value, "stimuli/", "Video source relative path", true)?;
    let encoded = value["stimuli/".len()..]
        .split('/')
        .enumerate()
        .map(|(index, part)| {
            let mut encoded = part.replace('%', "%25").replace('_', "%5F");
            if index == 0 {
                let escape = match encoded.as_bytes().first().copied() {
                    Some(b'=') => Some("%3D"),
                    Some(b'+') => Some("%2B"),
                    Some(b'@') => Some("%40"),
                    Some(b'-') => Some("%2D"),
                    _ => None,
                };
                if let Some(escape) = escape {
                    encoded.replace_range(..1, escape);
                }
            }
            encoded
        })
        .collect::<Vec<_>>()
        .join("_");
    safe_text(&encoded, VIDEO_LOCATION_ID_MAX_BYTES, "Video location ID")?;
    Ok(encoded)
}

pub fn video_relative_path_from_annotation_id_v1(value: &str) -> ResearchResult<String> {
    safe_text(value, VIDEO_LOCATION_ID_MAX_BYTES, "Video location ID")?;
    let mut parts = Vec::new();
    for encoded in value.split('_') {
        let mut decoded = String::new();
        let mut characters = encoded.chars();
        while let Some(character) = characters.next() {
            if character != '%' {
                decoded.push(character);
                continue;
            }
            let left = characters.next();
            let right = characters.next();
            match (left, right) {
                (Some('2'), Some('5')) => decoded.push('%'),
                (Some('5'), Some('F')) => decoded.push('_'),
                (Some('2'), Some('B')) => decoded.push('+'),
                (Some('2'), Some('D')) => decoded.push('-'),
                (Some('3'), Some('D')) => decoded.push('='),
                (Some('4'), Some('0')) => decoded.push('@'),
                _ => return Err(invalid("Video location ID contains a noncanonical escape.")),
            }
        }
        parts.push(decoded);
    }
    let path = format!("stimuli/{}", parts.join("/"));
    portable_path(&path, "stimuli/", "Video source relative path", true)?;
    if video_annotation_id_from_relative_path_v1(&path)? != value {
        return Err(invalid("Video location ID is not canonical."));
    }
    Ok(path)
}

fn greatest_common_divisor(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        (left, right) = (right, left % right);
    }
    left
}

fn validate_geometry(value: &VideoDisplayGeometry, allow_native: bool) -> ResearchResult<()> {
    if value.status != "verified"
        || value.display_width_px == 0
        || value.display_height_px == 0
        || value.display_width_px > MAX_SAFE_INTEGER
        || value.display_height_px > MAX_SAFE_INTEGER
        || value.display_aspect.numerator == 0
        || value.display_aspect.denominator == 0
    {
        return Err(invalid("Video display geometry is malformed."));
    }
    let divisor = greatest_common_divisor(value.display_width_px, value.display_height_px);
    if value.display_aspect.numerator != value.display_width_px / divisor
        || value.display_aspect.denominator != value.display_height_px / divisor
    {
        return Err(invalid(
            "Video display aspect is not the reduced display ratio.",
        ));
    }
    match value.source.as_str() {
        "browser-decoder"
            if value.metadata_interpretation == "decoder-oriented-display"
                && value.rotation_degrees.is_none()
                && value.pixel_aspect_ratio.is_none() => {}
        "native-gstplay-metadata"
            if allow_native
                && value.metadata_interpretation
                    == "explicit-orientation-and-square-pixel-snapshot"
                && matches!(value.rotation_degrees, Some(0 | 90 | 180 | 270))
                && value.pixel_aspect_ratio.as_ref().is_some_and(|ratio| {
                    ratio.numerator > 0
                        && ratio.denominator > 0
                        && ratio.numerator <= MAX_SAFE_INTEGER
                        && ratio.denominator <= MAX_SAFE_INTEGER
                        && greatest_common_divisor(ratio.numerator, ratio.denominator) == 1
                }) => {}
        _ => return Err(invalid("Video display geometry source is unsupported.")),
    }
    Ok(())
}

fn validate_entry(value: &VideoCatalogueEntry, version: u32) -> ResearchResult<()> {
    if value.sha256.len() != 64
        || !value
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || value.asset_id != format!("asset-{}", value.sha256)
        || value.byte_length == 0
        || value.duration_ms == 0
        || value.byte_length > MAX_SAFE_INTEGER
        || value.duration_ms > MAX_SAFE_INTEGER
    {
        return Err(invalid("Video catalogue content identity is malformed."));
    }
    portable_path(
        &value.source_relative_path,
        "stimuli/",
        "sourceRelativePath",
        version >= 2,
    )?;
    portable_path(
        &value.package_relative_path,
        "assets/stimuli/",
        "packageRelativePath",
        version >= 2,
    )?;
    if value.package_relative_path != format!("assets/{}", value.source_relative_path) {
        return Err(invalid("Video package and logical paths disagree."));
    }
    if version == 1 {
        safe_text(&value.annotation_id, 200, "annotationId")?;
    } else {
        safe_text(
            &value.annotation_id,
            VIDEO_LOCATION_ID_MAX_BYTES,
            "annotationId",
        )?;
        if video_annotation_id_from_relative_path_v1(&value.source_relative_path)?
            != value.annotation_id
            || video_relative_path_from_annotation_id_v1(&value.annotation_id)?
                != value.source_relative_path
        {
            return Err(invalid(
                "Video location ID is not the canonical reversible path identity.",
            ));
        }
    }
    validate_geometry(&value.geometry, version == 2)
}

pub fn validate_video_catalogue_contribution(
    value: &Value,
) -> ResearchResult<VideoCatalogueContribution> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Video catalogue contribution shape is invalid."))?;
    let version = object.get("version").and_then(Value::as_u64);
    let expected_keys = match version {
        Some(1) => [
            "entries",
            "integritySha256",
            "revision",
            "schema",
            "version",
        ]
        .as_slice(),
        Some(2) => [
            "annotationPolicy",
            "entries",
            "integritySha256",
            "revision",
            "schema",
            "version",
        ]
        .as_slice(),
        _ => {
            return Err(invalid(
                "Video catalogue contribution version is unsupported.",
            ))
        }
    };
    if object.len() != expected_keys.len()
        || !expected_keys.iter().all(|key| object.contains_key(*key))
    {
        return Err(invalid(
            "Video catalogue contribution has unexpected or missing fields.",
        ));
    }
    let document: VideoCatalogueContribution = serde_json::from_value(value.clone())
        .map_err(|_| invalid("Video catalogue contribution shape is invalid."))?;
    if document.schema != VIDEO_CATALOGUE_SCHEMA
        || !matches!(document.version, 1 | 2)
        || document.revision == 0
        || document.revision > MAX_SAFE_INTEGER
        || document.entries.len() > MAX_STIMULI
        || (document.version == 2 && document.entries.is_empty())
        || document.integrity_sha256.len() != 64
        || !document
            .integrity_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || (document.version == 1 && document.annotation_policy.is_some())
        || (document.version == 2
            && document.annotation_policy.as_deref() != Some(VIDEO_LOCATION_ID_POLICY_V1))
    {
        return Err(invalid("Video catalogue contribution header is invalid."));
    }
    for entry in &document.entries {
        validate_entry(entry, document.version)?;
    }

    let mut ordered = document.entries.clone();
    if document.version == 1 {
        ordered.sort_by(|left, right| left.asset_id.cmp(&right.asset_id));
    } else {
        ordered.sort_by(|left, right| {
            left.annotation_id
                .encode_utf16()
                .cmp(right.annotation_id.encode_utf16())
                .then_with(|| left.asset_id.cmp(&right.asset_id))
        });
    }
    if ordered != document.entries {
        return Err(invalid(
            "Video catalogue entries are not canonical ordered.",
        ));
    }

    let mut asset_ids = BTreeSet::new();
    let mut location_ids = BTreeSet::new();
    let mut package_paths = BTreeSet::new();
    let mut content_by_asset = BTreeMap::new();
    for entry in &document.entries {
        if !package_paths.insert(entry.package_relative_path.as_str())
            || (document.version == 1 && !asset_ids.insert(entry.asset_id.as_str()))
            || (document.version == 2 && !location_ids.insert(entry.annotation_id.as_str()))
        {
            return Err(invalid(
                "Video catalogue identities and paths must be unique.",
            ));
        }
        if document.version == 2 {
            let content = (
                entry.sha256.as_str(),
                entry.byte_length,
                entry.duration_ms,
                &entry.geometry,
            );
            if content_by_asset
                .insert(entry.asset_id.as_str(), content.clone())
                .is_some_and(|previous| previous != content)
            {
                return Err(invalid(
                    "Locations sharing an asset identity disagree on content metadata.",
                ));
            }
        }
    }
    if canonical_sha256(&document, &["integritySha256"])? != document.integrity_sha256 {
        return Err(invalid(
            "Video catalogue contribution integrity does not match.",
        ));
    }
    Ok(document)
}

fn validate_study(value: &StudyIdentity) -> ResearchResult<()> {
    let valid_id = !value.id.is_empty()
        && value.id.len() <= 128
        && value.id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if value.schema != "affect-research-study-identity" || value.version != 1 || !valid_id {
        return Err(invalid("Workspace study identity is invalid."));
    }
    safe_text(&value.title, 200, "Study title")
}

pub fn validate_workspace_contribution(value: &Value) -> ResearchResult<WorkspaceContribution> {
    let document: WorkspaceContribution = serde_json::from_value(value.clone())
        .map_err(|_| invalid("Workspace contribution shape is invalid."))?;
    if document.schema != WORKSPACE_CONTRIBUTION_SCHEMA
        || !matches!(document.version, 1 | 2)
        || document.workspace_layout.asset_root != "assets"
        || document.workspace_layout.video_library != "assets/stimuli"
        || document.workspace_layout.project_file != "experiment.package.json"
        || document.video_catalogue.version != document.version
    {
        return Err(invalid(
            "Workspace contribution header or fixed layout is invalid.",
        ));
    }
    validate_study(&document.study)?;
    let validated = validate_video_catalogue_contribution(
        value
            .get("videoCatalogue")
            .ok_or_else(|| invalid("Workspace video catalogue is missing."))?,
    )?;
    if validated != document.video_catalogue {
        return Err(invalid("Workspace video catalogue is noncanonical."));
    }
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(name: &str) -> Value {
        let source = match name {
            "v1" => {
                include_str!("../../test/fixtures/research-video-catalogue-contribution-v1.json")
            }
            "v2" => {
                include_str!("../../test/fixtures/research-video-catalogue-contribution-v2.json")
            }
            "utf16-v2" => {
                include_str!("../../test/fixtures/research-video-catalogue-utf16-order-v2.json")
            }
            _ => unreachable!(),
        };
        serde_json::from_str(source).unwrap()
    }

    #[test]
    fn shared_catalogue_fixtures_validate_in_rust() {
        let mut v1 = validate_video_catalogue_contribution(&fixture("v1")).unwrap();
        assert_eq!(v1.version, 1);
        v1.entries[0].source_relative_path = "stimuli/ leading/landscape.mp4".to_owned();
        v1.entries[0].package_relative_path = "assets/stimuli/ leading/landscape.mp4".to_owned();
        v1.integrity_sha256 = canonical_sha256(&v1, &["integritySha256"]).unwrap();
        assert_eq!(
            validate_video_catalogue_contribution(&serde_json::to_value(v1).unwrap())
                .unwrap()
                .version,
            1,
            "new v2 path restrictions must not reinterpret the historical v1 reader"
        );
        let v2 = validate_video_catalogue_contribution(&fixture("v2")).unwrap();
        assert_eq!(v2.version, 2);
        assert_eq!(v2.entries[0].asset_id, v2.entries[1].asset_id);
        assert_ne!(v2.entries[0].annotation_id, v2.entries[1].annotation_id);
        let utf16 = validate_video_catalogue_contribution(&fixture("utf16-v2")).unwrap();
        assert_eq!(utf16.entries[0].annotation_id, "😀_clip.mp4");
        assert_eq!(utf16.entries[1].annotation_id, "Ａ_clip.mp4");

        let mut explicit_null_v1 = fixture("v1");
        explicit_null_v1["annotationPolicy"] = Value::Null;
        assert!(validate_video_catalogue_contribution(&explicit_null_v1).is_err());
    }

    #[test]
    fn path_identity_is_reversible_and_delimiter_safe() {
        for (path, id) in [
            ("stimuli/session-a/clip.mp4", "session-a_clip.mp4"),
            ("stimuli/session_a/clip.mp4", "session%5Fa_clip.mp4"),
            ("stimuli/-clip.mp4", "%2Dclip.mp4"),
            ("stimuli/=clip.mp4", "%3Dclip.mp4"),
            (
                "stimuli/percent%set/clip_final.webm",
                "percent%25set_clip%5Ffinal.webm",
            ),
            ("stimuli/Δοκιμή/映像.mp4", "Δοκιμή_映像.mp4"),
        ] {
            assert_eq!(video_annotation_id_from_relative_path_v1(path).unwrap(), id);
            assert_eq!(video_relative_path_from_annotation_id_v1(id).unwrap(), path);
        }
        assert!(video_relative_path_from_annotation_id_v1("bad%2Fescape.mp4").is_err());
        assert!(video_annotation_id_from_relative_path_v1("stimuli/e\u{301}/clip.mp4").is_err());
        assert!(video_annotation_id_from_relative_path_v1("stimuli/ clip.mp4").is_err());
    }

    #[test]
    fn workspace_validator_is_pure_and_rejects_tampering() {
        let catalogue = fixture("v2");
        let workspace = json!({
            "schema": WORKSPACE_CONTRIBUTION_SCHEMA,
            "version": 2,
            "study": {
                "schema": "affect-research-study-identity",
                "version": 1,
                "id": "video-affect-study",
                "title": "Video Affect Study"
            },
            "workspaceLayout": {
                "assetRoot": "assets",
                "videoLibrary": "assets/stimuli",
                "projectFile": "experiment.package.json"
            },
            "videoCatalogue": catalogue
        });
        assert_eq!(
            validate_workspace_contribution(&workspace).unwrap().version,
            2
        );

        let mut tampered = workspace;
        tampered["videoCatalogue"]["entries"][0]["durationMs"] = json!(12_346);
        assert!(validate_workspace_contribution(&tampered).is_err());
    }
}

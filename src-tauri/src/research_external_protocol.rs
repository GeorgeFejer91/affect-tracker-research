use crate::research_contracts::canonical_sha256;
use crate::research_error::{CommandError, ResearchResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

pub const EXPERIMENT_DEFINITION_SCHEMA: &str = "affect-research-experiment";
pub const EXTERNAL_ORDER_ALGORITHM_VERSION: &str = "external-order-v1";
pub const MAX_EXPERIMENT_DEFINITION_BYTES: usize = 5 * 1024 * 1024;

const MAX_PARTICIPANTS: usize = 100_000;
const MAX_STIMULI: usize = 10_000;
const MAX_BLOCKS: usize = 256;
const MAX_VIDEOS_PER_PARTICIPANT: usize = 20_000;
const MAX_ISI_MS: u32 = 3_600_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentDefinitionV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub experiment_id: String,
    pub title: String,
    pub stimuli: Vec<ExperimentStimulusV1>,
    pub blocks: Vec<ExperimentBlockV1>,
    pub schedules: Vec<ExperimentScheduleV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentStimulusV1 {
    pub stimulus_id: String,
    pub title: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentBlockV1 {
    pub block_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentScheduleV1 {
    pub participant_id: String,
    pub blocks: Vec<ExperimentScheduleBlockV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentScheduleBlockV1 {
    pub block_id: String,
    pub videos: Vec<ExperimentVideoV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExperimentVideoV1 {
    pub stimulus_id: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub isi_after_ms: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedExperimentReceipt {
    pub definition: ExperimentDefinitionV1,
    pub source_text: String,
    pub source_byte_sha256: String,
    pub definition_sha256: String,
}

impl ExperimentDefinitionV1 {
    pub fn normalize_and_validate(mut self) -> ResearchResult<Self> {
        if self.schema != EXPERIMENT_DEFINITION_SCHEMA || self.version != 1 {
            return Err(contract_error(
                "ExperimentDefinitionV1 has an unsupported schema or version.",
            ));
        }
        require_identifier(&self.experiment_id, "ExperimentDefinitionV1.experimentId")?;
        self.title = normalize_text(&self.title, "ExperimentDefinitionV1.title")?;

        if !(1..=MAX_STIMULI).contains(&self.stimuli.len()) {
            return Err(contract_error(format!(
                "ExperimentDefinitionV1.stimuli must contain 1–{MAX_STIMULI} entries."
            )));
        }
        if !(1..=MAX_BLOCKS).contains(&self.blocks.len()) {
            return Err(contract_error(format!(
                "ExperimentDefinitionV1.blocks must contain 1–{MAX_BLOCKS} entries."
            )));
        }
        if !(1..=MAX_PARTICIPANTS).contains(&self.schedules.len()) {
            return Err(contract_error(format!(
                "ExperimentDefinitionV1.schedules must contain 1–{MAX_PARTICIPANTS} entries."
            )));
        }

        let mut stimulus_ids = HashSet::with_capacity(self.stimuli.len());
        let mut stimulus_paths = HashSet::with_capacity(self.stimuli.len());
        for stimulus in &mut self.stimuli {
            require_identifier(
                &stimulus.stimulus_id,
                "ExperimentDefinitionV1.stimulus.stimulusId",
            )?;
            stimulus.title =
                normalize_text(&stimulus.title, "ExperimentDefinitionV1.stimulus.title")?;
            stimulus.relative_path = normalize_stimulus_path(
                &stimulus.relative_path,
                "ExperimentDefinitionV1.stimulus.relativePath",
            )?;
            if !stimulus_ids.insert(stimulus.stimulus_id.clone()) {
                return Err(contract_error(
                    "ExperimentDefinitionV1.stimuli contains duplicate stimulus IDs.",
                ));
            }
            if !stimulus_paths.insert(stimulus.relative_path.clone()) {
                return Err(contract_error(
                    "ExperimentDefinitionV1.stimuli contains duplicate workspace paths.",
                ));
            }
        }

        let mut block_ids = HashSet::with_capacity(self.blocks.len());
        for block in &mut self.blocks {
            require_identifier(&block.block_id, "ExperimentDefinitionV1.block.blockId")?;
            block.label = normalize_text(&block.label, "ExperimentDefinitionV1.block.label")?;
            if !block_ids.insert(block.block_id.clone()) {
                return Err(contract_error(
                    "ExperimentDefinitionV1.blocks contains duplicate block IDs.",
                ));
            }
        }

        let participant_width = self.schedules.len().to_string().len().max(3);
        let mut referenced_stimuli = HashSet::with_capacity(self.stimuli.len());
        for (schedule_index, schedule) in self.schedules.iter_mut().enumerate() {
            let expected_participant =
                format!("P{:0width$}", schedule_index + 1, width = participant_width);
            if schedule.participant_id != expected_participant {
                return Err(contract_error(format!(
                    "ExperimentDefinitionV1.schedules[{schedule_index}].participantId must be {expected_participant}."
                )));
            }
            if schedule.blocks.len() != self.blocks.len() {
                return Err(contract_error(format!(
                    "ExperimentDefinitionV1.schedules[{schedule_index}].blocks must contain every declared block exactly once."
                )));
            }

            let mut schedule_blocks = HashSet::with_capacity(schedule.blocks.len());
            let mut participant_stimuli = HashSet::new();
            let mut video_count = 0usize;
            for block in &mut schedule.blocks {
                require_identifier(
                    &block.block_id,
                    "ExperimentDefinitionV1.schedule.block.blockId",
                )?;
                if !block_ids.contains(&block.block_id) {
                    return Err(contract_error(
                        "An experiment schedule references an undeclared block.",
                    ));
                }
                if !schedule_blocks.insert(block.block_id.clone()) {
                    return Err(contract_error(format!(
                        "ExperimentDefinitionV1.schedules[{schedule_index}].blocks must contain every declared block exactly once."
                    )));
                }
                if block.videos.is_empty() {
                    return Err(contract_error(
                        "Every experiment schedule block must contain at least one video.",
                    ));
                }
                video_count = video_count.checked_add(block.videos.len()).ok_or_else(|| {
                    contract_error("An experiment participant schedule is too large.")
                })?;
                if video_count > MAX_VIDEOS_PER_PARTICIPANT {
                    return Err(contract_error(format!(
                        "ExperimentDefinitionV1.schedules[{schedule_index}] exceeds {MAX_VIDEOS_PER_PARTICIPANT} videos."
                    )));
                }
                for video in &block.videos {
                    require_identifier(
                        &video.stimulus_id,
                        "ExperimentDefinitionV1.schedule.video.stimulusId",
                    )?;
                    if !stimulus_ids.contains(&video.stimulus_id) {
                        return Err(contract_error(
                            "An experiment schedule references an undeclared stimulus.",
                        ));
                    }
                    if !participant_stimuli.insert(video.stimulus_id.clone()) {
                        return Err(contract_error(format!(
                            "ExperimentDefinitionV1.schedules[{schedule_index}] repeats a stimulus; v1 requires unique videos per participant."
                        )));
                    }
                    if video.isi_after_ms > MAX_ISI_MS {
                        return Err(contract_error(format!(
                            "ExperimentDefinitionV1 video isiAfterMs must be within 0–{MAX_ISI_MS}."
                        )));
                    }
                    referenced_stimuli.insert(video.stimulus_id.clone());
                }
            }
            if schedule_blocks.len() != block_ids.len() {
                return Err(contract_error(format!(
                    "ExperimentDefinitionV1.schedules[{schedule_index}].blocks must contain every declared block exactly once."
                )));
            }
        }

        if referenced_stimuli.len() != stimulus_ids.len() {
            return Err(contract_error(
                "ExperimentDefinitionV1 declares one or more unused stimuli.",
            ));
        }
        Ok(self)
    }

    pub fn canonical_sha256(&self) -> ResearchResult<String> {
        canonical_sha256(self, &[])
    }
}

pub fn parse_experiment_definition_bytes(bytes: &[u8]) -> ResearchResult<LoadedExperimentReceipt> {
    if bytes.is_empty() || bytes.len() > MAX_EXPERIMENT_DEFINITION_BYTES {
        return Err(contract_error(format!(
            "experiment.json must contain 1–{MAX_EXPERIMENT_DEFINITION_BYTES} bytes."
        )));
    }
    let decoded_text = std::str::from_utf8(bytes)
        .map_err(|_| contract_error("experiment.json must be valid UTF-8."))?;
    // Match the browser TextDecoder contract: one leading UTF-8 BOM is not
    // part of the JSON text, while it remains bound by the source-byte hash.
    let text = decoded_text
        .strip_prefix('\u{feff}')
        .unwrap_or(decoded_text);
    // Derived closed structs reject unknown and duplicate object fields at every
    // schema level before any normalized contract is accepted.
    let definition = serde_json::from_str::<ExperimentDefinitionV1>(text)
        .map_err(|_| contract_error("experiment.json is not valid ExperimentDefinitionV1 JSON."))?
        .normalize_and_validate()?;
    let source_byte_sha256 = format!("{:x}", Sha256::digest(bytes));
    let definition_sha256 = definition.canonical_sha256()?;
    Ok(LoadedExperimentReceipt {
        definition,
        source_text: decoded_text.to_owned(),
        source_byte_sha256,
        definition_sha256,
    })
}

fn require_identifier(value: &str, label: &str) -> ResearchResult<()> {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return Err(contract_error(format!(
            "{label} must be a lowercase identifier using letters, numbers, _ or -."
        )));
    };
    let valid_first = first.is_ascii_lowercase() || first.is_ascii_digit();
    let valid_rest = bytes.all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
    });
    if value.len() > 128 || !valid_first || !valid_rest {
        return Err(contract_error(format!(
            "{label} must be a lowercase identifier using letters, numbers, _ or -."
        )));
    }
    Ok(())
}

fn normalize_text(value: &str, label: &str) -> ResearchResult<String> {
    let normalized: String = value
        .nfc()
        .collect::<String>()
        .trim_matches(is_ecmascript_trim_character)
        .to_owned();
    let length = normalized.encode_utf16().count();
    if length == 0
        || length > 200
        || normalized
            .chars()
            .any(|character| character <= '\u{001f}' || character == '\u{007f}')
    {
        return Err(contract_error(format!(
            "{label} must contain 1–200 printable characters."
        )));
    }
    Ok(normalized)
}

pub(crate) fn normalize_stimulus_path(value: &str, label: &str) -> ResearchResult<String> {
    let length = value.encode_utf16().count();
    if length == 0
        || length > 1_024
        || value.contains('\\')
        || value.starts_with('/')
        || has_windows_drive_prefix(value)
    {
        return Err(contract_error(format!(
            "{label} must be a forward-slash workspace-relative path beneath stimuli/."
        )));
    }
    let parts: Vec<&str> = value.split('/').collect();
    if !(2..=32).contains(&parts.len())
        || parts.first().copied() != Some("stimuli")
        || parts.iter().any(|part| is_unsafe_path_component(part))
    {
        return Err(contract_error(format!(
            "{label} must be a safe path beneath stimuli/."
        )));
    }

    let mut decoded = value.to_owned();
    for _ in 0..4 {
        let next = decode_uri_component(&decoded)
            .map_err(|_| contract_error(format!("{label} contains invalid percent encoding.")))?;
        if next == decoded {
            break;
        }
        let next_parts = next.split('/').collect::<Vec<_>>();
        if next.contains('\\')
            || next.starts_with('/')
            || has_windows_drive_prefix(&next)
            || !(2..=32).contains(&next_parts.len())
            || next_parts.first().copied() != Some("stimuli")
            || next_parts.iter().any(|part| is_unsafe_path_component(part))
        {
            return Err(contract_error(format!(
                "{label} contains an encoded unsafe path."
            )));
        }
        decoded = next;
    }
    let normalized: String = value.nfc().collect();
    if normalized != value {
        return Err(contract_error(format!(
            "{label} must use NFC-normalized path components."
        )));
    }
    Ok(normalized)
}

fn is_unsafe_path_component(part: &str) -> bool {
    part.is_empty()
        || matches!(part, "." | "..")
        || part.chars().any(|character| {
            character <= '\u{001f}'
                || character == '\u{007f}'
                || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
        || part.ends_with([' ', '.'])
        || is_windows_reserved_component(part)
}

fn is_windows_reserved_component(part: &str) -> bool {
    let stem = part
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn has_windows_drive_prefix(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn decode_uri_component(value: &str) -> Result<String, ()> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(());
            }
            let high = hex_value(bytes[index + 1]).ok_or(())?;
            let low = hex_value(bytes[index + 2]).ok_or(())?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| ())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn deserialize_u32_integer<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let number = serde_json::Number::deserialize(deserializer)?;
    if let Some(value) = number.as_u64() {
        return u32::try_from(value).map_err(serde::de::Error::custom);
    }
    if let Some(value) = number.as_i64() {
        return u32::try_from(value).map_err(serde::de::Error::custom);
    }
    let value = number
        .as_f64()
        .ok_or_else(|| serde::de::Error::custom("expected a JSON integer"))?;
    if !value.is_finite() || value.fract() != 0.0 || !(0.0..=u32::MAX as f64).contains(&value) {
        return Err(serde::de::Error::custom("expected a JSON integer"));
    }
    Ok(value as u32)
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

fn contract_error(message: impl Into<String>) -> CommandError {
    CommandError::invalid_contract(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_json() -> Vec<u8> {
        br#"{
          "schema":"affect-research-experiment",
          "version":1,
          "experimentId":"video-affect-v1",
          "title":" Video Affect Study ",
          "stimuli":[
            {"stimulusId":"calm","title":"Calm","relativePath":"stimuli/calm.mp4"},
            {"stimulusId":"active","title":"Active","relativePath":"stimuli/nested/active.mp4"}
          ],
          "blocks":[
            {"blockId":"baseline","label":"Baseline"},
            {"blockId":"challenge","label":"Challenge"}
          ],
          "schedules":[
            {"participantId":"P001","blocks":[
              {"blockId":"challenge","videos":[{"stimulusId":"active","isiAfterMs":3500}]},
              {"blockId":"baseline","videos":[{"stimulusId":"calm","isiAfterMs":0}]}
            ]}
          ]
        }"#
        .to_vec()
    }

    #[test]
    fn parses_and_hashes_exact_source_and_normalized_definition() {
        let bytes = valid_json();
        let receipt = parse_experiment_definition_bytes(&bytes).unwrap();
        assert_eq!(receipt.definition.title, "Video Affect Study");
        assert_eq!(
            receipt.definition.schedules[0].blocks[0].block_id,
            "challenge"
        );
        assert_eq!(
            receipt.source_byte_sha256,
            format!("{:x}", Sha256::digest(&bytes))
        );
        assert_eq!(receipt.source_text.as_bytes(), bytes);
        assert_eq!(
            receipt.definition_sha256,
            receipt.definition.canonical_sha256().unwrap()
        );
        assert_eq!(
            receipt.definition_sha256,
            "243b023752a6d81a557716e0c5fa6ba9b259ee9f715c6625e3ea8b52c1a6a24c"
        );
        assert_ne!(receipt.source_byte_sha256, receipt.definition_sha256);
        let serialized = serde_json::to_value(&receipt).unwrap();
        let keys = serialized
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        assert_eq!(
            keys,
            HashSet::from([
                "definition",
                "sourceText",
                "sourceByteSha256",
                "definitionSha256"
            ])
        );
    }

    #[test]
    fn rejects_unknown_and_duplicate_json_fields() {
        let unknown = String::from_utf8(valid_json())
            .unwrap()
            .replace("\"version\":1,", "\"version\":1,\"surprise\":true,");
        assert!(parse_experiment_definition_bytes(unknown.as_bytes()).is_err());

        let duplicate = String::from_utf8(valid_json()).unwrap().replace(
            "\"isiAfterMs\":3500",
            "\"isiAfterMs\":3500,\"isiAfterMs\":0",
        );
        assert!(parse_experiment_definition_bytes(duplicate.as_bytes()).is_err());
    }

    #[test]
    fn rejects_invalid_utf8_and_byte_bounds() {
        assert!(parse_experiment_definition_bytes(&[]).is_err());
        assert!(parse_experiment_definition_bytes(&[0xff]).is_err());
        assert!(parse_experiment_definition_bytes(&vec![
            b' ';
            MAX_EXPERIMENT_DEFINITION_BYTES + 1
        ])
        .is_err());

        let ordinary = parse_experiment_definition_bytes(&valid_json()).unwrap();
        let mut with_bom = vec![0xef, 0xbb, 0xbf];
        with_bom.extend(valid_json());
        let bom_receipt = parse_experiment_definition_bytes(&with_bom).unwrap();
        assert_eq!(bom_receipt.definition_sha256, ordinary.definition_sha256);
        assert_ne!(bom_receipt.source_byte_sha256, ordinary.source_byte_sha256);
        assert_eq!(bom_receipt.source_text.as_bytes(), with_bom);
    }

    #[test]
    fn json_integer_spellings_match_browser_number_semantics() {
        let source = String::from_utf8(valid_json()).unwrap();
        let decimal = source
            .replace("\"version\":1", "\"version\":1.0")
            .replace("\"isiAfterMs\":3500", "\"isiAfterMs\":3.5e3");
        let receipt = parse_experiment_definition_bytes(decimal.as_bytes()).unwrap();
        assert_eq!(receipt.definition.version, 1);
        assert_eq!(
            receipt.definition.schedules[0].blocks[0].videos[0].isi_after_ms,
            3_500
        );
    }

    #[test]
    fn rejects_noncanonical_participants_blocks_duplicates_and_isi() {
        let source = String::from_utf8(valid_json()).unwrap();
        assert!(
            parse_experiment_definition_bytes(source.replace("P001", "P002").as_bytes()).is_err()
        );
        assert!(parse_experiment_definition_bytes(
            source
                .replace(
                    "\"blockId\":\"baseline\",\"videos\"",
                    "\"blockId\":\"challenge\",\"videos\""
                )
                .as_bytes()
        )
        .is_err());
        assert!(parse_experiment_definition_bytes(
            source
                .replace("\"isiAfterMs\":3500", "\"isiAfterMs\":3600001")
                .as_bytes()
        )
        .is_err());
        assert!(parse_experiment_definition_bytes(
            source
                .replace(
                    "\"stimulusId\":\"calm\",\"isiAfterMs\":0",
                    "\"stimulusId\":\"active\",\"isiAfterMs\":0"
                )
                .as_bytes()
        )
        .is_err());
    }

    #[test]
    fn rejects_unsafe_or_duplicate_paths_and_unused_stimuli() {
        let source = String::from_utf8(valid_json()).unwrap();
        for unsafe_path in [
            "../calm.mp4",
            "stimuli/../calm.mp4",
            "stimuli/%2e%2e/calm.mp4",
            "stimuli/C:\\calm.mp4",
            "stimuli/CON.mp4",
            "stimuli/nested/prn.mov",
            "stimuli/COM1.video.mp4",
            "stimuli/%4eUL.mp4",
            "stimuli/%252e%252e/calm.mp4",
            "stimuli/cafe\u{301}.mp4",
            "stimuli/control\u{007f}.mp4",
        ] {
            let candidate = source.replace("stimuli/calm.mp4", unsafe_path);
            assert!(parse_experiment_definition_bytes(candidate.as_bytes()).is_err());
        }
        assert!(parse_experiment_definition_bytes(
            source
                .replace("stimuli/nested/active.mp4", "stimuli/calm.mp4")
                .as_bytes()
        )
        .is_err());
        assert!(parse_experiment_definition_bytes(
            source
                .replace(
                    "\"stimulusId\":\"active\",\"isiAfterMs\":3500",
                    "\"stimulusId\":\"calm\",\"isiAfterMs\":3500"
                )
                .as_bytes()
        )
        .is_err());
    }

    #[test]
    fn participant_width_tracks_the_total_schedule_count() {
        let mut definition: ExperimentDefinitionV1 = serde_json::from_slice(&valid_json()).unwrap();
        definition.schedules = (0..1_000)
            .map(|index| ExperimentScheduleV1 {
                participant_id: format!("P{:04}", index + 1),
                blocks: definition.schedules[0].blocks.clone(),
            })
            .collect();
        definition.normalize_and_validate().unwrap();
    }

    #[test]
    fn checked_in_template_matches_browser_hashes() {
        let receipt = parse_experiment_definition_bytes(include_bytes!(
            "../../site/experiment-template.json"
        ))
        .unwrap();
        assert_eq!(
            receipt.source_byte_sha256,
            "c3966358559b0b4c666feddc1f64a78a4e293096b5368b23db92c7d2333d115f"
        );
        assert_eq!(
            receipt.definition_sha256,
            "bdb33c433093b153018f13d58f2a75aac0c436ec142b17cedf10512c1c5a6aac"
        );
    }
}

//! Transient participant input and coded-identity validation.
//!
//! Raw names never enter this boundary. The frontend derives the two-grapheme
//! code and Rust independently validates that only coded demographics can be
//! frozen into a run.

use crate::research_contracts::{GenderCodeV1, HandednessCodeV1};
use crate::research_error::{CommandError, ResearchResult};
use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransientParticipant {
    pub participant_id: String,
    pub participant_code: String,
    pub age: u8,
    pub gender: GenderCodeV1,
    pub handedness: HandednessCodeV1,
}

pub(crate) fn validate_participant_code(code: &str) -> ResearchResult<String> {
    let normalized = code.trim().nfc().collect::<String>();
    let grapheme_count = UnicodeSegmentation::graphemes(normalized.as_str(), true).count();
    let reserved = normalized.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '_'
        ) || character.is_control()
    });
    if grapheme_count != 2
        || normalized.len() > 32
        || reserved
        || normalized.to_uppercase() != normalized
    {
        return Err(CommandError::invalid_contract(
            "Participant code must contain exactly two uppercase filename-safe graphemes.",
        ));
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_accepts_exactly_two_uppercase_graphemes() {
        assert_eq!(validate_participant_code("EF").unwrap(), "EF");
        assert_eq!(validate_participant_code(" A\u{30a}B ").unwrap(), "ÅB");
        assert!(validate_participant_code("Ef").is_err());
        assert!(validate_participant_code("ABC").is_err());
        assert!(validate_participant_code("A_").is_err());
    }
}

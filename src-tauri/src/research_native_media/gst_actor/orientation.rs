//! Pure source-tag interpretation. Absence is not an explicit identity tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SourceOrientation {
    Absent,
    Explicit(u16),
}

impl SourceOrientation {
    pub(super) fn configured_degrees(self) -> u16 {
        match self {
            Self::Absent => 0,
            Self::Explicit(degrees) => degrees,
        }
    }
}

/// Caller supplies actual tag cardinality before attempting a typed read.
/// More than one value is ambiguous, never silently merged/first-selected.
pub(super) fn parse_tag(
    count: usize,
    value: Option<&str>,
) -> Result<SourceOrientation, &'static str> {
    match (count, value) {
        (0, None) => Ok(SourceOrientation::Absent),
        (1, Some("rotate-0")) => Ok(SourceOrientation::Explicit(0)),
        (1, Some("rotate-90")) => Ok(SourceOrientation::Explicit(90)),
        (1, Some("rotate-180")) => Ok(SourceOrientation::Explicit(180)),
        (1, Some("rotate-270")) => Ok(SourceOrientation::Explicit(270)),
        (1, Some("flip-rotate-0" | "flip-rotate-90" | "flip-rotate-180" | "flip-rotate-270")) => {
            Err("native-display-orientation-unsupported")
        }
        (2.., _) => Err("native-display-orientation-conflicting"),
        _ => Err("native-display-orientation-malformed"),
    }
}

pub(super) fn reconcile(
    stream: Result<SourceOrientation, &'static str>,
    media: Result<SourceOrientation, &'static str>,
) -> Result<SourceOrientation, &'static str> {
    match (stream?, media?) {
        (SourceOrientation::Absent, value) | (value, SourceOrientation::Absent) => Ok(value),
        (left, right) if left == right => Ok(left),
        _ => Err("native-display-orientation-conflicting"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absence_and_explicit_identity_keep_distinct_provenance() {
        let absent = parse_tag(0, None).unwrap();
        let identity = parse_tag(1, Some("rotate-0")).unwrap();
        assert_ne!(absent, identity);
        assert_eq!(absent.configured_degrees(), 0);
        assert_eq!(identity.configured_degrees(), 0);
    }

    #[test]
    fn only_single_supported_quarter_turn_tags_are_accepted() {
        for (value, degrees) in [
            ("rotate-0", 0),
            ("rotate-90", 90),
            ("rotate-180", 180),
            ("rotate-270", 270),
        ] {
            assert_eq!(
                parse_tag(1, Some(value)).unwrap().configured_degrees(),
                degrees
            );
        }
        for value in [
            "",
            "rotate-360",
            "auto",
            "custom",
            "ROTATE-90",
            " rotate-0",
            "flip-rotate-0",
            "flip-rotate-90",
            "flip-rotate-180",
            "flip-rotate-270",
        ] {
            assert!(parse_tag(1, Some(value)).is_err());
        }
        assert!(parse_tag(1, None).is_err());
        assert!(parse_tag(2, Some("rotate-0")).is_err());
    }

    #[test]
    fn invalid_or_conflicting_scope_cannot_hide_behind_valid_other_scope() {
        let absent = parse_tag(0, None);
        let identity = parse_tag(1, Some("rotate-0"));
        let rotated = parse_tag(1, Some("rotate-90"));
        assert_eq!(reconcile(absent, identity), identity);
        assert_eq!(reconcile(rotated, absent), rotated);
        assert_eq!(reconcile(rotated, rotated), rotated);
        assert!(reconcile(identity, rotated).is_err());
        assert!(reconcile(parse_tag(1, None), identity).is_err());
        assert!(reconcile(identity, parse_tag(1, Some("invalid"))).is_err());
        assert_eq!(reconcile(absent, absent), absent);
    }
}

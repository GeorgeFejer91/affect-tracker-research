//! Runner naming v1: participant, authored version ordinal and UTC timestamp.
use super::RecorderStatus;
use crate::{
    research_error::{CommandError, ResearchResult},
    research_runner_session::{participant_label, RunnerDocument},
};
use time::{macros::format_description, OffsetDateTime};

pub(crate) fn variant_number(source: &str, variant_id: &str) -> ResearchResult<usize> {
    let document = RunnerDocument::read(source)?;
    let RunnerDocument::Master(loaded) = document else {
        return Err(CommandError::invalid_contract(
            "Version naming requires a master experiment.",
        ));
    };
    loaded.recipe.segment("P3")?["variants"]
        .as_array()
        .and_then(|variants| variants.iter().position(|v| v["variantId"] == variant_id))
        .map(|index| index + 1)
        .ok_or_else(|| {
            CommandError::invalid_contract("The selected version is absent from this experiment.")
        })
}
pub(crate) fn file_name(
    participant: &str,
    version: usize,
    now: OffsetDateTime,
) -> ResearchResult<String> {
    crate::research_runner_master::validate_master_participant(participant)?;
    if version == 0 {
        return Err(CommandError::invalid_contract(
            "Version numbers start at one.",
        ));
    }
    let stamp = now
        .to_offset(time::UtcOffset::UTC)
        .format(format_description!(
            "[year][month][day]T[hour][minute][second][subsecond digits:9]Z"
        ))
        .map_err(|_| CommandError::invalid_contract("Recording timestamp is unavailable."))?;
    Ok(format!(
        "{}_V{version}_{stamp}.xdf",
        participant_label(participant)?
    ))
}
// Deliberately inspect names only: a file is a use, not proof of a completed run.
pub(crate) fn parse_file_name(name: &str) -> Option<(String, usize)> {
    let stem = name.strip_suffix(".xdf")?;
    let parts: Vec<_> = stem.split('_').collect();
    let [participant, version, stamp] = parts.as_slice() else {
        return None;
    };
    let digits = participant.strip_prefix('P')?;
    let number: u32 = digits.parse().ok()?;
    let canonical = format!("P{number:03}");
    if crate::research_runner_master::validate_master_participant(&canonical).is_err()
        || participant_label(&canonical).ok()? != *participant
    {
        return None;
    }
    let ordinal: usize = version.strip_prefix('V')?.parse().ok()?;
    if ordinal == 0 || format!("V{ordinal}") != *version {
        return None;
    }
    // Accept milliseconds or nanoseconds for portable, filename-only inventories.
    if ![19, 25].contains(&stamp.len())
        || stamp.as_bytes()[8] != b'T'
        || !stamp.ends_with('Z')
        || !stamp
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 8 || i == stamp.len() - 1 || b.is_ascii_digit())
    {
        return None;
    }
    let year = stamp[0..4].parse::<i32>().ok()?;
    let month = time::Month::try_from(stamp[4..6].parse::<u8>().ok()?).ok()?;
    time::Date::from_calendar_date(year, month, stamp[6..8].parse().ok()?).ok()?;
    time::Time::from_hms(
        stamp[9..11].parse().ok()?,
        stamp[11..13].parse().ok()?,
        stamp[13..15].parse().ok()?,
    )
    .ok()?;
    Some((canonical, ordinal))
}
pub(crate) fn validate_selection(
    status: &RecorderStatus,
    source: &str,
    participant: &str,
    variant_id: &str,
) -> ResearchResult<()> {
    if status.active {
        if let Some((recorded_participant, ordinal)) =
            status.file_name.as_deref().and_then(parse_file_name)
        {
            if recorded_participant != participant || ordinal != variant_number(source, variant_id)?
            {
                return Err(CommandError::forbidden("The active XDF belongs to another participant or version. Stop recording before changing the selection."));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_round_trip_and_invalid_names_are_not_usage() {
        let name = file_name(
            "P001",
            2,
            time::macros::datetime!(2026-09-13 14:30:52.123 UTC),
        )
        .unwrap();
        assert_eq!(name, "P01_V2_20260913T143052123000000Z.xdf");
        assert_eq!(parse_file_name(&name), Some(("P001".into(), 2)));
        assert_eq!(
            parse_file_name("P100000_V123_20260913T143052123Z.xdf"),
            Some(("P100000".into(), 123))
        );
        for wrong in [
            "P001_V1_20260913T143052123Z.xdf",
            "P00_V1_20260913T143052123Z.xdf",
            "P01_V0_20260913T143052123Z.xdf",
            "P01_V01_20260913T143052123Z.xdf",
            "P01_V1_20260230T143052123Z.xdf",
            "P01_V1_20260913T253052123Z.xdf",
            "P01_V1_timestamp.xdf",
            "recording-old.xdf",
            "P01_V1_20260913T143052123Z.xdf.recording.json",
        ] {
            assert!(parse_file_name(wrong).is_none(), "{wrong}");
        }
        assert!(file_name("../P001", 1, OffsetDateTime::now_utc()).is_err());
        assert!(file_name("P001", 0, OffsetDateTime::now_utc()).is_err());
    }
    #[test]
    fn active_named_recording_cannot_be_relabelled_by_start() {
        let source = include_str!("../../../test/fixtures/runner-master-v3-owner.canonical.json");
        let status = RecorderStatus {
            active: true,
            file_name: Some("P01_V1_20260913T143052123Z.xdf".into()),
            ..RecorderStatus::default()
        };
        assert!(validate_selection(&status, source, "P001", "variant-3").is_ok());
        assert!(validate_selection(&status, source, "P002", "variant-3").is_err());
        assert!(validate_selection(&status, source, "P001", "variant-2").is_err());
        assert!(variant_number(source, "missing").is_err());
    }
}

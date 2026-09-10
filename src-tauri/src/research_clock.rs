//! Shared native monotonic and canonical wall-clock projections.

use crate::research_error::{CommandError, ResearchResult};
use std::time::{Duration, Instant};
use time::macros::format_description;
use time::OffsetDateTime;

pub(crate) fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

pub(crate) fn monotonic_ns(offset_ns: u128, epoch: Instant, now: Instant) -> String {
    offset_ns
        .saturating_add(now.duration_since(epoch).as_nanos())
        .to_string()
}

pub(crate) fn wall_time_now() -> ResearchResult<String> {
    format_wall_time(OffsetDateTime::now_utc())
}

pub(crate) fn format_wall_time(time: OffsetDateTime) -> ResearchResult<String> {
    time.format(format_description!(
        "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
    ))
    .map_err(|_| CommandError::io("The native wall-clock timestamp could not be formatted."))
}

pub(crate) fn session_timestamp(time: OffsetDateTime) -> ResearchResult<String> {
    time.format(format_description!(
        "[year][month][day]T[hour][minute][second][subsecond digits:3]Z"
    ))
    .map_err(|_| CommandError::io("The native session timestamp could not be formatted."))
}

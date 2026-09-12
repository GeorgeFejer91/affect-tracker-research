//! RR-11: opt-in experimenter authority. No participant input or file API.
pub mod auth;
pub mod commands;
pub mod monitor;
mod service;
pub use service::*;
type Result<T> = crate::research_error::ResearchResult<T>;
fn error(code: &str) -> crate::research_error::CommandError {
    crate::research_error::CommandError::new(
        code,
        "Professor operation is unavailable; check the local Runner.",
    )
}

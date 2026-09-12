//! Independent software correspondence probe; does not execute a session.
use affect_research::research_runner_master::{MasterSelector, PreparedMaster};
use serde::Deserialize;
use std::io::Read;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    source_text: String,
    participant_id: String,
    selector: MasterSelector,
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Request exceeds bound".into());
    }
    let request: Request = serde_json::from_slice(&bytes)?;
    let prepared = PreparedMaster::read(
        &request.source_text,
        &request.participant_id,
        request.selector,
    )
    .map_err(|e| e.message)?;
    println!("{}", serde_json::to_string(&prepared.plan)?);
    Ok(())
}

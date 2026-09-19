//! Runner-owned recording policy. No recording fields are added to Planner recipes.
pub mod commands;
pub(crate) mod naming;
#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
mod service;
#[cfg(any(test, all(feature = "lsl-streaming", target_os = "windows")))]
mod xdf;

use crate::research_error::{CommandError, ResearchResult};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordStartRequest {
    pub experiment_package_source_text: String,
    pub record_own: bool,
    pub discovery_revision: Option<String>,
    pub stream_keys: Vec<String>,
}

impl RecordStartRequest {
    pub fn validate(&self) -> ResearchResult<String> {
        let loaded = crate::research_runner_session::RunnerDocument::read(
            &self.experiment_package_source_text,
        )?;
        if self.stream_keys.len() > 16
            || (!self.record_own && self.stream_keys.is_empty())
            || self
                .stream_keys
                .iter()
                .any(|key| uuid::Uuid::parse_str(key).is_err())
            || self
                .stream_keys
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.stream_keys.len()
            || (!self.stream_keys.is_empty() && self.discovery_revision.is_none())
        {
            return Err(CommandError::invalid_contract(
                "Select own streams and/or up to 16 distinct discovered streams.",
            ));
        }
        if self.record_own && !loaded.lsl_enabled() {
            return Err(CommandError::invalid_contract("This recipe disables LSL output. Choose external streams only, or author a recipe with LSL output enabled."));
        }
        Ok(loaded.source_hash().into())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    pub schema: &'static str,
    pub version: u8,
    pub available: bool,
    pub active: bool,
    pub phase: String,
    pub recording_id: Option<String>,
    pub recipe_sha256: Option<String>,
    pub run_id: Option<String>,
    pub file_name: Option<String>,
    pub record_own: bool,
    pub external_stream_count: usize,
    pub sample_count: u64,
    pub error: Option<String>,
}
impl Default for RecorderStatus {
    fn default() -> Self {
        Self {
            schema: "affect-research-runner-recording",
            version: 1,
            available: cfg!(all(feature = "lsl-streaming", target_os = "windows")),
            active: false,
            phase: "idle".into(),
            recording_id: None,
            recipe_sha256: None,
            run_id: None,
            file_name: None,
            record_own: false,
            external_stream_count: 0,
            sample_count: 0,
            error: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChoice {
    pub key: String,
    pub name: String,
    pub stream_type: String,
    pub source_id: String,
    pub hostname: String,
    pub channel_count: usize,
    pub nominal_rate: f64,
    pub channel_format: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub revision: String,
    pub streams: Vec<StreamChoice>,
}

#[cfg(all(feature = "lsl-streaming", target_os = "windows"))]
pub use service::{OwnRecording, RecorderService};

#[cfg(not(all(feature = "lsl-streaming", target_os = "windows")))]
#[derive(Default)]
pub struct RecorderService {
    _private: (),
}
#[cfg(not(all(feature = "lsl-streaming", target_os = "windows")))]
impl RecorderService {
    pub fn status(&self) -> RecorderStatus {
        RecorderStatus::default()
    }
    pub fn discover(&self) -> ResearchResult<Discovery> {
        Err(CommandError::forbidden(
            "LSL recording is unavailable in this build.",
        ))
    }
    pub fn start_path(
        &self,
        _: RecordStartRequest,
        _: std::path::PathBuf,
    ) -> ResearchResult<RecorderStatus> {
        Err(CommandError::forbidden(
            "LSL recording is unavailable in this build.",
        ))
    }
    pub fn stop(&self) -> ResearchResult<RecorderStatus> {
        Ok(self.status())
    }
    pub fn shutdown(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recording_policy_is_separate_and_closed() {
        let text = include_str!("../../../test/fixtures/experiment-package-v1.canonical.json");
        let mut request = RecordStartRequest {
            experiment_package_source_text: text.into(),
            record_own: false,
            discovery_revision: None,
            stream_keys: vec![],
        };
        assert!(request.validate().is_err());
        request.stream_keys = vec![uuid::Uuid::new_v4().to_string()];
        assert!(request.validate().is_err());
        request.discovery_revision = Some(uuid::Uuid::new_v4().to_string());
        assert_eq!(request.validate().unwrap().len(), 64);
        request.stream_keys.push(request.stream_keys[0].clone());
        assert!(request.validate().is_err());
        assert!(serde_json::from_value::<RecordStartRequest>(serde_json::json!({"experimentPackageSourceText":text,"recordOwn":false,"streamKeys":[],"discoveryRevision":null,"recordAll":true})).is_err());
    }
}

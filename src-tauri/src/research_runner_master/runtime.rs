//! Runner master wire contracts and a fail-closed session authority.
use super::MasterSelector;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_participant::{validate_participant_code, TransientParticipant};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterStartRequest {
    pub workspace_id: String,
    pub source_text: String,
    pub participant: TransientParticipant,
    pub selector: MasterSelector,
    pub rerun_confirmed: bool,
    pub input_test_receipt_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterStartRequestV2 {
    pub version: u32,
    pub workspace_id: String,
    pub source_text: String,
    pub participant_id: String,
    pub selector: MasterSelector,
    pub rerun_confirmed: bool,
    pub input_test_receipt_id: String,
}

/// Separate wire entrypoint; the typed participant/answer meaning remains v2.
#[derive(Debug, Deserialize)]
#[serde(transparent)]
pub struct MasterStartRequestV3(pub MasterStartRequestV2);
#[derive(Debug, Deserialize)]
#[serde(transparent)]
pub struct MasterStartRequestV4(pub MasterStartRequestV2);
#[derive(Debug, Deserialize)]
#[serde(transparent)]
pub struct MasterStartRequestV5(pub MasterStartRequestV2);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterActionRequestV5 {
    pub version: u32,
    pub run_id: String,
    pub action: MasterActionV4,
}
impl MasterActionRequestV5 {
    pub(crate) fn validate(&self) -> ResearchResult<()> {
        require_wire_version(self.version, 5)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterActionRequestV4 {
    pub version: u32,
    pub run_id: String,
    pub action: MasterActionV4,
}
impl MasterActionRequestV4 {
    pub(crate) fn validate(&self) -> ResearchResult<()> {
        require_wire_version(self.version, 4)
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum MasterActionV4 {
    Presented {
        position: u32,
    },
    Draft {
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
    },
    Submit {
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
    },
    #[serde(rename_all = "camelCase")]
    SurveyDraft {
        position: u32,
        data: Value,
        page_no: u32,
    },
    #[serde(rename_all = "camelCase")]
    SurveySubmit {
        position: u32,
        data: Value,
        page_no: u32,
    },
    Pause,
    Resume,
    Stop,
}
impl From<MasterActionV4> for MasterAction {
    fn from(value: MasterActionV4) -> Self {
        match value {
            MasterActionV4::Presented { position } => Self::Presented { position },
            MasterActionV4::Draft { position, answers } => Self::DraftV2 { position, answers },
            MasterActionV4::Submit { position, answers } => Self::SubmitV2 { position, answers },
            MasterActionV4::SurveyDraft {
                position,
                data,
                page_no,
            } => Self::SurveyDraft {
                position,
                data,
                page_no,
            },
            MasterActionV4::SurveySubmit {
                position,
                data,
                page_no,
            } => Self::SurveySubmit {
                position,
                data,
                page_no,
            },
            MasterActionV4::Pause => Self::Pause,
            MasterActionV4::Resume => Self::Resume,
            MasterActionV4::Stop => Self::Stop,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterActionRequestV3 {
    pub version: u32,
    pub run_id: String,
    pub action: MasterActionV2,
}
impl MasterActionRequestV3 {
    pub(crate) fn validate(&self) -> ResearchResult<()> {
        require_wire_version(self.version, 3)
    }
}
fn require_wire_version(actual: u32, expected: u32) -> ResearchResult<()> {
    if actual != expected {
        return Err(CommandError::invalid_contract(
            "Master command wire version does not match its entrypoint.",
        ));
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterValidationStartRequest {
    pub version: u32,
    pub acknowledge_unqualified: bool,
    pub experiment: MasterStartRequestV2,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterValidationStartRequestV5 {
    pub version: u32,
    pub acknowledge_unqualified: bool,
    pub experiment: MasterStartRequestV5,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MasterPhase {
    AwaitingPresentation,
    Questionnaire,
    Interval,
    Preparing,
    Playing,
    Pausing,
    Paused,
    Resuming,
    Finished,
    Failed,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStatus {
    pub schema: &'static str,
    pub version: u32,
    pub active: bool,
    pub run_id: String,
    pub attempt_id: String,
    pub participant_id: String,
    pub recipe_source_byte_sha256: String,
    pub plan_identity_sha256: String,
    pub phase: MasterPhase,
    pub position: u32,
    pub step_count: u32,
    pub completed_step_count: u32,
    // V1 serializes strings; V2 serializes closed tagged values, never a guessed union.
    pub answers: std::collections::BTreeMap<String, Value>,
    pub sample_count: u64,
    pub event_count: u64,
    pub missed_slot_count: u64,
    pub current_valence: f64,
    pub current_arousal: f64,
    pub input_active: bool,
    pub interval_remaining_ms: Option<f64>,
    pub media_time_ms: Option<f64>,
    pub failure_code: Option<String>,
    pub result: Option<Value>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterChoice {
    pub item_id: String,
    pub option_id: String,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum MasterAction {
    Presented {
        position: u32,
    },
    Draft {
        position: u32,
        answers: Vec<MasterChoice>,
    },
    Submit {
        position: u32,
        answers: Vec<MasterChoice>,
    },
    Pause,
    Resume,
    Stop,
    #[serde(skip)]
    DraftV2 {
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
    },
    #[serde(skip)]
    SubmitV2 {
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
    },
    #[serde(skip)]
    SurveyDraft {
        position: u32,
        data: Value,
        page_no: u32,
    },
    #[serde(skip)]
    SurveySubmit {
        position: u32,
        data: Value,
        page_no: u32,
    },
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum MasterActionV2 {
    Presented {
        position: u32,
    },
    Draft {
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
    },
    Submit {
        position: u32,
        answers: Vec<super::typed_forms::TypedChoice>,
    },
    Pause,
    Resume,
    Stop,
}
impl From<MasterActionV2> for MasterAction {
    fn from(value: MasterActionV2) -> Self {
        match value {
            MasterActionV2::Presented { position } => Self::Presented { position },
            MasterActionV2::Draft { position, answers } => Self::DraftV2 { position, answers },
            MasterActionV2::Submit { position, answers } => Self::SubmitV2 { position, answers },
            MasterActionV2::Pause => Self::Pause,
            MasterActionV2::Resume => Self::Resume,
            MasterActionV2::Stop => Self::Stop,
        }
    }
}
/// The historical native Start commands remain registered for stable wire
/// errors. Runner sessions use the HTML path; this authority cannot start one.
pub(crate) const RUNNER_START_UNAVAILABLE_REASON: &str =
    "runner-html-playback-lifecycle-not-yet-wired";

pub struct MasterRuntime;

impl MasterRuntime {
    pub(crate) fn new() -> Self {
        Self
    }

    pub fn start(
        &self,
        request: MasterStartRequest,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        validate_participant_code(&request.participant.participant_code)?;
        if !(1..=120).contains(&request.participant.age) {
            return Err(CommandError::invalid_contract(
                "Participant age must be within 1–120.",
            ));
        }
        Err(start_unavailable())
    }

    pub fn start_v2(
        &self,
        request: MasterStartRequestV2,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.version, 2)?;
        self.start_typed(request)
    }

    pub fn start_v3(
        &self,
        request: MasterStartRequestV3,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.0.version, 3)?;
        self.start_typed(request.0)
    }

    pub fn start_v4(
        &self,
        request: MasterStartRequestV4,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.0.version, 4)?;
        self.start_typed(request.0)
    }

    pub fn start_v5(
        &self,
        request: MasterStartRequestV5,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.0.version, 5)?;
        self.start_typed(request.0)
    }

    fn start_typed(&self, request: MasterStartRequestV2) -> ResearchResult<Value> {
        super::validate_master_participant(&request.participant_id)?;
        Err(start_unavailable())
    }

    pub fn start_validation(
        &self,
        request: MasterValidationStartRequest,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.version, 1)?;
        if ![3, 4].contains(&request.experiment.version) {
            return Err(CommandError::invalid_contract(
                "Validation sessions require master3 or master4.",
            ));
        }
        if !request.acknowledge_unqualified {
            return Err(CommandError::forbidden(
                "Explicit unqualified validation acknowledgement is required.",
            ));
        }
        self.start_typed(request.experiment)
    }

    pub fn start_validation_v5(
        &self,
        request: MasterValidationStartRequestV5,
        _window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.version, 1)?;
        require_wire_version(request.experiment.0.version, 5)?;
        if !request.acknowledge_unqualified {
            return Err(CommandError::forbidden(
                "Explicit unqualified validation acknowledgement is required.",
            ));
        }
        self.start_typed(request.experiment.0)
    }

    pub fn status(&self) -> Option<MasterStatus> {
        None
    }

    pub(crate) fn require_version(&self, _run_id: &str, _version: u32) -> ResearchResult<()> {
        Err(CommandError::no_active_run())
    }

    pub(crate) fn validate_window(
        &self,
        _run_id: &str,
        _window: (u32, u32, f64),
        _fullscreen: bool,
    ) -> ResearchResult<()> {
        Err(CommandError::no_active_run())
    }

    pub fn action(&self, _run_id: &str, _action: MasterAction) -> ResearchResult<MasterStatus> {
        Err(CommandError::no_active_run())
    }

    pub fn shutdown(&self) {}

    pub fn is_stopped(&self) -> bool {
        true
    }

    pub fn join_stopped(&self) -> ResearchResult<()> {
        Ok(())
    }
}

fn start_unavailable() -> CommandError {
    CommandError::new(
        "runner_session_unavailable",
        "Runner HTML playback cannot start a session until its timing, input, and recording lifecycle is implemented.",
    )
}

#[cfg(test)]
mod fail_closed_tests {
    use super::*;

    fn request(version: u32) -> MasterStartRequestV2 {
        MasterStartRequestV2 {
            version,
            workspace_id: "workspace-test".into(),
            source_text: "untrusted".into(),
            participant_id: "P001".into(),
            selector: MasterSelector {
                variant_id: "variant-1".into(),
                language_id: "en".into(),
                language_selection_path: vec!["en".into()],
                presentation_target: "desktop-screen".into(),
            },
            rerun_confirmed: false,
            input_test_receipt_id: "test".into(),
        }
    }

    #[test]
    fn all_typed_start_entrypoints_fail_closed_without_creating_a_run() {
        let runtime = MasterRuntime;
        let window = (1920, 1080, 1.0);
        for result in [
            runtime.start_v2(request(2), window),
            runtime.start_v3(MasterStartRequestV3(request(3)), window),
            runtime.start_v4(MasterStartRequestV4(request(4)), window),
            runtime.start_v5(MasterStartRequestV5(request(5)), window),
            runtime.start_validation(
                MasterValidationStartRequest {
                    version: 1,
                    acknowledge_unqualified: true,
                    experiment: request(3),
                },
                window,
            ),
            runtime.start_validation_v5(
                MasterValidationStartRequestV5 {
                    version: 1,
                    acknowledge_unqualified: true,
                    experiment: MasterStartRequestV5(request(5)),
                },
                window,
            ),
        ] {
            assert_eq!(result.unwrap_err().code, "runner_session_unavailable");
        }
        assert!(runtime.status().is_none());
        assert_eq!(
            runtime
                .action("run-test", MasterAction::Stop)
                .unwrap_err()
                .code,
            "no_active_run"
        );
        assert!(runtime.is_stopped());
        runtime.join_stopped().unwrap();
    }
}

#[cfg(test)]
mod versioned_ingress_tests {
    use super::*;
    #[test]
    fn start_v2_has_only_participant_id_and_action_values_are_closed() {
        let request = json!({"version":2,"workspaceId":"workspace-test","sourceText":"untrusted","participantId":"P001","selector":{"variantId":"variant-1","languageId":"en","languageSelectionPath":["en"],"presentationTarget":"desktop-screen"},"rerunConfirmed":false,"inputTestReceiptId":"test"});
        assert!(serde_json::from_value::<MasterStartRequestV2>(request.clone()).is_ok());
        assert!(serde_json::from_value::<MasterStartRequest>(request.clone()).is_err());
        for field in ["participant", "fullName", "age", "participantCode"] {
            let mut wrong = request.clone();
            wrong[field] = json!("unexpected");
            assert!(serde_json::from_value::<MasterStartRequestV2>(wrong).is_err());
        }
        let action = json!({"type":"submit","position":1,"answers":[{"itemId":"age","value":{"kind":"integer","integer":0}}]});
        assert!(serde_json::from_value::<MasterActionV2>(action.clone()).is_ok());
        assert!(serde_json::from_value::<MasterAction>(action.clone()).is_err());
        for value in [
            json!({"kind":"integer","integer":"1"}),
            json!({"kind":"integer","integer":1.5}),
            json!({"kind":"singleChoice","optionId":"male","scoreValue":9}),
        ] {
            let mut wrong = action.clone();
            wrong["answers"][0]["value"] = value;
            assert!(serde_json::from_value::<MasterActionV2>(wrong).is_err());
        }
    }
}

#[cfg(test)]
mod v3_ingress_tests {
    use super::*;
    #[test]
    fn v3_wire_versions_are_not_v2_aliases() {
        for expected in [2, 3] {
            for actual in [0, 1, 2, 3, 4] {
                assert_eq!(
                    require_wire_version(actual, expected).is_ok(),
                    actual == expected
                );
            }
        }
        let value = json!({"version":3,"runId":"run-test","action":{"type":"submit","position":1,"answers":[{"itemId":"name","value":{"kind":"text","text":"Fictitious"}}]}});
        let request: MasterActionRequestV3 = serde_json::from_value(value.clone()).unwrap();
        request.validate().unwrap();
        assert!(serde_json::from_value::<MasterActionV2>(value.clone()).is_err());
        for key in ["unexpected", "participant"] {
            let mut wrong = value.clone();
            wrong[key] = json!({});
            assert!(serde_json::from_value::<MasterActionRequestV3>(wrong).is_err());
        }
        let mut wrong = value;
        wrong["version"] = json!(2);
        assert!(serde_json::from_value::<MasterActionRequestV3>(wrong)
            .unwrap()
            .validate()
            .is_err());
    }
}

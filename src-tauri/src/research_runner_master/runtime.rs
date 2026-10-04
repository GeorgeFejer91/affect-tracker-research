//! Runner master wire contracts and an HTML validation session authority.
use super::{
    html_session::MasterWorker, markers::MasterMarkers, storage::MasterStorage, MasterSelector,
    PreparedMaster,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_input::ResearchInputService;
use crate::research_native_protocol::{
    input_mailbox::ProtocolInputMailbox, runtime::PackageProtocolRuntime,
};
use crate::research_participant::{validate_participant_code, TransientParticipant};
use crate::research_recorder::RecorderService;
use crate::research_workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{
    mpsc::{self, SyncSender},
    Arc, Mutex, MutexGuard,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

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
    pub action: MasterActionV5,
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

/// Master5 extends the action wire with observations of the actual HTML element.
/// A grant is never accepted from this wire; Rust registers only grants it issued.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum MasterActionV5 {
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
    VideoPlaying {
        position: u32,
        media_grant_id: String,
    },
    VideoPaused {
        position: u32,
        media_grant_id: String,
    },
    VideoEnded {
        position: u32,
        media_grant_id: String,
    },
    VideoFailed {
        position: u32,
        media_grant_id: String,
    },
}
impl From<MasterActionV5> for MasterAction {
    fn from(value: MasterActionV5) -> Self {
        match value {
            MasterActionV5::Presented { position } => Self::Presented { position },
            MasterActionV5::Draft { position, answers } => Self::DraftV2 { position, answers },
            MasterActionV5::Submit { position, answers } => Self::SubmitV2 { position, answers },
            MasterActionV5::SurveyDraft {
                position,
                data,
                page_no,
            } => Self::SurveyDraft {
                position,
                data,
                page_no,
            },
            MasterActionV5::SurveySubmit {
                position,
                data,
                page_no,
            } => Self::SurveySubmit {
                position,
                data,
                page_no,
            },
            MasterActionV5::Pause => Self::Pause,
            MasterActionV5::Resume => Self::Resume,
            MasterActionV5::Stop => Self::Stop,
            MasterActionV5::VideoPlaying {
                position,
                media_grant_id,
            } => Self::VideoPlaying {
                position,
                media_grant_id,
            },
            MasterActionV5::VideoPaused {
                position,
                media_grant_id,
            } => Self::VideoPaused {
                position,
                media_grant_id,
            },
            MasterActionV5::VideoEnded {
                position,
                media_grant_id,
            } => Self::VideoEnded {
                position,
                media_grant_id,
            },
            MasterActionV5::VideoFailed {
                position,
                media_grant_id,
            } => Self::VideoFailed {
                position,
                media_grant_id,
            },
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
    #[serde(skip)]
    VideoGrant {
        position: u32,
        media_grant_id: String,
    },
    #[serde(skip)]
    VideoPlaying {
        position: u32,
        media_grant_id: String,
    },
    #[serde(skip)]
    VideoPaused {
        position: u32,
        media_grant_id: String,
    },
    #[serde(skip)]
    VideoEnded {
        position: u32,
        media_grant_id: String,
    },
    #[serde(skip)]
    VideoFailed {
        position: u32,
        media_grant_id: String,
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
pub(crate) type Message = (MasterAction, mpsc::Sender<ResearchResult<MasterStatus>>);

#[derive(Clone)]
pub(crate) struct InputAuthority {
    pub service: Arc<ResearchInputService>,
    pub id: String,
}
impl Drop for InputAuthority {
    fn drop(&mut self) {
        self.service.end_run(&self.id);
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

/// Research Start remains closed until the installed HTML session and XDF are
/// independently qualified. Master5 may run an explicitly unqualified session.
pub(crate) const RUNNER_START_UNAVAILABLE_REASON: &str = "runner-research-qualification-pending";

struct Active {
    run_id: String,
    workspace_id: String,
    sender: SyncSender<Message>,
    status: Arc<Mutex<MasterStatus>>,
    worker: JoinHandle<()>,
    authority: InputAuthority,
    cancellation: Arc<AtomicBool>,
    window: (u32, u32, f64),
}

pub struct MasterRuntime {
    workspace: Arc<WorkspaceService>,
    input: Arc<ResearchInputService>,
    recorder: Arc<RecorderService>,
    legacy: Arc<PackageProtocolRuntime>,
    active: Mutex<Option<Active>>,
}

impl MasterRuntime {
    pub(crate) fn new(
        workspace: Arc<WorkspaceService>,
        input: Arc<ResearchInputService>,
        recorder: Arc<RecorderService>,
        legacy: Arc<PackageProtocolRuntime>,
    ) -> Self {
        Self {
            workspace,
            input,
            recorder,
            legacy,
            active: Mutex::new(None),
        }
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
        window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.version, 1)?;
        require_wire_version(request.experiment.0.version, 5)?;
        if !request.acknowledge_unqualified {
            return Err(CommandError::forbidden(
                "Explicit unqualified validation acknowledgement is required.",
            ));
        }
        self.start_html_validation(request.experiment.0, window)
    }

    fn start_html_validation(
        &self,
        request: MasterStartRequestV2,
        window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        super::validate_master_participant(&request.participant_id)?;
        let mut active = lock(&self.active);
        if active.as_ref().is_some_and(|run| !run.worker.is_finished()) {
            return Err(CommandError::run_active());
        }
        if let Some(previous) = active.take() {
            previous
                .worker
                .join()
                .map_err(|_| CommandError::forbidden("Previous Runner worker panicked."))?;
        }
        self.legacy.begin_companion(|lease| {
            crate::research_platform::require_native_acquisition(
                crate::research_platform::NATIVE_ACQUISITION_SUPPORTED,
            )?;
            let prepared = PreparedMaster::read(
                &request.source_text,
                &request.participant_id,
                request.selector,
            )?;
            if prepared.plan.version != 5 {
                return Err(CommandError::invalid_contract(
                    "HTML validation requires master5.",
                ));
            }
            let viewport = &prepared.layout.viewport;
            if !window.2.is_finite()
                || window.2 <= 0.
                || f64::from(window.0) / window.2 != viewport.width_css_px
                || f64::from(window.1) / window.2 != viewport.height_css_px
            {
                return Err(CommandError::forbidden(
                    "The fullscreen viewport must exactly match the saved desktop layout.",
                ));
            }
            self.workspace
                .with_workspace(&request.workspace_id, |root, _| {
                    crate::research_planner_recipe_file::verify_loaded_questionnaire_assets(
                        root,
                        &prepared.loaded,
                    )
                })?;
            super::commands::verified_video_bindings(
                &self.workspace,
                &request.workspace_id,
                &prepared,
            )?;
            let recording = self.recorder.status();
            crate::research_recorder::naming::validate_selection(
                &recording,
                &request.source_text,
                &request.participant_id,
                &prepared.plan.selector.variant_id,
            )?;
            if recording.active
                && recording.recipe_sha256.as_deref()
                    != Some(&prepared.plan.recipe_source_byte_sha256)
            {
                return Err(CommandError::forbidden(
                    "The recorder belongs to a different experiment JSON.",
                ));
            }
            let run_id = format!("run-{}", uuid::Uuid::new_v4());
            MasterMarkers::new(&prepared.plan, &run_id, "attempt-preflight")?;
            let mailbox = Arc::new(ProtocolInputMailbox::new(prepared.feedback.input.kind));
            let sink = Arc::clone(&mailbox);
            let authority = InputAuthority {
                service: Arc::clone(&self.input),
                id: self.input.prepare_run_full(
                    prepared.feedback.input.clone(),
                    &request.input_test_receipt_id,
                    move |update| sink.push(update),
                )?,
            };
            let storage = self
                .workspace
                .with_workspace(&request.workspace_id, |root, _| {
                    MasterStorage::create_with_validation(
                        root,
                        &prepared,
                        &run_id,
                        Value::Null,
                        request.rerun_confirmed,
                        true,
                    )
                })?;
            let receipt = storage.receipt.clone();
            let (sender, receiver) = mpsc::sync_channel(32);
            let mut worker = MasterWorker::new(
                prepared,
                storage,
                authority.clone(),
                mailbox,
                Arc::clone(&self.recorder),
                lease,
            )?;
            let status = Arc::clone(&worker.public);
            let cancellation = Arc::clone(&worker.cancellation);
            let handle = thread::Builder::new()
                .name("runner-master-html".into())
                .spawn(move || {
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        worker.run(receiver)
                    }));
                    if result.is_err() {
                        worker.fail("master-worker-panicked");
                    }
                })
                .map_err(CommandError::io)?;
            *active = Some(Active {
                run_id,
                workspace_id: request.workspace_id.clone(),
                sender,
                status,
                worker: handle,
                authority,
                cancellation,
                window,
            });
            Ok(receipt)
        })
    }

    pub fn status(&self) -> Option<MasterStatus> {
        lock(&self.active)
            .as_ref()
            .map(|run| lock(&run.status).clone())
    }

    pub(crate) fn validate_media_request(
        &self,
        run_id: Option<&str>,
        workspace_id: &str,
        prepared: &PreparedMaster,
        position: u32,
    ) -> ResearchResult<()> {
        let active = lock(&self.active);
        let Some(run) = active.as_ref().filter(|run| !run.worker.is_finished()) else {
            if run_id.is_some() {
                return Err(CommandError::no_active_run());
            }
            return Ok(());
        };
        let status = lock(&run.status);
        if run_id != Some(run.run_id.as_str())
            || run.workspace_id != workspace_id
            || status.recipe_source_byte_sha256 != prepared.plan.recipe_source_byte_sha256
            || status.plan_identity_sha256 != prepared.plan.plan_identity_sha256
            || status.participant_id != prepared.plan.participant_id
            || status.position != position
            || status.phase != MasterPhase::Preparing
        {
            return Err(CommandError::forbidden(
                "HTML media selection does not belong to the active saved occurrence.",
            ));
        }
        Ok(())
    }

    pub(crate) fn register_media_grant(
        &self,
        run_id: &str,
        position: u32,
        media_grant_id: String,
    ) -> ResearchResult<()> {
        self.require_version(run_id, 5)?;
        self.action(
            run_id,
            MasterAction::VideoGrant {
                position,
                media_grant_id,
            },
        )?;
        Ok(())
    }

    pub(crate) fn require_version(&self, run_id: &str, version: u32) -> ResearchResult<()> {
        let active = lock(&self.active);
        let run = active
            .as_ref()
            .filter(|run| run.run_id == run_id)
            .ok_or_else(CommandError::no_active_run)?;
        if lock(&run.status).version != version {
            return Err(CommandError::invalid_contract(
                "The command version does not match this master attempt.",
            ));
        }
        Ok(())
    }

    pub(crate) fn validate_window(
        &self,
        run_id: &str,
        window: (u32, u32, f64),
        fullscreen: bool,
    ) -> ResearchResult<()> {
        let active = lock(&self.active);
        let run = active
            .as_ref()
            .filter(|run| run.run_id == run_id)
            .ok_or_else(CommandError::no_active_run)?;
        if !fullscreen || run.window != window {
            run.authority.service.end_run(&run.authority.id);
            run.cancellation.store(true, Ordering::Release);
            return Err(CommandError::forbidden(
                "The native fullscreen viewport no longer matches this attempt.",
            ));
        }
        Ok(())
    }

    pub fn action(&self, run_id: &str, action: MasterAction) -> ResearchResult<MasterStatus> {
        let (sender, receiver) = mpsc::channel();
        {
            let active = lock(&self.active);
            let run = active
                .as_ref()
                .filter(|run| run.run_id == run_id && !run.worker.is_finished())
                .ok_or_else(CommandError::no_active_run)?;
            run.sender.try_send((action, sender)).map_err(|_| {
                CommandError::forbidden("Master command queue is unavailable or full.")
            })?;
        }
        receiver.recv_timeout(Duration::from_secs(30)).map_err(|_| {
            CommandError::forbidden("Master command acknowledgement is unavailable; check native session status before retrying.")
        })?
    }

    pub fn shutdown(&self) {
        if let Some(run) = lock(&self.active).as_ref() {
            run.authority.service.end_run(&run.authority.id);
            run.cancellation.store(true, Ordering::Release);
        }
    }

    pub fn is_stopped(&self) -> bool {
        lock(&self.active)
            .as_ref()
            .is_none_or(|run| run.worker.is_finished())
    }

    pub fn join_stopped(&self) -> ResearchResult<()> {
        let mut active = lock(&self.active);
        if active.as_ref().is_some_and(|run| !run.worker.is_finished()) {
            return Err(CommandError::forbidden(
                "Master worker teardown is still pending.",
            ));
        }
        if let Some(run) = active.take() {
            run.worker
                .join()
                .map_err(|_| CommandError::forbidden("Master worker teardown panicked."))?;
        }
        Ok(())
    }
}

fn start_unavailable() -> CommandError {
    CommandError::new(
        "runner_session_unavailable",
        "Research Start is pending installed HTML playback and recording qualification; master5 local validation is available.",
    )
}

#[cfg(test)]
mod fail_closed_tests {
    use super::*;
    use crate::research_native_media::NativeMediaService;

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
        let root = std::env::temp_dir().join(format!("runner-runtime-{}", uuid::Uuid::new_v4()));
        let workspace = Arc::new(WorkspaceService::new(root.clone()).unwrap());
        let input = Arc::new(ResearchInputService::for_tests());
        let recorder = Arc::new(RecorderService::default());
        let legacy = Arc::new(PackageProtocolRuntime::with_services(
            Arc::clone(&workspace),
            Arc::new(NativeMediaService::unavailable_for_tests()),
            Arc::clone(&input),
        ));
        let runtime = MasterRuntime::new(workspace, input, recorder, legacy);
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
        ] {
            assert_eq!(result.unwrap_err().code, "runner_session_unavailable");
        }
        assert_eq!(
            runtime
                .start_validation_v5(
                    MasterValidationStartRequestV5 {
                        version: 1,
                        acknowledge_unqualified: true,
                        experiment: MasterStartRequestV5(request(5))
                    },
                    window,
                )
                .unwrap_err()
                .code,
            "invalid_research_contract"
        );
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
        std::fs::remove_dir_all(root).unwrap();
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

#[cfg(test)]
mod html_ingress_tests {
    use super::*;

    #[test]
    fn master5_accepts_observed_video_edges_but_never_a_caller_grant() {
        let edge = json!({"version":5,"runId":"run-test","action":{
            "type":"videoEnded","position":3,"mediaGrantId":"a".repeat(32)
        }});
        let request: MasterActionRequestV5 = serde_json::from_value(edge.clone()).unwrap();
        request.validate().unwrap();
        assert!(matches!(
            request.action,
            MasterActionV5::VideoEnded { position: 3, .. }
        ));
        assert!(serde_json::from_value::<MasterActionRequestV4>(edge.clone()).is_err());
        for action in [
            json!({"type":"videoGrant","position":3,"mediaGrantId":"a".repeat(32)}),
            json!({"type":"videoEnded","position":3,"mediaGrantId":"a".repeat(32),"sourceRelativePath":"other.mp4"}),
        ] {
            let mut wrong = edge.clone();
            wrong["action"] = action;
            assert!(serde_json::from_value::<MasterActionRequestV5>(wrong).is_err());
        }
    }
}

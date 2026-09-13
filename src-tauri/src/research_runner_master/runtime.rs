//! Native master session authority, separate from the frozen package worker.
use super::{
    markers::MasterMarkers, storage::MasterStorage, worker::MasterWorker, MasterSelector,
    PreparedMaster,
};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_input::ResearchInputService;
use crate::research_native_media::{
    NativeMediaService, NativeMediaViewportCssV1, NativeMediaViewportPxV1, PlaybackMode,
    PlaybackQualification,
};
use crate::research_native_protocol::{
    input_mailbox::ProtocolInputMailbox, runtime::PackageProtocolRuntime,
};
use crate::research_participant::{validate_participant_code, TransientParticipant};
use crate::research_recorder::RecorderService;
use crate::research_workspace::WorkspaceService;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    sync::{
        mpsc::{self, SyncSender},
        Arc, Mutex, MutexGuard,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

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
    pub experiment: MasterStartRequestV3,
}

struct StartInput {
    validation: bool,
    version: u32,
    workspace_id: String,
    source_text: String,
    participant_id: String,
    participant: Value,
    selector: MasterSelector,
    rerun_confirmed: bool,
    input_test_receipt_id: String,
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
struct Active {
    run_id: String,
    sender: SyncSender<Message>,
    status: Arc<Mutex<MasterStatus>>,
    worker: JoinHandle<()>,
    authority: InputAuthority,
    cancellation: Arc<AtomicBool>,
    window: (u32, u32, f64),
}
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

pub struct MasterRuntime {
    pub(crate) workspace: Arc<WorkspaceService>,
    pub(crate) media: Arc<NativeMediaService>,
    pub(crate) input: Arc<ResearchInputService>,
    pub(crate) recorder: Arc<RecorderService>,
    legacy: Arc<PackageProtocolRuntime>,
    active: Mutex<Option<Active>>,
}
impl MasterRuntime {
    pub(crate) fn new(
        workspace: Arc<WorkspaceService>,
        media: Arc<NativeMediaService>,
        input: Arc<ResearchInputService>,
        recorder: Arc<RecorderService>,
        legacy: Arc<PackageProtocolRuntime>,
    ) -> Self {
        Self {
            workspace,
            media,
            input,
            recorder,
            legacy,
            active: Mutex::new(None),
        }
    }
    pub fn start(
        &self,
        request: MasterStartRequest,
        window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        let code = validate_participant_code(&request.participant.participant_code)?;
        if !(1..=120).contains(&request.participant.age) {
            return Err(CommandError::invalid_contract(
                "Participant age must be within 1–120.",
            ));
        }
        let participant = json!({"participantId":request.participant.participant_id,"participantCode":code,"age":request.participant.age,"gender":request.participant.gender,"handedness":request.participant.handedness});
        self.start_input(
            StartInput {
                validation: false,
                version: 1,
                workspace_id: request.workspace_id,
                source_text: request.source_text,
                participant_id: request.participant.participant_id,
                participant,
                selector: request.selector,
                rerun_confirmed: request.rerun_confirmed,
                input_test_receipt_id: request.input_test_receipt_id,
            },
            window,
        )
    }
    pub fn start_v2(
        &self,
        request: MasterStartRequestV2,
        window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.version, 2)?;
        self.start_typed(request, window)
    }
    pub fn start_v3(
        &self,
        request: MasterStartRequestV3,
        window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.0.version, 3)?;
        self.start_typed(request.0, window)
    }
    fn start_typed(
        &self,
        request: MasterStartRequestV2,
        window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        self.start_typed_mode(request, window, false)
    }
    pub fn start_validation(
        &self, request: MasterValidationStartRequest, window: (u32, u32, f64),
    ) -> ResearchResult<Value> {
        require_wire_version(request.version, 1)?;
        require_wire_version(request.experiment.0.version, 3)?;
        if !request.acknowledge_unqualified {
            return Err(CommandError::forbidden("Explicit unqualified validation acknowledgement is required."));
        }
        self.start_typed_mode(request.experiment.0, window, true)
    }
    fn start_typed_mode(
        &self, request: MasterStartRequestV2, window: (u32, u32, f64), validation: bool,
    ) -> ResearchResult<Value> {
        super::validate_master_participant(&request.participant_id)?;
        self.start_input(
            StartInput {
                validation,
                version: request.version,
                workspace_id: request.workspace_id,
                source_text: request.source_text,
                participant_id: request.participant_id,
                participant: Value::Null,
                selector: request.selector,
                rerun_confirmed: request.rerun_confirmed,
                input_test_receipt_id: request.input_test_receipt_id,
            },
            window,
        )
    }
    fn start_input(&self, request: StartInput, window: (u32, u32, f64)) -> ResearchResult<Value> {
        let mut active = lock(&self.active);
        if active.as_ref().is_some_and(|a| !a.worker.is_finished()) {
            return Err(CommandError::run_active());
        }
        if let Some(previous) = active.take() {
            let _ = previous.worker.join();
        }
        self.legacy.begin_companion(|lease| {
            crate::research_platform::require_native_acquisition(
                crate::research_platform::NATIVE_ACQUISITION_SUPPORTED,
            )?;
            if request.validation {
                require_validation_media(&self.media.capability())?;
            } else if self.media.authorize_playback(PlaybackMode::NativeGstPlay)?
                != PlaybackQualification::QualifiedNative
            {
                return Err(CommandError::native_media_unavailable(
                    "native-gstplay-qualification-required",
                ));
            }
            let prepared = PreparedMaster::read(
                &request.source_text,
                &request.participant_id,
                request.selector,
            )?;
            if prepared.plan.version != request.version {
                return Err(CommandError::invalid_contract(
                    "Start version must match the exact master version.",
                ));
            }
            let viewport = native_viewport(&prepared, window)?;
            let bindings = super::bindings::bind_master_media(
                &self.workspace,
                &request.workspace_id,
                &prepared,
            )?;
            let recording = self.recorder.status();
            if recording.active
                && recording.recipe_sha256.as_deref()
                    != Some(&prepared.plan.recipe_source_byte_sha256)
            {
                return Err(CommandError::forbidden(
                    "The recorder belongs to a different experiment JSON.",
                ));
            }
            let run_id = format!("run-{}", uuid::Uuid::new_v4());
            // Validate stream limits before consuming the native input-test receipt.
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
            let participant = request.participant;
            let storage = self
                .workspace
                .with_workspace(&request.workspace_id, |root, _| {
                    MasterStorage::create_with_validation(
                        root,
                        &prepared,
                        &run_id,
                        participant,
                        request.rerun_confirmed,
                        request.validation,
                    )
                })?;
            let receipt = storage.receipt.clone();
            let (sender, receiver) = mpsc::sync_channel(32);
            let mut worker = MasterWorker::new(
                prepared,
                request.workspace_id,
                bindings,
                viewport,
                storage,
                authority.clone(),
                mailbox,
                Arc::clone(&self.workspace),
                Arc::clone(&self.media),
                Arc::clone(&self.recorder),
                lease,
            )?;
            let status = Arc::clone(&worker.public);
            let cancellation = Arc::clone(&worker.cancellation);
            let handle = thread::Builder::new()
                .name("runner-master".into())
                .spawn(move || {
                    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        worker.run(receiver)
                    }));
                    if outcome.is_err() {
                        worker.fail("master-worker-panicked");
                    }
                })
                .map_err(CommandError::io)?;
            *active = Some(Active {
                run_id,
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
        lock(&self.active).as_ref().map(|a| lock(&a.status).clone())
    }
    pub(crate) fn require_version(&self, run_id: &str, version: u32) -> ResearchResult<()> {
        let active = lock(&self.active);
        let a = active
            .as_ref()
            .filter(|a| a.run_id == run_id)
            .ok_or_else(CommandError::no_active_run)?;
        if lock(&a.status).version != version {
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
        let a = active
            .as_ref()
            .filter(|a| a.run_id == run_id)
            .ok_or_else(CommandError::no_active_run)?;
        if !fullscreen || a.window != window {
            a.authority.service.end_run(&a.authority.id);
            a.cancellation.store(true, Ordering::Release);
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
            let a = active
                .as_ref()
                .filter(|a| a.run_id == run_id && !a.worker.is_finished())
                .ok_or_else(CommandError::no_active_run)?;
            a.sender.try_send((action, sender)).map_err(|_| {
                CommandError::forbidden("Master command queue is unavailable or full.")
            })?;
        }
        receiver.recv_timeout(Duration::from_secs(30)).map_err(|_| CommandError::forbidden("Master command acknowledgement is unavailable; check native session status before retrying."))?
    }
    pub fn shutdown(&self) {
        if let Some(a) = lock(&self.active).as_ref() {
            // Withdraw acquisition immediately; never wait on the UI/window thread.
            a.authority.service.end_run(&a.authority.id);
            a.cancellation.store(true, Ordering::Release);
        }
    }
    /// Used by the composition shutdown coordinator before releasing the native
    /// player/parent. This is a thread-completion observation, not an early ack.
    pub fn is_stopped(&self) -> bool {
        lock(&self.active)
            .as_ref()
            .is_none_or(|a| a.worker.is_finished())
    }
    pub fn join_stopped(&self) -> ResearchResult<()> {
        let mut active = lock(&self.active);
        if active.as_ref().is_some_and(|a| !a.worker.is_finished()) {
            return Err(CommandError::forbidden(
                "Master worker teardown is still pending.",
            ));
        }
        if let Some(a) = active.take() {
            a.worker
                .join()
                .map_err(|_| CommandError::forbidden("Master worker teardown panicked."))?;
        }
        Ok(())
    }
}
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}
pub(crate) fn native_viewport(
    prepared: &PreparedMaster,
    (width, height, scale): (u32, u32, f64),
) -> ResearchResult<NativeMediaViewportPxV1> {
    let authored = &prepared.layout.viewport;
    if !scale.is_finite()
        || f64::from(width) / scale != authored.width_css_px
        || f64::from(height) / scale != authored.height_css_px
    {
        return Err(CommandError::forbidden(
            "The fullscreen viewport must exactly match the saved desktop layout.",
        ));
    }
    let reference = &prepared.plan.selected["layout"]["geometry"]["reference"];
    let number = |key| {
        reference[key]
            .as_f64()
            .ok_or_else(|| CommandError::invalid_contract("Missing native layout geometry."))
    };
    NativeMediaViewportCssV1 {
        left_css_px: number("x")?,
        top_css_px: number("y")?,
        width_css_px: number("width")?,
        height_css_px: number("height")?,
        layout_revision: 1,
    }
    .to_physical(scale, width, height)
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

/// Validation admits a functioning verified player, never a qualified claim.
pub(crate) fn require_validation_media(capability: &crate::research_native_media::NativeMediaCapability) -> ResearchResult<()> {
    if !capability.runtime_integrity_verified || !capability.player_actor_ready {
        return Err(CommandError::native_media_unavailable(&capability.reason_code));
    }
    Ok(())
}

#[cfg(test)]
mod validation_tests {
    use super::*;
    #[test]
    fn validation_requires_verified_runtime_and_live_actor_without_qualifying_it() {
        let media = NativeMediaService::unavailable_for_tests();
        let mut capability = media.capability();
        assert!(require_validation_media(&capability).is_err());
        capability.runtime_integrity_verified = true;
        assert!(require_validation_media(&capability).is_err());
        capability.player_actor_ready = true;
        assert!(require_validation_media(&capability).is_ok());
        assert!(!capability.qualified_start_available);
        capability.runtime_integrity_verified = false;
        assert!(require_validation_media(&capability).is_err());
    }
}

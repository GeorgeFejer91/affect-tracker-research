use super::{
    auth, error,
    monitor::{MonitorMailbox, MonitorSample},
    Result,
};
use crate::research_native_media::{
    live_frame::LiveFrame, NativeMediaCommandFenceV1, NativeMediaService,
};
use crate::research_native_protocol::runtime::{
    PackageFinalizeReceipt, PackageFinishOutcome, PackageProtocolRuntime, PackageRunPhase,
    PackageRunStatus, PackageStartRunReceipt, StartPackageRunRequest,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Start,
    Pause,
    Resume,
    Stop,
}
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyRequest {
    pub grant: String,
    pub command_id: String,
    pub expected_revision: u32,
    pub action: Action,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub profile: &'static str,
    pub revision: u32,
    pub active: bool,
    pub phase: String,
    pub run_id: Option<String>,
    pub available_actions: Vec<Action>,
    pub step: Option<u32>,
    pub step_count: u32,
    pub media_time_ms: Option<f64>,
    pub media_duration_ms: Option<f64>,
    pub write_healthy: bool,
    pub input_active: bool,
    pub sample: Option<MonitorSample>,
    pub media_selection: Option<String>,
    pub video_enabled: bool,
}
// These receipts are local IPC only. The network adapter sends only ok/revision/error.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "receipt", rename_all = "camelCase")]
pub enum LocalEffect {
    Started(PackageStartRunReceipt),
    Stopped(PackageFinalizeReceipt),
    Refreshed,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub ok: bool,
    pub revision: u32,
    pub error: Option<String>,
    pub local_effect: Option<LocalEffect>,
}
struct Armed {
    request: StartPackageRunRequest,
    expires: Instant,
}
#[derive(Default)]
struct State {
    session: Option<auth::Session>,
    armed: Option<Armed>,
    revision: u32,
    identity: String,
    results: BTreeMap<String, (ApplyRequest, Applied)>,
    last_apply: Option<Instant>,
    last_frame: Option<Instant>,
    video_failed: bool,
    video_enabled: bool,
}
pub struct ProfessorService {
    runtime: Arc<PackageProtocolRuntime>,
    media: Arc<NativeMediaService>,
    monitor: Arc<MonitorMailbox>,
    state: Mutex<State>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrame {
    pub run_id: String,
    pub selection: String,
    pub frame: LiveFrame,
}
impl ProfessorService {
    pub fn new(runtime: Arc<PackageProtocolRuntime>, media: Arc<NativeMediaService>) -> Self {
        Self {
            monitor: runtime.professor_monitor(),
            runtime,
            media,
            state: Mutex::new(State::default()),
        }
    }
    pub fn begin(&self, video: bool) -> Result<auth::Invitation> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| error("authority_unavailable"))?;
        let (session, invitation) = auth::Session::begin(video, Instant::now());
        *state = State {
            session: Some(session),
            revision: 1,
            video_enabled: video,
            ..State::default()
        };
        self.monitor.set_enabled(true);
        Ok(invitation)
    }
    pub fn verify(&self, request: auth::VerifyRequest) -> Result<auth::Grant> {
        self.state
            .lock()
            .map_err(|_| error("authority_unavailable"))?
            .session
            .as_mut()
            .ok_or_else(|| error("companion_disabled"))?
            .verify(request, Instant::now())
    }
    pub fn disable(&self) {
        self.monitor.set_enabled(false);
        if let Ok(mut state) = self.state.lock() {
            *state = State::default();
        }
    }
    pub fn disarm(&self) -> Result<()> {
        self.state
            .lock()
            .map_err(|_| error("authority_unavailable"))?
            .armed = None;
        Ok(())
    }
    /// Only the bundled local Runner can prepare an attempt; it is never a wire command.
    pub fn arm(&self, request: StartPackageRunRequest) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| error("authority_unavailable"))?;
        if state.session.is_none() || self.runtime.status().active {
            return Err(error("cannot_arm"));
        }
        state.armed = Some(Armed {
            request,
            expires: Instant::now() + Duration::from_secs(120),
        });
        Ok(())
    }
    fn project(&self, state: &mut State, now: Instant) -> Snapshot {
        if state.armed.as_ref().is_some_and(|a| now >= a.expires) {
            state.armed = None;
        }
        let status = self.runtime.status();
        let actions = available_actions(&status, state.armed.is_some());
        let phase = if !status.active {
            if state.armed.is_some() {
                "armed"
            } else {
                "idle"
            }
            .into()
        } else {
            match status.phase {
                PackageRunPhase::Questionnaire => "questionnaire",
                PackageRunPhase::StimulusReady => "stimulusReady",
                PackageRunPhase::Playing => "playing",
                PackageRunPhase::Paused => "paused",
                PackageRunPhase::Interval => "interval",
                PackageRunPhase::CompleteReady => "completeReady",
                PackageRunPhase::Finalizing => "finalizing",
                PackageRunPhase::Finished => "finished",
                PackageRunPhase::Failed => "failed",
            }
            .into()
        };
        // Sampling and playback clocks do not invalidate a command's control revision.
        let identity = format!(
            "{:?}|{}|{:?}|{}",
            status.run_id, phase, actions, status.write_healthy
        );
        if state.identity != identity {
            state.revision = state.revision.wrapping_add(1);
            state.identity = identity;
        }
        Snapshot {
            profile: "affect-runner-professor-v1",
            revision: state.revision,
            active: status.active,
            phase,
            run_id: status.run_id.clone(),
            available_actions: actions,
            step: status.protocol_step_position,
            step_count: status.protocol_step_count,
            media_time_ms: status.stimulus.as_ref().map(|s| s.media_time_ms),
            media_duration_ms: status.stimulus.as_ref().map(|s| s.duration_ms),
            write_healthy: status.write_healthy,
            input_active: status.input_active,
            sample: self
                .monitor
                .snapshot()
                .filter(|s| Some(&s.run_id) == status.run_id.as_ref()),
            media_selection: self
                .media
                .status_snapshot()
                .ok()
                .and_then(|s| s.session_id.map(|id| format!("{}:{}", id, s.generation))),
            video_enabled: state.video_enabled && !state.video_failed,
        }
    }
    pub fn frame(&self, grant: &str) -> Result<PreviewFrame> {
        let now = Instant::now();
        let (run_id, fence) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| error("authority_unavailable"))?;
            state
                .session
                .as_ref()
                .ok_or_else(|| error("companion_disabled"))?
                .require(grant, "runner.video", now)?;
            if state.video_failed
                || state
                    .last_frame
                    .is_some_and(|t| now.duration_since(t) < Duration::from_secs(1))
            {
                return Err(error("video_preview_unavailable"));
            }
            state.last_frame = Some(now);
            let run = self.runtime.status();
            if !run.active
                || !matches!(
                    run.phase,
                    PackageRunPhase::Playing | PackageRunPhase::Paused
                )
                || !run.stimulus.as_ref().is_some_and(|s| s.prepared)
            {
                return Err(error("video_preview_unavailable"));
            }
            let media = self.media.status_snapshot()?;
            (
                run.run_id.ok_or_else(|| error("no_active_run"))?,
                NativeMediaCommandFenceV1 {
                    session_id: media
                        .session_id
                        .ok_or_else(|| error("video_preview_unavailable"))?,
                    generation: media.generation,
                },
            )
        };
        // No authority mutex held across the foreign media call.
        let captured = self.media.snapshot_live_frame(fence.clone());
        let mut state = self
            .state
            .lock()
            .map_err(|_| error("authority_unavailable"))?;
        state
            .session
            .as_ref()
            .ok_or_else(|| error("companion_disabled"))?
            .require(grant, "runner.video", Instant::now())?;
        if captured.as_ref().is_err_and(|e| {
            e.code == "video_preview_too_slow" || e.code == "native_media_unavailable"
        }) {
            state.video_failed = true;
        }
        let frame = captured?;
        let media = self.media.status_snapshot()?;
        let run = self.runtime.status();
        if !run.active
            || run.run_id.as_deref() != Some(&run_id)
            || media.generation != fence.generation
            || media.session_id.as_deref() != Some(&fence.session_id)
        {
            return Err(error("obsolete_frame"));
        }
        Ok(PreviewFrame {
            run_id,
            selection: format!("{}:{}", fence.session_id, fence.generation),
            frame,
        })
    }
    pub fn snapshot(&self, grant: &str) -> Result<Snapshot> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| error("authority_unavailable"))?;
        let now = Instant::now();
        state
            .session
            .as_ref()
            .ok_or_else(|| error("companion_disabled"))?
            .require(grant, "runner.observe", now)?;
        Ok(self.project(&mut state, now))
    }
    pub fn apply(&self, request: ApplyRequest) -> Result<Applied> {
        if request.command_id.len() < 8
            || request.command_id.len() > 96
            || !request
                .command_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err(error("invalid_command"));
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| error("authority_unavailable"))?;
        let now = Instant::now();
        state
            .session
            .as_ref()
            .ok_or_else(|| error("companion_disabled"))?
            .require(&request.grant, "runner.operate", now)?;
        if let Some((previous, outcome)) = state.results.get(&request.command_id) {
            return if previous == &request {
                Ok(outcome.clone())
            } else {
                Err(error("command_id_reused"))
            };
        }
        // Never evict an outcome and then accidentally reapply an old command.
        if state.results.len() >= 1024 {
            return Err(error("session_command_limit"));
        }
        if state
            .last_apply
            .is_some_and(|t| now.duration_since(t) < Duration::from_millis(200))
        {
            return Err(error("command_rate_limit"));
        }
        state.last_apply = Some(now);
        let before = self.project(&mut state, now);
        let effect = if before.revision != request.expected_revision {
            Err(error("revision_conflict"))
        } else if !before.available_actions.contains(&request.action) {
            Err(error("action_unavailable"))
        } else {
            match request.action {
                Action::Start => match state.armed.take() {
                    Some(armed) => self.runtime.start(armed.request).map(LocalEffect::Started),
                    None => Err(error("start_not_armed")),
                },
                Action::Pause => self
                    .runtime
                    .pause(before.run_id.as_deref().unwrap_or(""))
                    .map(|_| LocalEffect::Refreshed),
                Action::Resume => self
                    .runtime
                    .play(before.run_id.as_deref().unwrap_or(""))
                    .map(|_| LocalEffect::Refreshed),
                Action::Stop => self
                    .runtime
                    .finish(
                        before.run_id.as_deref().unwrap_or(""),
                        PackageFinishOutcome::StopEarly,
                    )
                    .map(LocalEffect::Stopped),
            }
        };
        let after = self.project(&mut state, Instant::now());
        let outcome = match effect {
            Ok(effect) => Applied {
                ok: true,
                revision: after.revision,
                error: None,
                local_effect: Some(effect),
            },
            Err(failure) => Applied {
                ok: false,
                revision: after.revision,
                error: Some(failure.code),
                local_effect: None,
            },
        };
        state
            .results
            .insert(request.command_id.clone(), (request, outcome.clone()));
        Ok(outcome)
    }
}
fn available_actions(status: &PackageRunStatus, armed: bool) -> Vec<Action> {
    if !status.active {
        return if armed { vec![Action::Start] } else { vec![] };
    }
    let mut actions = match status.phase {
        PackageRunPhase::Playing => vec![Action::Pause],
        PackageRunPhase::Paused => vec![Action::Resume],
        _ => vec![],
    };
    if !matches!(
        status.phase,
        PackageRunPhase::Finalizing | PackageRunPhase::Finished
    ) {
        actions.push(Action::Stop);
    }
    actions
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejected_commands_are_deduplicated_and_disable_revokes_native_authority() {
        let workspace = Arc::new(
            crate::research_workspace::WorkspaceService::new(
                std::env::temp_dir().join("affect-professor-domain-tests"),
            )
            .unwrap(),
        );
        let media = Arc::new(NativeMediaService::unavailable_for_tests());
        let runtime = Arc::new(PackageProtocolRuntime::with_services(
            workspace,
            Arc::clone(&media),
            Arc::new(crate::research_input::ResearchInputService::unavailable()),
        ));
        let service = ProfessorService::new(runtime, media);
        assert!(service.snapshot("frontend_authenticated_flag").is_err());
        let (session, grant) = auth::fixture_session();
        service.state.lock().unwrap().session = Some(session);
        let snapshot = service.snapshot(&grant.handle).unwrap();
        assert_eq!(snapshot.phase, "idle");
        assert!(snapshot.available_actions.is_empty());
        let request = ApplyRequest {
            grant: grant.handle.clone(),
            command_id: "cmd_fixture".into(),
            expected_revision: snapshot.revision,
            action: Action::Pause,
        };
        let first = service.apply(request.clone()).unwrap();
        assert!(!first.ok);
        assert_eq!(first.error.as_deref(), Some("action_unavailable"));
        let second = service.apply(request.clone()).unwrap();
        assert_eq!(first.revision, second.revision);
        assert_eq!(first.error, second.error);
        assert_eq!(
            service
                .apply(ApplyRequest {
                    action: Action::Stop,
                    ..request.clone()
                })
                .err()
                .unwrap()
                .code,
            "command_id_reused"
        );
        assert!(service.frame(&grant.handle).is_err());
        service.disable();
        assert!(service.snapshot(&grant.handle).is_err());
        assert!(service.apply(request).is_err());
    }
    #[test]
    fn wire_action_contract_excludes_input_files_and_arbitrary_commands() {
        for action in [
            "setValence",
            "setArousal",
            "submitAnswers",
            "shell",
            "loadFile",
        ] {
            assert!(serde_json::from_value::<ApplyRequest>(serde_json::json!({"grant":"fixture","commandId":"cmd_fixture","expectedRevision":1,"action":action})).is_err());
        }
        assert!(serde_json::from_value::<ApplyRequest>(serde_json::json!({"grant":"fixture","commandId":"cmd_fixture","expectedRevision":1,"action":"start","participantId":"P001"})).is_err());
    }
}

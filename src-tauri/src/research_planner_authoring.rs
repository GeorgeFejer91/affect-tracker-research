mod wire;

use crate::research_desktop::DesktopRole;
use crate::research_error::{CommandError, ResearchResult};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, Read, Write};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use wire::{parse_command, PlannerCommand, PlannerResponse, MAX_FRAME_BYTES};

const MAX_PENDING: usize = 4;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);

struct BrokerState {
    session_id: Option<String>,
    revision: u64,
    queue: VecDeque<PlannerCommand>,
    pending: HashMap<String, Instant>,
    eof: bool,
    exit_code: i32,
    closed: bool,
    output_pending: usize,
    last_activity: Instant,
}

/// An explicitly invoked CLI owns inherited stdin/stdout and one hidden Planner.
/// This service has no listener, file inbox, user-window attachment or business
/// draft. Normal Planner/Runner startup never starts these I/O threads.
pub(crate) struct PlannerAuthoringBroker {
    enabled: bool,
    created: Instant,
    state: Mutex<BrokerState>,
    wake: Condvar,
    output: mpsc::SyncSender<Value>,
    receiver: Mutex<Option<mpsc::Receiver<Value>>>,
}

impl PlannerAuthoringBroker {
    pub fn new(enabled: bool) -> Self {
        let (output, receiver) = mpsc::sync_channel(MAX_PENDING);
        Self {
            enabled,
            created: Instant::now(),
            state: Mutex::new(BrokerState {
                session_id: None,
                revision: 0,
                queue: VecDeque::new(),
                pending: HashMap::new(),
                eof: false,
                exit_code: 0,
                closed: false,
                output_pending: 0,
                last_activity: Instant::now(),
            }),
            wake: Condvar::new(),
            output,
            receiver: Mutex::new(Some(receiver)),
        }
    }

    fn lock(&self) -> ResearchResult<std::sync::MutexGuard<'_, BrokerState>> {
        self.state.lock().map_err(|_| {
            CommandError::new(
                "session_failed",
                "The authoring session state is unavailable.",
            )
        })
    }

    fn send_output(&self, value: Value) -> ResearchResult<()> {
        let bytes = serde_json::to_vec(&value).map_err(CommandError::io)?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(CommandError::new(
                "limit_exceeded",
                "Planner result exceeds 16 MiB.",
            ));
        }
        {
            let mut state = self.lock()?;
            if state.closed {
                return Err(CommandError::new(
                    "session_closed",
                    "Planner CLI is closed.",
                ));
            }
            state.output_pending += 1;
        }
        self.send_reserved_output(value)
    }

    fn send_reserved_output(&self, value: Value) -> ResearchResult<()> {
        if self.output.try_send(value).is_err() {
            self.lock()?.output_pending -= 1;
            return Err(CommandError::new(
                "output_busy",
                "Planner CLI output is not being consumed.",
            ));
        }
        Ok(())
    }

    fn reserve_completion(&self, response: &PlannerResponse) -> ResearchResult<()> {
        let mut state = self.lock()?;
        if state.closed
            || state.session_id.as_deref() != Some(&response.session_id)
            || !state.pending.contains_key(&response.request_id)
        {
            return Err(CommandError::new(
                "stale_result",
                "Planner result has no matching active command.",
            ));
        }
        // Claim completion and reserve its output under ONE lock. A concurrent
        // duplicate cannot publish twice, and EOF cannot race the final reply.
        state.pending.remove(&response.request_id);
        state.revision = state.revision.max(response.revision);
        state.output_pending += 1;
        Ok(())
    }

    fn drained_exit_code(&self) -> Option<i32> {
        self.lock().ok().and_then(|mut state| {
            if state.eof
                && state.queue.is_empty()
                && state.pending.is_empty()
                && state.output_pending == 0
                && !state.closed
            {
                state.closed = true;
                Some(state.exit_code)
            } else {
                None
            }
        })
    }

    fn finish_if_drained(&self, app: &AppHandle) {
        if let Some(code) = self.drained_exit_code() {
            self.wake.notify_all();
            app.exit(code);
        }
    }

    fn fail(&self, app: &AppHandle, code: &str) {
        self.shutdown();
        // Fixed codes only; never log command bodies, source files or paths.
        eprintln!("Planner CLI stopped: {code}");
        app.exit(2);
    }

    pub fn shutdown(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.closed = true;
            state.queue.clear();
            state.pending.clear();
        }
        self.wake.notify_all();
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) -> ResearchResult<()> {
        if !self.enabled {
            return Ok(());
        }
        let receiver = self
            .receiver
            .lock()
            .map_err(CommandError::io)?
            .take()
            .ok_or_else(|| {
                CommandError::new("already_started", "Planner CLI already owns its I/O.")
            })?;
        let broker = Arc::clone(self);
        let output_app = app.clone();
        std::thread::Builder::new()
            .name("planner-cli-output".into())
            .spawn(move || {
                let stdout = std::io::stdout();
                let mut output = stdout.lock();
                loop {
                    let value = match receiver.recv_timeout(Duration::from_secs(1)) {
                        Ok(value) => value,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if broker.lock().map_or(true, |state| state.closed) {
                                return;
                            }
                            continue;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    };
                    if serde_json::to_writer(&mut output, &value).is_err()
                        || output.write_all(b"\n").is_err()
                        || output.flush().is_err()
                    {
                        broker.fail(&output_app, "output_unavailable");
                        return;
                    }
                    if let Ok(mut state) = broker.lock() {
                        state.output_pending = state.output_pending.saturating_sub(1);
                    }
                    broker.finish_if_drained(&output_app);
                }
            })
            .map_err(CommandError::io)?;
        let broker = Arc::clone(self);
        let input_app = app.clone();
        std::thread::Builder::new().name("planner-cli-input".into()).spawn(move || {
            if broker.wait_ready().is_err() { return; }
            let stdin = std::io::stdin(); let mut input = stdin.lock();
            loop {
                let mut frame = Vec::new();
                let read = (&mut input).take((MAX_FRAME_BYTES + 1) as u64).read_until(b'\n', &mut frame);
                if read.is_err() { broker.fail(&input_app, "input_unavailable"); return; }
                if frame.is_empty() {
                    if let Ok(mut state) = broker.lock() { state.eof = true; }
                    broker.wake.notify_all(); broker.finish_if_drained(&input_app); return;
                }
                if frame.len() > MAX_FRAME_BYTES { broker.fail(&input_app, "frame_limit_exceeded"); return; }
                let parsed = parse_command(&frame);
                let request_id = parsed.as_ref().ok().map(|request| request.request_id.clone());
                let result = parsed.and_then(|request| broker.enqueue(request));
                if let Err(error) = result {
                    let state = match broker.lock() { Ok(state) => state, Err(_) => { broker.fail(&input_app, "state_unavailable"); return; } };
                    let value = json!({"schema":"affect-research-planner-command-result","version":1,"sessionId":state.session_id,"requestId":request_id,"status":"rejected","revision":state.revision,"result":null,"issues":[{"owner":null,"field":null,"code":error.code,"message":error.message}]});
                    drop(state);
                    if broker.send_output(value).is_err() { broker.fail(&input_app, "output_backpressure"); return; }
                }
            }
        }).map_err(CommandError::io)?;
        let broker = Arc::clone(self);
        std::thread::Builder::new()
            .name("planner-cli-lifetime".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_millis(200));
                let state = match broker.lock() {
                    Ok(state) => state,
                    Err(_) => {
                        broker.fail(&app, "state_unavailable");
                        return;
                    }
                };
                if state.closed {
                    return;
                }
                let expired = (state.session_id.is_none()
                    && broker.created.elapsed() > STARTUP_TIMEOUT)
                    || state
                        .pending
                        .values()
                        .any(|started| started.elapsed() > COMMAND_TIMEOUT)
                    || state.last_activity.elapsed() > IDLE_TIMEOUT;
                drop(state);
                if expired {
                    broker.fail(&app, "session_deadline");
                    return;
                }
            })
            .map_err(CommandError::io)?;
        Ok(())
    }

    fn wait_ready(&self) -> ResearchResult<()> {
        let mut state = self.lock()?;
        while state.session_id.is_none() && !state.closed {
            state = self
                .wake
                .wait_timeout(state, Duration::from_secs(1))
                .map_err(CommandError::io)?
                .0;
        }
        if state.closed {
            Err(CommandError::new(
                "session_closed",
                "Planner CLI closed before readiness.",
            ))
        } else {
            Ok(())
        }
    }

    fn enqueue(&self, request: PlannerCommand) -> ResearchResult<()> {
        let mut state = self.lock()?;
        if state.closed || state.eof {
            return Err(CommandError::new(
                "session_closed",
                "Planner CLI is closed.",
            ));
        }
        if state.session_id.as_deref() != Some(&request.session_id) {
            return Err(CommandError::new(
                "stale_session",
                "Use the current ready receipt's session identity.",
            ));
        }
        if state.pending.contains_key(&request.request_id)
            || state
                .queue
                .iter()
                .any(|queued| queued.request_id == request.request_id)
        {
            return Err(CommandError::new(
                "request_in_flight",
                "This command is still in flight.",
            ));
        }
        if state.queue.len() + state.pending.len() >= MAX_PENDING {
            return Err(CommandError::new(
                "busy",
                "The bounded authoring queue is full.",
            ));
        }
        state.queue.push_back(request);
        state.last_activity = Instant::now();
        drop(state);
        self.wake.notify_all();
        Ok(())
    }

    fn next(&self) -> ResearchResult<Option<PlannerCommand>> {
        let mut state = self.lock()?;
        loop {
            if state.closed {
                return Ok(None);
            }
            if let Some(request) = state.queue.pop_front() {
                state
                    .pending
                    .insert(request.request_id.clone(), Instant::now());
                return Ok(Some(request));
            }
            if state.eof {
                return Ok(None);
            }
            state = self
                .wake
                .wait_timeout(state, Duration::from_secs(1))
                .map_err(CommandError::io)?
                .0;
        }
    }
}

fn authorize(
    window: &WebviewWindow,
    role: &DesktopRole,
    broker: &PlannerAuthoringBroker,
) -> ResearchResult<()> {
    if window.label() != "research" || *role != DesktopRole::Planner || !broker.enabled {
        return Err(CommandError::forbidden(
            "An explicitly invoked Planner CLI session is required.",
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn research_planner_authoring_startup_failed(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    broker: State<'_, Arc<PlannerAuthoringBroker>>,
) -> ResearchResult<()> {
    authorize(&window, &role, &broker)?;
    let state = broker.lock()?;
    if state.session_id.is_some() {
        return Err(CommandError::new(
            "already_ready",
            "The CLI startup phase has ended.",
        ));
    }
    drop(state);
    broker.send_output(json!({"schema":"affect-research-planner-cli-error","version":1,"code":"frontend_startup_failed","message":"The hidden Planner could not initialize."}))?;
    {
        let mut state = broker.lock()?;
        state.eof = true;
        state.exit_code = 2;
    }
    broker.finish_if_drained(window.app_handle());
    Ok(())
}

#[tauri::command]
pub(crate) fn research_planner_authoring_status(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    broker: State<'_, Arc<PlannerAuthoringBroker>>,
) -> ResearchResult<Value> {
    if window.label() != "research" || *role != DesktopRole::Planner {
        return Err(CommandError::forbidden("Unknown Planner window."));
    }
    Ok(json!({"enabled":broker.enabled,"transport":if broker.enabled {Some("stdio")} else {None}}))
}

#[tauri::command]
pub(crate) fn research_planner_authoring_ready(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    broker: State<'_, Arc<PlannerAuthoringBroker>>,
    session_id: String,
    revision: u64,
) -> ResearchResult<()> {
    authorize(&window, &role, &broker)?;
    if !wire::is_uuid(&session_id) || revision > 9_007_199_254_740_991 {
        return Err(CommandError::new(
            "invalid_response",
            "Planner readiness identity is invalid.",
        ));
    }
    {
        let mut state = broker.lock()?;
        if state.session_id.is_some() || state.closed {
            return Err(CommandError::new(
                "already_ready",
                "Planner readiness can be published only once.",
            ));
        }
        state.session_id = Some(session_id.clone());
        state.revision = revision;
    }
    broker.send_output(json!({"schema":"affect-research-planner-cli-ready","version":1,"sessionId":session_id,"revision":revision,"processId":std::process::id(),"buildCommit":env!("AFFECT_TRACKER_BUILD_COMMIT"),"transport":"stdio","hidden":true}))?;
    broker.wake.notify_all();
    Ok(())
}

#[tauri::command]
pub(crate) async fn research_planner_authoring_next(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    broker: State<'_, Arc<PlannerAuthoringBroker>>,
) -> ResearchResult<Option<PlannerCommand>> {
    authorize(&window, &role, &broker)?;
    let broker = Arc::clone(&broker);
    tauri::async_runtime::spawn_blocking(move || broker.next())
        .await
        .map_err(CommandError::io)?
}

#[tauri::command]
pub(crate) fn research_planner_authoring_complete(
    window: WebviewWindow,
    role: State<'_, DesktopRole>,
    broker: State<'_, Arc<PlannerAuthoringBroker>>,
    response: PlannerResponse,
) -> ResearchResult<()> {
    authorize(&window, &role, &broker)?;
    response.validate()?;
    let value = serde_json::to_value(&response).map_err(CommandError::io)?;
    if serde_json::to_vec(&value).map_err(CommandError::io)?.len() > MAX_FRAME_BYTES {
        return Err(CommandError::new(
            "limit_exceeded",
            "Planner result exceeds 16 MiB.",
        ));
    }
    broker.reserve_completion(&response)?;
    if let Err(error) = broker.send_reserved_output(value) {
        broker.fail(window.app_handle(), "output_backpressure");
        return Err(error);
    }
    broker.wake.notify_all();
    broker.finish_if_drained(window.app_handle());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn broker() -> Arc<PlannerAuthoringBroker> {
        let broker = Arc::new(PlannerAuthoringBroker::new(true));
        broker.lock().unwrap().session_id = Some(Uuid::new_v4().to_string());
        broker
    }

    fn request(broker: &PlannerAuthoringBroker) -> PlannerCommand {
        parse_command(
            json!({"schema":"affect-research-planner-command","version":1,
            "sessionId":broker.lock().unwrap().session_id,"requestId":Uuid::new_v4().to_string(),
            "expectedRevision":null,"action":{"kind":"snapshot"}})
            .to_string()
            .as_bytes(),
        )
        .unwrap()
    }

    fn response(request: &PlannerCommand) -> PlannerResponse {
        PlannerResponse {
            schema: "affect-research-planner-command-result".into(),
            version: 1,
            session_id: request.session_id.clone(),
            request_id: request.request_id.clone(),
            status: "ok".into(),
            revision: 0,
            result: Value::Null,
            issues: vec![],
        }
    }

    #[test]
    fn normal_startup_has_no_enabled_ingress() {
        let broker = PlannerAuthoringBroker::new(false);
        assert!(!broker.enabled);
        assert!(broker.lock().unwrap().session_id.is_none());
        assert!(broker.lock().unwrap().queue.is_empty());
    }

    #[test]
    fn queue_is_session_scoped_bounded_and_counts_dispatched_commands() {
        let broker = broker();
        let mut stale = request(&broker);
        stale.session_id = Uuid::new_v4().to_string();
        assert_eq!(broker.enqueue(stale).unwrap_err().code, "stale_session");
        let first = request(&broker);
        broker.enqueue(first.clone()).unwrap();
        assert_eq!(
            broker.enqueue(first.clone()).unwrap_err().code,
            "request_in_flight"
        );
        assert_eq!(broker.next().unwrap().unwrap().request_id, first.request_id);
        assert_eq!(broker.enqueue(first).unwrap_err().code, "request_in_flight");
        for _ in 1..MAX_PENDING {
            broker.enqueue(request(&broker)).unwrap();
        }
        assert_eq!(broker.enqueue(request(&broker)).unwrap_err().code, "busy");
    }

    #[test]
    fn completion_is_claimed_once_even_when_competing_threads_race() {
        let broker = broker();
        let command = request(&broker);
        broker.enqueue(command.clone()).unwrap();
        broker.next().unwrap();
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let broker = Arc::clone(&broker);
                let result = response(&command);
                std::thread::spawn(move || broker.reserve_completion(&result).is_ok())
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|handle| usize::from(handle.join().unwrap()))
                .sum::<usize>(),
            1
        );
        assert_eq!(broker.lock().unwrap().output_pending, 1);
        assert!(broker.lock().unwrap().pending.is_empty());
    }

    #[test]
    fn eof_waits_for_queued_inflight_and_reserved_output_before_exit() {
        let broker = broker();
        let command = request(&broker);
        broker.enqueue(command.clone()).unwrap();
        broker.lock().unwrap().eof = true;
        assert_eq!(broker.drained_exit_code(), None);
        broker.next().unwrap();
        assert_eq!(broker.drained_exit_code(), None);
        broker.reserve_completion(&response(&command)).unwrap();
        assert_eq!(broker.drained_exit_code(), None);
        broker.lock().unwrap().output_pending -= 1;
        assert_eq!(broker.drained_exit_code(), Some(0));
        assert_eq!(broker.drained_exit_code(), None);
        assert!(broker.next().unwrap().is_none());
        assert_eq!(
            broker.enqueue(request(&broker)).unwrap_err().code,
            "session_closed"
        );
    }

    #[test]
    fn startup_error_drains_with_failure_code() {
        let broker = broker();
        {
            let mut state = broker.lock().unwrap();
            state.eof = true;
            state.exit_code = 2;
        }
        assert_eq!(broker.drained_exit_code(), Some(2));
    }

    #[test]
    fn output_backpressure_is_bounded_and_does_not_leak_a_reservation() {
        let broker = broker();
        for _ in 0..MAX_PENDING {
            broker.send_output(Value::Null).unwrap();
        }
        assert_eq!(
            broker.send_output(Value::Null).unwrap_err().code,
            "output_busy"
        );
        assert_eq!(broker.lock().unwrap().output_pending, MAX_PENDING);
    }

    #[test]
    fn shutdown_wakes_waiters_and_rejects_late_completion() {
        let broker = broker();
        let command = request(&broker);
        broker.enqueue(command.clone()).unwrap();
        broker.next().unwrap();
        let waiting = Arc::clone(&broker);
        let next = std::thread::spawn(move || waiting.next().unwrap().is_none());
        broker.shutdown();
        assert!(next.join().unwrap());
        assert_eq!(
            broker
                .reserve_completion(&response(&command))
                .unwrap_err()
                .code,
            "stale_result"
        );
        assert!(broker.lock().unwrap().pending.is_empty());
        let startup = Arc::new(PlannerAuthoringBroker::new(true));
        let waiting = Arc::clone(&startup);
        let ready = std::thread::spawn(move || waiting.wait_ready().is_err());
        startup.shutdown();
        assert!(ready.join().unwrap());
    }
}

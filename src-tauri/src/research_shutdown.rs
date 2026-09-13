//! One off-UI cleanup transaction. A failed transaction never grants window exit.
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Instant;

/// Closed, process-local diagnostic vocabulary, never a public protocol.
#[derive(Clone, Copy, Debug)]
#[repr(u8)]
pub(crate) enum Phase {
    EofObserved,
    EofDrained,
    ExitRequested,
    CleanupStarted,
    AuthoringStarted,
    AuthoringCompleted,
    InputStarted,
    InputCompleted,
    VerificationCompleted,
    InitializerCompleted,
    NativeShutdownRequested,
    InitializerStopped,
    ActorStopped,
    InitializerJoined,
    ActorJoined,
    NativeJoined,
    NativeStalled,
    CleanupCompleted,
    CleanupFailed,
    ActorRetained,
}

#[derive(Default)]
struct LifecycleObservations {
    started: OnceLock<Instant>,
    emitted: AtomicU64,
}

impl LifecycleObservations {
    fn record(&self, phase: Phase) -> Option<String> {
        let started = self.started.get()?;
        let bit = 1_u64 << phase as u8;
        if self.emitted.fetch_or(bit, Ordering::Relaxed) & bit != 0 {
            return None;
        }
        Some(format!(
            "Planner lifecycle phase={phase:?} elapsed_ms={}",
            started.elapsed().as_millis()
        ))
    }
}

static OBSERVATIONS: LifecycleObservations = LifecycleObservations {
    started: OnceLock::new(),
    emitted: AtomicU64::new(0),
};

pub(crate) fn enable_cli_observations() {
    let _ = OBSERVATIONS.started.set(Instant::now());
}

pub(crate) fn observe(phase: Phase) {
    if let Some(line) = OBSERVATIONS.record(phase) {
        write_observation(&mut std::io::stderr().lock(), &line);
    }
}

fn write_observation(writer: &mut impl Write, line: &str) {
    // A closed diagnostic pipe must not turn observation into lifecycle failure.
    let _ = writeln!(writer, "{line}");
}

#[derive(Default)]
pub(crate) struct ShutdownCoordinator {
    started: AtomicBool,
    exit_code: AtomicI32,
    result: Mutex<Option<Result<(), &'static str>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl ShutdownCoordinator {
    pub(crate) fn request(
        self: &Arc<Self>,
        code: i32,
        work: impl FnOnce() -> Result<(), &'static str> + Send + 'static,
        notify: impl FnOnce(i32) + Send + 'static,
    ) {
        if code != 0 {
            self.exit_code.store(code, Ordering::Release);
        }
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let coordinator = Arc::clone(self);
        let worker = thread::Builder::new()
            .name("affect-companion-shutdown".into())
            .spawn(move || {
                observe(Phase::CleanupStarted);
                // Only catches Rust unwinding; foreign aborts/hangs are not recoverable.
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
                    .unwrap_or(Err("companion-shutdown-panicked"));
                *coordinator.result.lock().unwrap_or_else(|p| p.into_inner()) = Some(result);
                if result.is_ok() {
                    observe(Phase::CleanupCompleted);
                    // Native actor and initializer have actually joined before this
                    // notification. The worker's remaining tail owns no native HWND.
                    notify(coordinator.exit_code.load(Ordering::Acquire));
                } else {
                    observe(Phase::CleanupFailed);
                    let line = format!(
                        "Companion shutdown remains blocked: {}",
                        result.err().unwrap_or("shutdown-failed")
                    );
                    write_observation(&mut std::io::stderr().lock(), &line);
                }
            });
        match worker {
            Ok(worker) => *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = Some(worker),
            Err(_) => {
                *self.result.lock().unwrap_or_else(|p| p.into_inner()) =
                    Some(Err("companion-shutdown-thread-unavailable"))
            }
        }
    }

    pub(crate) fn ready_to_exit(&self) -> bool {
        *self.result.lock().unwrap_or_else(|p| p.into_inner()) == Some(Ok(()))
    }

    /// Never waits on the UI thread. Retain the handle until its tail finishes.
    pub(crate) fn join_finished(&self) {
        let mut worker = self.worker.lock().unwrap_or_else(|p| p.into_inner());
        if worker.as_ref().is_some_and(JoinHandle::is_finished) {
            if let Some(worker) = worker.take() {
                if worker.join().is_err() {
                    *self.result.lock().unwrap_or_else(|p| p.into_inner()) =
                        Some(Err("companion-shutdown-panicked"));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn observations_are_disabled_by_default_and_once_per_closed_phase() {
        assert!((Phase::ActorRetained as u8) < 64);
        let observations = LifecycleObservations::default();
        assert!(observations.record(Phase::EofObserved).is_none());
        observations.started.set(Instant::now()).unwrap();
        let line = observations.record(Phase::EofObserved).unwrap();
        assert!(line.starts_with("Planner lifecycle phase=EofObserved elapsed_ms="));
        assert!(line.rsplit('=').next().unwrap().parse::<u128>().is_ok());
        for _ in 0..1000 {
            assert!(observations.record(Phase::EofObserved).is_none());
        }
        assert!(observations.record(Phase::NativeStalled).is_some());
        assert!(observations.record(Phase::NativeStalled).is_none());
    }

    #[test]
    fn concurrent_observation_of_one_transition_emits_once() {
        let observations = Arc::new(LifecycleObservations::default());
        observations.started.set(Instant::now()).unwrap();
        let threads: Vec<_> = (0..32)
            .map(|_| {
                let observations = Arc::clone(&observations);
                thread::spawn(move || observations.record(Phase::ExitRequested).is_some())
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .filter_map(|worker| worker.join().ok())
                .filter(|emitted| *emitted)
                .count(),
            1
        );
    }

    #[test]
    fn failed_diagnostic_writer_does_not_interrupt_cleanup() {
        struct BrokenWriter;
        impl Write for BrokenWriter {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        write_observation(
            &mut BrokenWriter,
            "Planner lifecycle phase=CleanupStarted elapsed_ms=0",
        );
        let mut bytes = Vec::new();
        write_observation(
            &mut bytes,
            "Planner lifecycle phase=CleanupCompleted elapsed_ms=1",
        );
        assert_eq!(
            bytes,
            b"Planner lifecycle phase=CleanupCompleted elapsed_ms=1\n"
        );
    }

    #[test]
    fn pending_work_vetoes_exit_and_repeated_requests_run_once() {
        let coordinator = Arc::new(ShutdownCoordinator::default());
        let (release, wait) = mpsc::channel();
        let (done, completion) = mpsc::channel();
        coordinator.request(
            0,
            move || {
                wait.recv().unwrap();
                Ok(())
            },
            move |code| {
                done.send(code).unwrap();
            },
        );
        assert!(!coordinator.ready_to_exit());
        coordinator.request(
            2,
            || panic!("must not run twice"),
            |_| panic!("must not notify twice"),
        );
        release.send(()).unwrap();
        assert_eq!(completion.recv_timeout(Duration::from_secs(3)).unwrap(), 2);
        assert!(coordinator.ready_to_exit());
        coordinator.join_finished();
    }

    #[test]
    fn failed_or_panicked_cleanup_never_notifies_or_reopens_exit() {
        for panics in [false, true] {
            let coordinator = Arc::new(ShutdownCoordinator::default());
            let (done, completion) = mpsc::channel();
            coordinator.request(
                0,
                move || {
                    if panics {
                        panic!("synthetic cleanup panic");
                    }
                    Err("synthetic-cleanup-failure")
                },
                move |code| {
                    let _ = done.send(code);
                },
            );
            assert!(completion.recv_timeout(Duration::from_secs(3)).is_err());
            assert!(!coordinator.ready_to_exit());
            coordinator.request(
                0,
                || Ok(()),
                |_| panic!("failure cannot retry into success"),
            );
            assert!(!coordinator.ready_to_exit());
            coordinator.join_finished();
        }
    }
}

//! One off-UI cleanup transaction. A failed transaction never grants window exit.
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

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
                // Only catches Rust unwinding; foreign aborts/hangs are not recoverable.
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work))
                    .unwrap_or(Err("companion-shutdown-panicked"));
                *coordinator.result.lock().unwrap_or_else(|p| p.into_inner()) = Some(result);
                if result.is_ok() {
                    // Native actor and initializer have actually joined before this
                    // notification. The worker's remaining tail owns no native HWND.
                    notify(coordinator.exit_code.load(Ordering::Acquire));
                } else {
                    eprintln!(
                        "Companion shutdown remains blocked: {}",
                        result.err().unwrap_or("shutdown-failed")
                    );
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

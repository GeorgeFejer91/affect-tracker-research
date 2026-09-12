//! Actor-owned ordering with nonblocking, bounded producer admission.
//! A lost reliable signal is terminal; it is never treated as a display drop.
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{mpsc, Arc};

pub(super) const COMMAND_CAPACITY: usize = 32;
pub(super) const SIGNAL_CAPACITY: usize = 256;
pub(super) const SIGNAL_BUDGET: usize = 32;
pub(super) const CONTEXT_BUDGET: usize = 8;

#[derive(Clone, Copy)]
#[repr(u8)]
pub(super) enum Fault {
    CommandsFull = 1,
    SignalsFull = 2,
    Disconnected = 3,
    ActorExited = 4,
}

#[derive(Default)]
pub(super) struct Control {
    pub(super) shutdown: AtomicBool,
    pub(super) generation: AtomicU64,
    fault: AtomicU8,
}

impl Control {
    pub(super) fn fail(&self, fault: Fault) {
        let _ = self
            .fault
            .compare_exchange(0, fault as u8, Ordering::AcqRel, Ordering::Acquire);
    }

    pub(super) fn reason(&self) -> Option<&'static str> {
        match self.fault.load(Ordering::Acquire) {
            0 => None,
            1 => Some("native-gstplay-command-overload"),
            2 => Some("native-gstplay-signal-overload"),
            3 => Some("native-gstplay-channel-disconnected"),
            _ => Some("native-gstplay-actor-exited"),
        }
    }

    pub(super) fn cancelled(&self) -> bool {
        self.shutdown.load(Ordering::Acquire) || self.reason().is_some()
    }
}

#[derive(Clone)]
pub(super) struct SignalSender {
    sender: mpsc::SyncSender<super::GenerationSignal>,
    pub(super) control: Arc<Control>,
}

impl SignalSender {
    pub(super) fn channel(
        control: Arc<Control>,
    ) -> (Self, mpsc::Receiver<super::GenerationSignal>) {
        let (sender, receiver) = mpsc::sync_channel(SIGNAL_CAPACITY);
        (Self { sender, control }, receiver)
    }

    pub(super) fn send(&self, signal: super::GenerationSignal) -> Result<(), ()> {
        if self.control.cancelled()
            || signal.generation != self.control.generation.load(Ordering::Acquire)
            || signal.generation == 0
        {
            return Err(());
        }
        self.sender.try_send(signal).map_err(|error| {
            // Teardown retires the generation before dropping the adapter.
            // A raced retired callback is harmless, not a new-session fault.
            let generation = match &error {
                mpsc::TrySendError::Full(signal) | mpsc::TrySendError::Disconnected(signal) => {
                    signal.generation
                }
            };
            if !self.control.cancelled()
                && generation == self.control.generation.load(Ordering::Acquire)
            {
                self.control.fail(match error {
                    mpsc::TrySendError::Full(_) => Fault::SignalsFull,
                    mpsc::TrySendError::Disconnected(_) => Fault::Disconnected,
                });
            }
        })
    }
}

/// Finite invocation budget, not a wall-time bound on foreign callback work.
pub(super) fn budgeted(mut work: impl FnMut() -> bool, budget: usize, control: &Control) {
    for _ in 0..budget {
        if control.cancelled() || !work() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_native_media::state::MediaSignal;

    fn signal(generation: u64, position: u32) -> super::super::GenerationSignal {
        super::super::GenerationSignal {
            generation,
            signal: MediaSignal::PositionMs(f64::from(position)),
        }
    }

    #[test]
    fn bounded_signals_preserve_order_and_fail_closed_on_overload() {
        let control = Arc::new(Control::default());
        control.generation.store(1, Ordering::Release);
        let (sender, receiver) = SignalSender::channel(Arc::clone(&control));
        for position in 0..SIGNAL_CAPACITY {
            assert!(sender.send(signal(1, position as u32)).is_ok());
        }
        assert!(sender.send(signal(1, 999)).is_err());
        assert_eq!(control.reason(), Some("native-gstplay-signal-overload"));
        assert!(sender.send(signal(1, 1000)).is_err());
        for position in 0..SIGNAL_CAPACITY {
            let received = receiver.try_recv().unwrap();
            assert!(
                matches!(received.signal, MediaSignal::PositionMs(value) if value == position as f64)
            );
        }
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        control.shutdown.store(true, Ordering::Release);
        control.fail(Fault::ActorExited);
        assert_eq!(control.reason(), Some("native-gstplay-signal-overload"));
    }

    #[test]
    fn retired_callbacks_cannot_fill_queue_or_fault_next_generation() {
        let control = Arc::new(Control::default());
        control.generation.store(2, Ordering::Release);
        let (sender, receiver) = SignalSender::channel(Arc::clone(&control));
        for _ in 0..SIGNAL_CAPACITY * 2 {
            assert!(sender.send(signal(1, 0)).is_err());
        }
        assert!(receiver.try_recv().is_err());
        assert_eq!(control.reason(), None);
        control.generation.store(0, Ordering::Release);
        drop(receiver);
        assert!(sender.send(signal(2, 0)).is_err());
        assert_eq!(control.reason(), None);
    }

    #[test]
    fn live_receiver_loss_is_terminal_but_shutdown_callbacks_are_harmless() {
        let control = Arc::new(Control::default());
        control.generation.store(1, Ordering::Release);
        let (sender, receiver) = SignalSender::channel(Arc::clone(&control));
        drop(receiver);
        assert!(sender.send(signal(1, 0)).is_err());
        assert_eq!(
            control.reason(),
            Some("native-gstplay-channel-disconnected")
        );

        let control = Arc::new(Control::default());
        control.generation.store(1, Ordering::Release);
        let (sender, receiver) = SignalSender::channel(Arc::clone(&control));
        control.shutdown.store(true, Ordering::Release);
        drop(receiver);
        assert!(sender.send(signal(1, 0)).is_err());
        assert_eq!(control.reason(), None);
    }

    #[test]
    fn finite_budget_yields_even_when_work_never_empties_and_observes_shutdown() {
        let control = Control::default();
        let mut count = 0;
        budgeted(
            || {
                count += 1;
                true
            },
            SIGNAL_BUDGET,
            &control,
        );
        assert_eq!(count, SIGNAL_BUDGET);
        budgeted(
            || {
                count += 1;
                control.shutdown.store(true, Ordering::Release);
                true
            },
            SIGNAL_BUDGET,
            &control,
        );
        assert_eq!(count, SIGNAL_BUDGET + 1);
        budgeted(
            || {
                count += 1;
                true
            },
            SIGNAL_BUDGET,
            &control,
        );
        assert_eq!(count, SIGNAL_BUDGET + 1);
    }
}

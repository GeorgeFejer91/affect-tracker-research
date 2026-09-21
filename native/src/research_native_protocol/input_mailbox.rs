//! Bounded native-input transport for the package protocol worker.
//!
//! Hook callbacks never perform disk I/O or wait for the protocol thread.
//! Digital edges remain ordered and bounded; absolute/analog state is
//! intentionally coalesced to the newest observation.

use crate::research_contracts::InputKindV1;
use crate::research_error::{CommandError, ResearchResult};
use crate::research_input::{
    NativeContinuousInput, NativeDigitalInput, NativeInputAuthorityLoss, NativeInputUpdate,
};
use std::collections::VecDeque;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

const DIGITAL_CAPACITY: usize = 128;
const CONTINUOUS_EVIDENCE_CAPACITY: usize = 1024;

pub(crate) struct ProtocolInputMailbox {
    expected_kind: InputKindV1,
    preserve_continuous: bool,
    state: Mutex<MailboxState>,
}

#[derive(Default)]
struct MailboxState {
    digital: VecDeque<NativeDigitalInput>,
    continuous: Option<NativeContinuousInput>,
    continuous_evidence: VecDeque<NativeContinuousInput>,
    coalesced_count: u64,
    failure: Option<MailboxFailure>,
}

#[derive(Debug)]
struct MailboxFailure {
    reason_code: &'static str,
    observed_at: Instant,
}

#[derive(Debug, Default)]
pub(crate) struct InputDrain {
    pub(crate) digital: VecDeque<NativeDigitalInput>,
    pub(crate) continuous: Option<NativeContinuousInput>,
    pub(crate) continuous_evidence: VecDeque<NativeContinuousInput>,
    pub(crate) coalesced_count: u64,
}

impl ProtocolInputMailbox {
    pub(crate) fn new(expected_kind: InputKindV1) -> Self {
        Self::with_continuous_evidence(expected_kind, false)
    }

    pub(crate) fn new_preserving_continuous(expected_kind: InputKindV1) -> Self {
        Self::with_continuous_evidence(expected_kind, true)
    }

    fn with_continuous_evidence(expected_kind: InputKindV1, preserve_continuous: bool) -> Self {
        Self {
            expected_kind,
            preserve_continuous,
            state: Mutex::new(MailboxState::default()),
        }
    }

    pub(crate) fn push(&self, update: NativeInputUpdate) {
        let mut state = lock(&self.state);
        match update {
            NativeInputUpdate::AuthorityLost(NativeInputAuthorityLoss {
                reason_code,
                observed_at,
            }) => latch_failure(&mut state, reason_code, observed_at),
            NativeInputUpdate::Digital(input) => {
                if self.expected_kind != InputKindV1::Digital {
                    latch_failure(&mut state, "native-input-kind-mismatch", input.observed_at);
                } else if state.digital.len() == DIGITAL_CAPACITY {
                    latch_failure(&mut state, "native-input-queue-overflow", input.observed_at);
                } else {
                    state.digital.push_back(input);
                }
            }
            NativeInputUpdate::Continuous(input) => {
                if self.expected_kind == InputKindV1::Digital {
                    latch_failure(&mut state, "native-input-kind-mismatch", input.observed_at);
                } else if self.preserve_continuous {
                    if state.continuous_evidence.len() == CONTINUOUS_EVIDENCE_CAPACITY {
                        latch_failure(&mut state, "native-input-queue-overflow", input.observed_at);
                    } else if state
                        .continuous_evidence
                        .back()
                        .is_some_and(|current| current.observed_at > input.observed_at)
                    {
                        latch_failure(&mut state, "native-input-order-reversed", input.observed_at);
                    } else {
                        state.continuous_evidence.push_back(input);
                    }
                } else if state
                    .continuous
                    .as_ref()
                    .is_some_and(|current| current.observed_at > input.observed_at)
                {
                    state.coalesced_count = state.coalesced_count.saturating_add(1);
                } else {
                    if state.continuous.replace(input).is_some() {
                        state.coalesced_count = state.coalesced_count.saturating_add(1);
                    }
                }
            }
        }
    }

    pub(crate) fn drain(&self) -> ResearchResult<InputDrain> {
        let mut state = lock(&self.state);
        if let Some(failure) = state.failure.take() {
            state.digital.clear();
            state.continuous = None;
            state.continuous_evidence.clear();
            state.coalesced_count = 0;
            return Err(CommandError::new(
                "native_input_failed",
                format!(
                    "The native input authority failed closed ({} at {:?}).",
                    failure.reason_code, failure.observed_at
                ),
            ));
        }
        Ok(InputDrain {
            digital: std::mem::take(&mut state.digital),
            continuous: state.continuous.take(),
            continuous_evidence: std::mem::take(&mut state.continuous_evidence),
            coalesced_count: std::mem::take(&mut state.coalesced_count),
        })
    }

    pub(crate) fn clear(&self) {
        let mut state = lock(&self.state);
        state.digital.clear();
        state.continuous = None;
        state.continuous_evidence.clear();
        state.coalesced_count = 0;
    }
}

fn latch_failure(state: &mut MailboxState, reason_code: &'static str, observed_at: Instant) {
    if state.failure.is_none() {
        state.failure = Some(MailboxFailure {
            reason_code,
            observed_at,
        });
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_contracts::DirectionV1;

    fn digital(at: Instant) -> NativeInputUpdate {
        NativeInputUpdate::Digital(NativeDigitalInput {
            direction: DirectionV1::Right,
            detail: "test:right".to_owned(),
            apply_step: true,
            input_active: true,
            impulse: false,
            observed_at: at,
        })
    }

    #[test]
    fn preserves_digital_edges_and_fails_closed_on_overflow() {
        let mailbox = ProtocolInputMailbox::new(InputKindV1::Digital);
        for _ in 0..DIGITAL_CAPACITY {
            mailbox.push(digital(Instant::now()));
        }
        assert_eq!(mailbox.drain().unwrap().digital.len(), DIGITAL_CAPACITY);
        for _ in 0..=DIGITAL_CAPACITY {
            mailbox.push(digital(Instant::now()));
        }
        assert_eq!(mailbox.drain().unwrap_err().code, "native_input_failed");
    }

    #[test]
    fn evidence_mode_preserves_every_ordered_continuous_observation() {
        let mailbox = ProtocolInputMailbox::new_preserving_continuous(InputKindV1::Absolute);
        let epoch = Instant::now();
        for index in 0..3 {
            mailbox.push(NativeInputUpdate::Continuous(NativeContinuousInput {
                x: index as f64 / 10.,
                y: 0.,
                detail: "test:absolute".into(),
                input_active: true,
                observed_at: epoch + std::time::Duration::from_millis(index),
            }));
        }
        let drain = mailbox.drain().unwrap();
        assert!(drain.continuous.is_none());
        assert_eq!(drain.coalesced_count, 0);
        assert_eq!(drain.continuous_evidence.len(), 3);
        assert_eq!(drain.continuous_evidence[2].x, 0.2);
    }
}

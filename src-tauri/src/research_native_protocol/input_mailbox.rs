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

pub(super) struct ProtocolInputMailbox {
    expected_kind: InputKindV1,
    state: Mutex<MailboxState>,
}

#[derive(Default)]
struct MailboxState {
    digital: VecDeque<NativeDigitalInput>,
    continuous: Option<NativeContinuousInput>,
    coalesced_count: u64,
    failure: Option<MailboxFailure>,
}

#[derive(Debug)]
struct MailboxFailure {
    reason_code: &'static str,
    observed_at: Instant,
}

#[derive(Debug, Default)]
pub(super) struct InputDrain {
    pub(super) digital: VecDeque<NativeDigitalInput>,
    pub(super) continuous: Option<NativeContinuousInput>,
    pub(super) coalesced_count: u64,
}

impl ProtocolInputMailbox {
    pub(super) fn new(expected_kind: InputKindV1) -> Self {
        Self {
            expected_kind,
            state: Mutex::new(MailboxState::default()),
        }
    }

    pub(super) fn push(&self, update: NativeInputUpdate) {
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

    pub(super) fn drain(&self) -> ResearchResult<InputDrain> {
        let mut state = lock(&self.state);
        if let Some(failure) = state.failure.take() {
            state.digital.clear();
            state.continuous = None;
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
            coalesced_count: std::mem::take(&mut state.coalesced_count),
        })
    }

    pub(super) fn clear(&self) {
        let mut state = lock(&self.state);
        state.digital.clear();
        state.continuous = None;
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
}

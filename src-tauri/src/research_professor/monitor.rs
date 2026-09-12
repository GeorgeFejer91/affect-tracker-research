//! Optional lossy monitor tap. Never blocks the native sampler or stores research files.
use crate::research_contracts::ResearchSampleV1;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSample {
    pub run_id: String,
    pub sequence: u64,
    pub elapsed_ms: f64,
    pub valence: f64,
    pub arousal: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(sequence: u64, elapsed_ms: f64) -> MonitorSample {
        MonitorSample {
            run_id: "run_fixture".into(),
            sequence,
            elapsed_ms,
            valence: 0.2,
            arousal: -0.4,
        }
    }
    #[test]
    fn disabled_lossy_tap_never_waits_for_a_busy_monitor_and_clears_on_revoke() {
        let mailbox = MonitorMailbox::default();
        mailbox.publish_projection(sample(1, 0.0));
        assert!(mailbox.snapshot().is_none());
        mailbox.set_enabled(true);
        mailbox.publish_projection(sample(1, 0.0));
        mailbox.publish_projection(sample(2, 100.0));
        assert_eq!(mailbox.snapshot().unwrap().sequence, 1);
        let guard = mailbox.latest.lock().unwrap();
        mailbox.publish_projection(sample(3, 300.0));
        drop(guard);
        assert_eq!(mailbox.snapshot().unwrap().sequence, 1);
        mailbox.publish_projection(sample(4, 500.0));
        assert_eq!(mailbox.snapshot().unwrap().sequence, 4);
        mailbox.set_enabled(false);
        assert!(mailbox.snapshot().is_none());
    }
    #[test]
    fn invalid_master_projections_are_dropped() {
        let mailbox = MonitorMailbox::default();
        mailbox.set_enabled(true);
        let mut bad = sample(1, 0.0);
        bad.arousal = f64::NAN;
        mailbox.publish_projection(bad);
        assert!(mailbox.snapshot().is_none());
    }
}
#[derive(Default)]
pub struct MonitorMailbox {
    enabled: AtomicBool,
    latest: Mutex<Option<MonitorSample>>,
}
impl MonitorMailbox {
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
        if let Ok(mut latest) = self.latest.lock() {
            *latest = None;
        }
    }
    pub fn publish(&self, sample: &ResearchSampleV1) {
        if !self.enabled.load(Ordering::Acquire) {
            return;
        }
        let Ok(ns) = sample.monotonic_time_ns.parse::<u128>() else {
            return;
        };
        let elapsed_ms = ns as f64 / 1_000_000.0;
        self.publish_projection(MonitorSample {
            run_id: sample.run_id.clone(),
            sequence: sample.sequence,
            elapsed_ms,
            valence: sample.current_valence,
            arousal: sample.current_arousal,
        });
    }
    pub(crate) fn publish_projection(&self, sample: MonitorSample) {
        if !self.enabled.load(Ordering::Acquire) {
            return;
        }
        let Ok(mut slot) = self.latest.try_lock() else {
            return;
        };
        if !self.enabled.load(Ordering::Acquire)
            || sample.run_id.is_empty()
            || sample.run_id.len() > 96
            || !sample.elapsed_ms.is_finite()
            || sample.elapsed_ms < 0.0
            || sample.sequence == 0
            || sample.sequence > 9_007_199_254_740_991
            || ![sample.valence, sample.arousal]
                .iter()
                .all(|v| v.is_finite() && (-1.0..=1.0).contains(v))
        {
            return;
        }
        if let Some(previous) = slot.as_ref() {
            if previous.run_id == sample.run_id
                && (sample.elapsed_ms - previous.elapsed_ms < 250.0
                    || sample.sequence <= previous.sequence)
            {
                return;
            }
        }
        *slot = Some(sample);
    }
    pub fn snapshot(&self) -> Option<MonitorSample> {
        self.latest.try_lock().ok().and_then(|slot| slot.clone())
    }
}

//! Complete P5 response semantics driven solely by native input observations.
use crate::research_contracts::DirectionV1;
use crate::research_feedback::{FeedbackHoldRuleV2, FeedbackResponseModeV2, FeedbackResponseV2};
use crate::research_input::{NativeContinuousInput, NativeDigitalInput};
use std::time::{Duration, Instant};

pub(crate) struct ResponseState {
    pub x: f64,
    pub y: f64,
    pub anchor: Instant,
    integrated_at: Instant,
    held: [bool; 4],
    repeats: [Option<Instant>; 4],
    pulse_until: Instant,
    analogue_active: bool,
    configuration: FeedbackResponseV2,
}

impl ResponseState {
    pub(crate) fn new(configuration: FeedbackResponseV2, now: Instant) -> Self {
        Self {
            x: 0.,
            y: 0.,
            anchor: now,
            integrated_at: now,
            held: [false; 4],
            repeats: [None; 4],
            pulse_until: now,
            analogue_active: false,
            configuration,
        }
    }
    pub(crate) fn clear_holds(&mut self, now: Instant) {
        self.held = [false; 4];
        self.repeats = [None; 4];
        self.pulse_until = now;
        self.analogue_active = false;
        self.anchor = now;
        self.integrated_at = now;
    }
    pub(crate) fn active(&self, now: Instant) -> bool {
        self.held.iter().any(|v| *v) || self.analogue_active || now < self.pulse_until
    }
    pub(crate) fn digital(&mut self, input: NativeDigitalInput) -> u64 {
        let missed = self.advance(input.observed_at);
        self.anchor = self.anchor.max(input.observed_at);
        let effective_at = input.observed_at.max(self.integrated_at);
        let index = match input.direction {
            DirectionV1::Up => 0,
            DirectionV1::Down => 1,
            DirectionV1::Left => 2,
            DirectionV1::Right => 3,
        };
        if input.impulse {
            self.step(index);
            self.pulse_until = effective_at + Duration::from_millis(100);
            return missed;
        }
        // The native hook suppresses OS repeat; apply_step=false is a release.
        self.held[index] = input.apply_step;
        self.repeats[index] = (input.apply_step
            && self.configuration.hold_rule == FeedbackHoldRuleV2::RepeatWhileHeld)
            .then_some(
                effective_at + Duration::from_millis(self.configuration.repeat_delay_ms.into()),
            );
        if input.apply_step
            && self.configuration.mode == FeedbackResponseModeV2::Stepwise
            && !self.held[index ^ 1]
        {
            self.step(index);
        }
        missed
    }
    pub(crate) fn continuous(&mut self, input: NativeContinuousInput) -> u64 {
        let missed = self.advance(input.observed_at);
        self.anchor = self.anchor.max(input.observed_at);
        (self.x, self.y) = if self.configuration.mode == FeedbackResponseModeV2::Stepwise {
            (
                snap(input.x, self.configuration.grid.columns),
                snap(input.y, self.configuration.grid.rows),
            )
        } else {
            (input.x, input.y)
        };
        self.analogue_active = input.input_active;
        missed
    }
    /// Integrate continuous holds at observation time. Repeat polling emits at
    /// most one step per held direction and reports overdue repeats to the worker.
    pub(crate) fn advance(&mut self, now: Instant) -> u64 {
        if now < self.integrated_at {
            return 0;
        }
        let elapsed_ms = now.duration_since(self.integrated_at).as_secs_f64() * 1000.;
        self.integrated_at = now;
        if self.configuration.mode == FeedbackResponseModeV2::Continuous {
            let distance = 2. * elapsed_ms / f64::from(self.configuration.full_span_duration_ms);
            self.x = (self.x + distance * (i8::from(self.held[3]) - i8::from(self.held[2])) as f64)
                .clamp(-1., 1.);
            self.y = (self.y + distance * (i8::from(self.held[0]) - i8::from(self.held[1])) as f64)
                .clamp(-1., 1.);
            return 0;
        }
        let mut missed = 0;
        for index in 0..4 {
            if let Some(deadline) = self.repeats[index].filter(|deadline| now >= *deadline) {
                let delay = Duration::from_millis(self.configuration.repeat_delay_ms.into());
                let overdue = (now.duration_since(deadline).as_nanos() / delay.as_nanos()) as u64;
                missed += overdue;
                self.repeats[index] = Some(deadline + delay.mul_f64((overdue + 1) as f64));
                if self.held[index] && !self.held[index ^ 1] {
                    self.step(index);
                }
            }
        }
        missed
    }
    fn step(&mut self, index: usize) {
        let dx = 2. / f64::from(self.configuration.grid.columns - 1);
        let dy = 2. / f64::from(self.configuration.grid.rows - 1);
        match index {
            0 => self.y = (self.y + dy).clamp(-1., 1.),
            1 => self.y = (self.y - dy).clamp(-1., 1.),
            2 => self.x = (self.x - dx).clamp(-1., 1.),
            _ => self.x = (self.x + dx).clamp(-1., 1.),
        }
    }
}
fn snap(value: f64, dimension: u32) -> f64 {
    ((value + 1.) * 0.5 * f64::from(dimension - 1)).round() * 2. / f64::from(dimension - 1) - 1.
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_feedback::{FeedbackContributionV2, FeedbackGridV2};
    fn configuration() -> FeedbackResponseV2 {
        serde_json::from_str::<FeedbackContributionV2>(include_str!(
            "../../../test/fixtures/research-feedback-settings-v2.json"
        ))
        .unwrap()
        .response
    }
    fn edge(direction: DirectionV1, pressed: bool, at: Instant) -> NativeDigitalInput {
        NativeDigitalInput {
            direction,
            detail: "test".into(),
            apply_step: pressed,
            input_active: pressed,
            impulse: false,
            observed_at: at,
        }
    }
    #[test]
    fn full_span_hold_uses_native_elapsed_time_and_opposites_cancel() {
        let t = Instant::now();
        let mut c = configuration();
        c.mode = FeedbackResponseModeV2::Continuous;
        c.full_span_duration_ms = 2000;
        let mut s = ResponseState::new(c, t);
        s.digital(edge(DirectionV1::Right, true, t));
        s.advance(t + Duration::from_millis(500));
        assert_eq!(s.x, 0.5);
        s.digital(edge(
            DirectionV1::Left,
            true,
            t + Duration::from_millis(500),
        ));
        s.advance(t + Duration::from_millis(1000));
        assert_eq!(s.x, 0.5);
        s.digital(edge(
            DirectionV1::Right,
            false,
            t + Duration::from_millis(1000),
        ));
        s.advance(t + Duration::from_millis(1500));
        assert_eq!(s.x, 0.);
        s.clear_holds(t + Duration::from_millis(1500));
        s.advance(t + Duration::from_secs(4));
        assert_eq!(s.x, 0.);
    }
    #[test]
    fn repeats_use_authored_rectangular_grid_and_report_overdue_slots() {
        let t = Instant::now();
        let mut c = configuration();
        c.mode = FeedbackResponseModeV2::Stepwise;
        c.grid = FeedbackGridV2 {
            columns: 5,
            rows: 9,
        };
        c.repeat_delay_ms = 500;
        c.hold_rule = FeedbackHoldRuleV2::RepeatWhileHeld;
        let mut s = ResponseState::new(c, t);
        s.digital(edge(DirectionV1::Up, true, t));
        assert_eq!(s.y, 0.25);
        s.advance(t + Duration::from_millis(499));
        assert_eq!(s.y, 0.25);
        assert_eq!(s.advance(t + Duration::from_millis(1600)), 2);
        assert_eq!(s.y, 0.5);
        s.digital(edge(
            DirectionV1::Up,
            false,
            t + Duration::from_millis(1700),
        ));
        s.advance(t + Duration::from_secs(5));
        assert_eq!(s.y, 0.5);
        s.digital(NativeDigitalInput {
            impulse: true,
            ..edge(DirectionV1::Right, true, t + Duration::from_secs(5))
        });
        assert_eq!(s.x, 0.5);
    }
    #[test]
    fn analogue_is_position_and_stepwise_snaps_without_duration_velocity() {
        let t = Instant::now();
        let mut c = configuration();
        c.mode = FeedbackResponseModeV2::Stepwise;
        c.grid = FeedbackGridV2 {
            columns: 5,
            rows: 9,
        };
        let mut s = ResponseState::new(c, t);
        s.continuous(NativeContinuousInput {
            x: 0.6,
            y: -0.4,
            detail: "test".into(),
            input_active: true,
            observed_at: t,
        });
        assert_eq!((s.x, s.y), (0.5, -0.5));
        s.advance(t + Duration::from_secs(10));
        assert_eq!((s.x, s.y), (0.5, -0.5));
    }
}

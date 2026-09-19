use super::contracts::{ProtocolStepV2, ResolvedProtocolPlanV2};
use crate::research_error::{CommandError, ResearchResult};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolPhase {
    Questionnaire,
    StimulusReady,
    StimulusPlaying,
    StimulusPaused,
    Interval,
    CompleteReady,
    Finalizing,
    Finished,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaEdge {
    Started,
    Paused,
    Resumed,
    Completed,
}

#[derive(Debug, Clone)]
pub struct ProtocolReducer {
    safe_protocol_position: u32,
    phase: ProtocolPhase,
    interval_deadline: Option<Instant>,
}

impl ProtocolReducer {
    pub fn new(plan: &ResolvedProtocolPlanV2, now: Instant) -> ResearchResult<Self> {
        Self::resume(plan, 0, now)
    }

    pub fn resume(
        plan: &ResolvedProtocolPlanV2,
        safe_protocol_position: u32,
        now: Instant,
    ) -> ResearchResult<Self> {
        plan.validate_self()?;
        if safe_protocol_position as usize > plan.steps.len() {
            return Err(CommandError::invalid_contract(
                "The native recovery boundary exceeds the frozen protocol plan.",
            ));
        }
        let mut reducer = Self {
            safe_protocol_position,
            phase: ProtocolPhase::CompleteReady,
            interval_deadline: None,
        };
        reducer.enter_current(plan, now)?;
        Ok(reducer)
    }

    pub fn safe_protocol_position(&self) -> u32 {
        self.safe_protocol_position
    }

    pub fn active_protocol_position(&self, plan: &ResolvedProtocolPlanV2) -> Option<u32> {
        (self.safe_protocol_position < plan.steps.len() as u32)
            .then_some(self.safe_protocol_position + 1)
    }

    pub fn current_step<'a>(&self, plan: &'a ResolvedProtocolPlanV2) -> Option<&'a ProtocolStepV2> {
        self.active_protocol_position(plan)
            .and_then(|position| plan.step(position))
    }

    pub fn phase(&self) -> ProtocolPhase {
        self.phase
    }

    pub fn submit_questionnaire(
        &mut self,
        plan: &ResolvedProtocolPlanV2,
        protocol_position: u32,
        now: Instant,
    ) -> ResearchResult<()> {
        self.require_current_position(plan, protocol_position)?;
        if self.phase != ProtocolPhase::Questionnaire
            || !matches!(
                self.current_step(plan),
                Some(ProtocolStepV2::Questionnaire { .. })
            )
        {
            return Err(CommandError::invalid_contract(
                "Questionnaire submission is available only for the active questionnaire step.",
            ));
        }
        self.complete_current(plan, now)
    }

    pub fn apply_media_edge(
        &mut self,
        plan: &ResolvedProtocolPlanV2,
        protocol_position: u32,
        edge: MediaEdge,
        now: Instant,
    ) -> ResearchResult<()> {
        self.require_current_position(plan, protocol_position)?;
        if !matches!(
            self.current_step(plan),
            Some(ProtocolStepV2::Stimulus { .. })
        ) {
            return Err(CommandError::invalid_contract(
                "Media lifecycle can mutate only the active stimulus step.",
            ));
        }
        match (self.phase, edge) {
            (ProtocolPhase::StimulusReady, MediaEdge::Started) => {
                self.phase = ProtocolPhase::StimulusPlaying;
            }
            (ProtocolPhase::StimulusPlaying, MediaEdge::Paused) => {
                self.phase = ProtocolPhase::StimulusPaused;
            }
            (ProtocolPhase::StimulusPaused, MediaEdge::Resumed) => {
                self.phase = ProtocolPhase::StimulusPlaying;
            }
            (
                ProtocolPhase::StimulusPlaying | ProtocolPhase::StimulusPaused,
                MediaEdge::Completed,
            ) => {
                self.complete_current(plan, now)?;
            }
            _ => {
                return Err(CommandError::invalid_contract(
                    "The native media lifecycle edge is invalid for the current protocol phase.",
                ));
            }
        }
        Ok(())
    }

    pub fn poll_interval(
        &mut self,
        plan: &ResolvedProtocolPlanV2,
        now: Instant,
    ) -> ResearchResult<bool> {
        if self.phase != ProtocolPhase::Interval {
            return Ok(false);
        }
        let deadline = self.interval_deadline.ok_or_else(|| {
            CommandError::invalid_contract("The active interval has no native deadline.")
        })?;
        if now < deadline {
            return Ok(false);
        }
        self.complete_current(plan, now)?;
        Ok(true)
    }

    pub fn interval_remaining(&self, now: Instant) -> Option<Duration> {
        self.interval_deadline.map(|deadline| {
            deadline
                .checked_duration_since(now)
                .unwrap_or(Duration::ZERO)
        })
    }

    pub fn begin_finalization(&mut self) -> ResearchResult<()> {
        if matches!(
            self.phase,
            ProtocolPhase::Finalizing | ProtocolPhase::Finished | ProtocolPhase::Failed
        ) {
            return Err(CommandError::invalid_contract(
                "The protocol cannot begin finalization from its terminal phase.",
            ));
        }
        self.phase = ProtocolPhase::Finalizing;
        self.interval_deadline = None;
        Ok(())
    }

    pub fn finish(&mut self) {
        self.phase = ProtocolPhase::Finished;
        self.interval_deadline = None;
    }

    pub fn fail(&mut self) {
        self.phase = ProtocolPhase::Failed;
        self.interval_deadline = None;
    }

    fn require_current_position(
        &self,
        plan: &ResolvedProtocolPlanV2,
        protocol_position: u32,
    ) -> ResearchResult<()> {
        if self.active_protocol_position(plan) != Some(protocol_position) {
            return Err(CommandError::invalid_contract(
                "The protocol action does not target the current frozen step.",
            ));
        }
        Ok(())
    }

    fn complete_current(
        &mut self,
        plan: &ResolvedProtocolPlanV2,
        now: Instant,
    ) -> ResearchResult<()> {
        let current = self.active_protocol_position(plan).ok_or_else(|| {
            CommandError::invalid_contract("The protocol has no active step to complete.")
        })?;
        self.safe_protocol_position = current;
        self.interval_deadline = None;
        self.enter_current(plan, now)
    }

    fn enter_current(&mut self, plan: &ResolvedProtocolPlanV2, now: Instant) -> ResearchResult<()> {
        let Some(step) = self.current_step(plan) else {
            self.phase = ProtocolPhase::CompleteReady;
            self.interval_deadline = None;
            return Ok(());
        };
        match step {
            ProtocolStepV2::Questionnaire { .. } => {
                self.phase = ProtocolPhase::Questionnaire;
                self.interval_deadline = None;
            }
            ProtocolStepV2::Stimulus { .. } => {
                self.phase = ProtocolPhase::StimulusReady;
                self.interval_deadline = None;
            }
            ProtocolStepV2::Interval { duration_ms, .. } => {
                self.phase = ProtocolPhase::Interval;
                self.interval_deadline = Some(now + Duration::from_millis(u64::from(*duration_ms)));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_experiment_package::parse_experiment_package_bytes;
    use crate::research_native_protocol::compiler::compile_package_selection;

    fn plan() -> ResolvedProtocolPlanV2 {
        let loaded = parse_experiment_package_bytes(include_bytes!(
            "../../../test/fixtures/experiment-package-v1.canonical.json"
        ))
        .unwrap();
        compile_package_selection(
            &loaded.package,
            &loaded.source_byte_sha256,
            "en",
            &["en".to_owned()],
            "P001",
        )
        .unwrap()
        .protocol_plan
    }

    #[test]
    fn advances_only_through_the_exact_active_step_kind() {
        let plan = plan();
        let epoch = Instant::now();
        let mut reducer = ProtocolReducer::new(&plan, epoch).unwrap();
        assert_eq!(reducer.phase(), ProtocolPhase::StimulusReady);
        assert!(reducer.submit_questionnaire(&plan, 1, epoch).is_err());
        reducer
            .apply_media_edge(&plan, 1, MediaEdge::Started, epoch)
            .unwrap();
        reducer
            .apply_media_edge(&plan, 1, MediaEdge::Completed, epoch)
            .unwrap();
        assert_eq!(reducer.safe_protocol_position(), 1);
        assert_eq!(reducer.phase(), ProtocolPhase::Questionnaire);
        reducer.submit_questionnaire(&plan, 2, epoch).unwrap();
        assert_eq!(reducer.phase(), ProtocolPhase::Questionnaire);
        reducer.submit_questionnaire(&plan, 3, epoch).unwrap();
        assert_eq!(reducer.phase(), ProtocolPhase::Interval);
        assert!(!reducer.poll_interval(&plan, epoch).unwrap());
    }

    #[test]
    fn recovery_restarts_an_unsafe_stimulus_or_interval_boundary() {
        let plan = plan();
        let epoch = Instant::now();
        let stimulus = ProtocolReducer::resume(&plan, 0, epoch).unwrap();
        assert_eq!(stimulus.phase(), ProtocolPhase::StimulusReady);
        let interval = ProtocolReducer::resume(&plan, 3, epoch).unwrap();
        assert_eq!(interval.phase(), ProtocolPhase::Interval);
        assert!(interval.interval_remaining(epoch).unwrap() > Duration::ZERO);
    }

    #[test]
    fn complete_package_protocol_runs_every_authored_step_in_order() {
        let plan = plan();
        let epoch = Instant::now();
        let mut now = epoch;
        let mut reducer = ProtocolReducer::new(&plan, now).unwrap();
        let mut observed = Vec::new();

        while let Some(step) = reducer.current_step(&plan).cloned() {
            let position = reducer.active_protocol_position(&plan).unwrap();
            match step {
                ProtocolStepV2::Questionnaire { module_id, .. } => {
                    observed.push(format!("questionnaire:{module_id}"));
                    reducer.submit_questionnaire(&plan, position, now).unwrap();
                }
                ProtocolStepV2::Stimulus { stimulus_id, .. } => {
                    observed.push(format!("stimulus:{stimulus_id}"));
                    reducer
                        .apply_media_edge(&plan, position, MediaEdge::Started, now)
                        .unwrap();
                    reducer
                        .apply_media_edge(&plan, position, MediaEdge::Paused, now)
                        .unwrap();
                    reducer
                        .apply_media_edge(&plan, position, MediaEdge::Resumed, now)
                        .unwrap();
                    reducer
                        .apply_media_edge(&plan, position, MediaEdge::Completed, now)
                        .unwrap();
                }
                ProtocolStepV2::Interval {
                    stimulus_id,
                    duration_ms,
                    ..
                } => {
                    observed.push(format!("interval:{stimulus_id}:{duration_ms}"));
                    if duration_ms > 0 {
                        assert!(!reducer.poll_interval(&plan, now).unwrap());
                        now += Duration::from_millis(u64::from(duration_ms));
                    }
                    assert!(reducer.poll_interval(&plan, now).unwrap());
                }
            }
        }

        assert_eq!(reducer.safe_protocol_position(), plan.steps.len() as u32);
        assert_eq!(reducer.phase(), ProtocolPhase::CompleteReady);
        assert_eq!(observed.len(), plan.steps.len());
        assert_eq!(
            observed,
            vec![
                "stimulus:calm-01",
                "questionnaire:vr-after-calm-followup",
                "questionnaire:vr-after-calm",
                "interval:calm-01:3000",
                "questionnaire:vr-after-calm-isi",
                "stimulus:active-01",
                "interval:active-01:0",
            ]
        );
        reducer.begin_finalization().unwrap();
        assert_eq!(reducer.phase(), ProtocolPhase::Finalizing);
        reducer.finish();
        assert_eq!(reducer.phase(), ProtocolPhase::Finished);
    }
}

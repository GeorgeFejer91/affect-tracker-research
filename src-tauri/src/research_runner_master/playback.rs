//! Live, occurrence-bound playback observations for the one master worker.
//! A command acknowledgement or post-run receipt cannot open sampling.
use super::{WebviewMediaEvent, WebviewMediaOffer, WebviewMediaState};
use crate::research_native_media::NativeMediaStateV1;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlaybackBackend {
    Webview,
}

#[derive(Debug, Clone)]
pub(crate) struct PlaybackBinding {
    pub backend: PlaybackBackend,
    pub attempt_id: String,
    pub position: u32,
    pub generation: u64,
    pub workspace_file_id: String,
    pub asset_sha256: String,
}

impl PlaybackBinding {
    pub(crate) fn webview(offer: &WebviewMediaOffer, attempt_id: &str, position: u32) -> Self {
        Self {
            backend: PlaybackBackend::Webview,
            attempt_id: attempt_id.to_owned(),
            position,
            generation: offer.generation,
            workspace_file_id: offer.workspace_file_id.clone(),
            asset_sha256: offer.sha256.clone(),
        }
    }

    pub(crate) fn accepts(
        &self,
        observation: &PlaybackObservation,
        last_sequence: u64,
        last_position_ms: Option<f64>,
        last_decoded_frames: u64,
    ) -> bool {
        observation.backend == self.backend
            && observation.attempt_id == self.attempt_id
            && observation.position == self.position
            && observation.generation == self.generation
            && observation.workspace_file_id == self.workspace_file_id
            && observation.asset_sha256 == self.asset_sha256
            && observation.sequence > last_sequence
            && observation.position_ms.is_finite()
            && observation.position_ms >= 0.
            && observation.decoded_frames >= last_decoded_frames
            && (observation.state == PlaybackState::Failed
                || last_position_ms.is_none_or(|prior| observation.position_ms + 20. >= prior))
            && (!matches!(
                observation.state,
                PlaybackState::Playing | PlaybackState::Ended
            ) || observation.decoded_frames > 0)
            && !(observation.state == PlaybackState::Playing
                && observation.decoded_frames <= last_decoded_frames)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PlaybackState {
    Playing,
    Buffering,
    Paused,
    Ended,
    Failed,
}

impl PlaybackState {
    pub(crate) fn native(self) -> NativeMediaStateV1 {
        match self {
            Self::Playing => NativeMediaStateV1::Playing,
            Self::Buffering => NativeMediaStateV1::Buffering,
            Self::Paused => NativeMediaStateV1::Paused,
            Self::Ended => NativeMediaStateV1::Ended,
            Self::Failed => NativeMediaStateV1::Failed,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PlaybackObservation {
    pub backend: PlaybackBackend,
    pub attempt_id: String,
    pub position: u32,
    pub generation: u64,
    pub workspace_file_id: String,
    pub asset_sha256: String,
    pub sequence: u64,
    pub state: PlaybackState,
    pub position_ms: f64,
    pub decoded_frames: u64,
}

impl PlaybackObservation {
    pub(crate) fn webview(event: &WebviewMediaEvent) -> Self {
        Self {
            backend: PlaybackBackend::Webview,
            attempt_id: event.attempt_id.clone(),
            position: event.position,
            generation: event.generation,
            workspace_file_id: event.workspace_file_id.clone(),
            asset_sha256: event.sha256.clone(),
            sequence: event.sequence,
            state: match event.state {
                WebviewMediaState::Playing => PlaybackState::Playing,
                WebviewMediaState::Buffering => PlaybackState::Buffering,
                WebviewMediaState::Paused => PlaybackState::Paused,
                WebviewMediaState::Ended => PlaybackState::Ended,
                WebviewMediaState::Failed => PlaybackState::Failed,
            },
            position_ms: event.position_ms,
            decoded_frames: event.decoded_frames,
        }
    }

    pub(crate) fn detail(&self) -> Value {
        json!({"state":self.state,"sha256":self.asset_sha256,
            "workspaceFileId":self.workspace_file_id,"generation":self.generation,
            "sequence":self.sequence,"positionMs":self.position_ms,
            "decodedFrames":self.decoded_frames})
    }
}

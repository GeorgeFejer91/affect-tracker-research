//! Live, occurrence-bound playback observations for the one master worker.
//! A command acknowledgement or post-run receipt cannot open sampling.
use super::{WebviewMediaEvent, WebviewMediaOffer, WebviewMediaState};
use crate::research_native_media::NativeMediaStateV1;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlaybackBackend {
    Webview,
    Vlc,
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

    pub(crate) fn vlc(
        attempt_id: &str,
        position: u32,
        generation: u64,
        workspace_file_id: &str,
        asset_sha256: &str,
    ) -> Self {
        Self {
            backend: PlaybackBackend::Vlc,
            attempt_id: attempt_id.to_owned(),
            position,
            generation,
            workspace_file_id: workspace_file_id.to_owned(),
            asset_sha256: asset_sha256.to_owned(),
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
            && !(self.backend == PlaybackBackend::Vlc
                && observation.state == PlaybackState::Ended
                && last_decoded_frames == 0)
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
    pub(crate) fn vlc(value: &Value) -> Result<Self, &'static str> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire {
            protocol: String,
            kind: String,
            observation_source: String,
            backend: String,
            attempt_id: String,
            position: u32,
            generation: u64,
            workspace_file_id: String,
            asset_sha256: String,
            sequence: u64,
            state: String,
            position_ms: f64,
            decoded_frames: u64,
        }
        let wire: Wire =
            serde_json::from_value(value.clone()).map_err(|_| "invalid VLC observation")?;
        if wire.protocol != "flubber-vlc-runner-live/v1"
            || wire.kind != "observation"
            || wire.observation_source != "decoded-render"
            || wire.backend != "vlc"
            || wire.attempt_id.is_empty()
            || wire.generation == 0
            || wire.workspace_file_id.is_empty()
            || wire.asset_sha256.len() != 64
            || !wire
                .asset_sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
            || wire.sequence == 0
            || wire.decoded_frames == 0
            || !wire.position_ms.is_finite()
            || wire.position_ms < 0.
        {
            return Err("invalid VLC decoded observation");
        }
        let state = match wire.state.as_str() {
            "playing" => PlaybackState::Playing,
            "ended" => PlaybackState::Ended,
            _ => return Err("VLC state is not decoded playback"),
        };
        Ok(Self {
            backend: PlaybackBackend::Vlc,
            attempt_id: wire.attempt_id,
            position: wire.position,
            generation: wire.generation,
            workspace_file_id: wire.workspace_file_id,
            asset_sha256: wire.asset_sha256,
            sequence: wire.sequence,
            state,
            position_ms: wire.position_ms,
            decoded_frames: wire.decoded_frames,
        })
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vlc_wire_requires_live_decoded_evidence_and_exact_binding() {
        let wire = json!({"protocol":"flubber-vlc-runner-live/v1","kind":"observation",
            "observationSource":"decoded-render","backend":"vlc","attemptId":"attempt-1",
            "position":3,"generation":7,"workspaceFileId":"file-1","assetSha256":"a".repeat(64),
            "sequence":1,"state":"playing","positionMs":0,"decodedFrames":1});
        let binding = PlaybackBinding::vlc("attempt-1", 3, 7, "file-1", &"a".repeat(64));
        let observed = PlaybackObservation::vlc(&wire).unwrap();
        assert!(binding.accepts(&observed, 0, None, 0));
        let mut premature_end = wire.clone();
        premature_end["state"] = json!("ended");
        assert!(!binding.accepts(
            &PlaybackObservation::vlc(&premature_end).unwrap(),
            0,
            None,
            0
        ));
        for (field, replacement) in [
            ("attemptId", json!("another-attempt")),
            ("position", json!(4)),
            ("generation", json!(8)),
            ("workspaceFileId", json!("another-file")),
            ("assetSha256", json!("b".repeat(64))),
        ] {
            let mut wrong = wire.clone();
            wrong[field] = replacement;
            assert!(
                !binding.accepts(&PlaybackObservation::vlc(&wrong).unwrap(), 0, None, 0),
                "{field}"
            );
        }
        let mut wrong = wire.clone();
        wrong["observationSource"] = json!("plugin-csv-post-run");
        assert!(PlaybackObservation::vlc(&wrong).is_err());
        wrong = wire.clone();
        wrong["kind"] = json!("command");
        assert!(PlaybackObservation::vlc(&wrong).is_err());
        wrong = wire;
        wrong["state"] = json!("pause-requested");
        assert!(PlaybackObservation::vlc(&wrong).is_err());
    }
}

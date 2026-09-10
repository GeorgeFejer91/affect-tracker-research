#![cfg_attr(
    not(all(target_os = "windows", feature = "native-gstreamer")),
    allow(dead_code)
)]

use super::contracts::{NativeMediaStateV1, NativeMediaStatusV1};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackendPlaybackState {
    Stopped,
    Buffering,
    Paused,
    Playing,
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MediaSignal {
    BackendState(BackendPlaybackState),
    Buffering(i32),
    EndOfStream,
    Error,
    Warning,
    PositionMs(f64),
    SeekDoneMs(f64),
    MediaInfo {
        duration_ms: Option<f64>,
        video_width: Option<u32>,
        video_height: Option<u32>,
        audio_stream_count: u32,
    },
}

pub(crate) fn apply_generation_fenced_signal(
    status: &mut NativeMediaStatusV1,
    signal_generation: u64,
    signal: MediaSignal,
) -> bool {
    if signal_generation == 0 || signal_generation != status.generation {
        return false;
    }
    match signal {
        MediaSignal::BackendState(next) => match next {
            BackendPlaybackState::Stopped => {
                if !matches!(
                    status.state,
                    NativeMediaStateV1::Ended | NativeMediaStateV1::Failed
                ) {
                    status.state = NativeMediaStateV1::Preparing;
                }
            }
            BackendPlaybackState::Buffering => status.state = NativeMediaStateV1::Buffering,
            BackendPlaybackState::Paused => {
                status.state = NativeMediaStateV1::Paused;
                status.buffering_percent = None;
            }
            BackendPlaybackState::Playing => {
                status.state = NativeMediaStateV1::Playing;
                status.buffering_percent = None;
            }
            BackendPlaybackState::Unknown => {
                status.state = NativeMediaStateV1::Failed;
                status.reason_code = Some("gstreamer-unknown-playback-state".to_owned());
            }
        },
        MediaSignal::Buffering(percent) => {
            status.state = NativeMediaStateV1::Buffering;
            status.buffering_percent = Some(percent.clamp(0, 100) as u8);
        }
        MediaSignal::EndOfStream => {
            status.state = NativeMediaStateV1::Ended;
            status.position_ms = status.duration_ms;
            status.buffering_percent = None;
        }
        MediaSignal::Error => {
            status.state = NativeMediaStateV1::Failed;
            status.reason_code = Some("gstreamer-playback-error".to_owned());
            status.buffering_percent = None;
        }
        MediaSignal::Warning => status.warning_count = status.warning_count.saturating_add(1),
        MediaSignal::PositionMs(position_ms) => {
            if position_ms.is_finite() && position_ms >= 0.0 {
                status.position_ms = Some(position_ms);
            }
        }
        MediaSignal::SeekDoneMs(position_ms) => {
            if position_ms.is_finite() && position_ms >= 0.0 {
                status.position_ms = Some(position_ms);
            }
        }
        MediaSignal::MediaInfo {
            duration_ms,
            video_width,
            video_height,
            audio_stream_count,
        } => {
            status.duration_ms = duration_ms.filter(|value| value.is_finite() && *value > 0.0);
            status.video_width = video_width.filter(|value| *value > 0);
            status.video_height = video_height.filter(|value| *value > 0);
            status.audio_stream_count = Some(audio_stream_count);
            if status.duration_ms.is_none()
                || status.video_width.is_none()
                || status.video_height.is_none()
            {
                status.state = NativeMediaStateV1::Failed;
                status.reason_code = Some("gstreamer-media-info-incomplete".to_owned());
            }
        }
    }
    status.advance();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_callbacks_cannot_mutate_a_new_generation() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 4;
        status.state = NativeMediaStateV1::Preparing;
        let before = status.clone();
        assert!(!apply_generation_fenced_signal(
            &mut status,
            3,
            MediaSignal::EndOfStream,
        ));
        assert_eq!(status, before);
    }

    #[test]
    fn lifecycle_signals_open_and_close_playback_state_deterministically() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 2;
        assert!(apply_generation_fenced_signal(
            &mut status,
            2,
            MediaSignal::MediaInfo {
                duration_ms: Some(1250.5),
                video_width: Some(1920),
                video_height: Some(1080),
                audio_stream_count: 1,
            },
        ));
        apply_generation_fenced_signal(
            &mut status,
            2,
            MediaSignal::BackendState(BackendPlaybackState::Playing),
        );
        assert_eq!(status.state, NativeMediaStateV1::Playing);
        apply_generation_fenced_signal(&mut status, 2, MediaSignal::PositionMs(625.25));
        assert_eq!(status.position_ms, Some(625.25));
        apply_generation_fenced_signal(&mut status, 2, MediaSignal::EndOfStream);
        assert_eq!(status.state, NativeMediaStateV1::Ended);
        assert_eq!(status.position_ms, status.duration_ms);
    }

    #[test]
    fn errors_are_path_free_and_terminal() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 1;
        apply_generation_fenced_signal(&mut status, 1, MediaSignal::Error);
        assert_eq!(status.state, NativeMediaStateV1::Failed);
        assert_eq!(
            status.reason_code.as_deref(),
            Some("gstreamer-playback-error")
        );
    }
}

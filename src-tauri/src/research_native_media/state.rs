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
    if !terminal_state_accepts_signal(status.state, &signal) {
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
        }
    }
    status.advance();
    true
}

fn terminal_state_accepts_signal(state: NativeMediaStateV1, signal: &MediaSignal) -> bool {
    match state {
        NativeMediaStateV1::Failed => false,
        NativeMediaStateV1::Ended => matches!(
            signal,
            MediaSignal::Error | MediaSignal::BackendState(BackendPlaybackState::Unknown)
        ),
        _ => true,
    }
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

    #[test]
    fn partial_media_info_remains_pending_until_complete_metadata_and_playback_state() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 2;
        status.state = NativeMediaStateV1::Preparing;

        assert!(apply_generation_fenced_signal(
            &mut status,
            2,
            MediaSignal::MediaInfo {
                duration_ms: Some(254_406.0),
                video_width: None,
                video_height: None,
                audio_stream_count: 1,
            },
        ));
        assert_eq!(status.state, NativeMediaStateV1::Preparing);
        assert_eq!(status.duration_ms, Some(254_406.0));
        assert_eq!(status.video_width, None);
        assert_eq!(status.video_height, None);
        assert_eq!(status.reason_code, None);

        assert!(apply_generation_fenced_signal(
            &mut status,
            2,
            MediaSignal::MediaInfo {
                duration_ms: Some(254_406.0),
                video_width: Some(1920),
                video_height: Some(1080),
                audio_stream_count: 1,
            },
        ));
        assert_eq!(status.state, NativeMediaStateV1::Preparing);
        assert_eq!(status.video_width, Some(1920));
        assert_eq!(status.video_height, Some(1080));
        assert_eq!(status.reason_code, None);

        assert!(apply_generation_fenced_signal(
            &mut status,
            2,
            MediaSignal::BackendState(BackendPlaybackState::Paused),
        ));
        assert_eq!(status.state, NativeMediaStateV1::Paused);
        assert!(apply_generation_fenced_signal(
            &mut status,
            2,
            MediaSignal::BackendState(BackendPlaybackState::Playing),
        ));
        assert_eq!(status.state, NativeMediaStateV1::Playing);
        assert_eq!(status.reason_code, None);
    }

    #[test]
    fn no_video_media_info_remains_incomplete_for_the_bounded_readiness_wait() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 5;
        status.state = NativeMediaStateV1::Preparing;

        assert!(apply_generation_fenced_signal(
            &mut status,
            5,
            MediaSignal::MediaInfo {
                duration_ms: Some(10_000.0),
                video_width: None,
                video_height: None,
                audio_stream_count: 1,
            },
        ));
        assert!(apply_generation_fenced_signal(
            &mut status,
            5,
            MediaSignal::BackendState(BackendPlaybackState::Paused),
        ));

        assert_eq!(status.state, NativeMediaStateV1::Paused);
        assert_eq!(status.duration_ms, Some(10_000.0));
        assert_eq!(status.video_width, None);
        assert_eq!(status.video_height, None);
        assert_eq!(status.reason_code, None);
    }

    #[test]
    fn same_generation_nonterminal_callbacks_cannot_rewrite_terminal_observations() {
        let delayed_signals = [
            MediaSignal::BackendState(BackendPlaybackState::Stopped),
            MediaSignal::BackendState(BackendPlaybackState::Buffering),
            MediaSignal::BackendState(BackendPlaybackState::Paused),
            MediaSignal::BackendState(BackendPlaybackState::Playing),
            MediaSignal::Buffering(73),
            MediaSignal::Warning,
            MediaSignal::PositionMs(250.0),
            MediaSignal::SeekDoneMs(500.0),
            MediaSignal::MediaInfo {
                duration_ms: Some(1_000.0),
                video_width: Some(1920),
                video_height: Some(1080),
                audio_stream_count: 1,
            },
        ];

        for terminal_state in [NativeMediaStateV1::Ended, NativeMediaStateV1::Failed] {
            for signal in delayed_signals.iter().cloned() {
                let mut status = NativeMediaStatusV1::ready();
                status.generation = 7;
                status.state = terminal_state;
                status.duration_ms = Some(1_000.0);
                status.position_ms = Some(1_000.0);
                status.reason_code = (terminal_state == NativeMediaStateV1::Failed)
                    .then(|| "gstreamer-playback-error".to_owned());
                let terminal_observation = status.clone();

                assert!(!apply_generation_fenced_signal(&mut status, 7, signal));
                assert_eq!(status, terminal_observation);
            }
        }
    }

    #[test]
    fn failure_outweighs_end_of_stream_in_both_callback_orders() {
        let mut error_then_end = NativeMediaStatusV1::ready();
        error_then_end.generation = 3;
        assert!(apply_generation_fenced_signal(
            &mut error_then_end,
            3,
            MediaSignal::Error,
        ));
        let failed_observation = error_then_end.clone();
        assert!(!apply_generation_fenced_signal(
            &mut error_then_end,
            3,
            MediaSignal::EndOfStream,
        ));
        assert_eq!(error_then_end, failed_observation);

        let mut end_then_error = NativeMediaStatusV1::ready();
        end_then_error.generation = 4;
        assert!(apply_generation_fenced_signal(
            &mut end_then_error,
            4,
            MediaSignal::EndOfStream,
        ));
        let ended_sequence = end_then_error.sequence;
        assert!(apply_generation_fenced_signal(
            &mut end_then_error,
            4,
            MediaSignal::Error,
        ));
        assert_eq!(end_then_error.state, NativeMediaStateV1::Failed);
        assert_eq!(
            end_then_error.reason_code.as_deref(),
            Some("gstreamer-playback-error")
        );
        assert_eq!(end_then_error.sequence, ended_sequence + 1);
    }

    #[test]
    fn a_new_prepare_generation_reopens_callbacks_and_preserves_decode_seeks() {
        let mut status = NativeMediaStatusV1::ready();
        status.generation = 8;
        assert!(apply_generation_fenced_signal(
            &mut status,
            8,
            MediaSignal::Error,
        ));

        status.clear_media();
        status.generation = 9;
        status.state = NativeMediaStateV1::Preparing;
        status.advance();
        let prepared_sequence = status.sequence;

        assert!(!apply_generation_fenced_signal(
            &mut status,
            8,
            MediaSignal::BackendState(BackendPlaybackState::Playing),
        ));
        assert_eq!(status.sequence, prepared_sequence);
        assert!(apply_generation_fenced_signal(
            &mut status,
            9,
            MediaSignal::MediaInfo {
                duration_ms: Some(2_000.0),
                video_width: Some(1280),
                video_height: Some(720),
                audio_stream_count: 0,
            },
        ));
        assert!(apply_generation_fenced_signal(
            &mut status,
            9,
            MediaSignal::SeekDoneMs(750.0),
        ));
        assert_eq!(status.position_ms, Some(750.0));
        assert!(apply_generation_fenced_signal(
            &mut status,
            9,
            MediaSignal::BackendState(BackendPlaybackState::Playing),
        ));
        assert_eq!(status.state, NativeMediaStateV1::Playing);
        assert_eq!(status.reason_code, None);
    }
}

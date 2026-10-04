//! Read-only current-video projection. Never seeks or changes the player state.
use crate::research_error::{CommandError, ResearchResult};
use serde::Serialize;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFrame {
    pub session_id: String,
    pub generation: String,
    pub width: u32,
    pub height: u32,
    pub position_estimate_ms: Option<f64>,
    pub jpeg_base64: String,
}
pub fn fit_size(width: i32, height: i32, par: f64) -> ResearchResult<(u32, u32)> {
    if width <= 0 || height <= 0 || !par.is_finite() || par <= 0.0 {
        return Err(unavailable());
    }
    let width = f64::from(width) * par;
    let height = f64::from(height);
    let scale = (640.0 / width).min(360.0 / height).min(1.0);
    let result = (
        (width * scale).round() as u32,
        (height * scale).round() as u32,
    );
    if result.0 == 0 || result.1 == 0 || result.0 > 640 || result.1 > 360 {
        return Err(unavailable());
    }
    Ok(result)
}
fn unavailable() -> CommandError {
    CommandError::new(
        "video_preview_unavailable",
        "Current video preview is unavailable.",
    )
}

#[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
mod native {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use gstreamer as gst;
    use gstreamer_play as play;
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        time::Instant,
    };
    static BUSY: AtomicBool = AtomicBool::new(false);
    pub(crate) struct Admission;
    impl Admission {
        pub(crate) fn acquire() -> ResearchResult<Self> {
            BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map_err(|_| unavailable())?;
            Ok(Self)
        }
    }
    impl Drop for Admission {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::Release);
        }
    }
    pub(crate) fn capture(
        player: &play::Play,
        status: &super::super::NativeMediaStatusV1,
    ) -> ResearchResult<LiveFrame> {
        if !matches!(
            status.state,
            super::super::NativeMediaStateV1::Playing | super::super::NativeMediaStateV1::Paused
        ) {
            return Err(unavailable());
        }
        let video = player.current_video_track().ok_or_else(unavailable)?;
        let par = video.pixel_aspect_ratio();
        let (width, height) = fit_size(
            video.width(),
            video.height(),
            f64::from(par.numer()) / f64::from(par.denom()),
        )?;
        let config = gst::Structure::builder("professor-snapshot")
            .field("width", width as i32)
            .field("height", height as i32)
            .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
            .build();
        let started = Instant::now();
        let sample = player
            .video_snapshot(play::PlaySnapshotFormat::Jpg, Some(&config))
            .ok_or_else(unavailable)?;
        // This measures completed work; it does not pretend to cancel a slow foreign call.
        if started.elapsed().as_millis() > 100 {
            return Err(CommandError::new(
                "video_preview_too_slow",
                "Preview paused to protect experiment responsiveness.",
            ));
        }
        let caps = sample
            .caps()
            .and_then(|c| c.structure(0))
            .ok_or_else(unavailable)?;
        if caps.name() != "image/jpeg"
            || caps.get::<i32>("width").ok() != Some(width as i32)
            || caps.get::<i32>("height").ok() != Some(height as i32)
        {
            return Err(unavailable());
        }
        let buffer = sample.buffer().ok_or_else(unavailable)?;
        if buffer.size() == 0 || buffer.size() > 96 * 1024 {
            return Err(unavailable());
        }
        let bytes = buffer.map_readable().map_err(|_| unavailable())?;
        Ok(LiveFrame {
            session_id: status.session_id.clone().ok_or_else(unavailable)?,
            generation: status.generation.to_string(),
            width,
            height,
            position_estimate_ms: status.position_ms,
            jpeg_base64: STANDARD.encode(bytes.as_slice()),
        })
    }
}
#[cfg(all(target_os = "windows", feature = "native-gstreamer"))]
pub(crate) use native::{capture, Admission};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_display_aspect_and_bounds() {
        assert_eq!(fit_size(1920, 1080, 1.0).unwrap(), (640, 360));
        assert_eq!(fit_size(1080, 1920, 1.0).unwrap(), (203, 360));
        assert_eq!(fit_size(720, 576, 16.0 / 15.0).unwrap(), (480, 360));
        assert!(fit_size(0, 1080, 1.0).is_err());
        assert!(fit_size(1080, 1080, f64::NAN).is_err());
    }
}

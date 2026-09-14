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

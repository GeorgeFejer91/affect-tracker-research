#![allow(dead_code)]

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

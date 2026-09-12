use crate::research_contracts::{FlubberMappingsV1, InputBindingV1, VisualSettingsV1};
use crate::research_error::{CommandError, ResearchResult};
use crate::research_experiment_package::deserialize_u32_integer;
use serde::{Deserialize, Serialize};

/// Complete Planner feedback authoring. It does not enable an acquisition adapter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackContributionV2 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub input: InputBindingV1,
    pub visual: VisualSettingsV1,
    pub mappings: FlubberMappingsV1,
    pub presentation: FeedbackPresentationV2,
    pub response: FeedbackResponseV2,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackPresentationV2 {
    pub renderer: FeedbackRendererV2,
    pub color_anchors: ColorAnchorPlacementV2,
    pub labels: FeedbackLabelsV2,
    pub halo: FeedbackHaloV2,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FeedbackRendererV2 {
    Flubber,
    Grid,
    ProceduralFace,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ColorAnchorPlacementV2 {
    Axes,
    Corners,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackLabelsV2 {
    pub axes: FeedbackAnchorLabelsV2,
    pub corners: FeedbackAnchorLabelsV2,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackAnchorLabelsV2 {
    pub up: String,
    pub right: String,
    pub down: String,
    pub left: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackHaloV2 {
    pub width_percent: f64,
    pub gradient: bool,
    pub steepness: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackResponseV2 {
    pub mode: FeedbackResponseModeV2,
    pub grid: FeedbackGridV2,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub full_span_duration_ms: u32,
    pub hold_rule: FeedbackHoldRuleV2,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub repeat_delay_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackGridV2 {
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub columns: u32,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub rows: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FeedbackResponseModeV2 {
    Continuous,
    Stepwise,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FeedbackHoldRuleV2 {
    SeparatePresses,
    RepeatWhileHeld,
}

fn invalid(message: &str) -> CommandError {
    CommandError::invalid_contract(message)
}

fn range(value: f64, min: f64, max: f64) -> ResearchResult<()> {
    if value.is_finite() && (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(invalid("Feedback number is outside its declared range."))
    }
}

fn label(value: &str) -> ResearchResult<()> {
    // Match JavaScript trim/UTF-16 length exactly; display aliases are not IDs.
    let whitespace = |c: char| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
    };
    if !(1..=48).contains(&value.encode_utf16().count())
        || value.trim_matches(whitespace) != value
        || value.chars().any(|c| c <= '\u{001f}' || c == '\u{007f}')
    {
        return Err(invalid(
            "Feedback labels require 1–48 display characters without control characters.",
        ));
    }
    Ok(())
}

impl FeedbackContributionV2 {
    /// Normalizes only the unchanged legacy components just as their v1 readers do.
    /// Every successor field is explicit: never initialize or clamp while reading.
    pub fn normalize_and_validate(&mut self) -> ResearchResult<()> {
        if self.schema != "affect-research-feedback" || self.version != 2 {
            return Err(invalid("Unsupported feedback settings schema or version."));
        }
        self.input.normalize_and_validate()?;
        self.visual.normalize_and_validate()?;
        for (mapping, maximum) in [
            (&mut self.mappings.oscillation_frequency, 10.0),
            (&mut self.mappings.edge_smoothness, 1.0),
            (&mut self.mappings.projection_amplitude, 1.0),
            (&mut self.mappings.pulse_synchrony, 1.0),
            (&mut self.mappings.wave_size_variation, 1.0),
            (&mut self.mappings.saturation, 1.0),
        ] {
            mapping.normalize_and_validate(0.0, maximum, "Feedback mapping")?;
        }
        range(self.presentation.halo.width_percent, 0.0, 10000.0)?;
        range(self.presentation.halo.steepness, 0.1, 10.0)?;
        for labels in [
            &self.presentation.labels.axes,
            &self.presentation.labels.corners,
        ] {
            for value in [&labels.up, &labels.right, &labels.down, &labels.left] {
                label(value)?;
            }
        }
        for dimension in [self.response.grid.columns, self.response.grid.rows] {
            if !(3..=2001).contains(&dimension) || dimension % 2 == 0 {
                return Err(invalid(
                    "Response grid dimensions must be odd integers from 3 to 2001.",
                ));
            }
        }
        if !(250..=15000).contains(&self.response.full_span_duration_ms)
            || !(500..=5000).contains(&self.response.repeat_delay_ms)
        {
            return Err(invalid(
                "Feedback response duration is outside its declared millisecond range.",
            ));
        }
        Ok(())
    }

    pub fn validate(&self) -> ResearchResult<()> {
        let mut normalized = self.clone();
        normalized.normalize_and_validate()?;
        if normalized != *self {
            return Err(invalid(
                "Feedback settings must contain canonical component values.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackPaintBoundV2 {
    pub half_extent_at_unit_width: f64,
    pub padding_css_px: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackEnvelopeV2 {
    pub algorithm_version: String,
    pub origin: String,
    pub configuration_key: String,
    pub overlay_side_css_px: f64,
    pub half_extent_css_px: f64,
    pub flubber: Option<FeedbackPaintBoundV2>,
    pub grid: Option<FeedbackPaintBoundV2>,
    pub face: Option<FeedbackPaintBoundV2>,
}

/// Native Planner consumers use the same full saved footprint as JS. Never
/// accept a caller-asserted bound or substitute the current rendered phase.
pub fn resolve_feedback_envelope_v2(
    value: &FeedbackContributionV2,
    overlay_side_css_px: f64,
) -> ResearchResult<FeedbackEnvelopeV2> {
    let mut value = value.clone();
    value.normalize_and_validate()?;
    if !overlay_side_css_px.is_finite() || overlay_side_css_px <= 0.0 {
        return Err(invalid(
            "An explicit positive CSS-pixel viewport is required.",
        ));
    }
    let mut visual = value.visual.clone();
    visual.grid_enabled = value.presentation.renderer == FeedbackRendererV2::Grid;
    visual.flubber_enabled = value.presentation.renderer == FeedbackRendererV2::Flubber;
    let flubber = if visual.flubber_enabled && !visual.hide_feedback {
        let shape = (1.0
            + value.mappings.projection_amplitude.max
                * (1.0 + value.mappings.wave_size_variation.max)
            + 0.0001)
            / 3.24;
        let outline = if visual.flubber.show_outline {
            visual.flubber.outline_thickness
        } else {
            0.0
        };
        let halo = visual.flubber.show_halo && value.presentation.halo.width_percent > 0.0;
        let stroke = if halo {
            (visual.flubber.outline_thickness * 3.0).max(1.0)
                * value.presentation.halo.width_percent
                / 100.0
        } else {
            0.0
        };
        Some(FeedbackPaintBoundV2 {
            half_extent_at_unit_width: shape
                * if halo && value.presentation.halo.gradient {
                    3.0
                } else {
                    1.0
                },
            padding_css_px: outline.max(stroke) * 2.0,
        })
    } else {
        None
    };
    let grid = if visual.grid_enabled && !visual.hide_feedback {
        let outline = if visual.grid.show_outline {
            visual.grid.outline_thickness * 2.0
        } else {
            0.0
        };
        let stepwise = value.response.mode == FeedbackResponseModeV2::Stepwise;
        Some(FeedbackPaintBoundV2 {
            half_extent_at_unit_width: if stepwise {
                0.5
            } else {
                0.5 + visual.grid.cursor_size / 100.0
            },
            padding_css_px: (visual.grid.line_thickness / 2.0)
                .max(outline)
                .max(if stepwise { 0.0 } else { 0.75 }),
        })
    } else {
        None
    };
    let face = if value.presentation.renderer == FeedbackRendererV2::ProceduralFace
        && !visual.hide_feedback
    {
        Some(FeedbackPaintBoundV2 {
            half_extent_at_unit_width: 0.5,
            padding_css_px: 0.0,
        })
    } else {
        None
    };
    let half_extent_css_px = [&flubber, &grid, &face]
        .into_iter()
        .flatten()
        .map(|bound| bound.half_extent_at_unit_width * overlay_side_css_px + bound.padding_css_px)
        .fold(0.0_f64, f64::max);
    if !half_extent_css_px.is_finite() {
        return Err(invalid("Feedback extent exceeds the finite range."));
    }
    let key = serde_json::json!({ "algorithmVersion": "feedback-envelope-v2", "visual": visual,
        "mappings": value.mappings, "presentation": value.presentation, "response": value.response });
    Ok(FeedbackEnvelopeV2 {
        algorithm_version: "feedback-envelope-v2".into(),
        origin: "design-centre".into(),
        configuration_key: String::from_utf8(crate::research_contracts::canonical_json(&key, &[])?)
            .map_err(|_| invalid("Feedback configuration key must be UTF-8."))?,
        overlay_side_css_px,
        half_extent_css_px,
        flubber,
        grid,
        face,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../test/fixtures/research-feedback-settings-v2.json"
        ))
        .unwrap()
    }
    fn accepts(value: Value) -> bool {
        serde_json::from_value::<FeedbackContributionV2>(value)
            .and_then(|mut item| {
                item.normalize_and_validate()
                    .map_err(serde::de::Error::custom)
            })
            .is_ok()
    }
    #[test]
    fn feedback_v2_shared_canonical_fixture_and_renderers() {
        let source = fixture();
        let feedback: FeedbackContributionV2 = serde_json::from_value(source.clone()).unwrap();
        feedback.validate().unwrap();
        let observed = serde_json::to_value(feedback).unwrap();
        assert_eq!(
            crate::research_contracts::canonical_json(&observed, &[]).unwrap(),
            crate::research_contracts::canonical_json(&source, &[]).unwrap()
        );
        for renderer in ["flubber", "grid", "procedural-face"] {
            let mut value = fixture();
            value["presentation"]["renderer"] = json!(renderer);
            assert!(accepts(value));
        }
    }

    #[test]
    fn feedback_v2_js_rust_full_envelope_parity() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/research-feedback-envelope-v2.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let feedback: FeedbackContributionV2 =
                serde_json::from_value(case["configuration"].clone()).unwrap();
            let result =
                resolve_feedback_envelope_v2(&feedback, case["viewportCssPx"].as_f64().unwrap())
                    .unwrap();
            let actual = serde_json::to_value(result).unwrap();
            assert_eq!(
                crate::research_contracts::canonical_json(&actual, &[]).unwrap(),
                crate::research_contracts::canonical_json(&case["envelope"], &[]).unwrap()
            );
        }
        let feedback: FeedbackContributionV2 = serde_json::from_value(fixture()).unwrap();
        for viewport in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(resolve_feedback_envelope_v2(&feedback, viewport).is_err());
        }
    }
    #[test]
    fn feedback_v2_rejects_missing_unknown_and_invalid_nested_fields() {
        for pointer in [
            "",
            "/presentation",
            "/presentation/labels",
            "/presentation/labels/axes",
            "/presentation/labels/corners",
            "/presentation/halo",
            "/response",
            "/response/grid",
        ] {
            for key in fixture()
                .pointer(pointer)
                .unwrap()
                .as_object()
                .unwrap()
                .keys()
            {
                let mut value = fixture();
                value
                    .pointer_mut(pointer)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .remove(key);
                assert!(!accepts(value), "missing {pointer}/{key}");
            }
            let mut value = fixture();
            value.pointer_mut(pointer).unwrap()["unknown"] = json!(true);
            assert!(!accepts(value), "unknown {pointer}");
        }
        for (pointer, replacement) in [
            ("/version", json!(1)),
            ("/version", json!("2")),
            ("/presentation/renderer", json!("photoatlas")),
            ("/presentation/halo/widthPercent", json!(10001)),
            ("/presentation/halo/gradient", json!(1)),
            ("/presentation/halo/steepness", json!(0)),
            ("/response/grid/columns", json!(20)),
            ("/response/grid/rows", json!(2003)),
            ("/response/fullSpanDurationMs", json!(250.5)),
            ("/response/repeatDelayMs", json!(499)),
            ("/response/holdRule", json!("osRepeat")),
            ("/presentation/labels/axes/up", json!(" x ")),
            ("/presentation/labels/corners/left", json!("x\ny")),
            ("/presentation/labels/axes/up", json!("😀".repeat(25))),
        ] {
            let mut value = fixture();
            *value.pointer_mut(pointer).unwrap() = replacement;
            assert!(!accepts(value), "{pointer}");
        }
    }
}

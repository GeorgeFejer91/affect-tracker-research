//! P4 authored desktop geometry. No runtime, display calibration, media authority
//! or P5 animation formula lives here. Each recipe explicitly selects a method.
use crate::research_contracts::canonical_json;
use crate::research_experiment_package::deserialize_u32_integer;
use serde::{Deserialize, Deserializer, Serialize};

pub const SCHEMA: &str = "affect-research-desktop-layout-contribution";
pub const DEFAULT_REFERENCE_POLICY: Option<&str> = None;
pub const MAX_BYTES: usize = 8192;
pub type LayoutResult<T> = Result<T, &'static str>;

// No default: nullable fields must still be present in a closed stored profile.
fn nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopLayoutContributionV1 {
    pub schema: String,
    #[serde(deserialize_with = "deserialize_u32_integer")]
    pub version: u32,
    pub target: String,
    pub coordinate_system: String,
    pub viewport: Viewport,
    #[serde(deserialize_with = "nullable")]
    pub calibration: Option<Calibration>,
    pub units: String,
    pub reference: Reference,
    pub feedback: Feedback,
    pub fit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Viewport {
    pub width_css_px: f64,
    pub height_css_px: f64,
    pub compatibility: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Calibration {
    pub active_width_mm: f64,
    pub active_height_mm: f64,
    pub mapping: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Reference {
    pub source: ReferenceSource,
    #[serde(rename = "box")]
    pub fit_box: Size,
    pub centre: Point,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceSource {
    pub policy: String,
    #[serde(deserialize_with = "nullable")]
    pub asset_id: Option<String>,
    pub display_width_px: f64,
    pub display_height_px: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Feedback {
    pub origin: String,
    pub overlay_viewport_side: f64,
    pub offset: Point,
    pub minimum_gap: f64,
}

/// P1-owned validating projection. This is not a substitute for the full P1
/// workspace validator in the master compiler/reader.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaGeometry {
    pub asset_id: String,
    pub display_width: f64,
    pub display_height: f64,
}
/// Passed by the P5 pure resolver. Never accepted from stored P4 JSON.
pub struct FeedbackEnvelope<'a> {
    pub algorithm_version: &'a str,
    pub origin: &'a str,
    pub configuration_key: &'a str,
    pub overlay_side_css_px: f64,
    pub half_extent_css_px: f64,
}
#[derive(Debug, Clone, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub cx: f64,
    pub cy: f64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub screen: Size,
    pub reference: Rect,
    pub feedback: Rect,
    pub offset: Point,
    pub gap: f64,
    pub maximum_feedback: Option<Rect>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FittedVideo {
    pub id: String,
    pub label: String,
    pub display_width: f64,
    pub display_height: f64,
    pub bounds: Rect,
    pub gap: Option<f64>,
    pub bound_kind: &'static str,
}
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedDesktopLayout {
    pub geometry: Geometry,
    pub videos: Vec<FittedVideo>,
    pub issues: Vec<&'static str>,
}

fn bounded(v: f64, min: f64, max: f64) -> bool {
    v.is_finite() && !(v == 0. && v.is_sign_negative()) && v >= min && v <= max
}
fn dimension(v: f64) -> bool {
    bounded(v, 1., 32768.) && v.fract() == 0.
}
fn asset_id(s: &str) -> bool {
    s.len() == 70
        && s.starts_with("asset-")
        && s[6..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn rect(cx: f64, cy: f64, width: f64, height: f64) -> Rect {
    Rect {
        x: cx - width / 2.,
        y: cy - height / 2.,
        width,
        height,
        cx,
        cy,
    }
}
fn outside(r: &Rect, s: &Size) -> bool {
    r.x < -1e-7 || r.y < -1e-7 || r.x + r.width > s.width + 1e-7 || r.y + r.height > s.height + 1e-7
}

pub fn select_reference(media: &[MediaGeometry], policy: &str) -> LayoutResult<ReferenceSource> {
    if media.is_empty() || media.len() > 10000 {
        return Err("media-missing");
    }
    let mut ids = std::collections::BTreeSet::new();
    for m in media {
        if !asset_id(&m.asset_id)
            || !ids.insert(&m.asset_id)
            || !dimension(m.display_width)
            || !dimension(m.display_height)
        {
            return Err("media-invalid");
        }
    }
    match policy {
        "largest-oriented-area" => {
            let largest = media
                .iter()
                .min_by(|a, b| {
                    (b.display_width * b.display_height)
                        .total_cmp(&(a.display_width * a.display_height))
                        .then_with(|| a.asset_id.cmp(&b.asset_id))
                })
                .ok_or("media-missing")?;
            Ok(ReferenceSource {
                policy: policy.into(),
                asset_id: Some(largest.asset_id.clone()),
                display_width_px: largest.display_width,
                display_height_px: largest.display_height,
            })
        }
        "maximum-oriented-dimensions" => Ok(ReferenceSource {
            policy: policy.into(),
            asset_id: None,
            display_width_px: media.iter().map(|m| m.display_width).fold(0., f64::max),
            display_height_px: media.iter().map(|m| m.display_height).fold(0., f64::max),
        }),
        _ => Err("reference-policy-unsupported"),
    }
}

impl DesktopLayoutContributionV1 {
    /// Shape validation only. Compiler acceptance additionally calls
    /// validate_accepted_policy and resolves the full P1/P5 composition.
    pub fn validate_profile(&self) -> LayoutResult<()> {
        if self.schema != SCHEMA
            || self.version != 1
            || self.target != "desktop-screen"
            || self.coordinate_system != "viewport-right-down"
            || self.fit != "contain"
            || !["relative", "mm"].contains(&self.units.as_str())
        {
            return Err("unsupported-profile");
        }
        let v = &self.viewport;
        if !dimension(v.width_css_px) || !dimension(v.height_css_px) || v.compatibility != "exact" {
            return Err("viewport-invalid");
        }
        if let Some(c) = &self.calibration {
            if !bounded(c.active_width_mm, 1., 100000.)
                || !bounded(c.active_height_mm, 1., 100000.)
                || c.mapping != "full-viewport"
                || (c.active_width_mm / c.active_height_mm - v.width_css_px / v.height_css_px).abs()
                    > 1e-6
            {
                return Err("calibration-invalid");
            }
        } else if self.units == "mm" {
            return Err("calibration-required");
        }
        let r = &self.reference;
        let identity_valid = match r.source.policy.as_str() {
            "largest-oriented-area" => r.source.asset_id.as_deref().is_some_and(asset_id),
            "maximum-oriented-dimensions" => r.source.asset_id.is_none(),
            _ => false,
        };
        if !identity_valid
            || !dimension(r.source.display_width_px)
            || !dimension(r.source.display_height_px)
            || !bounded(r.fit_box.width, 0.001, 100000.)
            || !bounded(r.fit_box.height, 0.001, 100000.)
            || !bounded(r.centre.x, -100000., 100000.)
            || !bounded(r.centre.y, -100000., 100000.)
        {
            return Err("reference-invalid");
        }
        let f = &self.feedback;
        if f.origin != "design-centre"
            || !bounded(f.overlay_viewport_side, 0.001, 100000.)
            || !bounded(f.offset.x, -100000., 100000.)
            || !bounded(f.offset.y, -100000., 100000.)
            || !bounded(f.minimum_gap, 0., 100000.)
        {
            return Err("feedback-invalid");
        }
        if canonical_json(self, &[]).map_err(|_| "canonical")?.len() + 1 > MAX_BYTES {
            return Err("size");
        }
        Ok(())
    }
    pub fn validate_accepted_policy(&self) -> LayoutResult<()> {
        self.validate()
    }
    pub fn validate(&self) -> LayoutResult<()> {
        self.validate_profile()
    }
    pub fn resolve_base(&self) -> LayoutResult<Geometry> {
        self.validate_profile()?;
        let (v, r, f) = (&self.viewport, &self.reference, &self.feedback);
        let relative = self.units == "relative";
        let scale = self
            .calibration
            .as_ref()
            .map(|c| v.width_css_px / c.active_width_mm)
            .unwrap_or(0.);
        let xs = if relative {
            v.width_css_px / 100.
        } else {
            scale
        };
        let ys = if relative {
            v.height_css_px / 100.
        } else {
            scale
        };
        let fit = (r.fit_box.width * xs / r.source.display_width_px)
            .min(r.fit_box.height * ys / r.source.display_height_px);
        let reference = rect(
            r.centre.x * xs,
            r.centre.y * ys,
            r.source.display_width_px * fit,
            r.source.display_height_px * fit,
        );
        let ss = if relative {
            reference.width.min(reference.height) / 100.
        } else {
            scale
        };
        let offset = Point {
            x: f.offset.x
                * if relative {
                    reference.width / 100.
                } else {
                    scale
                },
            y: f.offset.y
                * if relative {
                    reference.height / 100.
                } else {
                    scale
                },
        };
        let side = f.overlay_viewport_side * ss;
        let feedback = rect(reference.cx + offset.x, reference.cy + offset.y, side, side);
        Ok(Geometry {
            screen: Size {
                width: v.width_css_px,
                height: v.height_css_px,
            },
            reference,
            feedback,
            offset,
            gap: f.minimum_gap * ss,
            maximum_feedback: None,
        })
    }
    pub fn resolve(
        &self,
        media: &[MediaGeometry],
        envelope: &FeedbackEnvelope<'_>,
    ) -> LayoutResult<ResolvedDesktopLayout> {
        self.validate_profile()?;
        if select_reference(media, &self.reference.source.policy)? != self.reference.source {
            return Err("source-mismatch");
        }
        let mut g = self.resolve_base()?;
        if !["feedback-envelope-v1", "feedback-envelope-v2"].contains(&envelope.algorithm_version)
            || envelope.origin != "design-centre"
            || envelope.overlay_side_css_px != g.feedback.width
            || envelope.configuration_key.is_empty()
            || envelope.configuration_key.encode_utf16().count() > 32768
            || !envelope.half_extent_css_px.is_finite()
            || envelope.half_extent_css_px < 0.
            || !(envelope.half_extent_css_px * 2.).is_finite()
        {
            return Err("feedback-envelope-invalid");
        }
        let maximum = rect(
            g.feedback.cx,
            g.feedback.cy,
            envelope.half_extent_css_px * 2.,
            envelope.half_extent_css_px * 2.,
        );
        let mut issues = Vec::new();
        if outside(&g.reference, &g.screen) {
            issues.push("reference-clips");
        }
        if outside(&g.feedback, &g.screen) {
            issues.push("footprint-clips");
        }
        if outside(&maximum, &g.screen) {
            issues.push("envelope-clips");
        }
        let mut videos = Vec::with_capacity(media.len());
        for m in media {
            let s =
                (g.reference.width / m.display_width).min(g.reference.height / m.display_height);
            let b = rect(
                g.reference.cx,
                g.reference.cy,
                m.display_width * s,
                m.display_height * s,
            );
            let gap = if maximum.width == 0. && maximum.height == 0. {
                None
            } else {
                let dx = (b.x - (maximum.x + maximum.width))
                    .max(maximum.x - (b.x + b.width))
                    .max(0.);
                let dy = (b.y - (maximum.y + maximum.height))
                    .max(maximum.y - (b.y + b.height))
                    .max(0.);
                let gap = dx.hypot(dy);
                let overlaps = b.x < maximum.x + maximum.width
                    && maximum.x < b.x + b.width
                    && b.y < maximum.y + maximum.height
                    && maximum.y < b.y + b.height;
                if overlaps {
                    issues.push("video-overlap");
                } else if gap + 1e-7 < g.gap {
                    issues.push("gap-too-small");
                }
                Some(gap)
            };
            videos.push(FittedVideo {
                id: m.asset_id.clone(),
                label: m.asset_id.clone(),
                display_width: m.display_width,
                display_height: m.display_height,
                bounds: b,
                gap,
                bound_kind: "saved-maximum",
            });
        }
        g.maximum_feedback = Some(maximum);
        Ok(ResolvedDesktopLayout {
            geometry: g,
            videos,
            issues,
        })
    }
    pub fn assert_viewport(&self, width_css_px: f64, height_css_px: f64) -> LayoutResult<()> {
        self.validate_profile()?;
        if self.viewport.width_css_px != width_css_px
            || self.viewport.height_css_px != height_css_px
        {
            return Err("viewport-incompatible");
        }
        Ok(())
    }
    pub fn canonical_bytes(&self) -> LayoutResult<Vec<u8>> {
        self.validate()?;
        self.profile_canonical_bytes()
    }
    pub fn profile_canonical_bytes(&self) -> LayoutResult<Vec<u8>> {
        self.validate_profile()?;
        let mut bytes = canonical_json(self, &[]).map_err(|_| "canonical")?;
        bytes.push(b'\n');
        Ok(bytes)
    }
    pub fn parse(source: &[u8]) -> LayoutResult<Self> {
        let profile = Self::parse_profile(source)?;
        profile.validate()?;
        Ok(profile)
    }
    pub fn parse_profile(source: &[u8]) -> LayoutResult<Self> {
        if source.len() > MAX_BYTES {
            return Err("size");
        }
        let profile: Self = serde_json::from_slice(source).map_err(|_| "json")?;
        if profile.profile_canonical_bytes()? != source {
            return Err("canonical");
        }
        Ok(profile)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../test/fixtures/desktop-layout-candidates-v1.json"
        ))
        .unwrap()
    }
    fn close(a: &Value, b: &Value) {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => assert!(
                (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-8,
                "{x} != {y}"
            ),
            (Value::Object(x), Value::Object(y)) => {
                assert_eq!(x.len(), y.len());
                for (k, v) in x {
                    close(v, &y[k]);
                }
            }
            (Value::Array(x), Value::Array(y)) => {
                assert_eq!(x.len(), y.len());
                for (a, b) in x.iter().zip(y) {
                    close(a, b);
                }
            }
            _ => assert_eq!(a, b),
        }
    }
    #[test]
    fn explicitly_chosen_profiles_preserve_canonical_bytes_and_hash_without_default() {
        assert_eq!(DEFAULT_REFERENCE_POLICY, None);
        for c in fixture()["cases"].as_array().unwrap() {
            let p: DesktopLayoutContributionV1 =
                serde_json::from_value(c["profile"].clone()).unwrap();
            assert_eq!(
                crate::research_contracts::canonical_sha256(&p, &[]).unwrap(),
                c["canonicalSha256"].as_str().unwrap()
            );
            assert_eq!(
                DesktopLayoutContributionV1::parse_profile(&p.profile_canonical_bytes().unwrap())
                    .unwrap(),
                p
            );
            assert!(p.validate_accepted_policy().is_ok());
            assert_eq!(
                p.canonical_bytes().unwrap(),
                p.profile_canonical_bytes().unwrap()
            );
            assert_eq!(
                DesktopLayoutContributionV1::parse(&p.profile_canonical_bytes().unwrap()),
                Ok(p)
            );
        }
    }
    #[test]
    fn shared_geometry_and_all_video_fits_match_javascript() {
        let f = fixture();
        let media: Vec<MediaGeometry> = serde_json::from_value(f["media"].clone()).unwrap();
        for c in f["cases"].as_array().unwrap() {
            let p: DesktopLayoutContributionV1 =
                serde_json::from_value(c["profile"].clone()).unwrap();
            // This geometry mirror test takes the bound from the P5-generated
            // shared fixture; the master compiler must call P5's real resolver.
            let e = FeedbackEnvelope {
                algorithm_version: "feedback-envelope-v2",
                origin: "design-centre",
                configuration_key: "P5 shared fixture",
                overlay_side_css_px: c["geometry"]["feedback"]["width"].as_f64().unwrap(),
                half_extent_css_px: c["geometry"]["maximumFeedback"]["width"].as_f64().unwrap()
                    / 2.,
            };
            let result = p.resolve(&media, &e).unwrap();
            close(
                &serde_json::to_value(result.geometry).unwrap(),
                &c["geometry"],
            );
            close(&serde_json::to_value(result.videos).unwrap(), &c["videos"]);
            assert!(result.issues.is_empty());
        }
    }
    fn accepts(v: Value) -> bool {
        serde_json::from_value::<DesktopLayoutContributionV1>(v)
            .is_ok_and(|p| p.validate_profile().is_ok())
    }
    #[test]
    fn every_object_is_closed_and_every_field_including_nullable_is_required() {
        fn visit(root: &Value, value: &Value, path: &str) {
            if let Value::Object(obj) = value {
                for key in obj.keys() {
                    let mut v = root.clone();
                    v.pointer_mut(path)
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .remove(key);
                    assert!(!accepts(v), "missing {path}/{key}");
                }
                let mut v = root.clone();
                v.pointer_mut(path)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .insert("unexpected".into(), json!(true));
                assert!(!accepts(v));
                for (key, v) in obj {
                    visit(root, v, &format!("{path}/{key}"));
                }
            }
        }
        let p = fixture()["cases"][0]["profile"].clone();
        visit(&p, &p, "");
    }
    #[test]
    fn invalid_measurements_policy_units_numbers_and_viewport_reject() {
        let root = fixture()["cases"][0]["profile"].clone();
        for (path, bad) in [
            ("/fit", json!("cover")),
            ("/units", json!("px")),
            ("/calibration", Value::Null),
            ("/viewport/widthCssPx", json!(1.5)),
            ("/feedback/offset/x", json!(100001)),
            ("/feedback/overlayViewportSide", json!(0)),
            ("/calibration/activeHeightMm", json!(300)),
            ("/reference/source/assetId", Value::Null),
        ] {
            let mut v = root.clone();
            if path == "/calibration" {
                v["units"] = json!("mm");
            }
            *v.pointer_mut(path).unwrap() = bad;
            assert!(!accepts(v), "{path}");
        }
        let p: DesktopLayoutContributionV1 = serde_json::from_value(root).unwrap();
        assert!(p.assert_viewport(1920., 1080.).is_ok());
        assert!(p.assert_viewport(1280., 720.).is_err());
        let s = String::from_utf8(p.profile_canonical_bytes().unwrap()).unwrap();
        assert!(DesktopLayoutContributionV1::parse_profile(s.trim_end().as_bytes()).is_err());
        assert!(DesktopLayoutContributionV1::parse_profile(
            s.replace("\"version\":1", "\"version\":1,\"version\":1")
                .as_bytes()
        )
        .is_err());
    }
}

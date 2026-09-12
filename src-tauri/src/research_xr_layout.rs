//! P6 authoring geometry, with no headset, Tauri, storage or Run authority.
//! Physical metres are authoritative; angles are derived at the setup viewer.
use crate::research_contracts::canonical_json;
use serde::{Deserialize, Serialize};

pub const SCHEMA: &str = "affect-research-xr-layout";
pub const MAX_BYTES: usize = 8192;
pub type Point = [f64; 3];
pub type Matrix = [[f64; 3]; 3];
pub type XrResult<T> = Result<T, &'static str>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct XrLayoutProfileV1 {
    pub schema: String,
    pub version: u8,
    pub target: String,
    pub projection: String,
    pub coordinate_system: String,
    pub alignment: Alignment,
    pub video: VideoPlane,
    pub feedback: Feedback,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Alignment {
    pub kind: String,
    pub forward_reference: String,
    pub up_reference: String,
    pub recenter_policy: String,
    pub tracking_loss_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoPlane {
    pub distance_metres: f64,
    pub azimuth_degrees: f64,
    pub elevation_degrees: f64,
    pub yaw_degrees: f64,
    pub pitch_degrees: f64,
    pub roll_degrees: f64,
    pub width_metres: f64,
    pub height_metres: f64,
    pub fit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Feedback {
    pub enabled: bool,
    pub offset_x_metres: f64,
    pub offset_y_metres: f64,
    pub diameter_metres: f64,
    pub minimum_gap_metres: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct XrTargetRequirements {
    pub target: String,
    pub profile_schema: String,
    pub profile_version: u8,
    pub projection: String,
    pub anchor: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AngularExtents {
    pub horizontal: [f64; 2],
    pub vertical: [f64; 2],
    pub width_degrees: f64,
    pub height_degrees: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedXrLayout {
    pub video_centre: Point,
    pub rotation: Matrix,
    pub video_corners: [Point; 4],
    pub feedback_centre: Point,
    pub feedback_bounds: [Point; 4],
    pub fitted_size: [f64; 2],
    pub fitted_corners: [Point; 4],
    pub screen_angles: AngularExtents,
    pub video_angles: AngularExtents,
}

/// Internal P5 producer handoff, never an authoritative caller-supplied bound.
/// A future master compiler must derive it from the saved P5 configuration.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFeedbackFootprint {
    pub algorithm_version: &'static str,
    pub configuration_key: String,
    pub reference_viewport_css_px: f64,
    pub metres_per_css_px: f64,
    pub viewport_side_metres: f64,
    pub half_extent_metres: f64,
    pub visible: bool,
    pub bounds: [Point; 4],
}

fn bounded(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && value >= min && value <= max
}
fn add(a: Point, b: Point) -> Point {
    std::array::from_fn(|i| a[i] + b[i])
}
fn scale(a: Point, s: f64) -> Point {
    a.map(|v| v * s)
}
fn dot(a: Point, b: Point) -> f64 {
    a.into_iter().zip(b).map(|(x, y)| x * y).sum()
}
fn apply(matrix: Matrix, point: Point) -> Point {
    matrix.map(|row| dot(row, point))
}

fn rotation(v: &VideoPlane) -> Matrix {
    let (sy, cy) = v.yaw_degrees.to_radians().sin_cos();
    let (sp, cp) = v.pitch_degrees.to_radians().sin_cos();
    let (sr, cr) = v.roll_degrees.to_radians().sin_cos();
    [
        [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
        [cp * sr, cp * cr, -sp],
        [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
    ]
}
fn centre(v: &VideoPlane) -> Point {
    let a = v.azimuth_degrees.to_radians();
    let e = v.elevation_degrees.to_radians();
    [
        v.distance_metres * e.cos() * a.sin(),
        v.distance_metres * e.sin(),
        -v.distance_metres * e.cos() * a.cos(),
    ]
}
fn rectangle(width: f64, height: f64, centre: Point, matrix: Matrix) -> [Point; 4] {
    [[-1., -1.], [1., -1.], [1., 1.], [-1., 1.]]
        .map(|[x, y]| add(centre, apply(matrix, [x * width / 2., y * height / 2., 0.])))
}

impl XrLayoutProfileV1 {
    pub fn validate(&self) -> XrResult<()> {
        if self.schema != SCHEMA
            || self.version != 1
            || self.target != "webxr-immersive-vr"
            || self.projection != "flat-monoscopic"
            || self.coordinate_system != "right-up-back-metres"
        {
            return Err("unsupported-profile");
        }
        let a = &self.alignment;
        if a.kind != "world-fixed-initial-forward"
            || a.forward_reference != "head-forward"
            || a.up_reference != "gravity-up"
            || a.recenter_policy != "between-attempts-only"
            || a.tracking_loss_policy != "stop-attempt"
        {
            return Err("unsupported-alignment");
        }
        let v = &self.video;
        if !bounded(v.distance_metres, 0.1, 100.)
            || !bounded(v.width_metres, 0.001, 100.)
            || !bounded(v.height_metres, 0.001, 100.)
            || !bounded(v.roll_degrees, -180., 180.)
            || [
                v.azimuth_degrees,
                v.elevation_degrees,
                v.yaw_degrees,
                v.pitch_degrees,
            ]
            .into_iter()
            .any(|value| !bounded(value, -80., 80.))
            || v.fit != "contain"
        {
            return Err("video-range");
        }
        let f = &self.feedback;
        if !bounded(f.offset_x_metres, -100., 100.)
            || !bounded(f.offset_y_metres, -100., 100.)
            || !bounded(f.diameter_metres, 0.001, 100.)
            || !bounded(f.minimum_gap_metres, 0., 10.)
        {
            return Err("feedback-range");
        }
        let matrix = rotation(v);
        let cv = centre(v);
        let cf = add(
            cv,
            apply(matrix, [f.offset_x_metres, f.offset_y_metres, 0.]),
        );
        let video = rectangle(v.width_metres, v.height_metres, cv, matrix);
        let feedback = rectangle(f.diameter_metres, f.diameter_metres, cf, matrix);
        if video
            .iter()
            .chain(feedback.iter().filter(|_| f.enabled))
            .any(|p| p[2] > -0.01)
        {
            return Err("behind-viewer");
        }
        if dot(apply(matrix, [0., 0., 1.]), scale(cv, -1.)) <= 0.01 {
            return Err("back-facing");
        }
        let separation = (f.offset_x_metres.abs() - v.width_metres / 2.)
            .max(0.)
            .hypot((f.offset_y_metres.abs() - v.height_metres / 2.).max(0.));
        if f.enabled && separation + 1e-12 < f.diameter_metres / 2. + f.minimum_gap_metres {
            return Err("overlap");
        }
        Ok(())
    }

    pub fn resolve_feedback_footprint(
        &self,
        algorithm_version: &str,
        origin: &str,
        configuration_key: &str,
        overlay_side_css_px: f64,
        half_extent_css_px: f64,
    ) -> XrResult<ResolvedFeedbackFootprint> {
        let geometry = self.resolve(None)?;
        if !matches!(
            algorithm_version,
            "feedback-envelope-v1" | "feedback-envelope-v2"
        ) || origin != "design-centre"
            || overlay_side_css_px != 1024.
            || configuration_key.is_empty()
            || configuration_key.encode_utf16().count() > 32768
            || !half_extent_css_px.is_finite()
            || half_extent_css_px < 0.
        {
            return Err("unsupported-feedback-envelope");
        }
        let visible = self.feedback.enabled && half_extent_css_px > 0.;
        let half_extent_metres = if visible {
            self.feedback.diameter_metres / (2. * std::f64::consts::SQRT_2)
        } else {
            0.
        };
        let metres_per_css_px = if visible {
            half_extent_metres / half_extent_css_px
        } else {
            0.
        };
        let viewport_side_metres = metres_per_css_px * overlay_side_css_px;
        if !metres_per_css_px.is_finite() || !viewport_side_metres.is_finite() {
            return Err("invalid-feedback-scale");
        }
        Ok(ResolvedFeedbackFootprint {
            algorithm_version: "xr-feedback-footprint-v1",
            configuration_key: configuration_key.to_owned(),
            reference_viewport_css_px: overlay_side_css_px,
            metres_per_css_px,
            viewport_side_metres,
            half_extent_metres,
            visible,
            bounds: rectangle(
                half_extent_metres * 2.,
                half_extent_metres * 2.,
                geometry.feedback_centre,
                geometry.rotation,
            ),
        })
    }

    pub fn canonical_bytes(&self) -> XrResult<Vec<u8>> {
        self.validate()?;
        let mut bytes = canonical_json(self, &[]).map_err(|_| "canonical")?;
        bytes.push(b'\n');
        Ok(bytes)
    }

    pub fn parse(source: &[u8]) -> XrResult<Self> {
        if source.len() > MAX_BYTES {
            return Err("size");
        }
        let value: Self = serde_json::from_slice(source).map_err(|_| "json")?;
        if value.canonical_bytes()? != source {
            return Err("canonical");
        }
        Ok(value)
    }

    pub fn resolve(&self, media: Option<[f64; 2]>) -> XrResult<ResolvedXrLayout> {
        self.validate()?;
        let v = &self.video;
        let f = &self.feedback;
        let cv = centre(v);
        let matrix = rotation(v);
        let cf = add(
            cv,
            apply(matrix, [f.offset_x_metres, f.offset_y_metres, 0.]),
        );
        let corners = rectangle(v.width_metres, v.height_metres, cv, matrix);
        let mut size = [v.width_metres, v.height_metres];
        if let Some([w, h]) = media {
            if !bounded(w, 1., 100_000.) || !bounded(h, 1., 100_000.) {
                return Err("media-range");
            }
            let s = (size[0] / w).min(size[1] / h);
            size = [w * s, h * s];
        }
        let fitted = rectangle(size[0], size[1], cv, matrix);
        Ok(ResolvedXrLayout {
            video_centre: cv,
            rotation: matrix,
            video_corners: corners,
            feedback_centre: cf,
            feedback_bounds: rectangle(f.diameter_metres, f.diameter_metres, cf, matrix),
            fitted_size: size,
            fitted_corners: fitted,
            screen_angles: angular_extents(corners),
            video_angles: angular_extents(fitted),
        })
    }

    pub fn assert_target_supported(&self, target: &XrTargetRequirements) -> XrResult<()> {
        self.validate()?;
        if target.target != "webxr-immersive-vr"
            || target.profile_schema != SCHEMA
            || target.profile_version != 1
            || target.projection != "flat-monoscopic"
            || target.anchor != "world-fixed-initial-head-forward"
        {
            return Err("unsupported-target");
        }
        Ok(())
    }
}

fn angular_extents(corners: [Point; 4]) -> AngularExtents {
    let mut points = corners.to_vec();
    for i in 0..4 {
        let a = corners[i];
        let delta = add(corners[(i + 1) % 4], scale(a, -1.));
        let denominator = delta[1] * dot(a, delta) - a[1] * dot(delta, delta);
        if denominator.abs() > 1e-15 {
            let t = (a[1] * dot(a, delta) - delta[1] * dot(a, a)) / denominator;
            if t > 0. && t < 1. {
                points.push(add(a, scale(delta, t)));
            }
        }
    }
    let mut h = [f64::INFINITY, f64::NEG_INFINITY];
    let mut v = h;
    for [x, y, z] in points {
        let a = x.atan2(-z).to_degrees();
        let e = y.atan2(x.hypot(z)).to_degrees();
        h = [h[0].min(a), h[1].max(a)];
        v = [v[0].min(e), v[1].max(e)];
    }
    AngularExtents {
        horizontal: h,
        vertical: v,
        width_degrees: h[1] - h[0],
        height_degrees: v[1] - v[0],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    const SOURCE: &[u8] = include_bytes!("../../test/fixtures/xr-layout-v1.canonical.json");
    const FIXTURES: &str = include_str!("../../test/fixtures/xr-layout-geometry-v1.json");

    fn close(a: &serde_json::Value, b: &serde_json::Value) {
        match (a, b) {
            (serde_json::Value::Number(x), serde_json::Value::Number(y)) => assert!(
                (x.as_f64().unwrap() - y.as_f64().unwrap()).abs() < 1e-10,
                "{x} != {y}"
            ),
            (serde_json::Value::Array(x), serde_json::Value::Array(y)) => {
                assert_eq!(x.len(), y.len());
                for (a, b) in x.iter().zip(y) {
                    close(a, b);
                }
            }
            (serde_json::Value::Object(x), serde_json::Value::Object(y)) => {
                assert_eq!(x.len(), y.len());
                for (key, a) in x {
                    close(a, &y[key]);
                }
            }
            _ => assert_eq!(a, b),
        }
    }

    #[test]
    fn canonical_fixture_matches_javascript_bytes_and_hash() {
        let profile = XrLayoutProfileV1::parse(SOURCE).unwrap();
        assert_eq!(profile.canonical_bytes().unwrap(), SOURCE);
        let fixtures: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(SOURCE)),
            fixtures["canonicalSha256"].as_str().unwrap()
        );
    }

    #[test]
    fn geometry_matches_shared_javascript_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
        for case in fixtures["cases"].as_array().unwrap() {
            let profile: XrLayoutProfileV1 =
                serde_json::from_value(case["profile"].clone()).unwrap();
            let media: Option<[f64; 2]> = serde_json::from_value(case["media"].clone()).unwrap();
            let actual = serde_json::to_value(profile.resolve(media).unwrap()).unwrap();
            close(&actual, &case["expected"]);
        }
    }

    #[test]
    fn shared_invalid_cases_reject() {
        let fixtures: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
        for case in fixtures["invalid"].as_array().unwrap() {
            let result = serde_json::from_value::<XrLayoutProfileV1>(case["profile"].clone());
            assert!(
                result.is_err() || result.unwrap().validate().is_err(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn full_p5_envelope_mapping_matches_shared_javascript_fixture() {
        let fixtures: Vec<serde_json::Value> = [
            include_str!("../../test/fixtures/xr-feedback-envelope-v1.json"),
            include_str!("../../test/fixtures/xr-feedback-envelope-v2.json"),
        ]
        .iter()
        .map(|source| serde_json::from_str(source).unwrap())
        .collect();
        for case in fixtures
            .iter()
            .flat_map(|fixture| fixture["cases"].as_array().unwrap())
        {
            let profile: XrLayoutProfileV1 =
                serde_json::from_value(case["profile"].clone()).unwrap();
            let e = &case["envelope"];
            let actual = profile
                .resolve_feedback_footprint(
                    e["algorithmVersion"].as_str().unwrap(),
                    e["origin"].as_str().unwrap(),
                    e["configurationKey"].as_str().unwrap(),
                    e["overlaySideCssPx"].as_f64().unwrap(),
                    e["halfExtentCssPx"].as_f64().unwrap(),
                )
                .unwrap();
            close(&serde_json::to_value(actual).unwrap(), &case["expected"]);
            assert!(profile
                .resolve_feedback_footprint(
                    "feedback-envelope-v3",
                    "design-centre",
                    "fixture",
                    1024.,
                    100.
                )
                .is_err());
            assert!(profile
                .resolve_feedback_footprint(
                    "feedback-envelope-v1",
                    "design-centre",
                    "fixture",
                    512.,
                    100.
                )
                .is_err());
            assert!(profile
                .resolve_feedback_footprint(
                    "feedback-envelope-v1",
                    "design-centre",
                    "fixture",
                    1024.,
                    f64::NAN
                )
                .is_err());
            let tiny = profile.resolve_feedback_footprint(
                "feedback-envelope-v1",
                "design-centre",
                "fixture",
                1024.,
                f64::from_bits(1),
            );
            if profile.feedback.enabled {
                assert!(tiny.is_err());
            } else {
                assert_eq!(tiny.unwrap().metres_per_css_px, 0.);
            }
        }
    }

    #[test]
    fn rejects_noncanonical_duplicate_and_unsupported_target() {
        let profile = XrLayoutProfileV1::parse(SOURCE).unwrap();
        assert!(XrLayoutProfileV1::parse(&serde_json::to_vec_pretty(&profile).unwrap()).is_err());
        let source = std::str::from_utf8(SOURCE).unwrap();
        assert!(XrLayoutProfileV1::parse(
            source
                .replace("\"version\":1", "\"version\":1,\"version\":1")
                .as_bytes()
        )
        .is_err());
        assert!(XrLayoutProfileV1::parse(source.trim_end().as_bytes()).is_err());
        let target = XrTargetRequirements {
            target: "desktop".into(),
            profile_schema: SCHEMA.into(),
            profile_version: 1,
            projection: "flat-monoscopic".into(),
            anchor: "world-fixed-initial-head-forward".into(),
        };
        assert!(profile.assert_target_supported(&target).is_err());
    }
}

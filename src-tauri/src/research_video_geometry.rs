use crate::research_error::{CommandError, ResearchResult};
use serde::{Deserialize, Serialize};

pub(crate) const NATIVE_DISPLAY_METADATA_SCHEMA: &str =
    "affect-research-native-display-metadata-receipt";

const MAX_VIDEO_DIMENSION_PX: u32 = 32_768;
const MAX_RATIO_TERM: u32 = 65_535;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoRatioV1 {
    pub numerator: u32,
    pub denominator: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum SourceOrientationTagV2 {
    Absent {},
    Explicit {
        #[serde(rename = "rotationDegrees")]
        rotation_degrees: u16,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceOrientationV2 {
    pub stream: SourceOrientationTagV2,
    pub media: SourceOrientationTagV2,
}

impl SourceOrientationV2 {
    pub(crate) fn controlled_rotation(&self) -> ResearchResult<u16> {
        let degrees = |tag| match tag {
            SourceOrientationTagV2::Absent {} => Ok(None),
            SourceOrientationTagV2::Explicit {
                rotation_degrees: value @ (0 | 90 | 180 | 270),
            } => Ok(Some(value)),
            _ => Err(CommandError::native_media_unavailable(
                "native-display-orientation-unsupported",
            )),
        };
        match (degrees(self.stream)?, degrees(self.media)?) {
            (Some(left), Some(right)) if left != right => Err(
                CommandError::native_media_unavailable("native-display-orientation-conflicting"),
            ),
            (Some(value), _) | (_, Some(value)) => Ok(value),
            (None, None) => Ok(0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlledRendererV2 {
    pub sink_factory: String,
    pub configured_rotation_degrees: u16,
    pub readback_rotation_degrees: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeDisplayMetadataReceiptV2 {
    pub schema: String,
    pub version: u32,
    pub encoded_width_px: u32,
    pub encoded_height_px: u32,
    pub pixel_aspect_ratio: VideoRatioV1,
    pub source_orientation: SourceOrientationV2,
    pub snapshot_width_px: u32,
    pub snapshot_height_px: u32,
    pub snapshot_pixel_aspect_ratio: VideoRatioV1,
    pub snapshot_interpretation: String,
    pub renderer: ControlledRendererV2,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeDisplayGeometryV2 {
    pub status: String,
    pub source: String,
    pub display_width_px: u32,
    pub display_height_px: u32,
    pub display_aspect: VideoRatioV1,
    pub rotation_degrees: u16,
    pub pixel_aspect_ratio: VideoRatioV1,
    pub metadata_interpretation: String,
    pub native_display_metadata: NativeDisplayMetadataReceiptV2,
}

pub(crate) fn derive_native_display_geometry_v2(
    receipt: &NativeDisplayMetadataReceiptV2,
) -> ResearchResult<NativeDisplayGeometryV2> {
    if receipt.schema != NATIVE_DISPLAY_METADATA_SCHEMA
        || receipt.version != 2
        || receipt.snapshot_interpretation != "pre-renderer-square-pixel"
        || receipt.renderer.sink_factory != "d3d11videosink"
    {
        return Err(CommandError::invalid_contract(
            "Controlled native display metadata is unsupported.",
        ));
    }
    for dimension in [
        receipt.encoded_width_px,
        receipt.encoded_height_px,
        receipt.snapshot_width_px,
        receipt.snapshot_height_px,
    ] {
        validate_dimension(dimension)?;
    }
    validate_ratio(receipt.pixel_aspect_ratio)?;
    validate_ratio(receipt.snapshot_pixel_aspect_ratio)?;
    let rotation = receipt.source_orientation.controlled_rotation()?;
    if receipt.renderer.configured_rotation_degrees != rotation
        || receipt.renderer.readback_rotation_degrees != rotation
    {
        return Err(CommandError::native_media_unavailable(
            "native-display-renderer-policy-mismatch",
        ));
    }
    if receipt.snapshot_pixel_aspect_ratio
        != (VideoRatioV1 {
            numerator: 1,
            denominator: 1,
        })
    {
        return Err(CommandError::native_media_unavailable(
            "native-display-snapshot-not-square-pixel",
        ));
    }
    let encoded_aspect = reduce_ratio(
        u64::from(receipt.encoded_width_px) * u64::from(receipt.pixel_aspect_ratio.numerator),
        u64::from(receipt.encoded_height_px) * u64::from(receipt.pixel_aspect_ratio.denominator),
    )?;
    let snapshot_aspect = reduce_ratio(
        u64::from(receipt.snapshot_width_px),
        u64::from(receipt.snapshot_height_px),
    )?;
    if encoded_aspect != snapshot_aspect {
        return Err(CommandError::native_media_unavailable(
            "native-display-metadata-inconsistent",
        ));
    }
    let (width, height) = if matches!(rotation, 90 | 270) {
        (receipt.snapshot_height_px, receipt.snapshot_width_px)
    } else {
        (receipt.snapshot_width_px, receipt.snapshot_height_px)
    };
    Ok(NativeDisplayGeometryV2 {
        status: "verified".into(),
        source: "native-gstplay-controlled-renderer".into(),
        display_width_px: width,
        display_height_px: height,
        display_aspect: reduce_ratio(u64::from(width), u64::from(height))?,
        rotation_degrees: rotation,
        pixel_aspect_ratio: receipt.pixel_aspect_ratio,
        metadata_interpretation: "controlled-renderer-and-pre-sink-square-pixel-snapshot".into(),
        native_display_metadata: receipt.clone(),
    })
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum NativeVideoOrientationV1 {
    Identity,
    Rotate90Clockwise,
    Rotate180,
    Rotate90Counterclockwise,
    ReflectHorizontal,
    ReflectVertical,
    ReflectUpperLeftLowerRight,
    ReflectUpperRightLowerLeft,
    Auto,
    Custom,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NativeDisplaySourceMetadataV1 {
    pub encoded_width_px: u32,
    pub encoded_height_px: u32,
    pub pixel_aspect_ratio: VideoRatioV1,
    pub orientation: NativeVideoOrientationV1,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeDisplayMetadataReceiptV1 {
    pub schema: &'static str,
    pub version: u32,
    pub encoded_width_px: u32,
    pub encoded_height_px: u32,
    pub pixel_aspect_ratio: VideoRatioV1,
    pub orientation: NativeVideoOrientationV1,
    pub snapshot_width_px: u32,
    pub snapshot_height_px: u32,
    pub snapshot_pixel_aspect_ratio: VideoRatioV1,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDisplayGeometryV1 {
    pub status: &'static str,
    pub source: &'static str,
    pub display_width_px: u32,
    pub display_height_px: u32,
    pub display_aspect: VideoRatioV1,
    pub rotation_degrees: u16,
    pub pixel_aspect_ratio: VideoRatioV1,
    pub metadata_interpretation: &'static str,
}

pub(crate) fn derive_native_display_geometry_v1(
    receipt: &NativeDisplayMetadataReceiptV1,
) -> ResearchResult<NativeDisplayGeometryV1> {
    if receipt.schema != NATIVE_DISPLAY_METADATA_SCHEMA || receipt.version != 1 {
        return Err(CommandError::invalid_contract(
            "Native display metadata schema/version is unsupported.",
        ));
    }
    validate_dimension(receipt.encoded_width_px)?;
    validate_dimension(receipt.encoded_height_px)?;
    validate_dimension(receipt.snapshot_width_px)?;
    validate_dimension(receipt.snapshot_height_px)?;
    validate_ratio(receipt.pixel_aspect_ratio)?;
    validate_ratio(receipt.snapshot_pixel_aspect_ratio)?;
    if receipt.snapshot_pixel_aspect_ratio
        != (VideoRatioV1 {
            numerator: 1,
            denominator: 1,
        })
    {
        return Err(CommandError::native_media_unavailable(
            "native-display-snapshot-not-square-pixel",
        ));
    }

    let rotation_degrees = match receipt.orientation {
        NativeVideoOrientationV1::Identity => 0,
        NativeVideoOrientationV1::Rotate90Clockwise => 90,
        NativeVideoOrientationV1::Rotate180 => 180,
        NativeVideoOrientationV1::Rotate90Counterclockwise => 270,
        NativeVideoOrientationV1::Missing => {
            return Err(CommandError::native_media_unavailable(
                "native-display-orientation-missing",
            ));
        }
        NativeVideoOrientationV1::ReflectHorizontal
        | NativeVideoOrientationV1::ReflectVertical
        | NativeVideoOrientationV1::ReflectUpperLeftLowerRight
        | NativeVideoOrientationV1::ReflectUpperRightLowerLeft
        | NativeVideoOrientationV1::Auto
        | NativeVideoOrientationV1::Custom
        | NativeVideoOrientationV1::Unknown => {
            return Err(CommandError::native_media_unavailable(
                "native-display-orientation-unsupported",
            ));
        }
    };

    let encoded_square_pixel_aspect = reduce_ratio(
        u64::from(receipt.encoded_width_px) * u64::from(receipt.pixel_aspect_ratio.numerator),
        u64::from(receipt.encoded_height_px) * u64::from(receipt.pixel_aspect_ratio.denominator),
    )?;
    let snapshot_aspect = reduce_ratio(
        u64::from(receipt.snapshot_width_px),
        u64::from(receipt.snapshot_height_px),
    )?;
    let rotated_encoded_aspect = VideoRatioV1 {
        numerator: encoded_square_pixel_aspect.denominator,
        denominator: encoded_square_pixel_aspect.numerator,
    };
    let swaps_axes = matches!(
        receipt.orientation,
        NativeVideoOrientationV1::Rotate90Clockwise
            | NativeVideoOrientationV1::Rotate90Counterclockwise
    );

    let (display_width_px, display_height_px) = if !swaps_axes {
        if snapshot_aspect != encoded_square_pixel_aspect {
            return Err(CommandError::native_media_unavailable(
                "native-display-metadata-inconsistent",
            ));
        }
        (receipt.snapshot_width_px, receipt.snapshot_height_px)
    } else if snapshot_aspect == encoded_square_pixel_aspect {
        (receipt.snapshot_height_px, receipt.snapshot_width_px)
    } else if snapshot_aspect == rotated_encoded_aspect {
        // Some GstPlay pipelines expose an already-oriented snapshot. The
        // explicit tag still supplies the source rotation; caps establish that
        // applying it a second time would be incorrect.
        (receipt.snapshot_width_px, receipt.snapshot_height_px)
    } else {
        return Err(CommandError::native_media_unavailable(
            "native-display-metadata-inconsistent",
        ));
    };
    let display_aspect = reduce_ratio(u64::from(display_width_px), u64::from(display_height_px))?;

    Ok(NativeDisplayGeometryV1 {
        status: "verified",
        source: "native-gstplay-metadata",
        display_width_px,
        display_height_px,
        display_aspect,
        rotation_degrees,
        pixel_aspect_ratio: receipt.pixel_aspect_ratio,
        metadata_interpretation: "explicit-orientation-and-square-pixel-snapshot",
    })
}

fn validate_dimension(value: u32) -> ResearchResult<()> {
    if value == 0 || value > MAX_VIDEO_DIMENSION_PX {
        return Err(CommandError::invalid_contract(
            "Native display metadata contains an invalid video dimension.",
        ));
    }
    Ok(())
}

fn validate_ratio(value: VideoRatioV1) -> ResearchResult<()> {
    if value.numerator == 0
        || value.denominator == 0
        || value.numerator > MAX_RATIO_TERM
        || value.denominator > MAX_RATIO_TERM
        || greatest_common_divisor(u64::from(value.numerator), u64::from(value.denominator)) != 1
    {
        return Err(CommandError::invalid_contract(
            "Native display metadata contains a non-canonical ratio.",
        ));
    }
    Ok(())
}

fn reduce_ratio(numerator: u64, denominator: u64) -> ResearchResult<VideoRatioV1> {
    let divisor = greatest_common_divisor(numerator, denominator);
    let numerator = numerator / divisor;
    let denominator = denominator / divisor;
    Ok(VideoRatioV1 {
        numerator: u32::try_from(numerator).map_err(|_| {
            CommandError::invalid_contract("Native display aspect exceeds the supported range.")
        })?,
        denominator: u32::try_from(denominator).map_err(|_| {
            CommandError::invalid_contract("Native display aspect exceeds the supported range.")
        })?,
    })
}

fn greatest_common_divisor(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        (left, right) = (right, left % right);
    }
    left
}

#[cfg(test)]
mod tests {
    use super::*;

    fn controlled_receipt(rotation: Option<u16>) -> NativeDisplayMetadataReceiptV2 {
        let degrees = rotation.unwrap_or(0);
        NativeDisplayMetadataReceiptV2 {
            schema: NATIVE_DISPLAY_METADATA_SCHEMA.into(),
            version: 2,
            encoded_width_px: 1920,
            encoded_height_px: 1080,
            pixel_aspect_ratio: VideoRatioV1 {
                numerator: 1,
                denominator: 1,
            },
            source_orientation: SourceOrientationV2 {
                stream: rotation.map_or(SourceOrientationTagV2::Absent {}, |rotation_degrees| {
                    SourceOrientationTagV2::Explicit { rotation_degrees }
                }),
                media: SourceOrientationTagV2::Absent {},
            },
            snapshot_width_px: 1920,
            snapshot_height_px: 1080,
            snapshot_pixel_aspect_ratio: VideoRatioV1 {
                numerator: 1,
                denominator: 1,
            },
            snapshot_interpretation: "pre-renderer-square-pixel".into(),
            renderer: ControlledRendererV2 {
                sink_factory: "d3d11videosink".into(),
                configured_rotation_degrees: degrees,
                readback_rotation_degrees: degrees,
            },
        }
    }

    #[test]
    fn controlled_absence_keeps_evidence_distinct_from_explicit_identity() {
        let absent = derive_native_display_geometry_v2(&controlled_receipt(None)).unwrap();
        let explicit = derive_native_display_geometry_v2(&controlled_receipt(Some(0))).unwrap();
        assert_eq!(absent.rotation_degrees, explicit.rotation_degrees);
        assert_ne!(
            absent.native_display_metadata,
            explicit.native_display_metadata
        );
        let value = serde_json::to_value(&absent).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 9);
        assert_eq!(
            value["nativeDisplayMetadata"].as_object().unwrap().len(),
            11
        );
        assert_eq!(
            serde_json::from_value::<NativeDisplayGeometryV2>(value).unwrap(),
            absent
        );
    }

    #[test]
    fn controlled_rotations_apply_once_to_unrotated_snapshot() {
        for rotation in [0, 90, 180, 270] {
            let receipt = controlled_receipt(Some(rotation));
            let geometry = derive_native_display_geometry_v2(&receipt).unwrap();
            let expected = if matches!(rotation, 90 | 270) {
                (1080, 1920)
            } else {
                (1920, 1080)
            };
            assert_eq!(
                (geometry.display_width_px, geometry.display_height_px),
                expected
            );
        }
        let mut already_rotated = controlled_receipt(Some(90));
        already_rotated.snapshot_width_px = 1080;
        already_rotated.snapshot_height_px = 1920;
        assert!(derive_native_display_geometry_v2(&already_rotated).is_err());
    }

    #[test]
    fn controlled_metadata_rejects_policy_conflict_and_noncanonical_evidence() {
        for mutation in 0..7 {
            let mut receipt = controlled_receipt(Some(90));
            match mutation {
                0 => receipt.renderer.readback_rotation_degrees = 0,
                1 => receipt.renderer.sink_factory = "autovideosink".into(),
                2 => {
                    receipt.source_orientation.media = SourceOrientationTagV2::Explicit {
                        rotation_degrees: 180,
                    }
                }
                3 => {
                    receipt.source_orientation.stream = SourceOrientationTagV2::Explicit {
                        rotation_degrees: 45,
                    }
                }
                4 => {
                    receipt.snapshot_pixel_aspect_ratio = VideoRatioV1 {
                        numerator: 2,
                        denominator: 1,
                    }
                }
                5 => {
                    receipt.pixel_aspect_ratio = VideoRatioV1 {
                        numerator: 2,
                        denominator: 2,
                    }
                }
                _ => receipt.version = 1,
            }
            assert!(derive_native_display_geometry_v2(&receipt).is_err());
        }
    }

    #[test]
    fn controlled_wire_rejects_unknown_fields_and_forged_absence() {
        let baseline = serde_json::to_value(controlled_receipt(None)).unwrap();
        for mutation in 0..3 {
            let mut value = baseline.clone();
            match mutation {
                0 => value["sourceOrientation"]["stream"]["rotationDegrees"] = 0.into(),
                1 => value["renderer"]["observedPixels"] = true.into(),
                _ => value["unknown"] = true.into(),
            }
            assert!(serde_json::from_value::<NativeDisplayMetadataReceiptV2>(value).is_err());
        }
    }

    fn receipt(orientation: NativeVideoOrientationV1) -> NativeDisplayMetadataReceiptV1 {
        NativeDisplayMetadataReceiptV1 {
            schema: NATIVE_DISPLAY_METADATA_SCHEMA,
            version: 1,
            encoded_width_px: 1_920,
            encoded_height_px: 1_080,
            pixel_aspect_ratio: VideoRatioV1 {
                numerator: 1,
                denominator: 1,
            },
            orientation,
            snapshot_width_px: 1_920,
            snapshot_height_px: 1_080,
            snapshot_pixel_aspect_ratio: VideoRatioV1 {
                numerator: 1,
                denominator: 1,
            },
        }
    }

    #[test]
    fn derives_identity_and_explicit_quarter_turn_geometry() {
        let identity =
            derive_native_display_geometry_v1(&receipt(NativeVideoOrientationV1::Identity))
                .unwrap();
        assert_eq!(
            (identity.display_width_px, identity.display_height_px),
            (1_920, 1_080)
        );
        assert_eq!(
            identity.display_aspect,
            VideoRatioV1 {
                numerator: 16,
                denominator: 9
            }
        );
        assert_eq!(identity.rotation_degrees, 0);

        let clockwise = derive_native_display_geometry_v1(&receipt(
            NativeVideoOrientationV1::Rotate90Clockwise,
        ))
        .unwrap();
        assert_eq!(
            (clockwise.display_width_px, clockwise.display_height_px),
            (1_080, 1_920)
        );
        assert_eq!(
            clockwise.display_aspect,
            VideoRatioV1 {
                numerator: 9,
                denominator: 16
            }
        );
        assert_eq!(clockwise.rotation_degrees, 90);
    }

    #[test]
    fn accepts_non_square_source_pixels_only_with_matching_square_pixel_snapshot() {
        let mut anamorphic = receipt(NativeVideoOrientationV1::Identity);
        anamorphic.encoded_width_px = 720;
        anamorphic.encoded_height_px = 576;
        anamorphic.pixel_aspect_ratio = VideoRatioV1 {
            numerator: 64,
            denominator: 45,
        };
        anamorphic.snapshot_width_px = 1_024;
        anamorphic.snapshot_height_px = 576;
        let geometry = derive_native_display_geometry_v1(&anamorphic).unwrap();
        assert_eq!(
            geometry.display_aspect,
            VideoRatioV1 {
                numerator: 16,
                denominator: 9
            }
        );
        assert_eq!(
            geometry.pixel_aspect_ratio,
            VideoRatioV1 {
                numerator: 64,
                denominator: 45
            }
        );
    }

    #[test]
    fn accepts_snapshot_caps_that_are_already_quarter_turn_oriented() {
        let mut already_oriented = receipt(NativeVideoOrientationV1::Rotate90Counterclockwise);
        already_oriented.snapshot_width_px = 1_080;
        already_oriented.snapshot_height_px = 1_920;
        let geometry = derive_native_display_geometry_v1(&already_oriented).unwrap();
        assert_eq!(
            (geometry.display_width_px, geometry.display_height_px),
            (1_080, 1_920)
        );
        assert_eq!(geometry.rotation_degrees, 270);
    }

    #[test]
    fn missing_unknown_reflective_or_contradictory_metadata_stays_pending() {
        for orientation in [
            NativeVideoOrientationV1::Missing,
            NativeVideoOrientationV1::Unknown,
            NativeVideoOrientationV1::ReflectHorizontal,
        ] {
            let error = derive_native_display_geometry_v1(&receipt(orientation)).unwrap_err();
            assert_eq!(error.code, "native_media_unavailable");
        }

        let mut contradictory = receipt(NativeVideoOrientationV1::Identity);
        contradictory.snapshot_width_px = 1_000;
        contradictory.snapshot_height_px = 1_000;
        assert!(derive_native_display_geometry_v1(&contradictory)
            .unwrap_err()
            .message
            .contains("native-display-metadata-inconsistent"));
    }

    #[test]
    fn receipt_validation_rejects_non_square_snapshot_par_and_noncanonical_ratios() {
        let mut non_square_snapshot = receipt(NativeVideoOrientationV1::Identity);
        non_square_snapshot.snapshot_pixel_aspect_ratio = VideoRatioV1 {
            numerator: 4,
            denominator: 3,
        };
        assert!(derive_native_display_geometry_v1(&non_square_snapshot).is_err());

        let mut noncanonical = receipt(NativeVideoOrientationV1::Identity);
        noncanonical.pixel_aspect_ratio = VideoRatioV1 {
            numerator: 2,
            denominator: 2,
        };
        assert_eq!(
            derive_native_display_geometry_v1(&noncanonical)
                .unwrap_err()
                .code,
            "invalid_research_contract"
        );
    }
}

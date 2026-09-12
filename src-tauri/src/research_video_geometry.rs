use crate::research_error::{CommandError, ResearchResult};
use serde::Serialize;

pub(crate) const NATIVE_DISPLAY_METADATA_SCHEMA: &str =
    "affect-research-native-display-metadata-receipt";

const MAX_VIDEO_DIMENSION_PX: u32 = 32_768;
const MAX_RATIO_TERM: u32 = 65_535;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoRatioV1 {
    pub numerator: u32,
    pub denominator: u32,
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

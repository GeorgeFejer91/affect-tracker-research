import { canonicalJson } from "./canonical.js";
import { validateVisualSettingsV1 } from "./contracts.js";
import { FLUBBER_MAPPING_SPECS, validateFlubberMapping } from "./mappings.js";

export const FEEDBACK_ENVELOPE_ALGORITHM = "feedback-envelope-v1";

/**
 * Conservative painted bounds for the saved v1 Grid/Flubber renderer.
 * The origin is the fixed design centre, not the animated outline centroid.
 * halfExtentAtUnitWidth scales with a square SVG viewport of side 1; stroke
 * padding is in CSS pixels because the renderer uses non-scaling-stroke.
 * There is no monitor, placement, calibration, or preview-draft authority here.
 */
export function deriveFeedbackEnvelopeV1({ visual, mappings }) {
  const style = validateVisualSettingsV1(visual);
  const keys = Object.keys(FLUBBER_MAPPING_SPECS);
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)
    || Object.keys(mappings).length !== keys.length
    || !keys.every((key) => Object.hasOwn(mappings, key))) {
    throw new TypeError("A complete saved mapping set is required for feedback bounds.");
  }
  const validated = Object.fromEntries(keys.map((key) => [key, validateFlubberMapping(key, mappings[key])]));
  const maxAmplitude = Math.max(validated.projectionAmplitude.min, validated.projectionAmplitude.max);
  const maxVariation = Math.max(validated.waveSizeVariation.min, validated.waveSizeVariation.max);

  // math.js: normalized shape ∈ [0,1], wave ∈ [0,1], offset amplitude ∈ [-1,1],
  // base profile coordinates ∈ [-1,1], and global scale <= 1 in both motion modes.
  // This bounds ALL phases/drivers/inputs, including mutually unattainable maxima.
  // The path rounds each coordinate to four decimals; retain an outward margin.
  const shapeHalfExtent = 1 + maxAmplitude * (1 + maxVariation) + 0.0001;
  const outline = style.flubber.showOutline ? style.flubber.outlineThickness : 0;
  const halo = style.flubber.showHalo ? Math.max(1, style.flubber.outlineThickness * 3) : 0;
  // SVG's default miter limit is 4: bound joins by 4 * half the stroke width.
  const flubber = style.flubberEnabled && !style.hideFeedback ? Object.freeze({
    halfExtentAtUnitWidth: shapeHalfExtent / 3.24,
    paddingCssPx: Math.max(outline, halo) * 2,
  }) : null;
  // Cursor centre can reach every grid edge. Its radius is in the 0..100 viewBox;
  // the 1.5 CSS-pixel cursor stroke is independent of the viewBox's scale.
  const grid = style.gridEnabled && !style.hideFeedback ? Object.freeze({
    halfExtentAtUnitWidth: 0.5 + style.grid.cursorSize / 100,
    paddingCssPx: Math.max(0.75, style.grid.lineThickness / 2,
      style.grid.showOutline ? style.grid.outlineThickness * 2 : 0),
  }) : null;
  const configurationKey = canonicalJson({
    algorithmVersion: FEEDBACK_ENVELOPE_ALGORITHM,
    gridEnabled: style.gridEnabled, flubberEnabled: style.flubberEnabled,
    hideFeedback: style.hideFeedback, flubber: style.flubber, grid: style.grid,
    mappings: validated,
  });
  return Object.freeze({
    algorithmVersion: FEEDBACK_ENVELOPE_ALGORITHM,
    configurationKey,
    origin: "design-centre",
    flubber,
    grid,
  });
}

/** Resolve from owned configuration, never from a caller's claimed envelope. */
export function resolveFeedbackEnvelopeV1(configuration, overlaySideCssPx) {
  if (!Number.isFinite(overlaySideCssPx) || overlaySideCssPx <= 0) {
    throw new RangeError("An explicit positive SVG viewport side in CSS pixels is required.");
  }
  const envelope = deriveFeedbackEnvelopeV1(configuration);
  const halfExtentCssPx = Math.max(0, ...[envelope.flubber, envelope.grid]
    .filter(Boolean)
    .map(({ halfExtentAtUnitWidth, paddingCssPx }) => halfExtentAtUnitWidth * overlaySideCssPx + paddingCssPx));
  if (!Number.isFinite(halfExtentCssPx)) throw new RangeError("Feedback extent exceeds the finite range.");
  return Object.freeze({ ...envelope, overlaySideCssPx, halfExtentCssPx });
}

import { XrLayoutError, resolveXrLayoutProfileV1 } from "./xr-layout.js";
import { FEEDBACK_ENVELOPE_ALGORITHM } from "./feedback-envelope.js";
import { FEEDBACK_ENVELOPE_V2_ALGORITHM } from "./feedback-layout.js";

// Versioned rendering reference, not observed device pixels or calibration.
// P5 derives the full bound at this explicit square SVG viewport size. P6 maps
// that bound uniformly into the researcher's maximum physical footprint.
export const XR_FEEDBACK_VIEWPORT_CSS_PX = 1024;

export function resolveXrFeedbackFootprintV1(profile, envelope) {
  const geometry = resolveXrLayoutProfileV1(profile);
  if (!envelope || ![FEEDBACK_ENVELOPE_ALGORITHM, FEEDBACK_ENVELOPE_V2_ALGORITHM].includes(envelope.algorithmVersion)
      || envelope.origin !== "design-centre"
      || envelope.overlaySideCssPx !== XR_FEEDBACK_VIEWPORT_CSS_PX
      || typeof envelope.configurationKey !== "string" || envelope.configurationKey.length === 0
      || envelope.configurationKey.length > 32768
      || !Number.isFinite(envelope.halfExtentCssPx) || envelope.halfExtentCssPx < 0) {
    throw new XrLayoutError("feedback", "envelope", "Bind the full P5 feedback envelope at the 1024 CSS-pixel reference viewport.");
  }
  // The full axis-aligned square fits inside the circle only at radius sqrt(2)*h.
  // This one configuration-dependent scale is fixed for every animation frame.
  const visible = profile.feedback.enabled && envelope.halfExtentCssPx > 0;
  const halfExtentMetres = visible ? profile.feedback.diameterMetres / (2 * Math.SQRT2) : 0;
  const metresPerCssPx = visible ? halfExtentMetres / envelope.halfExtentCssPx : 0;
  if (!Number.isFinite(metresPerCssPx) || !Number.isFinite(metresPerCssPx * XR_FEEDBACK_VIEWPORT_CSS_PX)) {
    throw new XrLayoutError("feedback", "envelope", "The P5 feedback extent cannot resolve a finite physical scale.");
  }
  const bounds = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const local = [x * halfExtentMetres, y * halfExtentMetres, 0];
    return geometry.feedbackCentre.map((value, row) => value
      + geometry.rotation[row].reduce((sum, v, col) => sum + v * local[col], 0));
  });
  return { algorithmVersion: "xr-feedback-footprint-v1", configurationKey: envelope.configurationKey,
    referenceViewportCssPx: XR_FEEDBACK_VIEWPORT_CSS_PX, metresPerCssPx,
    viewportSideMetres: metresPerCssPx * XR_FEEDBACK_VIEWPORT_CSS_PX,
    halfExtentMetres, visible, bounds };
}

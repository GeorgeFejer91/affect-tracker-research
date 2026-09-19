import { canonicalJson } from "./canonical.js";
import { deriveFeedbackEnvelopeV1, resolveFeedbackEnvelopeV1 } from "./feedback-envelope.js";
import { validateFeedbackContribution, validateFeedbackContributionV2 } from "./feedback-settings.js";

export const FEEDBACK_ENVELOPE_V2_ALGORITHM = "feedback-envelope-v2";

/** Full saved renderer bounds. Legacy placement and visibility flags do not
 * override the V2 renderer; P4/P6 alone own the explicit viewport/placement. */
export function resolveFeedbackEnvelopeV2(value, overlaySideCssPx) {
  if (!Number.isFinite(overlaySideCssPx) || overlaySideCssPx <= 0) {
    throw new RangeError("An explicit positive SVG viewport side in CSS pixels is required.");
  }
  const configuration = validateFeedbackContributionV2(value);
  const { visual, presentation, response, mappings } = configuration;
  const selected = { ...visual, gridEnabled: presentation.renderer === "grid", flubberEnabled: presentation.renderer === "flubber" };
  const legacy = deriveFeedbackEnvelopeV1({ visual: selected, mappings });
  let flubber = legacy.flubber, grid = legacy.grid;
  // Project-authored procedural Face: head and every feature, including scaled
  // strokes, stay inside the 200-unit square for all x/y in [-1,1].
  const face = !visual.hideFeedback && presentation.renderer === "procedural-face"
    ? Object.freeze({ halfExtentAtUnitWidth: 0.5, paddingCssPx: 0 }) : null;
  if (flubber) {
    const outline = visual.flubber.showOutline ? visual.flubber.outlineThickness : 0;
    const halo = visual.flubber.showHalo && presentation.halo.widthPercent > 0;
    const stroke = halo ? Math.max(1, visual.flubber.outlineThickness * 3) * presentation.halo.widthPercent / 100 : 0;
    // The exact animated path is reused. The SVG filter's object-bounding-box
    // region is [-100%,200%] on each axis: any painted fade is inside 3*H.
    // Retain conservative non-scaling miter padding as well. No Gaussian-tail
    // cutoff or current animation phase is treated as the maximum bound.
    flubber = Object.freeze({ halfExtentAtUnitWidth: flubber.halfExtentAtUnitWidth * (halo && presentation.halo.gradient ? 3 : 1),
      paddingCssPx: Math.max(outline, stroke) * 2 });
  }
  if (grid && response.mode === "stepwise") {
    // All tiles and inset double outlines are contained in the 0..100 square.
    grid = Object.freeze({ halfExtentAtUnitWidth: 0.5,
      paddingCssPx: Math.max(visual.grid.lineThickness / 2, visual.grid.showOutline ? visual.grid.outlineThickness * 2 : 0) });
  }
  const halfExtentCssPx = Math.max(0, ...[flubber, grid, face].filter(Boolean)
    .map(bound => bound.halfExtentAtUnitWidth * overlaySideCssPx + bound.paddingCssPx));
  if (!Number.isFinite(halfExtentCssPx)) throw new RangeError("Feedback extent exceeds the finite range.");
  return Object.freeze({ algorithmVersion: FEEDBACK_ENVELOPE_V2_ALGORITHM, origin: "design-centre",
    configurationKey: canonicalJson({ algorithmVersion: FEEDBACK_ENVELOPE_V2_ALGORITHM,
      visual: selected, mappings, presentation, response }),
    overlaySideCssPx, halfExtentCssPx, flubber, grid, face });
}

export function resolveFeedbackEnvelope(value, overlaySideCssPx) {
  const validated = validateFeedbackContribution(value);
  return validated.version === 2 ? resolveFeedbackEnvelopeV2(validated, overlaySideCssPx)
    : resolveFeedbackEnvelopeV1(validated, overlaySideCssPx);
}

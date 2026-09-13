import { canonicalJson } from "./canonical.js";
import { validateWorkspaceContribution, validateSupportedWorkspaceContribution } from "./workspace-contribution.js";
import { projectVideoDisplayGeometry, projectSupportedVideoDisplayGeometry } from "./video-catalogue-contribution.js";
import { validateFeedbackContribution } from "./feedback-settings.js";
import { resolveFeedbackEnvelope } from "./feedback-layout.js";
import { DESKTOP_LAYOUT_SCHEMA, DESKTOP_LAYOUT_MAX_BYTES, DesktopLayoutError,
  validateDesktopLayoutProfileV1, selectDesktopReference,
  resolveDesktopLayoutBase, resolveDesktopLayoutGeometry, isDesktopLayoutWarning } from "./desktop-layout.js";

const zero = n => {
  if (Object.is(n, -0)) return 0;
  const rounded = Math.round(n * 1e12) / 1e12;
  return Math.abs(n - rounded) < 1e-10 ? rounded : n;
};
const DRAFT_SOURCE_PROFILE = Symbol("desktopLayoutSourceProfile");
const DRAFT_FIELDS = Object.freeze(["screenWidth", "screenHeight", "physicalWidth", "physicalHeight", "fullViewportMapping", "units",
  "referencePolicy", "referenceWidth", "referenceHeight", "referenceX", "referenceY", "feedbackX", "feedbackY", "diameter", "gap"]);

function attachSourceProfile(draft, profile) {
  Object.defineProperty(draft, DRAFT_SOURCE_PROFILE, {
    value: structuredClone(profile),
    enumerable: false,
    configurable: false,
  });
  return draft;
}

export function cloneDesktopLayoutDraft(draft) {
  const cloned = structuredClone(draft);
  if (draft?.[DRAFT_SOURCE_PROFILE]) attachSourceProfile(cloned, draft[DRAFT_SOURCE_PROFILE]);
  return cloned;
}

function unchangedSourceProfile(draft, videos, policy) {
  if (!draft?.[DRAFT_SOURCE_PROFILE]) return null;
  const profile = validateDesktopLayoutProfileV1(draft[DRAFT_SOURCE_PROFILE]);
  if (policy !== profile.reference.source.policy) return null;
  if (canonicalJson(selectDesktopReference(videos, policy)) !== canonicalJson(profile.reference.source)) return null;
  const baseline = desktopLayoutDraftFromProfile(profile);
  return DRAFT_FIELDS.every(field => Object.is(draft[field], baseline[field])) ? profile : null;
}

/** Full saved content, with no editor, permission, storage or revision authority. */
export async function resolveDesktopLayoutContribution(value, { workspace, feedback } = {}) {
  return resolveSavedDesktop(value, { workspace, feedback }, validateWorkspaceContribution, projectVideoDisplayGeometry);
}

export async function resolveSupportedDesktopLayoutContribution(value, { workspace, feedback } = {}) {
  return resolveSavedDesktop(value, { workspace, feedback }, validateSupportedWorkspaceContribution, projectSupportedVideoDisplayGeometry);
}

async function resolveSavedDesktop(value, { workspace, feedback }, validateWorkspace, projectGeometry) {
  const profile = validateDesktopLayoutProfileV1(value);
  // Capture all asynchronous inputs before the first await.
  const capturedWorkspace = structuredClone(workspace), capturedFeedback = structuredClone(feedback);
  const validFeedback = validateFeedbackContribution(capturedFeedback);
  if (canonicalJson(validFeedback) !== canonicalJson(capturedFeedback)) throw new DesktopLayoutError("feedback", "noncanonical", "Saved feedback settings must be canonical.");
  const validWorkspace = await validateWorkspace(capturedWorkspace);
  const { videos } = await projectGeometry(validWorkspace.videoCatalogue);
  const side = resolveDesktopLayoutBase(profile).geometry.feedback.width;
  const result = resolveDesktopLayoutGeometry(profile, videos, resolveFeedbackEnvelope(validFeedback, side));
  const blockers = result.issues.filter(item => !isDesktopLayoutWarning(item));
  if (blockers.length) {
    const first = blockers[0];
    const error = new DesktopLayoutError(first.field, first.code, first.message);
    error.issues = structuredClone(blockers);
    throw error;
  }
  return { ...result, issues: [] };
}

export async function validateDesktopLayoutContribution(value, dependencies) {
  return (await resolveDesktopLayoutContribution(value, dependencies)).profile;
}

export async function validateSupportedDesktopLayoutContribution(value, dependencies) {
  return (await resolveSupportedDesktopLayoutContribution(value, dependencies)).profile;
}

export async function serializeDesktopLayoutContribution(value, dependencies) {
  return `${canonicalJson(await validateDesktopLayoutContribution(value, dependencies))}\n`;
}

export async function parseDesktopLayoutContribution(source, dependencies) {
  if (typeof source !== "string" || new TextEncoder().encode(source).length > DESKTOP_LAYOUT_MAX_BYTES) throw new DesktopLayoutError("layout", "size", "Layout text is missing or too large.");
  let value;
  try { value = JSON.parse(source); } catch { throw new DesktopLayoutError("layout", "json", "Layout must be valid JSON."); }
  if (`${canonicalJson(value)}\n` !== source) throw new DesktopLayoutError("layout", "noncanonical", "Layout JSON must be canonical, without duplicate keys or discarded data.");
  return validateDesktopLayoutContribution(value, dependencies);
}

/** Explicit new authoring, never a defaulting or migration path for saved JSON. */
export function desktopLayoutProfileFromDraft(draft, videos, policy = draft.referencePolicy ?? null) {
  const numeric = key => {
    const raw = draft[key];
    if (typeof raw !== "number" && (typeof raw !== "string" || !raw.trim())) throw new DesktopLayoutError(key, "invalid-number", `Enter a number for ${key}.`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new DesktopLayoutError(key, "invalid-number", `Enter a finite number for ${key}.`);
    return Object.is(value, -0) ? 0 : value;
  };
  if (policy === null) throw new DesktopLayoutError("referencePolicy", "reference-policy-required", "Choose a reference method before preparing the layout.");
  if (!["relative", "mm"].includes(draft.units)) throw new DesktopLayoutError("units", "unsupported", "Choose relative percentages or millimetres.");
  const unchanged = unchangedSourceProfile(draft, videos, policy);
  if (unchanged) return unchanged;
  const hasCalibration = draft.fullViewportMapping || !["", null, undefined].includes(draft.physicalWidth) || !["", null, undefined].includes(draft.physicalHeight);
  if (hasCalibration && draft.fullViewportMapping !== true) throw new DesktopLayoutError("fullViewportMapping", "mapping-required", "Confirm that the design viewport covers the measured active display.");
  if (draft.units === "mm" && !hasCalibration) throw new DesktopLayoutError("calibration", "required", "Millimetres require explicit measured active display dimensions and full-viewport mapping.");
  const widthCssPx = numeric("screenWidth"), heightCssPx = numeric("screenHeight");
  const activeWidthMm = hasCalibration ? numeric("physicalWidth") : null;
  const activeHeightMm = hasCalibration ? numeric("physicalHeight") : null;
  const source = selectDesktopReference(videos, policy);
  const relative = draft.units === "relative";
  const scale = hasCalibration ? widthCssPx / activeWidthMm : null;
  const xScale = relative ? widthCssPx / 100 : scale, yScale = relative ? heightCssPx / 100 : scale;
  const boxWidth = numeric("referenceWidth"), boxHeight = numeric("referenceHeight");
  const centreX = numeric("referenceX"), centreY = numeric("referenceY");
  const fit = Math.min(boxWidth * xScale / source.displayWidthPx, boxHeight * yScale / source.displayHeightPx);
  const referenceWidthPx = source.displayWidthPx * fit, referenceHeightPx = source.displayHeightPx * fit;
  const referenceCx = centreX * xScale, referenceCy = centreY * yScale;
  const hasDirectFeedbackCentre = !["", null, undefined].includes(draft.feedbackX) || !["", null, undefined].includes(draft.feedbackY);
  const feedbackCx = hasDirectFeedbackCentre
    ? numeric("feedbackX") * xScale
    : referenceCx + numeric("offsetX") * (relative ? referenceWidthPx / 100 : scale);
  const feedbackCy = hasDirectFeedbackCentre
    ? numeric("feedbackY") * yScale
    : referenceCy + numeric("offsetY") * (relative ? referenceHeightPx / 100 : scale);
  const offset = { x: zero((feedbackCx - referenceCx) / (relative ? referenceWidthPx / 100 : scale)),
    y: zero((feedbackCy - referenceCy) / (relative ? referenceHeightPx / 100 : scale)) };
  return validateDesktopLayoutProfileV1({
    schema: DESKTOP_LAYOUT_SCHEMA, version: 1, target: "desktop-screen", coordinateSystem: "viewport-right-down",
    viewport: { widthCssPx, heightCssPx, compatibility: "exact" },
    calibration: hasCalibration ? { activeWidthMm, activeHeightMm, mapping: "full-viewport" } : null,
    units: draft.units,
    reference: { source, box: { width: boxWidth, height: boxHeight }, centre: { x: centreX, y: centreY } },
    feedback: { origin: "design-centre", overlayViewportSide: numeric("diameter"), offset, minimumGap: numeric("gap") },
    fit: "contain",
  });
}

export function desktopLayoutDraftFromProfile(value) {
  const p = validateDesktopLayoutProfileV1(value);
  const g = resolveDesktopLayoutBase(p).geometry;
  const relative = p.units === "relative";
  const mmScale = p.calibration ? p.viewport.widthCssPx / p.calibration.activeWidthMm : null;
  const xScale = relative ? p.viewport.widthCssPx / 100 : mmScale;
  const yScale = relative ? p.viewport.heightCssPx / 100 : mmScale;
  return attachSourceProfile({ screenWidth: p.viewport.widthCssPx, screenHeight: p.viewport.heightCssPx,
    referencePolicy: p.reference.source.policy,
    physicalWidth: p.calibration?.activeWidthMm ?? "", physicalHeight: p.calibration?.activeHeightMm ?? "",
    fullViewportMapping: p.calibration !== null, units: p.units,
    referenceWidth: p.reference.box.width, referenceHeight: p.reference.box.height,
    referenceX: p.reference.centre.x, referenceY: p.reference.centre.y,
    feedbackX: zero(g.feedback.cx / xScale), feedbackY: zero(g.feedback.cy / yScale),
    diameter: p.feedback.overlayViewportSide, gap: p.feedback.minimumGap }, p);
}

/** Keep domain paths precise while associating editor errors with their control. */
export function desktopLayoutDraftField(field) {
  return ({ "viewport.widthCssPx": "screenWidth", "viewport.heightCssPx": "screenHeight",
    "calibration.activeWidthMm": "physicalWidth", "calibration.activeHeightMm": "physicalHeight", calibration: "physicalHeight",
    "reference.policy": "referencePolicy", "reference.source": "referencePolicy",
    "reference.box.width": "referenceWidth", "reference.box.height": "referenceHeight",
    "reference.centre.x": "referenceX", "reference.centre.y": "referenceY",
    "feedback.overlayViewportSide": "diameter", "feedback.offset.x": "feedbackX", "feedback.offset.y": "feedbackY",
    "feedback.minimumGap": "gap" })[field] ?? field;
}

import { canonicalJson } from "./canonical.js";
import { validateWorkspaceContribution } from "./workspace-contribution.js";
import { projectVideoDisplayGeometry } from "./video-catalogue-contribution.js";
import { validateFeedbackContribution } from "./feedback-settings.js";
import { resolveFeedbackEnvelope } from "./feedback-layout.js";
import { DESKTOP_LAYOUT_SCHEMA, DESKTOP_LAYOUT_MAX_BYTES, DesktopLayoutError,
  validateDesktopLayoutProfileV1, selectDesktopReference,
  resolveDesktopLayoutBase, resolveDesktopLayoutGeometry } from "./desktop-layout.js";

/** Full saved content, with no editor, permission, storage or revision authority. */
export async function resolveDesktopLayoutContribution(value, { workspace, feedback } = {}) {
  const profile = validateDesktopLayoutProfileV1(value);
  // Capture all asynchronous inputs before the first await.
  const capturedWorkspace = structuredClone(workspace), capturedFeedback = structuredClone(feedback);
  const validFeedback = validateFeedbackContribution(capturedFeedback);
  if (canonicalJson(validFeedback) !== canonicalJson(capturedFeedback)) throw new DesktopLayoutError("feedback", "noncanonical", "Saved feedback settings must be canonical.");
  const validWorkspace = await validateWorkspaceContribution(capturedWorkspace);
  const { videos } = await projectVideoDisplayGeometry(validWorkspace.videoCatalogue);
  const side = resolveDesktopLayoutBase(profile).geometry.feedback.width;
  const result = resolveDesktopLayoutGeometry(profile, videos, resolveFeedbackEnvelope(validFeedback, side));
  if (result.issues.length) {
    const first = result.issues[0];
    const error = new DesktopLayoutError(first.field, first.code, first.message);
    error.issues = structuredClone(result.issues);
    throw error;
  }
  return result;
}

export async function validateDesktopLayoutContribution(value, dependencies) {
  return (await resolveDesktopLayoutContribution(value, dependencies)).profile;
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
  const hasCalibration = draft.fullViewportMapping || !["", null, undefined].includes(draft.physicalWidth) || !["", null, undefined].includes(draft.physicalHeight);
  if (hasCalibration && draft.fullViewportMapping !== true) throw new DesktopLayoutError("fullViewportMapping", "mapping-required", "Confirm that the design viewport covers the measured active display.");
  return validateDesktopLayoutProfileV1({
    schema: DESKTOP_LAYOUT_SCHEMA, version: 1, target: "desktop-screen", coordinateSystem: "viewport-right-down",
    viewport: { widthCssPx: numeric("screenWidth"), heightCssPx: numeric("screenHeight"), compatibility: "exact" },
    calibration: hasCalibration ? { activeWidthMm: numeric("physicalWidth"), activeHeightMm: numeric("physicalHeight"), mapping: "full-viewport" } : null,
    units: draft.units,
    reference: { source: selectDesktopReference(videos, policy), box: { width: numeric("referenceWidth"), height: numeric("referenceHeight") }, centre: { x: numeric("referenceX"), y: numeric("referenceY") } },
    feedback: { origin: "design-centre", overlayViewportSide: numeric("diameter"), offset: { x: numeric("offsetX"), y: numeric("offsetY") }, minimumGap: numeric("gap") },
    fit: "contain",
  });
}

export function desktopLayoutDraftFromProfile(value) {
  const p = validateDesktopLayoutProfileV1(value);
  return { screenWidth: p.viewport.widthCssPx, screenHeight: p.viewport.heightCssPx,
    referencePolicy: p.reference.source.policy,
    physicalWidth: p.calibration?.activeWidthMm ?? "", physicalHeight: p.calibration?.activeHeightMm ?? "",
    fullViewportMapping: p.calibration !== null, units: p.units,
    referenceWidth: p.reference.box.width, referenceHeight: p.reference.box.height,
    referenceX: p.reference.centre.x, referenceY: p.reference.centre.y,
    diameter: p.feedback.overlayViewportSide, offsetX: p.feedback.offset.x, offsetY: p.feedback.offset.y, gap: p.feedback.minimumGap };
}

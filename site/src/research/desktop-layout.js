import { canonicalJson } from "./canonical.js";
import { applyScreenLayoutFit } from "./screen-layout-draft.js";

export const DESKTOP_LAYOUT_SCHEMA = "affect-research-desktop-layout-contribution";
export const DESKTOP_LAYOUT_MAX_BYTES = 8192;
// Q08 is owned by the researcher. Calculation candidates are not an approval.
export const APPROVED_DESKTOP_REFERENCE_POLICY = null;
const POLICIES = ["largest-oriented-area", "maximum-oriented-dimensions"];
const rectangle = (cx, cy, width, height) => ({ x: cx - width / 2, y: cy - height / 2, width, height, cx, cy });
const outside = (r, s) => r.x < -1e-7 || r.y < -1e-7 || r.x + r.width > s.width + 1e-7 || r.y + r.height > s.height + 1e-7;

export class DesktopLayoutError extends TypeError {
  constructor(field, code, message) { super(message); this.name = "DesktopLayoutError"; this.field = field; this.code = code; }
}
const fail = (field, code, message) => { throw new DesktopLayoutError(field, code, message); };
function exact(value, keys, field) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    fail(field, "fields", `${field} has missing or unexpected fields.`);
  }
}
function number(value, field, min, max, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < min || value > max || (integer && !Number.isInteger(value))) {
    fail(field, "range", `${field} must be ${integer ? "an integer" : "a finite number"} from ${min} to ${max}.`);
  }
  return value;
}
function literal(value, expected, field) { if (value !== expected) fail(field, "unsupported", `${field} must be ${expected}.`); }
const zero = n => Object.is(n, -0) ? 0 : n;

/** P1 validates ownership and metadata before supplying this geometry projection. */
export function validateDesktopMediaGeometry(media) {
  if (!Array.isArray(media) || !media.length || media.length > 500) fail("media", "missing", "Verify one to 500 videos before preparing the layout.");
  const ids = new Set();
  return media.map(item => {
    exact(item, ["assetId", "displayWidth", "displayHeight"], "media entry");
    if (typeof item.assetId !== "string" || !/^asset-[a-f0-9]{64}$/u.test(item.assetId) || ids.has(item.assetId)) fail("media", "identity", "Video identities must be unique immutable catalogue IDs.");
    ids.add(item.assetId);
    number(item.displayWidth, "media width", 1, 32768, true);
    number(item.displayHeight, "media height", 1, 32768, true);
    return { ...item };
  });
}

/** Explicit calculation policy only; callers cannot turn it into accepted policy. */
export function selectDesktopReference(media, policy) {
  const videos = validateDesktopMediaGeometry(media);
  if (!POLICIES.includes(policy)) fail("reference.policy", "unsupported", "The automatic reference policy is unsupported.");
  if (policy === "maximum-oriented-dimensions") return { policy, assetId: null,
    displayWidthPx: Math.max(...videos.map(v => v.displayWidth)), displayHeightPx: Math.max(...videos.map(v => v.displayHeight)) };
  const largest = videos.sort((a, b) => b.displayWidth * b.displayHeight - a.displayWidth * a.displayHeight
    || (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))[0];
  return { policy, assetId: largest.assetId, displayWidthPx: largest.displayWidth, displayHeightPx: largest.displayHeight };
}

/** Strict authored profile shape. This alone is not media/feedback acceptance. */
export function validateDesktopLayoutProfileV1(value) {
  exact(value, ["schema", "version", "target", "coordinateSystem", "viewport", "calibration", "units", "reference", "feedback", "fit"], "layout");
  literal(value.schema, DESKTOP_LAYOUT_SCHEMA, "schema"); literal(value.version, 1, "version");
  literal(value.target, "desktop-screen", "target"); literal(value.coordinateSystem, "viewport-right-down", "coordinateSystem");
  literal(value.fit, "contain", "fit");
  if (!["relative", "mm"].includes(value.units)) fail("units", "unsupported", "Choose relative percentages or millimetres.");
  const v = value.viewport;
  exact(v, ["widthCssPx", "heightCssPx", "compatibility"], "viewport");
  number(v.widthCssPx, "viewport.widthCssPx", 1, 32768, true); number(v.heightCssPx, "viewport.heightCssPx", 1, 32768, true);
  literal(v.compatibility, "exact", "viewport.compatibility");
  const c = value.calibration;
  if (c !== null) {
    exact(c, ["activeWidthMm", "activeHeightMm", "mapping"], "calibration");
    number(c.activeWidthMm, "calibration.activeWidthMm", 1, 100000); number(c.activeHeightMm, "calibration.activeHeightMm", 1, 100000);
    literal(c.mapping, "full-viewport", "calibration.mapping");
    if (Math.abs(c.activeWidthMm / c.activeHeightMm - v.widthCssPx / v.heightCssPx) > 1e-6) fail("calibration", "aspect-mismatch", "Measured display and design viewport must have matching aspect ratios.");
  }
  if (value.units === "mm" && c === null) fail("calibration", "required", "Millimetres require explicit measured active display dimensions and full-viewport mapping.");
  const r = value.reference;
  exact(r, ["source", "box", "centre"], "reference");
  exact(r.source, ["policy", "assetId", "displayWidthPx", "displayHeightPx"], "reference.source");
  if (!POLICIES.includes(r.source.policy)) fail("reference.policy", "unsupported", "Unsupported automatic reference policy.");
  if (r.source.policy === "largest-oriented-area" ? typeof r.source.assetId !== "string" || !/^asset-[a-f0-9]{64}$/u.test(r.source.assetId) : r.source.assetId !== null) fail("reference.assetId", "identity", "Reference identity does not match its selection policy.");
  number(r.source.displayWidthPx, "reference.displayWidthPx", 1, 32768, true); number(r.source.displayHeightPx, "reference.displayHeightPx", 1, 32768, true);
  exact(r.box, ["width", "height"], "reference.box"); exact(r.centre, ["x", "y"], "reference.centre");
  number(r.box.width, "reference.box.width", 0.001, 100000); number(r.box.height, "reference.box.height", 0.001, 100000);
  number(r.centre.x, "reference.centre.x", -100000, 100000); number(r.centre.y, "reference.centre.y", -100000, 100000);
  const f = value.feedback;
  exact(f, ["origin", "overlayViewportSide", "offset", "minimumGap"], "feedback"); literal(f.origin, "design-centre", "feedback.origin");
  exact(f.offset, ["x", "y"], "feedback.offset");
  number(f.overlayViewportSide, "feedback.overlayViewportSide", 0.001, 100000);
  number(f.offset.x, "feedback.offset.x", -100000, 100000); number(f.offset.y, "feedback.offset.y", -100000, 100000);
  number(f.minimumGap, "feedback.minimumGap", 0, 100000);
  if (new TextEncoder().encode(canonicalJson(value)).length > DESKTOP_LAYOUT_MAX_BYTES) fail("layout", "size", "Layout exceeds its bounded contract size.");
  return structuredClone(value);
}

/** Resolve the one fixed reference and centre relationship before querying P5. */
export function resolveDesktopLayoutBase(value) {
  const p = validateDesktopLayoutProfileV1(value), v = p.viewport, r = p.reference, f = p.feedback;
  const relative = p.units === "relative", scale = p.calibration ? v.widthCssPx / p.calibration.activeWidthMm : null;
  const xScale = relative ? v.widthCssPx / 100 : scale, yScale = relative ? v.heightCssPx / 100 : scale;
  const boxWidth = r.box.width * xScale, boxHeight = r.box.height * yScale;
  const fit = Math.min(boxWidth / r.source.displayWidthPx, boxHeight / r.source.displayHeightPx);
  const reference = rectangle(r.centre.x * xScale, r.centre.y * yScale, r.source.displayWidthPx * fit, r.source.displayHeightPx * fit);
  const sideScale = relative ? Math.min(reference.width, reference.height) / 100 : scale;
  const offset = { x: zero(f.offset.x * (relative ? reference.width / 100 : scale)), y: zero(f.offset.y * (relative ? reference.height / 100 : scale)) };
  const side = f.overlayViewportSide * sideScale;
  const feedback = rectangle(reference.cx + offset.x, reference.cy + offset.y, side, side);
  const screen = { width: v.widthCssPx, height: v.heightCssPx };
  const issues = [];
  if (outside(reference, screen)) issues.push({ field: "referenceWidth", code: "reference-clips", message: "The fixed reference extends beyond the design viewport." });
  if (outside(feedback, screen)) issues.push({ field: "offsetY", code: "footprint-clips", message: "The feedback SVG viewport extends beyond the design viewport." });
  return { geometry: { screen, reference, feedback, offset, gap: f.minimumGap * sideScale, maximumFeedback: null }, videos: [], issues };
}

/** P5 owns this resolved bound; it is never deserialized from a layout payload. */
export function resolveDesktopLayoutGeometry(value, media, envelope) {
  const p = validateDesktopLayoutProfileV1(value), videos = validateDesktopMediaGeometry(media);
  if (canonicalJson(p.reference.source) !== canonicalJson(selectDesktopReference(videos, p.reference.source.policy))) fail("reference", "source-mismatch", "The saved automatic reference does not match the complete video catalogue.");
  const result = resolveDesktopLayoutBase(p), side = result.geometry.feedback.width;
  if (!envelope || !["feedback-envelope-v1", "feedback-envelope-v2"].includes(envelope.algorithmVersion)
    || envelope.origin !== "design-centre" || envelope.overlaySideCssPx !== side
    || typeof envelope.configurationKey !== "string" || !envelope.configurationKey.length || envelope.configurationKey.length > 32768
    || !Number.isFinite(envelope.halfExtentCssPx * 2) || envelope.halfExtentCssPx < 0) fail("feedback", "envelope", "The owned feedback envelope is missing or inconsistent with the explicit SVG viewport side.");
  const { cx, cy } = result.geometry.feedback, half = envelope.halfExtentCssPx;
  const maximum = rectangle(cx, cy, half * 2, half * 2);
  applyScreenLayoutFit(result, videos.map(v => ({ id: v.assetId, width: v.displayWidth, height: v.displayHeight })), maximum, "saved-maximum");
  return { ...result, profile: p, envelope: structuredClone(envelope), inputKind: "live" };
}

export function assertDesktopReferenceApproved(value) {
  if (APPROVED_DESKTOP_REFERENCE_POLICY === null || value.reference.source.policy !== APPROVED_DESKTOP_REFERENCE_POLICY) fail("reference", "reference-policy-pending", "The automatic largest-video reference rule is awaiting confirmation.");
}

/** Representation conversion uses the fixed reference, never the inspected video. */
export function convertDesktopLayoutUnits(value, units) {
  const p = validateDesktopLayoutProfileV1(value);
  if (!["relative", "mm"].includes(units)) fail("units", "unsupported", "Unsupported geometry units.");
  if (p.units === units) return p;
  if (!p.calibration) fail("calibration", "required", "Measure the active display and confirm its viewport mapping before converting units.");
  const g = resolveDesktopLayoutBase(p).geometry, relative = units === "relative";
  const mmScale = p.viewport.widthCssPx / p.calibration.activeWidthMm;
  const oldX = p.units === "relative" ? p.viewport.widthCssPx / 100 : mmScale;
  const oldY = p.units === "relative" ? p.viewport.heightCssPx / 100 : mmScale;
  const newX = relative ? p.viewport.widthCssPx / 100 : mmScale, newY = relative ? p.viewport.heightCssPx / 100 : mmScale;
  const sideScale = relative ? Math.min(g.reference.width, g.reference.height) / 100 : mmScale;
  p.units = units;
  p.reference.box = { width: p.reference.box.width * oldX / newX, height: p.reference.box.height * oldY / newY };
  p.reference.centre = { x: zero(g.reference.cx / newX), y: zero(g.reference.cy / newY) };
  p.feedback.overlayViewportSide = g.feedback.width / sideScale;
  p.feedback.offset = { x: zero(g.offset.x / (relative ? g.reference.width / 100 : mmScale)), y: zero(g.offset.y / (relative ? g.reference.height / 100 : mmScale)) };
  p.feedback.minimumGap = g.gap / sideScale;
  return validateDesktopLayoutProfileV1(p);
}

export function assertDesktopLayoutViewport(value, viewport) {
  const p = validateDesktopLayoutProfileV1(value);
  exact(viewport, ["widthCssPx", "heightCssPx"], "observed viewport");
  if (viewport.widthCssPx !== p.viewport.widthCssPx || viewport.heightCssPx !== p.viewport.heightCssPx) fail("viewport", "incompatible", "The observed viewport differs from the authored viewport; no automatic layout resizing is allowed.");
  return true;
}

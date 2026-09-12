/** Proposed P4 geometry for an ephemeral UI draft. Never a package/Run contract. */
export const SCREEN_LAYOUT_DRAFT_FIELDS = Object.freeze({
  screenWidth: "Design viewport width", screenHeight: "Design viewport height",
  physicalWidth: "Measured active width", physicalHeight: "Measured active height",
  referenceWidth: "Reference width", referenceHeight: "Reference height",
  referenceX: "Reference centre X", referenceY: "Reference centre Y",
  diameter: "Flubber diameter", offsetX: "Centre offset X", offsetY: "Centre offset Y",
  gap: "Minimum separation",
});
const LAYOUT_FIELDS = ["referenceWidth", "referenceHeight", "referenceX", "referenceY", "diameter", "offsetX", "offsetY", "gap"];
const issue = (field, code, message, videoId = null) => ({ field, code, message, videoId });

export function createScreenLayoutDraft() {
  return {
    screenWidth: 1920, screenHeight: 1080, physicalWidth: "", physicalHeight: "",
    fullViewportMapping: false, units: "relative",
    referenceWidth: 60, referenceHeight: 60, referenceX: 50, referenceY: 35,
    diameter: 24, offsetX: 0, offsetY: 75, gap: 3,
  };
}

function number(raw, field, min, max, issues, integer = false) {
  const validType = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "");
  const value = validType ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    issues.push(issue(field, "invalid-number", `${SCREEN_LAYOUT_DRAFT_FIELDS[field]} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}.`));
  }
  return value;
}

function calibration(draft, screen) {
  const issues = [];
  const width = number(draft.physicalWidth, "physicalWidth", 1, 100000, issues);
  const height = number(draft.physicalHeight, "physicalHeight", 1, 100000, issues);
  if (draft.fullViewportMapping !== true) issues.push(issue("fullViewportMapping", "mapping-required", "Confirm that the design viewport covers the measured active display before converting units."));
  if (!issues.length && Math.abs(width / height - screen.width / screen.height) > 1e-6) {
    issues.push(issue("physicalHeight", "aspect-mismatch", "Measured display and design viewport must have the same aspect ratio for this proposed circular-footprint conversion."));
  }
  return { issues, scale: screen.width / width };
}

const rect = (cx, cy, width, height) => ({ x: cx - width / 2, y: cy - height / 2, width, height, cx, cy });
const outside = (r, screen) => r.x < -1e-7 || r.y < -1e-7 || r.x + r.width > screen.width + 1e-7 || r.y + r.height > screen.height + 1e-7;

function separation(a, b) {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0);
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0);
  return { overlaps: a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, gap: Math.hypot(dx, dy) };
}

/** Geometry only: callers validate their owned media/envelope inputs first. */
export function applyScreenLayoutFit(result, media, maximumFeedback, boundKind) {
  if (!result.geometry) return result;
  const { reference, feedback, screen, gap } = result.geometry;
  result.geometry.maximumFeedback = maximumFeedback;
  if (maximumFeedback && outside(maximumFeedback, screen)) {
    result.issues.push(issue("diameter", "envelope-clips", "The maximum feedback bounds extend beyond the design viewport."));
  }
  for (const item of media) {
    const fit = Math.min(reference.width / item.width, reference.height / item.height);
    const bounds = rect(reference.cx, reference.cy, item.width * fit, item.height * fit);
    const painted = maximumFeedback ?? feedback;
    const check = painted.width === 0 && painted.height === 0
      ? { overlaps: false, gap: null } : separation(bounds, painted);
    result.videos.push({ id: item.id, label: item.label ?? item.id, displayWidth: item.width, displayHeight: item.height,
      bounds, gap: check.gap, boundKind });
    if (check.overlaps) result.issues.push(issue("offsetY", "video-overlap", `${item.label ?? item.id}: feedback bounds overlap the fitted video.`, item.id));
    else if (check.gap !== null && check.gap + 1e-7 < gap) result.issues.push(issue("gap", "gap-too-small", `${item.label ?? item.id}: separation is below the requested minimum.`, item.id));
  }
  return result;
}

/** Fixture dependencies are deliberately synthetic until P1/P5 contracts are accepted. */
export function resolveScreenLayoutDraft(draft, { media = [], envelope = null } = {}) {
  const issues = [];
  const screen = {
    width: number(draft.screenWidth, "screenWidth", 1, 32768, issues, true),
    height: number(draft.screenHeight, "screenHeight", 1, 32768, issues, true),
  };
  if (!["relative", "mm"].includes(draft.units)) issues.push(issue("units", "invalid-unit", "Choose relative percentages or millimetres."));
  const values = {};
  for (const field of LAYOUT_FIELDS) {
    const positive = ["referenceWidth", "referenceHeight", "diameter"].includes(field);
    values[field] = number(draft[field], field, positive ? 0.001 : field === "gap" ? 0 : -100000, 100000, issues);
  }
  let scale = null;
  if (!issues.length && draft.units === "mm") {
    const measured = calibration(draft, screen);
    issues.push(...measured.issues);
    scale = measured.scale;
  }
  const result = { exportable: false, status: "draft-only", geometry: null, videos: [], issues, dependencies: ["Q08 confirmation", "P1 display geometry", "P5 animation envelope", "P7 successor recipe"] };
  if (issues.length) return result;
  const relative = draft.units === "relative";
  const rw = values.referenceWidth * (relative ? screen.width / 100 : scale);
  const rh = values.referenceHeight * (relative ? screen.height / 100 : scale);
  const cx = values.referenceX * (relative ? screen.width / 100 : scale);
  const cy = values.referenceY * (relative ? screen.height / 100 : scale);
  const diameter = values.diameter * (relative ? Math.min(rw, rh) / 100 : scale);
  const dx = values.offsetX * (relative ? rw / 100 : scale);
  const dy = values.offsetY * (relative ? rh / 100 : scale);
  const gap = values.gap * (relative ? Math.min(rw, rh) / 100 : scale);
  const reference = rect(cx, cy, rw, rh);
  const feedback = rect(cx + dx, cy + dy, diameter, diameter);
  result.geometry = { screen, reference, feedback, offset: { x: dx, y: dy }, gap, maximumFeedback: null };
  if (outside(reference, screen)) issues.push(issue("referenceWidth", "reference-clips", "The fixed reference extends beyond the design viewport. Edit its size or centre."));
  if (outside(feedback, screen)) issues.push(issue("offsetY", "footprint-clips", "The nominal Flubber footprint extends beyond the design viewport."));

  let maximumFeedback = null;
  if (envelope !== null) {
    const valid = envelope.source === "synthetic" && typeof envelope.revision === "string" && envelope.revision.length > 0
      && ["left", "right", "top", "bottom", "paddingCssPx"].every(key => Number.isFinite(envelope[key]) && envelope[key] >= 0 && envelope[key] <= 100)
      && envelope.left + envelope.right > 0 && envelope.top + envelope.bottom > 0;
    if (!valid) issues.push(issue("envelope", "invalid-envelope", "The synthetic envelope fixture is invalid; no maximum animation bound was applied."));
    else {
      const padding = envelope.paddingCssPx;
      maximumFeedback = { x: feedback.cx - diameter * envelope.left - padding, y: feedback.cy - diameter * envelope.top - padding,
        width: diameter * (envelope.left + envelope.right) + padding * 2, height: diameter * (envelope.top + envelope.bottom) + padding * 2 };
    }
  }
  if (!Array.isArray(media) || media.length > 500) {
    issues.push(issue("media", "invalid-media", "The draft accepts at most 500 synthetic display-geometry fixtures."));
    return result;
  }
  const ids = new Set();
  const validatedMedia = [];
  for (const item of media) {
    if (item?.source !== "synthetic" || typeof item.id !== "string" || !/^[a-z0-9-]{1,64}$/u.test(item.id) || ids.has(item.id)
      || ![item.width, item.height].every(value => Number.isFinite(value) && value > 0 && value <= 32768)) {
      issues.push(issue("media", "invalid-media", "A display-geometry fixture is invalid or repeats an ID."));
      continue;
    }
    ids.add(item.id);
    validatedMedia.push(item);
  }
  return applyScreenLayoutFit(result, validatedMedia, maximumFeedback, maximumFeedback ? "synthetic-maximum" : "nominal-only");
}

/** Switching units changes only representation; rejected conversion retains the original draft. */
export function convertScreenLayoutDraftUnits(draft, units) {
  const resolved = resolveScreenLayoutDraft(draft);
  if (!resolved.geometry) return { ok: false, draft, issues: resolved.issues };
  if (!["relative", "mm"].includes(units)) return { ok: false, draft, issues: [issue("units", "invalid-unit", "Choose relative percentages or millimetres.")] };
  const { screen, reference, feedback, offset, gap } = resolved.geometry;
  const measured = calibration(draft, screen);
  if (units !== draft.units && measured.issues.length) return { ok: false, draft, issues: measured.issues };
  if (units === draft.units) return { ok: true, draft: { ...draft }, issues: [] };
  const scale = measured.scale;
  const relative = units === "relative";
  const next = { ...draft, units,
    referenceWidth: reference.width / (relative ? screen.width / 100 : scale),
    referenceHeight: reference.height / (relative ? screen.height / 100 : scale),
    referenceX: reference.cx / (relative ? screen.width / 100 : scale),
    referenceY: reference.cy / (relative ? screen.height / 100 : scale),
    diameter: feedback.width / (relative ? Math.min(reference.width, reference.height) / 100 : scale),
    offsetX: offset.x / (relative ? reference.width / 100 : scale),
    offsetY: offset.y / (relative ? reference.height / 100 : scale),
    gap: gap / (relative ? Math.min(reference.width, reference.height) / 100 : scale),
  };
  const checked = resolveScreenLayoutDraft(next);
  return checked.geometry ? { ok: true, draft: next, issues: [] } : { ok: false, draft, issues: checked.issues };
}

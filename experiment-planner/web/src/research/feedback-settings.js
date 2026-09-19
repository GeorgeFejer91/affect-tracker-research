import { validateFeedbackContributionV1 } from "./feedback-contribution.js";

export const FEEDBACK_SETTINGS_SCHEMA = "affect-research-feedback";
export const FEEDBACK_SETTINGS_VERSION = 2;

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} requires exactly ${keys.join(", ")}.`);
  }
}
function choice(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`${label} must be ${choices.join(" or ")}.`);
  return value;
}
function number(value, min, max, label, integer = false) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${label} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
  }
  return value;
}
function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a Boolean.`);
  return value;
}
function labels(value, label) {
  const keys = ["up", "right", "down", "left"];
  exact(value, keys, label);
  return Object.freeze(Object.fromEntries(keys.map(key => {
    const text = value[key];
    if (typeof text !== "string" || text.length < 1 || text.length > 48 || !text.isWellFormed()
      || text !== text.trim() || /[\u0000-\u001f\u007f]/u.test(text)) {
      throw new TypeError(`${label}.${key} requires 1–48 display characters without control characters.`);
    }
    return [key, text];
  })));
}

/** Closed successor authoring contract. No defaults, clamping or v1 reinterpretation. */
export function validateFeedbackContributionV2(value) {
  exact(value, ["schema", "version", "input", "visual", "mappings", "presentation", "response"], "Feedback settings");
  if (value.schema !== FEEDBACK_SETTINGS_SCHEMA || value.version !== FEEDBACK_SETTINGS_VERSION) {
    throw new TypeError("Unsupported feedback settings schema or version.");
  }
  const retained = validateFeedbackContributionV1({ input: value.input, visual: value.visual, mappings: value.mappings });
  const p = value.presentation, r = value.response;
  exact(p, ["renderer", "colorAnchors", "labels", "halo"], "Feedback presentation");
  exact(p.labels, ["axes", "corners"], "Feedback labels");
  exact(p.halo, ["widthPercent", "gradient", "steepness"], "Feedback halo");
  exact(r, ["mode", "grid", "fullSpanDurationMs", "holdRule", "repeatDelayMs"], "Feedback response");
  exact(r.grid, ["columns", "rows"], "Response grid");
  const columns = number(r.grid.columns, 3, 2001, "Grid columns", true);
  const rows = number(r.grid.rows, 3, 2001, "Grid rows", true);
  if (columns % 2 !== 1 || rows % 2 !== 1) throw new RangeError("Response grid dimensions must be odd.");
  return Object.freeze({
    schema: FEEDBACK_SETTINGS_SCHEMA, version: FEEDBACK_SETTINGS_VERSION, ...retained,
    presentation: Object.freeze({
      renderer: choice(p.renderer, ["flubber", "grid", "procedural-face"], "Feedback renderer"),
      colorAnchors: choice(p.colorAnchors, ["axes", "corners"], "Color anchor placement"),
      labels: Object.freeze({ axes: labels(p.labels.axes, "Axis labels"), corners: labels(p.labels.corners, "Corner labels") }),
      halo: Object.freeze({ widthPercent: number(p.halo.widthPercent, 0, 10000, "Halo width (%)"),
        gradient: boolean(p.halo.gradient, "Halo gradient"), steepness: number(p.halo.steepness, 0.1, 10, "Halo steepness") }),
    }),
    response: Object.freeze({ mode: choice(r.mode, ["continuous", "stepwise"], "Response mode"),
      grid: Object.freeze({ columns, rows }),
      fullSpanDurationMs: number(r.fullSpanDurationMs, 250, 15000, "Full-span duration (ms)", true),
      holdRule: choice(r.holdRule, ["separatePresses", "repeatWhileHeld"], "Hold rule"),
      repeatDelayMs: number(r.repeatDelayMs, 500, 5000, "Repeat interval (ms)", true),
    }),
  });
}

export function validateFeedbackContribution(value) {
  return value && (Object.hasOwn(value, "schema") || Object.hasOwn(value, "version"))
    ? validateFeedbackContributionV2(value) : validateFeedbackContributionV1(value);
}

/** Explicit NEW-authoring initialization, never called by a V2 reader. */
export function createFeedbackAuthoringSettingsV2(legacy) {
  return validateFeedbackContributionV2({ schema: FEEDBACK_SETTINGS_SCHEMA, version: FEEDBACK_SETTINGS_VERSION,
    ...validateFeedbackContributionV1(legacy),
    presentation: { renderer: "flubber", colorAnchors: "axes", labels: {
      axes: { up: "High arousal", right: "Positive valence", down: "Low arousal", left: "Negative valence" },
      corners: { up: "Upper left", right: "Upper right", down: "Lower right", left: "Lower left" },
    }, halo: { widthPercent: 150, gradient: true, steepness: 1 } },
    response: { mode: "stepwise", grid: { columns: 21, rows: 21 }, fullSpanDurationMs: 2000,
      holdRule: "separatePresses", repeatDelayMs: 500 },
  });
}

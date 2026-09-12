import { canonicalJson } from "./canonical.js";
import { createInputBindingPreset, INPUT_PRESETS, INPUT_PRESET_IDS, validateInputBindingV1 } from "./contracts.js";
import { FLUBBER_MAPPING_SPECS, MAPPING_DRIVERS } from "./mappings.js";
import { createFeedbackAuthoringSettingsV2, validateFeedbackContribution } from "./feedback-settings.js";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Also protect direct owner callers. The wire gateway retains its own limits.
function detached(value, depth = 0) {
  if (depth > 16) throw new TypeError("P5 draft nesting is too deep.");
  if (value === null || ["boolean", "string"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("P5 drafts require plain finite JSON objects.");
  }
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
      || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("P5 drafts contain an unsupported property.");
    }
    output[key] = detached(descriptor.value, depth + 1);
  }
  return output;
}

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} requires exactly ${keys.join(", ")}.`);
  }
}

const definition = (path, type, label, extra = {}) => ({ id: `P5.${path}`, type,
  classification: "authored", writable: true, label, ...extra });
const number = (path, label, minimum, maximum, extra = {}) => definition(path, "number", label, { minimum, maximum, ...extra });
const boolean = (path, label, extra) => definition(path, "boolean", label, extra);
const choice = (path, label, values) => definition(path, "string", label, { enum: values });
const compatibility = { classification: "compatibility", description: "Retained legacy value; V2 response and P4/P6 geometry remain authoritative." };

export const P5_AUTHORING_SETTINGS = freeze([
  definition("generation", "integer", "Feedback generation", { classification: "derived", writable: false }),
  definition("contribution", "json", "Validated feedback contribution", { classification: "derived", writable: false,
    description: "Complete canonical P5 contribution, or null while the current owner draft is invalid." }),
  definition("input", "json", "Controller bindings", {
    description: "Exact InputBindingV1: schema, version, preset, kind, stepSize, directions, axes. Digital directions are unique keyboard(code), mouseButton(button), wheel(direction), or gamepadButton(button) tokens; axes=null. Absolute/analog presets use exact pointerAxis(axis,invert) or gamepadAxis(index,invert) pairs, with stepSize/directions=null. Custom capture is digital only. No live capture or input-test state." }),
  definition("input.stepSize", "json", "Legacy digital step", { ...compatibility,
    description: "Finite number 0.001–1 for digital input; null for absolute/analog input. Inactive compatibility value in V2." }),
  boolean("visual.gridEnabled", "Legacy Grid visibility", compatibility),
  boolean("visual.flubberEnabled", "Legacy Flubber visibility", compatibility),
  number("visual.sizePercent", "Legacy size (%)", 5, 100, compatibility),
  number("visual.overlayPosition.x", "Legacy horizontal position", 0, 1, compatibility),
  number("visual.overlayPosition.y", "Legacy vertical position", 0, 1, compatibility),
  boolean("visual.lockPosition", "Legacy position lock", compatibility),
  number("visual.transparency", "Transparency (fraction)", 0, 1),
  boolean("visual.hideFeedback", "Hide visual feedback"),
  boolean("visual.flubber.showOutline", "Flubber outline"),
  number("visual.flubber.outlineThickness", "Flubber outline (CSS px)", 0, 20),
  boolean("visual.flubber.showHalo", "Flubber halo"),
  number("visual.grid.lineThickness", "Grid line (CSS px)", 0.25, 20),
  boolean("visual.grid.showOutline", "Grid outline"),
  number("visual.grid.outlineThickness", "Grid outline (CSS px)", 0, 20),
  number("visual.grid.cursorSize", "Grid cursor radius (viewBox units)", 2, 100),
  ...["up", "down", "left", "right", "idle", "outline", "halo", "cursor"].map(name =>
    definition(`visual.colors.${name}`, "string", `${name} color`, { pattern: "^#[0-9a-fA-F]{6}$", maxLength: 7 })),
  choice("presentation.renderer", "Feedback renderer", ["flubber", "grid", "procedural-face"]),
  choice("presentation.colorAnchors", "Color anchor placement", ["axes", "corners"]),
  ...["axes", "corners"].flatMap(mode => ["up", "right", "down", "left"].map(direction =>
    definition(`presentation.labels.${mode}.${direction}`, "string", `${mode} ${direction} label`,
      { maxLength: 48, description: "1–48 UTF-16 units, well-formed Unicode, no control characters or surrounding whitespace." }))),
  number("presentation.halo.widthPercent", "Halo width (%)", 0, 10000),
  boolean("presentation.halo.gradient", "Outward halo gradient"),
  number("presentation.halo.steepness", "Halo falloff exponent", 0.1, 10),
  choice("response.mode", "Response mode", ["continuous", "stepwise"]),
  ...["columns", "rows"].map(axis => number(`response.grid.${axis}`, `Response grid ${axis}`, 3, 2001,
    { type: "integer", description: "Odd count; even drafts remain incomplete until repaired." })),
  number("response.fullSpanDurationMs", "Full-span duration (ms)", 250, 15000, { type: "integer" }),
  choice("response.holdRule", "Held direction behavior", ["separatePresses", "repeatWhileHeld"]),
  number("response.repeatDelayMs", "Repeat interval (ms)", 500, 5000, { type: "integer" }),
  ...Object.entries(FLUBBER_MAPPING_SPECS).flatMap(([id, spec]) => [
    number(`mappings.${id}.min`, `${spec.label} minimum${spec.unit ? ` (${spec.unit})` : ""}`, spec.allowedMin, spec.allowedMax),
    number(`mappings.${id}.max`, `${spec.label} maximum${spec.unit ? ` (${spec.unit})` : ""}`, spec.allowedMin, spec.allowedMax),
    choice(`mappings.${id}.drivenBy`, `${spec.label} driver`, [...MAPPING_DRIVERS]),
    boolean(`mappings.${id}.reverse`, `${spec.label} reverse`),
  ]),
]);

export const P5_AUTHORING_OPERATIONS = freeze([
  { id: "inputPreset", label: "Select controller preset", arguments: { type: "object", additionalProperties: false,
    required: ["preset", "stepSize"], properties: { preset: { type: "string", enum: [...INPUT_PRESET_IDS] },
      stepSize: { anyOf: [{ type: "number", minimum: 0.001, maximum: 1 }, { type: "null" }],
        description: "Explicit digital compatibility step 0.001–1, or null for absolute/analog presets." } } } },
  { id: "initializeV2", label: "Explicitly initialize current feedback settings from legacy", arguments: {
    type: "object", additionalProperties: false, properties: {} } },
]);

const registered = new Map(P5_AUTHORING_SETTINGS.map(setting => [setting.id, setting]));
const at = (value, path) => path.reduce((object, key) => object?.[key], value);
const pathOf = setting => setting.id.slice(3).split(".");
const isV2 = value => Object.hasOwn(value, "version") || Object.hasOwn(value, "schema");
const v2Only = setting => /^(P5\.presentation\.|P5\.response\.)/u.test(setting.id);

function checkValue(setting, value) {
  if (setting.id === "P5.input") { validateInputBindingV1(value); return; }
  if (setting.id === "P5.input.stepSize") {
    if (value === null || (Number.isFinite(value) && value >= 0.001 && value <= 1)) return;
    throw new TypeError("Digital step must be 0.001–1 or null for nondigital input.");
  }
  if (setting.type === "integer" ? !Number.isSafeInteger(value)
    : setting.type === "number" ? !Number.isFinite(value) : typeof value !== setting.type) {
    throw new TypeError(`${setting.label} requires ${setting.type}.`);
  }
  if (typeof value === "number" && (value < setting.minimum || value > setting.maximum)) {
    throw new RangeError(`${setting.label} must be ${setting.minimum}–${setting.maximum}.`);
  }
  if (setting.enum && !setting.enum.includes(value)) throw new TypeError(`${setting.label} has an unsupported value.`);
  if (setting.pattern && !new RegExp(setting.pattern, "u").test(value)) throw new TypeError(`${setting.label} requires a six-digit hex color.`);
  if (setting.id.startsWith("P5.presentation.labels.") && (value.length < 1 || value.length > 48
    || !value.isWellFormed() || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value))) {
    throw new TypeError(`${setting.label} requires 1–48 well-formed display units without control characters or surrounding whitespace.`);
  }
}

function inspect(draft) {
  const issues = [];
  const issue = (field, message) => issues.push({ owner: "P5", field, code: "invalid_feedback", message });
  const values = { "P5.generation": isV2(draft) ? draft.version ?? null : 1 };
  for (const setting of P5_AUTHORING_SETTINGS.filter(entry => entry.writable)) {
    if (!isV2(draft) && v2Only(setting)) { values[setting.id] = null; continue; }
    const value = at(draft, pathOf(setting));
    values[setting.id] = value === undefined ? null : detached(value);
    try { checkValue(setting, value); } catch (error) { issue(setting.id, error.message); }
  }
  for (const id of Object.keys(FLUBBER_MAPPING_SPECS)) {
    const mapping = draft.mappings?.[id];
    if (Number.isFinite(mapping?.min) && Number.isFinite(mapping?.max) && mapping.min > mapping.max) {
      issue(`P5.mappings.${id}.min`, "Mapping minimum must not exceed its maximum.");
    }
  }
  if (isV2(draft)) for (const axis of ["columns", "rows"]) {
    const count = draft.response?.grid?.[axis];
    if (Number.isInteger(count) && count % 2 !== 1) issue(`P5.response.grid.${axis}`, "Response grid dimensions must be odd.");
  }
  let contribution = null;
  try { contribution = validateFeedbackContribution(draft); }
  catch (error) { if (!issues.length) issue("P5.contribution", error.message); }
  values["P5.contribution"] = contribution;
  return { values, issues };
}

function current(context) {
  if (context.signal?.aborted || !context.isCurrent()) {
    const error = new Error("P5 staging was canceled or superseded.");
    error.code = context.signal?.aborted ? "canceled" : "stale_revision";
    throw error;
  }
}

/** Adapter only: readDraft and prepareCommit belong to the existing P5 editor.
 * prepareCommit must not mutate; its commit is synchronous and cannot fail.
 * The shared session must check its revision/lifetime immediately before commit.
 */
export function createPlannerAuthoringP5({ readDraft, prepareCommit }) {
  if (typeof readDraft !== "function" || typeof prepareCommit !== "function") throw new TypeError("P5 owner draft hooks are required.");
  const read = () => inspect(detached(readDraft()));
  return Object.freeze({
    id: "P5", settings: P5_AUTHORING_SETTINGS, operations: P5_AUTHORING_OPERATIONS, read,
    validate: () => read().issues,
    async stage(edits, context) {
      if (typeof context?.isCurrent !== "function") throw new TypeError("P5 staging requires a current-operation guard.");
      current(context);
      if (!Array.isArray(edits) || edits.length < 1 || edits.length > 256) throw new TypeError("P5 staging requires 1–256 ordered edits.");
      let draft = detached(readDraft());
      const initial = canonicalJson(draft);
      for (const supplied of edits) {
        const edit = detached(supplied);
        if (edit.kind === "set") {
          exact(edit, ["kind", "field", "value"], "P5 field edit");
          const setting = registered.get(edit.field);
          if (!setting?.writable) throw new TypeError("P5 setting is unknown or read-only.");
          if (!isV2(draft) && v2Only(setting)) throw new TypeError("Explicitly initialize V2 before editing current feedback settings.");
          checkValue(setting, edit.value);
          const path = pathOf(setting), target = at(draft, path.slice(0, -1));
          if (!target || !Object.hasOwn(target, path.at(-1))) throw new TypeError("The current P5 owner draft is missing a required field.");
          target[path.at(-1)] = setting.id === "P5.input" ? detached(validateInputBindingV1(edit.value)) : edit.value;
        } else if (edit.kind === "operation") {
          exact(edit, ["kind", "owner", "operation", "arguments"], "P5 operation");
          if (edit.owner !== "P5") throw new TypeError("Operation belongs to another owner.");
          if (edit.operation === "inputPreset") {
            exact(edit.arguments, ["preset", "stepSize"], "Input preset arguments");
            const { preset, stepSize } = edit.arguments;
            if (!INPUT_PRESET_IDS.includes(preset) || (INPUT_PRESETS[preset].kind !== "digital" && stepSize !== null)) {
              throw new TypeError("Select a supported preset with an explicit matching step or null.");
            }
            draft.input = detached(createInputBindingPreset(preset, stepSize));
          } else if (edit.operation === "initializeV2") {
            exact(edit.arguments, [], "V2 initialization arguments");
            if (isV2(draft)) throw new TypeError("Current feedback settings are already initialized.");
            draft = detached(createFeedbackAuthoringSettingsV2(draft));
          } else throw new TypeError("Unsupported P5 operation.");
        } else throw new TypeError("Unsupported P5 edit.");
      }
      const { values, issues } = inspect(draft);
      // Canonicalize only valid candidates; incomplete drafts retain exact raw text.
      draft = freeze(detached(values["P5.contribution"] ?? draft));
      current(context);
      const prepared = await prepareCommit(draft, { contribution: values["P5.contribution"],
        issues: freeze(issues), isCurrent: context.isCurrent, signal: context.signal });
      current(context);
      if (canonicalJson(detached(readDraft())) !== initial) throw new Error("P5 owner changed during staging.");
      if (typeof prepared?.commit !== "function" || prepared.commit.constructor.name === "AsyncFunction") {
        throw new TypeError("P5 owner must prepare a synchronous commit.");
      }
      let committed = false;
      return Object.freeze({
        isCurrent() {
          try { return !committed && !context.signal?.aborted && context.isCurrent()
            && canonicalJson(detached(readDraft())) === initial && (prepared.isCurrent?.() ?? true); }
          catch { return false; }
        },
        commit() { if (!committed) { committed = true; prepared.commit(); } },
      });
    },
  });
}

import { MAPPING_FIELDS, UI_PRESET_IDS } from "./ui-contracts.js";
import { COLOR_FIELDS } from "./feedback-controls-view.js";

// Fixed owner controls, never selectors supplied by a command or another owner.
const numbers = {
  "visual.sizePercent": "visual-size", "visual.transparency": "visual-transparency",
  "visual.overlayPosition.x": "visual-position-x", "visual.overlayPosition.y": "visual-position-y",
  "visual.flubber.outlineThickness": "flubber-outline-thickness",
  "visual.grid.lineThickness": "grid-line-thickness", "visual.grid.outlineThickness": "grid-outline-thickness",
  "visual.grid.cursorSize": "grid-cursor-size", "presentation.halo.widthPercent": "preview-halo-size",
  "presentation.halo.steepness": "preview-halo-steepness", "response.fullSpanDurationMs": "preview-full-span-duration",
  "response.repeatDelayMs": "preview-repeat-delay",
};
const booleans = {
  "visual.gridEnabled": "visual-grid-visible", "visual.flubberEnabled": "visual-flubber-visible",
  "visual.hideFeedback": "visual-hide-feedback", "visual.lockPosition": "visual-lock-position",
  "visual.flubber.showOutline": "flubber-outline-visible", "visual.flubber.showHalo": "flubber-halo-visible",
  "visual.grid.showOutline": "grid-outline-visible", "presentation.halo.gradient": "preview-halo-gradient",
};
const radios = { previewColorAnchors: ["axes", "corners"], previewGridSizing: ["square", "custom"],
  previewHoldRule: ["separatePresses", "repeatWhileHeld"] };
const at = (object, path) => path.split(".").reduce((value, key) => value[key], object);
const put = (object, path, value) => {
  const keys = path.split("."), key = keys.pop();
  keys.reduce((item, name) => item[name], object)[key] = value;
};
const numeric = raw => raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
const color = raw => /^#[0-9a-f]{6}$/iu.test(raw.trim()) ? raw.trim().toLowerCase() : raw;
const v2 = path => path.startsWith("presentation.") || path.startsWith("response.");

/** Projection seam for the existing app closure. No mutable draft is stored here.
 * commitModel must only install the supplied, already detached model values.
 * onProjection is synchronous and must not reset inspection/RNG or call native IPC.
 */
export function createPlannerAuthoringP5Controls({ root, getModel, commitModel, onProjection, isCurrent = () => true }) {
  if (!root?.querySelector || [getModel, commitModel, onProjection, isCurrent].some(hook => typeof hook !== "function")) {
    throw new TypeError("P5 controls require the root and synchronous owner hooks.");
  }
  if ([commitModel, onProjection].some(hook => hook.constructor.name === "AsyncFunction")) {
    throw new TypeError("P5 commit/projection hooks must be synchronous.");
  }
  function locate() {
    const controls = new Map();
    const find = selector => {
      const control = root.querySelector(selector);
      if (!control || !control.isConnected || typeof control.value !== "string" || typeof control.cloneNode !== "function") {
        throw new TypeError(`P5 control is unavailable: ${selector}`);
      }
      controls.set(selector, control);
      return control;
    };
    for (const id of [...Object.values(numbers), ...Object.values(booleans), "input-preset", "input-step-size",
      "preview-tile-count", "preview-tile-columns", "preview-tile-rows"]) find(`#${id}`);
    for (const { id } of COLOR_FIELDS) { find(`#color-${id}`); find(`#color-${id}-hex`); }
    for (const spec of MAPPING_FIELDS) for (const part of ["min", "max", "driver", "reverse"]) {
      find(`[data-mapping="${spec.id}"] [data-mapping-${part}]`);
    }
    for (const [name, values] of Object.entries(radios)) for (const value of values) find(`input[name="${name}"][value="${value}"]`);
    return { controls, id: id => controls.get(`#${id}`), mapping: (spec, part) => controls.get(`[data-mapping="${spec.id}"] [data-mapping-${part}]`),
      radio: (name, value) => controls.get(`input[name="${name}"][value="${value}"]`) };
  }
  function readDraft() {
    const controls = locate(), model = getModel();
    const selected = name => radios[name].filter(value => controls.radio(name, value).checked);
    const selection = name => { const values = selected(name); return values.length === 1 ? values[0] : ""; };
    const input = structuredClone(model.inputBinding);
    if (input.kind === "digital") input.stepSize = numeric(controls.id("input-step-size").value);
    const preset = controls.id("input-preset").value;
    if (preset !== (UI_PRESET_IDS[input.preset] ?? "custom")) {
      // Preserve the inconsistent UI selection visibly as an invalid preset.
      input.preset = `mismatched-ui-preset:${preset}`;
    }
    const draft = { input, visual: { overlayPosition: {}, flubber: {}, grid: {}, colors: {} }, mappings: {} };
    if (model.feedbackSettingsVersion === 2) Object.assign(draft, { schema: "affect-research-feedback", version: 2,
      presentation: { renderer: model.feedbackPreviewMode === "face" ? "procedural-face" : model.feedbackPreviewMode,
        colorAnchors: selection("previewColorAnchors"), labels: { axes: Object.fromEntries(model.previewAxisLabels),
          corners: Object.fromEntries(model.previewCornerLabels) }, halo: {} },
      response: { mode: model.responsePreviewMode, grid: {}, holdRule: selection("previewHoldRule") } });
    for (const [path, id] of Object.entries(numbers)) {
      if (v2(path) && model.feedbackSettingsVersion !== 2) continue;
      let value = numeric(controls.id(id).value);
      if (path === "visual.transparency") value = model.restoredTransparency?.raw === controls.id(id).value
        ? model.restoredTransparency.value : typeof value === "number" ? value / 100 : value;
      put(draft, path, value);
    }
    for (const [path, id] of Object.entries(booleans)) {
      if (!v2(path) || model.feedbackSettingsVersion === 2) put(draft, path, controls.id(id).checked);
    }
    for (const { id } of COLOR_FIELDS) draft.visual.colors[id] = color(controls.id(`color-${id}-hex`).value);
    for (const spec of MAPPING_FIELDS) draft.mappings[spec.contractId] = {
      min: numeric(controls.mapping(spec, "min").value), max: numeric(controls.mapping(spec, "max").value),
      drivenBy: controls.mapping(spec, "driver").value, reverse: controls.mapping(spec, "reverse").checked,
    };
    if (model.feedbackSettingsVersion === 2) {
      const mode = selection("previewGridSizing"), steps = numeric(controls.id("preview-tile-count").value);
      for (const axis of ["columns", "rows"]) draft.response.grid[axis] = mode === "square"
        ? typeof steps === "number" ? 2 * steps + 1 : steps
        : mode === "custom" ? numeric(controls.id(`preview-tile-${axis}`).value) : "";
    }
    return draft;
  }
  function readDigitalStep() {
    // Exactly resetBindingsToPreset/numberValue semantics, including empty => 0.
    const value = Number(locate().id("input-step-size").value);
    return Math.max(0.001, Math.min(1, Number.isFinite(value) ? value : 0.1));
  }
  function prepareCommit(candidate, context) {
    if (!isCurrent() || !context.isCurrent() || context.signal?.aborted) throw new TypeError("P5 owner is no longer current.");
    const controls = locate(), previous = getModel(), draft = structuredClone(candidate), writes = [];
    const model = { feedbackSettingsVersion: draft.version === 2 ? 2 : 1, inputBinding: structuredClone(draft.input),
      feedbackPreviewMode: previous.feedbackPreviewMode, responsePreviewMode: previous.responsePreviewMode,
      previewAxisLabels: new Map(previous.previewAxisLabels), previewCornerLabels: new Map(previous.previewCornerLabels),
      restoredTransparency: previous.restoredTransparency ? { ...previous.restoredTransparency } : null };
    const write = (control, property, value, step) => {
      const probe = control.cloneNode(true);
      if (step !== undefined) probe.step = step;
      probe[property] = value;
      if (property === "value" && probe.value !== String(value)) {
        throw new TypeError(`P5 control cannot preserve the prepared value: ${control.id || control.name}`);
      }
      writes.push({ control, property, value, step });
      return probe[property];
    };
    const setValue = (id, value, step) => write(controls.id(id), "value", String(value), step);
    const select = (name, value) => radios[name].forEach(option => write(controls.radio(name, option), "checked", option === value));
    if (draft.input.preset === `mismatched-ui-preset:${controls.id("input-preset").value}`) {
      model.inputBinding = structuredClone(previous.inputBinding);
    } else setValue("input-preset", UI_PRESET_IDS[draft.input.preset] ?? (draft.input.preset === "custom" ? "custom" : ""));
    if (draft.input.kind === "digital") setValue("input-step-size", draft.input.stepSize);
    for (const [path, id] of Object.entries(numbers)) {
      if (v2(path) && model.feedbackSettingsVersion !== 2) continue;
      const value = at(draft, path), display = path === "visual.transparency" && typeof value === "number" ? value * 100 : value;
      const raw = setValue(id, display, controls.id(id).type === "range" ? id.endsWith("duration") || id === "preview-repeat-delay" ? "1" : "any" : undefined);
      if (path === "visual.transparency") model.restoredTransparency = typeof value === "number" ? { raw, value } : null;
    }
    for (const [path, id] of Object.entries(booleans)) {
      if (!v2(path) || model.feedbackSettingsVersion === 2) write(controls.id(id), "checked", at(draft, path));
    }
    for (const { id } of COLOR_FIELDS) {
      const value = draft.visual.colors[id];
      setValue(`color-${id}-hex`, value);
      // Invalid text remains authoritative; a type=color widget cannot hold it.
      if (/^#[0-9a-f]{6}$/u.test(value)) setValue(`color-${id}`, value);
    }
    for (const spec of MAPPING_FIELDS) {
      const mapping = draft.mappings[spec.contractId];
      for (const [part, key] of [["min", "min"], ["max", "max"], ["driver", "drivenBy"], ["reverse", "reverse"]]) {
        write(controls.mapping(spec, part), part === "reverse" ? "checked" : "value", part === "reverse" ? mapping[key] : String(mapping[key]));
      }
    }
    if (model.feedbackSettingsVersion === 2) {
      const { presentation, response } = draft;
      model.feedbackPreviewMode = presentation.renderer === "procedural-face" ? "face" : presentation.renderer;
      model.responsePreviewMode = response.mode;
      model.previewAxisLabels = new Map(Object.entries(presentation.labels.axes));
      model.previewCornerLabels = new Map(Object.entries(presentation.labels.corners));
      select("previewColorAnchors", presentation.colorAnchors);
      select("previewHoldRule", response.holdRule);
      const { columns, rows } = response.grid;
      const square = Number.isInteger(columns) && columns >= 3 && columns <= 2001 && columns % 2 === 1 && columns === rows;
      select("previewGridSizing", square ? "square" : "custom");
      setValue("preview-tile-columns", columns); setValue("preview-tile-rows", rows);
      if (square) setValue("preview-tile-count", (columns - 1) / 2);
    }
    const projection = structuredClone({ contribution: context.contribution, issues: context.issues });
    let committed = false, projected = false;
    return Object.freeze({
      isCurrent: () => !committed && isCurrent() && context.isCurrent() && !context.signal?.aborted
        && [...controls.controls].every(([selector, control]) => control.isConnected && root.querySelector(selector) === control),
      commit() {
        if (committed) return;
        committed = true;
        for (const { control, property, value, step } of writes) {
          if (step !== undefined) control.step = step;
          control[property] = value;
        }
        commitModel(model);
      },
      afterCommit() { if (committed && !projected) { projected = true; onProjection(projection); } },
    });
  }
  return Object.freeze({ readDraft, readDigitalStep, prepareCommit });
}

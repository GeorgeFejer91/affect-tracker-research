import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPlannerAuthoringP5Controls } from "../site/src/research/planner-authoring-p5-controls.js";
import { createPlannerAuthoringP5 } from "../site/src/research/planner-authoring-p5.js";
import { createInputBindingPreset } from "../site/src/research/contracts.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/research-feedback-settings-v2.json", import.meta.url)));
const context = () => ({ isCurrent: () => true, contribution: null, issues: [] });
const set = (field, value) => ({ kind: "set", field: `P5.${field}`, value });

// Minimal control interface double: these tests prove owner projection semantics,
// not browser sanitization, rendered visibility, physical input or app wiring.
function editor() {
  const nodes = new Map(); let stopped = false, commits = 0, projections = 0;
  const node = selector => ({ id: selector, value: "", checked: false, isConnected: true, type: "number",
    cloneNode() { return { ...this }; } });
  const root = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, node(selector));
    return nodes.get(selector);
  } };
  let model = { feedbackSettingsVersion: 2, inputBinding: fixture().input, feedbackPreviewMode: "flubber",
    responsePreviewMode: "continuous", previewAxisLabels: new Map(), previewCornerLabels: new Map(), restoredTransparency: null };
  let projected;
  const hooks = createPlannerAuthoringP5Controls({ root, getModel: () => model, isCurrent: () => !stopped,
    commitModel(next) { commits++; model = next; }, onProjection(value) { projections++; projected = value; } });
  const install = value => { const stage = hooks.prepareCommit(value, { ...context(), contribution: value }); stage.commit(); stage.afterCommit(); };
  install(fixture()); commits = 0; projections = 0;
  return { hooks, adapter: createPlannerAuthoringP5(hooks), q: selector => root.querySelector(selector), nodes,
    install, stop: () => { stopped = true; }, get model() { return model; },
    get commits() { return commits; }, get projections() { return projections; }, get projected() { return projected; } };
}

test("P5 fixed controls read the complete detached saved state without publication", () => {
  const state = editor();
  assert.deepEqual(state.hooks.readDraft(), fixture());
  const detached = state.hooks.readDraft(); detached.input.directions.up.code = "KeyQ";
  detached.presentation.labels.axes.up = "Changed outside owner";
  assert.deepEqual(state.hooks.readDraft(), fixture());
  assert.equal(state.commits, 0); assert.equal(state.projections, 0);
});

test("raw invalid fields and preset mismatch survive an unrelated typed edit", async () => {
  const state = editor();
  state.q("#preview-halo-size").value = "";
  state.q('[data-mapping="edge-smoothness"] [data-mapping-min]').value = "bad numeric text";
  state.q("#color-idle-hex").value = "bad color";
  state.q("#input-preset").value = "wasd";
  const before = state.hooks.readDraft();
  assert.equal(before.presentation.halo.widthPercent, "");
  assert.equal(before.mappings.edgeSmoothness.min, "bad numeric text");
  assert.equal(before.input.preset, "mismatched-ui-preset:wasd");
  const stage = await state.adapter.stage([set("visual.hideFeedback", true)], context());
  assert.deepEqual(state.hooks.readDraft(), before);
  stage.commit();
  assert.deepEqual(state.hooks.readDraft(), { ...before, visual: { ...before.visual, hideFeedback: true } });
  assert.equal(state.projections, 0);
  stage.afterCommit(); stage.afterCommit();
  assert.equal(state.projections, 1); assert.equal(state.projected.contribution, null);
  assert.ok(state.projected.issues.length >= 3);
});

test("precision, renderer models and inactive alternatives publish before observers", async () => {
  const state = editor();
  const stage = await state.adapter.stage([set("visual.transparency", 0.1234567890123456),
    set("presentation.renderer", "procedural-face"), set("presentation.labels.axes.up", "Quiet label"),
    set("presentation.halo.gradient", false), set("presentation.halo.steepness", 3.789),
    set("response.fullSpanDurationMs", 4321)], context());
  assert.deepEqual(state.hooks.readDraft(), fixture());
  stage.commit(); stage.commit();
  assert.equal(state.commits, 1); assert.equal(state.projections, 0);
  assert.equal(state.model.feedbackPreviewMode, "face");
  assert.equal(state.hooks.readDraft().visual.transparency, 0.1234567890123456);
  stage.afterCommit();
  assert.deepEqual(state.hooks.readDraft(), state.projected.contribution);
  state.q("#visual-transparency").value = "31";
  assert.equal(state.hooks.readDraft().visual.transparency, 0.31);
});

test("even/incomplete grids remain custom; valid square projection preserves odd count", async () => {
  const state = editor();
  let stage = await state.adapter.stage([set("response.grid.columns", 8), set("response.grid.rows", 8)], context());
  stage.commit(); stage.afterCommit();
  assert.equal(state.q('input[name="previewGridSizing"][value="custom"]').checked, true);
  assert.deepEqual(state.hooks.readDraft().response.grid, { columns: 8, rows: 8 });
  assert.equal(state.projected.contribution, null);
  stage = await state.adapter.stage([set("response.grid.columns", 9), set("response.grid.rows", 9)], context());
  stage.commit(); stage.afterCommit();
  assert.equal(state.q('input[name="previewGridSizing"][value="square"]').checked, true);
  assert.equal(state.q("#preview-tile-count").value, "4");
  assert.deepEqual(state.hooks.readDraft().response.grid, { columns: 9, rows: 9 });
  state.q("#preview-tile-count").value = "";
  assert.deepEqual(state.hooks.readDraft().response.grid, { columns: "", rows: "" });
});

test("analog transitions retain the editor's digital step, with exact existing normalization", async () => {
  const state = editor();
  state.install({ ...fixture(), input: createInputBindingPreset("arrowKeys", 0.345) });
  for (const preset of ["pointerGrid", "gamepadLeftStick", "wasd"]) {
    const stage = await state.adapter.stage([{ kind: "operation", owner: "P5", operation: "inputPreset", arguments: { preset } }], context());
    stage.commit(); stage.afterCommit();
    assert.equal(state.hooks.readDigitalStep(), 0.345);
    assert.equal(state.q("#input-step-size").value, "0.345");
    assert.deepEqual(state.hooks.readDraft().input, createInputBindingPreset(preset, 0.345));
  }
  for (const [raw, expected] of [["", 0.001], ["invalid", 0.1], ["9", 1], ["-1", 0.001]]) {
    state.q("#input-step-size").value = raw;
    assert.equal(state.hooks.readDigitalStep(), expected);
  }
});

test("legacy read is exact and explicit initialization installs complete current state", async () => {
  const state = editor(), { input, visual, mappings } = fixture();
  state.install({ input, visual, mappings });
  assert.deepEqual(state.hooks.readDraft(), { input, visual, mappings });
  const stage = await state.adapter.stage([{ kind: "operation", owner: "P5", operation: "initializeV2", arguments: {} }], context());
  stage.commit(); stage.afterCommit();
  assert.equal(state.hooks.readDraft().version, 2);
  assert.deepEqual(state.hooks.readDraft(), state.projected.contribution);
});

test("missing/replaced controls, lifetime and unrepresentable values fail before mutation", async () => {
  const state = editor(), before = state.hooks.readDraft();
  const stage = await state.adapter.stage([set("visual.hideFeedback", true)], context());
  state.nodes.set("#visual-hide-feedback", { ...state.q("#visual-hide-feedback") });
  assert.equal(stage.isCurrent(), false);
  assert.deepEqual(state.hooks.readDraft(), before);
  state.q("#grid-cursor-size").isConnected = false;
  assert.throws(() => state.hooks.prepareCommit(fixture(), context()), /unavailable/u);
  state.q("#grid-cursor-size").isConnected = true;
  state.q("#visual-transparency").cloneNode = () => ({ set value(_value) {}, get value() { return "sanitized"; } });
  assert.throws(() => state.hooks.prepareCommit(fixture(), context()), /cannot preserve/u);
  assert.equal(state.commits, 0);
  state.stop(); assert.throws(() => state.hooks.prepareCommit(fixture(), context()), /no longer current/u);
});

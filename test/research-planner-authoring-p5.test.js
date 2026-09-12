import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createInputBindingPreset, INPUT_PRESET_IDS } from "../site/src/research/contracts.js";
import { createPlannerAuthoringP5, P5_AUTHORING_SETTINGS } from "../site/src/research/planner-authoring-p5.js";
import { validateFeedbackContribution } from "../site/src/research/feedback-settings.js";
import { resolveFeedbackEnvelope } from "../site/src/research/feedback-layout.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/research-feedback-settings-v2.json", import.meta.url), "utf8"));
const set = (field, value) => ({ kind: "set", field, value });
const operation = (operation, args) => ({ kind: "operation", owner: "P5", operation, arguments: args });
const guard = () => ({ isCurrent: () => true, signal: new AbortController().signal });
const at = (object, path) => path.split(".").reduce((value, key) => value[key], object);

function owner(initial = fixture(), prepare = null) {
  let draft = structuredClone(initial), commits = 0, preparations = 0, preparedContext;
  const adapter = createPlannerAuthoringP5({
    readDraft: () => draft,
    async prepareCommit(candidate, context) {
      preparations++; preparedContext = context;
      if (prepare) await prepare(candidate, context);
      return { commit() { draft = structuredClone(candidate); commits++; } };
    },
  });
  return { adapter, get draft() { return draft; }, replace: value => { draft = value; },
    get commits() { return commits; }, get preparations() { return preparations; }, get preparedContext() { return preparedContext; } };
}

function alternative(setting, old) {
  if (setting.id === "P5.input") return createInputBindingPreset("wasd", 0.2);
  if (setting.id === "P5.input.stepSize") return old === 0.123 ? 0.234 : 0.123;
  if (setting.enum) return setting.enum.find(value => value !== old);
  if (setting.type === "boolean") return !old;
  if (setting.pattern) return old === "#123abc" ? "#456def" : "#123abc";
  if (setting.type === "string") return "Authored label";
  if (setting.id.endsWith(".columns") || setting.id.endsWith(".rows")) return old === 33 ? 35 : 33;
  // Remain compatible with the other bound while changing every mapping field.
  if (setting.id.startsWith("P5.mappings.") && setting.id.endsWith(".min")) return old === 0 ? 0.05 : 0;
  if (setting.id.startsWith("P5.mappings.") && setting.id.endsWith(".max")) return old === setting.maximum ? setting.maximum - 0.01 : setting.maximum;
  return old === setting.minimum ? setting.maximum : setting.minimum;
}

test("P5 catalogue covers every saved leaf, with typed classifications and no transient authority", () => {
  const state = owner(), { adapter } = state;
  const fields = adapter.settings.map(setting => setting.id);
  assert.equal(new Set(fields).size, fields.length);
  assert.equal(adapter.id, "P5");
  assert.ok(Object.isFrozen(adapter.settings) && Object.isFrozen(adapter.settings[0]));
  function covered(value, prefix = "P5") {
    for (const [key, child] of Object.entries(value)) {
      if (prefix === "P5" && ["schema", "version"].includes(key)) continue;
      const path = `${prefix}.${key}`;
      if (fields.includes(path)) continue;
      assert.ok(child && typeof child === "object", `Missing saved field ${path}`);
      covered(child, path);
    }
  }
  covered(fixture());
  for (const setting of adapter.settings) {
    assert.ok(["authored", "derived", "compatibility"].includes(setting.classification));
    assert.ok(["boolean", "integer", "number", "string", "json"].includes(setting.type));
    if (setting.classification === "derived") assert.equal(setting.writable, false);
  }
  for (const name of ["previewX", "previewY", "held", "capture", "camera", "animationPhase", "acceptance"]) {
    assert.ok(fields.every(field => !field.includes(name)));
  }
  assert.equal(adapter.read().issues.length, 0);
  assert.equal(canonicalJson(adapter.read().values["P5.contribution"]), canonicalJson(fixture()));
  assert.equal(state.commits, 0);
});

test("every registered writable P5 field supports detached stage, commit and exact canonical readback", async () => {
  for (const setting of P5_AUTHORING_SETTINGS.filter(setting => setting.writable)) {
    const state = owner(), before = canonicalJson(state.draft);
    const value = alternative(setting, state.adapter.read().values[setting.id]);
    const candidate = await state.adapter.stage([set(setting.id, value)], guard());
    assert.equal(canonicalJson(state.draft), before, `${setting.id} staging mutated editor`);
    assert.equal(state.commits, 0);
    assert.equal(candidate.isCurrent(), true);
    assert.equal(state.preparedContext.issues.length, 0, setting.id);
    assert.ok(Object.isFrozen(state.preparedContext.issues));
    candidate.commit(); candidate.commit();
    assert.equal(state.commits, 1, "prepared commit is one-use");
    assert.equal(candidate.isCurrent(), false);
    assert.deepEqual(state.adapter.read().values[setting.id], value, setting.id);
    assert.equal(state.adapter.validate().length, 0, setting.id);
    assert.deepEqual(state.draft, validateFeedbackContribution(state.draft));
  }
});

test("one ordered batch preserves inactive renderers, axes/corners, timings and all mapping alternatives", async () => {
  const state = owner(), original = fixture();
  const candidate = await state.adapter.stage([
    set("P5.presentation.renderer", "flubber"), set("P5.visual.grid.cursorSize", 31.234),
    set("P5.presentation.labels.axes.left", "Unused axis label"),
    set("P5.presentation.labels.corners.left", "Unused corner label"),
    set("P5.response.mode", "continuous"), set("P5.response.repeatDelayMs", 1234),
    set("P5.presentation.halo.gradient", false), set("P5.presentation.halo.steepness", 3.71),
    set("P5.presentation.halo.widthPercent", 1200), set("P5.presentation.halo.widthPercent", 310.5),
    set("P5.presentation.renderer", "procedural-face"),
    set("P5.mappings.edgeSmoothness.min", 0.9), set("P5.mappings.edgeSmoothness.max", 0.95),
  ], guard());
  assert.equal(state.preparations, 1); assert.equal(state.commits, 0);
  candidate.commit();
  assert.equal(state.draft.presentation.renderer, "procedural-face");
  assert.equal(state.draft.presentation.halo.widthPercent, 310.5);
  assert.equal(state.draft.visual.grid.cursorSize, 31.234);
  assert.equal(state.draft.presentation.labels.axes.left, "Unused axis label");
  assert.equal(state.draft.presentation.labels.corners.left, "Unused corner label");
  assert.equal(state.draft.response.repeatDelayMs, 1234);
  assert.equal(state.draft.presentation.halo.steepness, 3.71);
  assert.deepEqual(state.draft.mappings.oscillationFrequency, original.mappings.oscillationFrequency);
  assert.equal(state.adapter.validate().length, 0);
  assert.deepEqual(resolveFeedbackEnvelope(state.draft, 1024), resolveFeedbackEnvelope(validateFeedbackContribution(state.draft), 1024));
});

test("invalid numeric editor text is reported exactly, and independent edits preserve it without last-valid export", async () => {
  const initial = fixture(); initial.response.fullSpanDurationMs = "unfinished 4e";
  initial.visual.grid.lineThickness = "";
  const state = owner(initial);
  const read = state.adapter.read();
  assert.equal(read.values["P5.response.fullSpanDurationMs"], "unfinished 4e");
  assert.equal(read.values["P5.visual.grid.lineThickness"], "");
  assert.equal(read.values["P5.contribution"], null);
  assert.deepEqual(read.issues.map(issue => issue.field).sort(), ["P5.response.fullSpanDurationMs", "P5.visual.grid.lineThickness"].sort());
  (await state.adapter.stage([set("P5.visual.hideFeedback", true)], guard())).commit();
  assert.equal(state.draft.response.fullSpanDurationMs, "unfinished 4e");
  assert.equal(state.draft.visual.grid.lineThickness, "");
  assert.equal(state.preparedContext.contribution, null);
  assert.equal(state.adapter.read().values["P5.contribution"], null);
  (await state.adapter.stage([set("P5.response.fullSpanDurationMs", 4321), set("P5.visual.grid.lineThickness", 3.75374)], guard())).commit();
  assert.equal(state.adapter.validate().length, 0);
  assert.equal(state.draft.visual.grid.lineThickness, 3.75374);
});

test("domain-incomplete even grids and reversed bounds remain visible and repairable drafts", async () => {
  const state = owner();
  (await state.adapter.stage([set("P5.response.grid.columns", 20),
    set("P5.mappings.saturation.min", 0.9), set("P5.mappings.saturation.max", 0.2)], guard())).commit();
  assert.equal(state.draft.response.grid.columns, 20);
  assert.equal(state.draft.mappings.saturation.min, 0.9);
  assert.equal(state.adapter.read().values["P5.contribution"], null);
  assert.deepEqual(state.adapter.validate().map(issue => issue.field).sort(),
    ["P5.response.grid.columns", "P5.mappings.saturation.min"].sort());
  (await state.adapter.stage([set("P5.response.grid.columns", 21), set("P5.mappings.saturation.max", 0.95)], guard())).commit();
  assert.equal(state.adapter.validate().length, 0);
});

test("all input presets and complete custom digital tokens use the unchanged input validator", async () => {
  const state = owner();
  for (const preset of INPUT_PRESET_IDS) {
    const binding = createInputBindingPreset(preset, 0.234);
    (await state.adapter.stage([operation("inputPreset", { preset, stepSize: binding.stepSize })], guard())).commit();
    assert.deepEqual(state.adapter.read().values["P5.input"], binding);
    assert.equal(state.adapter.read().values["P5.input.stepSize"], binding.stepSize);
  }
  const input = { ...createInputBindingPreset("arrowKeys", 0.345), preset: "custom", directions: {
    up: { kind: "keyboard", code: "KeyQ" }, down: { kind: "wheel", direction: "down" },
    left: { kind: "mouseButton", button: 5 }, right: { kind: "gamepadButton", button: 31 },
  } };
  (await state.adapter.stage([set("P5.input", input), set("P5.input.stepSize", 0.765)], guard())).commit();
  assert.deepEqual(state.draft.input, { ...input, stepSize: 0.765 });
  assert.equal(state.adapter.validate().length, 0);
});

test("legacy reads and edits retain exact generation; V2 conversion requires an explicit ordered operation", async () => {
  const full = fixture(), legacy = { input: full.input, visual: full.visual, mappings: full.mappings };
  const state = owner(legacy);
  assert.equal(state.adapter.read().values["P5.generation"], 1);
  assert.equal(state.adapter.read().values["P5.response.mode"], null);
  assert.deepEqual(state.adapter.read().values["P5.contribution"], legacy);
  await assert.rejects(state.adapter.stage([set("P5.response.mode", "continuous")], guard()), /initialize V2/u);
  (await state.adapter.stage([set("P5.visual.gridEnabled", false)], guard())).commit();
  assert.equal(Object.hasOwn(state.draft, "version"), false);
  (await state.adapter.stage([operation("initializeV2", {}), set("P5.response.mode", "continuous")], guard())).commit();
  assert.equal(state.draft.version, 2);
  assert.equal(state.draft.response.mode, "continuous");
  assert.equal(state.draft.visual.gridEnabled, false);
  await assert.rejects(state.adapter.stage([operation("initializeV2", {})], guard()), /already initialized/u);
});

test("malformed, nonfinite, unknown, read-only and unsupported edits reject the whole batch before preparation", async () => {
  const state = owner(), before = canonicalJson(state.draft);
  const bad = [set("P5.response.fullSpanDurationMs", "4000"), set("P5.response.fullSpanDurationMs", 4321.1),
    set("P5.response.fullSpanDurationMs", NaN), set("P5.response.fullSpanDurationMs", Infinity),
    set("P5.presentation.halo.widthPercent", 10001), set("P5.visual.hideFeedback", "true"),
    set("P5.visual.colors.up", "red"), set("P5.presentation.renderer", "photoatlas"),
    set("P5.presentation.labels.axes.up", "\ud800"), set("P5.presentation.labels.axes.up", "x".repeat(49)),
    set("P5.presentation.labels.axes.up", " x "), set("P5.generation", 1), set("P5.preview.x", 0.5),
    set("P5.input", { ...fixture().input, unknown: true }),
    set("P5.__proto__.x", "bad"), operation("inputPreset", { preset: "gamepadLeftStick", stepSize: 0.1 }),
    operation("inputPreset", { preset: "arrowKeys" }), operation("resetInspection", {}),
    { ...set("P5.visual.hideFeedback", false), extra: false }, { ...operation("initializeV2", {}), owner: "P4" }];
  const input = structuredClone(fixture().input); input.preset = "custom"; input.directions.left = input.directions.up;
  bad.push(set("P5.input", input));
  for (const edit of bad) {
    await assert.rejects(state.adapter.stage([set("P5.visual.hideFeedback", true), edit], guard()));
    assert.equal(canonicalJson(state.draft), before);
  }
  assert.equal(state.preparations, 0); assert.equal(state.commits, 0);
  await assert.rejects(state.adapter.stage([], guard()));
  await assert.rejects(state.adapter.stage([set("P5.visual.hideFeedback", true)], {}));
});

test("stale or canceled staging never commits and final guard detects owner drift after preparation", async () => {
  const state = owner();
  await assert.rejects(state.adapter.stage([set("P5.visual.hideFeedback", true)], { isCurrent: () => false }));
  assert.equal(state.preparations, 0);
  let release, current = true;
  const controller = new AbortController(), blocked = owner(fixture(), () => new Promise(resolve => { release = resolve; }));
  const pending = blocked.adapter.stage([set("P5.visual.hideFeedback", true)], { isCurrent: () => current, signal: controller.signal });
  controller.abort(); release();
  await assert.rejects(pending, /canceled or superseded/u); assert.equal(blocked.commits, 0);
  const staged = await state.adapter.stage([set("P5.visual.hideFeedback", true)], { isCurrent: () => current });
  current = false; assert.equal(staged.isCurrent(), false); assert.equal(state.commits, 0);
  current = true; state.draft.presentation.halo.widthPercent = 501;
  assert.equal(staged.isCurrent(), false); assert.equal(state.commits, 0);
});

test("async preparation catches dependency drift, detached inputs/readback cannot mutate live state", async () => {
  let release;
  const state = owner(fixture(), () => new Promise(resolve => { release = resolve; }));
  const edits = [set("P5.visual.hideFeedback", true)];
  const pending = state.adapter.stage(edits, guard()); edits[0].value = false;
  state.draft.response.fullSpanDurationMs = 5432; release();
  await assert.rejects(pending, /changed during staging/u);
  assert.equal(state.commits, 0); assert.equal(state.draft.visual.hideFeedback, false);
  const normal = owner(), read = normal.adapter.read();
  read.values["P5.input"].directions.up.code = "KeyZ";
  assert.notEqual(normal.draft.input.directions.up.code, "KeyZ");
  const candidate = await normal.adapter.stage([set("P5.visual.colors.up", "#ABCDEF")], guard());
  candidate.commit(); assert.equal(normal.draft.visual.colors.up, "#abcdef");
  assert.equal(at(normal.draft, "presentation.halo.widthPercent"), fixture().presentation.halo.widthPercent);
});

test("owner-supplied guard participates in final all-owner preflight and async commits are rejected", async () => {
  let alive = true;
  const draft = fixture();
  const adapter = createPlannerAuthoringP5({ readDraft: () => draft,
    prepareCommit: () => ({ isCurrent: () => alive, commit() {} }) });
  const candidate = await adapter.stage([set("P5.visual.hideFeedback", true)], guard());
  assert.equal(candidate.isCurrent(), true); alive = false; assert.equal(candidate.isCurrent(), false);
  const invalid = createPlannerAuthoringP5({ readDraft: () => draft, prepareCommit: () => ({ async commit() {} }) });
  await assert.rejects(invalid.stage([set("P5.visual.hideFeedback", true)], guard()), /synchronous commit/u);
});

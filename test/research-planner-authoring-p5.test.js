import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createInputBindingPreset, INPUT_PRESET_IDS } from "../site/src/research/contracts.js";
import { createPlannerAuthoringP5, P5_AUTHORING_SETTINGS } from "../site/src/research/planner-authoring-p5.js";
import { validateFeedbackContribution } from "../site/src/research/feedback-settings.js";
import { resolveFeedbackEnvelope } from "../site/src/research/feedback-layout.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { PLANNER_COMMAND_SCHEMA } from "../site/src/research/planner-authoring-contract.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/research-feedback-settings-v2.json", import.meta.url), "utf8"));
const set = (field, value) => ({ kind: "set", field, value });
const operation = (operation, args) => ({ kind: "operation", owner: "P5", operation, arguments: args });
const guard = () => ({ isCurrent: () => true, signal: new AbortController().signal });
const at = (object, path) => path.split(".").reduce((value, key) => value[key], object);

function owner(initial = fixture(), prepare = null) {
  let draft = structuredClone(initial), commits = 0, preparations = 0, preparedContext;
  const adapter = createPlannerAuthoringP5({
    readDraft: () => draft,
    readDigitalStep: () => initial.input.stepSize ?? 0.1,
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
  if (setting.id === "P5.input") return createInputBindingPreset("wasd", old.stepSize);
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
    const binding = createInputBindingPreset(preset, fixture().input.stepSize);
    (await state.adapter.stage([operation("inputPreset", { preset })], guard())).commit();
    assert.deepEqual(state.adapter.read().values["P5.input"], binding);
    assert.equal(state.adapter.read().values["P5.input.stepSize"], binding.stepSize);
  }
  const input = { ...createInputBindingPreset("arrowKeys", fixture().input.stepSize), preset: "custom", directions: {
    up: { kind: "keyboard", code: "KeyQ" }, down: { kind: "wheel", direction: "down" },
    left: { kind: "mouseButton", button: 5 }, right: { kind: "gamepadButton", button: 31 },
  } };
  (await state.adapter.stage([set("P5.input", input)], guard())).commit();
  assert.deepEqual(state.draft.input, input);
  assert.equal(state.adapter.validate().length, 0);
});

test("legacy stays read-only until V2 conversion through an explicit ordered operation", async () => {
  const full = fixture(), legacy = { input: full.input, visual: full.visual, mappings: full.mappings };
  const state = owner(legacy);
  assert.equal(state.adapter.read().values["P5.generation"], 1);
  assert.equal(state.adapter.read().values["P5.response.mode"], null);
  assert.deepEqual(state.adapter.read().values["P5.contribution"], legacy);
  await assert.rejects(state.adapter.stage([set("P5.response.mode", "continuous")], guard()), /initialize V2/u);
  await assert.rejects(state.adapter.stage([set("P5.visual.gridEnabled", false)], guard()), /read-only/u);
  await assert.rejects(state.adapter.stage([set("P5.visual.hideFeedback", true)], guard()), /initialize V2/u);
  assert.equal(Object.hasOwn(state.draft, "version"), false);
  (await state.adapter.stage([operation("initializeV2", {}), set("P5.response.mode", "continuous")], guard())).commit();
  assert.equal(state.draft.version, 2);
  assert.equal(state.draft.response.mode, "continuous");
  assert.equal(state.draft.visual.gridEnabled, legacy.visual.gridEnabled);
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
    operation("inputPreset", {}), operation("resetInspection", {}),
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
  const adapter = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => draft.input.stepSize,
    prepareCommit: () => ({ isCurrent: () => alive, commit() {} }) });
  const candidate = await adapter.stage([set("P5.visual.hideFeedback", true)], guard());
  assert.equal(candidate.isCurrent(), true); alive = false; assert.equal(candidate.isCurrent(), false);
  const invalid = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => draft.input.stepSize,
    prepareCommit: () => ({ async commit() {} }) });
  await assert.rejects(invalid.stage([set("P5.visual.hideFeedback", true)], guard()), /synchronous commit/u);
});

const request = (session, action, expectedRevision = null) => ({ schema: PLANNER_COMMAND_SCHEMA,
  version: 1, sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision, action });

test("the actual shared session dispatches catalogue and every writable P5 set/get with exact readback and retry", async () => {
  for (const setting of P5_AUTHORING_SETTINGS.filter(setting => setting.writable)) {
    const state = owner(), session = createPlannerAuthoringSession({ owners: [state.adapter] });
    const catalogue = await session.execute(request(session, { kind: "catalogue" }));
    assert.equal(catalogue.status, "ok");
    assert.deepEqual(catalogue.result.settings, P5_AUTHORING_SETTINGS);
    const before = await session.execute(request(session, { kind: "snapshot" }));
    assert.equal(before.status, "ok");
    assert.deepEqual(Object.keys(before.result.owners.P5.values).sort(), P5_AUTHORING_SETTINGS.map(field => field.id).sort());
    const value = alternative(setting, state.adapter.read().values[setting.id]);
    const edit = request(session, set(setting.id, value), 0);
    const result = await session.execute(edit);
    assert.equal(result.status, "applied", JSON.stringify({ field: setting.id, result }));
    assert.equal(result.revision, 1);
    const read = await session.execute(request(session, { kind: "get", field: setting.id }));
    assert.equal(read.status, "ok"); assert.deepEqual(read.result.value, value, setting.id);
    assert.deepEqual(await session.execute(edit), result);
    assert.equal(state.commits, 1);
    assert.equal(canonicalJson(state.adapter.read().values["P5.contribution"]), canonicalJson(validateFeedbackContribution(state.draft)));
    session.destroy();
  }
});

test("compatibility values are read-only, including whole-input and preset backdoors, and survive canonical readback", async () => {
  const state = owner(), before = canonicalJson(state.draft);
  const session = createPlannerAuthoringSession({ owners: [state.adapter] });
  const compatibility = state.adapter.settings.filter(setting => setting.classification === "compatibility");
  assert.equal(compatibility.length, 7);
  for (const setting of compatibility) {
    assert.equal(setting.writable, false);
    const result = await session.execute(request(session, set(setting.id, alternative(setting, state.adapter.read().values[setting.id])), 0));
    assert.equal(result.status, "rejected"); assert.equal(result.issues[0].code, "read_only");
  }
  const altered = { ...fixture().input, stepSize: fixture().input.stepSize === 0.7 ? 0.8 : 0.7 };
  const bypass = await session.execute(request(session, set("P5.input", altered), 0));
  assert.equal(bypass.status, "rejected"); assert.equal(bypass.issues[0].field, "P5.input.stepSize");
  assert.equal(bypass.issues[0].code, "read_only");
  const presetBypass = await session.execute(request(session, { kind: "apply", edits: [operation("inputPreset", { preset: "wasd", stepSize: 0.9 })] }, 0));
  assert.equal(presetBypass.status, "rejected");
  assert.equal(state.commits, 0); assert.equal(canonicalJson(state.draft), before);
  assert.equal(canonicalJson(state.adapter.read().values["P5.contribution"]), before);
  session.destroy();
});

test("shared session retains incomplete and GUI-invalid drafts, rejects stale CAS and commits no earlier owner on drift", async () => {
  const state = owner(), session = createPlannerAuthoringSession({ owners: [state.adapter] });
  const incomplete = await session.execute(request(session, set("P5.response.grid.columns", 22), 0));
  assert.equal(incomplete.status, "incomplete");
  assert.equal(state.adapter.read().values["P5.response.grid.columns"], 22);
  assert.equal(state.adapter.read().values["P5.contribution"], null);
  state.draft.response.fullSpanDurationMs = "invalid GUI text"; session.edited();
  const read = await session.execute(request(session, { kind: "get", field: "P5.response.fullSpanDurationMs" }));
  assert.equal(read.status, "ok"); assert.equal(read.result.value, "invalid GUI text");
  assert.ok(read.issues.some(issue => issue.field === "P5.response.fullSpanDurationMs"));
  const stale = await session.execute(request(session, set("P5.response.grid.columns", 23), 0));
  assert.equal(stale.status, "rejected"); assert.equal(stale.issues[0].code, "stale_revision");
  session.destroy();

  let otherCommits = 0;
  const atomicState = owner(), other = { id: "P7", settings: [{ id: "P7.test", type: "boolean", classification: "authored", writable: true }],
    operations: [], read: () => ({ values: { "P7.test": false }, issues: [] }), validate: () => [],
    stage() { atomicState.draft.presentation.halo.widthPercent = 400;
      return { commit() { otherCommits++; } }; } };
  const atomic = createPlannerAuthoringSession({ owners: [atomicState.adapter, other] });
  const rejected = await atomic.execute(request(atomic, { kind: "apply", edits: [set("P5.visual.hideFeedback", true), set("P7.test", true)] }, 0));
  assert.equal(rejected.status, "rejected"); assert.equal(rejected.issues[0].code, "stale_revision");
  assert.equal(atomicState.commits, 0); assert.equal(otherCommits, 0);
  assert.equal(atomicState.draft.visual.hideFeedback, false);
  atomic.destroy();
});

test("preset transitions bind the existing UI-owned step rather than introducing a default or writable compatibility option", async () => {
  const initial = fixture(); initial.input = createInputBindingPreset("gamepadLeftStick");
  let draft = initial, step = 0.456;
  const adapter = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => step,
    prepareCommit: candidate => ({ commit() { draft = structuredClone(candidate); } }) });
  const candidate = await adapter.stage([operation("inputPreset", { preset: "wasd" })], guard());
  assert.equal(candidate.isCurrent(), true); step = 0.567; assert.equal(candidate.isCurrent(), false);
  const current = await adapter.stage([operation("inputPreset", { preset: "numpad" })], guard());
  current.commit(); assert.equal(draft.input.stepSize, 0.567);
  assert.deepEqual(draft.input, createInputBindingPreset("numpad", 0.567));
});

test("owner publication is separate from atomic installation, synchronous and one-use", async () => {
  let draft = fixture(), published = 0;
  const adapter = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => draft.input.stepSize,
    prepareCommit: candidate => ({ commit() { draft = structuredClone(candidate); },
      afterCommit() { published++; assert.equal(draft.visual.hideFeedback, true); } }) });
  const candidate = await adapter.stage([set("P5.visual.hideFeedback", true)], guard());
  candidate.afterCommit(); assert.equal(published, 0);
  candidate.commit(); assert.equal(published, 0);
  candidate.afterCommit(); candidate.afterCommit(); assert.equal(published, 1);
  const invalid = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => draft.input.stepSize,
    prepareCommit: () => ({ commit() {}, async afterCommit() {} }) });
  await assert.rejects(invalid.stage([set("P5.visual.hideFeedback", false)], guard()), /synchronous/u);
});

test("shared afterCommit observes all installed owners and preserves applied state when a P5 projection fails", async () => {
  for (const failProjection of [false, true]) {
    let draft = fixture(), otherValue = false, reentrantRead;
    const events = [];
    const p5 = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => draft.input.stepSize,
      prepareCommit: candidate => ({
        commit() { draft = structuredClone(candidate); events.push("P5 installed"); },
        afterCommit() {
          events.push("P5 notified");
          assert.equal(otherValue, true, "P5 observers must not see partially installed P7 state");
          assert.equal(session.publishing, true);
          assert.throws(() => session.snapshot());
          reentrantRead = session.execute(request(session, { kind: "snapshot" }));
          if (failProjection) throw new Error("Deliberate owner renderer failure");
        },
      }) });
    const p7 = { id: "P7", settings: [{ id: "P7.test", type: "boolean", classification: "authored", writable: true }],
      operations: [], read: () => ({ values: { "P7.test": otherValue }, issues: [] }), validate: () => [],
      stage: () => ({ commit() { otherValue = true; events.push("P7 installed"); },
        afterCommit() { assert.equal(draft.visual.hideFeedback, true); events.push("P7 notified"); } }) };
    const session = createPlannerAuthoringSession({ owners: [p5, p7],
      onBeforeCommit() { assert.equal(session.publishing, true); events.push("invalidate"); },
      onCommit() { events.push("shared refresh"); } });
    session.subscribe(() => { assert.equal(session.publishing, false); events.push("observer"); });
    const edit = request(session, { kind: "apply", edits: [set("P5.visual.hideFeedback", true), set("P7.test", true)] }, 0);
    const result = await session.execute(edit);
    assert.deepEqual(events, ["invalidate", "P5 installed", "P7 installed", "P5 notified", "P7 notified", "shared refresh", "observer"]);
    assert.equal(result.status, failProjection ? "incomplete" : "applied");
    assert.equal(result.revision, 1); assert.deepEqual(result.result.updatedOwners, ["P5", "P7"]);
    assert.equal(result.issues.length, Number(failProjection));
    if (failProjection) { assert.equal(result.issues[0].code, "projection_failed"); assert.equal(result.issues[0].owner, "P5"); }
    const read = await reentrantRead;
    assert.equal(read.status, "rejected"); assert.equal(read.issues[0].code, "busy");
    assert.equal(session.snapshot().owners.P5.values["P5.visual.hideFeedback"], true);
    assert.equal(session.snapshot().owners.P7.values["P7.test"], true);
    assert.deepEqual(await session.execute(edit), result);
    assert.equal(events.length, 7, "retry must not repeat an applied observer phase");
    session.destroy();
  }
});

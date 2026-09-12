import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlannerAuthoringP6 } from "../site/src/research/planner-authoring-p6.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { createXrLayoutState } from "../site/src/research/xr-layout-editor.js";
import { createDefaultXrLayoutProfile, serializeXrLayoutProfileV1, withXrAngularSize,
  resolveXrCatalogueV1, resolveXrLayoutProfileV1 } from "../site/src/research/xr-layout.js";
import { xrLayoutEditorMarkup } from "../site/src/research/xr-layout-view.js";
import { resolveXrFeedbackFootprintV1 } from "../site/src/research/xr-layout-feedback.js";

const feedback = JSON.parse(await readFile(new URL("fixtures/xr-feedback-envelope-v1.json", import.meta.url))).cases[0].envelope;
const media = [{ assetId: "landscape", displayWidth: 1920, displayHeight: 1080 },
  { assetId: "portrait", displayWidth: 1080, displayHeight: 1920 }];
const set = (field, value) => ({ kind: "set", field: `P6.${field}`, value });
const angular = (widthDegrees, heightDegrees) => ({ kind: "operation", owner: "P6", operation: "setAngularSize", arguments: { widthDegrees, heightDegrees } });
const guard = () => ({ isCurrent: () => true, signal: new AbortController().signal });

// The production pure state remains the only draft owner. This adapter fixture
// supplies inspection/dependency projections; actual editor DOM is checked below.
function fixture() {
  const state = createXrLayoutState();
  state.load(serializeXrLayoutProfileV1(createDefaultXrLayoutProfile()), { catalogue: 4, feedback: 6 });
  let disposed = false, publishes = 0;
  const inspection = { camera: { yaw: 30, elevation: 20 }, media: null,
    catalogueGeometry: structuredClone(media), feedbackEnvelope: structuredClone(feedback) };
  const editor = {
    getAuthoringSnapshot: () => structuredClone({ ...state.getSnapshot(), draft: state.getDraft(), ...inspection, disposed }),
    stageAuthoringDraft(value, options) {
      const candidate = state.stageAuthoringDraft(value, options);
      return { isCurrent: () => !disposed && candidate.isCurrent(),
        commit() { candidate.commit(); publishes++; } };
    },
  };
  return { state, editor, adapter: createPlannerAuthoringP6({ editor }), inspection,
    dispose() { disposed = true; }, get publishes() { return publishes; } };
}

test("P6 CLI catalogue covers every authored GUI field and classifies fixed/inspection values", () => {
  const { adapter } = fixture();
  const authored = new Set(["P6.enabled", ...[...xrLayoutEditorMarkup().matchAll(/data-xr-field="([^"]+)"/gu)].map(match => `P6.${match[1]}`)]);
  assert.deepEqual(new Set(adapter.settings.filter(field => field.writable).map(field => field.id)), authored);
  const read = adapter.read();
  assert.deepEqual(new Set(Object.keys(read.values)), new Set(adapter.settings.map(field => field.id)));
  assert.deepEqual(read.issues, []);
  for (const field of adapter.settings.filter(field => field.id.startsWith("P6.alignment."))) {
    assert.equal(field.classification, "derived"); assert.equal(field.writable, false);
  }
  for (const field of adapter.settings.filter(field => field.id.startsWith("P6.inspection."))) {
    assert.equal(field.classification, "transient"); assert.equal(field.writable, false);
  }
  assert.deepEqual(adapter.operations.map(operation => operation.id), ["setAngularSize"]);
});

const changedValues = {
  enabled: false, "video.distanceMetres": 4.25, "video.azimuthDegrees": 12,
  "video.elevationDegrees": -9, "video.widthMetres": 1.7, "video.heightMetres": 0.85,
  "video.yawDegrees": 14, "video.pitchDegrees": -11, "video.rollDegrees": 24,
  "feedback.enabled": false, "feedback.offsetXMetres": 0.2, "feedback.offsetYMetres": -1.1,
  "feedback.diameterMetres": 0.35, "feedback.minimumGapMetres": 0.08,
};
for (const [field, value] of Object.entries(changedValues)) test(`P6 CLI read/edit/readback: ${field}`, async () => {
  const { state, adapter, editor } = fixture();
  const before = editor.getAuthoringSnapshot();
  assert.notEqual(adapter.read().values[`P6.${field}`], value);
  const staged = await adapter.stage([set(field, value)], guard());
  assert.deepEqual(editor.getAuthoringSnapshot(), before, "staging has no mutation or acceptance side effect");
  assert.equal(staged.isCurrent(), true);
  assert.doesNotThrow(() => staged.commit());
  assert.equal(adapter.read().values[`P6.${field}`], value);
  assert.equal(state.getSnapshot().contribution, null);
  assert.equal(state.getSnapshot().revision, before.revision + 1);
  assert.deepEqual(state.getSnapshot().dependencyRevisions, before.dependencyRevisions);
  assert.deepEqual(editor.getAuthoringSnapshot().camera, before.camera);
});

test("P6 exclusion preserves inactive settings and reenabling needs fresh preparation", async () => {
  const { state, adapter } = fixture();
  (await adapter.stage([set("video.distanceMetres", 4.75), set("enabled", false)], guard())).commit();
  assert.equal(state.getSnapshot().enabled, false);
  assert.deepEqual(adapter.validate(), []);
  assert.equal(adapter.read().values["P6.video.distanceMetres"], 4.75);
  (await adapter.stage([set("enabled", true)], guard())).commit();
  assert.equal(state.getSnapshot().pending, true);
  assert.equal(state.getSnapshot().contribution, null);
  assert.equal(adapter.read().values["P6.video.distanceMetres"], 4.75);
});

test("P6 angular operation uses the ordered candidate and existing physical conversion", async () => {
  const { state, adapter } = fixture();
  const expected = createDefaultXrLayoutProfile(); expected.feedback.enabled = false; expected.video.distanceMetres = 4;
  const converted = withXrAngularSize(expected, 30, 20); converted.video.yawDegrees = 10;
  const staged = await adapter.stage([set("feedback.enabled", false), set("video.distanceMetres", 3),
    set("video.distanceMetres", 4), angular(30, 20), set("video.yawDegrees", 10)], guard());
  staged.commit();
  assert.deepEqual(state.getDraft(), converted);
  assert.equal(adapter.read().values["P6.angularSizeEditable"], false);
  assert.equal(Object.hasOwn(state.getDraft().video, "angularWidth"), false);
  const before = state.getDraft();
  await assert.rejects(adapter.stage([angular(20, 10)], guard()), /centred/);
  assert.deepEqual(state.getDraft(), before);
});

test("P6 malformed/out-of-range/readonly edits reject the entire detached batch", async () => {
  const { adapter, editor } = fixture(), before = editor.getAuthoringSnapshot();
  const invalid = [
    ...[null, "4", NaN, Infinity, -Infinity, {}, [], false, 0, 101].map(value => set("video.distanceMetres", value)),
    set("enabled", 1), set("feedback.enabled", "false"), set("video.rollDegrees", 181),
    set("feedback.minimumGapMetres", -0.01), set("unknown", 2),
    { kind: "set", field: "P5.visual.sizePercent", value: 20 },
    { ...set("video.distanceMetres", 3), extra: true },
    { ...angular(20, 10), owner: "P5" }, { ...angular(20, 10), operation: "recenter" },
    { ...angular(20, 10), arguments: { widthDegrees: 20, heightDegrees: 10, extra: true } },
    { ...angular(20, 10), arguments: { widthDegrees: 20 } }, angular("20", 10), angular(151, 10),
    ...adapter.settings.filter(setting => !setting.writable).map(setting => ({ kind: "set", field: setting.id, value: adapter.read().values[setting.id] })),
  ];
  for (const edit of invalid) {
    await assert.rejects(adapter.stage([set("video.distanceMetres", 7), edit], guard()));
    assert.deepEqual(editor.getAuthoringSnapshot(), before);
  }
  for (const edits of [[], null, Array.from({ length: 257 }, () => set("enabled", true))]) await assert.rejects(adapter.stage(edits, guard()));
  await assert.rejects(adapter.stage([JSON.parse('{"kind":"set","field":"P6.enabled","value":true,"__proto__":{}}')], guard()));
});

test("P6 finite edits can retain invalid geometry honestly without preparing a contribution", async () => {
  const { adapter, state } = fixture();
  (await adapter.stage([set("feedback.offsetYMetres", 0)], guard())).commit();
  assert.equal(adapter.read().values["P6.feedback.offsetYMetres"], 0);
  assert.equal(adapter.read().values["P6.geometry"], null);
  assert.ok(adapter.validate().some(issue => issue.code === "overlap"));
  assert.equal(state.getSnapshot().pending, true);
  assert.throws(() => state.serialize());
  (await adapter.stage([set("feedback.offsetYMetres", -0.9)], guard())).commit();
  assert.deepEqual(adapter.validate(), []);
  assert.equal(state.getSnapshot().contribution, null, "editing never grants preparation/confirmation");
});

test("P6 readback preserves invalid numeric drafts as strings and can repair the exact owner", async () => {
  const { adapter, state } = fixture();
  for (const value of ["", "1e", "bad", NaN, Infinity]) {
    const draft = state.getDraft(); draft.video.distanceMetres = value; state.setDraft(draft);
    const read = adapter.read();
    assert.equal(read.values["P6.video.distanceMetres"], String(value));
    assert.ok(read.issues.some(issue => issue.field === "P6.video.distanceMetres"));
    assert.equal(read.values["P6.geometry"], null);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(read)));
  }
  (await adapter.stage([set("video.distanceMetres", 3.5)], guard())).commit();
  assert.equal(state.getDraft().video.distanceMetres, 3.5);
  assert.deepEqual(adapter.validate(), []);
});

test("P6 derived fit and feedback reuse current owners; inspection is transient", async () => {
  const { adapter, state, inspection } = fixture();
  const before = state.getSnapshot(), profile = state.getDraft();
  const read = adapter.read().values;
  assert.deepEqual(read["P6.geometry"].screen, resolveXrLayoutProfileV1(profile));
  assert.deepEqual(read["P6.geometry"].videos, resolveXrCatalogueV1(profile, media));
  assert.deepEqual(read["P6.geometry"].feedback, resolveXrFeedbackFootprintV1(profile, feedback));
  inspection.camera = { yaw: 90, elevation: 0 };
  inspection.media = { displayWidth: 1080, displayHeight: 1920 };
  assert.deepEqual(adapter.read().values["P6.inspection.camera"], inspection.camera);
  assert.deepEqual(adapter.read().values["P6.geometry"].screen, resolveXrLayoutProfileV1(profile, inspection.media));
  assert.deepEqual(state.getSnapshot(), before);
  inspection.catalogueGeometry = null; inspection.feedbackEnvelope = null;
  state.setDependencyRevisions({ catalogue: null, feedback: null });
  assert.equal(adapter.validate().filter(issue => issue.code === "dependency_pending").length, 2);
  assert.equal(adapter.read().values["P6.geometry"].videos, null);
  assert.equal(adapter.read().values["P6.geometry"].feedback, null);
});

test("P6 staging captures inputs, rejects cancellation and detects queued owner/dependency drift", async () => {
  for (const kind of ["caller", "signal", "draft", "dependencies", "disposed"]) {
    const f = fixture(); let current = true;
    const controller = new AbortController();
    const operation = f.adapter.stage([set("video.distanceMetres", 4)], { isCurrent: () => current, signal: controller.signal });
    if (kind === "caller") current = false;
    if (kind === "signal") controller.abort();
    if (kind === "draft") { const draft = f.state.getDraft(); draft.video.distanceMetres = 8; f.state.setDraft(draft); }
    if (kind === "dependencies") f.state.setDependencyRevisions({ catalogue: 5, feedback: 6 });
    if (kind === "disposed") f.dispose();
    const afterNewerChange = f.editor.getAuthoringSnapshot();
    await assert.rejects(operation, /no longer current/);
    assert.deepEqual(f.editor.getAuthoringSnapshot(), afterNewerChange);
    assert.equal(f.publishes, 0);
  }
  const f = fixture(), edits = [set("video.distanceMetres", 4)];
  const operation = f.adapter.stage(edits, guard()); edits[0].value = 90;
  (await operation).commit(); assert.equal(f.state.getDraft().video.distanceMetres, 4);
  await assert.rejects(f.adapter.stage([set("enabled", false)], { isCurrent: () => false }), /no longer current/);
});

test("P6 staged owner guard expires after a later dependency change without mutation", async () => {
  const f = fixture();
  const staged = await f.adapter.stage([set("video.distanceMetres", 4)], guard());
  assert.equal(staged.isCurrent(), true);
  f.state.setDependencyRevisions({ catalogue: 99, feedback: 6 });
  const before = f.editor.getAuthoringSnapshot();
  assert.equal(staged.isCurrent(), false);
  assert.deepEqual(f.editor.getAuthoringSnapshot(), before);
  assert.equal(f.publishes, 0);
});

test("shared session preflights P6 drift before publishing any owner in an atomic batch", async () => {
  const f = fixture(); let otherCommits = 0;
  const session = createPlannerAuthoringSession({ owners: [f.adapter, {
    id: "P7", settings: [], operations: [{ id: "testDependencyDrift" }],
    read: () => ({ values: {}, issues: [] }), validate: () => [],
    async stage() {
      await Promise.resolve();
      f.state.setDependencyRevisions({ catalogue: 5, feedback: 6 });
      return { commit() { otherCommits++; } };
    },
  }] });
  const result = await session.execute({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: 0,
    action: { kind: "apply", edits: [set("video.distanceMetres", 8),
      { kind: "operation", owner: "P7", operation: "testDependencyDrift", arguments: {} }] } });
  assert.equal(result.status, "rejected");
  assert.equal(f.state.getDraft().video.distanceMetres, 2);
  assert.equal(f.publishes, 0); assert.equal(otherCommits, 0);
  assert.equal(session.revision, 0);
  session.destroy();
});

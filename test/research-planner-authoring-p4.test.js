import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createScreenLayoutDraftEditor } from "../site/src/research/screen-layout-editor.js";
import { createScreenLayoutDraft } from "../site/src/research/screen-layout-draft.js";
import { screenLayoutDraftMarkup } from "../site/src/research/screen-layout-view.js";
import { desktopLayoutDraftFromProfile, desktopLayoutProfileFromDraft } from "../site/src/research/desktop-layout-contribution.js";
import { projectWorkspaceVideoCatalogueSnapshot } from "../site/src/research/workspace-contribution.js";
import { projectVideoDisplayGeometry } from "../site/src/research/video-catalogue-contribution.js";
import { resolveFeedbackEnvelope } from "../site/src/research/feedback-layout.js";
import { createPlannerAuthoringP4 } from "../site/src/research/planner-authoring-p4.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { PLANNER_COMMAND_SCHEMA, validateCommandJson } from "../site/src/research/planner-authoring-contract.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/desktop-layout-candidates-v1.json", import.meta.url), "utf8"));
const clone = structuredClone;
const set = (field, value) => ({ kind: "set", field: `P4.${field}`, value });
const operation = (operation, args = {}) => ({ kind: "operation", owner: "P4", operation, arguments: args });
const lifetime = () => ({ isCurrent: () => true, signal: new AbortController().signal });
const near = (a, b) => {
  if (typeof a === "number") assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
  else if (a && typeof a === "object") { assert.deepEqual(Object.keys(a), Object.keys(b)); for (const key of Object.keys(a)) near(a[key], b[key]); }
  else assert.equal(a, b);
};

// Minimal DOM test doubles host the real editor/controller. No browser,
// foreground input, native media receipt or rendered-layout claim is made.
function rootFixture() {
  const element = () => { let value = ""; return { get value() { return value; }, set value(next) { value = String(next); }, checked: false, dataset: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    matches: () => false,
    replaceChildren(...children) { this.children = children; if (this.select) this.value = children[0]?.value ?? ""; } }; };
  const controls = Object.keys(createScreenLayoutDraft()).map(key => Object.assign(element(), { id: `layout-${key}`, dataset: { layoutField: key },
    type: key === "fullViewportMapping" ? "checkbox" : ["units", "referencePolicy"].includes(key) ? "select-one" : "number" }));
  const nodes = new Map(["[data-layout-scene]", "[data-layout-readout]", "[data-layout-errors]", "[data-layout-status]",
    "[data-layout-dependencies]", "[data-layout-video]", "[data-layout-fixture-controls]", "[data-layout-video-label]", ".layout-calibration"]
    .map(selector => [selector, element()]));
  nodes.get("[data-layout-video]").select = true;
  const handlers = new Map();
  return { controls, nodes, ownerDocument: { createElement: element }, matches: () => true,
    querySelector: selector => nodes.get(selector),
    querySelectorAll: selector => selector === "[data-layout-field]" ? controls : [],
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    removeEventListener(type, fn) { handlers.set(type, handlers.get(type).filter(value => value !== fn)); },
    reset() { for (const handler of handlers.get("click")) handler({ target: { closest: () => true }, stopPropagation() {} }); },
    input(key, value) {
      const target = controls.find(control => control.dataset.layoutField === key);
      if (target.type === "checkbox") target.checked = value; else target.value = value ?? "";
      const type = target.type === "select-one" ? "change" : "input";
      for (const handler of handlers.get(type)) handler({ target, type, stopPropagation() {} });
    },
  };
}

async function harness({ restore = true } = {}) {
  const root = rootFixture(), changes = [];
  let failNotification = false;
  let p1 = { revision: 20, enabled: true, pending: false, contribution: clone(fixture.workspace), dependencyRevisions: [] };
  let p5Revision = 8, feedback = clone(fixture.feedback), feedbackPending = false;
  const editor = createScreenLayoutDraftEditor(root, { onChange: value => { changes.push(value); if (failNotification) throw new Error("Observer failed"); }, dependencies: {
    getCatalogueSnapshot: () => clone(p1), projectSnapshot: projectWorkspaceVideoCatalogueSnapshot,
    projectCatalogue: projectVideoDisplayGeometry,
    getFeedbackSnapshot: () => ({ revision: p5Revision, enabled: true, pending: feedbackPending, contribution: feedbackPending ? null : clone(feedback), dependencyRevisions: [] }),
    getFeedbackLayoutSnapshot: side => ({ revision: p5Revision, pending: feedbackPending,
      envelope: feedbackPending ? null : resolveFeedbackEnvelope(feedback, side) }),
  } });
  await editor.refreshCatalogue();
  if (restore) await editor.restoreDraft({ schema: "affect-research-screen-layout-draft", version: 2, draft: desktopLayoutDraftFromProfile(fixture.cases[0].profile) });
  const owner = createPlannerAuthoringP4({ editor });
  const session = createPlannerAuthoringSession({ owners: [owner] });
  const execute = action => session.execute({ schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision: ["set", "apply"].includes(action.kind) ? session.revision : null, action });
  return { root, editor, owner, session, execute, changes,
    failNotifications() { failNotification = true; },
    sources: () => clone({ p1, feedback }),
    changeP1() { p1 = { ...p1, revision: p1.revision + 1 }; return editor.refreshCatalogue(); },
    changeP5() { p5Revision++; feedbackPending = true; editor.refreshFeedback(); },
    setUnnotifiedP5Revision(value) { p5Revision = value; },
  };
}

test("P4 command catalogue exactly covers every writable draft field and read-only derivation", async () => {
  const h = await harness(), result = await h.execute({ kind: "catalogue" });
  assert.equal(result.status, "ok");
  assert.equal(h.owner.settings.filter(field => field.writable).length, Object.keys(createScreenLayoutDraft()).length);
  assert.equal(h.owner.settings.filter(field => !field.writable).length, 5);
  assert.deepEqual(Object.keys(h.owner.read().values).sort(), h.owner.settings.map(field => field.id).sort());
  assert.ok(h.owner.settings.every(field => field.id.startsWith("P4.") && field.label && field.classification));
  assert.deepEqual(h.owner.operations.map(item => item.id), ["convertUnits", "clearCalibration"]);
  validateCommandJson(h.owner.read());
  const read = h.owner.read(); read.values["P4.geometry"].reference.width = 1;
  assert.notEqual(h.owner.read().values["P4.geometry"].reference.width, 1);
});

test("every writable P4 setting has matching UI edit, session readback and exact saved JSON", async () => {
  const h = await harness(), ui = await harness(), markup = screenLayoutDraftMarkup();
  const examples = [
    ["viewport.widthCssPx", 1600, "screenWidth"], ["viewport.heightCssPx", 900, "screenHeight"],
    ["calibration.activeWidthMm", 480, "physicalWidth"], ["calibration.activeHeightMm", 270, "physicalHeight"],
    ["calibration.fullViewportMapping", true, "fullViewportMapping"],
    ["reference.method", "maximum-oriented-dimensions", "referencePolicy"], ["units", "mm", "units"],
    ["reference.maximumWidth", 230, "referenceWidth"], ["reference.maximumHeight", 120, "referenceHeight"],
    ["reference.centreX", 240, "referenceX"], ["reference.centreY", 80, "referenceY"],
    ["feedback.viewportSide", 4.25, "diameter"], ["feedback.offsetX", -6.5, "offsetX"],
    ["feedback.offsetY", 95, "offsetY"], ["feedback.minimumGap", 1.5, "gap"],
  ];
  assert.deepEqual(examples.map(([id]) => `P4.${id}`).sort(), h.owner.settings.filter(field => field.writable).map(field => field.id).sort());
  for (const [id, value, key] of examples) {
    const response = await h.execute(set(id, value));
    assert.ok(["applied", "incomplete"].includes(response.status), JSON.stringify(response));
    const read = await h.execute({ kind: "get", field: `P4.${id}` });
    assert.equal(read.result.value, value, id);
    const control = h.root.controls.find(control => control.dataset.layoutField === key);
    assert.equal(typeof value === "boolean" ? control.checked : control.value, typeof value === "boolean" ? value : String(value), id);
    const descriptor = h.owner.settings.find(field => field.id === `P4.${id}`);
    assert.ok(markup.includes(`id="${descriptor.uiControl}"`), id);
    ui.root.input(key, value);
    assert.deepEqual(h.owner.read(), ui.owner.read(), id);
  }
  assert.equal(h.editor.getSnapshot().contribution, null);
  assert.equal(h.session.revision, examples.length);
  const cliProfile = (await h.editor.prepareContribution()).contribution;
  const uiProfile = (await ui.editor.prepareContribution()).contribution;
  assert.deepEqual(cliProfile, uiProfile);
  for (const descriptor of h.owner.settings.filter(field => field.writable)) {
    const value = descriptor.jsonPath.split(".").slice(2).reduce((node, key) => node[key], cliProfile);
    if (descriptor.id === "P4.calibration.fullViewportMapping") assert.equal(value.mapping, "full-viewport");
    else assert.equal(value, h.owner.read().values[descriptor.id], descriptor.id);
  }
});

test("a fresh P4 editor authors its complete profile through CLI fields without importing layout JSON", async () => {
  const h = await harness({ restore: false });
  assert.equal(h.owner.read().values["P4.reference.method"], null);
  const edits = [set("reference.method", "largest-oriented-area"), set("viewport.widthCssPx", 1920), set("viewport.heightCssPx", 1080),
    set("calibration.activeWidthMm", 480), set("calibration.activeHeightMm", 270), set("calibration.fullViewportMapping", true), set("units", "relative"),
    set("reference.maximumWidth", 60), set("reference.maximumHeight", 45), set("reference.centreX", 50), set("reference.centreY", 30),
    set("feedback.viewportSide", 4), set("feedback.offsetX", 0), set("feedback.offsetY", 90), set("feedback.minimumGap", 1)];
  assert.deepEqual(edits.map(edit => edit.field).sort(), h.owner.settings.filter(field => field.writable).map(field => field.id).sort());
  assert.equal((await h.execute({ kind: "apply", edits })).status, "applied");
  assert.equal(h.editor.getSnapshot().pending, true);
  assert.deepEqual(h.owner.validate(), []);
  const prepared = await h.editor.prepareContribution();
  assert.equal(prepared.pending, false);
  assert.deepEqual(prepared.contribution, desktopLayoutProfileFromDraft(h.editor.getDraftDocument().draft, fixture.media));
});

test("ordered unit operations use the current candidate and preserve both fixed reference methods", async () => {
  for (const method of ["largest-oriented-area", "maximum-oriented-dimensions"]) {
    const h = await harness(), ui = await harness(), sources = h.sources();
    const configure = await h.execute({ kind: "apply", edits: [set("reference.method", method), set("calibration.activeWidthMm", 480),
      set("calibration.activeHeightMm", 270), set("calibration.fullViewportMapping", true)] });
    assert.ok(["applied", "incomplete"].includes(configure.status));
    for (const [key, value] of [["referencePolicy", method], ["physicalWidth", 480], ["physicalHeight", 270], ["fullViewportMapping", true]]) ui.root.input(key, value);
    const before = h.owner.read().values;
    assert.equal((await h.execute({ kind: "apply", edits: [operation("convertUnits", { units: "mm" })] })).status, "applied");
    ui.root.input("units", "mm"); assert.deepEqual(h.owner.read(), ui.owner.read());
    near(h.owner.read().values["P4.geometry"], before["P4.geometry"]);
    near(h.owner.read().values["P4.videoFits"], before["P4.videoFits"]);
    assert.equal(h.owner.read().values["P4.units"], "mm");
    assert.equal((await h.execute(set("units", "relative"))).status, "applied");
    ui.root.input("units", "relative"); assert.deepEqual(h.owner.read(), ui.owner.read());
    near(h.owner.read().values["P4.geometry"], before["P4.geometry"]);
    const mixed = await h.execute({ kind: "apply", edits: [set("feedback.offsetX", 10), operation("convertUnits", { units: "mm" }), set("feedback.offsetX", 8)] });
    assert.ok(["applied", "incomplete"].includes(mixed.status));
    ui.root.input("offsetX", 10); ui.root.input("units", "mm"); ui.root.input("offsetX", 8);
    assert.deepEqual(h.owner.read(), ui.owner.read());
    assert.equal(h.owner.read().values["P4.feedback.offsetX"], 8);
    assert.equal(h.owner.read().values["P4.geometry"].offset.x, 32);
    assert.deepEqual(h.sources(), sources);
    await h.execute(set("units", "relative")); ui.root.input("units", "relative");
    await h.execute({ kind: "apply", edits: [operation("clearCalibration")] });
    ui.root.input("physicalWidth", ""); ui.root.input("physicalHeight", ""); ui.root.input("fullViewportMapping", false);
    assert.deepEqual(h.owner.read(), ui.owner.read());
    const accepted = (await h.editor.prepareContribution()).contribution;
    assert.equal(accepted.calibration, null);
    assert.deepEqual(accepted, (await ui.editor.prepareContribution()).contribution);
  }
});

test("staging is detached, has no notification/acceptance, and commits once only after guard preflight", async () => {
  const h = await harness(); await h.editor.prepareContribution();
  const before = h.owner.read(), snapshot = h.editor.getSnapshot(), count = h.changes.length;
  const edits = [set("feedback.offsetX", 3)];
  const pending = h.owner.stage(edits, lifetime()); edits[0].value = 500;
  const staged = await pending;
  assert.deepEqual(h.owner.read(), before); assert.deepEqual(h.editor.getSnapshot(), snapshot); assert.equal(h.changes.length, count);
  assert.equal(staged.isCurrent(), true); assert.doesNotThrow(() => staged.commit());
  assert.equal(staged.isCurrent(), false); assert.equal(h.changes.length, count);
  assert.equal(h.editor.getDraftDocument().draft.offsetX, 3);
  staged.afterCommit(); staged.afterCommit(); assert.equal(h.changes.length, count + 1);
  assert.equal(h.owner.read().values["P4.feedback.offsetX"], 3);
  assert.equal(h.editor.getSnapshot().pending, true); assert.equal(h.editor.getSnapshot().contribution, null);
});

test("malformed/unknown/read-only/range/type operations reject a whole batch without mutation", async () => {
  const h = await harness(), before = h.owner.read(), snapshot = h.editor.getSnapshot(), count = h.changes.length;
  const invalid = [set("geometry", {}), set("viewport.widthCssPx", 1.5), set("viewport.heightCssPx", "1080"),
    set("feedback.viewportSide", 0), set("feedback.minimumGap", -1),
    set("calibration.fullViewportMapping", 1), set("reference.method", "automatic"), set("unknown", 1),
    set("feedback.offsetX", Infinity), { ...set("feedback.offsetX", 2), extra: true },
    operation("convertUnits", { units: "cm" }), operation("convertUnits", { units: "mm", extra: true }),
    operation("clearCalibration", { confirmed: true }), operation("reset"), { ...operation("clearCalibration"), owner: "P5" }];
  for (const bad of invalid) await assert.rejects(h.owner.stage([set("feedback.offsetX", 7), bad], lifetime()));
  assert.deepEqual(h.owner.read(), before); assert.deepEqual(h.editor.getSnapshot(), snapshot); assert.equal(h.changes.length, count);
});

test("incomplete drafts stay honest and writable without fabricating geometry or acceptance", async () => {
  const h = await harness();
  assert.equal((await h.execute(set("reference.method", null))).status, "incomplete");
  assert.equal(h.owner.read().values["P4.reference.method"], null);
  assert.equal(h.owner.read().values["P4.geometry"], null);
  const snapshot = h.editor.getSnapshot();
  assert.equal((await h.execute(set("units", "mm"))).status, "rejected");
  assert.deepEqual(h.editor.getSnapshot(), snapshot);
  h.root.input("screenWidth", "bad");
  assert.equal(h.owner.read().values["P4.viewport.widthCssPx"], "bad");
  assert.ok(h.owner.validate().some(issue => issue.field === "P4.viewport.widthCssPx"));
  assert.equal(h.owner.read().values["P4.geometry"], null); validateCommandJson(h.owner.read());
  await h.execute(set("viewport.widthCssPx", 1920));
  await h.execute({ kind: "apply", edits: [operation("clearCalibration")] });
  assert.equal(h.owner.read().values["P4.calibration.activeWidthMm"], "");
  assert.equal(h.owner.read().values["P4.calibration.activeHeightMm"], "");
  assert.equal(h.owner.read().values["P4.calibration.fullViewportMapping"], false);
  assert.ok(h.owner.validate().some(issue => issue.code === "reference-policy-required"));
});

test("staging rejects edits, producer drift, cancellation and disposal before publication", async () => {
  for (const change of [h => h.root.input("offsetX", "9"), h => h.changeP1(), h => h.changeP5(), h => h.editor.destroy()]) {
    const h = await harness(), pending = h.owner.stage([set("feedback.offsetX", 7)], lifetime());
    const rejected = assert.rejects(pending, /stale/u);
    await change(h);
    await rejected;
  }
  for (const cancel of [options => { options.isCurrent = () => false; }, options => options.controller.abort()]) {
    const h = await harness(), controller = new AbortController(), options = { ...lifetime(), signal: controller.signal, controller };
    cancel(options); await assert.rejects(h.owner.stage([set("feedback.offsetX", 7)], options), /stale/u);
  }
});

test("staged guards detect unnotified dependency drift without changing observer caches", async () => {
  const h = await harness(), staged = await h.owner.stage([set("feedback.offsetX", 7)], lifetime());
  const snapshot = h.editor.getSnapshot(), count = h.changes.length;
  h.setUnnotifiedP5Revision(9); assert.equal(staged.isCurrent(), false);
  h.setUnnotifiedP5Revision(8); assert.equal(staged.isCurrent(), true);
  assert.deepEqual(h.editor.getSnapshot(), snapshot); assert.equal(h.changes.length, count);
  h.changeP5(); assert.equal(staged.isCurrent(), false);
});

test("shared session preflights dependency guards before publishing any owner", async () => {
  const h = await harness(), before = h.owner.read(); let otherCommits = 0;
  const other = { id: "P6", settings: [{ id: "P6.enabled", type: "boolean", writable: true, classification: "authored" }], operations: [],
    read: () => ({ values: { "P6.enabled": false }, issues: [] }), validate: () => [],
    async stage() { h.changeP5(); return { commit() { otherCommits++; } }; } };
  h.session.registerOwner(other);
  const result = await h.execute({ kind: "apply", edits: [set("feedback.offsetX", 7), { kind: "set", field: "P6.enabled", value: true }] });
  assert.equal(result.status, "rejected"); assert.equal(otherCommits, 0);
  assert.equal(h.owner.read().values["P4.feedback.offsetX"], before.values["P4.feedback.offsetX"]);
  assert.equal(h.session.revision, 0);
});

test("afterCommit publishes the current receipt if another owner has already refreshed P4", async () => {
  const h = await harness(), staged = await h.owner.stage([set("feedback.offsetX", 7)], lifetime());
  assert.equal(staged.isCurrent(), true); staged.commit();
  h.changeP5(); const current = h.editor.getSnapshot();
  staged.afterCommit(); assert.deepEqual(h.changes.at(-1), current);
  assert.deepEqual(h.editor.getSnapshot(), current);
});

test("P4 observer failure follows complete atomic publication and retains UI readback", async () => {
  const h = await harness(); let enabled = false;
  h.session.registerOwner({ id: "P6", settings: [{ id: "P6.enabled", type: "boolean", writable: true, classification: "authored" }], operations: [],
    read: () => ({ values: { "P6.enabled": enabled }, issues: [] }), validate: () => [],
    async stage() { return { commit() { enabled = true; } }; } });
  h.failNotifications();
  const result = await h.execute({ kind: "apply", edits: [set("feedback.offsetX", 7), { kind: "set", field: "P6.enabled", value: true }] });
  assert.equal(result.status, "incomplete"); assert.equal(enabled, true);
  assert.deepEqual(result.result.updatedOwners, ["P4", "P6"]);
  assert.equal(h.session.revision, 1);
  assert.equal(h.root.controls.find(control => control.id === "layout-offsetX").value, "7");
  assert.equal(h.owner.read().values["P4.feedback.offsetX"], 7);
});

test("CLI preparation retains the actual accepted profile and independent geometry authority", async () => {
  const h = await harness(), original = await h.editor.prepareContribution();
  const staged = await h.owner.stage([set("feedback.offsetX", 1.25)], lifetime());
  assert.equal(staged.isCurrent(), true); staged.commit(); staged.afterCommit();
  const actual = await h.editor.prepareContribution();
  const expected = desktopLayoutProfileFromDraft(h.editor.getDraftDocument().draft, fixture.media);
  assert.deepEqual(actual.contribution, expected);
  const untouched = clone(actual.contribution); untouched.feedback.offset.x = original.contribution.feedback.offset.x;
  assert.deepEqual(untouched, original.contribution);
});

const restoreOptions = (isCurrent = () => true) => ({ savedWorkspaceContribution: clone(fixture.workspace),
  savedFeedbackContribution: clone(fixture.feedback), isCurrent });

test("prepared P4 content validates without mutation, commits state then projects exactly once", async () => {
  const h = await harness(), value = clone(fixture.cases[0].profile); value.feedback.offset.x = 1.25;
  const before = { draft: h.editor.draft, snapshot: h.editor.getSnapshot(), projection: h.editor.projection,
    controls: h.root.controls.map(c => c.value), count: h.changes.length };
  const prepared = await h.editor.prepareRestoreContent(value, restoreOptions());
  assert.equal(prepared.isCurrent(), true);
  assert.deepEqual({ draft: h.editor.draft, snapshot: h.editor.getSnapshot(), projection: h.editor.projection,
    controls: h.root.controls.map(c => c.value), count: h.changes.length }, before);
  assert.throws(() => prepared.afterCommit(), /not committed/);
  const expected = desktopLayoutDraftFromProfile(value); value.feedback.offset.x = 999;
  assert.equal(prepared.commit(), undefined);
  assert.deepEqual(h.editor.draft, expected);
  assert.equal(h.editor.getSnapshot().pending, true); assert.equal(h.editor.getSnapshot().contribution, null);
  assert.equal(h.changes.length, before.count);
  assert.deepEqual(h.root.controls.map(c => c.value), before.controls);
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit(), /already committed/);
  assert.equal(prepared.afterCommit(), undefined); prepared.afterCommit();
  assert.equal(h.changes.length, before.count + 1);
  assert.equal(h.root.controls.find(c => c.dataset.layoutField === "offsetX").value, "1.25");
  const legacy = await harness(); await legacy.editor.restoreContent({ ...clone(fixture.cases[0].profile),
    feedback: { ...clone(fixture.cases[0].profile.feedback), offset: { ...fixture.cases[0].profile.feedback.offset, x: 1.25 } } }, restoreOptions());
  assert.deepEqual(h.editor.draft, legacy.editor.draft); assert.deepEqual(h.editor.projection, legacy.editor.projection);
});

test("prepared content rejects edits, reset, disposal, dependency drift and cancellation without replacement", async () => {
  for (const change of [h => h.root.input("offsetX", "9"), h => h.root.reset(), h => h.editor.destroy(),
    h => h.changeP1(), h => h.changeP5(), h => h.setUnnotifiedP5Revision(9)]) {
    const h = await harness(), prepared = await h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
    await change(h); const before = h.editor.getSnapshot(), draft = h.editor.draft;
    assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit(), /stale/);
    assert.deepEqual(h.editor.getSnapshot(), before); assert.deepEqual(h.editor.draft, draft);
  }
  const h = await harness(); let current = true;
  const prepared = await h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions(() => current));
  current = false; assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit(), /stale/);
  const before = h.editor.getSnapshot();
  await assert.rejects(h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions(() => false)), /stale/);
  await assert.rejects(h.editor.prepareRestoreContent({ ...fixture.cases[0].profile, unknown: true }, restoreOptions()));
  await assert.rejects(h.editor.prepareRestoreContent(fixture.cases[0].profile, {}), /complete saved/);
  assert.deepEqual(h.editor.getSnapshot(), before);
});

test("preparing content cannot observe new feedback revisions or revive unresolved media", async () => {
  const h = await harness(); h.changeP5();
  const before = h.editor.getSnapshot();
  const prepared = await h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
  assert.deepEqual(h.editor.getSnapshot(), before); prepared.commit(); prepared.afterCommit();
  assert.equal(h.editor.getSnapshot().pending, true);
  assert.equal(h.editor.getSnapshot().contribution, null);
  assert.ok(h.editor.projection.issues.some(issue => issue.code === "feedback-unavailable"));
  const blank = createScreenLayoutDraftEditor(rootFixture());
  const content = await blank.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
  content.commit(); content.afterCommit();
  assert.equal(blank.getSnapshot().pending, true); assert.equal(blank.projection.videos.length, 0);
  assert.equal(blank.projection.exportable, false);
});

test("content projection failures retain committed state and synchronize controls", async () => {
  const h = await harness(), value = clone(fixture.cases[0].profile); value.feedback.offset.x = 1.25;
  const prepared = await h.editor.prepareRestoreContent(value, restoreOptions());
  prepared.commit(); const committed = h.editor.getSnapshot(); h.failNotifications();
  assert.throws(() => prepared.afterCommit(), /Observer failed/);
  assert.deepEqual(h.editor.getSnapshot(), committed);
  assert.equal(h.root.controls.find(c => c.dataset.layoutField === "offsetX").value, "1.25");
  prepared.afterCommit(); assert.deepEqual(h.editor.getSnapshot(), committed);
});

test("in-flight content preparation and competing prepared commits are fenced", async () => {
  const h = await harness();
  const pending = h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
  h.root.reset(); await assert.rejects(pending, /stale/);
  const first = await h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
  const second = await h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
  assert.equal(first.isCurrent(), true); assert.equal(second.isCurrent(), true);
  first.commit(); assert.equal(second.isCurrent(), false); assert.throws(() => second.commit(), /stale/);
  h.root.input("offsetX", "9"); const current = h.editor.getSnapshot();
  assert.throws(() => first.afterCommit(), /stale/);
  assert.deepEqual(h.editor.getSnapshot(), current); assert.equal(h.editor.draft.offsetX, "9");
});

test("a throwing DOM projection cannot undo a prepared content commit", async () => {
  const h = await harness(), prepared = await h.editor.prepareRestoreContent(fixture.cases[0].profile, restoreOptions());
  prepared.commit(); const committed = h.editor.getSnapshot();
  Object.defineProperty(h.root.nodes.get("[data-layout-scene]"), "innerHTML", { set() { throw new Error("Projection failed"); } });
  assert.throws(() => prepared.afterCommit(), /Projection failed/);
  assert.deepEqual(h.editor.getSnapshot(), committed); assert.equal(committed.pending, true);
  prepared.afterCommit();
});

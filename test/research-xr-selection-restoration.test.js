import test from "node:test";
import assert from "node:assert/strict";
import { createXrLayoutEditor } from "../site/src/research/xr-layout-editor.js";
import { createXrLayoutAuthoring } from "../site/src/research/xr-layout-authoring.js";
import { createDefaultXrLayoutProfile } from "../site/src/research/xr-layout.js";

const saved = () => ({ status: "included", profile: {
  ...createDefaultXrLayoutProfile(), video: { ...createDefaultXrLayoutProfile().video,
    distanceMetres: 7, widthMetres: 2.5, heightMetres: 1.4, yawDegrees: 8, rollDegrees: 3 },
  feedback: { ...createDefaultXrLayoutProfile().feedback, offsetYMetres: -2 },
} });

// Minimal DOM doubles exercise the real editor, not browser rendering.
async function harness() {
  const node = () => ({ value: "", checked: false, dataset: {},
    removeAttribute() {}, setAttribute() {}, replaceChildren() {}, append() {} });
  const fields = ["video.distanceMetres", "video.widthMetres", "video.heightMetres", "video.yawDegrees", "video.rollDegrees"]
    .map(field => ({ ...node(), type: "number", dataset: { xrField: field } }));
  const nodes = new Map(), changes = [], listeners = new Set();
  const host = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector);
  }, querySelectorAll: selector => selector === "[data-xr-field]" ? fields : [],
  addEventListener() {}, ownerDocument: { createElement: node } };
  let dependencies = { P1: null, P5: null }, current = true, failNotify = false, projections = 0;
  const editor = createXrLayoutEditor(host, { onChange(value) {
    changes.push(value); if (failNotify) throw new Error("projection failed");
  } });
  const authoring = createXrLayoutAuthoring({ editor, getDependencies: () => dependencies,
    subscribe: [listener => { listeners.add(listener); return () => listeners.delete(listener); }],
    projectCatalogue: async () => { projections++; throw new Error("Media must not be resolved by restore"); } });
  await authoring.refresh();
  changes.length = 0;
  return { editor, authoring, fields, changes, nodes,
    prepare: selection => authoring.prepareRestoreSelection(selection, { isCurrent: () => current }),
    cancel: () => { current = false; }, failNotify: () => { failNotify = true; },
    drift(notify = true) { dependencies = { P1: { revision: 99 }, P5: null }; if (notify) for (const listener of listeners) listener(); },
    projections: () => projections, destroy() { authoring.destroy(); editor.destroy(); } };
}

for (const included of [true, false]) {
  test(`prepared ${included ? "included" : "excluded"} selection is detached, read-only and projects only after commit`, async () => {
    const h = await harness();
    h.authoring.restoreSelection(saved(), { isCurrent: () => true });
    h.editor.acceptLayout(); h.changes.length = 0;
    const before = h.editor.getAuthoringSnapshot(), oldField = h.fields[0].value;
    const selection = included ? saved() : { status: "excluded" };
    if (included) selection.profile.video.distanceMetres = 8;
    const expected = structuredClone(selection), candidate = h.prepare(selection);
    if (included) selection.profile.video.distanceMetres = 99;
    assert.deepEqual(h.editor.getAuthoringSnapshot(), before);
    assert.equal(h.changes.length, 0); assert.equal(h.projections(), 0);
    assert.equal(candidate.isCurrent(), true);
    const result = candidate.commit();
    assert.equal(result.enabled, included); assert.equal(result.pending, included);
    assert.equal(result.contribution, null); assert.equal(result.revision, before.revision + 1);
    assert.deepEqual(result.dependencyRevisions, before.dependencyRevisions);
    assert.deepEqual(h.editor.getDraft(), included ? expected.profile : createDefaultXrLayoutProfile());
    assert.equal(h.fields[0].value, oldField); assert.equal(h.changes.length, 0);
    assert.equal(candidate.isCurrent(), false);
    candidate.afterCommit();
    assert.equal(h.changes.length, 1);
    assert.equal(h.fields[0].value, h.editor.getDraft().video.distanceMetres);
    candidate.afterCommit(); assert.equal(h.changes.length, 1);
    assert.throws(() => candidate.commit(), error => error.code === "stale");
    h.destroy();
  });
}

test("malformed saved unions and stale initial request reject without editor changes", async () => {
  const h = await harness(), before = h.editor.getAuthoringSnapshot();
  for (const invalid of [null, {}, { status: "included" }, { status: "excluded", profile: saved().profile },
    { status: "included", profile: { ...saved().profile, target: "desktop" } }]) {
    assert.throws(() => h.prepare(invalid));
    assert.deepEqual(h.editor.getAuthoringSnapshot(), before);
  }
  assert.throws(() => h.authoring.prepareRestoreSelection(saved()), /current-request guard/);
  h.cancel(); assert.throws(() => h.prepare(saved()), error => error.code === "stale");
  assert.equal(h.changes.length, 0); h.destroy();
});

for (const action of ["edit", "reset", "dependencies", "silent-dependencies", "cancel", "editor-dispose", "authoring-dispose"]) {
  test(`${action} before commit fences both selection branches`, async () => {
    for (const selection of [saved(), { status: "excluded" }]) {
      const h = await harness(), candidate = h.prepare(selection);
      if (action === "edit") h.editor.restoreDraft(saved().profile);
      if (action === "reset") h.editor.restoreExcluded();
      if (action === "dependencies") h.drift();
      if (action === "silent-dependencies") h.drift(false);
      if (action === "cancel") h.cancel();
      if (action === "editor-dispose") h.editor.destroy();
      if (action === "authoring-dispose") h.authoring.destroy();
      const before = h.editor.getAuthoringSnapshot(), count = h.changes.length;
      assert.equal(candidate.isCurrent(), false);
      assert.throws(() => candidate.commit(), error => error.code === "stale");
      assert.deepEqual(h.editor.getAuthoringSnapshot(), before); assert.equal(h.changes.length, count);
      h.destroy();
    }
  });
}

test("projection errors retain committed state and never replay notifications", async () => {
  const h = await harness(), candidate = h.prepare(saved());
  assert.throws(() => candidate.afterCommit(), error => error.code === "stale");
  candidate.commit(); const committed = h.editor.getAuthoringSnapshot(); h.failNotify();
  assert.throws(() => candidate.afterCommit(), /projection failed/);
  assert.deepEqual(h.editor.getAuthoringSnapshot(), committed);
  candidate.afterCommit(); assert.equal(h.changes.length, 1); h.destroy();
});

test("newer edits between commit and projection are preserved", async () => {
  const h = await harness(), candidate = h.prepare(saved()); candidate.commit();
  h.editor.restoreExcluded(); const count = h.changes.length;
  assert.throws(() => candidate.afterCommit(), error => error.code === "stale");
  assert.equal(h.editor.getSnapshot().enabled, false); assert.equal(h.changes.length, count); h.destroy();
});

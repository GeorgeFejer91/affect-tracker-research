import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createXrLayoutEditor } from "../site/src/research/xr-layout-editor.js";
import { createXrLayoutAuthoring } from "../site/src/research/xr-layout-authoring.js";
import { createDefaultXrLayoutProfile } from "../site/src/research/xr-layout.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { validatePlannerContributionSnapshot } from "../site/src/research/planner-contributions.js";

const fixture = JSON.parse(await readFile(new URL("fixtures/xr-feedback-envelope-v1.json", import.meta.url)));
const snap = (contribution, revision) => ({ enabled: true, revision, pending: false, contribution, dependencyRevisions: [] });
async function harness(included = true) {
  let paints = 0, notices = 0, current = true, failNotify = false, hold = null;
  const abort = new AbortController(), listeners = new Set(), nodes = new Map();
  const node = () => new Proxy({ value: "", replaceChildren() { paints++; }, append() { paints++; } }, {
    set(target, key, value) { paints++; target[key] = value; return true; },
  });
  const host = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    querySelectorAll: () => [], addEventListener() {}, ownerDocument: { createElement: node } };
  const editor = createXrLayoutEditor(host, { onChange() { notices++; if (failNotify) throw new Error("observer failed"); } });
  const dependencies = {
    P1: snap({ videos: [{ assetId: "a", displayWidth: 1920, displayHeight: 1080 }] }, 4),
    P5: snap({ input: createDefaultResearchSettings().input, ...fixture.cases[0].configuration }, 7),
  };
  const authoring = createXrLayoutAuthoring({ editor, getDependencies: () => dependencies,
    subscribe: [fn => { listeners.add(fn); return () => listeners.delete(fn); }],
    projectCatalogue: async value => { if (hold) await hold; return { revision: value.revision, pending: false, videos: value.contribution.videos }; } });
  await authoring.refresh();
  if (included) editor.restoreDraft({ ...createDefaultXrLayoutProfile(), video: { ...createDefaultXrLayoutProfile().video, distanceMetres: 6 } });
  const options = { isCurrent: () => current, signal: abort.signal };
  return { editor, authoring, options, abort, dependencies,
    count: () => ({ paints, notices }), prepare: () => authoring.prepareConfirmation(options),
    cancel() { current = false; }, failNotify() { failNotify = true; },
    hold() { let release; hold = new Promise(resolve => { release = resolve; }); return release; },
    drift(notify = true) { dependencies.P1.contribution.videos[0].displayWidth++; if (notify) for (const fn of listeners) fn(); },
    destroy() { authoring.destroy(); editor.destroy(); } };
}

for (const included of [true, false]) test(`P6 ${included ? "included" : "excluded"} future snapshot exactly equals committed owner`, async () => {
  const h = await harness(included), before = h.editor.getAuthoringSnapshot(), counts = h.count();
  const candidate = await h.prepare(), future = candidate.snapshot;
  assert.deepEqual(validatePlannerContributionSnapshot(future), future);
  assert.deepEqual(h.editor.getAuthoringSnapshot(), before); assert.deepEqual(h.count(), counts);
  assert.equal(future.revision, before.revision + (included ? 1 : 0));
  assert.equal(future.enabled, included); assert.equal(future.pending, false);
  assert.deepEqual(future.contribution, included ? h.editor.getDraft() : null);
  future.dependencyRevisions.length = 0;
  if (included) future.contribution.video.distanceMetres = 99;
  const expected = candidate.snapshot;
  assert.equal(candidate.isCurrent(), true);
  assert.throws(() => candidate.afterCommit(), error => error.code === "stale");
  candidate.commit();
  assert.deepEqual(h.editor.getSnapshot(), expected); assert.deepEqual(candidate.snapshot, expected);
  assert.deepEqual(h.count(), counts); assert.equal(candidate.isCurrent(), false);
  assert.throws(() => candidate.commit(), error => error.code === "stale");
  candidate.afterCommit(); const projected = h.count(); candidate.afterCommit();
  assert.deepEqual(h.count(), projected); assert.equal(projected.notices, counts.notices + (included ? 1 : 0));
  assert.deepEqual(h.editor.getSnapshot(), expected); h.destroy();
});

for (const action of ["edit", "reset", "dependency", "silent-dependency", "cancel", "abort", "editor-close", "authoring-close"]) {
  test(`P6 ${action} rejects prepared confirmation without additional mutation`, async () => {
    for (const included of [true, false]) {
      const h = await harness(included), candidate = await h.prepare();
      if (action === "edit") h.editor.restoreDraft(createDefaultXrLayoutProfile());
      if (action === "reset") h.editor.restoreExcluded();
      if (action === "dependency") { h.drift(); await h.authoring.refresh(); }
      if (action === "silent-dependency") h.drift(false);
      if (action === "cancel") h.cancel();
      if (action === "abort") h.abort.abort();
      if (action === "editor-close") h.editor.destroy();
      if (action === "authoring-close") h.authoring.destroy();
      const before = h.editor.getAuthoringSnapshot(), counts = h.count();
      assert.equal(candidate.isCurrent(), false);
      assert.throws(() => candidate.commit(), error => error.code === "stale");
      assert.deepEqual(h.editor.getAuthoringSnapshot(), before); assert.deepEqual(h.count(), counts); h.destroy();
    }
  });
}

test("P6 abort and edits during asynchronous validation cannot prepare accepted state", async () => {
  for (const action of ["abort", "edit", "silent-dependency", "destroy"]) {
    const h = await harness(), release = h.hold(), pending = h.prepare();
    if (action === "abort") h.abort.abort();
    if (action === "edit") h.editor.restoreExcluded();
    if (action === "silent-dependency") h.drift(false);
    if (action === "destroy") h.destroy();
    const before = h.editor.getAuthoringSnapshot(), counts = h.count(); release();
    await assert.rejects(pending, error => error.code === "stale");
    assert.deepEqual(h.editor.getAuthoringSnapshot(), before); assert.deepEqual(h.count(), counts); h.destroy();
  }
});

test("P6 pending or silently unbound dependencies reject without refresh or rendering", async () => {
  for (const mismatch of ["pending", "silent"]) {
    const h = await harness();
    if (mismatch === "pending") h.dependencies.P1.pending = true; else h.drift(false);
    const before = h.editor.getAuthoringSnapshot(), counts = h.count();
    await assert.rejects(h.prepare());
    assert.deepEqual(h.editor.getAuthoringSnapshot(), before); assert.deepEqual(h.count(), counts); h.destroy();
  }
});

test("P6 projection failure retains committed confirmation; GUI preparation remains immediate", async () => {
  const h = await harness(), candidate = await h.prepare(); candidate.commit();
  const expected = candidate.snapshot; h.failNotify();
  assert.throws(() => candidate.afterCommit(), /observer failed/);
  assert.deepEqual(h.editor.getSnapshot(), expected); const counts = h.count(); candidate.afterCommit(); assert.deepEqual(h.count(), counts); h.destroy();
  const gui = await harness(), before = gui.count();
  const result = await gui.authoring.prepare();
  assert.equal(result.pending, false); assert.deepEqual(result, gui.editor.getSnapshot());
  assert.ok(gui.count().notices > before.notices); gui.destroy();
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createXrLayoutAuthoring, resolveXrLayoutContribution, resolveXrLayoutDependencies } from "../site/src/research/xr-layout-authoring.js";
import { createXrLayoutState } from "../site/src/research/xr-layout-editor.js";
import { createDefaultXrLayoutProfile, serializeXrLayoutProfileV1 } from "../site/src/research/xr-layout.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";

const fixture = JSON.parse(await readFile(new URL("fixtures/xr-feedback-envelope-v1.json", import.meta.url)));
const profile = createDefaultXrLayoutProfile();
const DEFAULT_SETTINGS = createDefaultResearchSettings();
const snapshot = (contribution, revision) => ({ enabled: true, revision, pending: false, contribution, dependencyRevisions: [] });
const dependencies = () => ({
  P1: snapshot({ revision: 2, videos: [{ assetId: "landscape", displayWidth: 1920, displayHeight: 1080 },
    { assetId: "portrait", displayWidth: 1080, displayHeight: 1920 }] }, 10),
  P5: snapshot({ input: DEFAULT_SETTINGS.input, ...fixture.cases[0].configuration }, 20),
});
const projector = async (value) => ({ catalogueRevision: value.revision, videos: value.videos });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness(project = projector) {
  let current = dependencies();
  const listeners = new Set(), state = createXrLayoutState();
  const writes = [];
  const editor = {
    getSnapshot: state.getSnapshot, getDraft: state.getDraft, acceptLayout: () => { state.accept(); return state.getSnapshot(); },
    setDependencies(value) {
      state.setDependencyRevisions({ catalogue: value.catalogueRevision, feedback: value.feedbackRevision });
      writes.push(structuredClone(value));
    },
    restoreContribution(value, deps) {
      state.load(serializeXrLayoutProfileV1(value), { catalogue: deps.catalogueRevision, feedback: deps.feedbackRevision });
      return state.getSnapshot();
    },
  };
  const authoring = createXrLayoutAuthoring({ editor, projectCatalogue: project,
    getDependencies: () => current,
    subscribe: [(listener) => { listeners.add(listener); return () => listeners.delete(listener); }],
  });
  return { authoring, editor, state, writes, listeners, get: () => current,
    publish(value) { current = value; for (const listener of listeners) listener(); } };
}

test("P6 binds actual owner revisions, all media and the real full P5 envelope", async () => {
  const resolved = await resolveXrLayoutDependencies(dependencies(), projector);
  assert.equal(resolved.catalogueRevision, 10);
  assert.equal(resolved.feedbackRevision, 20);
  assert.deepEqual(resolved.feedbackEnvelope, fixture.cases[0].envelope);
  const contribution = resolveXrLayoutContribution(profile, resolved, "webxr-immersive-vr");
  assert.equal(contribution.videos.length, 2);
  assert.equal(contribution.requirements.anchor, "world-fixed-initial-head-forward");
  assert.equal(contribution.feedback.referenceViewportCssPx, 1024);
  assert.ok(contribution.feedback.halfExtentMetres <= profile.feedback.diameterMetres / (2 * Math.SQRT2));
});

test("P6 refuses missing/pending inputs, incomplete media and absent or incompatible target selection", async () => {
  for (const owner of ["P1", "P5"]) {
    for (const change of [{ pending: true }, { enabled: false }, { contribution: null }, { revision: -1 }]) {
      const value = dependencies(); Object.assign(value[owner], change);
      await assert.rejects(resolveXrLayoutDependencies(value, projector));
    }
  }
  await assert.rejects(resolveXrLayoutDependencies({ P1: dependencies().P1 }, projector));
  const empty = dependencies(); empty.P1.contribution.videos = [];
  await assert.rejects(resolveXrLayoutDependencies(empty, projector), /at least one video/);
  const malformed = dependencies(); malformed.P1.contribution.videos[1].displayWidth = null;
  const badGeometry = await resolveXrLayoutDependencies(malformed, projector);
  assert.throws(() => resolveXrLayoutContribution(profile, badGeometry, profile.target));
  const resolved = await resolveXrLayoutDependencies(dependencies(), projector);
  for (const selectedTarget of [undefined, null, "desktop", "webxr", "quest-apk"]) {
    assert.throws(() => resolveXrLayoutContribution(profile, resolved, selectedTarget), /compatible WebXR/);
  }
  const badFeedback = dependencies(); badFeedback.P5.contribution.input = {};
  await assert.rejects(resolveXrLayoutDependencies(badFeedback, projector));
});

test("live producer invalidation is immediate; an older async scan cannot restore its bounds", async () => {
  const old = deferred(); let delay = false;
  const h = harness(async (value) => { if (delay && value.revision === 3) await old.promise; return projector(value); });
  await h.authoring.refresh(); h.state.setEnabled(true); await h.authoring.accept();
  const before = h.state.getSnapshot();
  h.publish(structuredClone(h.get())); await h.authoring.refresh();
  assert.deepEqual(h.state.getSnapshot(), before, "unchanged notifications do not invalidate");
  delay = true;
  const second = structuredClone(h.get()); second.P1.revision = 11; second.P1.contribution.revision = 3;
  h.publish(second);
  assert.equal(h.state.getSnapshot().pending, true, "withdraw before the projector resolves");
  assert.equal(h.writes.at(-1).catalogueGeometry, null);
  const newest = structuredClone(second); newest.P1.revision = 12; newest.P1.contribution.revision = 4;
  newest.P1.contribution.videos[0].displayWidth = 2560;
  h.publish(newest); await h.authoring.refresh();
  old.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.writes.at(-1).catalogueRevision, 12);
  assert.equal(h.writes.at(-1).catalogueGeometry[0].displayWidth, 2560);
  await h.authoring.accept();
  const pending = structuredClone(newest); pending.P1.pending = true;
  h.publish(pending); await h.authoring.refresh();
  assert.equal(h.state.getSnapshot().pending, true);
  assert.equal(h.authoring.getStatus().pending, true);
  h.authoring.destroy();
});

test("changes with a mistakenly reused owner revision still withdraw accepted P6 geometry", async () => {
  const h = harness(); await h.authoring.refresh(); h.state.setEnabled(true); await h.authoring.accept();
  const changed = structuredClone(h.get()); changed.P5.contribution.visual.grid.cursorSize = 25;
  h.publish(changed);
  assert.equal(h.state.getSnapshot().pending, true);
  await h.authoring.refresh();
  assert.equal(h.state.getSnapshot().contribution, null);
  assert.equal(h.writes.at(-1).feedbackRevision, 20);
  h.authoring.destroy();
});

test("dependency-bound reopen is deterministic and rejected restore leaves editable state intact", async () => {
  const h = harness(); await h.authoring.refresh();
  const options = { dependencies: h.get(), selectedTarget: profile.target, isCurrent: () => true };
  const restored = await h.authoring.restore(profile, options);
  assert.deepEqual(restored.dependencyRevisions, [{ segment: "P1", revision: 10 }, { segment: "P5", revision: 20 }]);
  assert.equal(serializeXrLayoutProfileV1(restored.contribution), serializeXrLayoutProfileV1(profile));
  assert.equal(await h.authoring.validate(profile, options), true);
  for (const overrides of [{ selectedTarget: "desktop" }, { isCurrent: () => false },
    { dependencies: { ...h.get(), P1: { ...h.get().P1, revision: 9 } } }]) {
    const before = h.state.getSnapshot();
    await assert.rejects(h.authoring.restore(profile, { ...options, ...overrides }));
    assert.deepEqual(h.state.getSnapshot(), before);
  }
  h.authoring.destroy();
});

test("edits, dependency changes and teardown fence asynchronous restore and acceptance", async () => {
  for (const action of ["edit", "dependency", "destroy", "cancel"]) {
    const held = deferred(); let delay = false, current = true;
    const h = harness(async (value) => { if (delay) await held.promise; return projector(value); });
    await h.authoring.refresh(); h.state.setEnabled(true); await h.authoring.accept(); delay = true;
    const opening = h.authoring.restore(profile, { selectedTarget: profile.target, isCurrent: () => current });
    await Promise.resolve(); await Promise.resolve();
    if (action === "edit") h.state.setDraft({ ...profile, video: { ...profile.video, distanceMetres: 5 } });
    if (action === "dependency") { const next = structuredClone(h.get()); next.P5.revision += 1; h.publish(next); }
    if (action === "destroy") h.authoring.destroy();
    if (action === "cancel") current = false;
    held.resolve();
    await assert.rejects(opening, /changed/);
    if (action === "edit") assert.equal(h.state.getDraft().video.distanceMetres, 5);
    h.authoring.destroy(); assert.equal(h.listeners.size, 0);
  }
});

test("explicitly disabled XR needs no producers and remains absent from desktop v1", async () => {
  const h = harness(); h.publish({ P1: null, P5: null }); await h.authoring.refresh();
  assert.equal((await h.authoring.accept()).enabled, false);
  const registry = createPlannerContributionRegistry(); registry.register("P6", h.state.getSnapshot);
  await registry.assertPackageV1({});
  h.state.setEnabled(true);
  await assert.rejects(h.authoring.accept(), /Connect valid P1/);
  await assert.rejects(registry.assertPackageV1({}));
  h.authoring.destroy();
});

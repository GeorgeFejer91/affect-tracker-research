import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createXrLayoutAuthoring, resolveXrLayoutContribution, resolveXrLayoutDependencies } from "../site/src/research/xr-layout-authoring.js";
import { createXrLayoutState } from "../site/src/research/xr-layout-editor.js";
import { createDefaultXrLayoutProfile, serializeXrLayoutProfileV1 } from "../site/src/research/xr-layout.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { createVideoCatalogueProducerV1 } from "../site/src/research/video-catalogue-contribution.js";
import { createWorkspaceContributionProducerV1, projectWorkspaceVideoDisplayGeometryV1 } from "../site/src/research/workspace-contribution.js";
import { createStudyIdentityV1 } from "../site/src/research/study-identity.js";
import { createFeedbackContributionSource } from "../site/src/research/feedback-contribution.js";

const fixture = JSON.parse(await readFile(new URL("fixtures/xr-feedback-envelope-v1.json", import.meta.url)));
const feedbackV2 = JSON.parse(await readFile(new URL("fixtures/research-feedback-settings-v2.json", import.meta.url)));
const profile = createDefaultXrLayoutProfile();
const DEFAULT_SETTINGS = createDefaultResearchSettings();
const snapshot = (contribution, revision) => ({ enabled: true, revision, pending: false, contribution, dependencyRevisions: [] });
const dependencies = () => ({
  P1: snapshot({ revision: 2, videos: [{ assetId: "landscape", displayWidth: 1920, displayHeight: 1080 },
    { assetId: "portrait", displayWidth: 1080, displayHeight: 1920 }] }, 10),
  P5: snapshot({ input: DEFAULT_SETTINGS.input, ...fixture.cases[0].configuration }, 20),
});
const projector = async (value) => ({ revision: value.revision, pending: false, videos: value.contribution.videos });
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
    restoreDraft(value) { state.loadDraft(serializeXrLayoutProfileV1(value)); return state.getSnapshot(); },
    restoreExcluded() { state.resetExcluded(); return state.getSnapshot(); },
    prepareRestoreSelection(selection, options) {
      const candidate = state.prepareRestoreSelection(selection, options);
      return { ...candidate, commit() { candidate.commit(); return state.getSnapshot(); }, afterCommit() {} };
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
  const h = harness(async (value) => { if (delay && value.contribution.revision === 3) await old.promise; return projector(value); });
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

test("successor response and halo edits invalidate live XR using the complete P5 payload", async () => {
  const h = harness(), value = dependencies(); value.P5.contribution = structuredClone(feedbackV2);
  h.publish(value); await h.authoring.refresh(); h.state.setEnabled(true); await h.authoring.prepare();
  const previous = h.writes.at(-1).feedbackEnvelope.configurationKey;
  const changed = structuredClone(value); changed.P5.revision += 1;
  changed.P5.contribution.response.repeatDelayMs += 100;
  changed.P5.contribution.presentation.halo.widthPercent += 40;
  h.publish(changed); assert.equal(h.state.getSnapshot().pending, true);
  await h.authoring.refresh();
  assert.equal(h.writes.at(-1).feedbackEnvelope.algorithmVersion, "feedback-envelope-v2");
  assert.notEqual(h.writes.at(-1).feedbackEnvelope.configurationKey, previous);
  assert.equal((await h.authoring.prepare()).dependencyRevisions[1].revision, changed.P5.revision);
  const invalid = structuredClone(changed); delete invalid.P5.contribution.response;
  h.publish(invalid); await h.authoring.refresh();
  await assert.rejects(h.authoring.prepare());
  assert.equal(h.state.getSnapshot().contribution, null);
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
  for (const action of ["edit", "dependency", "destroy", "cancel", "exclude", "replace-selection"]) {
    const held = deferred(); let delay = false, current = true;
    const h = harness(async (value) => { if (delay) await held.promise; return projector(value); });
    await h.authoring.refresh(); h.state.setEnabled(true); await h.authoring.accept(); delay = true;
    const opening = h.authoring.restore(profile, { selectedTarget: profile.target, isCurrent: () => current });
    await Promise.resolve(); await Promise.resolve();
    if (action === "edit") h.state.setDraft({ ...profile, video: { ...profile.video, distanceMetres: 5 } });
    if (action === "dependency") { const next = structuredClone(h.get()); next.P5.revision += 1; h.publish(next); }
    if (action === "destroy") h.authoring.destroy();
    if (action === "cancel") current = false;
    if (action === "exclude") h.authoring.restoreSelection({ status: "excluded" }, { isCurrent: () => true });
    if (action === "replace-selection") h.authoring.restoreSelection({ status: "included", profile:
      { ...profile, video: { ...profile.video, distanceMetres: 6 } } }, { isCurrent: () => true });
    held.resolve();
    await assert.rejects(opening, /changed/);
    if (action === "edit") assert.equal(h.state.getDraft().video.distanceMetres, 5);
    if (action === "exclude") assert.equal(h.state.getSnapshot().enabled, false);
    if (action === "replace-selection") assert.equal(h.state.getDraft().video.distanceMetres, 6);
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

test("footer preparation validates a dirty draft without P7 acceptance and obeys cancellation", async () => {
  const held = deferred(); let delay = false, current = true;
  const h = harness(async (value) => { if (delay) await held.promise; return projector(value); });
  await h.authoring.refresh(); h.state.setEnabled(true);
  const registry = createPlannerContributionRegistry(); registry.register("P6", h.state.getSnapshot);
  assert.equal(h.state.getSnapshot().pending, true);
  const prepared = await h.authoring.prepare({ isCurrent: () => current });
  assert.equal(prepared.pending, false);
  assert.equal(registry.readAccepted().entries.some((entry) => entry.segment === "P6" && entry.status === "accepted"), false);
  h.state.setDraft({ ...profile, video: { ...profile.video, distanceMetres: 4 } });
  const before = h.state.getSnapshot(); delay = true;
  const preparing = h.authoring.prepare({ isCurrent: () => current });
  await Promise.resolve(); await Promise.resolve(); current = false; held.resolve();
  await assert.rejects(preparing, /changed/);
  assert.deepEqual(h.state.getSnapshot(), before);
  await assert.rejects(h.authoring.prepare({ isCurrent: () => false }), /changed/);
  h.authoring.destroy();
});

test("content-only reopen renders saved XR settings while real media remains pending", async () => {
  const h = harness(); await h.authoring.refresh(); h.state.setEnabled(true); await h.authoring.prepare();
  const missing = dependencies(); missing.P1.pending = true; missing.P1.contribution = null;
  h.publish(missing); await h.authoring.refresh();
  const saved = { ...profile, video: { ...profile.video, distanceMetres: 4 } };
  const draft = h.authoring.restoreDraft(saved, { isCurrent: () => true });
  assert.equal(draft.enabled, true); assert.equal(draft.pending, true); assert.equal(draft.contribution, null);
  assert.deepEqual(h.state.getDraft(), saved);
  await assert.rejects(h.authoring.prepare());
  assert.throws(() => h.authoring.restoreDraft(profile, { isCurrent: () => false }), /changed/);
  assert.throws(() => h.authoring.restoreDraft({ ...saved, target: "desktop" }));
  assert.deepEqual(h.state.getSnapshot(), draft); assert.deepEqual(h.state.getDraft(), saved);
  h.publish(dependencies()); await h.authoring.refresh();
  assert.equal((await h.authoring.prepare()).contribution.video.distanceMetres, 4);
  h.authoring.destroy(); assert.throws(() => h.authoring.restoreDraft(profile), /changed/);
});

test("master XR exclusion discards prior document state and included restore requires fresh preparation", async () => {
  const h = harness(); await h.authoring.refresh();
  const saved = { ...profile, video: { ...profile.video, distanceMetres: 7 } };
  const included = { status: "included", profile: saved }, excluded = { status: "excluded" };
  assert.throws(() => h.authoring.restoreSelection(included), /current-request guard/);
  h.authoring.restoreSelection(included, { isCurrent: () => true }); await h.authoring.prepare();
  for (const invalid of [{ status: "excluded", profile: saved }, { status: "included" }, { status: "off" }]) {
    const before = h.state.getSnapshot();
    assert.throws(() => h.authoring.restoreSelection(invalid, { isCurrent: () => true }));
    assert.deepEqual(h.state.getSnapshot(), before);
  }
  assert.throws(() => h.authoring.restoreSelection(excluded, { isCurrent: () => false }), /changed/);
  assert.equal(h.state.getDraft().video.distanceMetres, 7);
  const result = h.authoring.restoreSelection(excluded, { isCurrent: () => true });
  assert.equal(result.enabled, false); assert.equal(result.contribution, null);
  assert.deepEqual(h.state.getDraft(), profile, "no profile exists in an excluded recipe");
  h.state.setEnabled(true); assert.equal(h.state.getSnapshot().pending, true);
  h.authoring.restoreSelection(included, { isCurrent: () => true });
  assert.deepEqual(h.state.getDraft(), saved); assert.equal(h.state.getSnapshot().pending, true);
  h.authoring.destroy(); assert.throws(() => h.authoring.restoreSelection(excluded, { isCurrent: () => true }), /changed/);
});

test("P6 composes the committed P1/P5 producers and rejects a tampered or withdrawn catalogue", async () => {
  const catalogue = JSON.parse(await readFile(new URL("fixtures/research-video-catalogue-contribution-v1.json", import.meta.url)));
  const videos = createVideoCatalogueProducerV1();
  let study = createStudyIdentityV1({ id: "xr-study", title: "XR study" });
  const p1 = createWorkspaceContributionProducerV1({ getStudyIdentity: () => study, getVideoCatalogueSnapshot: videos.getSnapshot });
  let feedback = { input: DEFAULT_SETTINGS.input, ...fixture.cases[0].configuration };
  const p5 = createFeedbackContributionSource(() => feedback);
  await videos.replaceEntries(catalogue.entries);
  const current = () => ({ P1: p1.getSnapshot(), P5: p5.getSnapshot() });
  const resolved = await resolveXrLayoutDependencies(current(), projectWorkspaceVideoDisplayGeometryV1);
  const ready = resolveXrLayoutContribution(profile, resolved, profile.target);
  assert.deepEqual(ready.videos.map(({ assetId }) => assetId), catalogue.entries.map(({ assetId }) => assetId));
  assert.deepEqual(ready.videos[0].geometry.videoCentre, ready.videos[1].geometry.videoCentre);
  const tampered = structuredClone(current()); tampered.P1.contribution.videoCatalogue.entries[0].geometry.displayWidthPx += 1;
  await assert.rejects(resolveXrLayoutDependencies(tampered, projectWorkspaceVideoDisplayGeometryV1));
  const invalidStudy = structuredClone(current()); invalidStudy.P1.contribution.study.title = "";
  await assert.rejects(resolveXrLayoutDependencies(invalidStudy, projectWorkspaceVideoDisplayGeometryV1));
  const h = harness(projectWorkspaceVideoDisplayGeometryV1); h.publish(current()); await h.authoring.refresh();
  h.state.setEnabled(true); await h.authoring.prepare();
  const unsubscribe = p1.subscribe(() => h.publish(current()));
  const embeddedRevision = current().P1.contribution.videoCatalogue.revision;
  study = createStudyIdentityV1({ id: "xr-study", title: "Updated XR study" }); p1.changed();
  assert.equal(h.state.getSnapshot().pending, true, "study-only change withdraws P6 immediately");
  await h.authoring.refresh(); await h.authoring.prepare();
  assert.notEqual(h.state.getSnapshot().dependencyRevisions[0].revision, resolved.catalogueRevision);
  assert.equal(current().P1.contribution.videoCatalogue.revision, embeddedRevision);
  assert.equal(h.state.getSnapshot().dependencyRevisions[0].revision, current().P1.revision);
  unsubscribe(); h.authoring.destroy();
  feedback = { ...feedback, visual: { ...feedback.visual, grid: { ...feedback.visual.grid, cursorSize: 99 } } };
  const changed = await resolveXrLayoutDependencies(current(), projectWorkspaceVideoDisplayGeometryV1);
  assert.notEqual(changed.feedbackRevision, resolved.feedbackRevision);
  assert.notEqual(changed.feedbackEnvelope.configurationKey, resolved.feedbackEnvelope.configurationKey);
  videos.withdraw();
  await assert.rejects(resolveXrLayoutDependencies(current(), projectWorkspaceVideoDisplayGeometryV1));
  p5.destroy();
});

test("independent P1/P5/P6 processes reproduce every profile's exact bytes and geometry without ambient inputs", async () => {
  const run = promisify(execFile), entry = fileURLToPath(new URL("fixtures/xr-authoring-instance.js", import.meta.url));
  const results = await Promise.all(["de-DE", "en-US"].map((locale) => run(process.execPath, [entry], {
    windowsHide: true, env: { ...process.env, LANG: locale, TZ: locale === "de-DE" ? "Europe/Berlin" : "UTC" },
  })));
  assert.equal(results[0].stdout, results[1].stdout);
  const receipts = JSON.parse(results[0].stdout);
  assert.equal(receipts.length, fixture.cases.length);
  for (const receipt of receipts) {
    assert.equal(receipt.catalogueRevision, 17);
    assert.equal(receipt.feedbackRevision, 29);
    assert.equal(receipt.resolved.videos.length, 2);
  }
});

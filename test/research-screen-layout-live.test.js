import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { resolveFeedbackEnvelopeV1 } from "../site/src/research/feedback-envelope.js";
import { createScreenLayoutDraft, convertScreenLayoutDraftUnits, resolveScreenLayoutDraft } from "../site/src/research/screen-layout-draft.js";
import { createScreenLayoutState, validateScreenLayoutDraftDocument, validateScreenLayoutContribution } from "../site/src/research/screen-layout-state.js";
import { createScreenLayoutDependencyBinding, screenLayoutReferenceCandidates } from "../site/src/research/screen-layout-dependencies.js";
import { createVideoCatalogueProducerV1, projectVideoDisplayGeometryV1 } from "../site/src/research/video-catalogue-contribution.js";
import { createFeedbackContributionSource } from "../site/src/research/feedback-contribution.js";
import { connectScreenLayoutProducers } from "../site/src/research/screen-layout-composition.js";
import { createWorkspaceContributionV1 } from "../site/src/research/workspace-contribution.js";
import { createStudyIdentityV1 } from "../site/src/research/study-identity.js";

const clone = value => structuredClone(value);
const DEFAULT_SETTINGS = createDefaultResearchSettings();
test("production P4 connection accepts controlled workspace3 and retains owner identity", async () => {
  const { workspace } = JSON.parse(await readFile(new URL("./fixtures/controlled-video-geometry-v3.json", import.meta.url), "utf8"));
  const settings = createDefaultResearchSettings();
  const feedback = createFeedbackContributionSource(() => ({ input: settings.input, visual: settings.visual, mappings: settings.advanced.mappings }));
  const snapshot = { revision: 73, enabled: true, pending: false, contribution: workspace, dependencyRevisions: [] };
  let binding, pending;
  const controller = {
    getWorkspaceContributionSnapshot: () => snapshot,
    subscribeWorkspaceContributionChanges: () => () => {},
    subscribeFeedbackChanges: () => () => {},
    getFeedbackLayoutSnapshot: feedback.getLayoutSnapshot,
    getFeedbackContributionSnapshot: feedback.getSnapshot,
    connectScreenLayoutDependencies(dependencies) {
      binding = createScreenLayoutDependencyBinding(dependencies);
      pending = binding.refreshCatalogue();
    },
  };
  const disconnect = connectScreenLayoutProducers(controller);
  try {
    await pending;
    const result = binding.resolve({ ...createScreenLayoutDraft(), referencePolicy: "largest-oriented-area" });
    assert.equal(result.issues.some(issue => issue.code.startsWith("catalogue-")), false);
    assert.ok(result.referenceCandidates.largestVideo);
    const expected = [...new Map(workspace.videoCatalogue.entries.map(entry => [entry.assetId, {
      assetId: entry.assetId, displayWidth: entry.geometry.displayWidthPx, displayHeight: entry.geometry.displayHeightPx,
    }])).values()];
    assert.deepEqual(binding.getMediaGeometry(), expected);
    assert.equal(result.dependencyRevisions.find(value => value.segment === "P1").revision, 73);
    assert.deepEqual(binding.getContentDependencies().workspace, workspace);
  } finally { disconnect(); binding.destroy(); feedback.destroy(); }
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const config = () => ({ visual: clone(DEFAULT_SETTINGS.visual), mappings: clone(DEFAULT_SETTINGS.advanced.mappings) });
const draft = () => ({ ...createScreenLayoutDraft(), referencePolicy: "largest-oriented-area", referenceWidth: 1280 / 1920 * 100, referenceHeight: 720 / 1080 * 100,
  referenceX: 50, referenceY: 400 / 1080 * 100, diameter: 20, offsetY: 500 / 720 * 100, gap: 0 });
// Explicit synthetic P1 API fixture. Actual producer conformance is checked separately.
function catalogue(revision = 7) {
  return { revision, enabled: true, pending: false, dependencyRevisions: [], contribution: { revision: 2, entries: [
    { assetId: `asset-${"a".repeat(64)}`, annotationId: "Landscape", width: 1920, height: 1080 },
    { assetId: `asset-${"b".repeat(64)}`, annotationId: "Portrait", width: 1080, height: 1920 },
    { assetId: `asset-${"c".repeat(64)}`, annotationId: "Wide", width: 2560, height: 720 },
  ] } };
}
const project = async value => ({ catalogueRevision: value.revision,
  videos: value.entries.map(e => ({ assetId: e.assetId, displayWidth: e.width, displayHeight: e.height })) });

function harness({ projectCatalogue = project } = {}) {
  let p1 = catalogue(), p5 = 3, pending = false, configuration = config();
  let owner;
  const binding = createScreenLayoutDependencyBinding({ getCatalogueSnapshot: () => p1, projectCatalogue,
    getFeedbackLayoutSnapshot: side => ({ revision: p5, pending,
      envelope: pending ? null : resolveFeedbackEnvelopeV1(configuration, side) }),
    onChange: () => owner?.refreshDependencies() });
  owner = createScreenLayoutState({ resolve: next => binding.resolve(next) });
  owner.replaceDraft(draft());
  return { binding, owner, get p1() { return p1; }, set p1(value) { p1 = value; },
    changeFeedback(update, valid = true) { update?.(configuration); p5 += 1; pending = !valid; binding.refreshFeedback(); } };
}

test("live P4 fit consumes owner geometry and actual P5 bounds with outer dependency revisions", async () => {
  const h = harness();
  await h.binding.refreshCatalogue();
  const p = h.owner.projection;
  assert.deepEqual(p.dependencyRevisions, [{ segment: "P1", revision: 7 }, { segment: "P5", revision: 3 }]);
  assert.equal(p.inputKind, "live");
  assert.equal(p.videos.length, 3);
  near(p.videos[1].bounds.width, 405);
  const expected = resolveFeedbackEnvelopeV1(config(), p.geometry.feedback.width);
  near(p.geometry.maximumFeedback.width, expected.halfExtentCssPx * 2);
  for (const v of p.videos) { near(v.bounds.cx, 960); near(v.bounds.cy, 400); assert.equal(v.boundKind, "saved-maximum"); }
  assert.equal(p.exportable, false);
  assert.equal(h.owner.getSnapshot().contribution, null);
  await assert.rejects(validateScreenLayoutContribution(), /missing or unexpected/u);
});

test("chosen automatic reference is deterministic across catalogue traversal order", async () => {
  const h = harness();
  assert.equal(h.owner.projection.geometry, null);
  await h.binding.refreshCatalogue();
  const before = h.owner.projection.geometry;
  h.p1 = { ...h.p1, revision: 8, contribution: { ...h.p1.contribution, entries: [...h.p1.contribution.entries].reverse() } };
  await h.binding.refreshCatalogue();
  assert.deepEqual(h.owner.projection.geometry, before);
  const media = h.p1.contribution.entries.map(e => ({ id: e.assetId, width: e.width, height: e.height }));
  const result = screenLayoutReferenceCandidates(media);
  assert.deepEqual(result, screenLayoutReferenceCandidates([...media].reverse()));
  assert.equal(result.largestVideo.assetId, `asset-${"a".repeat(64)}`);
  assert.deepEqual(result.maximumDimensions, { width: 2560, height: 1920 });
});

test("catalogue withdrawal and saved feedback edits invalidate immediately and clear affected bounds", async () => {
  const h = harness(); await h.binding.refreshCatalogue();
  const before = h.owner.getSnapshot().revision;
  h.p1 = { ...h.p1, revision: 8, pending: true, contribution: null };
  const refresh = h.binding.refreshCatalogue();
  assert.equal(h.owner.projection.videos.length, 0);
  assert.ok(h.owner.getSnapshot().revision > before);
  await refresh;
  const r = h.owner.getSnapshot().revision;
  h.changeFeedback(null, false);
  assert.equal(h.owner.projection.geometry, null);
  assert.ok(h.owner.getSnapshot().revision > r);
  h.changeFeedback(c => { c.visual.flubber.outlineThickness = 20; }, true);
  assert.equal(h.owner.projection.geometry, null);
  h.p1 = catalogue(9); await h.binding.refreshCatalogue();
  assert.ok(h.owner.projection.geometry.maximumFeedback.width > 0);
});

test("complete catalogue validation rejects duplicate, missing, unsupported, oversized and partial projections", async () => {
  for (const mutate of [
    p => { p.videos.push(p.videos[0]); }, p => { p.videos[0].displayWidth = 0; },
    p => { p.videos[0].displayHeight = 32769; }, p => { p.videos.pop(); },
    p => { p.catalogueRevision += 1; }, p => { p.videos[0].assetId = "unknown"; },
  ]) {
    const h = harness({ projectCatalogue: async value => { const p = await project(value); mutate(p); return p; } });
    await h.binding.refreshCatalogue();
    assert.deepEqual(h.owner.projection.videos, []);
    assert.ok(h.owner.projection.issues.some(i => i.code === "catalogue-invalid"));
  }
  const h = harness({ projectCatalogue: async () => { throw new TypeError("Unverified geometry."); } });
  await h.binding.refreshCatalogue();
  assert.equal(h.owner.projection.videos.length, 0);
});

test("slow catalogue validation cannot reinstate withdrawn geometry or survive teardown", async () => {
  for (const destroy of [false, true]) {
    const wait = deferred();
    const h = harness({ projectCatalogue: async value => { await wait.promise; return project(value); } });
    const operation = h.binding.refreshCatalogue();
    if (destroy) h.binding.destroy();
    else { h.p1 = { ...h.p1, revision: 8, pending: true, contribution: null }; await h.binding.refreshCatalogue(); }
    wait.resolve(); await operation;
    assert.deepEqual(h.owner.projection.videos, []);
  }
});

test("reused and regressed catalogue revisions cannot assert new geometry", async () => {
  for (const revision of [6, 7]) {
    const h = harness(); await h.binding.refreshCatalogue();
    h.p1 = clone(h.p1); h.p1.revision = revision; h.p1.contribution.entries[0].width = 2000;
    await h.binding.refreshCatalogue();
    assert.equal(h.owner.projection.videos.length, 0);
    assert.ok(h.owner.projection.issues.some(i => i.code === "catalogue-invalid"));
  }
});

test("P4 size edits recalculate P5 envelope without fabricating its revision; physical conversion preserves bounds", async () => {
  const h = harness(); await h.binding.refreshCatalogue();
  const d = { ...h.owner.draft, physicalWidth: 480, physicalHeight: 270, fullViewportMapping: true };
  h.owner.replaceDraft(d);
  const before = h.owner.projection;
  h.owner.replaceDraft(convertScreenLayoutDraftUnits(d, "mm").draft);
  near(h.owner.projection.geometry.maximumFeedback.width, before.geometry.maximumFeedback.width);
  h.owner.replaceDraft({ ...h.owner.draft, diameter: 50 });
  assert.equal(h.owner.getSnapshot().dependencyRevisions.find(d => d.segment === "P5").revision, 3);
  assert.notEqual(h.owner.projection.geometry.maximumFeedback.width, before.geometry.maximumFeedback.width);
});

test("draft restoration is closed, recoverable, and independent of imported dependency claims", async () => {
  const h = harness(); await h.binding.refreshCatalogue();
  const saved = h.owner.getDraftDocument();
  h.owner.replaceDraft({ ...h.owner.draft, diameter: "" });
  const invalid = h.owner.getDraftDocument();
  assert.equal(h.owner.projection.geometry, null);
  h.changeFeedback(null, false);
  const snapshot = await h.owner.restoreDraft(saved);
  assert.equal(snapshot.pending, true); assert.equal(snapshot.contribution, null);
  assert.equal(h.owner.projection.geometry.maximumFeedback, null);
  await h.owner.restoreDraft(invalid);
  assert.equal(h.owner.draft.diameter, ""); assert.equal(h.owner.projection.geometry, null);
  const before = h.owner.getSnapshot();
  for (const malformed of [
    { ...saved, version: 99 }, { ...saved, dependencyRevisions: [{ segment: "P1", revision: 7 }] },
    { ...saved, draft: { ...saved.draft, diameter: Infinity } }, { ...saved, draft: { ...saved.draft, unknown: 1 } },
    { ...saved, draft: { ...saved.draft, offsetX: "x".repeat(129) } },
  ]) await assert.rejects(h.owner.restoreDraft(malformed), /draft/u);
  assert.deepEqual(h.owner.getSnapshot(), before);
  const copy = validateScreenLayoutDraftDocument(saved); copy.draft.diameter = 99;
  assert.notEqual(saved.draft.diameter, 99);
});

test("stale restore, interleaved edits and destroyed owners cannot change current draft", async () => {
  for (const mode of ["guard", "edit", "destroy"]) {
    const state = createScreenLayoutState();
    const document = state.getDraftDocument(); document.draft.diameter = 40;
    const restored = state.restoreDraft(document, { isCurrent: () => mode !== "guard" });
    if (mode === "edit") state.replaceDraft({ ...state.draft, diameter: 30 });
    if (mode === "destroy") state.destroy();
    await assert.rejects(restored, /stale/u);
    assert.equal(state.draft.diameter, mode === "edit" ? 30 : 24);
  }
});

test("snapshots and projection copies cannot mutate owner state; no-op refresh does not invent revisions", async () => {
  const h = harness(); await h.binding.refreshCatalogue();
  const before = h.owner.getSnapshot();
  h.owner.refreshDependencies(); h.owner.replaceDraft(h.owner.draft);
  await h.binding.refreshCatalogue();
  assert.deepEqual(h.owner.getSnapshot(), before);
  const copy = h.owner.projection; copy.geometry.feedback.cx = 0;
  assert.notEqual(h.owner.projection.geometry.feedback.cx, 0);
  const snap = h.owner.getSnapshot(); snap.dependencyRevisions[0].revision = 999;
  assert.deepEqual(h.owner.getSnapshot(), before);
});

test("actual P1 shared conformance fixture and P5 source compose through one subscription lifecycle", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/research-video-catalogue-contribution-v1.json", import.meta.url), "utf8"));
  const p1 = createVideoCatalogueProducerV1();
  await p1.replaceEntries(fixture.entries);
  let configuration = { input: clone(DEFAULT_SETTINGS.input), ...config() };
  const p5 = createFeedbackContributionSource(() => configuration);
  let binding, state, pending;
  state = createScreenLayoutState({ resolve: d => binding ? binding.resolve(d) : resolveScreenLayoutDraft(d) });
  state.replaceDraft({ ...state.draft, referencePolicy: "largest-oriented-area" });
  const controller = {
    getWorkspaceContributionSnapshot() {
      const snapshot = p1.getSnapshot();
      return { ...snapshot, contribution: snapshot.contribution ? createWorkspaceContributionV1({
        study: createStudyIdentityV1({ id: "fixture", title: "Fixture" }), videoCatalogue: snapshot.contribution,
      }) : null };
    },
    subscribeWorkspaceContributionChanges: p1.subscribe,
    getFeedbackLayoutSnapshot: p5.getLayoutSnapshot,
    subscribeFeedbackChanges: p5.subscribe,
    connectScreenLayoutDependencies(dependencies) {
      binding = createScreenLayoutDependencyBinding({ ...dependencies, onChange: () => state.refreshDependencies() });
      pending = binding.refreshCatalogue(); return pending;
    },
    refreshScreenLayoutCatalogue() { pending = binding.refreshCatalogue(); return pending; },
    refreshScreenLayoutFeedback() { binding.refreshFeedback(); },
  };
  const disconnect = connectScreenLayoutProducers(controller);
  await pending;
  const projected = await projectVideoDisplayGeometryV1(fixture);
  assert.deepEqual(state.projection.videos.map(v => [v.id, v.displayWidth, v.displayHeight]),
    projected.videos.map(v => [v.assetId, v.displayWidth, v.displayHeight]));
  assert.equal(state.getSnapshot().dependencyRevisions[0].revision, p1.getSnapshot().revision);
  const before = state.getSnapshot().revision;
  configuration.visual.flubber.outlineThickness = 20; p5.refresh();
  assert.ok(state.getSnapshot().revision > before);
  p1.withdraw(); await pending;
  assert.deepEqual(state.projection.videos, []);
  disconnect();
  const stopped = state.getSnapshot();
  configuration.visual.flubber.outlineThickness = 10; p5.refresh();
  assert.deepEqual(state.getSnapshot(), stopped);
  binding.destroy(); state.destroy(); p5.destroy();
});

test("wrong algorithm, centre, viewport and nonfinite P5 extents never become fit evidence", () => {
  for (const mutate of [
    e => { e.algorithmVersion = "other"; }, e => { e.origin = "animated-centroid"; },
    e => { e.overlaySideCssPx += 1; }, e => { e.halfExtentCssPx = -1; },
    e => { e.halfExtentCssPx = Number.MAX_VALUE; }, e => { e.configurationKey = ""; },
  ]) {
    const binding = createScreenLayoutDependencyBinding({ getFeedbackLayoutSnapshot: side => {
      const envelope = clone(resolveFeedbackEnvelopeV1(config(), side)); mutate(envelope);
      return { revision: 1, pending: false, envelope };
    } });
    const p = binding.resolve(draft());
    assert.equal(p.geometry, null);
    assert.ok(p.issues.some(i => i.code === "feedback-unavailable"));
  }
});

test("hidden feedback has no painted overlap and invalid P4 fields still track saved dependency revisions", async () => {
  const h = harness(); await h.binding.refreshCatalogue();
  h.changeFeedback(c => { c.visual.hideFeedback = true; });
  h.owner.replaceDraft({ ...h.owner.draft, offsetY: 0 });
  assert.equal(h.owner.projection.geometry.maximumFeedback.width, 0);
  assert.equal(h.owner.projection.issues.some(i => i.code === "video-overlap"), false);
  h.owner.replaceDraft({ ...h.owner.draft, diameter: "" });
  const r = h.owner.getSnapshot().revision;
  h.changeFeedback(c => { c.visual.hideFeedback = false; });
  assert.equal(h.owner.projection.geometry, null);
  assert.ok(h.owner.getSnapshot().revision > r);
});

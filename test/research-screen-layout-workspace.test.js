import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createStudyIdentityV1 } from "../site/src/research/study-identity.js";
import { createVideoCatalogueProducerV1, projectVideoDisplayGeometryV1 } from "../site/src/research/video-catalogue-contribution.js";
import { createWorkspaceContributionProducerV1, projectWorkspaceVideoCatalogueSnapshotV1 } from "../site/src/research/workspace-contribution.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { createFeedbackContributionSource } from "../site/src/research/feedback-contribution.js";
import { createScreenLayoutDependencyBinding } from "../site/src/research/screen-layout-dependencies.js";
import { createScreenLayoutState } from "../site/src/research/screen-layout-state.js";
import { createWorkspaceContribution, projectWorkspaceVideoCatalogueSnapshot } from "../site/src/research/workspace-contribution.js";
import { projectVideoDisplayGeometry } from "../site/src/research/video-catalogue-contribution.js";
import { desktopLayoutDraftFromProfile, desktopLayoutProfileFromDraft, resolveDesktopLayoutContribution } from "../site/src/research/desktop-layout-contribution.js";
import { resolveFeedbackEnvelope } from "../site/src/research/feedback-layout.js";

test("P4 tracks one registered workspace revision across study edits, video edits and restoration", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/research-video-catalogue-contribution-v1.json", import.meta.url), "utf8"));
  const raw = createVideoCatalogueProducerV1(); await raw.replaceEntries(fixture.entries);
  let study = createStudyIdentityV1({ id: "layout-study", title: "Layout study" });
  const workspace = createWorkspaceContributionProducerV1({ getStudyIdentity: () => study, getVideoCatalogueSnapshot: raw.getSnapshot });
  const detachRaw = raw.subscribe(() => workspace.changed());
  const settings = createDefaultResearchSettings();
  const feedback = createFeedbackContributionSource(() => ({ input: settings.input, visual: settings.visual, mappings: settings.advanced.mappings }));
  let state, pending;
  const binding = createScreenLayoutDependencyBinding({ getCatalogueSnapshot: workspace.getSnapshot,
    projectSnapshot: projectWorkspaceVideoCatalogueSnapshotV1,
    projectCatalogue: projectVideoDisplayGeometryV1, getFeedbackLayoutSnapshot: feedback.getLayoutSnapshot,
    onChange: () => state?.refreshDependencies() });
  state = createScreenLayoutState({ resolve: d => binding.resolve(d) });
  state.replaceDraft({ ...state.draft, referencePolicy: "largest-oriented-area" });
  const detach = workspace.subscribe(() => { pending = binding.refreshCatalogue(); });
  await binding.refreshCatalogue();
  const source = workspace.getSnapshot(), initial = state.getSnapshot(), originalGeometry = state.projection.geometry;
  const document = state.getDraftDocument();
  const bound = () => state.getSnapshot().dependencyRevisions.find(d => d.segment === "P1").revision;
  assert.equal(bound(), source.revision);
  study = createStudyIdentityV1({ id: "renamed-study", title: "Renamed study" }); workspace.changed(); await pending;
  assert.ok(bound() > source.revision);
  assert.equal(bound(), workspace.getSnapshot().revision);
  assert.deepEqual(workspace.getSnapshot().contribution.videoCatalogue, source.contribution.videoCatalogue);
  assert.deepEqual(state.projection.geometry, originalGeometry);
  assert.ok(state.getSnapshot().revision > initial.revision);
  const projected = await projectWorkspaceVideoCatalogueSnapshotV1(workspace.getSnapshot());
  assert.deepEqual(projected, workspace.getVideoCatalogueSnapshot());
  const catalogueBefore = projected.contribution;
  const next = structuredClone(fixture.entries); next[0].durationMs += 1;
  await raw.replaceEntries(next); await pending;
  assert.equal(bound(), workspace.getSnapshot().revision);
  assert.notEqual(workspace.getSnapshot().contribution.videoCatalogue.integritySha256, catalogueBefore.integritySha256);
  await state.restoreDraft(document);
  assert.equal(bound(), workspace.getSnapshot().revision);
  assert.equal(state.getSnapshot().contribution, null);
  study = null; workspace.changed(); await pending;
  assert.deepEqual(state.projection.videos, []);
  assert.equal(bound(), workspace.getSnapshot().revision);
  assert.equal(state.getSnapshot().pending, true);
  detach(); detachRaw(); binding.destroy(); state.destroy(); feedback.destroy();
});

test("live P4 v2 binding covers unique content while preserving every P1 location declaration", async () => {
  const catalogue = JSON.parse(await readFile(new URL("./fixtures/research-video-catalogue-contribution-v2.json", import.meta.url), "utf8"));
  const fixture = JSON.parse(await readFile(new URL("./fixtures/desktop-layout-candidates-v1.json", import.meta.url), "utf8"));
  const workspace = createWorkspaceContribution({ study: fixture.workspace.study, videoCatalogue: catalogue });
  const { videos } = await projectVideoDisplayGeometry(catalogue);
  const draft = desktopLayoutDraftFromProfile(fixture.cases[0].profile);
  const profile = desktopLayoutProfileFromDraft(draft, videos);
  const p1 = { revision: 71, enabled: true, pending: false, contribution: workspace, dependencyRevisions: [] };
  const p5 = { revision: 6, enabled: true, pending: false, contribution: fixture.feedback, dependencyRevisions: [] };
  const binding = createScreenLayoutDependencyBinding({ getCatalogueSnapshot: () => p1,
    projectSnapshot: projectWorkspaceVideoCatalogueSnapshot, projectCatalogue: projectVideoDisplayGeometry,
    getFeedbackSnapshot: () => p5, getFeedbackLayoutSnapshot: side => ({ revision: 6, pending: false, envelope: resolveFeedbackEnvelope(fixture.feedback, side) }) });
  await binding.refreshCatalogue();
  const resolved = binding.resolve(draft);
  assert.equal(resolved.videos.length, videos.length); assert.deepEqual(resolved.issues, []);
  assert.deepEqual(resolved.geometry, (await resolveDesktopLayoutContribution(profile, { workspace, feedback: fixture.feedback })).geometry);
  assert.deepEqual(resolved.dependencyRevisions, [{ segment: "P1", revision: 71 }, { segment: "P5", revision: 6 }]);
  assert.equal(binding.getContentDependencies().workspace.videoCatalogue.entries.length, catalogue.entries.length);
  binding.destroy();
});

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
  assert.equal(state.getSnapshot().dependencyRevisions.some(d => d.segment === "P1"), false);
  detach(); detachRaw(); binding.destroy(); state.destroy(); feedback.destroy();
});

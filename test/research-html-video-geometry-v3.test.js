import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalJson } from "../site/src/research/canonical.js";
import { browserDisplayGeometry, createVideoCatalogueContributionV3,
  validateVideoCatalogueContributionV3, validateVideoDisplayGeometry } from "../site/src/research/video-catalogue-contribution.js";
import { validateWorkspaceContributionV3 } from "../site/src/research/workspace-contribution.js";
import { createLocationVariantLibraryV3 } from "../site/src/research/variant-library.js";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { projectSupportedWorkspaceVideoDisplayGeometry, prepareSupportedWorkspaceContentRestore,
  verifySupportedWorkspaceRestoredVideoEntries } from "../site/src/research/workspace-contribution.js";

const fixture = async () => {
  const text = await readFile(new URL("./fixtures/controlled-video-geometry-v3.json", import.meta.url), "utf8");
  const value = JSON.parse(text);
  assert.equal(text, `${canonicalJson(value)}\n`);
  return value;
};

test("version 3 catalogue binds HTML decoder dimensions and rejects native renderer metadata", async () => {
  const saved = await fixture();
  assert.deepEqual(await validateWorkspaceContributionV3(saved.workspace), saved.workspace);
  const entries = saved.workspace.videoCatalogue.entries;
  for (const entry of entries) assert.deepEqual(validateVideoDisplayGeometry(entry.geometry), entry.geometry);
  const changed = entries.map(entry => ({ ...entry }));
  changed[0].geometry = { ...changed[0].geometry, source: "native-renderer" };
  await assert.rejects(createVideoCatalogueContributionV3({ revision: 1, entries: changed }));
  const next = await createVideoCatalogueContributionV3({ revision: 1, entries });
  assert.deepEqual(await validateVideoCatalogueContributionV3(next), next);
  const variant = await createLocationVariantLibraryV3(next);
  assert.equal(variant.catalogueContextVersion, 3);
  assert.deepEqual(variant.videos.map(video => video.assetId), entries.map(entry => entry.assetId));
  assert.deepEqual(browserDisplayGeometry({ videoWidth: 1920, videoHeight: 1080 }), entries[0].geometry);
});

test("P3 owner restores version 3 while fresh P1 rebind keeps exact playable files", async () => {
  const saved = await fixture();
  const source = { revision: 7, enabled: true, pending: false, contribution: saved.workspace, dependencyRevisions: [] };
  const editor = createStimulusOrderEditor({ root: { querySelector: () => null, querySelectorAll: () => [] },
    operate: () => { throw Error("No native write in owner confirmation."); } });
  await editor.restoreContribution(saved.contribution, { dependencies: { P1: source } });
  const prepared = await editor.prepareConfirmation();
  assert.deepEqual(prepared.snapshot.contribution, saved.contribution);
  prepared.commit();
  assert.deepEqual(editor.getSnapshot(), prepared.snapshot);
  assert.equal(editor.captureAuthoringDraft().library.catalogueContextVersion, 3);
  const geometry = await projectSupportedWorkspaceVideoDisplayGeometry(source);
  assert.equal(geometry.revision, 7);
  assert.equal(geometry.pending, false);
  assert.equal((await prepareSupportedWorkspaceContentRestore(saved.workspace)).requiresVideoLibraryRebind, true);
  assert.deepEqual(await verifySupportedWorkspaceRestoredVideoEntries(saved.workspace, saved.workspace.videoCatalogue.entries), saved.workspace.videoCatalogue);
  editor.destroy();
});

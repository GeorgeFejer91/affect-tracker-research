import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVideoCatalogueContributionV1 } from "../site/src/research/video-catalogue-contribution.js";
import { projectLegacyVariantCatalogue, projectVariantCatalogue, validateStimulusVariantContribution } from "../site/src/research/variant-catalogue-adapter.js";
import { addIsiDurations, compileVariantTimeline, createVariantDocument, createVariantDraft, pasteVariantTable } from "../site/src/research/variant-design.js";
import { createPlannedMarkerProfile } from "../site/src/research/planned-marker-contract.js";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";

const catalogue = JSON.parse(await readFile(new URL("./fixtures/research-video-catalogue-contribution-v1.json", import.meta.url), "utf8"));
const legacySource = { revision: 11, enabled: true, pending: false, contribution: catalogue, dependencyRevisions: [] };
const workspaceSource = (revision = 30, title = "Study one", videoCatalogue = catalogue) => ({
  revision, enabled: true, pending: false, dependencyRevisions: [],
  contribution: {
    schema: "affect-research-workspace-contribution", version: 1,
    study: { schema: "affect-research-study-identity", version: 1, id: "study-one", title },
    workspaceLayout: { assetRoot: "assets", videoLibrary: "assets/stimuli", projectFile: "experiment.package.json" },
    videoCatalogue,
  },
});
const source = workspaceSource(11);
const projection = await projectVariantCatalogue(source);
const [a, b] = projection.library.videos.map(video => video.annotationId);
const draft = pasteVariantTable(addIsiDurations(createVariantDraft(), "500,1500"), 0, 0, `${a}\t${b}\nISI1\tISI2\n${b}\t${a}`, projection.library);
const document = await createVariantDocument(draft, projection.library);
const bindingFixture = JSON.parse(await readFile(new URL("./fixtures/variant-catalogue-binding-v1.json", import.meta.url), "utf8"));
const workspaceFixture = JSON.parse(await readFile(new URL("./fixtures/variant-workspace-binding-v1.json", import.meta.url), "utf8"));
const makeEditor = () => createStimulusOrderEditor({ root: { querySelector: () => null, querySelectorAll: () => [] }, operate: async () => { throw new Error("Reopen must not require an authoring file or write."); } });

test("the same accepted P1 fixture resolves stored references, timelines and marker codebooks", async () => {
  assert.deepEqual(legacySource, bindingFixture.sourceSnapshot);
  assert.deepEqual((await projectLegacyVariantCatalogue(legacySource)).library, projection.library);
  assert.deepEqual(document, bindingFixture.document);
  assert.equal(projection.revision, 11, "bind the owner snapshot revision, not its separate domain revision");
  for (const video of projection.videos) {
    const original = catalogue.entries.find(entry => entry.packageRelativePath === video.relativePath);
    assert.equal(video.sha256, original.sha256); assert.equal(video.byteLength, original.byteLength);
    assert.equal(video.assetId, original.assetId); assert.equal(video.durationMs, original.durationMs);
    assert.notEqual(video.annotationId, original.assetId);
  }
  assert.equal(await validateStimulusVariantContribution(document.contribution, { dependencies: { P1: source } }), true);
  for (const [i, variant] of document.contribution.variants.entries()) {
    const timeline = compileVariantTimeline(document.contribution, variant.variantId, projection.videos);
    const marker = await createPlannedMarkerProfile(document.contribution, variant.variantId, projection.videos, "c".repeat(64));
    assert.deepEqual(timeline, bindingFixture.timelines[i]);
    assert.deepEqual(marker, bindingFixture.markerProfiles[i]);
    const durations = new Map(marker.codebook.map(item => [item.sourceCode, item.durationMs]));
    assert.equal(timeline.plannedDurationMs, 12345 + 23456 + [500, 1500][i]);
    assert.equal(marker.entries.reduce((sum, entry) => sum + durations.get(entry.sourceCode), 0), timeline.plannedDurationMs);
  }
});

test("P3 rejects unavailable, malformed, tampered and ambiguous P1 sources", async () => {
  for (const invalid of bindingFixture.invalidSnapshots) await assert.rejects(projectVariantCatalogue(invalid.snapshot), invalid.name);
  for (const change of [value => value.pending = true, value => value.enabled = false, value => value.contribution = null,
    value => value.revision = -1, value => value.foreign = true, value => value.contribution.videoCatalogue.entries[0].durationMs++,
    value => value.dependencyRevisions.push({ segment: "P3", revision: 0 })]) {
    const invalid = structuredClone(source); change(invalid);
    await assert.rejects(projectVariantCatalogue(invalid));
    await assert.rejects(validateStimulusVariantContribution(document.contribution, { dependencies: { P1: invalid } }));
  }
  const entries = structuredClone(catalogue.entries); entries[1].annotationId = entries[0].annotationId;
  const ambiguous = await createVideoCatalogueContributionV1({ revision: 2, entries });
  await assert.rejects(projectVariantCatalogue(workspaceSource(11, "Study one", ambiguous)), /ambiguous/);
  await assert.rejects(projectVariantCatalogue(legacySource), /Workspace contribution/);
});

test("P7 restores canonical P3 payload atomically against the current P1 snapshot with no sidecar prerequisite", async () => {
  const editor = makeEditor();
  await editor.setCatalogueSource(source);
  const result = await editor.restoreContribution(document.contribution, { dependencies: { P1: source }, isCurrent: () => true });
  assert.deepEqual(result, editor.getSnapshot());
  assert.deepEqual(result.dependencyRevisions, [{ segment: "P1", revision: 11 }]);
  assert.equal(result.pending, false); assert.deepEqual(result.contribution, document.contribution);
  await editor.setCatalogueSource(structuredClone(source));
  assert.deepEqual(editor.getSnapshot(), result);
  await assert.rejects(editor.restoreContribution(document.contribution, { dependencies: { P1: source }, isCurrent: () => false }));
  assert.deepEqual(editor.getSnapshot(), result);
  const edited = structuredClone(document.contribution); edited.variants[0].entries[0].referenceId = "missing";
  await assert.rejects(editor.restoreContribution(edited, { dependencies: { P1: source } }));
  assert.deepEqual(editor.getSnapshot(), result);
});

test("P1 withdrawal, reused revision and racing projections cannot retain or restore accepted P3 state", async () => {
  const editor = makeEditor();
  await editor.restoreContribution(document.contribution, { dependencies: { P1: source } });
  await editor.setCatalogueSource({ ...source, pending: true });
  assert.equal(editor.getSnapshot().contribution, null); assert.equal(editor.getSnapshot().pending, true);
  await editor.setCatalogueSource(source);
  await editor.restoreContribution(document.contribution, { dependencies: { P1: source } });
  const entries = structuredClone(catalogue.entries); entries[0].durationMs++;
  const nextDomain = await createVideoCatalogueContributionV1({ revision: 2, entries });
  await assert.rejects(editor.setCatalogueSource(workspaceSource(11, "Study one", nextDomain)), /without a new revision/);
  assert.equal(editor.getSnapshot().contribution, null);
  const update = editor.setCatalogueSource(workspaceSource(12, "Study one", nextDomain));
  await editor.setCatalogueSource({ ...source, revision: 13, pending: true, contribution: null });
  await update;
  assert.equal(editor.getSnapshot().contribution, null);
  assert.deepEqual(editor.getSnapshot().dependencyRevisions, []);
  await assert.rejects(editor.restoreContribution(document.contribution, { dependencies: { P1: source } }), /stale/);
  const reopening = editor.restoreContribution(document.contribution, { dependencies: { P1: { ...source, revision: 14 } } });
  editor.reset();
  await assert.rejects(reopening, /changed while reopening/);
  assert.equal(editor.getSnapshot().enabled, false);
});

test("P3 binds the registered workspace revision for study-only and video changes through acceptance and restore", async () => {
  const editor = makeEditor(), original = workspaceFixture.initialSnapshot;
  assert.deepEqual(original, workspaceSource());
  assert.deepEqual(workspaceFixture.contribution, document.contribution);
  await editor.setCatalogueSource(original);
  await editor.restoreContribution(document.contribution, { dependencies: { P1: original } });
  assert.deepEqual(editor.getSnapshot().dependencyRevisions, [{ segment: "P1", revision: 30 }]);
  const renamed = workspaceFixture.renamedSnapshot;
  await editor.setCatalogueSource(renamed);
  assert.equal(editor.getSnapshot().pending, true); assert.equal(editor.getSnapshot().contribution, null);
  assert.equal(await validateStimulusVariantContribution(document.contribution, { dependencies: { P1: renamed } }), true);
  const restored = await editor.restoreContribution(document.contribution, { dependencies: { P1: renamed } });
  assert.deepEqual(restored.dependencyRevisions, [{ segment: "P1", revision: 31 }]);
  assert.deepEqual(restored.contribution, document.contribution);
  const before = await projectVariantCatalogue(original), after = await projectVariantCatalogue(renamed);
  assert.deepEqual(after.videos, before.videos); assert.notEqual(after.sourceIntegritySha256, before.sourceIntegritySha256);
  const changed = workspaceFixture.videoChangedSnapshot;
  await editor.setCatalogueSource(changed);
  assert.equal(editor.getSnapshot().contribution, null);
  const next = await editor.restoreContribution(document.contribution, { dependencies: { P1: changed } });
  assert.deepEqual(next.dependencyRevisions, [{ segment: "P1", revision: 32 }]);
  const projected = await projectVariantCatalogue(changed);
  const timeline = compileVariantTimeline(next.contribution, "variant-1", projected.videos);
  assert.equal(timeline.plannedDurationMs, bindingFixture.timelines[0].plannedDurationMs + 1);
  for (const [i, source] of [original, renamed, changed].entries()) {
    const projection = await projectVariantCatalogue(source);
    assert.equal(projection.sourceIntegritySha256, workspaceFixture.expected[i].sourceIntegritySha256);
    assert.equal(projection.revision, workspaceFixture.expected[i].dependencyRevisions[0].revision);
    assert.equal(compileVariantTimeline(document.contribution, "variant-1", projection.videos).plannedDurationMs, workspaceFixture.expected[i].variant1PlannedDurationMs);
  }
  await editor.setCatalogueSource(changed);
  assert.deepEqual(editor.getSnapshot(), next);
});

test("study content reuse at one registered revision invalidates P3 and rejects a stale restoration", async () => {
  const editor = makeEditor(), original = workspaceSource();
  await editor.restoreContribution(document.contribution, { dependencies: { P1: original } });
  await assert.rejects(editor.setCatalogueSource(workspaceSource(30, "Unversioned change")), /without a new revision/);
  assert.equal(editor.getSnapshot().contribution, null);
  await editor.setCatalogueSource(workspaceSource(31, "Versioned change"));
  await assert.rejects(editor.restoreContribution(document.contribution, { dependencies: { P1: original } }), /stale/);
});

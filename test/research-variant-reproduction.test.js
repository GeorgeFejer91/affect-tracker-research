import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { projectSavedVariantCatalogue } from "../site/src/research/variant-catalogue-adapter.js";
import { createVariantDesign, editIsi, validateVariantDesign, variantDesignToDraft } from "../site/src/research/variant-design.js";
import { assertVariantReproduction } from "./fixtures/assert-variant-reproduction.js";

const fixturePath = fileURLToPath(new URL("./fixtures/variant-reproduction-v1.json", import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const { workspace, contribution, expected } = fixture;
const { library } = await projectSavedVariantCatalogue(workspace);
const snapshot = (revision, ready) => ({ revision, enabled: true, pending: !ready,
  contribution: ready ? structuredClone(workspace) : null, dependencyRevisions: [] });
const recipeHash = "f".repeat(64); // Synthetic binding only; P7 supplies its actual authored-core hash.

test("three unequal variants preserve independent boundary expectations and named source identities", async () => {
  const results = await assertVariantReproduction(workspace, contribution, recipeHash, expected);
  assert.deepEqual(results.map(result => result.timeline.plannedDurationMs), [50646, 37801, 48146]);
  assert.deepEqual(contribution.isiDefinitions.map(isi => isi.durationMs), [0, 500, 500, 1500, 73]);
  assert.equal(new Set(contribution.variants.flatMap(v => v.entries.map(e => e.entryId))).size, 15);
  assert.deepEqual(await createVariantDesign(fixture.draft, library), contribution);
});

test("saved content restores all variants before media authority and rebind prepares identical content without writes", async () => {
  let writes = 0;
  const editor = createStimulusOrderEditor({ root: { querySelector: () => null, querySelectorAll: () => [] },
    operate: async () => { writes++; throw new Error("No sidecar should be required"); } });
  try {
    const pending = await editor.restoreContent(contribution, { savedWorkspaceContribution: workspace, dependencies: { P1: snapshot(42, false) } });
    assert.equal(pending.pending, true); assert.equal(pending.contribution, null);
    assert.deepEqual(pending.dependencyRevisions, [{ segment: "P1", revision: 42 }]);
    await assert.rejects(editor.prepareContribution());
    await editor.setCatalogueSource(snapshot(43, true));
    const prepared = await editor.prepareContribution();
    assert.deepEqual(prepared.contribution, contribution);
    assert.deepEqual(prepared.dependencyRevisions, [{ segment: "P1", revision: 43 }]);
    await assertVariantReproduction(workspace, prepared.contribution, recipeHash, expected);
    assert.equal(writes, 0);
  } finally { editor.destroy(); }
});

test("all occurrence IDs survive reopen and only variants referencing an edited ISI change version", async () => {
  const restored = variantDesignToDraft(contribution);
  assert.deepEqual(await createVariantDesign(restored, library), contribution);
  const changed = await createVariantDesign(editIsi(restored, "ISI2", 700), library);
  assert.deepEqual(changed.variants.map(v => v.entries), contribution.variants.map(v => v.entries));
  assert.deepEqual(changed.variants.map((v, i) => v.versionSha256 !== contribution.variants[i].versionSha256), [true, true, false]);
  const unused = await createVariantDesign(editIsi(restored, "ISI5", 74), library);
  assert.deepEqual(unused.variants, contribution.variants);
  assert.notEqual(unused.integritySha256, contribution.integritySha256, "unused authored dictionary content is still embedded");
});

test("malformed occurrence, dictionary, video, marker and allocation cross-references reject", async () => {
  for (const mutate of [
    v => v.variants[0].entries[3].entryId = v.variants[0].entries[2].entryId,
    v => v.variants[1].entries[0].referenceId = "missing-video",
    v => v.isiDefinitions.splice(1, 1),
    v => v.variants[0].entries[0].kind = "video",
    v => v.markerContract.sequence = "per-video",
    v => v.allocation = { kind: "cyclic", participantCount: 12 },
    v => v.variants.reverse(),
  ]) {
    const changed = structuredClone(contribution); mutate(changed);
    await assert.rejects(validateVariantDesign(changed, library));
  }
});

test("separate hostile processes reproduce every variant and byte-identical editable re-export", async () => {
  const invoke = promisify(execFile);
  const child = fileURLToPath(new URL("./fixtures/variant-reproduction-instance.js", import.meta.url));
  const results = await Promise.all(["UTC", "Pacific/Auckland"].map((TZ, i) => invoke(process.execPath, [child, fixturePath], {
    env: { ...process.env, TZ, LANG: i ? "de_DE.UTF-8" : "en_US.UTF-8" }, maxBuffer: 1024 * 1024,
  })));
  for (const result of results) assert.equal(result.stderr, "");
  assert.equal(results[0].stdout, results[1].stdout);
  const receipt = JSON.parse(results[0].stdout);
  assert.deepEqual(receipt.forbidden, []);
  assert.equal(receipt.canonical, canonicalJson(contribution));
  assert.equal(receipt.projections.length, 3);
});

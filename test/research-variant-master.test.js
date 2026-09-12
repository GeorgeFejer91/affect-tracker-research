import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parsePlannerRecipeV1, serializePlannerRecipeV1, createPlannerRecipeV1, reproducePlannerRecipeV1, reconstructPlannerRecipeSelectionV1 } from "../site/src/research/planner-recipe.js";
import { preparePlannerRecipeReopenV1 } from "../site/src/research/planner-recipe-restore.js";
import { prepareWorkspaceContentRestore, createWorkspaceContributionProducer } from "../site/src/research/workspace-contribution.js";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { assertVariantReproduction } from "./fixtures/assert-variant-reproduction.js";

const fixturePath = fileURLToPath(new URL("./fixtures/variant-reproduction-v2.json", import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const masterSource = await readFile(new URL("./fixtures/planner-recipe-locations-v1.canonical.json", import.meta.url), "utf8");
const expectedMatrix = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-locations-v1-reproduction.json", import.meta.url)));

test("actual complete master bytes preserve every authored P3 variant across file export and reopen", async () => {
  const { recipe } = await parsePlannerRecipeV1(new TextEncoder().encode(masterSource));
  assert.deepEqual(recipe.segments.P1, fixture.workspace);
  assert.deepEqual(recipe.segments.P3, fixture.contribution);
  const base = fileURLToPath(new URL("../src-tauri/target/p3-master-verification/", import.meta.url));
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(join(base, "export-"));
  const file = join(folder, "experiment.json");
  await writeFile(file, await serializePlannerRecipeV1(recipe), { flag: "wx" });
  const reopened = (await parsePlannerRecipeV1(await readFile(file))).recipe;
  assert.equal(await serializePlannerRecipeV1(reopened), masterSource);
  const matrix = await reproducePlannerRecipeV1(reopened);
  assert.deepEqual(matrix, expectedMatrix);
  const projections = await assertVariantReproduction(reopened.segments.P1, reopened.segments.P3, reopened.integrity.definitionSha256, fixture.expected);
  for (const { variantId, languageId, languageSelectionPath, presentationTarget } of matrix.cases) {
    const selected = await reconstructPlannerRecipeSelectionV1(reopened, { variantId, languageId, languageSelectionPath, presentationTarget });
    const expected = projections.find(value => value.timeline.variantId === variantId);
    assert.deepEqual(selected.timeline, expected.timeline);
    assert.deepEqual(selected.markerProfile, expected.profile);
    assert.deepEqual(selected.variant, { variantId, versionSha256: expected.timeline.versionSha256 });
  }
});

test("complete master reopen routes P3 through content-only restore and actual P1 producer revisions", async () => {
  let catalogueSnapshot = { enabled: true, pending: true, contribution: null };
  let study = fixture.workspace.study;
  const p1 = createWorkspaceContributionProducer({ getStudyIdentity: () => study, getVideoCatalogueSnapshot: () => catalogueSnapshot });
  const requests = [];
  const editor = createStimulusOrderEditor({ root: { querySelector: () => null, querySelectorAll: () => [] }, operate: async (...args) => requests.push(args) });
  const restored = {};
  try {
    const operation = await preparePlannerRecipeReopenV1(masterSource, { isCurrent: () => true });
    const owners = Object.fromEntries(["P2", "P4", "P5", "P6", "policy", "presentationTarget"].map(name => [name, value => { restored[name] = value; return true; }]));
    const document = await operation.apply({ ...owners, begin: () => editor.reset(),
      P1: async value => { await prepareWorkspaceContentRestore(value); study = value.study; catalogueSnapshot = { enabled: true, pending: true, contribution: null }; return p1.changed(); },
      P3: (value, context) => editor.restoreContent(value, { savedWorkspaceContribution: context.workspace, dependencies: { P1: p1.getSnapshot() } }),
    });
    const pending = p1.getSnapshot();
    assert.equal(pending.pending, true);
    await assert.rejects(editor.prepareContribution());
    assert.equal(requests.length, 0);
    catalogueSnapshot = { enabled: true, pending: false, contribution: document.recipe.segments.P1.videoCatalogue };
    const ready = p1.changed();
    assert.ok(ready.revision > pending.revision);
    await editor.setCatalogueSource(ready);
    const accepted = await editor.prepareContribution();
    assert.deepEqual(accepted.dependencyRevisions, [{ segment: "P1", revision: ready.revision }]);
    assert.deepEqual(accepted.contribution, fixture.contribution);
    const result = await createPlannerRecipeV1({ recipeId: document.recipe.recipeId, presentationTarget: restored.presentationTarget, policy: restored.policy,
      segments: { P1: ready.contribution, P2: restored.P2, P3: accepted.contribution, P4: restored.P4, P5: restored.P5, P6: restored.P6 } });
    assert.equal(await serializePlannerRecipeV1(result), masterSource);
    assert.equal(requests.length, 0);
  } finally { editor.destroy(); }
});

test("complete master selects every variant and language identically in fresh ambient-free processes", async () => {
  const invoke = promisify(execFile);
  const child = fileURLToPath(new URL("./fixtures/variant-reproduction-instance.js", import.meta.url));
  const master = fileURLToPath(new URL("./fixtures/planner-recipe-locations-v1.canonical.json", import.meta.url));
  const results = await Promise.all(["UTC", "Pacific/Auckland"].map(TZ => invoke(process.execPath, [child, fixturePath, master], { env: { ...process.env, TZ }, maxBuffer: 4 * 1024 * 1024 })));
  assert.equal(results[0].stdout, results[1].stdout);
  for (const result of results) assert.equal(result.stderr, "");
  const receipt = JSON.parse(results[0].stdout);
  assert.deepEqual(receipt.forbidden, []);
  assert.equal(receipt.canonical, masterSource);
  assert.deepEqual(receipt.matrix, expectedMatrix);
  assert.equal(receipt.selections.length, expectedMatrix.cases.length);
});

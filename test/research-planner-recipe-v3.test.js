import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV3, parsePlannerRecipeV3, parsePlannerRecipeV2, parsePlannerRecipeV1,
  parseSupportedPlannerRecipe, serializePlannerRecipeV3, reproducePlannerRecipeV3,
  reconstructPlannerRecipeSelectionV3, validatePlannerRecipeV3 } from "../site/src/research/planner-recipe.js";
import { plannerRecipeVersionForContributions, capturePlannerRecipeInputVersion } from "../site/src/research/planner-recipe-capture.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { createPackageExportController } from "../site/src/research/package-export-controller.js";
import { createPlannerFileWorkflow } from "../site/src/research/planner-file-workflow.js";
import { prepareSupportedBrowserPlannerRecipeSave } from "../site/src/research/planner-recipe-file.js";

import { controlledCore } from "./fixtures/planner-recipe-v3-fixture.js";

test("master3 preserves controlled provenance across canonical bytes, selection and both layout targets", async () => {
  for (const name of ["locations", "xr"]) {
    const { core, legacy } = await controlledCore(name);
    const recipe = await compilePlannerRecipeV3(core);
    const source = await serializePlannerRecipeV3(recipe), bytes = new TextEncoder().encode(source);
    assert.equal(source, await readFile(new URL(`./fixtures/planner-recipe-v3-${name}.canonical.json`, import.meta.url), "utf8"));
    assert.equal(recipe.integrity.algorithmVersion, "planner-recipe-reproduction-v4");
    assert.equal((await parsePlannerRecipeV3(bytes)).canonicalSourceText, source);
    assert.equal((await parseSupportedPlannerRecipe(bytes)).recipe.version, 3);
    await assert.rejects(parsePlannerRecipeV1(bytes));
    await assert.rejects(parsePlannerRecipeV2(bytes));
    for (const id of ["P2", "P3", "P4", "P5", "P6"]) assert.deepEqual(recipe.segments[id], legacy.segments[id]);
    const matrix = await reproducePlannerRecipeV3(recipe);
    assert.equal(`${canonicalJson(matrix)}\n`, await readFile(new URL(`./fixtures/planner-recipe-v3-${name}-reproduction.json`, import.meta.url), "utf8"));
    const selectionHashes = [];
    for (const { selectionSha256, ...selector } of matrix.cases) {
      if (selector.presentationTarget !== recipe.presentationTarget) continue;
      const selected = await reconstructPlannerRecipeSelectionV3(recipe, selector);
      assert.equal(selected.version, 3);
      if (name === "xr") assert.equal(`${canonicalJson(selected.layout)}\n`,
        await readFile(new URL("./fixtures/planner-recipe-v3-xr-layout.json", import.meta.url), "utf8"));
      assert.deepEqual(selected.assets, recipe.segments.P1.videoCatalogue.entries);
      assert.equal(selected.assets[0].geometry.nativeDisplayMetadata.sourceOrientation.stream.status, "absent");
      selectionHashes.push({ selector, sha256: await canonicalSha256(selected) });
    }
    assert.equal(`${canonicalJson(selectionHashes)}\n`, await readFile(new URL(`./fixtures/planner-recipe-v3-${name}-selection-hashes.json`, import.meta.url), "utf8"));
  }
});

test("provenance-only change changes master identity without changing P3 or P4 content", async () => {
  const absent = await compilePlannerRecipeV3((await controlledCore()).core);
  const explicit = await compilePlannerRecipeV3((await controlledCore("locations", true)).core);
  assert.notEqual(absent.integrity.definitionSha256, explicit.integrity.definitionSha256);
  assert.notEqual(absent.integrity.segmentSha256.P1, explicit.integrity.segmentSha256.P1);
  assert.equal(absent.integrity.segmentSha256.P3, explicit.integrity.segmentSha256.P3);
  assert.equal(absent.integrity.segmentSha256.P4, explicit.integrity.segmentSha256.P4);
});

test("master3 rejects mixed chains and drift instead of repairing old sources", async () => {
  const recipe = await compilePlannerRecipeV3((await controlledCore()).core);
  for (const mutate of [r => r.version = 2, r => r.segments.P1.version = 2,
    r => r.segments.P2.version = 1, r => r.integrity.algorithmVersion = "planner-recipe-reproduction-v3",
    r => r.segments.P1.videoCatalogue.entries[0].geometry.nativeDisplayMetadata.renderer.readbackRotationDegrees = 90]) {
    const changed = structuredClone(recipe); mutate(changed);
    await assert.rejects(validatePlannerRecipeV3(changed));
  }
  assert.equal(plannerRecipeVersionForContributions({ version: 3 }, { version: 2 }), 3);
  assert.equal(plannerRecipeVersionForContributions({ version: 2 }, { version: 2 }), 2);
  assert.equal(plannerRecipeVersionForContributions({ version: 1 }, { version: 1 }), 1);
  assert.throws(() => plannerRecipeVersionForContributions({ version: 3 }, { version: 1 }));
  for (const name of ["locations", "xr", "mixed"]) {
    const bytes = new Uint8Array(await readFile(new URL(`./fixtures/planner-recipe-v2-${name}.canonical.json`, import.meta.url)));
    const old = await parsePlannerRecipeV2(bytes);
    assert.equal(`${canonicalJson(old.recipe)}\n`, new TextDecoder().decode(bytes));
    await assert.rejects(parsePlannerRecipeV3(bytes));
  }
});

test("supported GUI master3 save/open/exact-copy retains proof and confirms final feedback only after write", async () => {
  const recipe = await compilePlannerRecipeV3((await controlledCore()).core);
  const registry = createPlannerContributionRegistry(), exporter = createPackageExportController();
  let document = null, compiles = 0;
  const written = [], restored = [];
  for (const [segment, value] of Object.entries(recipe.segments)) {
    registry.register(segment, () => ({ revision: 1, enabled: segment !== "P6", pending: false,
      contribution: segment === "P6" ? null : value, dependencyRevisions: [] }), { validateContribution: async () => true });
  }
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) await registry.accept(segment);
  const restoreOwners = { begin() { document = null; } };
  for (const name of ["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"]) {
    restoreOwners[name] = async value => { restored.push([name, value]); return true; };
  }
  const workflow = createPlannerFileWorkflow({ registry, exporter, getDocument: () => document,
    adoptDocument: value => { document = value; }, canOperate: () => true, restoreOwners,
    getRecipeOptions: () => ({ recipeId: recipe.recipeId, policy: recipe.policy, presentationTarget: recipe.presentationTarget }),
    documentAdapter: {
      parseDocument: parseSupportedPlannerRecipe,
      captureInput: (registry, options) => capturePlannerRecipeInputVersion(registry, { ...options, version: 3 }),
      async compileDocument(input) {
        compiles++;
        return parseSupportedPlannerRecipe(new TextEncoder().encode(await serializePlannerRecipeV3(await compilePlannerRecipeV3(input))));
      },
    },
    async write(value, context) {
      let bytes = new Uint8Array();
      const handle = { kind: "file", async getFile() { return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }; },
        async createWritable() { return { async write(value) { bytes = value.slice(); }, async close() {}, async abort() {} }; } };
      const prepared = await prepareSupportedBrowserPlannerRecipeSave(value.canonicalSourceText, { ...context, pickSaveFile: () => handle });
      const receipt = await prepared.chooseAndSave(); written.push(bytes); return receipt;
    },
  });
  assert.equal((await workflow.save()).status, "saved");
  assert.equal(compiles, 1);
  assert.equal(document.recipe.version, 3);
  assert.equal(registry.readAccepted().entries.find(value => value.segment === "P5").status, "accepted");
  const saved = document;
  assert.equal(await workflow.open(() => ({ kind: "planner-recipe-v3", document: saved })), true);
  assert.deepEqual(restored.map(([name]) => name), ["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"]);
  assert.deepEqual(restored[0][1], recipe.segments.P1);
  assert.equal((await workflow.save()).status, "saved");
  assert.equal(compiles, 1);
  assert.deepEqual(written[1], written[0]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createPlannerFileWorkflow } from "../site/src/research/planner-file-workflow.js";
import { createPackageExportController } from "../site/src/research/package-export-controller.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { capturePlannerRecipeInputV1, capturePlannerRecipeInputVersion } from "../site/src/research/planner-recipe-capture.js";
import { compilePlannerRecipeV1, compilePlannerRecipeV2, parseSupportedPlannerRecipe } from "../site/src/research/planner-recipe.js";
import { openBrowserPlannerRecipeFile, openSupportedBrowserPlannerRecipeFile,
  prepareBrowserPlannerRecipeSave, prepareSupportedBrowserPlannerRecipeSave } from "../site/src/research/planner-recipe-file.js";

const encoder = new TextEncoder();
const sources = await Promise.all(["planner-recipe-current-v1.canonical.json", "planner-recipe-v2-mixed.canonical.json"]
  .map(name => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8")));
const documents = await Promise.all(sources.map(source => parseSupportedPlannerRecipe(encoder.encode(source))));
const order = ["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"];
function disk({ initial = new Uint8Array(), after = () => {}, fail = null, readback } = {}) {
  let bytes = initial, written = false;
  const calls = [];
  const step = async name => { calls.push(name); await after(name); if (fail === name) throw Error(`${name} failed`); };
  const handle = { kind: "file", async getFile() {
    await step(written ? "read" : "inspect"); const value = written ? readback ?? bytes : bytes;
    return { size: value.length, arrayBuffer: async () => value.slice().buffer };
  }, async createWritable() {
    await step("create"); return {
      async write(value) { bytes = value.slice(); written = true; await step("write"); },
      async close() { await step("close"); }, async abort() { await step("abort"); },
    };
  } };
  return { handle, calls, get bytes() { return bytes; } };
}
async function fixture({ initial = documents[1], supported = true, restore = () => true, write, compile, parse } = {}) {
  const recipe = initial.recipe, registry = createPlannerContributionRegistry(), exporter = createPackageExportController();
  let document = null, compiles = 0;
  const restored = [], files = [];
  for (const [segment, value] of Object.entries(recipe.segments)) {
    registry.register(segment, () => ({ revision: 1, enabled: segment !== "P6" || value.status === "included", pending: false,
      contribution: segment === "P6" ? value.profile ?? null : value, dependencyRevisions: [] }), { validateContribution: async () => true });
  }
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) await registry.accept(segment);
  const options = { recipeId: recipe.recipeId, policy: recipe.policy, presentationTarget: recipe.presentationTarget };
  const restoreOwners = { begin() { document = null; } };
  for (const name of order) restoreOwners[name] = async (value, context) => { restored.push({ name, value }); return restore(name, value, context); };
  const documentAdapter = {
    parseDocument: parse ?? parseSupportedPlannerRecipe,
    async compileDocument(input) {
      compiles++; await compile?.();
      const recipe = await (input.version === 2 ? compilePlannerRecipeV2 : compilePlannerRecipeV1)(input);
      return parseSupportedPlannerRecipe(encoder.encode(`${canonicalJson(recipe)}\n`));
    },
    captureInput: (registry, options) => capturePlannerRecipeInputVersion(registry, { ...options, version: recipe.version }),
  };
  const workflow = createPlannerFileWorkflow({ registry, exporter, getDocument: () => document,
    adoptDocument(value) { document = value; }, getRecipeOptions: () => options, restoreOwners, canOperate: () => true,
    documentAdapter: supported ? documentAdapter : null,
    async write(value, context) {
      if (write) return write(value, context);
      const file = disk(); files.push(file);
      const prepared = await prepareSupportedBrowserPlannerRecipeSave(value.canonicalSourceText, { ...context, pickSaveFile: () => file.handle });
      return prepared.chooseAndSave();
    },
  });
  return { workflow, registry, exporter, restored, files, options,
    get compiles() { return compiles; }, get document() { return document; },
    select: () => ({ kind: `planner-recipe-v${recipe.version}`, document: initial }),
  };
}

test("GUI adapter fresh save compiles actual v1 and typed-v2, preserving exact bytes and metadata-only adoption", async () => {
  for (const initial of documents) {
    const f = await fixture({ initial });
    assert.equal((await f.workflow.save()).status, "saved");
    assert.equal(f.compiles, 1);
    assert.equal(f.document.canonicalSourceText, initial.canonicalSourceText);
    assert.deepEqual(f.files[0].bytes, encoder.encode(initial.canonicalSourceText));
    assert.deepEqual(f.restored, []);
    assert.equal(f.registry.readAccepted().entries.find(x => x.segment === "P5").status, "accepted");
    const before = f.document;
    assert.equal((await f.workflow.save()).status, "saved");
    assert.equal(f.document, before); assert.equal(f.compiles, 1);
    assert.deepEqual(f.files[1].bytes, f.files[0].bytes);
  }
});

test("GUI supported Open restores complete typed content and unchanged Save never recompiles it", async () => {
  const f = await fixture();
  assert.equal(await f.workflow.open(f.select), true);
  assert.deepEqual(f.restored.map(x => x.name), order);
  assert.deepEqual(f.restored.find(x => x.name === "P2").value, documents[1].recipe.segments.P2);
  assert.equal(f.workflow.canCopy(), true);
  assert.equal((await f.workflow.save()).status, "saved");
  assert.equal(f.compiles, 0);
  assert.deepEqual(f.files[0].bytes, encoder.encode(sources[1]));
  assert.equal(f.restored.length, 8);
});

test("strict default workflow and capture reject v2; supported Open rejects a mismatched dispatch kind", async () => {
  const strict = await fixture({ supported: false });
  await assert.rejects(strict.workflow.open(strict.select), /Unsupported/);
  await assert.rejects(strict.workflow.save());
  assert.equal(strict.files.length, 0); assert.equal(strict.document, null);
  const legacyCapture = capturePlannerRecipeInputV1(strict.registry, { ...strict.options, version: 2, isCurrent: () => true });
  assert.equal(legacyCapture.input.version, 1);
  await assert.rejects(compilePlannerRecipeV1(legacyCapture.input));
  for (const version of [undefined, 0, 3, "2"]) assert.throws(() => capturePlannerRecipeInputVersion(strict.registry,
    { ...strict.options, version, isCurrent: () => true }), /explicit supported/);
  const f = await fixture();
  await assert.rejects(f.workflow.open(() => ({ ...f.select(), kind: "planner-recipe-v1" })), /does not match/);
  assert.equal(f.restored.length, 0); assert.equal(f.document, null);
});

test("supported browser Open preserves picker gesture and exact legacy/master version dispatch", async () => {
  const legacy = await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url));
  for (const [bytes, kind] of [[encoder.encode(sources[0]), "planner-recipe-v1"], [encoder.encode(sources[1]), "planner-recipe-v2"], [legacy, "experiment-package-v1"]]) {
    let picks = 0;
    const file = disk({ initial: new Uint8Array(bytes) });
    const opening = openSupportedBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile() { picks++; return [file.handle]; } });
    assert.equal(picks, 1);
    const result = await opening; assert.equal(result.kind, kind);
    if (kind !== "experiment-package-v1") assert.equal(result.document.canonicalSourceText, new TextDecoder().decode(bytes));
  }
  const file = disk({ initial: encoder.encode(sources[1]) });
  await assert.rejects(openBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: () => [file.handle] }));
  await assert.rejects(prepareBrowserPlannerRecipeSave(sources[1], { isCurrent: () => true }));
});

test("supported browser Save rejects existing content and preserves write/close/readback/stale guarantees", async () => {
  const bytes = encoder.encode(sources[1]);
  const existing = disk({ initial: bytes });
  const blocked = await prepareSupportedBrowserPlannerRecipeSave(sources[1], { isCurrent: () => true, pickSaveFile: () => existing.handle });
  await assert.rejects(blocked.chooseAndSave(), /Choose a new/);
  assert.deepEqual(existing.calls, ["inspect"]); assert.deepEqual(existing.bytes, bytes);
  for (const point of ["inspect", "create", "write", "close", "read"]) {
    for (const mode of ["failure", "stale"]) {
      let current = true;
      const file = disk({ fail: mode === "failure" ? point : null, after(name) { if (mode === "stale" && name === point) current = false; } });
      const prepared = await prepareSupportedBrowserPlannerRecipeSave(sources[1], { isCurrent: () => current, pickSaveFile: () => file.handle });
      await assert.rejects(prepared.chooseAndSave());
      if (mode === "stale") { current = true; await assert.rejects(prepared.chooseAndSave(), /changed/); }
    }
  }
  const substituted = disk({ readback: encoder.encode(sources[0]) });
  const prepared = await prepareSupportedBrowserPlannerRecipeSave(sources[1], { isCurrent: () => true, pickSaveFile: () => substituted.handle });
  await assert.rejects(prepared.chooseAndSave(), /saved bytes differ/);
});

test("supported browser intake rejects malformed, unknown and bad-hash masters before writing", async () => {
  const base = JSON.parse(sources[1]);
  const badHash = structuredClone(base); badHash.integrity.definitionSha256 = "0".repeat(64);
  for (const source of ["{}\n", `${canonicalJson({ ...base, version: 99 })}\n`, `${canonicalJson(badHash)}\n`]) {
    const file = disk({ initial: encoder.encode(source) });
    await assert.rejects(openSupportedBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: () => [file.handle] }));
    let picks = 0;
    await assert.rejects(prepareSupportedBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickSaveFile() { picks++; return file.handle; } }));
    assert.equal(picks, 0);
  }
});

test("GUI typed Open cancellation preserves prior source and stale/partial Open denies adoption", async () => {
  let fail = false;
  const f = await fixture({ restore(name) { if (fail && name === "P4") throw Error("owner failure"); return true; } });
  await f.workflow.open(f.select); const before = f.document;
  assert.equal(await f.workflow.open(() => null), null); assert.equal(f.document, before);
  let finish; const pending = f.workflow.open(() => new Promise(resolve => { finish = resolve; }));
  f.workflow.edited(); finish(f.select()); await assert.rejects(pending, /changed/);
  assert.equal(f.document, before); assert.equal(f.workflow.canCopy(), false);
  fail = true; await assert.rejects(f.workflow.open(f.select), /some fields/);
  assert.equal(f.document, null); assert.equal(f.workflow.canCopy(), false);
});

test("GUI typed Save denies stale compilation, canceled write and mismatched acknowledgement", async () => {
  let f;
  f = await fixture({ compile() { f.workflow.edited(); } });
  assert.equal((await f.workflow.save()).status, "changed"); assert.equal(f.files.length, 0); assert.equal(f.document, null);
  const canceled = await fixture({ write: () => null });
  assert.equal((await canceled.workflow.save()).status, "cancelled"); assert.equal(canceled.document, null);
  const wrong = await fixture({ write: () => ({}) });
  await assert.rejects(wrong.workflow.save()); assert.equal(wrong.document, null);
  let late;
  late = await fixture({ write(document) {
    late.workflow.edited();
    return { schema: "affect-research-planner-recipe-save-receipt", version: 1,
      recipeId: document.recipe.recipeId, definitionSha256: document.recipe.integrity.definitionSha256,
      canonicalSourceByteSha256: document.canonicalSourceByteSha256,
      byteLength: encoder.encode(document.canonicalSourceText).byteLength };
  } });
  assert.equal((await late.workflow.save()).status, "saved-older-revision"); assert.equal(late.document, null);
});

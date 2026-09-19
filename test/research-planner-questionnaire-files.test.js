import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareSupportedBrowserPlannerRecipeSave, openSupportedBrowserPlannerRecipeFile } from "../experiment-planner/web/src/research/planner-recipe-file.js";
import { parseSupportedPlannerRecipe } from "../experiment-planner/web/src/research/planner-recipe.js";
const source = readFileSync(new URL("./fixtures/planner-recipe-v5.bundle.json", import.meta.url), "utf8");
const document = await parseSupportedPlannerRecipe(new TextEncoder().encode(source));

// In-memory implementation of the file/directory grant boundary. Records real
// production save/open operations, with fault injection at filesystem calls.
function folder(after = () => {}) {
  const files = new Map(), calls = [];
  const step = async (op, path) => { calls.push({ op, path }); await after(op, path); };
  const missing = () => Object.assign(Error("missing"), { name: "NotFoundError" });
  const dirs = new Set([""]);
  function dir(prefix = "") { return { kind: "directory", async getDirectoryHandle(name, { create = false } = {}) {
    const path = prefix + name + "/"; await step("directory", path);
    if (!dirs.has(path)) { if (!create) throw missing(); dirs.add(path); } return dir(path);
  }, async getFileHandle(name, { create = false } = {}) {
    const path = prefix + name; await step("file", path);
    if (!files.has(path)) { if (!create) throw missing(); files.set(path, ""); }
    return { kind: "file", path, async getFile() { await step("read", path); const bytes = new TextEncoder().encode(files.get(path)); return { size: bytes.length, arrayBuffer: async () => bytes.buffer }; },
      async createWritable() { await step("create", path); let pending; return { async write(bytes) { pending = new TextDecoder().decode(bytes); await step("write", path); }, async close() { files.set(path, pending); await step("close", path); }, async abort() { await step("abort", path); } }; } };
  }, async resolve(handle) { return handle.path.startsWith(prefix) ? handle.path.slice(prefix.length).split("/") : null; } }; }
  return { root: dir(), files, calls };
}

test("browser folder save publishes manifest last, reuses exact files, and reopens from its directory grant", async () => {
  const fs = folder(); let picks = 0;
  const prepare = () => prepareSupportedBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickDirectory: () => { picks++; return fs.root; } });
  const save = await prepare(); assert.equal(picks, 0);
  const saving = save.chooseAndSave(); assert.equal(picks, 1);
  const receipt = await saving; assert.equal(receipt.canonicalSourceByteSha256, document.canonicalSourceByteSha256);
  const writes = fs.calls.filter(c => c.op === "write");
  assert.equal(writes.length, document.questionnaireAssets.length + 1);
  assert.ok(!writes.at(-1).path.startsWith("assets/"));
  const manifestName = writes.at(-1).path;
  assert.equal(fs.files.get(manifestName), document.canonicalSourceText);
  const opened = await openSupportedBrowserPlannerRecipeFile({ isCurrent: () => true, rootHandle: fs.root, pickOpenFile: async () => [await fs.root.getFileHandle(manifestName)] });
  assert.equal(opened.kind, "planner-recipe-v5");
  assert.deepEqual(opened.document, document);
  await (await prepare()).chooseAndSave();
  assert.equal(fs.calls.filter(c => c.op === "write").length, writes.length + 1);
  assert.equal([...fs.files.keys()].filter(path => !path.startsWith("assets/")).length, 2);
  await assert.rejects(openSupportedBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: async () => [await fs.root.getFileHandle(manifestName)] }), /work folder/u);
  const asset = document.questionnaireAssets[0]; fs.files.set(asset.relativePath, "changed");
  await assert.rejects((await prepare()).chooseAndSave());
  assert.equal(fs.files.get(asset.relativePath), "changed");
  assert.equal([...fs.files.keys()].filter(path => !path.startsWith("assets/")).length, 2);
});

test("browser asset save denies acknowledgement after stale state, cancellation or asset write/readback failure", async () => {
  for (const stop of ["create", "write", "close", "read"]) {
    let current = true;
    const fs = folder(op => { if (op === stop) current = false; });
    const prepared = await prepareSupportedBrowserPlannerRecipeSave(source, { isCurrent: () => current, pickDirectory: () => fs.root });
    await assert.rejects(prepared.chooseAndSave(), /changed/u);
    assert.equal([...fs.files.keys()].some(path => !path.startsWith("assets/")), false);
  }
  const fs = folder((op, path) => { if (op === "close") fs.files.set(path, "corrupt"); });
  const prepared = await prepareSupportedBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickDirectory: () => fs.root });
  await assert.rejects(prepared.chooseAndSave(), /differs/u);
  const cancelled = await prepareSupportedBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickDirectory: () => { throw Object.assign(Error("cancelled"), { name: "AbortError" }); } });
  assert.equal(await cancelled.chooseAndSave(), null);
});

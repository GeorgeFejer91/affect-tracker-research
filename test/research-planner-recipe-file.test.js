import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareBrowserPlannerRecipeSave, validatePlannerRecipeSaveReceipt } from "../site/src/research/planner-recipe-file.js";
import { preparePlannerRecipeReopenV1, PlannerRecipeRestoreError } from "../site/src/research/planner-recipe-restore.js";

const source = await readFile(new URL("./fixtures/planner-recipe-v1.canonical.json", import.meta.url), "utf8");
const bytes = new TextEncoder().encode(source);
const order = ["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"];
function disk({ after = () => {}, fail = null, readBack = null, initial = new Uint8Array() } = {}) {
  const calls = []; let written = null;
  const step = async name => { calls.push(name); if (fail === name) throw Error(`${name} failed`); await after(name); };
  const handle = { kind: "file", async createWritable() {
    await step("create"); return { async write(value) { written = value.slice(); await step("write"); },
      async close() { await step("close"); }, async abort() { await step("abort"); } };
  }, async getFile() {
    await step(written === null ? "inspect" : "read"); const value = written === null ? initial : readBack ?? written;
    return { size: value.length, arrayBuffer: async () => value.slice().buffer };
  } };
  return { calls, handle, get written() { return written; } };
}

test("named save invokes picker in the click turn and acknowledges only exact closed readback", async () => {
  const file = disk(); let picks = 0;
  const prepared = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => true,
    pickSaveFile(options) { picks++; assert.match(options.suggestedName, /^complete-master_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/u); return file.handle; } });
  assert.equal(picks, 0);
  const saving = prepared.chooseAndSave(); assert.equal(picks, 1);
  await assert.rejects(prepared.chooseAndSave(), /already/u);
  const receipt = await saving;
  assert.deepEqual(file.calls, ["inspect", "create", "write", "close", "read"]);
  assert.deepEqual(file.written, bytes);
  assert.equal(validatePlannerRecipeSaveReceipt(receipt, prepared.expected).byteLength, bytes.length);
  for (const key of Object.keys(receipt)) {
    const value = { ...receipt }; delete value[key];
    assert.throws(() => validatePlannerRecipeSaveReceipt(value, prepared.expected));
  }
  for (const key of ["recipeId", "definitionSha256", "canonicalSourceByteSha256", "byteLength"]) {
    assert.throws(() => validatePlannerRecipeSaveReceipt({ ...receipt, [key]: "wrong" }, prepared.expected));
  }
});

test("cancelled picker can retry; write/close/readback failures never acknowledge success", async () => {
  const file = disk(); let picks = 0;
  const prepared = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => true,
    pickSaveFile() { if (++picks === 1) return Promise.reject(Object.assign(Error("cancelled"), { name: "AbortError" })); return file.handle; } });
  assert.equal(await prepared.chooseAndSave(), null);
  assert.ok(await prepared.chooseAndSave());
  for (const fail of ["inspect", "create", "write", "close", "read"]) {
    const failed = disk({ fail });
    const operation = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickSaveFile: () => failed.handle });
    await assert.rejects(operation.chooseAndSave(), new RegExp(`${fail} failed`, "u"));
    assert.equal(failed.calls.includes("abort"), ["write", "close"].includes(fail));
  }
  const wrong = disk({ readBack: new TextEncoder().encode("{}\n") });
  const operation = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickSaveFile: () => wrong.handle });
  await assert.rejects(operation.chooseAndSave());
});

test("edit, replacement or disposal at every write boundary permanently denies acknowledgement", async () => {
  for (const stop of ["inspect", "create", "write", "close", "read"]) {
    let current = true;
    const file = disk({ after(name) { if (name === stop) current = false; } });
    const prepared = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => current, pickSaveFile: () => file.handle });
    await assert.rejects(prepared.chooseAndSave(), /changed/u);
    assert.equal(file.calls.includes("abort"), ["create", "write"].includes(stop));
    current = true;
    await assert.rejects(prepared.chooseAndSave(), /changed/u);
  }
});

test("a selected nonempty browser file is rejected before any writable stream", async () => {
  const file = disk({ initial: bytes });
  const prepared = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickSaveFile: () => file.handle });
  await assert.rejects(prepared.chooseAndSave(), /Choose a new recipe filename/u);
  assert.deepEqual(file.calls, ["inspect"]);
  assert.equal(file.written, null);
});

test("an edit or disposal while the picker is pending prevents any browser write", async () => {
  let current = true, select;
  const file = disk();
  const prepared = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => current,
    pickSaveFile: () => new Promise(resolve => { select = resolve; }) });
  const saving = prepared.chooseAndSave();
  current = false;
  select(file.handle);
  await assert.rejects(saving, /changed/u);
  assert.deepEqual(file.calls, []);
});

test("reopen validates first, then restores dependency order without inventing accepted snapshots", async () => {
  const pending = await preparePlannerRecipeReopenV1(source, { isCurrent: () => true });
  const called = [], stored = {};
  const owners = { begin() { called.push("begin"); } };
  for (const name of order) owners[name] = async (value, context) => {
    called.push(name); stored[name] = value;
    assert.equal(context.isCurrent(), true);
    assert.deepEqual(context.workspace, pending.document.recipe.segments.P1);
    if (["P3", "P4"].includes(name)) { assert.ok(stored.P1); assert.ok(stored.P5); }
    return true;
  };
  assert.deepEqual(called, []);
  const document = await pending.apply(owners);
  assert.deepEqual(called, ["begin", ...order]);
  for (const name of order) assert.deepEqual(stored[name], name === "policy" ? document.recipe.policy
    : name === "presentationTarget" ? document.recipe.presentationTarget : document.recipe.segments[name]);
  stored.P1.study.title = "Subsequent edit";
  assert.notEqual(document.recipe.segments.P1.study.title, stored.P1.study.title);
  await assert.rejects(pending.apply(owners), /new reopen/u);
  await assert.rejects(preparePlannerRecipeReopenV1("{}\n", { isCurrent: () => true }));
});

test("partial/stale reopen denies source adoption and never rolls back over newer fields", async () => {
  for (const stop of ["P1", "P3", "P6", "presentationTarget"]) {
    let current = true, eligible = "previous-source";
    const called = [], prepared = await preparePlannerRecipeReopenV1(source, { isCurrent: () => current });
    const owners = { begin() { eligible = null; } };
    for (const name of order) owners[name] = () => { called.push(name); if (name === stop) current = false; return true; };
    await assert.rejects(prepared.apply(owners).then(document => { eligible = document; }), error => {
      assert.ok(error instanceof PlannerRecipeRestoreError);
      assert.deepEqual(error.completed, order.slice(0, order.indexOf(stop) + 1));
      return true;
    });
    assert.equal(eligible, null);
    assert.deepEqual(called, order.slice(0, order.indexOf(stop) + 1));
  }
  const prepared = await preparePlannerRecipeReopenV1(source, { isCurrent: () => true });
  const calls = [];
  const owners = { begin() { calls.push("revoke"); }, ...Object.fromEntries(order.map(name => [name, () => {
    calls.push(name); if (name === "P3") return false; return true;
  }])) };
  await assert.rejects(prepared.apply(owners), error => error.partial && error.completed.join(",") === "P1,P2,P5");
  assert.deepEqual(calls, ["revoke", "P1", "P2", "P5", "P3"]);
});

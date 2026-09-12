import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openBrowserExperimentPackage, prepareBrowserPackageSave } from "../site/src/research/package-file-picker.js";

const source = await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url), "utf8");
const encode = (value) => new TextEncoder().encode(value);
const abortError = () => new DOMException("Cancelled", "AbortError");
function fileHandle({ write, close, getFile } = {}) {
  let committed = encode(source), staged;
  const events = [];
  const handle = { kind: "file", async getFile() {
    events.push("read");
    return getFile ? getFile(committed) : { size: committed.byteLength, arrayBuffer: async () => committed.slice().buffer };
  }, async createWritable(options) {
    assert.deepEqual(options, { keepExistingData: false });
    events.push("create");
    return {
      async write(bytes) { events.push("write"); staged = bytes.slice(); await write?.(); },
      async close() { events.push("close"); await close?.(); committed = staged; },
      async abort() { events.push("abort"); staged = null; },
    };
  } };
  return { handle, events };
}
function deferred() { let resolve; return { promise: new Promise((yes) => { resolve = yes; }), resolve: (value) => resolve(value) }; }

test("the final button invokes its picker synchronously and acknowledges closed, reread canonical bytes", async () => {
  const { handle, events } = fileHandle();
  const prepared = await prepareBrowserPackageSave(source, { pickSaveFile: (options) => {
    events.push("picker"); assert.match(options.suggestedName, /\.json$/); return Promise.resolve(handle);
  } });
  const saving = prepared.chooseAndSave();
  assert.deepEqual(events, ["picker"]);
  const receipt = await saving;
  assert.deepEqual(events, ["picker", "create", "write", "close", "read"]);
  assert.equal(receipt.byteLength, encode(source).length);
  assert.equal(receipt.packageId, prepared.packageId);
  assert.equal(Object.keys(receipt).length, 6);
});

test("only picker cancellation is harmless; permission, write and close failures reject and abort", async () => {
  const cancelled = await prepareBrowserPackageSave(source, { pickSaveFile: async () => { throw abortError(); } });
  assert.equal(await cancelled.chooseAndSave(), null);
  for (const stage of ["write", "close"]) {
    const { handle, events } = fileHandle({ [stage]: async () => { throw abortError(); } });
    const prepared = await prepareBrowserPackageSave(source, { pickSaveFile: () => handle });
    await assert.rejects(prepared.chooseAndSave(), { name: "AbortError" });
    assert.equal(events.at(-1), "abort");
    assert.ok(!events.includes("read"));
  }
  const denied = await prepareBrowserPackageSave(source, { pickSaveFile: async () => { throw new DOMException("Denied", "NotAllowedError"); } });
  await assert.rejects(denied.chooseAndSave(), { name: "NotAllowedError" });
});

test("a delayed write cannot overlap another save or commit an edited design", async () => {
  const barrier = deferred(); let current = true;
  const { handle, events } = fileHandle({ write: () => barrier.promise });
  const prepared = await prepareBrowserPackageSave(source, { pickSaveFile: () => handle, isCurrent: () => current });
  const saving = prepared.chooseAndSave();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(prepared.chooseAndSave(), /already in progress/);
  current = false; barrier.resolve();
  await assert.rejects(saving, /before committing/);
  assert.deepEqual(events, ["create", "write", "abort"]);
  await assert.rejects(prepared.chooseAndSave(), /design changed/i);
});

test("readback mismatch or failure cannot acknowledge a saved design", async () => {
  for (const getFile of [
    () => ({ size: 1, arrayBuffer: async () => encode("{").buffer }),
    () => ({ size: encode(source).length, arrayBuffer: async () => encode(source.slice(1)).buffer }),
    () => { throw new Error("Read permission lost"); },
  ]) {
    const { handle, events } = fileHandle({ getFile });
    const prepared = await prepareBrowserPackageSave(source, { pickSaveFile: () => handle });
    await assert.rejects(prepared.chooseAndSave());
    assert.deepEqual(events, ["create", "write", "close", "read"]);
  }
});

test("open selects just one file from the user gesture with no workspace prerequisite", async () => {
  const { handle, events } = fileHandle();
  const opening = openBrowserExperimentPackage({ pickOpenFile: (options) => {
    events.push("picker"); assert.equal(options.multiple, false); return [handle];
  } });
  assert.deepEqual(events, ["picker"]);
  assert.equal((await opening).canonicalSourceText, source);
  assert.equal(await openBrowserExperimentPackage({ pickOpenFile: async () => { throw abortError(); } }), null);
  await assert.rejects(openBrowserExperimentPackage({ pickOpenFile: () => [] }), /exactly one/);
  await assert.rejects(openBrowserExperimentPackage({ pickOpenFile: () => [{ kind: "directory" }] }), /one recipe/);
  await assert.rejects(openBrowserExperimentPackage({ pickOpenFile: () => [fileHandle({ getFile: () => { throw abortError(); } }).handle] }), { name: "AbortError" });
});

test("invalid/noncanonical prepared bytes never reach a picker", async () => {
  for (const invalid of ["", "{}\n", source.trim(), source + "\n"]) {
    await assert.rejects(prepareBrowserPackageSave(invalid, { pickSaveFile: () => assert.fail("must validate before naming") }));
  }
});

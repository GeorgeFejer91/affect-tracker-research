import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseExperimentPackageV1 } from "../site/src/research/experiment-package.js";
import { createPackageExportController } from "../site/src/research/package-export-controller.js";
import {
  completeExperimentPackageSaveRequest, requestExperimentPackageSave, validatePackageSaveReceipt,
} from "../site/src/research/package-save-request.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";

const compiled = await parseExperimentPackageV1(new Uint8Array(await readFile(
  new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url),
)));
const receipt = {
  schema: "affect-research-experiment-package-save-receipt", version: 1,
  packageId: compiled.package.packageId,
  packageDefinitionSha256: compiled.package.integrity.packageDefinitionSha256,
  canonicalSourceByteSha256: compiled.canonicalSourceByteSha256,
  byteLength: new TextEncoder().encode(compiled.canonicalSourceText).byteLength,
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("native acknowledgement binds the canonical fixture, with a closed receipt", () => {
  assert.deepEqual(validatePackageSaveReceipt(receipt, compiled), receipt);
  for (const key of Object.keys(receipt)) {
    const missing = { ...receipt };
    delete missing[key];
    assert.throws(() => validatePackageSaveReceipt(missing, compiled), /unverified/);
    assert.throws(() => validatePackageSaveReceipt({ ...receipt, [key]: null }, compiled), /unverified/);
  }
  for (const wrong of [{ extra: true }, { byteLength: receipt.byteLength + 1 },
    { canonicalSourceByteSha256: "0".repeat(64) }, { packageDefinitionSha256: "0".repeat(64) }]) {
    assert.throws(() => validatePackageSaveReceipt({ ...receipt, ...wrong }, compiled), /unverified/);
  }
});

test("accepting a native save event cannot report success before its delayed writer", async () => {
  const target = new EventTarget();
  const writer = deferred();
  let settled = false;
  target.addEventListener(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
    event.preventDefault();
    void completeExperimentPackageSaveRequest(event.detail, (sourceText) => {
      assert.equal(sourceText, compiled.canonicalSourceText);
      return writer.promise;
    });
  });
  const result = requestExperimentPackageSave(target, compiled).then((value) => { settled = true; return value; });
  await tick();
  assert.equal(settled, false);
  writer.resolve(receipt);
  assert.deepEqual(await result, receipt);
});

test("native cancellation, malformed acknowledgement, and missing adapter remain unsaved", async () => {
  for (const [result, pattern] of [[null, null], [undefined, /unverified/], [{}, /unverified/]]) {
    const target = new EventTarget();
    target.addEventListener(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
      event.preventDefault();
      void completeExperimentPackageSaveRequest(event.detail, async () => result);
    });
    const request = requestExperimentPackageSave(target, compiled);
    if (pattern) await assert.rejects(request, pattern);
    else assert.equal(await request, null);
  }
  await assert.rejects(requestExperimentPackageSave(new EventTarget(), compiled), /not connected/);
});

test("native writer failure settles the UI and preserves the bridge error", async () => {
  const target = new EventTarget();
  const failure = new Error("disk write failed");
  let operation;
  target.addEventListener(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
    event.preventDefault();
    operation = completeExperimentPackageSaveRequest(event.detail, async () => { throw failure; });
  });
  const request = requestExperimentPackageSave(target, compiled);
  await Promise.all([
    assert.rejects(request, /available to retry/),
    assert.rejects(operation, (error) => error === failure),
  ]);
});

test("a native request settles once, even if an adapter calls its receiver again", async () => {
  const target = new EventTarget();
  target.addEventListener(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
    event.preventDefault();
    event.detail.complete({ status: "cancelled" });
    event.detail.complete({ status: "saved", receipt });
  });
  assert.equal(await requestExperimentPackageSave(target, compiled), null);
});

test("export is serialized and adopts the parsed design only after acknowledged persistence", async () => {
  const controller = createPackageExportController();
  const writer = deferred();
  const adoptions = [];
  const save = controller.save({ compile: async () => compiled, write: () => writer.promise,
    adopt: async (value) => adoptions.push(value) });
  await tick();
  assert.equal(controller.snapshot().phase, "saving");
  assert.equal(controller.snapshot().saved, null);
  assert.deepEqual(adoptions, []);
  assert.equal((await controller.save({ compile: () => assert.fail("duplicate compile") })).status, "busy");
  writer.resolve(receipt);
  assert.equal((await save).status, "saved");
  assert.deepEqual(adoptions, [compiled]);
  assert.equal(controller.snapshot().saved.sourceText, compiled.canonicalSourceText);
  assert.equal(controller.snapshot().busy, false);
});

test("cancellation and writer failure permit a fresh save without adopting an unsaved design", async () => {
  for (const outcome of [null, new Error("quota exceeded")]) {
    const controller = createPackageExportController();
    let adopted = 0;
    const adapters = { compile: async () => compiled, adopt: async () => { adopted += 1; } };
    const save = controller.save({ ...adapters, write: async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    } });
    if (outcome instanceof Error) await assert.rejects(save, /quota/);
    else assert.equal((await save).status, "cancelled");
    assert.equal(adopted, 0);
    assert.equal(controller.snapshot().saved, null);
    assert.equal(controller.snapshot().busy, false);
    assert.equal((await controller.save({ ...adapters, write: async () => receipt })).status, "saved");
    assert.equal(adopted, 1);
  }
});

test("an edit during compilation prevents any write", async () => {
  const controller = createPackageExportController();
  const compilation = deferred();
  const save = controller.save({ compile: () => compilation.promise, write: () => assert.fail("stale write") });
  controller.invalidate();
  compilation.resolve(compiled);
  assert.equal((await save).status, "changed");
  assert.equal(controller.snapshot().saved, null);
});

test("an edit during persistence retains the old file receipt without replacing current edits", async () => {
  const controller = createPackageExportController();
  const writer = deferred();
  const save = controller.save({ compile: async () => compiled, write: () => writer.promise,
    adopt: () => assert.fail("newer edits must survive") });
  await tick();
  controller.invalidate();
  writer.resolve(receipt);
  assert.equal((await save).status, "saved-older-revision");
  assert.equal(controller.snapshot().phase, "changed");
  assert.equal(controller.snapshot().saved.receipt, receipt);
});

test("external revision changes, refused adoption, and disposal cannot become current saves", async () => {
  for (const change of ["external", "adoption", "destroy"]) {
    const controller = createPackageExportController();
    const writer = deferred();
    let current = true;
    const save = controller.save({ compile: async () => compiled, write: () => writer.promise,
      isCurrent: () => current, adopt: () => change === "adoption" ? false : assert.fail("stale adoption") });
    await tick();
    if (change === "external") current = false;
    if (change === "destroy") controller.destroy();
    writer.resolve(receipt);
    assert.equal((await save).status, "saved-older-revision");
    assert.notEqual(controller.snapshot().phase, "saved");
  }
});

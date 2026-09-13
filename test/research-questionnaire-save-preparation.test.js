import test from "node:test";
import assert from "node:assert/strict";
import { typedOwner, op, guard } from "./fixtures/p2-typed-owner.js";

async function owner() {
  const value = await typedOwner();
  await value.apply([op("addDemographics")]);
  return value;
}

test("prepared save is read-only, detached, and commits synchronously after storage", async () => {
  const s = await owner(), before = s.adapter.read();
  const prepared = await s.editor.prepareAuthoringQuestionnaireSave("demographics-en", guard());
  assert.deepEqual(s.adapter.read(), before);
  assert.equal(s.saved.length, 0);
  assert.equal(prepared.isCurrent(), true);
  assert.throws(() => prepared.afterCommit());
  const payload = prepared.payload, original = prepared.payload;
  payload.definition.title = "Caller mutation"; payload.sourceBytes.fill(0);
  assert.deepEqual(prepared.payload, original);
  const receipt = { storage: "synthetic", bytes: original.sourceBytes.length };
  const result = prepared.commit(receipt);
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(result.sourceReceipt, receipt);
  receipt.bytes = 0;
  assert.notEqual(prepared.commit(receipt).sourceReceipt.bytes, 0);
  assert.equal(prepared.isCurrent(), false);
  assert.equal(s.saved.length, 0);
  prepared.afterCommit(); prepared.afterCommit();
});

test("prepared save rejects cancellation and edits without overwriting newer state", async () => {
  for (const mode of ["cancel", "edit", "reset"]) {
    const s = await owner(), controller = new AbortController();
    const prepared = await s.editor.prepareAuthoringQuestionnaireSave("demographics-en", { signal: controller.signal, isCurrent: () => true });
    if (mode === "cancel") controller.abort();
    if (mode === "edit") await s.apply([op("updateForm", { questionnaireId: "demographics-en", changes: { title: "Newer title" } })]);
    if (mode === "reset") s.editor.reset();
    const before = mode === "reset" ? null : s.adapter.read();
    assert.equal(prepared.isCurrent(), false);
    assert.throws(() => prepared.commit({ storage: "already completed" }), error => error.code === (mode === "cancel" ? "canceled" : "stale_revision"));
    if (mode !== "reset") assert.deepEqual(s.adapter.read(), before);
    assert.equal(s.saved.length, 0);
  }
});

test("normal save uses the same exact prepared definition and source bytes", async () => {
  const s = await owner();
  const prepared = await s.editor.prepareAuthoringQuestionnaireSave("demographics-en", guard());
  const expected = prepared.payload;
  const result = await s.editor.saveAuthoringQuestionnaire("demographics-en", guard());
  assert.equal(s.saved.length, 1);
  assert.deepEqual(s.saved[0].definition, expected.definition);
  assert.deepEqual(s.saved[0].sourceBytes, expected.sourceBytes);
  assert.equal(result.sourceReceipt.synthetic, true);
  assert.equal(prepared.isCurrent(), false);
});


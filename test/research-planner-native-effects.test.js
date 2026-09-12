import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerNativeEffects } from "../site/src/research/planner-authoring-native-effects.js";
const context = () => ({ sessionId: crypto.randomUUID(), requestId: crypto.randomUUID(), expectedRevision: 0 });
const ack = (extra = {}) => ({ schema: "affect-research-planner-native-result", version: 1, operation: "saveRecipe",
  effect: { written: true, basename: "recipe.json" }, payload: { saved: true }, error: null, superseded: null, ...extra });
test("native adapter sends detached command identity and returns actual payload", async () => {
  const c = context(), receipts = [], action = { type: "writeRecipe", grantId: crypto.randomUUID(), sourceText: "{}\n" };
  const adapter = createPlannerNativeEffects({ sessionId: c.sessionId, invoke: async (name, { request }) => {
    assert.equal(name, "research_planner_authoring_effect"); assert.deepEqual(request, { context: c, action });
    request.context.expectedRevision = 9; return ack();
  } });
  assert.deepEqual(await adapter.execute(c, action, { isCurrent: () => true, recordEffect: r => receipts.push(r) }), { saved: true });
  assert.equal(c.expectedRevision, 0); assert.equal(receipts.length, 2);
});
test("late acknowledgement remains recorded but cannot be adopted", async () => {
  const c = context(), receipts = []; let current = true;
  const adapter = createPlannerNativeEffects({ sessionId: c.sessionId, invoke: async () => { current = false; return ack(); } });
  await assert.rejects(adapter.execute(c, { type: "writeRecipe", grantId: crypto.randomUUID(), sourceText: "{}\n" },
    { isCurrent: () => current, recordEffect: r => receipts.push(r) }), /receipt is retained/);
  assert.equal(receipts.at(-1).written, true);
});
test("closed actions and opaque grants reject before dispatch", async () => {
  const c = context(); let calls = 0;
  const adapter = createPlannerNativeEffects({ sessionId: c.sessionId, invoke: async () => { calls++; return ack(); } });
  for (const action of [{ type: "shell", cmd: "anything" }, { type: "readRecipe", grantId: "D:/private.json" },
    { type: "readRecipe", grantId: crypto.randomUUID(), path: "D:/private.json" }]) {
    await assert.rejects(adapter.execute(c, action, { isCurrent: () => true, recordEffect() {} }));
  }
  assert.equal(calls, 0);
});
test("lost acknowledgement retains unknown outcome and predispatch cancel has no effect", async () => {
  const c = context(), receipts = [];
  const adapter = createPlannerNativeEffects({ sessionId: c.sessionId, invoke: async () => { throw Error("transport lost"); } });
  const action = { type: "readRecipe", grantId: crypto.randomUUID() };
  await assert.rejects(adapter.execute(c, action, { isCurrent: () => false, recordEffect: r => receipts.push(r) }));
  assert.equal(receipts.length, 0);
  await assert.rejects(adapter.execute(c, action, { isCurrent: () => true, recordEffect: r => receipts.push(r) }));
  assert.equal(receipts[0].outcome, "unknown");
});

test("acknowledgement from another operation cannot be adopted", async () => {
  const c = context(), receipts = [];
  const adapter = createPlannerNativeEffects({ sessionId: c.sessionId, invoke: async () => ack({ operation: "openRecipe" }) });
  await assert.rejects(adapter.execute(c, { type: "writeRecipe", grantId: crypto.randomUUID(), sourceText: "{}\n" },
    { isCurrent: () => true, recordEffect: r => receipts.push(r) }), /invalid acknowledgement/);
  assert.deepEqual(receipts.map(r => r.outcome), ["unknown"]);
});

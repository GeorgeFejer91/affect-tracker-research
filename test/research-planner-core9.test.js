import test from "node:test";
import assert from "node:assert/strict";
import { withPlannerCore9 } from "../site/src/research/planner-authoring-core9.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { PLANNER_COMMAND_SCHEMA } from "../site/src/research/planner-authoring-contract.js";

test("core9 catalogue has exact closed public arguments and only Open uses sequence", async () => {
  const owners = ["P1", "P2", "P7"].map(id => withPlannerCore9({ id, settings: [], operations: [], read: () => ({ values: {}, issues: [] }),
    validate: () => [], stage() {} }, () => { throw Error("not invoked"); }));
  const session = createPlannerAuthoringSession({ owners });
  const request = action => ({ schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision: session.revision, action });
  const result = await session.execute(request({ kind: "catalogue" }));
  assert.equal(result.result.consequences.length, 9);
  assert.deepEqual(result.result.consequences.filter(d => d.publication).map(d => d.id), ["openRecipe"]);
  const rejected = await session.execute(request({ kind: "perform", operation: "confirmSegment", arguments: { segment: "P5" } }));
  assert.equal(rejected.status, "rejected"); assert.equal(rejected.issues[0].code, "final_capture");
  assert.equal(session.revision, 0);
});

test("metadata wrapper preserves existing owner state and delegates detached arguments", async () => {
  const args = { questionnaireId: "actual-id" }; let received;
  const owner = { id: "P2", settings: [{ id: "P2.value" }], read() { return 3; } };
  const wrapped = withPlannerCore9(owner, (operation, value) => { received = operation; value.questionnaireId = "changed"; return { prepared: true }; });
  assert.equal(wrapped.read, owner.read); assert.equal(wrapped.settings, owner.settings);
  assert.deepEqual(await wrapped.prepareConsequence("saveQuestionnaire", args, {}), { prepared: true });
  assert.equal(received, "saveQuestionnaire"); assert.equal(args.questionnaireId, "actual-id");
});

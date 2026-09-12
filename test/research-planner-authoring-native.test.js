import test from "node:test";
import assert from "node:assert/strict";
import { bootPlannerAuthoringNative } from "../site/src/research/planner-authoring-native.js";

test("normal native Planner startup never requests an authoring session", async () => {
  const calls = [];
  const bridge = await bootPlannerAuthoringNative({}, async command => {
    calls.push(command); return { enabled: false, transport: null };
  });
  bridge.destroy();
  assert.deepEqual(calls, ["research_planner_authoring_status"]);
});

test("owned native bridge dispatches through the real session and drains replies after EOF", async () => {
  const requests = [{ requestId: "first" }, { requestId: "second" }];
  let release, done; const gate = new Promise(resolve => { release = resolve; });
  const completion = new Promise(resolve => { done = resolve; });
  const responses = [], received = []; let destroyed = 0;
  const session = { sessionId: crypto.randomUUID(), revision: 7,
    async execute(request) { received.push(request); if (request.requestId === "first") await gate; return { requestId: request.requestId }; },
    destroy() { destroyed++; },
  };
  const bridge = await bootPlannerAuthoringNative({ researchUi: { plannerAuthoringSession: session } }, async (command, args) => {
    if (command === "research_planner_authoring_status") return { enabled: true, transport: "stdio" };
    if (command === "research_planner_authoring_ready") { assert.deepEqual(args, { sessionId: session.sessionId, revision: 7 }); return; }
    if (command === "research_planner_authoring_next") return requests.shift() ?? null;
    assert.equal(command, "research_planner_authoring_complete");
    responses.push(args.response);
    if (args.response.requestId === "second") release();
    if (responses.length === 2) done();
  });
  await completion;
  assert.deepEqual(received.map(request => request.requestId), ["first", "second"]);
  assert.deepEqual(responses, [{ requestId: "second" }, { requestId: "first" }]);
  bridge.destroy(); assert.equal(destroyed, 1);
});

test("disposing the bridge prevents late command results from publishing", async () => {
  let release, started; const gate = new Promise(resolve => { release = resolve; });
  const staging = new Promise(resolve => { started = resolve; });
  let requested = false, destroyed = 0, completed = 0;
  const session = { sessionId: crypto.randomUUID(), revision: 0,
    async execute() { started(); await gate; return {}; }, destroy() { destroyed++; },
  };
  const bridge = await bootPlannerAuthoringNative({ researchUi: { plannerAuthoringSession: session } }, async command => {
    if (command === "research_planner_authoring_status") return { enabled: true, transport: "stdio" };
    if (command === "research_planner_authoring_next") { if (requested) return null; requested = true; return {}; }
    if (command === "research_planner_authoring_complete") completed++;
  });
  await staging; bridge.destroy(); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyed, 1); assert.equal(completed, 0);
});

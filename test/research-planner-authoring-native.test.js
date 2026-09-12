import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bootPlannerAuthoringNative } from "../site/src/research/planner-authoring-native.js";

test("native revision notices are ordered across readiness and drained before replies", async () => {
  let notify, ready, releaseRevision, completed;
  const readyGate = new Promise(resolve => { ready = resolve; });
  const revisionGate = new Promise(resolve => { releaseRevision = resolve; });
  const completion = new Promise(resolve => { completed = resolve; });
  const calls = []; let supplied = false, unsubscribed = 0;
  const session = { sessionId: crypto.randomUUID(), revision: 0,
    subscribe(listener) { notify = listener; return () => { unsubscribed++; }; },
    async execute() { calls.push("execute"); this.revision = 2; notify(2); return { revision: 2 }; },
    destroy() {},
  };
  const boot = bootPlannerAuthoringNative({ researchUi: { plannerAuthoringSession: session } }, async (command, args) => {
    if (command.endsWith("_status")) return { enabled: true, transport: "stdio" };
    if (command.endsWith("_ready")) return readyGate;
    if (command.endsWith("_revision")) {
      assert.deepEqual(args, { request: { sessionId: session.sessionId, revision: args.request.revision } });
      calls.push(`revision:${args.request.revision}`);
      if (args.request.revision === 2) await revisionGate;
      return;
    }
    if (command.endsWith("_next")) { if (supplied) return null; supplied = true; return {}; }
    calls.push("complete"); completed();
  });
  await new Promise(resolve => setImmediate(resolve));
  session.revision = 1; notify(1); ready();
  const bridge = await boot;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["revision:1", "execute", "revision:2"]);
  releaseRevision(); await completion;
  assert.deepEqual(calls, ["revision:1", "execute", "revision:2", "complete"]);
  bridge.destroy(); bridge.destroy(); assert.equal(unsubscribed, 1);
});

test("CLI explicitly builds one hidden native WebView with its owned profile", async () => {
  const source = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(source, /context\.config\(\)\.app\.windows\.len\(\) != 1/u);
  assert.match(source, /window\.create = false/u);
  assert.match(source, /if tauri::is_dev\(\) \{\s*return Err\(\s*"Planner CLI requires embedded assets/u);
  assert.doesNotMatch(source, /window\.data_directory = Some/u);
  assert.match(source, /if let Some\(profile\) = &cli_profile[\s\S]*?WebviewWindowBuilder::from_config\(app, config\)\?[\s\S]*?\.data_directory\(profile\.join\("webview"\)\)[\s\S]*?\.visible\(false\)[\s\S]*?\.focused\(false\)/u);
});

test("fallible setup finishes before starting the UI-dependent native actor", async () => {
  const source = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const setup = source.slice(source.indexOf(".setup("), source.indexOf(".on_window_event("));
  const start = setup.indexOf("NativeMediaService::start_async(");
  assert.ok(start > 0);
  assert.ok(setup.indexOf(".start(app.handle().clone())") < start);
  assert.ok(setup.lastIndexOf("app.path().app_data_dir()?") < start);
  assert.doesNotMatch(setup.slice(start), /\?/u);
});

test("video effect readiness is between revision barriers and retains its request budget", async () => {
  const request = { requestId: crypto.randomUUID() }, calls = [];
  let effects, notify, supplied = false, finish;
  const done = new Promise(resolve => { finish = resolve; });
  const session = { sessionId: crypto.randomUUID(), revision: 0,
    subscribe(listener) { notify = listener; return () => {}; }, destroy() {},
    async execute() {
      return effects.execute({ sessionId: this.sessionId, requestId: request.requestId, expectedRevision: 0 },
        { type: "importVideos", grantId: crypto.randomUUID(), workspaceId: "workspace" },
        { isCurrent: () => true, recordEffect() {} });
    },
  };
  const bridge = await bootPlannerAuthoringNative({ researchUi: { plannerAuthoringSession: session,
    connectPlannerNativeEffects(value) { effects = value; } } }, async command => {
    if (command.endsWith("_status")) return { enabled: true, transport: "stdio" };
    if (command.endsWith("_next")) { if (supplied) return null; supplied = true; return request; }
    if (command.endsWith("_revision")) { calls.push("revision"); return; }
    if (command.endsWith("_effect")) {
      calls.push("import");
      return { schema: "affect-research-planner-native-result", version: 1, operation: "importVideos",
        effect: null, payload: {}, error: null, superseded: null };
    }
    if (command.endsWith("_complete")) finish();
  }, async guard => {
    calls.push("readiness");
    assert.ok(guard.deadline > performance.now() && guard.deadline <= performance.now() + 90_000);
    session.revision++; notify(session.revision);
  });
  await done;
  assert.deepEqual(calls, ["readiness", "revision", "import"]);
  bridge.destroy();
});

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
    subscribe() { return () => {}; },
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
    subscribe() { return () => {}; },
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

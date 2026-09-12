import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BrowserResearchRuntimeBridge } from "../site/src/research/runtime-bridge.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";

test("browser Planner cannot open recovery, acquire a run lease or start acquisition", async () => {
  const root = new EventTarget(); root.dataset = { researchProgram: "planner" };
  const forbidden = () => { throw new Error("Participant runtime dependency invoked by Planner"); };
  const bridge = new BrowserResearchRuntimeBridge(root, {
    journal: new Proxy({}, { get: () => forbidden }), leaseFactory: forbidden,
    workerProbe: forbidden, controllerFactory: forbidden, storageProbe: forbidden,
  });
  let rejection;
  root.addEventListener(RESEARCH_UI_EVENTS.startRejected, event => { rejection = event.detail; });
  await bridge.initialize();
  assert.equal(await bridge.refreshParticipantStates(), false);
  assert.equal(await bridge.refreshStorageReadiness(), null);
  const start = new CustomEvent(RESEARCH_UI_EVENTS.startRequest, { cancelable: true, detail: {} });
  root.dispatchEvent(start);
  assert.equal(start.defaultPrevented, true);
  assert.match(rejection.message, /Experiment Runner/u);
  assert.equal(bridge.controller, null); assert.equal(bridge.lease, null); assert.equal(bridge.ready, false);
  bridge.destroy();
  const index = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
  assert.match(index, /data-research-program="planner"/u);
});

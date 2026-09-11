import test from "node:test";
import assert from "node:assert/strict";

import { NativeResearchRuntimeBridge } from "../site/src/research/native-bridge.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";
import {
  completeQuestionnaireAssetStorageRequest,
  requestQuestionnaireAssetStorage,
} from "../site/src/research/questionnaire-storage-request.js";

const payload = () => ({
  familyId: "custom", languageTag: "en", format: "csv", sourceSha256: "a".repeat(64), bytes: [1, 2, 3],
});

test("questionnaire storage waits for owner completion and snapshots source bytes", async () => {
  const root = new EventTarget();
  const input = payload();
  let captured;
  root.addEventListener(RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, (event) => {
    event.preventDefault();
    captured = event.detail;
  });
  let settled = false;
  const pending = requestQuestionnaireAssetStorage(root, input).then((receipt) => { settled = true; return receipt; });
  input.bytes[0] = 9;
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(captured.request.bytes, [1, 2, 3]);
  const receipt = { relativePath: "assets/questionnaires/custom/en/source.csv" };
  await completeQuestionnaireAssetStorageRequest(captured, async (request) => {
    assert.deepEqual(Object.keys(request).sort(), ["bytes", "familyId", "format", "languageTag", "sourceSha256"]);
    return receipt;
  });
  assert.equal(await pending, receipt);
  captured.complete({ ok: false, message: "Late duplicate failure" });
});

test("questionnaire storage propagates save failure even when the bridge catches it", async () => {
  const root = new EventTarget();
  let operation;
  root.addEventListener(RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, (event) => {
    event.preventDefault();
    operation = completeQuestionnaireAssetStorageRequest(event.detail, async () => {
      throw new Error("Workspace permission was revoked.");
    }).catch(() => {});
  });
  await assert.rejects(requestQuestionnaireAssetStorage(root, payload()), /permission was revoked/u);
  await operation;
});

test("questionnaire storage rejects a disconnected owner immediately", async () => {
  await assert.rejects(requestQuestionnaireAssetStorage(new EventTarget(), payload()), /not connected/u);
});

test("questionnaire storage timeout reports unknown outcome and ignores late completion", async () => {
  const root = new EventTarget();
  let complete;
  root.addEventListener(RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, (event) => {
    event.preventDefault();
    complete = event.detail.complete;
  });
  const pending = requestQuestionnaireAssetStorage(root, payload(), { timeoutMs: 5 });
  await assert.rejects(pending, /outcome is unknown/u);
  complete({ ok: true, receipt: {} });
  await assert.rejects(pending, /outcome is unknown/u);
});

test("the bridge adapter retains legacy payload callers without putting completion in IPC", async () => {
  const input = payload();
  const receipt = { relativePath: "assets/questionnaires/custom/en/source.csv" };
  assert.equal(await completeQuestionnaireAssetStorageRequest(input, async (request) => {
    assert.equal(request, input);
    return receipt;
  }), receipt);
});

test("native storage listener acknowledges only an exact workspace receipt and forwards no callback", async () => {
  const root = new EventTarget();
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const requests = [];
  let invalidReceipt = false;
  const bridge = new NativeResearchRuntimeBridge(root, {
    windowObject: null,
    invoke: async (command, args) => {
      if (command !== "research_store_questionnaire_asset") throw new Error("Unneeded initialization unavailable.");
      requests.push(args.request);
      return {
        workspaceId: invalidReceipt ? "wrong-workspace" : workspaceId,
        familyId: args.request.familyId,
        languageTag: args.request.languageTag,
        relativePath: `assets/questionnaires/custom/en/${"a".repeat(64)}.csv`,
        sourceSha256: args.request.sourceSha256,
        byteLength: args.request.bytes.length,
      };
    },
  });
  // Initialization installs the real listener; unrelated native capabilities are unavailable.
  await bridge.initialize();
  bridge.workspace = { workspaceId };
  const receipt = await requestQuestionnaireAssetStorage(root, payload());
  assert.equal(receipt.workspaceId, workspaceId);
  assert.deepEqual(requests[0], { workspaceId, ...payload() });
  invalidReceipt = true;
  await assert.rejects(requestQuestionnaireAssetStorage(root, payload()), /invalid workspace receipt/u);
  await bridge.operation;
});

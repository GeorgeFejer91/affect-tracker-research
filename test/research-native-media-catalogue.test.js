import test from "node:test";
import assert from "node:assert/strict";

import { attestNativeGstCatalogue } from "../site/src/research/native-media-catalogue.js";

test("native GstPlay catalogue qualification is sequential and always stops each generation", async () => {
  const calls = [];
  let active = false;
  const controller = {
    async prepare({ summary }) {
      assert.equal(active, false);
      active = true;
      calls.push(`prepare:${summary.workspaceFileId}`);
    },
    async awaitPrepared() { calls.push("prepared"); },
    async attestDecode({ summary }) {
      calls.push(`attest:${summary.workspaceFileId}`);
      if (summary.workspaceFileId === "wf-b") throw new Error("decode failed");
      return Object.freeze({ ...summary, decodeStatus: "attestedQualified" });
    },
    async stop() {
      calls.push("stop");
      active = false;
    },
  };
  const progress = [];
  const stimuli = [{ workspaceFileId: "wf-a" }, { workspaceFileId: "wf-b" }];
  const result = await attestNativeGstCatalogue({
    controller,
    workspaceId: "workspace",
    stimuli,
    viewportHost: { getBoundingClientRect() {} },
    onProgress: ({ index }) => progress.push(index),
  });
  assert.deepEqual(calls, [
    "prepare:wf-a", "prepared", "attest:wf-a", "stop",
    "prepare:wf-b", "prepared", "attest:wf-b", "stop",
  ]);
  assert.equal(result.qualified.length, 1);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(progress, [0, 1, 2]);
  assert.equal(active, false);
});

test("native catalogue rejects ambient path-shaped responsibilities", async () => {
  await assert.rejects(() => attestNativeGstCatalogue({
    controller: {},
    workspaceId: "workspace",
    stimuli: [],
    viewportHost: {},
  }), /malformed/u);
});

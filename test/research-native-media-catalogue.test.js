import test from "node:test";
import assert from "node:assert/strict";

import { attestNativeGstCatalogue, attestNativeGstCatalogueV2, NativeCatalogueFailure } from "../site/src/research/native-media-catalogue.js";

test("controlled catalogue selects only the explicit v2 method and stops its generation", async () => {
  const calls = [];
  const controller = {
    async prepare() { calls.push("prepare"); },
    async awaitPrepared() { calls.push("prepared"); },
    async attestDecode() { throw new Error("Historical method must not be selected"); },
    async attestDecodeV2({ summary }) { calls.push("v2"); return summary; },
    async stop() { calls.push("stop"); },
  };
  const options = { controller, workspaceId: "workspace", stimuli: [{ workspaceFileId: "test" }], viewportHost: { getBoundingClientRect() {} } };
  assert.equal((await attestNativeGstCatalogueV2(options)).qualified.length, 1);
  assert.deepEqual(calls, ["prepare", "prepared", "v2", "stop"]);
  delete controller.attestDecodeV2;
  await assert.rejects(() => attestNativeGstCatalogueV2(options), /malformed/u);
});

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
  assert.equal(result.failures[0].phase, "attestDecode");
  assert.deepEqual(progress, [0, 1, 2]);
  assert.equal(active, false);
});

test("catalogue diagnostics expose only fixed phase and reason vocabulary", () => {
  assert.match(new NativeCatalogueFailure("prepare", { code: "native_media_unavailable", message: "Qualified native playback is unavailable (native-gstplay-command-timeout)." }).message, /prepare \(native-gstplay-command-timeout\)/u);
  assert.match(new NativeCatalogueFailure("prepare", new Error("Native media host geometry is unavailable.")).message, /viewport-unavailable/u);
  const diagnostic = new NativeCatalogueFailure("private-name", { code: "private-code", message: "C:/private/researcher-source.csv secret text" });
  assert.match(diagnostic.message, /bridgePreparation \(owner-error\)/u);
  assert.doesNotMatch(diagnostic.message, /private|secret|csv/u);
});

test("native catalogue rejects ambient path-shaped responsibilities", async () => {
  await assert.rejects(() => attestNativeGstCatalogue({
    controller: {},
    workspaceId: "workspace",
    stimuli: [],
    viewportHost: {},
  }), /malformed/u);
});

test("decode diagnostics distinguish geometry rejection from service shutdown without leaking source text", () => {
  for (const reason of [
    "native-display-snapshot-not-square-pixel", "native-display-orientation-missing",
    "native-display-orientation-unsupported", "native-display-metadata-inconsistent",
    "native-media-shutdown-pending", "native-gstplay-actor-unavailable",
    "native-gstplay-command-overload", "native-gstplay-signal-overload",
    "native-gstplay-channel-disconnected", "native-gstplay-actor-exited",
  ]) {
    const diagnostic = new NativeCatalogueFailure("attestDecode", {
      code: "native_media_unavailable",
      message: `C:/private/source.mp4 (${reason}) secret`,
    });
    assert.ok(diagnostic.message.includes(`attestDecode (${reason})`));
    assert.doesNotMatch(diagnostic.message, /private|source\.mp4|secret/u);
  }
  const unknown = new NativeCatalogueFailure("attestDecode", {
    code: "native_media_unavailable", message: "(native-display-private-source)",
  });
  assert.ok(unknown.message.includes("attestDecode (native_media_unavailable)"));
  assert.doesNotMatch(unknown.message, /private-source/u);
});

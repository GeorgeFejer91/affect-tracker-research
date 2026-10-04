import test from "node:test";
import assert from "node:assert/strict";
import { preparePlannerMediaForHtml } from "../site/src/research/planner-media-preparation.js";

class ProbeVideo extends EventTarget {
  constructor({ frames = true } = {}) {
    super();
    this.duration = 12.5;
    this.videoWidth = 1920;
    this.videoHeight = 1080;
    this.frames = frames;
    this.position = 0;
    if (!frames) this.requestVideoFrameCallback = undefined;
  }
  get currentTime() { return this.position; }
  set currentTime(value) {
    this.position = value;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }
  load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
  requestVideoFrameCallback(callback) {
    queueMicrotask(() => callback(0, { mediaTime: this.position }));
    return 1;
  }
  async play() {}
  pause() {}
  removeAttribute(name) { if (name === "src") this.src = ""; }
}

function fixture({ frames = true } = {}) {
  const summary = { workspaceFileId: "wf-clip", displayName: "clip.mp4", sha256: "a".repeat(64),
    byteLength: 1024, mimeType: "video/mp4", decodeStatus: "unverified", source: null };
  const calls = [];
  const send = async (command, args) => {
    calls.push([command, args]);
    if (command === "research_prepare_planner_media") {
      return { workspaceId: "study", stimuli: [summary] };
    }
    if (command === "research_workspace_media_url") {
      return { mediaGrantId: "grant", mediaUrl: "http://research-media.localhost/grant" };
    }
    if (command === "research_attest_workspace_decode") {
      if (args.attestation.attestationKind === "revokeGrant") return summary;
      return { ...summary, decodeStatus: "attestedUnqualified",
        decodeBackend: "webviewVideoFrameCallback", decodeAttestation: "representativeFramesV1",
        source: { kind: "workspaceFile", relativePath: "stimuli/clip.mp4", sha256: summary.sha256,
          byteLength: summary.byteLength, mimeType: "video/mp4", durationMs: 12500 } };
    }
    throw new Error(`Unexpected command ${command}`);
  };
  return { summary, calls, send, videoFactory: () => new ProbeVideo({ frames }) };
}

test("P1 confirmation publishes only a freshly prepared HTML decoded video", async () => {
  const { calls, send, videoFactory } = fixture();
  const projection = await preparePlannerMediaForHtml({ send, workspaceId: "study", videoFactory });
  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].stimulus.source.relativePath, "stimuli/clip.mp4");
  assert.equal(projection.items[0].displayGeometry.source, "browser-decoder");
  assert.deepEqual(calls.map(([command]) => command), ["research_prepare_planner_media",
    "research_workspace_media_url", "research_attest_workspace_decode"]);
  assert.deepEqual(calls[2][1].attestation.decodedPositionsMs, [250, 6250, 12250]);
});

test("P1 confirmation revokes its grant and fails when frames cannot be decoded", async () => {
  const { calls, send, videoFactory } = fixture({ frames: false });
  await assert.rejects(preparePlannerMediaForHtml({ send, workspaceId: "study", videoFactory }),
    /Decoded-frame verification requires desktop Chrome or Edge/u);
  assert.equal(calls.at(-1)[1].attestation.attestationKind, "revokeGrant");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRunnerHtmlVideoPlayer } from "../runner/src/html-video-player.js";
import { NativeMasterProtocolAdapter } from "../runner/src/master-protocol.js";

class Element {
  listeners = new Map();
  dataset = {};
  addEventListener(name, listener) {
    const list = this.listeners.get(name) ?? [];
    list.push(listener); this.listeners.set(name, list);
  }
  removeEventListener(name, listener) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== listener));
  }
  dispatch(name) { for (const listener of this.listeners.get(name) ?? []) listener(); }
  replaceChildren(child) { this.child = child; }
  setAttribute() {}
  removeAttribute() {}
}
class Video extends Element {
  readyState = 2;
  currentTime = 0;
  paused = true;
  load() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; this.dispatch("pause"); }
  requestVideoFrameCallback(callback) { this.frame = callback; }
  decodedFrame(count) {
    const callback = this.frame; this.frame = null;
    callback(0, { presentedFrames: count });
  }
}
const step = { kind: "video", position: 1, payload: { asset: {
  sha256: "a".repeat(64), byteLength: 4, mimeType: "video/mp4",
} } };
const receipt = { mediaUrl: "http://research-media.localhost/grant", sha256: step.payload.asset.sha256,
  byteLength: 4, mimeType: "video/mp4" };

test("native WebView playback reports decoded start, buffering, end and fences stale events", async () => {
  const priorElement = globalThis.HTMLElement, priorDocument = globalThis.document;
  globalThis.HTMLElement = Element;
  const video = new Video();
  globalThis.document = { createElement: () => video };
  const host = new Element(), observations = [];
  const player = createRunnerHtmlVideoPlayer(host, {
    invoke: () => assert.fail("bound native playback must use its native URL receipt"),
    windowObject: { setTimeout, clearTimeout, setInterval, clearInterval },
  });
  try {
    await player.playStep({ step, receipt, onObservation: observation => observations.push(observation) });
    assert.deepEqual(observations, []);
    video.decodedFrame(1);
    assert.equal(observations[0].state, "playing");
    assert.equal(observations[0].decodedFrames, 1);
    video.currentTime = 0.5; video.dispatch("waiting");
    assert.equal(observations[1].state, "buffering");
    video.currentTime = 1; video.dispatch("ended");
    assert.equal(observations[2].state, "ended");
    assert.deepEqual(observations.map(value => value.sequence), [1, 2, 3]);
    player.stop(); video.dispatch("error");
    assert.equal(observations.length, 3);
  } finally {
    player.destroy();
    globalThis.HTMLElement = priorElement;
    globalThis.document = priorDocument;
  }
});

test("native WebView playback rejects a URL receipt for different bytes", async () => {
  const priorElement = globalThis.HTMLElement, priorDocument = globalThis.document;
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Video() };
  const player = createRunnerHtmlVideoPlayer(new Element(), {
    invoke: () => assert.fail("native URL was supplied"),
    windowObject: { setTimeout, clearTimeout, setInterval, clearInterval },
  });
  try {
    await assert.rejects(player.playStep({ step, receipt: { ...receipt, sha256: "b".repeat(64) },
      onObservation: () => {} }), /different video hash/u);
  } finally {
    player.destroy();
    globalThis.HTMLElement = priorElement;
    globalThis.document = priorDocument;
  }
});

test("native master adapter binds URL and playback observations to the same attempt", async () => {
  const calls = [];
  const offer = { workspaceFileId: "file", sha256: step.payload.asset.sha256,
    byteLength: 4, mimeType: "video/mp4", generation: 2 };
  const status = { schema: "affect-runner-master-status", version: 3, runId: `run-${"a".repeat(8)}-${"a".repeat(4)}-${"a".repeat(4)}-${"a".repeat(4)}-${"a".repeat(12)}`,
    attemptId: "attempt", recipeSourceByteSha256: "b".repeat(64), planIdentitySha256: "c".repeat(64),
    position: 3, phase: "preparing", webviewMedia: offer };
  const adapter = new NativeMasterProtocolAdapter({ invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === "research_runner_master_webview_media_url") return {
      ...receipt, ...args.request, ...offer, mediaGrantId: "grant",
    };
    return status;
  }, render: () => {}, terminal: () => {}, fail: () => {}, windowObject: {} });
  adapter.plan = { version: 3, recipeSourceByteSha256: status.recipeSourceByteSha256,
    planIdentitySha256: status.planIdentitySha256 };
  adapter.receipt = { runId: status.runId, attemptId: status.attemptId };
  adapter.active = true;
  assert.equal((await adapter.webviewMediaUrl(status)).sha256, offer.sha256);
  await adapter.webviewMediaObserved(status, { state: "playing", sequence: 1, positionMs: 50, decodedFrames: 1 });
  assert.deepEqual(calls[0], ["research_runner_master_webview_media_url", { request: {
    runId: status.runId, attemptId: status.attemptId, position: 3, generation: 2,
  } }]);
  assert.deepEqual(calls[1][1].request.action, { type: "webviewMedia", event: {
    attemptId: "attempt", position: 3, generation: 2,
    workspaceFileId: "file", sha256: offer.sha256,
    sequence: 1, state: "playing", positionMs: 50, decodedFrames: 1,
  } });
});

import test from "node:test";
import assert from "node:assert/strict";

import { NativeRunMedia, nativeRunMediaEdge } from "../site/src/research/native-run-media.js";

test("native run media edge reducer is sequence-fenced and deterministic", () => {
  const previous = { sequence: 4, state: "playing" };
  assert.equal(nativeRunMediaEdge(previous, { sequence: 4, state: "ended" }), "none");
  assert.equal(nativeRunMediaEdge(previous, { sequence: 5, state: "buffering" }, {
    awaitingStart: false, manualPaused: false, bufferPaused: false,
  }), "bufferingStarted");
  assert.equal(nativeRunMediaEdge({ sequence: 5 }, { sequence: 6, state: "playing" }, {
    bufferPaused: true, manualPaused: false,
  }), "bufferingEnded");
  assert.equal(nativeRunMediaEdge(previous, { sequence: 5, state: "ended" }, { awaitingStart: false }), "completed");
  assert.equal(nativeRunMediaEdge(previous, { sequence: 5, state: "failed" }), "failed");
});

test("native run media owns surface visibility and actor handshakes", async () => {
  const calls = [];
  const host = { hidden: true, getBoundingClientRect: () => ({ width: 800, height: 450 }) };
  const video = { hidden: false };
  const placeholder = { hidden: false };
  let active = false;
  const controller = {
    get activeFence() { return active ? { sessionId: "session", generation: 1 } : null; },
    async prepare() { calls.push("prepare"); active = true; },
    async awaitPrepared() { calls.push("prepared"); return { sequence: 2, state: "paused", positionMs: 0 }; },
    async play() { calls.push("play"); },
    async pause() { calls.push("pause"); },
    async awaitState({ states }) { calls.push(`await:${states.join(",")}`); return { sequence: calls.length, state: states[0], positionMs: 125 }; },
    async status() { return { sequence: 9, state: "playing", positionMs: 150 }; },
    async setViewport() { calls.push("viewport"); return { sequence: 10, state: "playing", positionMs: 150 }; },
    async stop() { calls.push("stop"); active = false; return { sequence: 11, state: "idle", positionMs: null }; },
  };
  const media = new NativeRunMedia({
    controller,
    resolveHost: () => host,
    resolveFallbackVideo: () => video,
    resolvePlaceholder: () => placeholder,
  });
  await media.prepare({ workspaceId: "workspace", summary: {} });
  assert.equal(host.hidden, false);
  assert.equal(video.hidden, true);
  assert.equal(placeholder.hidden, true);
  await media.play();
  assert.equal(media.positionMs, 125);
  await media.pause();
  await media.setViewport();
  await media.stop();
  assert.equal(host.hidden, true);
  assert.equal(media.active, false);
  assert.deepEqual(calls, ["prepare", "prepared", "play", "await:playing", "pause", "await:paused", "viewport", "stop"]);
});

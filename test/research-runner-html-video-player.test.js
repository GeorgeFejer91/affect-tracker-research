import assert from "node:assert/strict";
import test from "node:test";

import { createRunnerHtmlVideoPlayer } from "../runner/src/html-video-player.js";

test("desktop HTML playback revokes its exact temporary media grant", async () => {
  const previousElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  class Element {
    constructor() { this.dataset = {}; this.hidden = false; this.children = []; }
    replaceChildren(...children) { this.children = children; }
  }
  class Video extends Element {
    constructor() { super(); this.readyState = 2; this.events = new Map(); }
    addEventListener(name, listener) { this.events.set(name, listener); }
    removeEventListener(name) { this.events.delete(name); }
    setAttribute() {}
    removeAttribute() {}
    pause() {}
    load() {}
    async play() {}
  }
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Video() };
  try {
    const calls = [];
    const invoke = async (command, args) => {
      calls.push([command, args]);
      if (command === "research_runner_master_html_video_url") return {
        mediaUrl: "http://research-media.localhost/token",
        mediaGrantId: "token", workspaceFileId: "wf-test", sha256: "a".repeat(64),
        byteLength: 123, mimeType: "video/mp4",
      };
      return null;
    };
    const player = createRunnerHtmlVideoPlayer(new Element(), { invoke, windowObject: globalThis });
    await player.playStep({ workspaceId: "workspace", sourceText: "recipe", participantId: "P001",
      selector: {}, step: { kind: "video", position: 3,
        payload: { asset: { sha256: "a".repeat(64), byteLength: 123 } } } });
    player.stop();
    await Promise.resolve();
    const release = calls.find(([command]) => command === "research_attest_workspace_decode");
    assert.equal(release?.[1].attestation.mediaGrantId, "token");
    assert.equal(release?.[1].attestation.workspaceFileId, "wf-test");
    assert.equal(release?.[1].attestation.attestationKind, "revokeGrant");
  } finally {
    globalThis.HTMLElement = previousElement;
    globalThis.document = previousDocument;
  }
});

test("a saved video step advances once on observed end and ignores stale end events", async () => {
  const previousElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  class Element {
    constructor() { this.dataset = {}; this.hidden = false; }
    replaceChildren() {}
  }
  class Video extends Element {
    constructor() { super(); this.readyState = 2; this.ended = false; this.currentTime = 0; this.events = new Map(); }
    addEventListener(name, listener) { this.events.set(name, listener); }
    removeEventListener(name) { this.events.delete(name); }
    setAttribute() {}
    removeAttribute() {}
    pause() {}
    load() {}
    async play() {}
  }
  globalThis.HTMLElement = Element;
  globalThis.document = { createElement: () => new Video() };
  try {
    const host = new Element();
    const ends = [];
    const errors = [];
    const invoke = async command => command === "research_runner_master_html_video_url" ? {
      mediaUrl: "http://research-media.localhost/token", mediaGrantId: "token", workspaceFileId: "wf-test",
      sha256: "a".repeat(64), byteLength: 123, mimeType: "video/mp4",
    } : null;
    const player = createRunnerHtmlVideoPlayer(host, {
      invoke, windowObject: globalThis, onEnded: () => ends.push("ended"), onError: error => errors.push(error.message),
    });
    const request = { workspaceId: "workspace", sourceText: "recipe", participantId: "P001", selector: {},
      step: { kind: "video", position: 3, payload: { asset: { sha256: "a".repeat(64), byteLength: 123 } } } };
    await player.playStep(request);
    const video = player.video;
    video.events.get("ended")();
    assert.deepEqual(ends, [], "planned time alone does not end the video");
    video.ended = true;
    video.currentTime = 4.2;
    video.events.get("ended")();
    video.events.get("ended")();
    assert.deepEqual(ends, ["ended"], "duplicate ended events cannot skip another step");
    player.stop();
    video.ended = false;
    await player.playStep(request);
    video.error = { code: 3 };
    video.events.get("error")();
    video.events.get("error")();
    assert.deepEqual(errors, ["HTML video decode failed (3)."]);
    player.stop();
    video.events.get("ended")();
    video.events.get("error")();
    assert.deepEqual(ends, ["ended"]);
    assert.equal(errors.length, 1);
  } finally {
    globalThis.HTMLElement = previousElement;
    globalThis.document = previousDocument;
  }
});

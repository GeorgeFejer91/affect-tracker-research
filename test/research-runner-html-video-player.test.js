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

import test from "node:test";
import assert from "node:assert/strict";

// Minimal DOM doubles exercise the real player's lifecycle logic. They test
// event wiring, not that a real video decodes in the installed application.
class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.hidden = false;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type) { for (const handler of [...(this.listeners.get(type) ?? [])]) handler({ type }); }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
}

class FakeVideo extends FakeElement {
  constructor() {
    super("video");
    this.readyState = 0;
    this.currentTime = 0;
    this.ended = false;
    this.src = "";
    this.error = null;
    this.playCalls = 0;
    this.playResult = () => Promise.resolve();
  }
  load() { }
  pause() { }
  play() { this.playCalls += 1; return this.playResult(); }
}

function harness({ mediaUrl = "blob:one", sha256 = "a".repeat(64), byteLength = 10, mimeType = "video/mp4" } = {}) {
  const videos = [];
  // Each occurrence gets its own element, so defaults are applied on creation.
  const defaults = { readyState: 2, playResult: () => Promise.resolve() };
  globalThis.HTMLElement = FakeElement;
  globalThis.document = { createElement: () => {
    const made = new FakeVideo();
    made.readyState = defaults.readyState;
    made.playResult = defaults.playResult;
    videos.push(made);
    return made;
  } };
  const timers = new Map();
  let nextTimer = 1;
  const windowObject = {
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    URL: { revokeObjectURL: (url) => released.push(url) },
  };
  const released = [];
  const events = [];
  const host = new FakeElement("div");
  let resolveUrl = null;
  const invoke = () => (resolveUrl
    ? resolveUrl
    : Promise.resolve({ mediaUrl, sha256, byteLength, mimeType }));
  return {
    videos, host, events, released, timers, windowObject, defaults,
    get video() { return videos.at(-1); },
    videoAt(index) { return videos[index]; },
    setUrlResolution(promise) { resolveUrl = promise; },
    fireTimers() { for (const [id, entry] of [...timers]) { timers.delete(id); entry.fn(); } },
    options: {
      invoke,
      windowObject,
      releaseMediaUrl: (url) => { if (typeof url === "string") released.push(url); },
      onStarted: (detail) => events.push({ type: "started", ...detail }),
      onEnded: (detail) => events.push({ type: "ended", ...detail }),
      onFailed: (detail) => events.push({ type: "failed", occurrenceId: detail.occurrenceId, message: detail.error.message }),
      onInterrupted: (detail) => events.push({ type: "interrupted", ...detail }),
      onResumed: (detail) => events.push({ type: "resumed", ...detail }),
    },
  };
}

const step = (position = 1) => ({
  kind: "video",
  position,
  payload: { asset: { sha256: "a".repeat(64), byteLength: 10, mimeType: "video/mp4" } },
});

const { createRunnerHtmlVideoPlayer } = await import("../experiment-runner/src/html-video-player.js");

async function play(player, h, occurrenceId, position = 1) {
  return player.playStep({ workspaceId: "w", sourceText: "{}", participantId: "P001", selector: {}, step: step(position), occurrenceId });
}

test("a start is recorded only from the observed playing transition", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  const result = await play(player, h, "occ-1");
  assert.equal(result.occurrenceId, "occ-1");
  // play() resolved, but nothing has actually played yet.
  assert.deepEqual(h.events, []);
  h.video.currentTime = 0.004;
  h.video.emit("playing");
  assert.deepEqual(h.events, [{ type: "started", occurrenceId: "occ-1", mediaTimeMs: 4 }]);
});

test("one completed video produces exactly one start and one end", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1");
  h.video.emit("playing");
  h.video.currentTime = 3.5;
  h.video.emit("ended");
  h.video.emit("ended"); // duplicate completion callback
  assert.deepEqual(h.events.map(e => e.type), ["started", "ended"]);
  assert.equal(h.events[1].mediaTimeMs, 3500);
});

test("pause, buffering and resume never repeat the trial start", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1");
  h.video.emit("playing");
  h.video.emit("pause");
  h.video.emit("waiting");
  h.video.emit("playing");
  h.video.emit("playing");
  h.video.emit("ended");
  assert.deepEqual(h.events.map(e => e.type), ["started", "interrupted", "interrupted", "resumed", "resumed", "ended"]);
  assert.deepEqual(h.events.filter(e => e.type === "started").length, 1);
});

test("the same media file played twice has two distinct occurrences", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1", 1);
  h.video.emit("playing");
  h.video.emit("ended");
  await play(player, h, "occ-2", 4);
  h.video.emit("playing");
  h.video.emit("ended");
  assert.deepEqual(h.events.map(e => e.occurrenceId), ["occ-1", "occ-1", "occ-2", "occ-2"]);
});

test("a late event from a replaced occurrence cannot advance the next one", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1", 1);
  h.videoAt(0).emit("playing");
  await play(player, h, "occ-2", 2);
  // The element for the previous occurrence fires late.
  h.videoAt(0).emit("ended");
  assert.deepEqual(h.events.map(e => `${e.type}:${e.occurrenceId}`), ["started:occ-1"]);
  h.videoAt(1).emit("playing");
  assert.deepEqual(h.events.map(e => `${e.type}:${e.occurrenceId}`), ["started:occ-1", "started:occ-2"]);
});

test("an end without observed playback is a failure, never a normal completion", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1");
  h.video.emit("ended");
  assert.deepEqual(h.events.map(e => e.type), ["failed"]);
  assert.match(h.events[0].message, /without any observed playback/u);
});

test("a runtime decode error reports failure and no successful end", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1");
  h.video.emit("playing");
  h.video.error = { code: 3 };
  h.video.emit("error");
  h.video.emit("ended");
  assert.deepEqual(h.events.map(e => e.type), ["started", "failed"]);
});

test("a rejected play() surfaces the rejection and leaves no owning occurrence", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  h.defaults.playResult = () => Promise.reject(new Error("NotAllowedError"));
  await assert.rejects(() => play(player, h, "occ-1"), /NotAllowedError/u);
  assert.equal(player.occurrenceId, null);
  h.video.emit("playing");
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.released, ["blob:one"]);
});

test("the start watchdog reports failure instead of a successful completion", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1");
  h.fireTimers();
  assert.deepEqual(h.events.map(e => e.type), ["failed"]);
  assert.match(h.events[0].message, /never reported observed playback/u);
});

test("a media URL resolved after the occurrence changed is released, not played", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  let settle;
  h.setUrlResolution(new Promise((resolve) => { settle = resolve; }));
  const pending = play(player, h, "occ-1");
  player.stop();
  settle({ mediaUrl: "blob:late", sha256: "a".repeat(64), byteLength: 10, mimeType: "video/mp4" });
  assert.equal(await pending, null);
  assert.deepEqual(h.released, ["blob:late"]);
  assert.deepEqual(h.events, []);
});

test("stop and destroy release the media URL and remove every listener", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await play(player, h, "occ-1");
  assert.ok(h.video.listenerCount("playing") > 0);
  player.stop();
  assert.deepEqual(h.released, ["blob:one"]);
  // Stopping already releases the occurrence's element; destroy stays safe to
  // call afterwards and leaves nothing attached.
  player.destroy();
  for (const type of ["playing", "ended", "error", "waiting", "pause"]) {
    assert.equal(h.video.listenerCount(type), 0, `${type} listener survived stop/destroy`);
  }
  assert.deepEqual(h.host.children, []);
  assert.deepEqual(h.released, ["blob:one"]);
});

test("repeated playback never accumulates elements, listeners or media URLs", async () => {
  const h = harness();
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  for (let index = 0; index < 5; index += 1) {
    await play(player, h, `occ-${index}`, index + 1);
    h.video.emit("playing");
    h.video.emit("ended");
  }
  player.destroy();
  assert.equal(h.videos.length, 5);
  assert.equal(h.released.length, 5, "every occurrence released its media URL");
  for (const element of h.videos) {
    for (const type of ["playing", "ended", "error", "waiting", "pause"]) {
      assert.equal(element.listenerCount(type), 0);
    }
  }
  assert.equal(h.timers.size, 0, "no start watchdog survived");
});

test("a receipt for a different file is rejected and its URL released", async () => {
  const h = harness({ sha256: "b".repeat(64) });
  const player = createRunnerHtmlVideoPlayer(h.host, h.options);
  await assert.rejects(() => play(player, h, "occ-1"), /different video hash/u);
  assert.deepEqual(h.released, ["blob:one"]);
  assert.equal(player.occurrenceId, null);
});

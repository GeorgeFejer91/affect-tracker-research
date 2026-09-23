import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerPreviewWindow, PLANNER_PREVIEW_WINDOW_MESSAGE_SCHEMA as schema } from "../experiment-planner/web/src/research/planner-preview-window.js";
import { createPlannerFlubberWindow, PLANNER_FLUBBER_CHANNEL, PLANNER_FLUBBER_SCHEMA } from "../experiment-planner/web/src/research/planner-flubber-window.js";

test("the separate preview window mirrors current state and delegates confirmation to the Planner owner", async () => {
  let receive;
  let confirmed = false;
  let openedWith;
  const messages = [];
  const popup = {
    closed: false,
    focus() {},
    close() { this.closed = true; },
    postMessage(message, origin) { messages.push({ message, origin }); },
  };
  const host = {
    location: { origin: "https://planner.invalid" },
    open: (...args) => { openedWith = args; return popup; },
    addEventListener(type, listener) { if (type === "message") receive = listener; },
    removeEventListener() {},
  };
  const controller = createPlannerPreviewWindow({
    windowObject: host,
    url: "https://planner.invalid/preview.html",
    readState: () => ({ x: 0.5, y: -0.25 }),
    readConfirmation: () => ({ id: "feedback", confirmed }),
    confirm: async () => { confirmed = true; },
  });

  assert.equal(controller.open(), true);
  assert.deepEqual(openedWith, ["https://planner.invalid/preview.html", "affect-planner-preview"]);
  await receive({ source: popup, data: { schema, type: "ready" } });
  assert.deepEqual(messages.at(-1), {
    message: { schema, type: "state", state: { x: 0.5, y: -0.25 }, confirmation: { id: "feedback", confirmed: false } },
    origin: "https://planner.invalid",
  });
  await receive({ source: popup, data: { schema, type: "confirm" } });
  assert.equal(confirmed, true);
  assert.equal(messages.at(-1).message.confirmation.confirmed, true);
  controller.destroy();
  assert.equal(popup.closed, true);
});

test("the independent Flubber window edits the Planner-owned controls over one same-origin channel", async () => {
  const messages = [];
  const edits = [];
  let receiveChannel;
  let opened = false;
  class FakeBroadcastChannel {
    constructor(name) { assert.equal(name, "affect-research-planner-preview"); }
    addEventListener(type, listener) { if (type === "message") receiveChannel = listener; }
    removeEventListener() {}
    postMessage(message) { messages.push(message); }
    close() {}
  }
  const controller = createPlannerPreviewWindow({
    windowObject: {
      location: { origin: "tauri://localhost" },
      BroadcastChannel: FakeBroadcastChannel,
      open() { opened = true; return null; },
      addEventListener() {},
      removeEventListener() {},
    },
    url: "tauri://localhost/preview.html",
    readMarkup: () => "<aside>Flubber settings</aside>",
    readState: () => ({ x: 0, y: 0 }),
    readControls: () => ({ controls: [{ value: "130" }], mirrors: [] }),
    readConfirmation: () => ({ id: "feedback", confirmed: false }),
    applyEdit: edit => { edits.push(edit); },
    confirm: async () => {},
  });
  assert.equal(messages[0].type, "host-ready");
  await receiveChannel({ data: { schema, type: "ready" } });
  assert.equal(messages.at(-1).type, "state");
  assert.equal(messages.at(-1).markup, "<aside>Flubber settings</aside>");
  assert.equal(messages.at(-1).controls.controls[0].value, "130");
  await receiveChannel({ data: { schema, type: "edit", edit: { index: 0, type: "input", value: "144" } } });
  assert.deepEqual(edits, [{ index: 0, type: "input", value: "144" }]);
  assert.equal(controller.open(), true);
  assert.equal(opened, false, "a connected independent window is focused instead of duplicated");
  assert.equal(messages.at(-1).type, "focus");
  controller.destroy();
});

test("the standalone Flubber receives appearance snapshots and can be shown without editing the draft", () => {
  const messages = [];
  let receiveChannel;
  let shown = 0;
  let state = { x: 0, colors: { idle: "#111111" } };
  class FakeBroadcastChannel {
    constructor(name) { assert.equal(name, PLANNER_FLUBBER_CHANNEL); }
    addEventListener(type, listener) { if (type === "message") receiveChannel = listener; }
    removeEventListener() {}
    postMessage(message) { messages.push(message); }
    close() {}
  }
  const controller = createPlannerFlubberWindow({
    windowObject: {
      location: { origin: "tauri://localhost" }, BroadcastChannel: FakeBroadcastChannel,
      addEventListener() {}, removeEventListener() {},
      open() { throw new Error("Native preview must not use window.open."); },
    },
    url: "tauri://localhost/flubber.html",
    readState: () => structuredClone(state),
    showNative: () => { shown += 1; },
  });
  assert.equal(messages[0].type, "host-ready");
  receiveChannel({ data: { schema: PLANNER_FLUBBER_SCHEMA, type: "ready" } });
  assert.deepEqual(messages.at(-1).state, state);
  state = { x: 0.5, colors: { idle: "#222222" } };
  controller.update();
  assert.deepEqual(messages.at(-1).state, state);
  controller.open();
  assert.equal(shown, 1);
  controller.destroy();
});

test("trial layout requests read the current Planner projection on demand", async () => {
  const messages = [];
  let receiveChannel;
  let revision = 1;
  class FakeBroadcastChannel {
    addEventListener(type, listener) { if (type === "message") receiveChannel = listener; }
    removeEventListener() {}
    postMessage(message) { messages.push(message); }
    close() {}
  }
  const controller = createPlannerPreviewWindow({
    windowObject: {
      location: { origin: "tauri://localhost" }, BroadcastChannel: FakeBroadcastChannel,
      addEventListener() {}, removeEventListener() {}, open() { throw new Error("Already connected."); },
    },
    url: "tauri://localhost/preview.html",
    readState: () => ({}), readConfirmation: () => ({}), confirm: async () => {},
    readTrial: () => ({ revision }),
  });
  await receiveChannel({ data: { schema, type: "ready" } });
  revision = 2;
  await receiveChannel({ data: { schema, type: "trial" } });
  assert.equal(messages.at(-1).type, "trial-state");
  assert.deepEqual(messages.at(-1).trial, { revision: 2 });
  controller.destroy();
});

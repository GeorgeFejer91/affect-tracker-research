import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerPreviewWindow, PLANNER_PREVIEW_WINDOW_MESSAGE_SCHEMA as schema } from "../experiment-planner/web/src/research/planner-preview-window.js";

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

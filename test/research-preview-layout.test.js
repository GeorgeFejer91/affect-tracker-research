import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewLayout } from "../site/src/research/preview-layout.js";

function fixture({ observerEnabled = true } = {}) {
  const frames = new Map(), classes = new Set(), observed = [];
  let nextId = 0, delivery, disconnected = false, writes = 0;
  const pane = {
    clientHeight: 700,
    ownerDocument: { documentElement: {} },
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 100 }) }),
    classList: {
      contains: name => classes.has(name),
      toggle(name, enabled) { writes++; if (enabled) classes.add(name); else classes.delete(name); },
    },
  };
  const controller = createPreviewLayout(pane, {
    ResizeObserver: observerEnabled ? class {
      constructor(callback) { delivery = callback; }
      observe(element) { observed.push(element); }
      disconnect() { disconnected = true; }
    } : null,
    requestFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelFrame: id => frames.delete(id),
    readStyle: () => ({ paddingTop: "10px", paddingBottom: "10px", rowGap: "10px", fontSize: "16px" }),
  });
  return { pane, controller, frames, observed, classes,
    delivery: () => delivery(), writes: () => writes, disconnected: () => disconnected,
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
  };
}

test("preview geometry changes are coalesced outside resize delivery and skip redundant writes", () => {
  const f = fixture();
  assert.equal(f.observed.length, 4);
  assert.equal(f.writes(), 0);
  f.pane.clientHeight = 300;
  f.delivery(); f.delivery();
  assert.equal(f.frames.size, 1);
  assert.equal(f.writes(), 0, "observer delivery cannot synchronously change geometry");
  f.flush();
  assert.ok(f.classes.has("preview-pane-scroll-all"));
  assert.equal(f.writes(), 1);
  f.delivery(); f.flush();
  assert.equal(f.writes(), 1, "stable geometry causes no class mutation");
  f.pane.clientHeight = 700;
  f.delivery(); f.flush();
  assert.equal(f.classes.size, 0);
  f.controller.destroy();
});

test("preview teardown cancels queued layout and ignores late observer or frame callbacks", () => {
  const f = fixture();
  f.pane.clientHeight = 300; f.delivery();
  const late = [...f.frames.values()][0];
  f.controller.destroy(); f.controller.destroy();
  assert.ok(f.disconnected());
  assert.equal(f.frames.size, 0);
  late(); f.delivery(); f.controller.refresh();
  assert.equal(f.frames.size, 0);
  assert.equal(f.writes(), 0);
});

test("explicit refresh remains available without ResizeObserver", () => {
  const f = fixture({ observerEnabled: false });
  f.pane.clientHeight = 300; f.controller.refresh();
  assert.ok(f.classes.has("preview-pane-scroll-all"));
  f.controller.destroy();
});

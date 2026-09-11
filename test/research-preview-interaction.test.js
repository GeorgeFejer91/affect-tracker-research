import test from "node:test";
import assert from "node:assert/strict";
import { createInputBindingPreset } from "../site/src/research/contracts.js";
import { createPreviewResponseSimulator } from "../site/src/research/preview-response-simulator.js";
import { previewTileGeometry } from "../site/src/research/preview-tiles.js";
import { createPreviewInteraction, previewPointFromPointer } from "../site/src/research/preview-interaction.js";

function harness(preset = "arrowKeys") {
  const doc = new EventTarget(), win = new EventTarget();
  doc.hidden = false; doc.modal = false; doc.querySelector = () => doc.modal ? {} : null;
  class Surface extends EventTarget {
    captured = null;
    closest() { return null; }
    getBoundingClientRect() { return { left: 10, top: 20, width: 300, height: 200 }; }
    focus() { doc.activeElement?.dispatchEvent?.(new Event("blur")); doc.activeElement = this; this.dispatchEvent(new Event("focus")); }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
  }
  const map = new Surface(), stage = new Surface(), frames = new Map();
  let id = 0, binding = createInputBindingPreset(preset), enabled = true, pads = [], availability = "";
  const requestFrame = fn => { frames.set(++id, fn); return id; }, cancelFrame = id => frames.delete(id);
  const simulator = createPreviewResponseSimulator({ requestFrame, cancelFrame, now: () => 0 });
  simulator.configure({ tileCount: 3, tileRows: 5 });
  const adapter = createPreviewInteraction({ map, stage, simulator, document: doc, window: win,
    getBinding: () => binding, isEnabled: () => enabled, getGamepads: () => pads,
    requestFrame, cancelFrame, onAvailability: message => { availability = message; } });
  const fire = (target, type, values = {}) => {
    const event = new Event(type, { cancelable: true }); Object.assign(event, values); target.dispatchEvent(event); return event;
  };
  return { map, stage, doc, win, simulator, adapter, fire, frames,
    setBinding(value) { binding = value; adapter.sync(); }, disable() { enabled = false; adapter.sync(); },
    setPads(value) { pads = value; }, get availability() { return availability; },
    frame() { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(job => job(0)); },
    destroy() { adapter.destroy(); simulator.destroy(); } };
}

test("map clicks select every actual cell of a rectangular grid, continuous points and bounded edges", () => {
  for (const [tileCount, tileRows] of [[3, 5], [5, 3], [21, 21]]) {
    for (let column = 0; column < tileCount; column++) for (let row = 0; row < tileRows; row++) {
      for (const offset of [.01, .5, .99]) {
        const point = previewPointFromPointer({ clientX: (column + offset) * 300 / tileCount, clientY: (row + offset) * 200 / tileRows },
          { left: 0, top: 0, width: 300, height: 200 }, { mode: "stepwise", tileCount, tileRows });
        const tile = previewTileGeometry(point.x, point.y, tileCount, tileRows);
        assert.equal(tile.column, column); assert.equal(tile.row, row);
      }
    }
  }
  assert.deepEqual(previewPointFromPointer({ clientX: 200, clientY: 75 }, { left: 100, top: 50, width: 400, height: 100 }, { mode: "continuous" }), { x: -.5, y: .5 });
  assert.equal(previewPointFromPointer({ clientX: 1, clientY: 2 }, { width: 0, height: 3 }, {}), null);
  const h = harness();
  h.fire(h.map, "pointerdown", { button: 0, pointerId: 1, clientX: 290, clientY: 30 });
  assert.equal(h.map.captured, 1); assert.equal(h.simulator.snapshot().x, 1); assert.equal(h.simulator.snapshot().y, 1);
  h.fire(h.map, "pointermove", { pointerId: 2, clientX: 0, clientY: 999 });
  assert.equal(h.simulator.snapshot().x, 1);
  h.fire(h.map, "pointermove", { pointerId: 1, clientX: 0, clientY: 999 });
  assert.equal(h.simulator.snapshot().x, -1); assert.equal(h.simulator.snapshot().y, -1);
  h.fire(h.map, "pointercancel", { pointerId: 1 }); assert.equal(h.map.captured, null); h.destroy();
});

test("configured keyboard presets work on focused Flubber, not fields, modifiers, dialogs or Run", () => {
  for (const [preset, code] of [["arrowKeys", "ArrowRight"], ["wasd", "KeyD"], ["ijkl", "KeyL"], ["numpad", "Numpad6"]]) {
    const h = harness(preset); h.stage.focus();
    assert.ok(h.fire(h.stage, "keydown", { code, key: code, ctrlKey: true }).defaultPrevented === false);
    h.fire(h.stage, "keydown", { code, key: code }); assert.equal(h.simulator.snapshot().x, 1);
    h.fire(h.stage, "keyup", { code, key: code }); assert.deepEqual(h.simulator.snapshot().heldDirections, []);
    h.simulator.reset(); h.doc.modal = true;
    h.fire(h.stage, "keydown", { code, key: code }); assert.equal(h.simulator.snapshot().x, 0);
    h.doc.modal = false; h.doc.activeElement = {}; h.fire(h.stage, "keydown", { code, key: code }); assert.equal(h.simulator.snapshot().x, 0);
    h.stage.focus(); h.disable(); h.fire(h.stage, "keydown", { code, key: code }); assert.equal(h.simulator.snapshot().x, 0); h.destroy();
  }
});

test("custom bindings take precedence over arrow fallback; repeat and focus/binding loss release safely", () => {
  const h = harness("wasd"); h.map.focus();
  const custom = structuredClone(createInputBindingPreset("wasd")); custom.preset = "custom"; custom.directions.up = { kind: "keyboard", code: "ArrowRight" };
  h.setBinding(custom);
  h.fire(h.map, "keydown", { code: "ArrowRight", key: "ArrowRight" }); assert.equal(h.simulator.snapshot().y, .5); assert.equal(h.simulator.snapshot().x, 0);
  h.fire(h.map, "keydown", { code: "ArrowRight", key: "ArrowRight", repeat: true }); assert.equal(h.simulator.snapshot().y, .5);
  h.setBinding(createInputBindingPreset("arrowKeys")); assert.deepEqual(h.simulator.snapshot().heldDirections, []);
  h.fire(h.map, "keydown", { code: "ArrowLeft", key: "ArrowLeft" }); h.fire(h.win, "blur"); assert.deepEqual(h.simulator.snapshot().heldDirections, []);
  h.destroy(); h.fire(h.map, "keydown", { code: "ArrowUp", key: "ArrowUp" }); assert.equal(h.simulator.snapshot().y, .5);
});

test("configured mouse buttons and wheel work while map primary click always selects its cell", () => {
  const h = harness("mouseButtonsWheel"); h.stage.focus();
  h.fire(h.stage, "pointerdown", { button: 0, pointerId: 5 }); assert.equal(h.simulator.snapshot().x, 1);
  h.fire(h.stage, "pointerup", { pointerId: 5 }); assert.deepEqual(h.simulator.snapshot().heldDirections, []);
  h.fire(h.stage, "wheel", { deltaY: -1, deltaX: 0 }); assert.equal(h.simulator.snapshot().y, .5);
  h.fire(h.map, "pointerdown", { button: 0, pointerId: 6, clientX: 160, clientY: 120 });
  assert.equal(h.simulator.snapshot().x, 0); assert.equal(h.simulator.snapshot().y, 0);
  h.doc.hidden = true; h.fire(h.doc, "visibilitychange"); assert.equal(h.map.captured, null); h.destroy();
});

test("focused gamepad edges require release after connect, analog axes follow bindings, polling tears down", () => {
  const h = harness("gamepadDpad"); const pad = { index: 0, id: "fixture", buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [.5, -.5, -1, 1] };
  pad.buttons[15].pressed = true; h.setPads([pad]); h.map.focus(); h.frame(); assert.equal(h.simulator.snapshot().x, 0);
  pad.buttons[15].pressed = false; h.frame(); pad.buttons[15].pressed = true; h.frame(); assert.equal(h.simulator.snapshot().x, 1);
  h.setPads([]); h.frame(); assert.deepEqual(h.simulator.snapshot().heldDirections, []); assert.match(h.availability, /No gamepad/u);
  h.setPads([pad]); h.setBinding(createInputBindingPreset("gamepadRightStick")); h.frame();
  assert.equal(h.simulator.snapshot().x, -1); assert.equal(h.simulator.snapshot().y, -1);
  h.setBinding(createInputBindingPreset("gamepadLeftStick")); h.frame(); assert.equal(h.simulator.snapshot().x, 1); assert.equal(h.simulator.snapshot().y, .5);
  h.fire(h.map, "blur"); assert.equal(h.frames.size, 0); h.destroy();
});

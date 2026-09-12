import test from "node:test";
import assert from "node:assert/strict";
import { hsvToHex, hexToHsv, createInlineColorPicker } from "../site/src/research/inline-color-picker.js";

test("inline color conversion round-trips RGB and preserves hue through neutral colors", () => {
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const hex = `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    assert.equal(hsvToHex(hexToHsv(hex)), hex);
  }
  assert.equal(hexToHsv("#000000", 217).h, 217);
  assert.equal(hexToHsv("#FFFFFF", 217).h, 217);
  for (const value of [null, 42, "red", "#fff", "#00000000", "#xxxxxx"]) assert.equal(hexToHsv(value), null);
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  assert.equal(hsvToHex({ h: -10, s: 8, v: 8 }), "#ff0000");
});

test("inline picker bounds drag and keyboard drafts and releases capture/listeners", () => {
  class Element extends EventTarget {
    attributes = new Map();
    setAttribute(key, value) { this.attributes.set(key, value); }
  }
  class Canvas extends Element {
    width = 320; height = 210; captured = null;
    getContext() { return null; }
    getBoundingClientRect() { return { left: 20, top: 30, width: 320, height: 210 }; }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
    focus() {}
  }
  class Input extends Element { value = "0"; }
  const previous = [globalThis.HTMLCanvasElement, globalThis.HTMLInputElement];
  globalThis.HTMLCanvasElement = Canvas; globalThis.HTMLInputElement = Input;
  try {
    const map = new Canvas(), hue = new Input(), strip = new Canvas(), status = new Element();
    const root = { querySelector: selector => ({ "[data-inline-color-map]": map, "[data-inline-color-hue]": hue, "[data-inline-hue-strip]": strip, "[data-inline-color-status]": status })[selector] };
    const changes = [];
    const picker = createInlineColorPicker(root, { onChange: hex => { changes.push(hex); picker.setColor(hex); } });
    const fire = (element, type, properties = {}) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, properties); element.dispatchEvent(event); return event;
    };
    picker.setColor("#2f80ed"); assert.equal(changes.length, 0);
    picker.setColor("invalid"); picker.setColor(3);
    assert.ok(fire(map, "keydown", { key: "ArrowDown", shiftKey: true }).defaultPrevented);
    assert.equal(changes.at(-1), hsvToHex({ ...hexToHsv("#2f80ed"), v: 237 / 255 - .1 }));
    fire(map, "pointerdown", { button: 0, pointerId: 1, clientX: 500, clientY: -10 });
    assert.equal(map.captured, 1);
    fire(map, "pointermove", { pointerId: 2, clientX: 20, clientY: 300 });
    assert.notEqual(changes.at(-1), "#000000");
    fire(map, "pointermove", { pointerId: 1, clientX: 20, clientY: 300 });
    assert.equal(changes.at(-1), "#000000");
    hue.value = "120"; fire(hue, "input"); assert.equal(hue.value, "120");
    fire(map, "blur"); assert.equal(map.captured, null);
    fire(map, "pointerdown", { button: 0, pointerId: 3, clientX: 340, clientY: 30 });
    assert.equal(changes.at(-1), "#00ff00");
    const count = changes.length;
    picker.destroy(); picker.destroy();
    assert.equal(map.captured, null);
    fire(map, "keydown", { key: "ArrowDown" }); fire(hue, "input");
    assert.equal(changes.length, count);
  } finally {
    if (previous[0] === undefined) delete globalThis.HTMLCanvasElement; else globalThis.HTMLCanvasElement = previous[0];
    if (previous[1] === undefined) delete globalThis.HTMLInputElement; else globalThis.HTMLInputElement = previous[1];
  }
});

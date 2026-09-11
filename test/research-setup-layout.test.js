import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSetupLayout } from "../site/src/research/setup-layout.js";
import { renderResearchUiMarkup } from "../site/src/research/ui-view.js";

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`); }

// Controller fixture only: no browser, desktop input or active app is touched.
function target() {
  const listeners = new Map();
  const attributes = new Map();
  return {
    listeners, attributes,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    call(type, fields = {}) {
      const event = { type, button: 0, pointerId: 1, isPrimary: true,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; }, ...fields };
      listeners.get(type)?.(event);
      return event;
    },
  };
}

function fixture() {
  const layout = target(), separator = target(), view = target();
  let observer;
  view.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(element) { assert.equal(element, layout); }
    disconnect() { this.disconnected = true; }
  };
  const values = new Map();
  const size = { width: 1280, left: 25, grip: 8 };
  layout.style = {
    setProperty(name, value) { values.set(name, value); },
    removeProperty(name) { values.delete(name); },
  };
  const width = () => parseFloat(values.get("--setup-sections-width")) || (size.width - size.grip) * 0.625;
  layout.getBoundingClientRect = () => size;
  layout.ownerDocument = { defaultView: view };
  layout.querySelector = () => separator;
  separator.getBoundingClientRect = () => ({ left: size.left + width(), width: size.grip });
  separator.setPointerCapture = (id) => { separator.capture = id; };
  separator.hasPointerCapture = (id) => separator.capture === id;
  separator.releasePointerCapture = (id) => {
    assert.equal(separator.capture, id);
    separator.capture = null;
    separator.call("lostpointercapture", { pointerId: id });
  };
  separator.focus = () => { separator.focused = true; };
  const controller = createSetupLayout(layout);
  const down = (extra = {}) => separator.call("pointerdown", { clientX: size.left + width() + 3, ...extra });
  return { layout, separator, view, size, width, controller, observer, values, down };
}

test("dragging resizes both panes without a jump, clamps both limits, and captures release outside the grip", () => {
  const f = fixture();
  const original = f.width();
  f.down();
  assert.equal(f.separator.capture, 1);
  assert.equal(f.separator.focused, true);
  f.separator.call("pointermove", { clientX: f.size.left + original + 3 });
  assert.equal(f.width(), original);
  f.separator.call("pointermove", { clientX: f.size.left + original + 103 });
  assert.equal(f.width(), original + 100);
  f.separator.call("pointermove", { clientX: -2000 });
  assert.equal(f.width(), 432);
  f.separator.call("pointerup", { clientX: 9000 });
  close(f.size.width - f.size.grip - f.width(), 320);
  assert.equal(f.separator.capture, null);
  assert.equal(f.layout.attributes.has("data-resizing"), false);
  f.separator.call("pointermove", { clientX: 0 });
  close(f.size.width - f.size.grip - f.width(), 320);
  f.controller.destroy();
});

test("secondary buttons and unrelated pointers cannot resize or finish an active drag", () => {
  const f = fixture(), original = f.width();
  f.down({ button: 2 });
  f.down({ isPrimary: false });
  assert.equal(f.separator.capture, undefined);
  f.down();
  f.down({ pointerId: 2 });
  f.separator.call("pointermove", { pointerId: 2, clientX: -10 });
  f.separator.call("pointercancel", { pointerId: 2 });
  assert.equal(f.width(), original);
  assert.equal(f.separator.capture, 1);
  f.controller.destroy();
});

test("Escape restores the starting proportion; lost capture, pointer cancel and blur always end dragging", () => {
  for (const ending of ["Escape", "pointercancel", "lostpointercapture", "blur"]) {
    const f = fixture(), original = f.width();
    f.down();
    f.separator.call("pointermove", { clientX: f.size.left + original - 77 });
    const moved = f.width();
    if (ending === "Escape") f.separator.call("keydown", { key: ending });
    else if (ending === "blur") f.view.call("blur");
    else f.separator.call(ending);
    assert.equal(f.width(), ending === "Escape" ? original : moved);
    assert.equal(f.layout.attributes.has("data-resizing"), false);
    assert.equal(f.separator.capture, null);
    f.controller.destroy();
  }
});

test("keyboard resizing has small/large steps, bounded Home/End, accessible values and reset", () => {
  const f = fixture(), original = f.width();
  const key = (key, extra = {}) => f.separator.call("keydown", { key, ...extra });
  const event = key("ArrowLeft");
  assert.ok(event.prevented && event.stopped);
  close(f.width(), original - 10);
  key("ArrowRight", { shiftKey: true });
  close(f.width(), original + 40);
  key("Home");
  assert.equal(f.width(), 432);
  assert.equal(f.separator.attributes.get("aria-valuenow"), f.separator.attributes.get("aria-valuemin"));
  key("End");
  close(f.size.width - f.size.grip - f.width(), 320);
  assert.equal(f.separator.attributes.get("aria-valuenow"), f.separator.attributes.get("aria-valuemax"));
  assert.match(f.separator.attributes.get("aria-valuetext"), /Sections \d+%, live preview \d+%/u);
  key("Enter");
  assert.equal(f.width(), original);
  assert.equal(key("ArrowLeft", { ctrlKey: true }).prevented, undefined);
  assert.equal(key("Tab").prevented, undefined);
  assert.equal(f.width(), original);
  key("Home");
  f.separator.call("dblclick");
  assert.equal(f.width(), original);
  f.controller.destroy();
});

test("window resizing clamps the rendered width while retaining the preferred proportion across stacking", () => {
  const f = fixture();
  f.separator.call("keydown", { key: "End" });
  const preferred = f.width() / (1280 - 8);
  f.size.width = 800;
  f.observer.callback();
  assert.equal(f.width(), 472);
  f.down();
  f.size.width = 760;
  f.observer.callback();
  assert.equal(f.width(), 432);
  assert.equal(f.separator.tabIndex, -1);
  assert.equal(f.separator.capture, null, "window resize ends the drag when both minima meet");
  f.size.width = 640; f.size.grip = 0;
  f.observer.callback();
  assert.equal(f.separator.tabIndex, -1);
  f.down();
  assert.equal(f.separator.capture, null);
  f.size.width = 1600; f.size.grip = 8;
  f.observer.callback();
  assert.equal(f.width(), (1600 - 8) * preferred);
  assert.equal(f.separator.tabIndex, 0);
  f.controller.destroy();
});

test("leaving Setup or hiding the divider releases capture and rejects further changes", () => {
  for (const hide of [false, true]) {
    const f = fixture(), original = f.width();
    f.down();
    if (hide) { f.size.grip = 0; f.observer.callback(); }
    else f.controller.setEnabled(false);
    assert.equal(f.separator.capture, null);
    assert.equal(f.separator.tabIndex, -1);
    f.separator.call("pointermove", { clientX: 0 });
    f.separator.call("keydown", { key: "Home" });
    assert.equal(f.width(), original);
    f.size.grip = 8;
    f.controller.setEnabled(true);
    assert.equal(f.separator.tabIndex, 0);
    f.controller.destroy();
  }
});

test("teardown removes capture, listeners, observer and layout state; a remount starts fresh", () => {
  const f = fixture();
  f.down();
  f.controller.destroy();
  assert.equal(f.separator.capture, null);
  assert.equal(f.separator.listeners.size, 0);
  assert.equal(f.view.listeners.size, 0);
  assert.equal(f.observer.disconnected, true);
  assert.equal(f.values.size, 0);
  f.observer.callback();
  assert.equal(f.values.size, 0);
  const again = createSetupLayout(f.layout);
  assert.equal(f.width(), (1280 - 8) * 0.625);
  again.destroy();
});

test("both entrypoints expose one labelled Setup separator and keep layout state out of domain authority", async () => {
  for (const surface of ["browser", "tauri"]) {
    const markup = renderResearchUiMarkup(surface);
    assert.equal((markup.match(/data-setup-resizer/gu) ?? []).length, 1);
    assert.ok(markup.indexOf('id="setup-sections"') < markup.indexOf("data-setup-resizer"));
    assert.ok(markup.indexOf("data-setup-resizer") < markup.indexOf('<aside class="preview-pane"'));
    assert.match(markup, /role="separator"[\s\S]*?aria-label="Resize sections and live preview"[\s\S]*?aria-orientation="vertical"/u);
    assert.match(markup, /aria-controls="setup-sections"/u);
  }
  const source = await readFile(new URL("../site/src/research/setup-layout.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bimport\b|localStorage|sessionStorage|indexedDB|dispatchEvent|invoke\(/u);
  const app = await readFile(new URL("../site/src/research/app.js", import.meta.url), "utf8");
  assert.match(app, /setupLayout\.setEnabled\(mode === "setup"\)/u);
  const teardown = app.match(/    destroy\(\) \{([\s\S]*?)\n    \},/u)?.[1];
  assert.ok(teardown, "the app controller exposes its teardown");
  for (const cleanup of ["setupLayout.destroy()", "previewLayout.destroy()", "previewInteraction?.destroy()", "inlineColorPicker.destroy()"]) {
    assert.ok(teardown.includes(cleanup), `combined teardown retains ${cleanup}`);
  }
});

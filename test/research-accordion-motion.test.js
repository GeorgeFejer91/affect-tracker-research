import test from "node:test";
import assert from "node:assert/strict";

import {
  SETUP_ACCORDION_MOTION_MS,
  setSetupAccordionPanelExpanded,
} from "../site/src/research/setup-accordion-motion.js";

class FakePanel {
  constructor({ expanded = false } = {}) {
    this.hidden = !expanded;
    this.inert = !expanded;
    this.dataset = { motionState: expanded ? "open" : "closed" };
    this.attributes = new Map(expanded ? [] : [["aria-hidden", "true"]]);
    this.listeners = new Map();
    this.layoutReads = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  getBoundingClientRect() {
    this.layoutReads += 1;
    return { height: 0 };
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  emitTransitionEnd(propertyName = "grid-template-rows") {
    for (const listener of [...(this.listeners.get("transitionend") ?? [])]) {
      listener({ target: this, propertyName });
    }
  }
}

function installMotionWindow() {
  const previousWindow = globalThis.window;
  const timers = [];
  let nextTimerId = 1;
  let reducedMotion = false;
  globalThis.window = {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout(callback, delay) {
      const timer = { callback, cleared: false, delay, id: nextTimerId };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cleared = true;
    },
  };
  return {
    timers,
    restore() {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
    setReducedMotion(value) {
      reducedMotion = value;
    },
  };
}

test("accordion motion preserves semantics, reverses safely, and settles without timing sleeps", (context) => {
  const environment = installMotionWindow();
  context.after(() => environment.restore());
  assert.ok(Number.isFinite(SETUP_ACCORDION_MOTION_MS));
  assert.ok(SETUP_ACCORDION_MOTION_MS > 0 && SETUP_ACCORDION_MOTION_MS <= 300);

  const panel = new FakePanel();
  setSetupAccordionPanelExpanded(panel, true);
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(panel.dataset.motionState, "opening");
  assert.equal(panel.getAttribute("aria-hidden"), null);
  assert.equal(panel.layoutReads, 1);
  panel.emitTransitionEnd("opacity");
  assert.equal(panel.dataset.motionState, "opening");
  panel.emitTransitionEnd();
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(panel.dataset.motionState, "open");

  setSetupAccordionPanelExpanded(panel, false);
  assert.equal(panel.hidden, false, "closing content remains rendered until motion settles");
  assert.equal(panel.inert, true, "closing content leaves the focus order immediately");
  assert.equal(panel.getAttribute("aria-hidden"), "true");
  assert.equal(panel.dataset.motionState, "closing");
  panel.emitTransitionEnd();
  assert.equal(panel.hidden, true);
  assert.equal(panel.dataset.motionState, "closed");

  environment.setReducedMotion(true);
  setSetupAccordionPanelExpanded(panel, true);
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(panel.dataset.motionState, "open");
  assert.equal(panel.layoutReads, 1, "reduced motion does not stage an animated layout");

  environment.setReducedMotion(false);
  setSetupAccordionPanelExpanded(panel, false);
  panel.emitTransitionEnd();
  const firstRapidTimer = environment.timers.at(-1);
  setSetupAccordionPanelExpanded(panel, true);
  const openingTimer = environment.timers.at(-1);
  setSetupAccordionPanelExpanded(panel, false);
  const closingTimer = environment.timers.at(-1);
  setSetupAccordionPanelExpanded(panel, true);
  const finalOpeningTimer = environment.timers.at(-1);
  openingTimer.callback();
  closingTimer.callback();
  firstRapidTimer.callback();
  assert.equal(panel.dataset.motionState, "opening", "stale completions cannot win");
  finalOpeningTimer.callback();
  assert.equal(panel.hidden, false);
  assert.equal(panel.inert, false);
  assert.equal(panel.dataset.motionState, "open");
  assert.ok(environment.timers.every(({ delay }) => Number.isFinite(delay) && delay > 0));
});

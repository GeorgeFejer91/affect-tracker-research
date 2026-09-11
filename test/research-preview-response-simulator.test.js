import test from "node:test";
import assert from "node:assert/strict";

import * as previewResponse from "../site/src/research/preview-response-simulator.js";

const { createPreviewResponseSimulator } = previewResponse;

function createClock() {
  let current = 0;
  let nextId = 1;
  const callbacks = new Map();
  const cancelled = [];
  return {
    now: () => current,
    requestFrame(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      cancelled.push(id);
      callbacks.delete(id);
    },
    frame(atMs) {
      current = atMs;
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      for (const callback of scheduled) callback(atMs);
    },
    set(atMs) {
      current = atMs;
    },
    get pending() {
      return callbacks.size;
    },
    cancelled,
  };
}

function createHarness(onChange = () => {}) {
  const clock = createClock();
  const simulator = createPreviewResponseSimulator({
    onChange,
    requestFrame: (callback) => clock.requestFrame(callback),
    cancelFrame: (id) => clock.cancelFrame(id),
    now: () => clock.now(),
  });
  return { clock, simulator };
}

function assertPoint(actual, x, y) {
  assert.ok(Math.abs(actual.x - x) < 1e-12, `expected x ${x}, received ${actual.x}`);
  assert.ok(Math.abs(actual.y - y) < 1e-12, `expected y ${y}, received ${actual.y}`);
}

test("the module exposes one constructor and returns a frozen method surface", () => {
  assert.deepEqual(Object.keys(previewResponse), ["createPreviewResponseSimulator"]);
  const { simulator } = createHarness();
  assert.deepEqual(Object.keys(simulator), [
    "configure", "press", "release", "releaseAll", "reset", "setPoint", "snapshot", "destroy",
  ]);
  assert.ok(Object.isFrozen(simulator));
  assert.ok(Object.isFrozen(simulator.snapshot()));
  assert.ok(Object.isFrozen(simulator.snapshot().heldDirections));
});

test("configuration and points clamp safely while invalid enum values retain the current choice", () => {
  const { simulator } = createHarness();
  simulator.configure({
    mode: "continuous",
    fullSpanDurationMs: -1,
    stepSize: 40,
    holdRule: "repeatWhileHeld",
    repeatDelayMs: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(simulator.snapshot(), {
    x: 0,
    y: 0,
    mode: "continuous",
    fullSpanDurationMs: 250,
    stepSize: 1,
    holdRule: "repeatWhileHeld",
    repeatDelayMs: 500,
    heldDirections: [],
  });

  simulator.configure({
    mode: "invalid",
    fullSpanDurationMs: 50_000,
    stepSize: -5,
    holdRule: "invalid",
    repeatDelayMs: 20_000,
  });
  const bounded = simulator.snapshot();
  assert.equal(bounded.mode, "continuous");
  assert.equal(bounded.holdRule, "repeatWhileHeld");
  assert.equal(bounded.fullSpanDurationMs, 15_000);
  assert.equal(bounded.stepSize, 0.001);
  assert.equal(bounded.repeatDelayMs, 5_000);

  simulator.setPoint({ x: -20, y: Number.POSITIVE_INFINITY });
  assertPoint(simulator.snapshot(), -1, 0);
  simulator.setPoint({ x: Symbol("invalid"), y: 20 });
  assertPoint(simulator.snapshot(), 0, 1);
});

test("continuous motion covers the full normalized span in the configured duration", () => {
  const { clock, simulator } = createHarness();
  simulator.configure({ mode: "continuous", fullSpanDurationMs: 2_000 });
  simulator.setPoint({ x: -1, y: 0 });
  simulator.press("right", 0);
  clock.frame(500);
  assertPoint(simulator.snapshot(), -0.5, 0);
  clock.frame(1_000);
  assertPoint(simulator.snapshot(), 0, 0);
  clock.frame(2_000);
  assertPoint(simulator.snapshot(), 1, 0);
});

test("continuous integration is equivalent across frame partitions and clamps both axes", () => {
  const coarse = createHarness();
  const fine = createHarness();
  for (const harness of [coarse, fine]) {
    harness.simulator.configure({ mode: "continuous", fullSpanDurationMs: 1_000 });
    harness.simulator.press("right", 0);
    harness.simulator.press("up", 0);
  }
  coarse.clock.frame(750);
  for (const timestamp of [125, 250, 375, 500, 625, 750]) fine.clock.frame(timestamp);
  assert.deepEqual(coarse.simulator.snapshot(), fine.simulator.snapshot());
  assertPoint(coarse.simulator.snapshot(), 1, 1);
});

test("opposing continuous directions cancel without accumulating deferred travel", () => {
  const { clock, simulator } = createHarness();
  simulator.configure({ mode: "continuous", fullSpanDurationMs: 1_000 });
  simulator.press("right", 0);
  simulator.press("left", 0);
  clock.frame(750);
  assertPoint(simulator.snapshot(), 0, 0);
  clock.set(750);
  simulator.release("left");
  clock.frame(1_000);
  assertPoint(simulator.snapshot(), 0.5, 0);
});

test("stepwise separate-press mode applies exactly one clamped tile step per edge", () => {
  const changes = [];
  const { clock, simulator } = createHarness((state) => changes.push(state));
  simulator.configure({ mode: "stepwise", stepSize: 0.25, holdRule: "separatePresses" });
  simulator.press("left", 0);
  simulator.press("left", 100);
  clock.frame(5_000);
  assertPoint(simulator.snapshot(), -0.25, 0);
  assert.equal(clock.pending, 0);
  simulator.release("left");
  simulator.press("left", 5_000);
  simulator.release("left");
  simulator.press("down", 5_000);
  assertPoint(simulator.snapshot(), -0.5, -0.25);
  assert.equal(changes.length, 3);

  simulator.setPoint({ x: -0.95, y: 0.95 });
  simulator.releaseAll();
  simulator.press("left", 5_000);
  simulator.release("left");
  simulator.press("up", 5_000);
  assertPoint(simulator.snapshot(), -1, 1);
});

test("repeat mode steps immediately and once per elapsed repeat interval", () => {
  const { clock, simulator } = createHarness();
  simulator.configure({
    mode: "stepwise",
    stepSize: 0.1,
    holdRule: "repeatWhileHeld",
    repeatDelayMs: 500,
  });
  simulator.press("right", 0);
  assertPoint(simulator.snapshot(), 0.1, 0);
  clock.frame(499);
  assertPoint(simulator.snapshot(), 0.1, 0);
  clock.frame(500);
  assertPoint(simulator.snapshot(), 0.2, 0);
  clock.frame(1_499);
  assertPoint(simulator.snapshot(), 0.3, 0);
  clock.frame(1_500);
  assertPoint(simulator.snapshot(), 0.4, 0);
});

test("opposing held inputs cancel repeat ticks and skipped ticks never catch up", () => {
  const { clock, simulator } = createHarness();
  simulator.configure({
    mode: "stepwise",
    stepSize: 0.2,
    holdRule: "repeatWhileHeld",
    repeatDelayMs: 500,
  });
  simulator.press("right", 0);
  simulator.press("left", 0);
  assertPoint(simulator.snapshot(), 0, 0);
  clock.frame(1_000);
  assertPoint(simulator.snapshot(), 0, 0);
  clock.set(1_000);
  simulator.release("left");
  clock.frame(1_499);
  assertPoint(simulator.snapshot(), 0, 0);
  clock.frame(1_500);
  assertPoint(simulator.snapshot(), 0.2, 0);
});

test("reset and releaseAll cancel holds, with reset returning to neutral", () => {
  const { clock, simulator } = createHarness();
  simulator.configure({ mode: "continuous", fullSpanDurationMs: 1_000 });
  simulator.press("right", 0);
  clock.frame(250);
  assertPoint(simulator.snapshot(), 0.5, 0);
  simulator.releaseAll();
  assert.deepEqual(simulator.snapshot().heldDirections, []);
  assert.equal(clock.pending, 0);
  clock.frame(1_000);
  assertPoint(simulator.snapshot(), 0.5, 0);

  simulator.press("up", 1_000);
  assert.equal(clock.pending, 1);
  simulator.reset();
  assertPoint(simulator.snapshot(), 0, 0);
  assert.deepEqual(simulator.snapshot().heldDirections, []);
  assert.equal(clock.pending, 0);
});

test("mode and hold-rule changes release active keys without moving the point", () => {
  const { clock, simulator } = createHarness();
  simulator.configure({ mode: "continuous", fullSpanDurationMs: 1_000 });
  simulator.press("right", 0);
  clock.set(400);
  simulator.configure({ mode: "stepwise" });
  assertPoint(simulator.snapshot(), 0, 0);
  assert.deepEqual(simulator.snapshot().heldDirections, []);
  assert.equal(clock.pending, 0);

  simulator.configure({ holdRule: "repeatWhileHeld", stepSize: 0.2 });
  simulator.press("up", 400);
  assertPoint(simulator.snapshot(), 0, 0.2);
  clock.set(700);
  simulator.configure({ holdRule: "separatePresses" });
  assertPoint(simulator.snapshot(), 0, 0.2);
  assert.deepEqual(simulator.snapshot().heldDirections, []);
  assert.equal(clock.pending, 0);
});

test("destroy cancels the pending frame and stale callbacks cannot mutate state", () => {
  const clock = createClock();
  let staleCallback = null;
  const changes = [];
  const simulator = createPreviewResponseSimulator({
    onChange: (state) => changes.push(state),
    requestFrame(callback) {
      staleCallback = callback;
      return clock.requestFrame(callback);
    },
    cancelFrame: (id) => clock.cancelFrame(id),
    now: () => clock.now(),
  });
  simulator.configure({ mode: "continuous", fullSpanDurationMs: 1_000 });
  simulator.press("right", 0);
  assert.equal(clock.pending, 1);
  simulator.destroy();
  assert.equal(clock.pending, 0);
  assert.equal(clock.cancelled.length, 1);
  staleCallback?.(500);
  assertPoint(simulator.snapshot(), 0, 0);
  assert.deepEqual(simulator.snapshot().heldDirections, []);
  assert.equal(changes.length, 0);
  assert.doesNotThrow(() => simulator.destroy());
});

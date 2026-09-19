import { DEFAULT_PREVIEW_TILE_COUNT, parsePreviewTileCount, snapPreviewCoordinate } from "./preview-tiles.js";

const DIRECTIONS = Object.freeze(["left", "right", "up", "down"]);
const DIRECTION_SET = new Set(DIRECTIONS);
const MODES = new Set(["continuous", "stepwise"]);
const HOLD_RULES = new Set(["separatePresses", "repeatWhileHeld"]);

const DEFAULT_CONFIGURATION = Object.freeze({
  mode: "stepwise",
  fullSpanDurationMs: 2_000,
  tileCount: DEFAULT_PREVIEW_TILE_COUNT,
  tileRows: DEFAULT_PREVIEW_TILE_COUNT,
  holdRule: "separatePresses",
  repeatDelayMs: 500,
});

function finite(value, fallback) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedCoordinate(value) {
  return clamp(finite(value, 0), -1, 1);
}

function directionDelta(direction, amount) {
  if (direction === "left") return { x: -amount, y: 0 };
  if (direction === "right") return { x: amount, y: 0 };
  if (direction === "up") return { x: 0, y: amount };
  return { x: 0, y: -amount };
}

function oppositeDirection(direction) {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "up") return "down";
  return "up";
}

function assertDirection(direction) {
  if (!DIRECTION_SET.has(direction)) {
    throw new TypeError("Preview response direction must be left, right, up, or down.");
  }
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultRequestFrame(callback) {
  return globalThis.requestAnimationFrame(callback);
}

function defaultCancelFrame(frameId) {
  globalThis.cancelAnimationFrame(frameId);
}

export function createPreviewResponseSimulator({
  onChange = () => {},
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  now = defaultNow,
} = {}) {
  if (typeof onChange !== "function" || typeof requestFrame !== "function"
    || typeof cancelFrame !== "function" || typeof now !== "function") {
    throw new TypeError("Preview response simulator dependencies must be functions.");
  }

  let configuration = { ...DEFAULT_CONFIGURATION };
  let point = { x: 0, y: 0 };
  const heldDirections = new Set();
  const nextRepeatAt = new Map();
  let lastContinuousAt = null;
  let frameId = null;
  let destroyed = false;

  function snapshot() {
    return Object.freeze({
      x: point.x,
      y: point.y,
      mode: configuration.mode,
      fullSpanDurationMs: configuration.fullSpanDurationMs,
      tileCount: configuration.tileCount,
      tileRows: configuration.tileRows,
      stepSize: 2 / (configuration.tileCount - 1),
      stepSizeY: 2 / (configuration.tileRows - 1),
      holdRule: configuration.holdRule,
      repeatDelayMs: configuration.repeatDelayMs,
      heldDirections: Object.freeze(DIRECTIONS.filter((direction) => heldDirections.has(direction))),
    });
  }

  function emitIfChanged(previous) {
    if (point.x !== previous.x || point.y !== previous.y) onChange(snapshot());
  }

  function applyDirection(direction) {
    const previous = point;
    const amount = 2 / ((direction === "left" || direction === "right" ? configuration.tileCount : configuration.tileRows) - 1);
    const delta = directionDelta(direction, amount);
    point = {
      x: snapPreviewCoordinate(point.x + delta.x, configuration.tileCount),
      y: snapPreviewCoordinate(point.y + delta.y, configuration.tileRows),
    };
    emitIfChanged(previous);
  }

  function resolvedTime(candidate) {
    return finite(candidate, finite(now(), 0));
  }

  function cancelScheduledFrame() {
    if (frameId === null) return;
    cancelFrame(frameId);
    frameId = null;
  }

  function shouldAnimate() {
    return heldDirections.size > 0 && (
      configuration.mode === "continuous"
      || configuration.holdRule === "repeatWhileHeld"
    );
  }

  function advanceContinuous(atMs) {
    const timestamp = lastContinuousAt === null ? atMs : Math.max(lastContinuousAt, atMs);
    if (lastContinuousAt === null) {
      lastContinuousAt = timestamp;
      return;
    }
    const elapsed = timestamp - lastContinuousAt;
    lastContinuousAt = timestamp;
    if (elapsed <= 0) return;

    const horizontal = Number(heldDirections.has("right")) - Number(heldDirections.has("left"));
    const vertical = Number(heldDirections.has("up")) - Number(heldDirections.has("down"));
    if (horizontal === 0 && vertical === 0) return;
    const previous = point;
    const travel = (elapsed * 2) / configuration.fullSpanDurationMs;
    point = {
      x: clamp(point.x + horizontal * travel, -1, 1),
      y: clamp(point.y + vertical * travel, -1, 1),
    };
    emitIfChanged(previous);
  }

  function advanceRepeats(atMs) {
    while (true) {
      let dueAt = Number.POSITIVE_INFINITY;
      for (const direction of heldDirections) {
        dueAt = Math.min(dueAt, nextRepeatAt.get(direction) ?? Number.POSITIVE_INFINITY);
      }
      if (dueAt > atMs || !Number.isFinite(dueAt)) return;

      const dueDirections = DIRECTIONS.filter((direction) => (
        heldDirections.has(direction) && (nextRepeatAt.get(direction) ?? Number.POSITIVE_INFINITY) === dueAt
      ));
      for (const direction of dueDirections) {
        nextRepeatAt.set(direction, dueAt + configuration.repeatDelayMs);
        if (!heldDirections.has(oppositeDirection(direction))) applyDirection(direction);
      }
    }
  }

  function advance(atMs) {
    if (configuration.mode === "continuous") {
      advanceContinuous(atMs);
    } else if (configuration.holdRule === "repeatWhileHeld") {
      advanceRepeats(atMs);
    }
  }

  function scheduleFrame() {
    if (destroyed || frameId !== null || !shouldAnimate()) return;
    frameId = requestFrame((timestamp) => {
      frameId = null;
      if (destroyed) return;
      advance(resolvedTime(timestamp));
      scheduleFrame();
    });
  }

  function clearHolds() {
    heldDirections.clear();
    nextRepeatAt.clear();
    lastContinuousAt = null;
    cancelScheduledFrame();
  }

  function configure(next = {}) {
    if (destroyed) return snapshot();
    const source = next !== null && (typeof next === "object" || typeof next === "function")
      ? next
      : {};
    // Legacy square callers can supply tileCount alone; rectangular drafts are atomic.
    const columns = parsePreviewTileCount(source.tileCount);
    const rows = parsePreviewTileCount(source.tileRows ?? source.tileCount);
    const validDimensions = columns !== null && rows !== null;
    const nextConfiguration = {
      mode: MODES.has(source.mode) ? source.mode : configuration.mode,
      fullSpanDurationMs: clamp(
        finite(source.fullSpanDurationMs, configuration.fullSpanDurationMs),
        250,
        15_000,
      ),
      tileCount: validDimensions ? columns : configuration.tileCount,
      tileRows: validDimensions ? rows : configuration.tileRows,
      holdRule: HOLD_RULES.has(source.holdRule) ? source.holdRule : configuration.holdRule,
      repeatDelayMs: clamp(finite(source.repeatDelayMs, configuration.repeatDelayMs), 500, 5_000),
    };
    const releasesHeldInput = nextConfiguration.mode !== configuration.mode
      || nextConfiguration.holdRule !== configuration.holdRule
      || nextConfiguration.tileCount !== configuration.tileCount
      || nextConfiguration.tileRows !== configuration.tileRows;
    configuration = nextConfiguration;
    if (releasesHeldInput) clearHolds();
    if (configuration.mode === "stepwise") {
      const previous = point;
      point = {
        x: snapPreviewCoordinate(point.x, configuration.tileCount),
        y: snapPreviewCoordinate(point.y, configuration.tileRows),
      };
      emitIfChanged(previous);
    }
    return snapshot();
  }

  function press(direction, atMs) {
    assertDirection(direction);
    if (destroyed || heldDirections.has(direction)) return snapshot();
    const timestamp = resolvedTime(atMs);
    advance(timestamp);
    heldDirections.add(direction);
    if (configuration.mode === "continuous") {
      lastContinuousAt = timestamp;
    } else {
      applyDirection(direction);
      if (configuration.holdRule === "repeatWhileHeld") {
        nextRepeatAt.set(direction, timestamp + configuration.repeatDelayMs);
      }
    }
    scheduleFrame();
    return snapshot();
  }

  function release(direction) {
    assertDirection(direction);
    if (destroyed || !heldDirections.has(direction)) return snapshot();
    advance(resolvedTime());
    heldDirections.delete(direction);
    nextRepeatAt.delete(direction);
    if (configuration.mode === "continuous") lastContinuousAt = resolvedTime();
    if (!shouldAnimate()) cancelScheduledFrame();
    return snapshot();
  }

  function releaseAll() {
    if (!destroyed) clearHolds();
    return snapshot();
  }

  function reset() {
    if (destroyed) return snapshot();
    clearHolds();
    const previous = point;
    point = { x: 0, y: 0 };
    emitIfChanged(previous);
    return snapshot();
  }

  function setPoint(next = {}) {
    if (destroyed) return snapshot();
    const source = next !== null && (typeof next === "object" || typeof next === "function")
      ? next
      : {};
    const previous = point;
    point = {
      x: configuration.mode === "stepwise" ? snapPreviewCoordinate(normalizedCoordinate(source.x), configuration.tileCount) : normalizedCoordinate(source.x),
      y: configuration.mode === "stepwise" ? snapPreviewCoordinate(normalizedCoordinate(source.y), configuration.tileRows) : normalizedCoordinate(source.y),
    };
    emitIfChanged(previous);
    return snapshot();
  }

  function destroy() {
    if (destroyed) return;
    clearHolds();
    destroyed = true;
  }

  return Object.freeze({
    configure,
    press,
    release,
    releaseAll,
    reset,
    setPoint,
    snapshot,
    destroy,
  });
}

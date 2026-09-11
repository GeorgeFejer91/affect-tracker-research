// Focus-scoped presentation adapter only. Never emits acquisition/test receipts.
import { capturedDigitalAction } from "./input-controller.js";
import { snapPreviewCoordinate } from "./preview-tiles.js";

const arrows = Object.freeze({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" });
const directions = ["up", "down", "left", "right"];
const clamp = value => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
const signature = action => action && `${action.kind}:${action.code ?? action.button ?? action.direction}`;

export function previewPointFromPointer(event, bounds, state) {
  if (!(bounds?.width > 0 && bounds.height > 0) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  // In tiled mode select the cell actually under the pointer, not the closest
  // normalized sample (whose endpoint spacing differs from equal-width cells).
  const cellPoint = (position, count) => {
    const index = Math.min(count - 1, Math.max(0, Math.floor(position * count)));
    return (index - (count - 1) / 2) * 2 / (count - 1);
  };
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  return state.mode === "stepwise"
    ? { x: cellPoint(x, state.tileCount), y: -cellPoint(y, state.tileRows) || 0 }
    : { x: clamp(x * 2 - 1), y: clamp(1 - y * 2) };
}

export function createPreviewInteraction({ map, stage, simulator, getBinding, isEnabled,
  onAvailability = () => {},
  document: doc = globalThis.document, window: win = globalThis.window,
  getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
  requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
}) {
  let destroyed = false, frame = null, fingerprint = "", pointer = null, previousPad = null;
  const active = new Map(), previousButtons = new Map(), cleanup = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanup.push(() => target.removeEventListener(type, handler, options));
  };
  const focused = () => doc.activeElement === map || doc.activeElement === stage;
  const allowed = () => !destroyed && isEnabled() && !doc.hidden && !doc.querySelector("dialog[open]");
  const bindingDirection = action => {
    const binding = getBinding();
    return binding.kind === "digital" ? directions.find(direction => signature(binding.directions[direction]) === signature(action)) : null;
  };
  function release(key) {
    const direction = active.get(key);
    active.delete(key);
    if (direction && ![...active.values()].includes(direction)) simulator.release(direction);
  }
  function press(key, direction) {
    if (!direction || active.has(key)) return;
    active.set(key, direction); simulator.press(direction);
  }
  function releaseAll() {
    simulator.releaseAll(); active.clear(); previousButtons.clear(); previousPad = null;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    const prior = pointer; pointer = null;
    if (prior?.target.hasPointerCapture?.(prior.id)) prior.target.releasePointerCapture(prior.id);
  }
  function point(event) {
    const next = previewPointFromPointer(event, map.getBoundingClientRect(), simulator.snapshot());
    if (next) simulator.setPoint(next);
  }
  function poll() {
    frame = null;
    if (!allowed() || !focused()) { releaseAll(); return; }
    const binding = getBinding();
    let pad;
    try { pad = [...getGamepads()].find(Boolean); }
    catch { releaseAll(); onAvailability("Gamepad input is unavailable in this preview. Use the map or arrow keys."); return; }
    onAvailability(pad ? "" : "No gamepad is exposed to this preview. Use the map or arrow keys.");
    const identity = pad ? `${pad.index}:${pad.id}` : null;
    if (identity !== previousPad) {
      for (const key of [...active.keys()]) if (key.startsWith("pad:")) release(key);
      previousButtons.clear(); previousPad = identity;
    }
    if (pad && binding.kind === "analog") {
      const axis = token => {
        const value = clamp(Number(pad.axes?.[token.index]));
        return Math.abs(value) < .12 ? 0 : token.invert ? -value : value;
      };
      const next = { x: axis(binding.axes.x), y: axis(binding.axes.y) };
      const state = simulator.snapshot();
      if (state.mode === "stepwise") {
        next.x = snapPreviewCoordinate(next.x, state.tileCount);
        next.y = snapPreviewCoordinate(next.y, state.tileRows);
      }
      simulator.setPoint(next);
    } else if (pad && binding.kind === "digital") {
      for (const direction of directions) {
        const token = binding.directions[direction];
        if (token.kind !== "gamepadButton") continue;
        const key = `pad:${token.button}`, down = Boolean(pad.buttons?.[token.button]?.pressed);
        // Require a fresh edge after focus/reconnect, not a button already held.
        if (down && previousButtons.get(key) === false) press(key, direction);
        if (!down) release(key);
        previousButtons.set(key, down);
      }
    }
    frame = requestFrame(poll);
  }
  function sync() {
    const next = JSON.stringify(getBinding());
    if (next !== fingerprint) { releaseAll(); fingerprint = next; }
    if (!allowed() || !focused()) { releaseAll(); return; }
    const binding = getBinding();
    const needsPad = binding.kind === "analog" || (binding.kind === "digital" && Object.values(binding.directions).some(token => token.kind === "gamepadButton"));
    if (!needsPad) onAvailability("");
    if (needsPad && frame === null) frame = requestFrame(poll);
  }
  for (const target of [map, stage]) {
    listen(target, "focus", sync);
    listen(target, "blur", releaseAll);
    listen(target, "keydown", event => {
      if (!allowed() || !focused() || event.target !== target || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      sync();
      const action = capturedDigitalAction(event);
      const direction = bindingDirection(action) ?? arrows[event.key];
      if (!direction) return;
      if (!event.repeat) press(signature(action) ?? event.key, direction);
      event.preventDefault(); event.stopPropagation();
    });
    listen(target, "keyup", event => {
      const key = signature(capturedDigitalAction({ type: "keydown", code: event.code })) ?? event.key;
      if (active.has(key)) { release(key); event.preventDefault(); event.stopPropagation(); }
    });
    listen(target, "pointerdown", event => {
      if (!allowed() || event.target.closest?.("button,input,select,textarea") || pointer) return;
      target.focus(); sync();
      if (target === map && event.button === 0) {
        releaseAll(); point(event);
        pointer = { id: event.pointerId, target, map: true };
      } else {
        const action = capturedDigitalAction(event), direction = bindingDirection(action);
        if (!direction) return; // Preserve existing stage position dragging.
        const key = signature(action); press(key, direction);
        pointer = { id: event.pointerId, target, key };
      }
      target.setPointerCapture(event.pointerId);
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    listen(target, "pointermove", event => {
      if (pointer?.id !== event.pointerId || pointer.target !== target) return;
      if (!allowed()) { releaseAll(); return; }
      if (pointer.map) point(event);
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) listen(target, type, event => {
      if (pointer?.id !== event.pointerId || pointer.target !== target) return;
      const prior = pointer; pointer = null;
      if (prior.key) release(prior.key);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      event.preventDefault(); event.stopImmediatePropagation(); sync();
    }, { capture: true });
    listen(target, "wheel", event => {
      if (!allowed() || !focused()) return;
      const direction = bindingDirection(capturedDigitalAction(event));
      if (!direction) return;
      const state = simulator.snapshot();
      // A wheel notch is momentary, so it cannot express a held duration.
      simulator.setPoint({ x: state.x + (direction === "left" ? -state.stepSize : direction === "right" ? state.stepSize : 0),
        y: state.y + (direction === "down" ? -state.stepSizeY : direction === "up" ? state.stepSizeY : 0) });
      event.preventDefault(); event.stopPropagation();
    }, { passive: false });
    listen(target, "contextmenu", event => {
      if (allowed() && focused() && bindingDirection({ kind: "mouseButton", button: 2 })) event.preventDefault();
    });
  }
  listen(win, "blur", releaseAll);
  listen(doc, "visibilitychange", () => { if (doc.hidden) releaseAll(); });
  return Object.freeze({ sync, releaseAll, destroy() {
    if (destroyed) return;
    destroyed = true; releaseAll(); cleanup.forEach(remove => remove());
  } });
}

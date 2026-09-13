import { INPUT_PRESETS, validateInputBindingV1 } from "../../site/src/research/contracts.js";
import { capturedDigitalAction, withCustomDigitalAction } from "../../site/src/research/input-controller.js";

const DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);
const TARGETS = Object.freeze([...DIRECTIONS, "neutral"]);
const LABELS = Object.freeze({
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  neutral: "Neutral",
});

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

function actionSignature(action) {
  if (action.kind === "keyboard") return `keyboard:${action.code.toLowerCase()}`;
  if (action.kind === "mouseButton") return `mouseButton:${action.button}`;
  if (action.kind === "wheel") return `wheel:${action.direction}`;
  if (action.kind === "gamepadButton") return `gamepadButton:${action.button}`;
  throw new TypeError("Unsupported digital input action.");
}

function bindingPayload(binding) {
  return {
    kind: binding.kind,
    stepSize: binding.stepSize,
    directions: binding.directions,
    axes: binding.axes,
  };
}

function sameBindingPayload(left, right) {
  return JSON.stringify(bindingPayload(left)) === JSON.stringify(bindingPayload(right));
}

function describeInputToken(token) {
  if (!token) return "Set hotkey";
  if (token.kind === "keyboard") return token.code;
  if (token.kind === "wheel") return `Wheel ${token.direction}`;
  if (token.kind === "mouseButton") return `Mouse button ${token.button}`;
  if (token.kind === "gamepadButton") return `Gamepad button ${token.button}`;
  if (token.kind === "pointerAxis") return `Pointer ${token.axis.toUpperCase()}${token.invert ? " reversed" : ""}`;
  if (token.kind === "gamepadAxis") return `Gamepad axis ${token.index}${token.invert ? " reversed" : ""}`;
  return "Unassigned";
}

function describeBinding(binding) {
  const label = INPUT_PRESETS[binding.preset]?.label ?? "Custom bindings";
  if (binding.kind === "digital") return `${label} · step ${binding.stepSize}`;
  return `${label} · set in Planner`;
}

function pressedGamepadButtons(windowObject) {
  const pads = Array.from(windowObject.navigator?.getGamepads?.() ?? []).filter(Boolean);
  const pressed = [];
  for (const pad of pads) {
    for (const [button, state] of Array.from(pad.buttons ?? []).entries()) {
      if (state?.pressed) pressed.push({ id: `${pad.index}:${button}`, button });
    }
  }
  return pressed;
}

// UI draft only until a versioned native override/attempt receipt is implemented.
// Never rewrite the loaded recipe to masquerade an override as authored settings.
export function createRunnerControllerSettings(root, { onChange, windowObject = root.ownerDocument.defaultView } = {}) {
  const query = id => root.querySelector(`#${id}`);
  const outputs = Object.fromEntries(TARGETS.map(target => [target, root.querySelector(`[data-controller-binding-value="${target}"]`)]));
  const buttons = Array.from(root.querySelectorAll("[data-controller-capture]"));
  const captureTarget = windowObject ?? root.ownerDocument.defaultView;
  const requestFrame = callback => captureTarget.requestAnimationFrame?.(callback) ?? captureTarget.setTimeout(callback, 16);
  const cancelFrame = id => {
    if (captureTarget.cancelAnimationFrame) captureTarget.cancelAnimationFrame(id);
    else captureTarget.clearTimeout(id);
  };
  let original = null, override = null, neutralOverride = null, listening = null;
  let gamepadFrame = null, gamepadBaseline = new Set();
  let captureListenersActive = false;
  let suppressCaptureClickUntil = 0;

  const currentBinding = () => override ?? original;
  const hasOverride = () => override !== null || neutralOverride !== null;
  const notify = () => onChange?.(hasOverride()
    ? Object.freeze({ binding: override ? clone(override) : null, neutral: neutralOverride ? clone(neutralOverride) : null })
    : null);

  function setNote(message = null) {
    if (message) {
      query("runner-controller-note").textContent = message;
      return;
    }
    if (!original) {
      query("runner-controller-note").textContent = "";
    } else if (listening) {
      query("runner-controller-note").textContent = `Listening for ${LABELS[listening]}. Press a key, click, scroll, or press a gamepad button.`;
    } else if (hasOverride()) {
      const parts = [];
      if (override) parts.push("movement bindings");
      if (neutralOverride) parts.push(`neutral ${describeInputToken(neutralOverride)}`);
      query("runner-controller-note").textContent = `Session override draft: ${parts.join(" + ")}. Execution with overrides is not connected yet; restore the file settings before running an experiment.`;
    } else if (original.kind === "digital") {
      query("runner-controller-note").textContent = "Using the experiment file's settings. Changes here apply only to this Runner session.";
    } else {
      query("runner-controller-note").textContent = "This file uses Planner-authored analog or pointer movement. Only the neutral hotkey can be drafted here.";
    }
  }

  function render() {
    const binding = currentBinding();
    query("runner-controller-status").textContent = original ? `Experiment file: ${describeBinding(original)}` : "Load an experiment to see its configured input.";
    for (const direction of DIRECTIONS) {
      outputs[direction].textContent = binding?.kind === "digital" ? describeInputToken(binding.directions[direction]) : "Planner";
    }
    outputs.neutral.textContent = describeInputToken(neutralOverride);
    for (const button of buttons) {
      const target = button.dataset.controllerCapture;
      const disabled = !original || (target !== "neutral" && currentBinding()?.kind !== "digital");
      button.disabled = disabled;
      button.toggleAttribute("data-listening", listening === target);
      button.setAttribute("aria-pressed", listening === target ? "true" : "false");
    }
    query("runner-controller-reset").disabled = !hasOverride();
    setNote();
  }

  function removeCaptureListeners() {
    if (!captureListenersActive) return;
    captureTarget.removeEventListener("keydown", onCaptureEvent, true);
    captureTarget.removeEventListener("mousedown", onCaptureEvent, true);
    captureTarget.removeEventListener("pointerdown", onCaptureEvent, true);
    captureTarget.removeEventListener("wheel", onCaptureEvent, true);
    captureListenersActive = false;
  }

  function cancelGamepadPolling() {
    if (gamepadFrame !== null) cancelFrame(gamepadFrame);
    gamepadFrame = null;
    gamepadBaseline = new Set();
  }

  function cancelCapture({ renderAfter = true } = {}) {
    listening = null;
    removeCaptureListeners();
    cancelGamepadPolling();
    if (renderAfter) render();
  }

  function duplicateDirection(action, binding = currentBinding()) {
    if (binding?.kind !== "digital") return;
    const next = actionSignature(action);
    return DIRECTIONS.find(direction => actionSignature(binding.directions[direction]) === next);
  }

  function rejectDuplicateNeutral(action, binding = currentBinding()) {
    const duplicate = duplicateDirection(action, binding);
    if (duplicate) throw new TypeError(`That physical action is already assigned to ${LABELS[duplicate]}.`);
  }

  function applyCapture(action) {
    if (!listening || !original) return;
    const target = listening;
    if (target === "neutral") {
      rejectDuplicateNeutral(action);
      neutralOverride = clone(action);
    } else {
      const candidate = withCustomDigitalAction(currentBinding(), target, action);
      if (neutralOverride) rejectDuplicateNeutral(neutralOverride, candidate);
      override = sameBindingPayload(candidate, original) ? null : candidate;
    }
    cancelCapture({ renderAfter: false });
    notify();
    render();
  }

  function completeCapture(action, event) {
    if (event?.type === "mousedown" || event?.type === "pointerdown") {
      suppressCaptureClickUntil = (captureTarget.performance?.now?.() ?? Date.now()) + 300;
    }
    try {
      applyCapture(action);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return true;
    } catch (error) {
      setNote(error.message);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return false;
    }
  }

  function onCaptureEvent(event) {
    if (!listening) return;
    if (event.type === "keydown" && (event.key === "Escape" || event.key === "Tab")) {
      event.preventDefault();
      event.stopPropagation();
      cancelCapture();
      return;
    }
    if (event.type === "keydown" && event.repeat) return;
    const action = capturedDigitalAction(event);
    if (action) completeCapture(action, event);
    else setNote("That input is not supported for Runner binding capture.");
  }

  function pollGamepads() {
    if (!listening) return;
    for (const pressed of pressedGamepadButtons(captureTarget)) {
      if (!gamepadBaseline.has(pressed.id)) {
        completeCapture({ kind: "gamepadButton", button: pressed.button }, null);
        return;
      }
    }
    gamepadFrame = requestFrame(pollGamepads);
  }

  function beginCapture(target) {
    if (!TARGETS.includes(target) || !original) return;
    if (target !== "neutral" && currentBinding()?.kind !== "digital") {
      setNote("Movement bindings for this file are changed in Experiment Planner.");
      return;
    }
    cancelCapture({ renderAfter: false });
    listening = target;
    captureTarget.addEventListener("keydown", onCaptureEvent, true);
    captureTarget.addEventListener("mousedown", onCaptureEvent, true);
    captureTarget.addEventListener("pointerdown", onCaptureEvent, true);
    captureTarget.addEventListener("wheel", onCaptureEvent, { capture: true, passive: false });
    captureListenersActive = true;
    gamepadBaseline = new Set(pressedGamepadButtons(captureTarget).map(pressed => pressed.id));
    gamepadFrame = requestFrame(pollGamepads);
    render();
  }

  function reset() {
    override = null;
    neutralOverride = null;
    cancelCapture({ renderAfter: false });
    notify();
    render();
  }

  function onCaptureButtonClick(event) {
    if ((captureTarget.performance?.now?.() ?? Date.now()) < suppressCaptureClickUntil) {
      event.preventDefault();
      return;
    }
    beginCapture(event.currentTarget.dataset.controllerCapture);
  }

  for (const button of buttons) {
    button.addEventListener("click", onCaptureButtonClick);
  }
  query("runner-controller-reset").addEventListener("click", reset);
  render();

  return Object.freeze({
    adopt(binding) {
      original = validateInputBindingV1(binding);
      override = null;
      neutralOverride = null;
      cancelCapture({ renderAfter: false });
      notify();
      render();
    },
    get overridden() { return hasOverride(); },
    destroy() {
      cancelCapture({ renderAfter: false });
      for (const button of buttons) {
        button.removeEventListener("click", onCaptureButtonClick);
      }
      query("runner-controller-reset").removeEventListener("click", reset);
    },
  });
}

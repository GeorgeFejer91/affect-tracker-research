import { createResearchPreview } from "./preview.js";
import { previewOverlayMarkup } from "./feedback-surface.js";
import { createInlineColorPicker } from "./inline-color-picker.js";
import { createBoundedTextFitter } from "./text-fit.js";
import { previewPointFromPointer } from "./preview-interaction.js";
import { createPreviewResponseSimulator } from "./preview-response-simulator.js";

const MESSAGE_SCHEMA = "affect-research-planner-preview-v1";
const CHANNEL_NAME = "affect-research-planner-preview";

const CONTROL_SELECTOR = "input,select,textarea,button,details,summary,output:not([data-preview-x]):not([data-preview-y]):not([data-preview-position]),dialog";
const root = document.querySelector("#preview-window-app");
if (!(root instanceof HTMLElement)) throw new Error("Preview window root is missing.");

root.innerHTML = `<main class="planner-preview-window-shell">
  <header class="flubber-settings-header"><h1 data-fit-text data-fit-text-preferred="1" data-fit-text-min="0.85">Flubber Settings</h1><div class="planner-preview-window-actions"><button id="preview-trial-open" type="button" aria-label="Trial layout" title="Trial layout"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M5 13l3-3 2 2 3-4 2 3"/></svg></button><button id="preview-flubber-show" type="button" aria-label="Show feedback preview" title="Show feedback preview"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10c2.2-3 4.9-4.5 8-4.5s5.8 1.5 8 4.5c-2.2 3-4.9 4.5-8 4.5S4.2 13 2 10Z"/><circle cx="10" cy="10" r="2.2"/></svg></button><button id="preview-window-minimize" type="button" aria-label="Minimize Flubber settings" title="Minimize" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 14.5h12"/></svg></button></div></header>
  <div class="flubber-settings-display" aria-label="Feedback display"></div>
  <nav class="flubber-settings-tabs" role="tablist" aria-label="Flubber settings">
    <button id="settings-tab-appearance" type="button" role="tab" aria-label="Appearance" aria-controls="preview-settings-panel" data-settings-tab="appearance" aria-selected="true"><span class="flubber-tab-icon" aria-hidden="true">◐</span><span data-fit-text data-fit-text-preferred="0.84" data-fit-text-min="0.75">Look</span></button>
    <button id="settings-tab-colors" type="button" role="tab" aria-label="Colors" aria-controls="preview-settings-panel" data-settings-tab="colors" aria-selected="false" tabindex="-1"><span class="flubber-tab-icon" aria-hidden="true">◉</span><span data-fit-text data-fit-text-preferred="0.84" data-fit-text-min="0.75">Colors</span></button>
    <button id="settings-tab-input" type="button" role="tab" aria-label="Input" aria-controls="preview-settings-panel" data-settings-tab="input" aria-selected="false" tabindex="-1"><span class="flubber-tab-icon" aria-hidden="true">⌘</span><span data-fit-text data-fit-text-preferred="0.84" data-fit-text-min="0.75">Input</span></button>
    <button id="settings-tab-response" type="button" role="tab" aria-label="Response" aria-controls="preview-settings-panel" data-settings-tab="response" aria-selected="false" tabindex="-1"><span class="flubber-tab-icon" aria-hidden="true">↔</span><span data-fit-text data-fit-text-preferred="0.84" data-fit-text-min="0.75">Response</span></button>
    <button id="settings-tab-advanced" type="button" role="tab" aria-label="Advanced" aria-controls="preview-settings-panel" data-settings-tab="advanced" aria-selected="false" tabindex="-1"><span class="flubber-tab-icon" aria-hidden="true">⚙</span><span data-fit-text data-fit-text-preferred="0.84" data-fit-text-min="0.75">More</span></button>
  </nav>
  <div class="flubber-settings-detail-nav" hidden><label for="preview-input-section" hidden>Input</label><select id="preview-input-section" hidden><option value="device">Device</option><option value="bindings">Bindings</option><option value="test">Live test</option></select><label for="preview-detail-section" hidden>Controls</label><select id="preview-detail-section" hidden><option value="outline">Outline</option><option value="grid">Grid</option><option value="palette">Other colors</option><option value="motion">Motion mapping</option><option value="legacy">Legacy layout</option></select><select id="preview-detail-mapping" aria-label="Motion property" hidden></select></div>
  <div id="preview-settings-panel" class="planner-preview-window-content" role="tabpanel" aria-labelledby="settings-tab-appearance" tabindex="0"><p class="empty-state">Connecting to the Experiment Planner…</p></div>
  <footer>
    <p id="preview-window-status" role="status" aria-live="polite">Waiting for the Experiment Planner…</p>
    <button id="preview-window-confirm" type="button" data-fit-text data-fit-text-preferred="0.85" data-fit-text-min="0.75" disabled>Confirm settings</button>
  </footer>
</main>
<dialog id="preview-trial-dialog" class="preview-trial-dialog" aria-labelledby="preview-trial-title">
  <header><h2 id="preview-trial-title">Trial layout preview</h2><button id="preview-trial-close" type="button">Close</button></header>
  <p>Visual rehearsal of one authored video and feedback placement. No video playback, input sampling or recording occurs here.</p>
  <p id="preview-trial-message" role="status"></p>
  <div id="preview-trial-stage" class="research-preview-stage preview-trial-stage" data-preview-variant="studio" role="img" aria-label="Trial screen layout" hidden>
    <div class="preview-trial-video" data-preview-trial-video></div>
    ${previewOverlayMarkup({ includeFace: true })}
  </div>
</dialog>`;
root.dataset.settingsTab = "appearance";
root.dataset.settingsDetail = "outline";
root.dataset.settingsInput = "device";
const nativeWindow = Boolean(window.__TAURI_INTERNALS__);
if (nativeWindow) {
  document.body.dataset.nativeWindow = "true";
  root.querySelector("#preview-window-minimize").hidden = false;
}

let preview = null;
let simulator = null;
let syncingPoint = false;
let trialPreview = null;
let colorPicker = null;
let currentState = null;
let contentControls = [];
const textFitter = createBoundedTextFitter(root);
const status = root.querySelector("#preview-window-status");
const confirmButton = root.querySelector("#preview-window-confirm");
const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
const channel = typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel(CHANNEL_NAME) : null;

function post(type, detail = {}) {
  const message = { schema: MESSAGE_SCHEMA, type, ...detail };
  if (channel) channel.postMessage(message);
  else window.opener?.postMessage(message, targetOrigin);
}

function controls() {
  return contentControls;
}

function ensureContent(markup) {
  if (preview || typeof markup !== "string") return;
  const content = root.querySelector(".planner-preview-window-content");
  content.innerHTML = markup;
  contentControls = [...content.querySelectorAll(CONTROL_SELECTOR)];
  const displayModes = content.querySelector(".preview-header-controls");
  if (displayModes) root.querySelector(".flubber-settings-display").append(displayModes);
  content.querySelector(".preview-controls-scroll")?.removeAttribute("tabindex");
  const mappingSelect = root.querySelector("#preview-detail-mapping");
  for (const details of content.querySelectorAll("#preview-advanced-settings [data-mapping]")) {
    const option = document.createElement("option");
    option.value = details.dataset.mapping;
    option.textContent = details.querySelector("summary")?.textContent ?? details.dataset.mapping;
    mappingSelect?.append(option);
  }
  showMapping();
  preview = createResearchPreview(content.querySelector(".preview-pane"), {
    initialState: { lockPosition: true },
    animate: false,
    onPositionChange(position) { post("position", { position }); },
  });
  simulator = createPreviewResponseSimulator({
    onChange(point) { if (!syncingPoint) post("point", { point: { x: point.x, y: point.y } }); },
  });
  const map = content.querySelector(".preview-control-surface");
  let mapPointer = null;
  const heldDirections = new Map();
  const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
  function sendPoint(event) {
    const point = previewPointFromPointer(event, map.getBoundingClientRect(), simulator.snapshot());
    if (point) simulator.setPoint(point);
  }
  function releaseDirections() {
    simulator.releaseAll();
    heldDirections.clear();
  }
  map?.addEventListener("pointerdown", event => {
    if (event.button !== 0 || mapPointer !== null) return;
    mapPointer = event.pointerId;
    map.setPointerCapture(event.pointerId);
    map.focus();
    sendPoint(event);
    event.preventDefault();
  });
  map?.addEventListener("pointermove", event => {
    if (event.pointerId === mapPointer) sendPoint(event);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) map?.addEventListener(type, event => {
    if (event.pointerId !== mapPointer) return;
    mapPointer = null;
    if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
  });
  map?.addEventListener("keydown", event => {
    const direction = directions[event.key];
    if (!direction || event.repeat || event.altKey || event.ctrlKey || event.metaKey || heldDirections.has(event.code)) return;
    heldDirections.set(event.code, direction);
    simulator.press(direction);
    event.preventDefault();
  });
  map?.addEventListener("keyup", event => {
    const direction = heldDirections.get(event.code);
    if (!direction) return;
    heldDirections.delete(event.code);
    simulator.release(direction);
    event.preventDefault();
  });
  map?.addEventListener("blur", releaseDirections);
  window.addEventListener("blur", releaseDirections);
  colorPicker = createInlineColorPicker(content.querySelector("#preview-color-picker"), {
    onChange(hex) {
      const input = content.querySelector("#preview-color-hex");
      if (!(input instanceof HTMLInputElement)) return;
      input.value = hex;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });
}

function showMapping() {
  const selected = root.querySelector("#preview-detail-mapping")?.value;
  for (const details of root.querySelectorAll("#preview-advanced-settings [data-mapping]")) {
    details.toggleAttribute("data-settings-mapping-visible", details.dataset.mapping === selected);
  }
}

function restoreLocalDisclosures() {
  for (const details of root.querySelectorAll("[data-feedback-window-content] details")) {
    if (details.id === "preview-advanced-settings" || details.classList.contains("preview-response-settings")) details.open = true;
    else if (details.closest("#feedback-input-settings")) details.open =
      (root.dataset.settingsInput === "bindings" && details.matches("#feedback-input-settings > details:nth-of-type(1)"))
      || (root.dataset.settingsInput === "test" && details.matches("#feedback-input-settings > details:nth-of-type(2)"));
    else if (details.closest("#preview-advanced-settings")) {
      details.open = details.matches("[data-settings-mapping-visible]")
        || (root.dataset.settingsDetail === "outline" && details.matches("#preview-advanced-settings > .disclosure-content > details:nth-of-type(1)"))
        || (root.dataset.settingsDetail === "grid" && details.matches("#preview-advanced-settings > .disclosure-content > details:nth-of-type(2)"))
        || (root.dataset.settingsDetail === "palette" && details.matches("#preview-advanced-settings > .disclosure-content > details:nth-of-type(3)"));
    }
  }
}

function showTab(tab, focus = false) {
  root.dataset.settingsTab = tab;
  for (const button of root.querySelectorAll("[data-settings-tab]")) {
    const selected = button.dataset.settingsTab === tab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  root.querySelector(".flubber-settings-detail-nav").hidden = !["advanced", "input"].includes(tab);
  root.querySelector("#preview-settings-panel").setAttribute("aria-labelledby", `settings-tab-${tab}`);
  for (const selector of ['label[for="preview-input-section"]', '#preview-input-section']) root.querySelector(selector).hidden = tab !== "input";
  for (const selector of ['label[for="preview-detail-section"]', '#preview-detail-section']) root.querySelector(selector).hidden = tab !== "advanced";
  root.querySelector("#preview-detail-mapping").hidden = tab !== "advanced" || root.dataset.settingsDetail !== "motion";
  restoreLocalDisclosures();
  if (currentState) preview?.update(currentState);
  textFitter.refresh();
}

function applyControls(snapshot = {}) {
  const elements = controls();
  for (let index = 0; index < Math.min(elements.length, snapshot.controls?.length ?? 0); index += 1) {
    const element = elements[index];
    const state = snapshot.controls[index];
    if ("value" in state && "value" in element && element.value !== state.value) element.value = state.value;
    if ("checked" in state && "checked" in element) element.checked = state.checked;
    if ("disabled" in state && "disabled" in element) element.disabled = state.disabled;
    if ("hidden" in state) element.hidden = state.hidden;
    for (const [name, value] of Object.entries(state.attributes ?? {})) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
    if (typeof state.text === "string" && element instanceof HTMLOutputElement) element.textContent = state.text;
    if (element instanceof HTMLDetailsElement) element.open = Boolean(state.open);
    if (element instanceof HTMLDialogElement) {
      if (state.open && !element.open) element.showModal();
      else if (!state.open && element.open) element.close();
    }
  }
  const color = root.querySelector("#preview-color-hex");
  if (color instanceof HTMLInputElement) colorPicker?.setColor(color.value);
  const mirrors = [...(root.querySelector("[data-feedback-window-content]")?.querySelectorAll([
    "[data-response-preview-panel]", "[data-preview-grid-square]", "[data-preview-grid-custom]",
    "[data-preview-repeat-settings]", "[data-color-anchor-label]", "[data-color-anchor-swatch]",
    "[data-preview-mode-label]",
    "[data-preview-tile-status]", "[data-preview-input-availability]", "#feedback-settings-version",
  ].join(",")) ?? [])];
  for (let index = 0; index < Math.min(mirrors.length, snapshot.mirrors?.length ?? 0); index += 1) {
    const element = mirrors[index];
    const state = snapshot.mirrors[index];
    element.hidden = state.hidden;
    element.textContent = state.text;
    for (const [name, value] of Object.entries(state.attributes ?? {})) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  }
}

function receiveData(data) {
  if (data?.schema !== MESSAGE_SCHEMA) return;
  if (data.type === "host-ready") post("ready");
  if (data.type === "focus") window.focus();
  if (data.type === "trial-state") {
    const dialog = root.querySelector("#preview-trial-dialog");
    const stage = root.querySelector("#preview-trial-stage");
    const message = root.querySelector("#preview-trial-message");
    const trial = data.trial;
    if (!(dialog instanceof HTMLDialogElement) || !(stage instanceof HTMLElement) || !(message instanceof HTMLElement)) return;
    if (trial?.error || !trial?.geometry || !trial?.video?.bounds) {
      stage.hidden = true;
      message.textContent = trial?.error ?? "Trial layout is unavailable.";
    } else {
      const { screen, feedback } = trial.geometry;
      const video = stage.querySelector("[data-preview-trial-video]");
      const bounds = trial.video.bounds;
      stage.style.aspectRatio = `${screen.width} / ${screen.height}`;
      stage.style.setProperty("--trial-screen-ratio", String(screen.width / screen.height));
      video.style.left = `${bounds.x / screen.width * 100}%`;
      video.style.top = `${bounds.y / screen.height * 100}%`;
      video.style.width = `${bounds.width / screen.width * 100}%`;
      video.style.height = `${bounds.height / screen.height * 100}%`;
      stage.hidden = false;
      trialPreview ??= createResearchPreview(stage, { initialState: { lockPosition: true } });
      trialPreview.update({ ...trial.state, lockPosition: true,
        position: { x: feedback.cx / screen.width, y: feedback.cy / screen.height },
        sizePercent: feedback.width / screen.width * 100 });
      stage.setAttribute("aria-label", `Trial layout for ${trial.video.label}. Video frame and feedback are positioned as authored.`);
      message.textContent = `${trial.video.label} · screen ${screen.width} × ${screen.height} · layout only`;
    }
    if (!dialog.open) dialog.showModal();
    return;
  }
  if (data.type !== "state") return;
  ensureContent(data.markup);
  currentState = { ...data.state, lockPosition: data.state?.lockPosition ?? true };
  if (simulator) {
    syncingPoint = true;
    simulator.configure({
      mode: currentState.responseMode,
      tileCount: currentState.tileCount,
      tileRows: currentState.tileRows,
      fullSpanDurationMs: currentState.fullSpanDurationMs,
      holdRule: currentState.holdRule,
      repeatDelayMs: currentState.repeatDelayMs,
    });
    simulator.setPoint(currentState);
    syncingPoint = false;
  }
  preview?.update(currentState);
  applyControls(data.controls);
  restoreLocalDisclosures();
  const confirmation = data.confirmation ?? {};
  if (status) {
    status.textContent = confirmation.error ?? (confirmation.busy ? "Confirming settings…"
      : confirmation.confirmed ? "Settings confirmed in draft." : "Changes need confirmation.");
    status.dataset.state = confirmation.error ? "error" : confirmation.confirmed ? "ready" : "warning";
  }
  if (confirmButton instanceof HTMLButtonElement) {
    confirmButton.disabled = confirmation.busy || confirmation.confirmed;
    confirmButton.textContent = confirmation.busy ? "Confirming…" : confirmation.confirmed ? "Confirmed" : "Confirm settings";
  }
}

function receive(event) {
  if (channel || event.source !== window.opener) return;
  receiveData(event.data);
}

function editFor(target, type, event) {
  if (!(target instanceof Element)) return null;
  const element = target.closest(CONTROL_SELECTOR);
  if (!element || !contentControls.includes(element)) return null;
  const index = controls().indexOf(element);
  if (index < 0) return null;
  return {
    index,
    type,
    value: "value" in element ? element.value : undefined,
    checked: "checked" in element ? element.checked : undefined,
    key: event instanceof KeyboardEvent ? event.key : undefined,
    code: event instanceof KeyboardEvent ? event.code : undefined,
  };
}

channel?.addEventListener("message", (event) => receiveData(event.data));
window.addEventListener("message", receive);
root.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("#preview-window-minimize,#preview-window-confirm,#preview-flubber-show,#preview-trial-open,#preview-trial-close")) return;
  const edit = editFor(event.target, "click", event);
  if (edit) { event.preventDefault(); post("edit", { edit }); }
});
root.querySelector(".flubber-settings-tabs")?.addEventListener("click", (event) => {
  const tab = event.target instanceof Element ? event.target.closest("[data-settings-tab]") : null;
  if (tab) showTab(tab.dataset.settingsTab);
});
root.querySelector(".flubber-settings-tabs")?.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...root.querySelectorAll("[data-settings-tab]")];
  const current = tabs.findIndex(tab => tab.dataset.settingsTab === root.dataset.settingsTab);
  const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  showTab(tabs[index].dataset.settingsTab, true);
});
root.querySelector("#preview-detail-section")?.addEventListener("change", (event) => {
  root.dataset.settingsDetail = event.target.value;
  root.querySelector("#preview-detail-mapping").hidden = event.target.value !== "motion";
  restoreLocalDisclosures();
});
root.querySelector("#preview-input-section")?.addEventListener("change", (event) => {
  root.dataset.settingsInput = event.target.value;
  restoreLocalDisclosures();
});
root.querySelector("#preview-detail-mapping")?.addEventListener("change", () => {
  showMapping();
  restoreLocalDisclosures();
});
for (const type of ["input", "change", "focusout"]) {
  root.addEventListener(type, (event) => {
    const edit = editFor(event.target, type, event);
    if (edit) post("edit", { edit });
  });
}
root.addEventListener("keydown", (event) => {
  const edit = editFor(event.target, "keydown", event);
  if (edit) post("edit", { edit });
});
confirmButton?.addEventListener("click", () => post("confirm"));
root.querySelector("#preview-flubber-show")?.addEventListener("click", () => post("show-flubber"));
root.querySelector("#preview-trial-open")?.addEventListener("click", () => post("trial"));
root.querySelector("#preview-trial-close")?.addEventListener("click", () => root.querySelector("#preview-trial-dialog")?.close());
root.querySelector("#preview-trial-dialog")?.addEventListener("close", () => { trialPreview?.destroy(); trialPreview = null; });
root.querySelector("#preview-window-minimize")?.addEventListener("click", async () => {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
});
root.querySelector(".flubber-settings-header")?.addEventListener("pointerdown", async event => {
  if (!nativeWindow || event.button !== 0 || !(event.target instanceof Element) || event.target.closest("button")) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
});
window.addEventListener("beforeunload", () => {
  preview?.destroy();
  simulator?.destroy();
  trialPreview?.destroy();
  colorPicker?.destroy();
  textFitter.destroy();
  post("closed");
  channel?.close();
}, { once: true });
post("ready");

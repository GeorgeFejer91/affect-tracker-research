import { createResearchPreview } from "./preview.js";
import { previewOverlayMarkup } from "./feedback-surface.js";
import { createInlineColorPicker } from "./inline-color-picker.js";

const MESSAGE_SCHEMA = "affect-research-planner-preview-v1";
const CHANNEL_NAME = "affect-research-planner-preview";

const CONTROL_SELECTOR = "input,select,textarea,button,details,summary,output:not([data-preview-x]):not([data-preview-y]):not([data-preview-position]),dialog";
const root = document.querySelector("#preview-window-app");
if (!(root instanceof HTMLElement)) throw new Error("Preview window root is missing.");

root.innerHTML = `<main class="planner-preview-window-shell">
  <header><div><h1>Flubber Settings</h1><p>These controls edit the Experiment Planner's current draft.</p></div><button id="preview-window-close" type="button">Close</button></header>
  <div class="planner-preview-window-content"><div class="planner-preview-window-stage research-preview-stage" aria-hidden="true">${previewOverlayMarkup({ includeFace: true })}</div><p class="empty-state">Connecting to the Experiment Planner…</p></div>
  <footer>
    <p id="preview-window-status" role="status" aria-live="polite">Waiting for the Experiment Planner…</p>
    <button id="preview-window-confirm" type="button" disabled>Confirm Flubber settings</button>
  </footer>
</main>`;

let preview = null;
let colorPicker = null;
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
  return [...(root.querySelector("[data-feedback-window-content]")?.querySelectorAll(CONTROL_SELECTOR) ?? [])];
}

function ensureContent(markup) {
  if (preview || typeof markup !== "string") return;
  const content = root.querySelector(".planner-preview-window-content");
  content.innerHTML = markup;
  preview = createResearchPreview(content.querySelector(".preview-pane"), {
    initialState: { lockPosition: true },
    onPositionChange(position) { post("position", { position }); },
  });
  colorPicker = createInlineColorPicker(content.querySelector("#preview-color-picker"), {
    onChange(hex) {
      const input = content.querySelector("#preview-color-hex");
      if (!(input instanceof HTMLInputElement)) return;
      input.value = hex;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });
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
  if (data.type !== "state") return;
  ensureContent(data.markup);
  preview?.update({ ...data.state, lockPosition: data.state?.lockPosition ?? true });
  applyControls(data.controls);
  const confirmation = data.confirmation ?? {};
  if (status) {
    status.textContent = confirmation.error ?? (confirmation.busy ? "Confirming Flubber settings…"
      : confirmation.confirmed ? "Flubber settings confirmed for the current draft." : "Flubber settings are not confirmed.");
    status.dataset.state = confirmation.error ? "error" : confirmation.confirmed ? "ready" : "warning";
  }
  if (confirmButton instanceof HTMLButtonElement) {
    confirmButton.disabled = confirmation.busy || confirmation.confirmed;
    confirmButton.textContent = confirmation.busy ? "Confirming…" : confirmation.confirmed ? "Confirmed" : "Confirm Flubber settings";
  }
}

function receive(event) {
  if (channel || event.source !== window.opener) return;
  receiveData(event.data);
}

function editFor(target, type, event) {
  if (!(target instanceof Element)) return null;
  const element = target.closest(CONTROL_SELECTOR);
  if (!element || !root.querySelector("[data-feedback-window-content]")?.contains(element)) return null;
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
  if (event.target instanceof Element && event.target.closest("#preview-window-close,#preview-window-confirm")) return;
  const edit = editFor(event.target, "click", event);
  if (edit) { event.preventDefault(); post("edit", { edit }); }
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
root.querySelector("#preview-window-close")?.addEventListener("click", () => window.close());
window.addEventListener("beforeunload", () => {
  preview?.destroy();
  colorPicker?.destroy();
  post("closed");
  channel?.close();
}, { once: true });
post("ready");

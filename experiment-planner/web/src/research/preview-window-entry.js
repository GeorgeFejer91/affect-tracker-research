import { previewOverlayMarkup } from "./feedback-surface.js";
import { createResearchPreview } from "./preview.js";
import { PLANNER_PREVIEW_WINDOW_MESSAGE_SCHEMA as MESSAGE_SCHEMA } from "./planner-preview-window.js";

const root = document.querySelector("#preview-window-app");
if (!(root instanceof HTMLElement)) throw new Error("Preview window root is missing.");

root.innerHTML = `<main class="planner-preview-window-shell">
  <header><h1>Flubber Preview</h1><p>Inspect the current feedback rendering, then confirm this exact planner revision.</p></header>
  <div class="planner-preview-window-stage research-preview-stage research-preview-studio" data-preview-variant="studio" role="img" aria-label="Current Flubber preview">
    ${previewOverlayMarkup({ includeFace: true })}
  </div>
  <footer>
    <p id="preview-window-status" role="status" aria-live="polite">Waiting for the Experiment Planner…</p>
    <div class="button-row"><button id="preview-window-confirm" type="button" disabled>Confirm preview</button><button id="preview-window-close" type="button">Close</button></div>
  </footer>
</main>`;

const preview = createResearchPreview(root.querySelector(".planner-preview-window-stage"), {
  initialState: { lockPosition: true },
});
const status = root.querySelector("#preview-window-status");
const confirmButton = root.querySelector("#preview-window-confirm");
const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;

function post(type) {
  window.opener?.postMessage({ schema: MESSAGE_SCHEMA, type }, targetOrigin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window.opener || event.data?.schema !== MESSAGE_SCHEMA || event.data.type !== "state") return;
  preview.update({ ...event.data.state, lockPosition: true });
  const confirmation = event.data.confirmation ?? {};
  if (status) {
    status.textContent = confirmation.error ?? (confirmation.busy ? "Confirming preview…"
      : confirmation.confirmed ? "Preview confirmed for the current settings." : "Preview not confirmed.");
    status.dataset.state = confirmation.error ? "error" : confirmation.confirmed ? "ready" : "warning";
  }
  if (confirmButton instanceof HTMLButtonElement) {
    confirmButton.disabled = confirmation.busy || confirmation.confirmed;
    confirmButton.textContent = confirmation.busy ? "Confirming…" : confirmation.confirmed ? "Confirmed" : "Confirm preview";
  }
});

confirmButton?.addEventListener("click", () => post("confirm"));
root.querySelector("#preview-window-close")?.addEventListener("click", () => window.close());
window.addEventListener("beforeunload", () => { preview.destroy(); post("closed"); }, { once: true });
post("ready");

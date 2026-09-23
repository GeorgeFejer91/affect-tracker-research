import { previewOverlayMarkup } from "./feedback-surface.js";
import { createResearchPreview } from "./preview.js";
import { PLANNER_FLUBBER_CHANNEL, PLANNER_FLUBBER_SCHEMA } from "./planner-flubber-window.js";

const root = document.querySelector("#flubber-window-app");
if (!(root instanceof HTMLElement)) throw new Error("Flubber preview root is missing.");
root.innerHTML = `<div class="research-preview-stage flubber-only-stage" data-preview-variant="studio" role="img" aria-label="Draggable Flubber preview" tabindex="0">${previewOverlayMarkup({ includeFace: true })}</div>`;
const stage = root.firstElementChild;
const preview = createResearchPreview(stage, {
  initialState: { displayMode: "flubber", sizePercent: 100, lockPosition: true },
});
const native = Boolean(window.__TAURI_INTERNALS__);
if (native) {
  void Promise.all([
    import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"),
  ]).then(([{ getCurrentWindow }, { LogicalPosition }]) => {
  const nativeWindow = getCurrentWindow();
  stage.addEventListener("pointerdown", event => {
    if (event.button === 0) void nativeWindow.startDragging();
  });
  stage.addEventListener("keydown", async event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const position = await nativeWindow.outerPosition();
    const scale = await nativeWindow.scaleFactor();
    const step = event.shiftKey ? 40 : 10;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    await nativeWindow.setPosition(new LogicalPosition(position.x / scale + dx, position.y / scale + dy));
  });
  });
} else {
  let dragging = null;
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    dragging = { id: event.pointerId, x: event.screenX, y: event.screenY };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", event => {
    if (dragging?.id !== event.pointerId) return;
    window.moveBy(event.screenX - dragging.x, event.screenY - dragging.y);
    dragging.x = event.screenX;
    dragging.y = event.screenY;
  });
  for (const type of ["pointerup", "pointercancel"]) stage.addEventListener(type, () => { dragging = null; });
}
const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
const channel = typeof window.BroadcastChannel === "function" ? new window.BroadcastChannel(PLANNER_FLUBBER_CHANNEL) : null;
function post(type) {
  const message = { schema: PLANNER_FLUBBER_SCHEMA, type };
  if (channel) channel.postMessage(message);
  else window.opener?.postMessage(message, targetOrigin);
}
function receiveData(data) {
  if (data?.schema !== PLANNER_FLUBBER_SCHEMA) return;
  if (data.type === "host-ready") post("ready");
  if (data.type === "state" && data.state) {
    preview.update({ ...data.state, displayMode: "flubber", flubberVisible: true,
      hideFeedback: false, lockPosition: true, position: { x: 0.5, y: 0.5 }, sizePercent: 100 });
    stage.setAttribute("aria-label", "Flubber preview. Drag with the pointer or move with arrow keys.");
  }
}
channel?.addEventListener("message", event => receiveData(event.data));
window.addEventListener("message", event => {
  if (!channel && event.source === window.opener) receiveData(event.data);
});
window.addEventListener("beforeunload", () => { preview.destroy(); post("closed"); channel?.close(); }, { once: true });
post("ready");

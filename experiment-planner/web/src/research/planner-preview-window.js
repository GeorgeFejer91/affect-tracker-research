const MESSAGE_SCHEMA = "affect-research-planner-preview-v1";

export function createPlannerPreviewWindow({ windowObject, url, features = "", readState, readConfirmation, confirm }) {
  if (!windowObject || typeof windowObject.open !== "function") throw new TypeError("Preview window host is unavailable.");
  let popup = null;
  let ready = false;

  const targetOrigin = windowObject.location.origin === "null" ? "*" : windowObject.location.origin;
  function post(type, detail = {}) {
    if (!popup || popup.closed || !ready) return;
    popup.postMessage({ schema: MESSAGE_SCHEMA, type, ...detail }, targetOrigin);
  }
  function update() {
    post("state", { state: readState(), confirmation: readConfirmation() });
  }
  async function receive(event) {
    if (event.source !== popup || event.data?.schema !== MESSAGE_SCHEMA) return;
    if (event.data.type === "ready") {
      ready = true;
      update();
    } else if (event.data.type === "confirm") {
      await confirm();
      update();
    } else if (event.data.type === "closed") {
      popup = null;
      ready = false;
    }
  }
  windowObject.addEventListener("message", receive);

  return Object.freeze({
    open() {
      if (popup && !popup.closed) {
        popup.focus();
        update();
        return true;
      }
      popup = features
        ? windowObject.open(url, "affect-planner-preview", features)
        : windowObject.open(url, "affect-planner-preview");
      ready = false;
      if (!popup) throw new Error("The preview window was blocked. Allow popups for this Planner and try again.");
      popup.focus();
      return true;
    },
    update,
    get isOpen() { return Boolean(popup && !popup.closed); },
    destroy() {
      windowObject.removeEventListener("message", receive);
      if (popup && !popup.closed) popup.close();
      popup = null;
      ready = false;
    },
  });
}

export { MESSAGE_SCHEMA as PLANNER_PREVIEW_WINDOW_MESSAGE_SCHEMA };

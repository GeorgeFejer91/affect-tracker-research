const MESSAGE_SCHEMA = "affect-research-planner-preview-v1";
const CHANNEL_NAME = "affect-research-planner-preview";

export function createPlannerPreviewWindow({
  windowObject,
  url,
  features = "",
  readMarkup,
  readState,
  readControls,
  readConfirmation,
  applyEdit,
  applyPosition,
  confirm,
  showFlubber = () => {},
  readTrial = () => null,
  onConnectionChange = () => {},
}) {
  if (!windowObject || typeof windowObject.open !== "function") throw new TypeError("Preview window host is unavailable.");
  let popup = null;
  let ready = false;
  let markupSent = false;
  let controlsKey = null;

  const targetOrigin = windowObject.location.origin === "null" ? "*" : windowObject.location.origin;
  const channel = typeof windowObject.BroadcastChannel === "function"
    ? new windowObject.BroadcastChannel(CHANNEL_NAME) : null;
  function send(message) {
    if (channel) channel.postMessage(message);
    else if (popup && !popup.closed) popup.postMessage(message, targetOrigin);
  }
  function post(type, detail = {}) {
    if (!ready) return;
    send({ schema: MESSAGE_SCHEMA, type, ...detail });
  }
  function update() {
    if (!ready) return;
    const detail = { state: readState(), confirmation: readConfirmation() };
    if (!markupSent && typeof readMarkup === "function") {
      detail.markup = readMarkup();
      markupSent = true;
    }
    if (typeof readControls === "function") {
      const controls = readControls();
      const nextControlsKey = JSON.stringify(controls);
      if (nextControlsKey !== controlsKey) {
        detail.controls = controls;
        controlsKey = nextControlsKey;
      }
    }
    post("state", detail);
  }
  async function receiveData(data) {
    if (data?.schema !== MESSAGE_SCHEMA) return;
    if (data.type === "ready") {
      ready = true;
      markupSent = false;
      controlsKey = null;
      onConnectionChange(true);
      update();
    } else if (data.type === "confirm") {
      await confirm();
      update();
    } else if (data.type === "edit" && typeof applyEdit === "function") {
      await applyEdit(data.edit);
      update();
    } else if (data.type === "position" && typeof applyPosition === "function") {
      applyPosition(data.position);
      update();
    } else if (data.type === "show-flubber") {
      await showFlubber();
    } else if (data.type === "trial") {
      post("trial-state", { trial: readTrial() });
    } else if (data.type === "closed") {
      popup = null;
      ready = false;
      markupSent = false;
      controlsKey = null;
      onConnectionChange(false);
    }
  }
  async function receive(event) {
    if (event.source !== popup) return;
    await receiveData(event.data);
  }
  const receiveChannel = event => receiveData(event.data);
  windowObject.addEventListener("message", receive);
  channel?.addEventListener("message", receiveChannel);
  if (channel) send({ schema: MESSAGE_SCHEMA, type: "host-ready" });

  return Object.freeze({
    open() {
      if (ready) {
        post("focus");
        return true;
      }
      if (popup && !popup.closed) {
        popup.focus();
        return true;
      }
      popup = features
        ? windowObject.open(url, "affect-planner-preview", features)
        : windowObject.open(url, "affect-planner-preview");
      if (!popup) throw new Error("The Flubber settings window was blocked. Allow popups for this Planner and try again.");
      popup.focus();
      return true;
    },
    update,
    get isOpen() { return ready || Boolean(popup && !popup.closed); },
    destroy() {
      windowObject.removeEventListener("message", receive);
      channel?.removeEventListener("message", receiveChannel);
      channel?.close();
      if (popup && !popup.closed) popup.close();
      popup = null;
      ready = false;
    },
  });
}

export { CHANNEL_NAME as PLANNER_PREVIEW_WINDOW_CHANNEL, MESSAGE_SCHEMA as PLANNER_PREVIEW_WINDOW_MESSAGE_SCHEMA };

export const PLANNER_FLUBBER_CHANNEL = "affect-research-planner-flubber";
export const PLANNER_FLUBBER_SCHEMA = "affect-research-planner-flubber-v1";

export function createPlannerFlubberWindow({ windowObject, url, readState, showNative = null }) {
  if (!windowObject || typeof readState !== "function") throw new TypeError("Flubber preview host is unavailable.");
  let popup = null;
  let ready = false;
  const channel = typeof windowObject.BroadcastChannel === "function"
    ? new windowObject.BroadcastChannel(PLANNER_FLUBBER_CHANNEL) : null;
  const targetOrigin = windowObject.location.origin === "null" ? "*" : windowObject.location.origin;
  function send(type, detail = {}) {
    const message = { schema: PLANNER_FLUBBER_SCHEMA, type, ...detail };
    if (channel) channel.postMessage(message);
    else if (popup && !popup.closed) popup.postMessage(message, targetOrigin);
  }
  function receiveData(data) {
    if (data?.schema !== PLANNER_FLUBBER_SCHEMA) return;
    if (data.type === "ready") {
      ready = true;
      update();
    } else if (data.type === "closed") {
      ready = false;
      popup = null;
    }
  }
  function receive(event) {
    if (event.source === popup) receiveData(event.data);
  }
  const receiveChannel = event => receiveData(event.data);
  function update() {
    if (ready) send("state", { state: readState() });
  }
  windowObject.addEventListener("message", receive);
  channel?.addEventListener("message", receiveChannel);
  send("host-ready");
  return Object.freeze({
    async open() {
      if (showNative) return showNative();
      if (popup && !popup.closed) { popup.focus(); return; }
      popup = windowObject.open(url, "affect-planner-flubber", "popup,width=280,height=280");
      if (!popup) throw new Error("The Flubber preview window was blocked. Allow popups for this Planner and try again.");
      popup.focus();
    },
    update,
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

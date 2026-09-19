import { Channel, invoke } from "@tauri-apps/api/core";
import { bootRunner } from "./app.js";

const root = document.querySelector("#experiment-runner");
const abortListeners = new Set();
let fullscreenGeneration = 0;
const invokeRunner = (command, args) => {
  if (command === "research_runner_fullscreen" && args.fullscreen) {
    const generation = ++fullscreenGeneration;
    const onAbort = new Channel(() => {
      if (generation === fullscreenGeneration) for (const listener of abortListeners) listener();
    });
    return invoke(command, { ...args, onAbort });
  }
  return invoke(command, command === "research_runner_fullscreen" ? { ...args, onAbort: new Channel() } : args).then(result => {
    if (command === "research_runner_fullscreen" && !args.fullscreen) fullscreenGeneration += 1;
    return result;
  });
};
bootRunner(root, { invoke: invokeRunner, subscribeAbort: listener => {
  abortListeners.add(listener);
  return () => abortListeners.delete(listener);
} }).catch((error) => {
  root.setAttribute("aria-busy", "false");
  root.querySelectorAll("button, input, select").forEach(element => { element.disabled = true; });
  const output = root.querySelector("#runner-error");
  if (output) { output.hidden = false; output.textContent = error?.message ?? String(error); }
});

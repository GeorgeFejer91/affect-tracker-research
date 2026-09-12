import { invoke } from "@tauri-apps/api/core";
import { bootRunner } from "./app.js";

const root = document.querySelector("#experiment-runner");
bootRunner(root, { invoke }).catch((error) => {
  root.setAttribute("aria-busy", "false");
  root.querySelectorAll("button, input, select").forEach(element => { element.disabled = true; });
  const output = root.querySelector("#runner-error");
  if (output) { output.hidden = false; output.textContent = error?.message ?? String(error); }
});

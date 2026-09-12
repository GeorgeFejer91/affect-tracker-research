import { invoke } from "@tauri-apps/api/core";
import { bootRunner } from "./app.js";

const root = document.querySelector("#experiment-runner");
bootRunner(root, { invoke }).catch((error) => {
  root.setAttribute("aria-busy", "false");
  const output = root.querySelector("#runner-error");
  if (output) { output.hidden = false; output.textContent = error?.message ?? String(error); }
});

import { bootRunner } from "./app.js";
import { createBrowserRunnerInvoke } from "./browser-adapter.js";

const root = document.querySelector("#experiment-runner");

bootRunner(root, {
  invoke: createBrowserRunnerInvoke({ windowObject: window }),
  windowObject: window,
}).catch((error) => {
  root.setAttribute("aria-busy", "false");
  root.querySelectorAll("button, input, select").forEach(element => { element.disabled = true; });
  const output = root.querySelector("#runner-error");
  if (output) {
    output.hidden = false;
    output.textContent = error?.message ?? String(error);
  } else {
    root.innerHTML = `<main><h1>Experiment Runner</h1><p role="alert"></p></main>`;
    root.querySelector("p").textContent = error?.message ?? String(error);
  }
});

import { bootResearchUi } from "./app.js";

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function showBootstrapFailure(error) {
  const root = document.querySelector("#research-app");
  if (!root) return;
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `
    <main class="research-loading" role="alert">
      <h1>Affect Research</h1>
      <p>The experiment instrument could not start.</p>
      <pre class="bootstrap-error"></pre>
    </main>`;
  const output = root.querySelector(".bootstrap-error");
  if (output) output.textContent = messageOf(error);
}

/**
 * The sole frontend bootstrap sequence. Platform entry modules provide one
 * typed runtime initializer; they do not race independent DOM side effects.
 */
export function bootstrapResearchSurface({ surface, initializeRuntime, onFailure = () => {} }) {
  if (surface !== "browser" && surface !== "tauri") {
    throw new TypeError("Research surface must be browser or tauri.");
  }
  if (typeof initializeRuntime !== "function") {
    throw new TypeError("Research runtime initializer is required.");
  }
  const start = async () => {
    const root = bootResearchUi({ surface });
    if (!root) return;
    await initializeRuntime(root);
  };
  const startSafely = () => void start().catch(error => { showBootstrapFailure(error); onFailure(error); });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startSafely, { once: true });
  } else {
    startSafely();
  }
}

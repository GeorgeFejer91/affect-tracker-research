import { getCurrentWindow } from "@tauri-apps/api/window";
import { bootNativeBridge } from "./native-bridge.js";
import { bootstrapResearchSurface } from "./ui-bootstrap.js";
import { reportPlannerAuthoringStartupFailure } from "./planner-authoring-native.js";

bootstrapResearchSurface({
  surface: "tauri",
  initializeRuntime: bootNativeBridge,
  onFailure: reportPlannerAuthoringStartupFailure,
});

function wireNativeWindowControls() {
  const currentWindow = getCurrentWindow();
  document.querySelector("[data-native-window-minimize]")?.addEventListener("click", () => void currentWindow.minimize());
  document.querySelector("[data-native-window-close]")?.addEventListener("click", () => void currentWindow.close());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireNativeWindowControls, { once: true });
} else {
  wireNativeWindowControls();
}

import { getCurrentWindow } from "@tauri-apps/api/window";
import { bootNativeBridge, showNativeFlubberPreview, showNativeFlubberSettings } from "./native-bridge.js";
import { bootstrapResearchSurface } from "./ui-bootstrap.js";
import { reportPlannerAuthoringStartupFailure } from "./planner-authoring-native.js";

bootstrapResearchSurface({
  surface: "tauri",
  initializeRuntime: bootNativeBridge,
  onFailure: reportPlannerAuthoringStartupFailure,
  showFlubber: showNativeFlubberPreview,
  showPreview: showNativeFlubberSettings,
});

function wireNativeWindowControls() {
  const currentWindow = getCurrentWindow();
  document.querySelector("[data-native-window-minimize]")?.addEventListener("click", () => void currentWindow.minimize());
  document.querySelector("[data-native-window-maximize]")?.addEventListener("click", () => void currentWindow.toggleMaximize());
  document.querySelector("[data-native-window-close]")?.addEventListener("click", () => void currentWindow.close());
  document.querySelector(".app-bar[data-tauri-drag-region]")?.addEventListener("dblclick", (event) => {
    if (event.button === 0 && event.target instanceof Element && !event.target.closest("button, input, select, textarea, a")) {
      void currentWindow.toggleMaximize();
    }
  });
  document.querySelectorAll("[data-native-window-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button === 0 && event.isPrimary) void currentWindow.startResizeDragging(handle.dataset.nativeWindowResize);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireNativeWindowControls, { once: true });
} else {
  wireNativeWindowControls();
}

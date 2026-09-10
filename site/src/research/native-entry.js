import { bootNativeBridge } from "./native-bridge.js";
import { bootstrapResearchSurface } from "./ui-bootstrap.js";

bootstrapResearchSurface({
  surface: "tauri",
  initializeRuntime: bootNativeBridge,
});

import { bootRuntimeBridge } from "./runtime-bridge.js";
import { bootstrapResearchSurface } from "./ui-bootstrap.js";

bootstrapResearchSurface({
  surface: "browser",
  initializeRuntime: bootRuntimeBridge,
});

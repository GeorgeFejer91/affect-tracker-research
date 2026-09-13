import { bootNativeBridge } from "./native-bridge.js";
import { bootstrapResearchSurface } from "./ui-bootstrap.js";
import { reportPlannerAuthoringStartupFailure } from "./planner-authoring-native.js";

bootstrapResearchSurface({
  surface: "tauri",
  initializeRuntime: bootNativeBridge,
  onFailure: reportPlannerAuthoringStartupFailure,
});

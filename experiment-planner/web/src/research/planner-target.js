export const PLANNER_TARGETS = Object.freeze([
  Object.freeze({ id: "desktop-screen", label: "Desktop screen" }),
  Object.freeze({ id: "webxr-immersive-vr", label: "WebXR VR (planned Runner)" }),
]);

/** Session authoring choice; no host/profile inference or runtime capability. */
export function parsePlannerTargetSelection(value) {
  if (value === "") return null;
  if (!PLANNER_TARGETS.some((target) => target.id === value)) throw new TypeError("Choose a supported presentation target in Review.");
  return value;
}

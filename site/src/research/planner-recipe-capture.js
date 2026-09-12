import { canonicalJson } from "./canonical.js";
import { PlannerRecipeIssue } from "./planner-recipe-questionnaires.js";
import { PLANNER_RECIPE_SCHEMA, PLANNER_RECIPE_VERSION, PLANNER_RECIPE_SEGMENTS, validatePlannerRecipeStructureV1, freezeRecipeValue } from "./planner-recipe-wire.js";

/** Session receipt -> detached authored payloads. Domain validation still occurs
 * in the compiler. Session revisions and explicit acceptance never become file
 * permissions or persisted readiness. P5 must be accepted by final capture. */
export function capturePlannerRecipeInputV1(registry, { recipeId, presentationTarget, policy, isCurrent }) {
  if (typeof isCurrent !== "function" || typeof registry.getAcceptanceGeneration !== "function") {
    throw new TypeError("Recipe capture requires a caller edit/operation/disposal guard and an acceptance generation.");
  }
  if (isCurrent() !== true) throw new TypeError("The recipe capture operation is no longer current.");
  const review = registry.assertAccepted();
  const generation = registry.getAcceptanceGeneration();
  const segments = {};
  for (const segment of PLANNER_RECIPE_SEGMENTS) {
    const entry = review.entries.find(item => item.segment === segment);
    if (segment === "P6" && entry?.status === "excluded") {
      segments.P6 = { status: "excluded" };
      continue;
    }
    const snapshot = review.snapshots.find(item => item.segment === segment);
    if (entry?.status !== "accepted" || !snapshot?.enabled || snapshot.pending || !snapshot.contribution) {
      throw new PlannerRecipeIssue(segment, `segments.${segment}`, "acceptance-required", "Confirm this section's complete current content before saving.");
    }
    segments[segment] = segment === "P6" ? { status: "included", profile: structuredClone(snapshot.contribution) }
      : structuredClone(snapshot.contribution);
  }
  const core = validatePlannerRecipeStructureV1({ schema: PLANNER_RECIPE_SCHEMA, version: PLANNER_RECIPE_VERSION,
    recipeId, presentationTarget, policy: structuredClone(policy), segments }, { integrity: false });
  // Canonical cloning rejects non-JSON values before a delayed compiler can see
  // caller mutation. The guard binds acceptance and the caller's edit lifetime.
  const input = freezeRecipeValue(JSON.parse(canonicalJson(core)));
  let stale = false;
  const current = () => {
    if (stale) return false;
    try {
      stale = isCurrent() !== true || registry.getAcceptanceGeneration() !== generation
        || registry.assertAccepted().fingerprint !== review.fingerprint
        || registry.getAcceptanceGeneration() !== generation;
    } catch { stale = true; }
    return !stale;
  };
  if (!current()) throw new TypeError("The design changed during recipe capture.");
  return Object.freeze({ input, isCurrent: current });
}

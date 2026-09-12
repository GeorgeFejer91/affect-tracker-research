import { canonicalJson } from "./canonical.js";
import { PlannerRecipeIssue } from "./planner-recipe-questionnaires.js";
import { PLANNER_RECIPE_SCHEMA, PLANNER_RECIPE_VERSION, PLANNER_RECIPE_SEGMENTS,
  validatePlannerRecipeStructureV1, validatePlannerRecipeStructureV2, freezeRecipeValue } from "./planner-recipe-wire.js";

/** Session receipt -> detached authored payloads. Domain validation still occurs
 * in the compiler. Session revisions and explicit acceptance never become file
 * permissions or persisted readiness. P5 must be accepted by final capture. */
export function capturePlannerRecipeInputV1(registry, options) {
  return capturePlannerRecipeInputVersion(registry, { ...options, version: PLANNER_RECIPE_VERSION });
}

/** Explicit version from the accepted owner's contract, never ambient state. */
export function capturePlannerRecipeInputVersion(registry, { version, recipeId, presentationTarget, policy, isCurrent }) {
  if (![1, 2].includes(version)) throw new TypeError("Capture requires an explicit supported Planner recipe version.");
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
  const validate = version === 2 ? validatePlannerRecipeStructureV2 : validatePlannerRecipeStructureV1;
  const core = validate({ schema: PLANNER_RECIPE_SCHEMA, version,
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

/** Final Save prepares P5 through the real registry without publishing its
 * acceptance before the file write. Other owners must already be accepted.
 * This is an explicit prepared-feedback path, never a fake accepted registry. */
export function capturePlannerRecipeInputPreparedFeedback(registry, {
  recipeId, presentationTarget, policy, preparedFeedback, isCurrent,
}) {
  if (typeof isCurrent !== "function" || typeof preparedFeedback?.isCurrent !== "function"
    || typeof registry.getAcceptanceGeneration !== "function") {
    throw new TypeError("Final capture requires the real prepared feedback and operation guards.");
  }
  const requireCurrent = () => {
    if (isCurrent() !== true || preparedFeedback.isCurrent() !== true) throw new TypeError("Final feedback capture is no longer current.");
  };
  requireCurrent();
  const generation = registry.getAcceptanceGeneration();
  const review = registry.readAccepted(), observed = registry.read({ format: "contributions" });
  const feedback = structuredClone(preparedFeedback.snapshot);
  const currentFeedback = observed.snapshots.find(snapshot => snapshot.segment === "P5");
  if (feedback?.segment !== "P5" || !feedback.enabled || feedback.pending || !feedback.contribution
    || canonicalJson(feedback) !== canonicalJson(currentFeedback)) {
    throw new PlannerRecipeIssue("P5", "segments.P5", "preparation-required", "Prepare the exact current feedback before final capture.");
  }
  const problem = review.issues.find(issue => issue.segment !== "P5"
    || !["acceptance-missing", "acceptance-stale"].includes(issue.code));
  if (problem || observed.issues.length) throw new TypeError(problem?.message ?? observed.issues[0].message);
  const segments = {};
  for (const segment of PLANNER_RECIPE_SEGMENTS) {
    if (segment === "P5") { segments.P5 = structuredClone(feedback.contribution); continue; }
    const entry = review.entries.find(item => item.segment === segment);
    if (segment === "P6" && entry?.status === "excluded") { segments.P6 = { status: "excluded" }; continue; }
    const snapshot = review.snapshots.find(item => item.segment === segment);
    if (entry?.status !== "accepted" || !snapshot?.enabled || snapshot.pending || !snapshot.contribution) {
      throw new PlannerRecipeIssue(segment, `segments.${segment}`, "acceptance-required", "Confirm this section's complete current content before saving.");
    }
    segments[segment] = segment === "P6" ? { status: "included", profile: structuredClone(snapshot.contribution) }
      : structuredClone(snapshot.contribution);
  }
  const version = segments.P2.version;
  if (![1, 2].includes(version)) throw new TypeError("Unsupported questionnaire contribution version for final capture.");
  const validate = version === 2 ? validatePlannerRecipeStructureV2 : validatePlannerRecipeStructureV1;
  const core = validate({ schema: PLANNER_RECIPE_SCHEMA, version, recipeId, presentationTarget,
    policy: structuredClone(policy), segments }, { integrity: false });
  const input = freezeRecipeValue(JSON.parse(canonicalJson(core)));
  let stale = false;
  const current = () => {
    if (stale) return false;
    try {
      requireCurrent();
      stale = registry.getAcceptanceGeneration() !== generation
        || registry.readAccepted().fingerprint !== review.fingerprint
        || registry.read({ format: "contributions" }).fingerprint !== observed.fingerprint
        || registry.getAcceptanceGeneration() !== generation;
    } catch { stale = true; }
    return !stale;
  };
  if (!current()) throw new TypeError("The design changed during prepared feedback capture.");
  return Object.freeze({ input, isCurrent: current });
}

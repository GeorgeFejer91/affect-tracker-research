import { readRunnerRecipe, resolveRunnerSelection } from "../../runner/src/recipe.js";

const executionBlock = "VLC execution of Planner master recipes is not implemented.";

/** Strict, read-only RR-02/03 handoff. Playback and recording remain closed. */
export async function prepareVlcMasterIntake(bytes, participantId, languageSelectionPath, variantId, questionnaireAssets) {
  const receipt = await readRunnerRecipe(bytes, questionnaireAssets);
  if (!receipt.recipe) throw new Error("Select a supported Planner master recipe (versions 1–5).");
  const plan = await resolveRunnerSelection(receipt, participantId, languageSelectionPath, variantId);
  return Object.freeze({ sourceText: receipt.canonicalSourceText, plan, canStart: false, blockReason: executionBlock });
}

export function startVlcMaster() {
  throw new Error(executionBlock);
}

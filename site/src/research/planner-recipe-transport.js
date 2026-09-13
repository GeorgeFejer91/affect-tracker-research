import { canonicalJson } from "./canonical.js";

export const PLANNER_ASSET_BUNDLE_SCHEMA = "affect-research-planner-asset-bundle";

/** An explicit, bounded transport snapshot, never the on-disk experiment file.
 * Legacy documents retain their exact original transport bytes. */
export function plannerRecipeTransportText(document) {
  if (document?.recipe?.version !== 5) return document.canonicalSourceText;
  return `${canonicalJson({ schema: PLANNER_ASSET_BUNDLE_SCHEMA, version: 1,
    recipeSourceText: document.canonicalSourceText, questionnaireAssets: document.questionnaireAssets })}\n`;
}

export const plannerRecipeContent = document => document.resolvedRecipe ?? document.recipe;

import { readFile } from "node:fs/promises";
import { typedOwner, op, guard } from "./p2-typed-owner.js";
import { compilePlannerRecipeV2, reproducePlannerRecipeV2, reconstructPlannerRecipeSelectionV2 } from "../../site/src/research/planner-recipe.js";

/** Synthetic engineering fixture. Real P2 editor compilation with a synthetic
 * source-save callback; no native storage or participant run is represented. */
export async function plannerRecipeV2Fixture() {
  const legacy = JSON.parse(await readFile(new URL("./planner-recipe-current-v1.canonical.json", import.meta.url), "utf8"));
  const p2 = await typedOwner();
  await p2.apply([op("addDemographics")]);
  for (const language of ["en", "de"]) await p2.editor.saveAuthoringQuestionnaire(`demographics-${language}`, guard());
  const { integrity, ...core } = legacy;
  core.version = 2;
  core.recipeId = "typed-master-engineering";
  core.segments.P2 = await p2.contribution();
  const recipe = await compilePlannerRecipeV2(core);
  const reproduction = await reproducePlannerRecipeV2(recipe);
  const selections = [];
  for (const { selectionSha256, ...selector } of reproduction.cases) selections.push(await reconstructPlannerRecipeSelectionV2(recipe, selector));
  return { recipe, reproduction, selections };
}

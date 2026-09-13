import { writeFile, readFile } from "node:fs/promises";
import { surveyCore } from "../test/fixtures/planner-recipe-v4-fixture.js";
import { compilePlannerRecipeV4, serializePlannerRecipeV4, reproducePlannerRecipeV4, reconstructPlannerRecipeSelectionV4 } from "../site/src/research/planner-recipe.js";
import { canonicalJson } from "../site/src/research/canonical.js";
const recipe = await compilePlannerRecipeV4(await surveyCore());
const selector = { variantId: "variant-1", languageId: "de", languageSelectionPath: ["both", "de"], presentationTarget: "desktop-screen" };
for (const [name, text] of Object.entries({
  "canonical": await serializePlannerRecipeV4(recipe),
  "reproduction": canonicalJson(await reproducePlannerRecipeV4(recipe)) + "\n",
  "selection": canonicalJson(await reconstructPlannerRecipeSelectionV4(recipe, selector)) + "\n",
})) {
  const path = `test/fixtures/planner-recipe-v4-surveyjs.${name}.json`;
  if (process.argv.includes("--check")) { if (await readFile(path, "utf8") !== text) throw new Error(`Stale fixture: ${path}`); }
  else await writeFile(path, text);
}

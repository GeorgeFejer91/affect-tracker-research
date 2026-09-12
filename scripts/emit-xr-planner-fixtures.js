import { readFile, writeFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV1, serializePlannerRecipeV1, reproducePlannerRecipeV1 } from "../site/src/research/planner-recipe.js";
import { resolveSavedXrLayoutContribution } from "../site/src/research/xr-layout-recipe.js";

// Owner-reviewed P7/P6 fixtures supply every input. No default or ready snapshot.
const directory = new URL("../test/fixtures/", import.meta.url);
const { integrity, ...core } = JSON.parse(await readFile(new URL("planner-recipe-locations-v1.canonical.json", directory)));
const profile = JSON.parse(await readFile(new URL("xr-layout-recipe-v1.json", directory))).profiles[0];
core.presentationTarget = "webxr-immersive-vr";
core.segments.P6 = { status: "included", profile };
const recipe = await compilePlannerRecipeV1(core);
await writeFile(new URL("planner-xr-master-v1.canonical.json", directory), await serializePlannerRecipeV1(recipe));
await writeFile(new URL("planner-xr-master-v1-reproduction.json", directory), `${canonicalJson(await reproducePlannerRecipeV1(recipe))}\n`);
const layout = await resolveSavedXrLayoutContribution(profile, {
  workspaceContribution: recipe.segments.P1, feedbackContribution: recipe.segments.P5, selectedTarget: recipe.presentationTarget,
});
await writeFile(new URL("planner-xr-master-v1-layout.json", directory), `${canonicalJson(layout)}\n`);

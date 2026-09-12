import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { canonicalJson } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV1, serializePlannerRecipeV1, reproducePlannerRecipeV1 } from "../site/src/research/planner-recipe.js";
import { resolveSavedXrLayoutContribution } from "../site/src/research/xr-layout-recipe.js";

// Owner-reviewed P7/P6 fixtures supply every input. No default or ready snapshot.
// Emit current-algorithm receipts into an explicit evidence directory. Historical
// repository V1 vectors must never be overwritten by a newer compiler default.
if (!process.argv[2]) throw new Error("Provide an output evidence directory for current XR master receipts.");
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const directory = new URL("../test/fixtures/", import.meta.url);
const { integrity, ...core } = JSON.parse(await readFile(new URL("planner-recipe-locations-v1.canonical.json", directory)));
const profile = JSON.parse(await readFile(new URL("xr-layout-recipe-v1.json", directory))).profiles[0];
core.presentationTarget = "webxr-immersive-vr";
core.segments.P6 = { status: "included", profile };
const recipe = await compilePlannerRecipeV1(core);
await writeFile(join(output, "planner-xr-master-v2.canonical.json"), await serializePlannerRecipeV1(recipe));
await writeFile(join(output, "planner-xr-master-v2-reproduction.json"), `${canonicalJson(await reproducePlannerRecipeV1(recipe))}\n`);
const layout = await resolveSavedXrLayoutContribution(profile, {
  workspaceContribution: recipe.segments.P1, feedbackContribution: recipe.segments.P5, selectedTarget: recipe.presentationTarget,
});
await writeFile(join(output, "planner-xr-master-v2-layout.json"), `${canonicalJson(layout)}\n`);

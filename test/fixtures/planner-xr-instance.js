import { readFile } from "node:fs/promises";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { compilePlannerRecipeV1, parsePlannerRecipeV1, serializePlannerRecipeV1,
  reproducePlannerRecipeV1, reconstructPlannerRecipeSelectionV1 } from "../../site/src/research/planner-recipe.js";

const masters = await Promise.all(["planner-recipe-v1", "planner-recipe-locations-v1"].map(async name =>
  JSON.parse(await readFile(new URL(`${name}.canonical.json`, import.meta.url)))));
const profiles = JSON.parse(await readFile(new URL("xr-layout-recipe-v1.json", import.meta.url))).profiles;
Math.random = () => { throw Error("Unexpected RNG input"); };
Date.now = () => { throw Error("Unexpected clock input"); };
for (const key of ["localStorage", "indexedDB", "navigator", "document", "window"]) {
  Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error(key); } });
}
const receipts = [];
for (const master of masters) for (const profile of profiles) {
  const { integrity, ...core } = structuredClone(master);
  core.presentationTarget = "webxr-immersive-vr";
  core.segments.P6 = { status: "included", profile };
  const source = await serializePlannerRecipeV1(await compilePlannerRecipeV1(core));
  const document = await parsePlannerRecipeV1(new TextEncoder().encode(source));
  const matrix = await reproducePlannerRecipeV1(document.recipe), selections = [];
  for (const { variantId, languageId, languageSelectionPath, presentationTarget } of matrix.cases) {
    if (presentationTarget !== "webxr-immersive-vr") continue;
    selections.push(await reconstructPlannerRecipeSelectionV1(document.recipe,
      { variantId, languageId, languageSelectionPath, presentationTarget }));
  }
  receipts.push({ source, sourceSha256: document.canonicalSourceByteSha256, matrix, selections });
}
process.stdout.write(canonicalJson(receipts));

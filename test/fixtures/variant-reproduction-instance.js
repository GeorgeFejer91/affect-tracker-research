import { readFile } from "node:fs/promises";
// Guard before importing the owner. Each invocation is a fresh Node process.
const forbidden = [];
const reject = name => { forbidden.push(name); throw new Error(`Unexpected ambient ${name}`); };
const ActualDate = Date;
globalThis.Date = class extends ActualDate {
  constructor(...args) { if (!args.length) reject("clock"); super(...args); }
  static now() { return reject("clock"); }
};
Math.random = () => reject("RNG");
for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches", "navigator"]) {
  Object.defineProperty(globalThis, name, { configurable: true, get: () => reject(name) });
}
const subtle = globalThis.crypto.subtle;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
  subtle, randomUUID: () => reject("crypto RNG"), getRandomValues: () => reject("crypto RNG"),
} });
const { canonicalJson, canonicalSha256 } = await import("../../site/src/research/canonical.js");
const { createVariantDesign, variantDesignToDraft } = await import("../../site/src/research/variant-design.js");
const { projectSavedVariantCatalogue } = await import("../../site/src/research/variant-catalogue-adapter.js");
const { assertVariantReproduction } = await import("./assert-variant-reproduction.js");
const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
if (process.argv[3]) {
  const { parsePlannerRecipeV1, serializePlannerRecipeV1, reproducePlannerRecipeV1, reconstructPlannerRecipeSelectionV1 } = await import("../../site/src/research/planner-recipe.js");
  const { recipe } = await parsePlannerRecipeV1(await readFile(process.argv[3]));
  const projections = await assertVariantReproduction(recipe.segments.P1, recipe.segments.P3, recipe.integrity.definitionSha256, fixture.expected);
  const matrix = await reproducePlannerRecipeV1(recipe);
  const selections = [];
  for (const { variantId, languageId, languageSelectionPath, presentationTarget } of matrix.cases) {
    selections.push(await reconstructPlannerRecipeSelectionV1(recipe, { variantId, languageId, languageSelectionPath, presentationTarget }));
  }
  process.stdout.write(JSON.stringify({ projections, matrix, selections, canonical: await serializePlannerRecipeV1(recipe), forbidden }));
} else {
const recipeSha256 = await canonicalSha256({ workspace: fixture.workspace, contribution: fixture.contribution });
const projections = await assertVariantReproduction(fixture.workspace, fixture.contribution, recipeSha256, fixture.expected);
const { library } = await projectSavedVariantCatalogue(fixture.workspace);
const reopened = await createVariantDesign(variantDesignToDraft(fixture.contribution), library);
process.stdout.write(JSON.stringify({ projections, canonical: canonicalJson(reopened), forbidden }));
}

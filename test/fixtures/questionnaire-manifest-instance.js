import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePlannerRecipeV5 } from "../../site/src/research/planner-recipe-assets.js";
import { resolveRunnerSelection } from "../../runner/src/recipe.js";
import { canonicalSha256 } from "../../site/src/research/canonical.js";
const root = process.argv[2], bytes = readFileSync(join(root, "experiment.json"));
const manifest = JSON.parse(bytes);
const assets = manifest.segments.P2.questionnaires.assets.map(ref => ({ relativePath: ref.relativePath, sourceText: readFileSync(join(root, ref.relativePath), "utf8") }));
const document = await parsePlannerRecipeV5(bytes, assets), cases = [];
for (const variant of document.recipe.segments.P3.variants) for (const language of document.recipe.segments.P2.languageSelection.languages) {
  const plan = await resolveRunnerSelection(document, "P001", ["both", language.languageId], variant.variantId);
  cases.push({ identity: plan.planIdentitySha256, sequence: await canonicalSha256(plan.steps), selected: await canonicalSha256(plan.selected) });
}
process.stdout.write(JSON.stringify({ source: document.canonicalSourceText, hash: document.canonicalSourceByteSha256, cases }));

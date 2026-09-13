// Create a separate synthetic SurveyJS experiment from a validated local mock.
// Uses the production Planner compiler; never edits the source study or outputs.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import { canonicalJson, sha256Hex } from "../../site/src/research/canonical.js";
import { parseSupportedPlannerRecipe, compilePlannerRecipeV4 } from "../../site/src/research/planner-recipe.js";
import { importSurveyJson } from "../../site/src/research/surveyjs-definition.js";
import { createQuestionnairePresentationV3 } from "../../site/src/research/questionnaire-recipe-v2.js";

const [sourcePath, destination] = process.argv.slice(2);
assert.ok(sourcePath && destination, "Provide a mock recipe and a new output directory.");
const source = resolve(sourcePath), root = resolve(destination);
const loaded = await parseSupportedPlannerRecipe(await readFile(source));
assert.equal(loaded.recipe.segments.P1.study.id, "mock-dictator", "Only the existing synthetic mock is accepted.");
await mkdir(root); // New directory, never overwrite an experiment.
const { integrity, ...core } = structuredClone(loaded.recipe);
core.version = 4; core.recipeId = "core-survey-validation";
core.segments.P1.study.id = "core-survey-validation";
core.segments.P1.study.title = "Synthetic core product validation";
core.policy.lsl.sourceId = "core-survey-validation";
const p2 = core.segments.P2; p2.version = 3; p2.questionnaires.algorithmVersion = "questionnaire-hooks-v4";
p2.questionnaires.definitions = await Promise.all(p2.questionnaires.definitions.map(async (old, index) => {
  const title = `Synthetic validation ${index + 1} (${old.language})`;
  const survey = { title, showQuestionNumbers: "off", elements: [
    { type: "radiogroup", name: "choice", title: "Select the synthetic test answer", choices: ["Test answer", "Alternative"] },
    { type: "comment", name: "note", title: "Enter a synthetic note", validators: [{ type: "text", minLength: 4 }] },
  ] };
  return (await importSurveyJson(JSON.stringify(survey), { questionnaireId: old.questionnaireId, questionnaireVersion: "synthetic-validation", language: old.language, title })).definition;
}));
for (const module of p2.questionnaires.modules) module.definitionSha256 = p2.questionnaires.definitions.find(d => d.questionnaireId === module.questionnaireId).definitionSha256;
p2.presentation = createQuestionnairePresentationV3(p2.questionnaires.definitions);
const recipe = await compilePlannerRecipeV4(core);
for (const entry of recipe.segments.P1.videoCatalogue.entries) {
  const sourceAsset = resolve(dirname(source), entry.packageRelativePath), target = resolve(root, entry.packageRelativePath);
  assert.ok(!relative(root, target).startsWith(".."));
  const bytes = await readFile(sourceAsset);
  assert.equal(bytes.length, entry.byteLength); assert.equal(await sha256Hex(bytes), entry.sha256);
  await mkdir(dirname(target), { recursive: true }); await copyFile(sourceAsset, target);
}
const target = join(root, "experiment.json");
await writeFile(target, canonicalJson(recipe) + "\n", { flag: "wx" });
console.log(JSON.stringify({ recipe: target, sourceRecipeSha256: loaded.canonicalSourceByteSha256, synthetic: true, recipeVersion: recipe.version }));

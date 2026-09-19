import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../experiment-planner/web/src/research/canonical.js";
import { importSurveyJson } from "../experiment-planner/web/src/research/surveyjs-definition.js";
import { checkSurveyData } from "../experiment-planner/web/src/research/surveyjs-engine.js";
import { surveyCore } from "./fixtures/planner-recipe-v4-fixture.js";
import { createQuestionnairePresentationV3 } from "../experiment-planner/web/src/research/questionnaire-recipe-v2.js";
import { compilePlannerRecipeV4 } from "../experiment-planner/web/src/research/planner-recipe.js";
import { validatePlannerContributionSnapshot } from "../experiment-planner/web/src/research/planner-contributions.js";
import { prepareSupportedBrowserPlannerRecipeSave, openSupportedBrowserPlannerRecipeFile } from "../experiment-planner/web/src/research/planner-recipe-file.js";
import { readRunnerRecipe, resolveRunnerSelection } from "../experiment-runner/src/recipe.js";

test("large SurveyJS content survives import, segment handoff, exact save/reopen and before-session planning", async () => {
  const core = await surveyCore(), p2 = core.segments.P2;
  const survey = { elements: [{ type: "html", name: "instructions", html: `<p>${"x".repeat(4.25 * 1024 * 1024)}</p>` }, { type: "comment", name: "answer", maxLength: 0 }] };
  p2.questionnaires.definitions = await Promise.all(p2.questionnaires.definitions.map(async old =>
    (await importSurveyJson(JSON.stringify(survey), { questionnaireId: old.questionnaireId, language: old.language })).definition));
  for (const module of p2.questionnaires.modules) module.definitionSha256 = p2.questionnaires.definitions.find(d => d.questionnaireId === module.questionnaireId).definitionSha256;
  p2.presentation = createQuestionnairePresentationV3(p2.questionnaires.definitions);
  const snapshot = validatePlannerContributionSnapshot({ revision: 1, enabled: true, pending: false, contribution: p2, dependencyRevisions: [] });
  assert.deepEqual(snapshot.contribution, p2);
  const recipe = await compilePlannerRecipeV4(core), source = `${canonicalJson(recipe)}\n`;
  assert.ok(Buffer.byteLength(source) > 16 * 1024 * 1024);
  let written = new Uint8Array();
  const handle = { kind: "file", async getFile() { return { size: written.length, arrayBuffer: async () => written.slice().buffer }; },
    async createWritable() { return { async write(bytes) { written = bytes.slice(); }, async close() {}, async abort() {} }; } };
  const save = await prepareSupportedBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickSaveFile: () => handle });
  const receipt = await save.chooseAndSave();
  assert.equal(receipt.byteLength, Buffer.byteLength(source));
  const opened = await openSupportedBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: () => [handle] });
  assert.equal(opened.document.canonicalSourceText, source);
  const runner = await readRunnerRecipe(written);
  const plan = await resolveRunnerSelection(runner, "P001", ["both", "en"], "variant-1");
  const firstVideo = plan.steps.findIndex(step => step.kind === "video");
  const before = plan.steps.slice(0, firstVideo).filter(step => step.kind === "questionnaire");
  assert.deepEqual(before.map(step => step.payload.module.moduleId), plan.selected.questionnaires.beforeSession.map(entry => entry.module.moduleId));
  assert.ok(before.length > 0);
  assert.deepEqual(before[0].payload.definition.surveyJson, survey);
  const data = { answer: "a".repeat(4.25 * 1024 * 1024) };
  assert.deepEqual(checkSurveyData(survey, { data, complete: true }).data, data);
});

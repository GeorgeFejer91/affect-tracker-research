import { controlledCore } from "./planner-recipe-v3-fixture.js";
import { importSurveyJson } from "../../site/src/research/surveyjs-definition.js";
import { createQuestionnairePresentationV3 } from "../../site/src/research/questionnaire-recipe-v2.js";
export const fixtureSurvey = { title: { default: "Fictitious survey", de: "Fiktiver Fragebogen" }, clearInvisibleValues: "onComplete", pages: [
  { name: "branch", elements: [{ type: "boolean", name: "details", title: { default: "Provide details?", de: "Details angeben?" } }] },
  { name: "detail", visibleIf: "{details} = true", elements: [{ type: "comment", name: "explanation" }, { type: "checkbox", name: "choices", choices: ["a", "b", "c"], validators: [{ type: "answercount", minCount: 2 }] }] },
] };
export async function surveyCore() {
  const { core } = await controlledCore(); core.version = 4; core.recipeId = "surveyjs-fixture";
  const p2 = core.segments.P2; p2.version = 3; p2.questionnaires.algorithmVersion = "questionnaire-hooks-v4";
  p2.questionnaires.definitions = await Promise.all(p2.questionnaires.definitions.map(async old => (await importSurveyJson(JSON.stringify(fixtureSurvey, null, 2), { questionnaireId: old.questionnaireId, language: old.language })).definition));
  for (const module of p2.questionnaires.modules) module.definitionSha256 = p2.questionnaires.definitions.find(d => d.questionnaireId === module.questionnaireId).definitionSha256;
  p2.presentation = createQuestionnairePresentationV3(p2.questionnaires.definitions);
  return core;
}

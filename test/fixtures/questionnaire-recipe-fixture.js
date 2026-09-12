import { createQuestionnaireSheet, setQuestionnaireGridCell, sheetToAuthoring } from "../../site/src/research/questionnaire-sheet.js";
import { QUESTIONNAIRE_RECIPE_SCHEMA, createQuestionnairePresentationV1 } from "../../site/src/research/questionnaire-recipe.js";

/** Synthetic study content, never an asserted validated instrument translation. */
export async function questionnaireRecipeFixture() {
  const definitions = [];
  for (const language of ["en", "de"]) {
    const sheet = createQuestionnaireSheet({ familyId: "custom-study", language, rowCount: 2, optionCount: 2 });
    sheet.title = language === "en" ? "Custom study" : "Eigene Studie";
    sheet.instructions = language === "en" ? "Choose one answer." : "Wählen Sie eine Antwort.";
    sheet.attribution = "Synthetic fixture; researcher-authored labels and explicit codes, no computed score.";
    for (let row = 0; row < 2; row += 1) {
      setQuestionnaireGridCell(sheet, row, 0, `${language === "en" ? "Study item" : "Studienfrage"} ${row + 1}`);
      setQuestionnaireGridCell(sheet, row, 1, language === "en" ? "Never" : "Nie");
      setQuestionnaireGridCell(sheet, row, 2, row ? null : 4);
      setQuestionnaireGridCell(sheet, row, 3, language === "en" ? "Always" : "Immer");
      setQuestionnaireGridCell(sheet, row, 4, row ? null : -2.5);
      setQuestionnaireGridCell(sheet, row, 5, row === 0 ? "true" : "false");
      sheet.rows[row].subscale = row === 0 ? "researcher-declared" : null;
    }
    definitions.push((await sheetToAuthoring(sheet)).definition);
  }
  const modules = definitions.flatMap((definition) => ["beforeSession", "afterSession"].map((kind, index) => ({
    schema: "affect-research-questionnaire-module", version: 2, moduleId: `${definition.language}-${index}`,
    questionnaireId: definition.questionnaireId, definitionSha256: definition.definitionSha256,
    placement: { kind, blockId: null } })));
  const languageSelection = { algorithmVersion: "language-tree-v1", rootNodeId: "group",
    languages: ["en", "de"].map((languageTag) => ({ languageId: languageTag, languageTag, label: languageTag,
      questionnaireModuleIds: [`${languageTag}-0`, `${languageTag}-1`] })),
    nodes: [{ nodeId: "group", prompt: "Select group", options: [{ optionId: "both", label: "Study languages",
      target: { kind: "node", nodeId: "language" } }] },
    { nodeId: "language", prompt: "Select language", options: ["en", "de"].map((languageId) => ({
      optionId: languageId, label: languageId, target: { kind: "language", languageId } })) }] };
  return structuredClone({ schema: QUESTIONNAIRE_RECIPE_SCHEMA, version: 1,
    questionnaires: { algorithmVersion: "questionnaire-hooks-v2", definitions, modules }, languageSelection,
    presentation: createQuestionnairePresentationV1(definitions, [5, 10]) });
}

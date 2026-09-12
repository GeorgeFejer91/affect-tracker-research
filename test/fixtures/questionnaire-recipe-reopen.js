import { canonicalJson } from "../../site/src/research/canonical.js";
import { validateQuestionnaireRecipeContributionV1 } from "../../site/src/research/questionnaire-recipe.js";
import { sheetFromDefinition, sheetToAuthoring } from "../../site/src/research/questionnaire-sheet.js";
import { questionnaireFamilyId } from "../../site/src/research/questionnaire-assets.js";

let source = "";
for await (const chunk of process.stdin) {
  source += chunk.toString("utf8");
  if (Buffer.byteLength(source) > 16 * 1024 * 1024) throw new Error("Fixture input exceeds the legacy package byte ceiling.");
}
// No ambient authoring defaults or local assets may fill missing recipe data.
Date.now = () => { throw new Error("No clock in questionnaire reproduction."); };
Math.random = () => { throw new Error("No random input in questionnaire reproduction."); };
const value = await validateQuestionnaireRecipeContributionV1(JSON.parse(source));
for (let index = 0; index < value.questionnaires.definitions.length; index += 1) {
  const definition = value.questionnaires.definitions[index];
  value.questionnaires.definitions[index] = (await sheetToAuthoring(sheetFromDefinition(definition,
    { familyId: questionnaireFamilyId(definition) }))).definition;
}
await validateQuestionnaireRecipeContributionV1(value);
process.stdout.write(`${canonicalJson(value)}\n`);

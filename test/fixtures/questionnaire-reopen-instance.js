// Independent, data-only authoring round trip. No user files or runtime devices.
import { parseExperimentPackageV1, createExperimentPackageV1, serializeExperimentPackageV1 } from "../../site/src/research/experiment-package.js";
import { restoreQuestionnaireAuthoring } from "../../site/src/research/questionnaire-contribution.js";
import { sheetFromDefinition, sheetToAuthoring } from "../../site/src/research/questionnaire-sheet.js";
import { questionnaireFamilyId } from "../../site/src/research/questionnaire-assets.js";

let source = "";
for await (const chunk of process.stdin) {
  source += chunk.toString("utf8");
  if (Buffer.byteLength(source) > 8 * 1024 * 1024) throw new Error("Fixture input is too large.");
}
const { package: packageValue } = await parseExperimentPackageV1(new TextEncoder().encode(source));
const { contribution } = await restoreQuestionnaireAuthoring({
  questionnaires: packageValue.settings.questionnaires, languageSelection: packageValue.languageSelection,
});
for (const [index, definition] of contribution.questionnaires.definitions.entries()) {
  contribution.questionnaires.definitions[index] = (await sheetToAuthoring(sheetFromDefinition(definition, {
    familyId: questionnaireFamilyId(definition),
  }))).definition;
}
process.stdout.write(await serializeExperimentPackageV1(await createExperimentPackageV1({
  packageId: packageValue.packageId, playback: packageValue.playback,
  settings: { ...packageValue.settings, questionnaires: contribution.questionnaires },
  languageSelection: contribution.languageSelection,
})));

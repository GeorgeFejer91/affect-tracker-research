import { validateQuestionnaireRecipeContributionV1 } from "./questionnaire-recipe.js";
import { restoreQuestionnaireAuthoring } from "./questionnaire-contribution.js";
import { restoreQuestionnaireAuthoringV2, restoreQuestionnaireAuthoringV3 } from "./questionnaire-recipe-v2.js";

/** Explicit version dispatch; saved source/presentation are not runtime readiness. */
export async function restoreQuestionnaireRecipeContent(input) {
  const value = structuredClone(input);
  let restored;
  if (value?.version === 1) {
    const checked = await validateQuestionnaireRecipeContributionV1(value);
    restored = await restoreQuestionnaireAuthoring({ questionnaires: checked.questionnaires, languageSelection: checked.languageSelection });
  } else if (value?.version === 2) {
    restored = await restoreQuestionnaireAuthoringV2(value);
  } else if (value?.version === 3) {
    restored = await restoreQuestionnaireAuthoringV3(value);
  } else throw new TypeError("Unsupported questionnaire recipe contribution version.");
  if (!restored.coverage.complete) throw new TypeError("Supply every questionnaire in every selected language.");
  return { ...structuredClone(restored), presentation: structuredClone(value.presentation) };
}

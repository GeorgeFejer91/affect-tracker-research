import { canonicalJson } from "./canonical.js";
import { restoreQuestionnaireAuthoring } from "./questionnaire-contribution.js";

export const QUESTIONNAIRE_RECIPE_SCHEMA = "affect-research-questionnaire-recipe-contribution";
export const QUESTIONNAIRE_PRESENTATION_SCHEMA = "affect-research-questionnaire-presentation";
export const QUESTIONNAIRE_LABEL_REPETITIONS = Object.freeze([1, 5, 10]);

function exact(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new TypeError(`${path} has missing or unknown fields.`);
  }
}

/** Strict synchronous companion validation; the full owner validator verifies
 * definition hashes and coverage. Ordered one-to-one binding forbids stale or
 * orphaned settings and makes the presentation projection deterministic. */
export function validateQuestionnairePresentationV1(value, definitions) {
  exact(value, ["schema", "version", "definitions"], "Questionnaire presentation");
  if (value.schema !== QUESTIONNAIRE_PRESENTATION_SCHEMA || value.version !== 1) {
    throw new TypeError("Unsupported questionnaire presentation version.");
  }
  if (!Array.isArray(value.definitions) || value.definitions.length !== definitions.length) {
    throw new TypeError("Every questionnaire definition needs exactly one presentation entry.");
  }
  for (const [index, entry] of value.definitions.entries()) {
    exact(entry, ["questionnaireId", "definitionSha256", "repeatLabelsEvery"], `Presentation entry ${index + 1}`);
    if (entry.questionnaireId !== definitions[index].questionnaireId
      || entry.definitionSha256 !== definitions[index].definitionSha256) {
      throw new TypeError("Questionnaire presentation must match each definition's identity, hash and order.");
    }
    if (!QUESTIONNAIRE_LABEL_REPETITIONS.includes(entry.repeatLabelsEvery)) {
      throw new TypeError("Repeat answer labels every 1, 5 or 10 items.");
    }
  }
  return structuredClone(value);
}

/** Explicit legacy/UI projection, never an import-parser default. */
export function createQuestionnairePresentationV1(definitions, repetitions = definitions.map(() => 1)) {
  if (!Array.isArray(repetitions) || repetitions.length !== definitions.length) {
    throw new TypeError("Supply one label repetition value per questionnaire definition.");
  }
  return validateQuestionnairePresentationV1({ schema: QUESTIONNAIRE_PRESENTATION_SCHEMA, version: 1,
    definitions: definitions.map((definition, index) => ({ questionnaireId: definition.questionnaireId,
      definitionSha256: definition.definitionSha256, repeatLabelsEvery: repetitions[index] })) }, definitions);
}

/** Pure, detached, full-content validation. No media or runtime authority. */
export async function validateQuestionnaireRecipeContributionV1(value) {
  value = structuredClone(value); // Capture before asynchronous hash verification.
  exact(value, ["schema", "version", "questionnaires", "languageSelection", "presentation"], "Questionnaire recipe contribution");
  if (value.schema !== QUESTIONNAIRE_RECIPE_SCHEMA || value.version !== 1) {
    throw new TypeError("Unsupported questionnaire recipe contribution version.");
  }
  const restored = await restoreQuestionnaireAuthoring({ questionnaires: value.questionnaires, languageSelection: value.languageSelection });
  if (!restored.coverage.complete) throw new TypeError("Supply every questionnaire in every selected language.");
  validateQuestionnairePresentationV1(value.presentation, restored.contribution.questionnaires.definitions);
  return value;
}

/** P7 acceptance callback uses true/throw rather than a second policy owner. */
export async function validateQuestionnaireRecipeContribution(value) {
  await validateQuestionnaireRecipeContributionV1(value);
  return true;
}

/** Participant labels restart whenever a row's label set differs, even within
 * a requested group. Recorded codes do not participate in visible grouping. */
export function questionnairePresentationGroups(definition, repeatLabelsEvery) {
  if (!QUESTIONNAIRE_LABEL_REPETITIONS.includes(repeatLabelsEvery)) {
    throw new TypeError("Repeat answer labels every 1, 5 or 10 items.");
  }
  const groups = [];
  const sameLabels = (a, b) => a.options.length === b.options.length
    && a.options.every((option, index) => option.label === b.options[index].label);
  for (let start = 0; start < definition.items.length;) {
    let end = start + 1;
    while (end < definition.items.length && end < start + repeatLabelsEvery
      && sameLabels(definition.items[start], definition.items[end])) end += 1;
    groups.push({ start, end });
    start = end;
  }
  return groups;
}

import { canonicalJson } from "./canonical.js";
import { validateLanguageSelectionTreeV1, enumerateLanguageRoutesV1 } from "./experiment-package.js";
import { validateQuestionnaireModuleV2 } from "./questionnaires.js";
import { questionnaireFamilyId, analyzeQuestionnaireLanguageCoverage } from "./questionnaire-assets.js";
import { validateQuestionnaireRecipeContributionV1 } from "./questionnaire-recipe.js";
import { FORM_DEFINITION_SCHEMA, exactFormObject, verifyP2Definition } from "./form-definition.js";

export const QUESTIONNAIRE_HOOKS_V3_ALGORITHM_VERSION = "questionnaire-hooks-v3";
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
export function validateQuestionnairePresentationV2(value, definitions) {
  exactFormObject(value, ["schema", "version", "definitions"], "Presentation");
  if (value.schema !== "affect-research-questionnaire-presentation" || value.version !== 2
    || !Array.isArray(value.definitions) || value.definitions.length !== definitions.length) throw new TypeError("Unsupported or incomplete presentation v2.");
  value.definitions.forEach((entry, index) => {
    const d = definitions[index], kind = d.schema === FORM_DEFINITION_SCHEMA ? "fields" : "likert";
    exactFormObject(entry, kind === "fields" ? ["kind", "questionnaireId", "definitionSha256"] : ["kind", "questionnaireId", "definitionSha256", "repeatLabelsEvery"], "Presentation entry");
    if (entry.kind !== kind || entry.questionnaireId !== d.questionnaireId || entry.definitionSha256 !== d.definitionSha256
      || (kind === "likert" && ![1, 5, 10].includes(entry.repeatLabelsEvery))) throw new TypeError("Presentation kind/identity/hash/order mismatch.");
  });
  return structuredClone(value);
}
export function createQuestionnairePresentationV2(definitions, repetitions = definitions.map(() => 1)) {
  if (!Array.isArray(repetitions) || repetitions.length !== definitions.length) throw new TypeError("Presentation needs one repetition slot per definition.");
  return validateQuestionnairePresentationV2({ schema: "affect-research-questionnaire-presentation", version: 2,
    definitions: definitions.map((d, i) => ({ kind: d.schema === FORM_DEFINITION_SCHEMA ? "fields" : "likert",
      questionnaireId: d.questionnaireId, definitionSha256: d.definitionSha256,
      ...(d.schema === FORM_DEFINITION_SCHEMA ? {} : { repeatLabelsEvery: repetitions[i] }) })) }, definitions);
}
export async function validateQuestionnaireRecipeContributionV2(input) {
  const value = structuredClone(input);
  exactFormObject(value, ["schema", "version", "questionnaires", "languageSelection", "presentation"], "P2 v2");
  if (value.schema !== "affect-research-questionnaire-recipe-contribution" || value.version !== 2) throw new TypeError("Unsupported P2 contribution version.");
  const q = value.questionnaires;
  exactFormObject(q, ["algorithmVersion", "definitions", "modules"]);
  if (q.algorithmVersion !== QUESTIONNAIRE_HOOKS_V3_ALGORITHM_VERSION || !Array.isArray(q.definitions)
    || q.definitions.length > 256 || !Array.isArray(q.modules) || q.modules.length > 1024) throw new TypeError("Unsupported or oversized P2 v2 questionnaires.");
  const tree = validateLanguageSelectionTreeV1(value.languageSelection);
  if (!same(tree, value.languageSelection)) throw new TypeError("P2 language selection must already be canonical.");
  const definitions = new Map(), slots = new Set();
  for (const d of q.definitions) {
    const checked = await verifyP2Definition(d);
    const slot = `${questionnaireFamilyId(d)}/${d.language}`;
    if (!same(checked, d) || definitions.has(d.questionnaireId) || slots.has(slot)
      || !tree.languages.some(l => l.languageTag === d.language) || d.language === "und") throw new TypeError("Invalid definition identity/language/family slot.");
    definitions.set(d.questionnaireId, d); slots.add(slot);
  }
  const modules = new Map();
  for (const m of q.modules) {
    const checked = validateQuestionnaireModuleV2(m), d = definitions.get(m.questionnaireId);
    if (!same(m, checked) || !d || d.definitionSha256 !== m.definitionSha256 || modules.has(m.moduleId)) throw new TypeError("Module identity/hash mismatch.");
    if (!["beforeSession", "afterSession"].includes(m.placement.kind)) throw new TypeError("P2 v2 supports beforeSession/afterSession only.");
    modules.set(m.moduleId, m);
  }
  const mapped = new Set();
  for (const l of tree.languages) for (const id of l.questionnaireModuleIds) {
    const module = modules.get(id);
    if (!module || definitions.get(module.questionnaireId).language !== l.languageTag) throw new TypeError("Language maps unknown/incompatible module.");
    mapped.add(id);
  }
  if (mapped.size !== modules.size) throw new TypeError("Every module needs a language mapping.");
  const coverage = analyzeQuestionnaireLanguageCoverage({ definitions: q.definitions, modules: q.modules, languages: tree.languages,
    requestedFamilyIds: [...new Set(q.definitions.map(questionnaireFamilyId))] });
  if (!coverage.complete) throw new TypeError("Supply every questionnaire/form in every selected language.");
  validateQuestionnairePresentationV2(value.presentation, q.definitions);
  return value;
}
/** New dispatch only; existing v1 generic remains strict. */
export async function verifySupportedQuestionnaireRecipeContribution(value) {
  if (value?.version === 1) return validateQuestionnaireRecipeContributionV1(value);
  if (value?.version === 2) return validateQuestionnaireRecipeContributionV2(value);
  throw new TypeError("Unsupported P2 contribution version.");
}
export async function restoreQuestionnaireAuthoringV2(value) {
  const contribution = await validateQuestionnaireRecipeContributionV2(value);
  const { definitions, modules } = contribution.questionnaires;
  const families = [];
  for (const id of [...modules.map(m => m.questionnaireId), ...definitions.map(d => d.questionnaireId)]) {
    const d = definitions.find(d => d.questionnaireId === id), familyId = questionnaireFamilyId(d);
    if (!families.some(f => f.id === familyId)) families.push({ id: familyId, label: d.title });
  }
  const languages = contribution.languageSelection.languages.map(({ languageId, languageTag, label }) => ({ languageId, languageTag, label }));
  return { contribution, families, languages, coverage: analyzeQuestionnaireLanguageCoverage({ definitions, modules, languages, requestedFamilyIds: families.map(f => f.id) }) };
}
export async function compilePlannerQuestionnaireRoutesV2(value) {
  const contribution = await validateQuestionnaireRecipeContributionV2(value);
  const { definitions, modules } = contribution.questionnaires;
  const routes = enumerateLanguageRoutesV1(contribution.languageSelection).map(route => {
    const selected = route.questionnaireModuleIds.map(id => modules.find(m => m.moduleId === id));
    const place = kind => selected.filter(m => m.placement.kind === kind).map(module => ({ module: structuredClone(module),
      definition: structuredClone(definitions.find(d => d.questionnaireId === module.questionnaireId)),
      presentation: structuredClone(contribution.presentation.definitions.find(p => p.questionnaireId === module.questionnaireId)) }));
    return { languageId: route.languageId, languageTag: route.languageTag, optionIds: [...route.optionIds], beforeSession: place("beforeSession"), afterSession: place("afterSession") };
  });
  return { contribution, routes };
}

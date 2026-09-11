import { canonicalJson } from "./canonical.js";
import { validateLanguageSelectionTreeV1 } from "./experiment-package.js";
import { QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION } from "./external-protocol.js";
import { questionnaireFamilyId, analyzeQuestionnaireLanguageCoverage } from "./questionnaire-assets.js";
import { verifyQuestionnaireDefinitionV1, validateQuestionnaireModuleV2 } from "./questionnaires.js";

const clone = (value) => structuredClone(value);
function exact(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new TypeError(`${path} has missing or unknown fields.`);
  }
}

/** Internal P2 handoff, not a new file format. Preserve the existing wire owners. */
export async function validateQuestionnaireContribution(value) {
  value = clone(value);
  exact(value, ["questionnaires", "languageSelection"], "P2 contribution");
  const source = value.questionnaires;
  exact(source, ["algorithmVersion", "definitions", "modules"], "P2 questionnaires");
  if (source.algorithmVersion !== QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION) throw new TypeError("Unsupported questionnaire algorithm.");
  if (!Array.isArray(source.definitions) || source.definitions.length > 256
    || !Array.isArray(source.modules) || source.modules.length > 1024) throw new RangeError("Questionnaire contribution exceeds definition/module bounds.");
  const definitions = [];
  for (const definition of source.definitions) definitions.push(clone(await verifyQuestionnaireDefinitionV1(definition)));
  const byId = new Map(definitions.map(d => [d.questionnaireId, d]));
  if (byId.size !== definitions.length) throw new TypeError("Duplicate questionnaire definition ID.");
  const modules = source.modules.map(module => {
    const definition = byId.get(module.questionnaireId);
    if (!definition) throw new TypeError(`Unknown questionnaire ${module.questionnaireId}.`);
    // P3/P7 validate block/video existence; P2 validates the exact hook and hash.
    return clone(validateQuestionnaireModuleV2(module, { definition }));
  });
  const byModule = new Map(modules.map(m => [m.moduleId, m]));
  if (byModule.size !== modules.length) throw new TypeError("Duplicate questionnaire module ID.");
  const languageSelection = clone(validateLanguageSelectionTreeV1(value.languageSelection));
  const mapped = new Set();
  for (const language of languageSelection.languages) {
    for (const id of language.questionnaireModuleIds) {
      const module = byModule.get(id);
      const definition = module && byId.get(module.questionnaireId);
      if (!definition || (definition.language !== "und" && definition.language !== language.languageTag)) {
        throw new TypeError(`Language ${language.languageId} references an unknown or incompatible module ${id}.`);
      }
      mapped.add(id);
    }
  }
  if (modules.some(m => !mapped.has(m.moduleId))) throw new TypeError("Every questionnaire module needs an explicit language mapping.");
  const tags = new Set(languageSelection.languages.map(l => l.languageTag));
  if (definitions.some(d => d.language !== "und" && !tags.has(d.language))) throw new TypeError("Questionnaire language is absent from the language tree.");
  return { questionnaires: { algorithmVersion: source.algorithmVersion, definitions, modules }, languageSelection };
}

/** All checks finish before a caller replaces any editor state. */
export async function restoreQuestionnaireAuthoring(value) {
  const contribution = await validateQuestionnaireContribution(value);
  const { definitions, modules } = contribution.questionnaires;
  const slots = new Set();
  const families = [];
  for (const definition of definitions) {
    if (definition.language === "und") throw new TypeError("This historical questionnaire has no explicit language. Keep the recipe unchanged; supply an explicit language asset before editable restoration.");
    const id = questionnaireFamilyId(definition);
    const slot = `${id}/${definition.language}`;
    if (slots.has(slot)) throw new TypeError(`Multiple definitions occupy ${slot}; editable restoration needs an unambiguous family/language slot.`);
    slots.add(slot);
  }
  // Administration order takes precedence; retain unreferenced catalogue entries too.
  for (const id of [...modules.map(m => m.questionnaireId), ...definitions.map(d => d.questionnaireId)]) {
    const definition = definitions.find(d => d.questionnaireId === id);
    const familyId = questionnaireFamilyId(definition);
    if (!families.some(f => f.id === familyId)) families.push({ id: familyId, label: definition.title });
  }
  const languages = contribution.languageSelection.languages.map(({ languageId, languageTag, label }) => ({ languageId, languageTag, label }));
  return { contribution, families, languages,
    coverage: analyzeQuestionnaireLanguageCoverage({ definitions, modules, languages, requestedFamilyIds: families.map(f => f.id) }) };
}

/** Content edits never flatten an imported language tree or reorder its routes. */
export function reconcileQuestionnaireModuleMappings(tree, definitions, modules) {
  const result = clone(validateLanguageSelectionTreeV1(tree));
  const byId = new Map(definitions.map(d => [d.questionnaireId, d]));
  for (const language of result.languages) {
    const eligible = modules.filter(m => byId.get(m.questionnaireId)?.language === language.languageTag).map(m => m.moduleId);
    language.questionnaireModuleIds = [
      ...language.questionnaireModuleIds.filter(id => eligible.includes(id)),
      ...eligible.filter(id => !language.questionnaireModuleIds.includes(id)),
    ];
  }
  return validateLanguageSelectionTreeV1(result);
}

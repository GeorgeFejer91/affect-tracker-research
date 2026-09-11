import { createFlatLanguageSelectionV1 } from "./experiment-package.js";

export function updateQuestionnaireDefinitionReferences(modules, definition) {
  return modules.map((module) => module.questionnaireId === definition.questionnaireId
    ? { ...module, definitionSha256: definition.definitionSha256 }
    : module);
}

const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

const FAMILY_ALIASES = Object.freeze({
  "maia-2-en": "maia-2",
  "maia-2-de": "maia-2",
  "tas-20-en": "tas-20",
  "tas-20-de": "tas-20",
  "phencon-long-en": "phencon-long",
  "phencon-long-de": "phencon-long",
  "phencon-short-en": "phencon-short",
  "phencon-short-de": "phencon-short",
});

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${path} must be a lowercase identifier using letters, numbers, _ or -.`);
  }
  return value;
}

function languageTag(value, path) {
  if (typeof value !== "string" || !LANGUAGE_TAG.test(value)) {
    throw new TypeError(`${path} must be a BCP 47 language tag or und.`);
  }
  return value;
}

function label(value, path) {
  if (typeof value !== "string" || value.length < 1 || value.length > 120
    || value.normalize("NFC").trim() !== value || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${path} must be bounded, trimmed NFC text.`);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

export const STUDY_LANGUAGE_OPTIONS = deepFreeze([
  { languageId: "en", languageTag: "en", label: "English" },
  { languageId: "de", languageTag: "de", label: "Deutsch" },
  { languageId: "fr", languageTag: "fr", label: "Français" },
  { languageId: "es", languageTag: "es", label: "Español" },
  { languageId: "it", languageTag: "it", label: "Italiano" },
  { languageId: "pt", languageTag: "pt", label: "Português" },
  { languageId: "nl", languageTag: "nl", label: "Nederlands" },
  { languageId: "pl", languageTag: "pl", label: "Polski" },
  { languageId: "ja", languageTag: "ja", label: "日本語" },
  { languageId: "zh", languageTag: "zh", label: "中文" },
]);

export const DEFAULT_STUDY_LANGUAGES = deepFreeze([
  { languageId: "en", languageTag: "en", label: "English" },
]);

/**
 * Return the instrument family represented by one language-tagged definition.
 *
 * Known bundled IDs are explicit aliases. Other IDs lose only a terminal
 * suffix that exactly matches the definition's full or primary language tag.
 */
export function questionnaireFamilyId(definitionValue) {
  const definition = object(definitionValue, "questionnaire definition");
  const questionnaireId = identifier(
    definition.questionnaireId,
    "questionnaire definition.questionnaireId",
  );
  const definitionLanguage = languageTag(
    definition.language,
    "questionnaire definition.language",
  );
  if (Object.hasOwn(FAMILY_ALIASES, questionnaireId)) {
    return FAMILY_ALIASES[questionnaireId];
  }
  if (definitionLanguage.toLowerCase() === "und") return questionnaireId;

  const normalizedLanguage = definitionLanguage.toLowerCase();
  const primaryLanguage = normalizedLanguage.split("-")[0];
  const suffixes = [...new Set([normalizedLanguage, primaryLanguage])]
    .sort((left, right) => right.length - left.length);
  for (const suffix of suffixes) {
    const terminal = `-${suffix}`;
    if (questionnaireId.endsWith(terminal) && questionnaireId.length > terminal.length) {
      return questionnaireId.slice(0, -terminal.length);
    }
  }
  return questionnaireId;
}

function normalizeLanguages(languagesValue) {
  if (!Array.isArray(languagesValue) || languagesValue.length < 1 || languagesValue.length > 64) {
    throw new RangeError("languages must contain 1–64 selected study languages.");
  }
  const languageIds = new Set();
  const languageTags = new Set();
  return languagesValue.map((candidate, index) => {
    const source = object(candidate, `languages[${index}]`);
    const normalized = {
      languageId: identifier(source.languageId, `languages[${index}].languageId`),
      languageTag: languageTag(source.languageTag, `languages[${index}].languageTag`),
      label: label(source.label, `languages[${index}].label`),
    };
    if (languageIds.has(normalized.languageId)) {
      throw new TypeError(`languages contains duplicate languageId ${normalized.languageId}.`);
    }
    if (languageTags.has(normalized.languageTag)) {
      throw new TypeError(`languages contains duplicate languageTag ${normalized.languageTag}.`);
    }
    languageIds.add(normalized.languageId);
    languageTags.add(normalized.languageTag);
    return normalized;
  });
}

function normalizeDefinitions(definitionsValue) {
  if (!Array.isArray(definitionsValue)) throw new TypeError("definitions must be an array.");
  const questionnaireIds = new Set();
  return definitionsValue.map((candidate, index) => {
    const source = object(candidate, `definitions[${index}]`);
    const normalized = {
      questionnaireId: identifier(source.questionnaireId, `definitions[${index}].questionnaireId`),
      language: languageTag(source.language, `definitions[${index}].language`),
      definitionSha256: digest(
        source.definitionSha256,
        `definitions[${index}].definitionSha256`,
      ),
    };
    if (questionnaireIds.has(normalized.questionnaireId)) {
      throw new TypeError(`definitions contains duplicate questionnaireId ${normalized.questionnaireId}.`);
    }
    questionnaireIds.add(normalized.questionnaireId);
    return {
      ...normalized,
      familyId: questionnaireFamilyId(normalized),
    };
  });
}

function normalizeModules(modulesValue, definitions) {
  if (!Array.isArray(modulesValue)) throw new TypeError("modules must be an array.");
  const definitionById = new Map(definitions.map((definition) => [
    definition.questionnaireId,
    definition,
  ]));
  const moduleIds = new Set();
  return modulesValue.map((candidate, index) => {
    const source = object(candidate, `modules[${index}]`);
    const moduleId = identifier(source.moduleId, `modules[${index}].moduleId`);
    const questionnaireId = identifier(
      source.questionnaireId,
      `modules[${index}].questionnaireId`,
    );
    const definitionSha256 = digest(
      source.definitionSha256,
      `modules[${index}].definitionSha256`,
    );
    if (moduleIds.has(moduleId)) {
      throw new TypeError(`modules contains duplicate moduleId ${moduleId}.`);
    }
    moduleIds.add(moduleId);
    const definition = definitionById.get(questionnaireId);
    if (!definition) {
      throw new TypeError(`Module ${moduleId} references unknown questionnaire ${questionnaireId}.`);
    }
    if (definition.definitionSha256 !== definitionSha256) {
      throw new TypeError(
        `Module ${moduleId} does not match the definition hash for ${questionnaireId}.`,
      );
    }
    return { moduleId, questionnaireId, definitionSha256, definition };
  });
}

function normalizeRequestedFamilies(requestedFamilyIdsValue) {
  if (!Array.isArray(requestedFamilyIdsValue)) {
    throw new TypeError("requestedFamilyIds must be an array.");
  }
  const seen = new Set();
  return requestedFamilyIdsValue.map((candidate, index) => {
    const familyId = identifier(candidate, `requestedFamilyIds[${index}]`);
    if (seen.has(familyId)) {
      throw new TypeError(`requestedFamilyIds contains duplicate family ${familyId}.`);
    }
    seen.add(familyId);
    return familyId;
  });
}

function normalizeCoverageInput({
  definitions,
  modules,
  languages,
  requestedFamilyIds = [],
} = {}) {
  const normalizedLanguages = normalizeLanguages(languages);
  const normalizedDefinitions = normalizeDefinitions(definitions);
  const normalizedModules = normalizeModules(modules, normalizedDefinitions);
  const normalizedRequestedFamilies = normalizeRequestedFamilies(requestedFamilyIds);
  return {
    languages: normalizedLanguages,
    definitions: normalizedDefinitions,
    modules: normalizedModules,
    requestedFamilyIds: normalizedRequestedFamilies,
  };
}

function analyzeNormalizedCoverage(normalized) {
  const familyIds = [];
  const seenFamilies = new Set();
  for (const familyId of normalized.requestedFamilyIds) {
    seenFamilies.add(familyId);
    familyIds.push(familyId);
  }
  for (const module of normalized.modules) {
    const { familyId } = module.definition;
    if (!seenFamilies.has(familyId)) {
      seenFamilies.add(familyId);
      familyIds.push(familyId);
    }
  }

  const missing = [];
  const familyRows = familyIds.map((familyId) => {
    const familyModules = normalized.modules.filter((module) => (
      module.definition.familyId === familyId
    ));
    const languages = normalized.languages.map((language) => {
      const matchedModules = familyModules.filter((module) => (
        module.definition.language === language.languageTag
      ));
      const languageRow = {
        languageId: language.languageId,
        languageTag: language.languageTag,
        label: language.label,
        covered: matchedModules.length > 0,
        questionnaireIds: matchedModules.map((module) => module.questionnaireId),
        moduleIds: matchedModules.map((module) => module.moduleId),
      };
      if (!languageRow.covered) {
        missing.push({
          familyId,
          languageId: language.languageId,
          languageTag: language.languageTag,
          label: language.label,
        });
      }
      return languageRow;
    });
    return {
      familyId,
      languages,
      complete: languages.every((language) => language.covered),
    };
  });

  return deepFreeze({
    familyRows,
    missing,
    complete: missing.length === 0,
  });
}

/** Analyze whether every included questionnaire family covers every study language. */
export function analyzeQuestionnaireLanguageCoverage(input) {
  return analyzeNormalizedCoverage(normalizeCoverageInput(input));
}

/**
 * Build a flat language tree only after every included questionnaire family is
 * backed by a module that declares every selected language exactly. A shared
 * `und` definition remains valid legacy data, but cannot satisfy authoring
 * coverage because participants must receive an explicit language asset.
 */
export function createCoveredFlatLanguageSelectionV1(input) {
  const normalized = normalizeCoverageInput(input);
  const coverage = analyzeNormalizedCoverage(normalized);
  if (!coverage.complete) {
    const missingPairs = coverage.missing.map((entry) => (
      `${entry.familyId} / ${entry.label} (${entry.languageTag})`
    ));
    throw new TypeError(
      `Questionnaire assets are incomplete. Add a questionnaire file and module for: ${missingPairs.join("; ")}.`,
    );
  }
  return createFlatLanguageSelectionV1(normalized.languages.map((language) => ({
    ...language,
    questionnaireModuleIds: normalized.modules
      .filter((module) => (
        module.definition.language === language.languageTag
      ))
      .map((module) => module.moduleId),
  })));
}

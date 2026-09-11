import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STUDY_LANGUAGES,
  STUDY_LANGUAGE_OPTIONS,
  analyzeQuestionnaireLanguageCoverage,
  createCoveredFlatLanguageSelectionV1,
  questionnaireFamilyId,
} from "../site/src/research/questionnaire-assets.js";

const ENGLISH = { languageId: "en", languageTag: "en", label: "English" };
const GERMAN = { languageId: "de", languageTag: "de", label: "Deutsch" };

function definition(questionnaireId, language, hashCharacter) {
  return {
    questionnaireId,
    language,
    definitionSha256: hashCharacter.repeat(64),
  };
}

function module(moduleId, questionnaireDefinition) {
  return {
    moduleId,
    questionnaireId: questionnaireDefinition.questionnaireId,
    definitionSha256: questionnaireDefinition.definitionSha256,
  };
}

test("study-language defaults expose English and the supported authoring choices", () => {
  assert.deepEqual(DEFAULT_STUDY_LANGUAGES, [ENGLISH]);
  assert.deepEqual(
    STUDY_LANGUAGE_OPTIONS.map(({ languageTag }) => languageTag),
    ["en", "de", "fr", "es", "it", "pt", "nl", "pl", "ja", "zh"],
  );
  assert.equal(Object.isFrozen(DEFAULT_STUDY_LANGUAGES), true);
  assert.equal(Object.isFrozen(DEFAULT_STUDY_LANGUAGES[0]), true);
  assert.equal(Object.isFrozen(STUDY_LANGUAGE_OPTIONS), true);
});

test("questionnaireFamilyId recognizes bundled aliases and exact language suffixes", () => {
  assert.equal(questionnaireFamilyId({ questionnaireId: "maia-2-en", language: "en" }), "maia-2");
  assert.equal(questionnaireFamilyId({ questionnaireId: "tas-20-de", language: "de" }), "tas-20");
  assert.equal(
    questionnaireFamilyId({ questionnaireId: "phencon-short-de", language: "de" }),
    "phencon-short",
  );
  assert.equal(
    questionnaireFamilyId({ questionnaireId: "body-awareness-en-us", language: "en-US" }),
    "body-awareness",
  );
  assert.equal(
    questionnaireFamilyId({ questionnaireId: "shared-demographics", language: "und" }),
    "shared-demographics",
  );
});

test("analyzeQuestionnaireLanguageCoverage completes an English-only module", () => {
  const tasEnglish = definition("tas-20-en", "en", "a");
  const coverage = analyzeQuestionnaireLanguageCoverage({
    definitions: [tasEnglish],
    modules: [module("tas-before-session-en", tasEnglish)],
    languages: DEFAULT_STUDY_LANGUAGES,
  });

  assert.equal(coverage.complete, true);
  assert.deepEqual(coverage.missing, []);
  assert.deepEqual(coverage.familyRows.map(({ familyId }) => familyId), ["tas-20"]);
  assert.deepEqual(coverage.familyRows[0].languages[0].moduleIds, ["tas-before-session-en"]);
  assert.equal(Object.isFrozen(coverage), true);
  assert.equal(Object.isFrozen(coverage.familyRows[0].languages[0].moduleIds), true);
});

test("MAIA coverage requires and accepts separate English and German modules", () => {
  const maiaEnglish = definition("maia-2-en", "en", "a");
  const maiaGerman = definition("maia-2-de", "de", "b");
  const coverage = analyzeQuestionnaireLanguageCoverage({
    definitions: [maiaEnglish, maiaGerman],
    modules: [
      module("maia-before-session-en", maiaEnglish),
      module("maia-before-session-de", maiaGerman),
    ],
    languages: [ENGLISH, GERMAN],
  });

  assert.equal(coverage.complete, true);
  assert.deepEqual(
    coverage.familyRows[0].languages.map(({ languageTag, moduleIds }) => ({ languageTag, moduleIds })),
    [
      { languageTag: "en", moduleIds: ["maia-before-session-en"] },
      { languageTag: "de", moduleIds: ["maia-before-session-de"] },
    ],
  );
});

test("an English-only module reports German as a blocking missing asset", () => {
  const maiaEnglish = definition("maia-2-en", "en", "a");
  const input = {
    definitions: [maiaEnglish],
    modules: [module("maia-before-session-en", maiaEnglish)],
    languages: [ENGLISH, GERMAN],
  };
  const coverage = analyzeQuestionnaireLanguageCoverage(input);

  assert.equal(coverage.complete, false);
  assert.deepEqual(coverage.missing, [{
    familyId: "maia-2",
    languageId: "de",
    languageTag: "de",
    label: "Deutsch",
  }]);
  assert.throws(
    () => createCoveredFlatLanguageSelectionV1(input),
    /maia-2 \/ Deutsch \(de\)/u,
  );
});

test("a requested PhenCon family with no assets reports every selected language", () => {
  const coverage = analyzeQuestionnaireLanguageCoverage({
    definitions: [],
    modules: [],
    languages: [ENGLISH, GERMAN],
    requestedFamilyIds: ["phencon-short"],
  });

  assert.equal(coverage.complete, false);
  assert.deepEqual(
    coverage.missing.map(({ familyId, languageTag }) => `${familyId}:${languageTag}`),
    ["phencon-short:en", "phencon-short:de"],
  );
});

test("an und module cannot substitute for explicitly supplied language assets", () => {
  const demographics = definition("demographics", "und", "c");
  const input = {
    definitions: [demographics],
    modules: [module("demographics-before-session", demographics)],
    languages: [ENGLISH, GERMAN],
  };

  const coverage = analyzeQuestionnaireLanguageCoverage(input);
  assert.equal(coverage.complete, false);
  assert.deepEqual(
    coverage.missing.map(({ languageTag }) => languageTag),
    ["en", "de"],
  );
  assert.throws(() => createCoveredFlatLanguageSelectionV1(input), /demographics \/ English \(en\)/u);
});

test("covered flat trees retain module order and requested-then-module family order", () => {
  const sharedEnglish = definition("shared-context-en", "en", "a");
  const sharedGerman = definition("shared-context-de", "de", "d");
  const phenconGerman = definition("phencon-long-de", "de", "b");
  const phenconEnglish = definition("phencon-long-en", "en", "c");
  const modules = [
    module("phencon-de", phenconGerman),
    module("shared-en", sharedEnglish),
    module("phencon-en", phenconEnglish),
    module("shared-de", sharedGerman),
  ];
  const input = {
    definitions: [sharedEnglish, sharedGerman, phenconGerman, phenconEnglish],
    modules,
    languages: [ENGLISH, GERMAN],
    requestedFamilyIds: ["phencon-long"],
  };

  const coverage = analyzeQuestionnaireLanguageCoverage(input);
  assert.deepEqual(
    coverage.familyRows.map(({ familyId }) => familyId),
    ["phencon-long", "shared-context"],
  );
  const tree = createCoveredFlatLanguageSelectionV1(input);
  assert.deepEqual(tree.languages[0].questionnaireModuleIds, ["shared-en", "phencon-en"]);
  assert.deepEqual(tree.languages[1].questionnaireModuleIds, ["phencon-de", "shared-de"]);
});

test("coverage rejects unknown, hash-mismatched, and duplicate module references", () => {
  const tasEnglish = definition("tas-20-en", "en", "a");
  const base = { definitions: [tasEnglish], languages: [ENGLISH] };

  assert.throws(
    () => analyzeQuestionnaireLanguageCoverage({
      ...base,
      modules: [{
        moduleId: "missing",
        questionnaireId: "missing-en",
        definitionSha256: "b".repeat(64),
      }],
    }),
    /references unknown questionnaire missing-en/u,
  );
  assert.throws(
    () => analyzeQuestionnaireLanguageCoverage({
      ...base,
      modules: [{ ...module("tas", tasEnglish), definitionSha256: "b".repeat(64) }],
    }),
    /does not match the definition hash/u,
  );
  assert.throws(
    () => analyzeQuestionnaireLanguageCoverage({
      ...base,
      modules: [module("tas", tasEnglish), module("tas", tasEnglish)],
    }),
    /duplicate moduleId tas/u,
  );
  assert.throws(
    () => analyzeQuestionnaireLanguageCoverage({
      ...base,
      modules: [],
      languages: [ENGLISH, { languageId: "de", languageTag: "not a tag", label: "Deutsch" }],
    }),
    /BCP 47 language tag/u,
  );
});

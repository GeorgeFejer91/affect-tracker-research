import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { importSurveyJson, verifySurveyDefinition } from "../site/src/research/surveyjs-definition.js";
import { inspectSurveyJson, checkSurveyData, createSurveyModel, surveyJsonFromQuestionnaire } from "../site/src/research/surveyjs-engine.js";
import { createQuestionnairePresentationV3, validateQuestionnaireRecipeContributionV2 } from "../site/src/research/questionnaire-recipe-v2.js";
import { compilePlannerRecipeV4, serializePlannerRecipeV4, parseSupportedPlannerRecipe, parsePlannerRecipeV3, reconstructPlannerRecipeSelectionV4 } from "../site/src/research/planner-recipe.js";
import { controlledCore } from "./fixtures/planner-recipe-v3-fixture.js";
import { sheetFromDefinition, sheetToAuthoring } from "../site/src/research/form-sheet.js";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { questionnaireFamilyId } from "../site/src/research/questionnaire-assets.js";
import { legacySurveyPresentation } from "../site/src/research/surveyjs-legacy-presentation.js";

test("Node-generated SurveyJS JSON passes guarded CLI import and canonical source-save preparation", async () => {
  const editor = createQuestionnaireEditor({ root: { querySelector: () => null } });
  editor.sync({ families: [{ id: "custom", label: "Custom" }], languages: [{ languageId: "en", languageTag: "en", label: "English" }], definitions: [], modules: [], familyForDefinition: questionnaireFamilyId, locked: false });
  const bytes = new TextEncoder().encode(JSON.stringify({ elements: [{ type: "text", name: "answer" }] }, null, 2));
  const imported = await importSurveyJson(bytes, { questionnaireId: "custom-en", language: "en" });
  const guard = { isCurrent: () => true, signal: new AbortController().signal };
  const importPrepared = await editor.prepareAuthoringImport(imported, { ...guard, familyId: "custom", language: "en", sourceBytes: bytes });
  importPrepared.commit(); importPrepared.afterCommit();
  const save = await editor.prepareAuthoringQuestionnaireSave("custom-en", guard);
  assert.equal(save.payload.sourceFormat, "surveyJsDefinitionV1");
  assert.equal(new TextDecoder().decode(save.payload.sourceBytes), canonicalJson(imported.definition) + "\n");
  save.commit({ stored: true }); save.afterCommit();
  assert.equal(editor.isPending("custom", "en"), false);
});

const survey = { title: { default: "Custom questionnaire", de: "Eigener Fragebogen" }, pages: [
  { name: "first", elements: [{ type: "boolean", name: "details", title: { default: "Add details?", de: "Details hinzufügen?" } }] },
  { name: "second", visibleIf: "{details} = true", elements: [{ type: "comment", name: "explanation" }, { type: "checkbox", name: "choices", choices: ["a", "b", "c"], validators: [{ type: "answercount", minCount: 2 }] }] },
] };

test("pretty-printed builder and Node.js JSON retain exact content, source identity and language", async () => {
  const { definition } = await importSurveyJson(JSON.stringify(survey, null, 2), { questionnaireId: "custom-de", language: "de", basename: "node-generated.json" });
  assert.equal(definition.title, "Eigener Fragebogen");
  assert.deepEqual(definition.surveyJson, survey);
  assert.equal(definition.source.basename, "node-generated.json");
  assert.deepEqual(await verifySurveyDefinition(definition), definition);
  const model = createSurveyModel(survey, { language: "de" });
  assert.equal(model.title, "Eigener Fragebogen"); assert.equal(model.getQuestionByName("details").title, "Details hinzufügen?"); model.dispose();
  const saved = await sheetToAuthoring(sheetFromDefinition(definition, { familyId: "custom" }));
  assert.deepEqual(saved.definition, definition);
  const changed = structuredClone(definition); changed.surveyJson.pages.reverse();
  await assert.rejects(verifySurveyDefinition(changed), /hash/u);
  await assert.rejects(importSurveyJson('{"elements":[],"elements":[]}', { questionnaireId: "custom-en", language: "en" }));
});

test("SurveyJS owns pages, branching and validators while every visible input remains mandatory", () => {
  assert.equal(checkSurveyData(survey, { data: { details: false }, complete: true }).valid, true);
  assert.throws(() => checkSurveyData(survey, { data: {}, complete: true }));
  assert.throws(() => checkSurveyData(survey, { data: { details: true, explanation: "text", choices: ["a"] }, complete: true }));
  const data = { details: true, explanation: "text", choices: ["a", "b"] };
  assert.deepEqual(checkSurveyData(survey, { data, complete: true }).data, data);
  assert.throws(() => checkSurveyData(survey, { data: { ...data, unexpected: "not a question" } }));
  assert.throws(() => checkSurveyData(survey, { data: { ...data, choices: ["invented"] } }));
  assert.equal(checkSurveyData(survey, { data: { details: true } }).valid, false);
  assert.deepEqual(checkSurveyData(survey, { data: { details: false } }).visibleQuestionNames, ["details"]);
});

test("native replay retains SurveyJS calculations, nested answers, randomization and completion cleanup", () => {
  const definition = { clearInvisibleValues: "onComplete", elements: [
    { type: "boolean", name: "show" }, { type: "text", name: "hidden", visibleIf: "{show} = true" },
    { type: "paneldynamic", name: "rows", templateElements: [{ type: "text", name: "value", requiredIf: "false" }] },
    { type: "expression", name: "total", expression: "sumInArray({rows}, 'value')" },
    { type: "radiogroup", name: "random", choicesOrder: "random", choices: ["a", "b", "c", "d", "e"] },
  ] };
  assert.throws(() => checkSurveyData(definition, { data: { show: false, rows: [{}], random: "b" }, complete: true }));
  const checked = checkSurveyData(definition, { data: { show: false, hidden: "discard on completion", rows: [{ value: 2 }, { value: 3 }], random: "b" }, complete: true, randomSeed: 12, evaluatedAtUnixMs: 1789250000000 });
  assert.equal(checked.data.hidden, undefined); assert.equal(checked.data.total, 5);
  const first = createSurveyModel(definition, { randomSeed: 12 }), second = createSurveyModel(definition, { randomSeed: 12 });
  assert.deepEqual(first.getQuestionByName("random").visibleChoices.map(c => c.value), second.getQuestionByName("random").visibleChoices.map(c => c.value));
  first.dispose(); second.dispose();
});

test("the full library accepts standard builder controls including nested forms, media, files and signature", () => {
  const elements = [
    { type: "text", name: "text" }, { type: "comment", name: "comment" }, { type: "boolean", name: "boolean" },
    ...["radiogroup", "checkbox", "dropdown", "tagbox", "ranking", "buttongroup"].map(type => ({ type, name: type, choices: ["one", "two"] })),
    { type: "rating", name: "rating" }, { type: "slider", name: "slider" }, { type: "expression", name: "calc", expression: "1+1" },
    { type: "matrix", name: "matrix", rows: ["r1", "r2"], columns: ["c1", "c2"] },
    { type: "matrixdropdown", name: "matrixdropdown", rows: ["r1"], columns: [{ name: "col", cellType: "text" }] },
    { type: "matrixdynamic", name: "matrixdynamic", columns: [{ name: "col", cellType: "text" }] },
    { type: "multipletext", name: "multipletext", items: [{ name: "field" }] },
    { type: "paneldynamic", name: "paneldynamic", templateElements: [{ type: "text", name: "nested" }] },
    { type: "panel", name: "panel", elements: [{ type: "text", name: "inside" }] },
    { type: "imagepicker", name: "imagepicker", choices: [{ value: "image", imageLink: "data:image/png;base64,aA==" }] },
    { type: "image", name: "image", imageLink: "data:image/png;base64,aA==" },
    { type: "html", name: "html", html: "<p>Instructions</p>" },
    { type: "file", name: "file", storeDataAsText: true }, { type: "signaturepad", name: "signaturepad" },
  ];
  assert.ok(inspectSurveyJson({ elements }).questionTypes.includes("signaturepad"));
  assert.throws(() => inspectSurveyJson({ elements: [{ type: "my-custom-widget", name: "custom" }] }));
  assert.throws(() => inspectSurveyJson({ elements: [{ type: "dropdown", name: "remote", choicesByUrl: { url: "https://example.com" } }] }), /external/u);
});

test("master4 wraps full SurveyJS JSON and restores all language routes without widening master3", async () => {
  const { core } = await controlledCore(); core.version = 4;
  const p2 = core.segments.P2; p2.version = 3; p2.questionnaires.algorithmVersion = "questionnaire-hooks-v4";
  const replacements = new Map();
  p2.questionnaires.definitions = await Promise.all(p2.questionnaires.definitions.map(async old => {
    const { definition } = await importSurveyJson(JSON.stringify(survey), { questionnaireId: old.questionnaireId, language: old.language });
    replacements.set(old.questionnaireId, definition); return definition;
  }));
  for (const module of p2.questionnaires.modules) module.definitionSha256 = replacements.get(module.questionnaireId).definitionSha256;
  p2.presentation = createQuestionnairePresentationV3(p2.questionnaires.definitions);
  await assert.rejects(validateQuestionnaireRecipeContributionV2(p2));
  const recipe = await compilePlannerRecipeV4(core), bytes = new TextEncoder().encode(await serializePlannerRecipeV4(recipe));
  assert.deepEqual((await parseSupportedPlannerRecipe(bytes)).recipe, recipe);
  await assert.rejects(parsePlannerRecipeV3(bytes));
  assert.deepEqual(recipe.segments.P2.questionnaires.definitions[0].surveyJson, survey);
});

test("existing instrument rendering retains exact prompts, option IDs, labels, language and instructions", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/questionnaire-recipe-v1.json", import.meta.url), "utf8"));
  const candidates = fixture.questionnaires?.definitions ?? fixture.definitions ?? fixture.valid?.questionnaires?.definitions;
  assert.ok(candidates?.length);
  for (const d of candidates) {
    const json = surveyJsonFromQuestionnaire(d);
    assert.equal(json.locale, d.language); assert.equal(json.description, d.instructions);
    assert.deepEqual(json.elements.map(q => q.name), d.items.map(i => i.itemId));
    for (const [index, q] of json.elements.entries()) assert.deepEqual(q.choices, d.items[index].options.map(o => ({ value: o.optionId, text: o.label })));
  }
});

test("saved repeated-label layouts round-trip legacy item IDs and row-specific option codes", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/questionnaire-recipe-v1.json", import.meta.url), "utf8"));
  for (const d of fixture.questionnaires.definitions) for (const repeatLabelsEvery of [1, 5, 10]) {
    const adapter = legacySurveyPresentation(d, { repeatLabelsEvery });
    const answers = Object.fromEntries(d.items.map((item, i) => [item.itemId, item.options[i % item.options.length].optionId]));
    const data = adapter.toData(answers);
    const model = createSurveyModel(adapter.json, { language: d.language, data });
    assert.equal(model.validate(false, false), true);
    assert.deepEqual(adapter.fromData(model.data), answers);
    model.dispose();
    assert.deepEqual(adapter.fromData(adapter.toData({})), {});
  }
});

test("typed integer adapter accepts zero and rejects fractional ages through SurveyJS", async () => {
  const recipe = JSON.parse(await readFile(new URL("./fixtures/runner-master-v2-owner.canonical.json", import.meta.url), "utf8"));
  const d = recipe.segments.P2.questionnaires.definitions.find(d => d.questionnaireId === "demographics-en");
  const model = createSurveyModel(surveyJsonFromQuestionnaire(d), { data: { fullName: "Fictitious person", age: 0, gender: "preferNotToSay", handedness: "ambidextrous" } });
  assert.equal(model.validate(false, false), true);
  model.setValue("age", 1.5); assert.equal(model.validate(false, false), false);
  model.setValue("age", -1); assert.equal(model.validate(false, false), false);
  model.setValue("age", 30); assert.equal(model.validate(false, false), true);
  model.dispose();
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importQuestionnaireAuthoring } from "../site/src/research/questionnaire-authoring.js";
import { demographicsFormDraft } from "../site/src/research/form-assets.js";
import { surveyDraftFromDefinition, changeSurveyElement, surveyElements, appendSurveyElements, addSurveyPage } from "../site/src/research/surveyjs-builder.js";
import { surveySheetFromDefinition, surveySheetToAuthoring, prepareSurveySourceStorage } from "../site/src/research/surveyjs-sheet.js";
import { checkSurveyData } from "../site/src/research/surveyjs-engine.js";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { questionnaireFamilyId } from "../site/src/research/questionnaire-assets.js";

for (const language of ["en", "de"]) test(`MAIA-2 ${language} converts to raw SurveyJS without losing wording, codes or source`, async () => {
  const source = new Uint8Array(await readFile(new URL(`../site/questionnaires/maia-2-${language}.csv`, import.meta.url)));
  const { definition } = await importQuestionnaireAuthoring(source, { sourceKind: "bundled", logicalName: `maia-2-${language}.csv` });
  const draft = surveyDraftFromDefinition(definition), saved = await surveySheetToAuthoring(surveySheetFromDefinition(draft, { familyId: "maia-2" }));
  const payload = await prepareSurveySourceStorage(saved.sourceBytes, saved.definition), raw = JSON.parse(new TextDecoder().decode(payload.bytes));
  assert.equal(raw.schema, undefined); assert.equal(raw.surveyJson, undefined);
  assert.equal(raw.elements.length, 37);
  assert.deepEqual(raw.affectResearch.provenance, definition.provenance ?? null);
  assert.deepEqual(raw.affectResearch.source, definition.source ?? null);
  assert.equal(raw.affectResearch.sourceDefinitionSha256, definition.definitionSha256);
  const data = {};
  definition.items.forEach((item, i) => {
    const question = raw.elements[i]; assert.equal(question.name, item.itemId); assert.equal(question.title, item.prompt);
    assert.deepEqual(question.choices, item.options.map(o => ({ value: o.optionId, text: o.label })));
    assert.deepEqual(question.affectResearchResponseCodes, Object.fromEntries(item.options.map(o => [o.optionId, o.scoreValue])));
    assert.equal(raw.affectResearch.items[i].subscale, item.subscale ?? null);
    data[item.itemId] = item.options[0].optionId;
  });
  assert.deepEqual(checkSurveyData(raw, { language, data, complete: true }).data, data);
});

test("demographic SurveyJS keeps zero, integer validation and UTF-8 text bounds", async () => {
  const definition = demographicsFormDraft("en"), raw = surveyDraftFromDefinition(definition).surveyJson;
  const data = Object.fromEntries(definition.items.map(item => [item.itemId, item.response.kind === "text" ? "Fictitious" : item.response.kind === "integer" ? 0 : item.response.options[0].optionId]));
  assert.equal(checkSurveyData(raw, { data, complete: true }).valid, true);
  const integer = definition.items.find(item => item.response.kind === "integer");
  assert.throws(() => checkSurveyData(raw, { data: { ...data, [integer.itemId]: 1.5 }, complete: true }));
  const text = definition.items.find(item => item.response.kind === "text");
  assert.throws(() => checkSurveyData(raw, { data: { ...data, [text.itemId]: "🌻".repeat(Math.floor(text.response.maxUtf8Bytes / 4) + 1) }, complete: true }));
});

test("arrangement preserves imported logic, nested panels, translations and identities", () => {
  const json = { locale: "de", pages: [{ name: "intro", elements: [{ type: "boolean", name: "yes", title: "Yes" },
    { type: "panel", name: "details", visibleIf: "{yes} = true", elements: [{ type: "text", name: "answer", title: { default: "Answer", de: "Antwort" } }] }] }] };
  const edited = changeSurveyElement(json, ["pages", 0, "elements", 1, "elements", 0], "title", "Neue Antwort");
  assert.equal(edited.pages[0].elements[1].elements[0].title.default, "Answer");
  assert.equal(edited.pages[0].elements[1].visibleIf, "{yes} = true");
  const next = changeSurveyElement(addSurveyPage(edited), ["pages", 0, "elements", 1], "page", 1);
  assert.equal(next.pages[1].elements[0].name, "details");
  assert.deepEqual(surveyElements(next).map(item => item.element.name), ["yes", "details", "answer"]);
  assert.throws(() => appendSurveyElements(next, [{ type: "text", name: "yes" }]));
  assert.equal(json.pages.length, 1); assert.equal(json.pages[0].elements[1].elements[0].title.de, "Antwort");
});

test("production authoring mode saves both preset and demographics as SurveyJS", async () => {
  const saved = [], editor = createQuestionnaireEditor({ root: { querySelector: () => null }, authorSurveyJs: true, onSave: async value => { saved.push(value); return { stored: true }; } });
  editor.sync({ families: [{ id: "demographics", label: "Demographics" }, { id: "maia-2", label: "MAIA-2" }], languages: [{ languageId: "en", languageTag: "en", label: "English" }], definitions: [], familyForDefinition: questionnaireFamilyId, locked: false });
  const source = new Uint8Array(await readFile(new URL("../site/questionnaires/maia-2-en.csv", import.meta.url)));
  const imported = await importQuestionnaireAuthoring(source, { logicalName: "maia-2-en.csv" });
  assert.equal(editor.loadDefinition(imported.definition, { familyId: "maia-2" }), true);
  for (const key of ["demographics/en", "maia-2/en"]) await editor.save(key);
  assert.equal(saved.length, 2);
  for (const payload of saved) {
    assert.equal(payload.definition.schema, "affect-research-surveyjs-definition");
    const stored = await prepareSurveySourceStorage(payload.sourceBytes, payload.definition);
    assert.equal(new TextDecoder().decode(stored.bytes), canonicalJson(payload.definition.surveyJson) + "\n");
  }
  assert.ok(editor.readAuthoringEntries().every(entry => entry.sheet.kind === "surveyjs" && !entry.dirty));
});


test("arranging a localized survey preserves every title translation at save", async () => {
  const draft = surveyDraftFromDefinition(demographicsFormDraft("en"));
  draft.surveyJson.title = { default: "Original", en: "English", de: "Deutsch" };
  const sheet = surveySheetFromDefinition(draft, { familyId: "demographics" });
  sheet.definition.surveyJson = changeSurveyElement(sheet.definition.surveyJson, ["elements", 0], "down");
  sheet.modified = true;
  const saved = await surveySheetToAuthoring(sheet);
  assert.deepEqual(saved.definition.surveyJson.title, draft.surveyJson.title);
  sheet.title = "Changed English";
  const renamed = await surveySheetToAuthoring(sheet);
  assert.deepEqual(renamed.definition.surveyJson.title, { default: "Original", en: "Changed English", de: "Deutsch" });
});

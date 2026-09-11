import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { createQuestionnaireSheet, setSheetCell, sheetToAuthoring } from "../site/src/research/questionnaire-sheet.js";
import { updateQuestionnaireDefinitionReferences } from "../site/src/research/questionnaire-assets.js";

const context = (languages = ["en"]) => ({
  families: [{ id: "custom", label: "Custom" }],
  languages: languages.map((languageTag) => ({ languageTag, label: languageTag })),
  definitions: [], familyForDefinition: () => "custom", locked: false,
});
async function definition(prompt) {
  const sheet = createQuestionnaireSheet({ familyId: "custom", language: "en", title: "Custom", rowCount: 1, optionCount: 2 });
  setSheetCell(sheet, 0, 0, prompt);
  return (await sheetToAuthoring(sheet)).definition;
}
const editor = (onSave = async () => {}) => createQuestionnaireEditor({
  root: { querySelector: () => null }, onSave,
});

test("P2 frozen snapshot reads the full package catalogue rather than the participant settings subset", async () => {
  const source = await readFile(new URL("../site/src/research/app.js", import.meta.url), "utf8");
  const snapshot = source.slice(source.indexOf("function getQuestionnaireContributionSnapshot()"), source.indexOf("async function restoreQuestionnaireContribution("));
  assert.match(snapshot, /const source = coverageSource\(\)/u);
  assert.match(snapshot, /definitions: structuredClone\(source.definitions\)/u);
  assert.match(snapshot, /modules: structuredClone\(source.modules\)/u);
});

test("editing one definition updates every reference without changing hooks, targets or order", () => {
  const modules = [
    { moduleId: "a", questionnaireId: "custom-en", definitionSha256: "old", placement: { kind: "afterStimulus", stimulusId: "v1", relativeToIsi: "after" } },
    { moduleId: "b", questionnaireId: "other-en", definitionSha256: "other", placement: { kind: "beforeSession" } },
    { moduleId: "c", questionnaireId: "custom-en", definitionSha256: "old", placement: { kind: "afterSession" } },
  ];
  const before = structuredClone(modules);
  const result = updateQuestionnaireDefinitionReferences(modules, { questionnaireId: "custom-en", definitionSha256: "new" });
  assert.deepEqual(modules, before);
  assert.deepEqual(result.map((m) => m.definitionSha256), ["new", "other", "new"]);
  assert.deepEqual(result.map(({ definitionSha256, ...rest }) => rest), before.map(({ definitionSha256, ...rest }) => rest));
});

test("removed and re-added questionnaire slots start fresh, with no stale saved/draft receipt", async () => {
  const subject = editor();
  subject.sync(context());
  subject.loadDefinition(await definition("Old draft"), { familyId: "custom" });
  assert.equal(subject.canLoadPreset("custom", "en"), false);
  subject.sync({ ...context(), families: [] });
  assert.deepEqual(subject.pendingKeys(), []);
  subject.sync(context());
  assert.equal(subject.canLoadPreset("custom", "en"), true);
  assert.equal(subject.isPending("custom", "en"), true);
});

test("adding a language or finishing a delayed preset cannot replace an existing draft", async () => {
  let saved;
  const subject = editor(async (receipt) => { saved = receipt.definition; });
  subject.sync(context());
  assert.equal(subject.canLoadPreset("custom", "en"), true);
  const draft = await definition("Researcher draft");
  subject.loadDefinition(draft, { familyId: "custom" });
  subject.sync(context(["en", "de"]));
  assert.equal(subject.canLoadPreset("custom", "en"), false);
  assert.equal(subject.canLoadPreset("custom", "de"), true);
  assert.equal(subject.loadDefinition(await definition("Late preload"), { familyId: "custom", onlyIfPristine: true }), false);
  await subject.save("custom/en");
  assert.equal(saved.items[0].prompt, "Researcher draft");
});

test("app integration uses preservation and guards preset adoption after asynchronous loading", async () => {
  const source = await readFile(new URL("../site/src/research/app.js", import.meta.url), "utf8");
  const save = source.slice(source.indexOf("async function saveEditedQuestionnaire"), source.indexOf("function addBlankQuestionnaire"));
  assert.match(save, /updateQuestionnaireDefinitionReferences\(questionnaireModules, definition\)/u);
  assert.doesNotMatch(save, /\.placement\s*=/u);
  assert.match(source, /onlyIfPristine: true/u);
  assert.match(source, /if \(loaded && capabilities\.directoryPermission\)/u);
  assert.equal((save.match(/questionnaireEditor\.presetToken\(familyId, language\) !== expectedPresetToken/gu) ?? []).length, 2);
});

test("a delayed preset cannot adopt into a removed and re-added pristine slot", async () => {
  const subject = editor(); subject.sync(context());
  const oldToken = subject.presetToken("custom", "en");
  subject.sync({ ...context(), families: [] }); subject.sync(context());
  assert.notEqual(subject.presetToken("custom", "en"), oldToken);
  assert.equal(subject.loadDefinition(await definition("Stale"), {
    familyId: "custom", onlyIfPristine: true, expectedPresetToken: oldToken,
  }), false);
  assert.equal(subject.canLoadPreset("custom", "en"), true);
});

test("removing a slot during save preparation does not call the asset store for its replacement", async () => {
  let stores = 0;
  const subject = editor(async () => { stores++; }); subject.sync(context());
  subject.loadDefinition(await definition("Old"), { familyId: "custom" });
  const saving = subject.save("custom/en");
  subject.sync({ ...context(), families: [] }); subject.sync(context());
  await saving;
  assert.equal(stores, 0);
  assert.equal(subject.canLoadPreset("custom", "en"), true);
});

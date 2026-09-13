import test from "node:test";
import assert from "node:assert/strict";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { questionnaireRecipeFixture } from "./fixtures/questionnaire-recipe-fixture.js";
import { createQuestionnairePresentationV1 } from "../site/src/research/questionnaire-recipe.js";
import { typedOwner, op, guard } from "./fixtures/p2-typed-owner.js";
import { questionnaireFamilyId } from "../site/src/research/questionnaire-assets.js";

async function content(version) {
  if (version === 2) {
    const s = await typedOwner(); await s.apply([op("addDemographics")]);
    for (const language of ["en", "de"]) await s.editor.saveAuthoringQuestionnaire(`demographics-${language}`, guard());
    return s.contribution();
  }
  const value = await questionnaireRecipeFixture();
  return { ...value, presentation: createQuestionnairePresentationV1(value.questionnaires.definitions, [5, 10]) };
}
function fixture() {
  let renders = 0, changes = 0;
  const container = { set innerHTML(_) { renders++; }, querySelectorAll: () => [], addEventListener() {} };
  const editor = createQuestionnaireEditor({ root: { querySelector: key => key === "#questionnaire-sheet-list" ? container : null }, onChange() { changes++; }, onSave() { throw new Error("No storage during restore"); } });
  return { editor, get renders() { return renders; }, get changes() { return changes; } };
}
for (const version of [1, 2]) test(`P2 v${version} restores exact definitions and presentation with separate state publication`, async () => {
  const value = await content(version), ui = fixture(), renders = ui.renders;
  const prepared = await ui.editor.prepareRestoreRecipe(value, guard());
  assert.deepEqual(ui.editor.readAuthoringEntries(), []);
  assert.equal(ui.renders, renders); assert.equal(ui.changes, 0);
  const detached = prepared.restored; detached.families[0].label = "Caller modification";
  assert.notEqual(prepared.restored.families[0].label, detached.families[0].label);
  assert.throws(() => prepared.afterCommit());
  assert.equal(prepared.commit(), undefined);
  assert.equal(ui.renders, renders); assert.equal(ui.changes, 0);
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit());
  assert.deepEqual(ui.editor.getPresentation(value.questionnaires.definitions), value.presentation);
  assert.deepEqual(ui.editor.pendingKeys(), []);
  for (const d of value.questionnaires.definitions) {
    const saved = await ui.editor.prepareAuthoringQuestionnaireSave(d.questionnaireId, guard());
    assert.deepEqual(saved.payload.definition, d);
  }
  prepared.afterCommit(); assert.equal(ui.renders, renders + 1); assert.equal(ui.changes, 1);
  prepared.afterCommit(); assert.equal(ui.changes, 1);
});

test("reopen creates fresh tokens and does not carry previous source bytes", async () => {
  const value = await content(1), ui = fixture();
  let prepared = await ui.editor.prepareRestoreRecipe(value, guard()); prepared.commit(); prepared.afterCommit();
  const d = value.questionnaires.definitions[0], familyId = questionnaireFamilyId(d);
  const oldToken = ui.editor.presetToken(familyId, d.language);
  ui.editor.loadDefinition(d, { familyId, sourceBytes: new Uint8Array([1, 2, 3]) });
  prepared = await ui.editor.prepareRestoreRecipe(value, guard()); prepared.commit();
  assert.notEqual(ui.editor.presetToken(familyId, d.language), oldToken);
  assert.equal(ui.editor.canLoadPreset(familyId, d.language), false);
  assert.equal(ui.editor.loadDefinition(d, { familyId, expectedPresetToken: oldToken }), false);
  const saved = await ui.editor.prepareAuthoringQuestionnaireSave(d.questionnaireId, guard());
  assert.equal(saved.payload.sourceBytes, null);
});

for (const change of ["reset", "cancel", "preset", "presentation", "lock"]) test(`P2 prepared reopen fences ${change}`, async () => {
  const value = await content(1), ui = fixture(), controller = new AbortController();
  let initial = await ui.editor.prepareRestoreRecipe(value, guard()); initial.commit(); initial.afterCommit();
  const prepared = await ui.editor.prepareRestoreRecipe(value, { signal: controller.signal, isCurrent: () => true });
  const restored = prepared.restored;
  if (change === "reset") ui.editor.reset();
  if (change === "cancel") controller.abort();
  if (change === "preset") { const d = value.questionnaires.definitions[0]; ui.editor.loadDefinition(d, { familyId: questionnaireFamilyId(d) }); }
  if (change === "presentation") ui.editor.restorePresentation(value.presentation, value.questionnaires.definitions);
  if (change === "lock") ui.editor.sync({ families: restored.families, languages: restored.languages, definitions: restored.contribution.questionnaires.definitions, familyForDefinition: questionnaireFamilyId, locked: true });
  const renders = ui.renders;
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit());
  assert.equal(ui.renders, renders);
});

test("invalid content and reset during asynchronous verification cannot install any prefix", async () => {
  const ui = fixture(), value = await content(2);
  const invalid = structuredClone(value); invalid.presentation.definitions.pop();
  await assert.rejects(ui.editor.prepareRestoreRecipe(invalid, guard()));
  const pending = ui.editor.prepareRestoreRecipe(value, guard()); ui.editor.reset();
  await assert.rejects(pending, /changed while reopening/);
  assert.deepEqual(ui.editor.readAuthoringEntries(), []);
});

test("prepared reopen fences source-byte drift and an overlapping save", async () => {
  const value = await content(1), ui = fixture(), d = value.questionnaires.definitions[0];
  let prepared = await ui.editor.prepareRestoreRecipe(value, guard()); prepared.commit();
  const bytes = new Uint8Array([1, 2, 3]);
  ui.editor.loadDefinition(d, { familyId: questionnaireFamilyId(d), sourceBytes: bytes });
  prepared = await ui.editor.prepareRestoreRecipe(value, guard()); bytes[0] = 9;
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit());
  const saving = ui.editor.saveAuthoringQuestionnaire(d.questionnaireId, guard());
  await assert.rejects(ui.editor.prepareRestoreRecipe(value, guard()), /changed while reopening/);
  await assert.rejects(saving);
});

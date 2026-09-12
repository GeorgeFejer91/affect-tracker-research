import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { importQuestionnaireAuthoring } from "../site/src/research/questionnaire-authoring.js";
import { questionnaireFamilyId } from "../site/src/research/questionnaire-assets.js";

async function fixture(format = "csv") {
  const bytes = new Uint8Array(await readFile(new URL(`../site/questionnaires/questionnaire-template.${format}`, import.meta.url)));
  const imported = await importQuestionnaireAuthoring(bytes, { logicalName: `questionnaire-template.${format}` });
  const familyId = questionnaireFamilyId(imported.definition), language = imported.definition.language;
  let renders = 0, changes = 0;
  const container = { set innerHTML(_) { renders++; }, querySelectorAll: () => [], addEventListener() {} };
  const editor = createQuestionnaireEditor({ root: { querySelector: key => key === "#questionnaire-sheet-list" ? container : null }, onChange() { changes++; } });
  const context = { families: [{ id: familyId, label: "Imported table" }], languages: [{ languageTag: language, languageId: "lang-en", label: "English" }], definitions: [], locked: false, familyForDefinition: questionnaireFamilyId };
  editor.sync(context);
  const controller = new AbortController();
  const options = { familyId, language, sourceBytes: bytes, isCurrent: () => true, signal: controller.signal };
  return { editor, imported, bytes, context, options, controller, get renders() { return renders; }, get changes() { return changes; } };
}
for (const format of ["csv", "txt", "json"]) test(`prepared ${format} import preserves exact bytes and importer receipt through save`, async () => {
  const f = await fixture(format), before = f.editor.readAuthoringEntries(), renders = f.renders;
  const prepared = await f.editor.prepareAuthoringImport(f.imported, f.options);
  assert.deepEqual(f.editor.readAuthoringEntries(), before); assert.equal(f.renders, renders); assert.equal(f.changes, 0);
  assert.equal(prepared.questionnaireId, f.imported.definition.questionnaireId);
  assert.throws(() => prepared.afterCommit());
  assert.equal(prepared.commit(), undefined); assert.equal(f.renders, renders); assert.equal(f.changes, 0);
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit());
  const save = await f.editor.prepareAuthoringQuestionnaireSave(prepared.questionnaireId, f.options);
  assert.deepEqual(save.payload.definition, f.imported.definition);
  assert.deepEqual(save.payload.sourceBytes, f.bytes);
  assert.deepEqual(save.payload.authoringReceipt, f.imported.authoringReceipt);
  assert.equal(f.editor.canLoadPreset(f.options.familyId, f.options.language), false);
  prepared.afterCommit(); prepared.afterCommit(); assert.equal(f.renders, renders + 1); assert.equal(f.changes, 1);
});

test("prepared import snapshots caller bytes and rejects mismatched source or slot", async () => {
  const f = await fixture(), original = f.bytes.slice();
  const pending = f.editor.prepareAuthoringImport(f.imported, f.options); f.bytes.fill(0);
  const prepared = await pending; prepared.commit();
  assert.deepEqual((await f.editor.prepareAuthoringQuestionnaireSave(prepared.questionnaireId, f.options)).payload.sourceBytes, original);
  for (const change of [options => options.familyId = "wrong", options => options.language = "de", options => options.sourceBytes = new Uint8Array([1, 2])]) {
    const current = await fixture(); change(current.options);
    await assert.rejects(current.editor.prepareAuthoringImport(current.imported, current.options));
    assert.equal(current.editor.canLoadPreset(questionnaireFamilyId(current.imported.definition), "en"), true);
  }
});
for (const change of ["reset", "cancel", "lock", "preset", "duringAwait"]) test(`prepared import fences ${change}`, async () => {
  const f = await fixture();
  const pending = f.editor.prepareAuthoringImport(f.imported, f.options);
  if (change === "duringAwait") { f.editor.reset(); await assert.rejects(pending); return; }
  const prepared = await pending;
  if (change === "reset") f.editor.reset();
  if (change === "cancel") f.controller.abort();
  if (change === "lock") f.editor.sync({ ...f.context, locked: true });
  if (change === "preset") f.editor.loadDefinition(f.imported.definition, { familyId: f.options.familyId });
  const renders = f.renders;
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.commit()); assert.equal(f.renders, renders);
});

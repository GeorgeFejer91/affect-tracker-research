import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerAuthoringP2 } from "../site/src/research/planner-authoring-p2.js";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { questionnaireFamilyId } from "../site/src/research/questionnaire-assets.js";
import { sheetToAuthoring } from "../site/src/research/questionnaire-sheet.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { questionnaireRecipeFixture } from "./fixtures/questionnaire-recipe-fixture.js";

const set = (field, value) => ({ kind: "set", field: `P2.${field}`, value });
const op = (operation, args) => ({ kind: "operation", owner: "P2", operation, arguments: args });
const guard = () => ({ signal: new AbortController().signal, isCurrent: () => true });
async function fixture() {
  const recipe = await questionnaireRecipeFixture();
  let context = { families: [{ id: "custom-study", label: "Study" }],
    languages: recipe.languageSelection.languages.map(({ questionnaireModuleIds: _ids, ...language }) => language),
    definitions: structuredClone(recipe.questionnaires.definitions), modules: structuredClone(recipe.questionnaires.modules),
    languageSelection: structuredClone(recipe.languageSelection), locked: false };
  let saves = 0, commits = 0;
  const editor = createQuestionnaireEditor({ root: { querySelector: () => null }, onSave: async () => { saves++; } });
  editor.sync({ ...context, familyForDefinition: questionnaireFamilyId });
  editor.restorePresentation(recipe.presentation, context.definitions);
  const adapter = createPlannerAuthoringP2({ editor, readContext: () => context,
    commitContext: value => { context = structuredClone(value); commits++; } });
  return { adapter, editor, recipe, get context() { return context; }, get saves() { return saves; }, get commits() { return commits; } };
}
async function apply(subject, edits) {
  const staged = await subject.adapter.stage(edits, guard());
  assert.equal(staged.isCurrent(), true); assert.equal(staged.commit(), undefined);
  return subject.adapter.read();
}
test("P2 catalogue classifies every group and reads detached actual editor drafts without changing source", async () => {
  const s = await fixture(), read = s.adapter.read();
  assert.deepEqual(Object.keys(read.values).sort(), s.adapter.settings.map(field => field.id).sort());
  assert.equal(s.adapter.settings.filter(field => field.writable).length, 5);
  assert.equal(s.adapter.operations.length, 13);
  assert.deepEqual(read.issues, []);
  read.values["P2.questionnaires"][0].items[0].prompt = "outside mutation";
  assert.equal(s.adapter.read().values["P2.questionnaires"][0].items[0].prompt, "Study item 1");
  assert.deepEqual((await sheetToAuthoring(s.editor.readAuthoringEntries()[0].sheet)).definition, s.recipe.questionnaires.definitions[0]);
  assert.equal(s.saves, 0); assert.equal(s.commits, 0);
});
test("P2 defers rendering and observers until the shared afterCommit phase", async () => {
  const s = await fixture(); let rendered = 0, notified = 0;
  const editor = { readAuthoringEntries: s.editor.readAuthoringEntries,
    prepareAuthoringEntries(records, context) {
      const candidate = s.editor.prepareAuthoringEntries(records, context);
      return { commit: candidate.commit, afterCommit() { rendered++; candidate.afterCommit(); } };
    } };
  const adapter = createPlannerAuthoringP2({ editor, readContext: () => s.context,
    commitContext: context => Object.assign(s.context, context), onCommit: () => { notified++; } });
  const staged = await adapter.stage([set("presentation", adapter.read().values["P2.presentation"])], guard());
  staged.commit(); staged.commit();
  assert.equal(rendered, 0); assert.equal(notified, 0); assert.equal(staged.isCurrent(), false);
  staged.afterCommit(); assert.equal(rendered, 1); assert.equal(notified, 1);
});
test("ordered metadata/item/option edits retain identities, provenance, German content and pending state", async () => {
  const s = await fixture(), before = s.adapter.read();
  const en = before.values["P2.questionnaires"][0], row = en.items[0];
  const modified = structuredClone(row); modified.prompt = "Edited"; modified.required = false; modified.subscale = "Provided";
  const staged = await s.adapter.stage([
    op("updateQuestionnaire", { questionnaireId: en.questionnaireId, changes: { title: "Title", instructions: "Instructions", attribution: "Source", questionnaireVersion: "2" } }),
    op("setItem", { questionnaireId: en.questionnaireId, itemId: row.itemId, item: modified }),
    op("setOption", { questionnaireId: en.questionnaireId, itemId: row.itemId, optionId: row.options[0].optionId, label: "Label", scoreValue: -12.25 }),
    op("reorderOptions", { questionnaireId: en.questionnaireId, itemId: row.itemId, optionIds: row.options.map(o => o.optionId).reverse() }),
    op("reorderItems", { questionnaireId: en.questionnaireId, itemIds: en.items.map(i => i.itemId).reverse() }),
  ], guard());
  assert.deepEqual(s.adapter.read(), before); staged.commit();
  const after = s.adapter.read(), edited = after.values["P2.questionnaires"][0];
  assert.equal(edited.title, "Title"); assert.equal(edited.instructions, "Instructions"); assert.equal(edited.attribution, "Source");
  assert.equal(edited.questionnaireVersion, "2"); assert.equal(edited.items[1].prompt, "Edited");
  assert.equal(edited.items[1].required, false); assert.equal(edited.items[1].subscale, "Provided");
  assert.equal(edited.items[1].options[1].scoreValue, -12.25); assert.equal(edited.items[1].options[1].label, "Label");
  assert.deepEqual(after.values["P2.questionnaires"][1], before.values["P2.questionnaires"][1]);
  assert.deepEqual(after.values["P2.acceptedDefinitions"], before.values["P2.acceptedDefinitions"]);
  assert.ok(after.issues.some(i => i.code === "unsaved_draft")); assert.equal(s.saves, 0);
  const generated = await sheetToAuthoring(s.editor.readAuthoringEntries()[0].sheet);
  assert.equal(generated.definition.source.sourceDocumentSha256, s.recipe.questionnaires.definitions[0].source.sha256);
  assert.notEqual(generated.definition.definitionSha256, s.recipe.questionnaires.definitions[0].definitionSha256);
});
test("all five writable groups support read/edit/readback without manufacturing acceptance", async () => {
  const s = await fixture(), original = s.adapter.read().values;
  const questionnaires = structuredClone(original["P2.questionnaires"]); questionnaires[0].title = "Updated whole draft";
  await apply(s, [set("questionnaires", questionnaires)]);
  assert.equal(s.adapter.read().values["P2.questionnaires"][0].title, "Updated whole draft");
  const languages = structuredClone(original["P2.languages"]); languages[0].label = "English study";
  const tree = structuredClone(original["P2.languageSelection"]); tree.languages[0].label = "English study";
  tree.nodes[0].prompt = "Choose study"; tree.nodes[1].options.reverse();
  tree.languages[0].questionnaireModuleIds.reverse();
  const modules = structuredClone(original["P2.modules"]); modules[0].placement.kind = "afterSession";
  const presentation = original["P2.presentation"].map(p => ({ ...p, repeatLabelsEvery: 10 }));
  await apply(s, [set("languages", languages), set("languageSelection", tree), set("modules", modules), set("presentation", presentation)]);
  const result = s.adapter.read().values;
  assert.deepEqual(result["P2.languages"], languages); assert.deepEqual(result["P2.languageSelection"], tree);
  assert.deepEqual(result["P2.modules"], modules); assert.deepEqual(result["P2.presentation"], presentation);
  assert.equal(s.saves, 0);
});
test("new/removed family and language slots use the actual blank owner and retain missing coverage", async () => {
  const s = await fixture();
  await apply(s, [op("addQuestionnaire", { familyId: "custom-extra", title: "Extra", optionCount: 3, rowCount: 1 })]);
  let read = s.adapter.read(); assert.equal(read.values["P2.questionnaires"].length, 4);
  assert.ok(read.issues.some(i => i.code === "missing_language_asset"));
  const id = "custom-extra-en", item = { itemId: "new-item", prompt: "Prompt", required: true, subscale: null,
    options: [{ optionId: "a", label: "A", scoreValue: null }, { optionId: "b", label: "B", scoreValue: null }] };
  await apply(s, [op("addItem", { questionnaireId: id, item, beforeItemId: null }),
    op("removeItem", { questionnaireId: id, itemId: "item-001" })]);
  assert.deepEqual(s.adapter.read().values["P2.questionnaires"].find(d => d.questionnaireId === id).items, [item]);
  await apply(s, [set("languages", [...s.context.languages, { languageId: "fr", languageTag: "fr", label: "Français" }])]);
  assert.equal(s.editor.readAuthoringEntries().length, 6);
  assert.ok(s.adapter.validate().some(i => i.code === "missing_language_asset"));
  await apply(s, [op("removeQuestionnaire", { familyId: "custom-extra" })]);
  assert.equal(s.editor.readAuthoringEntries().length, 3);
});
test("invalid raw numeric and required values remain visible, block source save, and can be repaired", async () => {
  const s = await fixture(), original = s.adapter.read().values["P2.questionnaires"];
  const drafts = structuredClone(original); drafts[0].items[0].options[0].scoreValue = "=SUM(A1:A2)";
  drafts[0].items[0].required = "perhaps"; drafts[0].optionCount = "";
  await apply(s, [set("questionnaires", drafts)]);
  const read = s.adapter.read();
  assert.equal(read.values["P2.questionnaires"][0].items[0].options[0].scoreValue, "=SUM(A1:A2)");
  assert.equal(read.values["P2.questionnaires"][0].items[0].required, "perhaps");
  assert.equal(read.values["P2.questionnaires"][0].optionCount, "");
  assert.ok(read.issues.some(i => i.code === "invalid_draft"));
  await s.editor.save("custom-study/en"); assert.equal(s.saves, 0);
  await apply(s, [set("questionnaires", original)]);
  assert.equal(s.editor.readAuthoringEntries()[0].invalid.length, 0);
  assert.equal(s.editor.readAuthoringEntries()[0].rawOptionCount, null);
  assert.ok(!s.adapter.validate().some(i => i.code === "invalid_draft"));
});
test("presentation and module-order edits preserve scientific source bytes and dirty flags", async () => {
  const s = await fixture(), before = s.adapter.read();
  const presentation = before.values["P2.presentation"].map(value => ({ ...value, repeatLabelsEvery: 1 }));
  const moduleIds = before.values["P2.modules"].map(m => m.moduleId).reverse();
  await apply(s, [set("presentation", presentation), op("reorderModules", { moduleIds })]);
  assert.deepEqual(s.editor.pendingKeys(), []);
  assert.deepEqual(s.adapter.read().values["P2.modules"].map(m => m.moduleId), moduleIds);
  assert.deepEqual(s.adapter.read().values["P2.acceptedDefinitions"], before.values["P2.acceptedDefinitions"]);
  const generated = await sheetToAuthoring(s.editor.readAuthoringEntries()[0].sheet);
  assert.deepEqual(generated.definition, s.recipe.questionnaires.definitions[0]);
  assert.equal(s.saves, 0);
});
test("option-count-only edit is dirty and retains heterogeneous per-item options", async () => {
  const s = await fixture();
  await apply(s, [op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { optionCount: 3 } })]);
  assert.equal(s.adapter.read().values["P2.questionnaires"][0].optionCount, 3);
  assert.ok(s.editor.isPending("custom-study", "en"));
});
test("malformed, unknown, forbidden, out-of-bound and duplicate operations reject atomically", async () => {
  const s = await fixture(), before = s.adapter.read();
  for (const bad of [set("acceptedDefinitions", []), set("unknown", true), set("presentation", []),
    set("languages", []), set("languageSelection", {}), set("modules", [s.context.modules[0], s.context.modules[0]]),
    op("sourceImport", { path: "private" }), op("removeItem", { questionnaireId: "custom-study-en", itemId: "missing" }),
    op("reorderItems", { questionnaireId: "custom-study-en", itemIds: ["same", "same"] }),
    op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { optionCount: 100 } }),
    op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { source: {} } }),
    set("questionnaires", [...before.values["P2.questionnaires"], before.values["P2.questionnaires"][0]]),
    set("modules", [{ ...s.context.modules[0], extra: true }]),
    JSON.parse('{"kind":"set","field":"P2.questionnaires","value":{"__proto__":{}}}'),
    set("questionnaires", NaN),
  ]) {
    await assert.rejects(s.adapter.stage([op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { title: "Must not leak" } }), bad], guard()));
    assert.deepEqual(s.adapter.read(), before);
  }
  assert.equal(s.commits, 0); assert.equal(s.saves, 0);
});
test("staging snapshots caller edits and fences cancellation, GUI edits and dependency/context drift", async () => {
  const s = await fixture();
  const edits = [op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { title: "Captured" } })];
  const pending = s.adapter.stage(edits, guard()); edits[0].arguments.changes.title = "Late mutation";
  const staged = await pending; assert.equal(staged.isCurrent(), true); staged.commit();
  assert.equal(s.adapter.read().values["P2.questionnaires"][0].title, "Captured");
  const controller = new AbortController(), before = s.adapter.read();
  const aborted = s.adapter.stage([set("presentation", before.values["P2.presentation"])], { isCurrent: () => true, signal: controller.signal });
  controller.abort(); await assert.rejects(aborted, /superseded/);
  assert.deepEqual(s.adapter.read(), before);
  const prepared = await s.adapter.stage([set("presentation", before.values["P2.presentation"])], guard());
  s.context.languages[0].label = "Changed outside CLI";
  assert.equal(prepared.isCurrent(), false);
  const stagedEdit = s.adapter.stage([set("presentation", before.values["P2.presentation"])], guard());
  s.editor.loadDefinition(s.recipe.questionnaires.definitions[0], { familyId: "custom-study" });
  await assert.rejects(stagedEdit, /superseded/);
  await assert.rejects(s.adapter.stage([set("presentation", before.values["P2.presentation"])], { signal: new AbortController().signal, isCurrent: () => false }), /stale/);
});

test("real shared session reads exact P2 fields, preserves retries and fences the whole multi-owner batch", async () => {
  const s = await fixture();
  const session = createPlannerAuthoringSession({ owners: [s.adapter] });
  const request = (action, expectedRevision = null) => ({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision, action });
  const catalogue = await session.execute(request({ kind: "catalogue" }));
  assert.equal(catalogue.status, "ok"); assert.equal(catalogue.result.settings.length, 7);
  const read = await session.execute(request({ kind: "get", field: "P2.questionnaires" }));
  assert.deepEqual(read.result.value, s.adapter.read().values["P2.questionnaires"]);
  const mutation = request({ kind: "apply", edits: [op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { title: "CLI title" } })] }, 0);
  const result = await session.execute(mutation);
  assert.equal(result.status, "incomplete"); assert.equal(result.revision, 1);
  assert.equal(s.adapter.read().values["P2.questionnaires"][0].title, "CLI title");
  assert.deepEqual(await session.execute(mutation), result); assert.equal(s.commits, 1);
  assert.equal((await session.execute(request(set("presentation", []), 1))).status, "rejected");
  session.registerOwner({ id: "P3", settings: [], operations: [{ id: "changeDependency" }],
    read: () => ({ values: {}, issues: [] }), validate: () => [],
    async stage() { s.context.languages[0].label = "Later owner changed a P2 dependency"; return { commit() { assert.fail("stale batch committed"); } }; } });
  const both = await session.execute(request({ kind: "apply", edits: [
    op("updateQuestionnaire", { questionnaireId: "custom-study-en", changes: { title: "Must not apply" } }),
    { kind: "operation", owner: "P3", operation: "changeDependency", arguments: {} },
  ] }, 1));
  assert.equal(both.status, "rejected"); assert.equal(both.issues[0].code, "stale_revision");
  assert.equal(s.adapter.read().values["P2.questionnaires"][0].title, "CLI title");
  assert.equal(s.commits, 1); assert.equal(s.saves, 0);
  session.destroy();
});

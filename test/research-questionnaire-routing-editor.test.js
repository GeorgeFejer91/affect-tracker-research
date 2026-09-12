import test from "node:test";
import assert from "node:assert/strict";
import { questionnaireRoutingEdits, questionnaireRoutingSnapshot } from "../site/src/research/questionnaire-routing-editor.js";
import { createPlannerAuthoringP2 } from "../site/src/research/planner-authoring-p2.js";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
import { questionnaireFamilyId } from "../site/src/research/questionnaire-assets.js";
import { questionnaireRecipeFixture } from "./fixtures/questionnaire-recipe-fixture.js";
import { enumerateLanguageRoutesV1 } from "../site/src/research/experiment-package.js";

async function fixture(onSave = async () => null) {
  const recipe = await questionnaireRecipeFixture();
  const context = { families: [{ id: "custom-study", label: "Study" }], locked: false,
    languages: recipe.languageSelection.languages.map(({ questionnaireModuleIds: _ids, ...language }) => language),
    definitions: recipe.questionnaires.definitions, modules: recipe.questionnaires.modules, languageSelection: recipe.languageSelection };
  const editor = createQuestionnaireEditor({ root: { querySelector: () => null }, onSave });
  editor.sync({ ...context, familyForDefinition: questionnaireFamilyId });
  const adapter = createPlannerAuthoringP2({ editor, readContext: () => context, commitContext: next => Object.assign(context, next) });
  async function act(action) {
    const edits = questionnaireRoutingEdits(context, action);
    if (edits.length) {
      const candidate = await adapter.stage(edits, { isCurrent: () => true, signal: new AbortController().signal });
      assert.equal(candidate.isCurrent(), true); candidate.commit(); candidate.afterCommit();
    }
  }
  return { context, editor, adapter, act };
}
test("routing UI produces owner edits with exact tree topology and stable scientific source", async () => {
  const s = await fixture(), source = structuredClone(s.context.definitions);
  await s.act({ kind: "node-id", nodeId: "group", value: "start" });
  await s.act({ kind: "node-prompt", nodeId: "start", value: "Select study" });
  await s.act({ kind: "option-label", nodeId: "start", optionId: "both", value: "Language options" });
  await s.act({ kind: "option-id", nodeId: "start", optionId: "both", value: "choose" });
  await s.act({ kind: "wrap-route", nodeId: "language", optionId: "en" });
  const child = s.context.languageSelection.nodes.find(n => n.nodeId.startsWith("question-"));
  await s.act({ kind: "option-parent", nodeId: "language", optionId: "de", value: child.nodeId });
  await s.act({ kind: "option-move", nodeId: child.nodeId, optionId: "de", direction: -1 });
  await s.act({ kind: "node-move", nodeId: child.nodeId, direction: -1 });
  await s.act({ kind: "remove-node", nodeId: child.nodeId });
  await s.act({ kind: "wrap-root" });
  await s.act({ kind: "remove-node", nodeId: s.context.languageSelection.rootNodeId });
  assert.equal(s.context.languageSelection.rootNodeId, "start");
  assert.equal(enumerateLanguageRoutesV1(s.context.languageSelection).length, 2);
  assert.deepEqual(s.context.definitions, source);
  assert.deepEqual(s.editor.pendingKeys(), []);
});
test("routing UI keeps terminal order distinct from module order and supports placement and references", async () => {
  const s = await fixture(), hashes = s.context.definitions.map(d => d.definitionSha256);
  await s.act({ kind: "module-id", moduleId: "en-0", value: "english-start" });
  await s.act({ kind: "module-placement", moduleId: "english-start", value: "afterSession" });
  await s.act({ kind: "module-move", moduleId: "english-start", direction: 1 });
  assert.deepEqual(s.context.languageSelection.languages[0].questionnaireModuleIds, ["english-start", "en-1"]);
  await s.act({ kind: "route-move", languageId: "en", value: "en-1", direction: -1 });
  await s.act({ kind: "route-remove", languageId: "en", value: "en-1" });
  assert.ok(s.adapter.validate().some(i => i.code === "invalid_route"));
  await s.act({ kind: "route-add", languageId: "en", value: "en-1" });
  await s.act({ kind: "module-add", value: "custom-study-en" });
  const added = s.context.modules.at(-1).moduleId;
  await s.act({ kind: "module-definition", moduleId: added, value: "custom-study-de" });
  assert.ok(!s.context.languageSelection.languages[0].questionnaireModuleIds.includes(added));
  assert.ok(s.context.languageSelection.languages[1].questionnaireModuleIds.includes(added));
  await s.act({ kind: "module-remove", moduleId: added });
  assert.deepEqual(s.adapter.validate(), []);
  assert.deepEqual(s.context.definitions.map(d => d.definitionSha256), hashes);
});
test("language controls retain roster/tree correspondence and never manufacture translations", async () => {
  const s = await fixture();
  await s.act({ kind: "language-label", languageId: "en", value: "English study" });
  await s.act({ kind: "language-id", languageId: "en", value: "english" });
  await s.act({ kind: "language-move", languageId: "english", direction: 1 });
  assert.equal(s.context.languages[1].label, "English study");
  await s.act({ kind: "language-tag", languageId: "english", value: "fr" });
  assert.ok(s.adapter.validate().some(i => i.code === "missing_language_asset"));
  assert.equal(s.context.definitions.length, 1);
  assert.ok(s.editor.readAuthoringEntries().find(r => r.sheet.language === "fr").sheet.rows.every(row => !row.prompt));
  s.context.languageSelection = null;
  assert.equal(questionnaireRoutingSnapshot(s.context).languageSelection.languages.length, 2);
});
test("invalid graph, identity, cross-language and placement gestures reject without owner changes", async () => {
  const s = await fixture(), before = structuredClone(s.context);
  const actions = [
    { kind: "node-id", nodeId: "group", value: "language" },
    { kind: "option-parent", nodeId: "group", optionId: "both", value: "language" },
    { kind: "module-placement", moduleId: "en-0", value: "beforeTrial" },
    { kind: "module-id", moduleId: "en-0", value: "de-0" },
    { kind: "route-add", languageId: "de", value: "en-0" },
    { kind: "route-add", languageId: "en", value: "en-0" },
    { kind: "language-label", languageId: "en", value: "" },
  ];
  for (const action of actions) assert.throws(() => questionnaireRoutingEdits(s.context, action));
  assert.deepEqual(s.context, before);
  assert.throws(() => questionnaireRoutingEdits({ ...s.context, locked: true }, { kind: "wrap-root" }), /locked/u);
});
test("consequential save returns the real callback receipt and checks cancellation before dispatch", async () => {
  let dispatched = 0;
  const receipt = { saved: true, sourceSha256: "test-only-receipt" };
  const s = await fixture(async (_payload, guard) => { dispatched++; assert.equal(guard.isCurrent(), true); return receipt; });
  const signal = new AbortController();
  const result = await s.editor.saveAuthoringQuestionnaire("custom-study-en", { isCurrent: () => true, signal: signal.signal });
  assert.deepEqual(result.sourceReceipt, receipt); assert.equal(dispatched, 1);
  signal.abort();
  await assert.rejects(s.editor.saveAuthoringQuestionnaire("custom-study-en", { isCurrent: () => true, signal: signal.signal }), e => e.code === "canceled");
  assert.equal(dispatched, 1);
});
test("save reports a retained storage receipt when cancellation arrives after dispatch", async () => {
  const signal = new AbortController(), receipt = { stored: true };
  const s = await fixture(async () => { signal.abort(); return receipt; });
  await assert.rejects(s.editor.saveAuthoringQuestionnaire("custom-study-en", { isCurrent: () => true, signal: signal.signal }),
    error => error.code === "canceled" && error.sourceReceipt === receipt);
});
test("reset during asynchronous save preparation prevents native dispatch", async () => {
  let dispatched = 0;
  const s = await fixture(async () => { dispatched++; });
  const save = s.editor.saveAuthoringQuestionnaire("custom-study-en", { isCurrent: () => true, signal: new AbortController().signal });
  s.editor.reset();
  await assert.rejects(save, error => error.code === "stale_revision");
  assert.equal(dispatched, 0);
});

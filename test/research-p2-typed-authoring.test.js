import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { typedOwner, op, guard } from "./fixtures/p2-typed-owner.js";
import { loadDemographicsForm } from "../site/src/research/form-assets.js";
import { compilePlannerQuestionnaireRoutesV2, validateQuestionnaireRecipeContributionV2, restoreQuestionnaireAuthoringV2 } from "../site/src/research/questionnaire-recipe-v2.js";
import { validateQuestionnaireRecipeContribution } from "../site/src/research/questionnaire-recipe.js";
import { questionnaireRoutingEdits } from "../site/src/research/questionnaire-routing-editor.js";
import { editFormField } from "../site/src/research/form-sheet-view.js";
import { formDraft } from "../site/src/research/form-sheet.js";
test("shipped EN/DE bytes match frozen fixtures and unsupported languages reject", async () => {
  for (const language of ["en", "de"]) {
    assert.deepEqual(await readFile(new URL(`../site/assets/questionnaires/demographics/${language}.json`, import.meta.url)), await readFile(new URL(`./fixtures/demographics-${language}-form-v1.canonical.json`, import.meta.url)));
    assert.equal((await loadDemographicsForm(language)).language, language);
  }
  await assert.rejects(loadDemographicsForm("fr"));
});
test("UI add gesture and CLI create the same detached drafts; save produces mixed P2 v2 without changing legacy content", async () => {
  const a = await typedOwner(), b = await typedOwner();
  const before = a.adapter.read();
  const staged = await a.adapter.stage(questionnaireRoutingEdits(a.context, { kind: "add-demographics" }), guard());
  assert.deepEqual(a.adapter.read(), before); staged.commit(); staged.afterCommit();
  await b.apply([op("addDemographics")]);
  assert.deepEqual(a.adapter.read(), b.adapter.read()); assert.equal(a.saved.length, 0);
  for (const language of ["en", "de"]) await a.editor.saveAuthoringQuestionnaire(`demographics-${language}`, guard());
  const value = await a.contribution(), compiled = await compilePlannerQuestionnaireRoutesV2(value);
  assert.deepEqual(value.questionnaires.definitions.slice(0, 2), a.legacy.questionnaires.definitions);
  assert.ok(compiled.routes.every(r => r.beforeSession[0].definition.questionnaireId === `demographics-${r.languageTag}`));
  assert.ok(compiled.routes.every(r => r.beforeSession[0].presentation.kind === "fields" && r.beforeSession[1].presentation.kind === "likert"));
  assert.equal((await restoreQuestionnaireAuthoringV2(value)).coverage.complete, true);
  await assert.rejects(validateQuestionnaireRecipeContribution(value));
});
test("shared field edit matches CLI typed item and malformed item rejects without changing state", async () => {
  const s = await typedOwner(); await s.apply([op("addDemographics")]);
  const record = s.editor.readAuthoringEntries()[0]; editFormField(record, "1:min", "2");
  await s.apply([op("setFormItem", { questionnaireId: record.sheet.questionnaireId, itemId: "age", item: record.sheet.rows[1] })]);
  assert.deepEqual(s.adapter.read().values["P2.questionnaires"][0], formDraft(record.sheet));
  const before = s.adapter.read(), item = structuredClone(record.sheet.rows[1]); item.response.max = "100";
  await assert.rejects(s.apply([op("setFormItem", { questionnaireId: record.sheet.questionnaireId, itemId: "age", item })]));
  assert.deepEqual(s.adapter.read(), before);
});
test("P2 v2 rejects stale presentation, incomplete coverage, wrong routes and invalid definition dispatch", async () => {
  const s = await typedOwner(); await s.apply([op("addDemographics")]);
  for (const language of ["en", "de"]) await s.editor.saveAuthoringQuestionnaire(`demographics-${language}`, guard());
  const original = await s.contribution();
  for (const mutate of [v => v.version = 1, v => v.questionnaires.algorithmVersion = "questionnaire-hooks-v2",
    v => v.presentation.definitions.reverse(), v => v.presentation.definitions.at(-1).kind = "likert",
    v => v.questionnaires.definitions.at(-1).version = 2, v => v.questionnaires.modules[0].definitionSha256 = "0".repeat(64),
    v => v.languageSelection.languages[0].questionnaireModuleIds.unshift("form-de"),
    v => v.questionnaires.definitions.push(v.questionnaires.definitions[0])]) {
    const candidate = structuredClone(original); mutate(candidate); await assert.rejects(validateQuestionnaireRecipeContributionV2(candidate));
  }
});

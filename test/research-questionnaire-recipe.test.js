import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { validateQuestionnaireContribution } from "../site/src/research/questionnaire-contribution.js";
import { validateQuestionnaireRecipeContributionV1, validateQuestionnaireRecipeContribution,
  createQuestionnairePresentationV1, questionnairePresentationGroups } from "../site/src/research/questionnaire-recipe.js";
import { questionnaireRecipeFixture } from "./fixtures/questionnaire-recipe-fixture.js";

test("shared Rust/JavaScript fixture matches generated content and fixed canonical digest", async () => {
  const source = await readFile(new URL("./fixtures/questionnaire-recipe-v1.json", import.meta.url), "utf8");
  const value = await questionnaireRecipeFixture();
  assert.equal(source, `${canonicalJson(value)}\n`);
  assert.equal(await canonicalSha256(value), "ac7ef132eb5896794dfbef833b5a94e1a56a67d89fdd2854f1d84f3ff6da4d89");
});

test("P2 successor preserves complete scientific content, nested routes and independently labelled presentation", async () => {
  const value = await questionnaireRecipeFixture();
  const snapshot = structuredClone(value);
  const validated = await validateQuestionnaireRecipeContributionV1(value);
  assert.deepEqual(validated, snapshot);
  assert.equal(await validateQuestionnaireRecipeContribution(value), true);
  validated.presentation.definitions[0].repeatLabelsEvery = 1;
  assert.deepEqual(value, snapshot);
  for (const definition of value.questionnaires.definitions) {
    assert.equal(definition.items[0].options[1].scoreValue, -2.5);
    assert.equal(definition.items[1].options[0].scoreValue, null);
    assert.equal(definition.items[1].required, false);
  }
  await assert.rejects(validateQuestionnaireContribution(value), /missing or unknown/);
});

test("successor rejects unsupported, incomplete, stale, reordered and unbound presentation without repairs", async () => {
  const value = await questionnaireRecipeFixture();
  for (const mutate of [
    c => { delete c.presentation; }, c => { c.unknown = true; }, c => { c.version = 2; },
    c => { c.schema = "wrong"; }, c => { c.presentation.version = 2; }, c => { c.presentation.unknown = true; },
    c => { c.presentation.definitions.pop(); }, c => { c.presentation.definitions.push(c.presentation.definitions[0]); },
    c => { c.presentation.definitions.reverse(); }, c => { c.presentation.definitions[1] = c.presentation.definitions[0]; },
    c => { c.presentation.definitions[0].questionnaireId = "missing"; },
    c => { c.presentation.definitions[0].definitionSha256 = "0".repeat(64); },
    c => { c.presentation.definitions[0].repeatLabelsEvery = "5"; },
    c => { c.presentation.definitions[0].repeatLabelsEvery = 0; },
    c => { c.presentation.definitions[0].repeatLabelsEvery = 1.5; },
    c => { c.presentation.definitions[0].repeatLabelsEvery = Infinity; },
    c => { c.presentation.definitions[0].extra = false; },
    c => { c.questionnaires.definitions[0].items[0].prompt = "tampered"; },
    c => { c.questionnaires.modules[0].definitionSha256 = "0".repeat(64); },
    c => { c.languageSelection.languages[0].questionnaireModuleIds = ["de-0"]; },
    c => { c.questionnaires.definitions.pop(); c.presentation.definitions.pop();
      c.questionnaires.modules = c.questionnaires.modules.filter(m => m.questionnaireId.endsWith("-en"));
      c.languageSelection.languages[1].questionnaireModuleIds = []; },
  ]) {
    const candidate = structuredClone(value); mutate(candidate);
    await assert.rejects(validateQuestionnaireRecipeContributionV1(candidate));
    await assert.rejects(validateQuestionnaireRecipeContribution(candidate));
  }
  assert.deepEqual(value, await questionnaireRecipeFixture());
});

test("validation snapshots every companion value before asynchronous definition verification", async () => {
  const value = await questionnaireRecipeFixture();
  const expected = structuredClone(value);
  const result = validateQuestionnaireRecipeContributionV1(value);
  value.presentation.definitions[0].repeatLabelsEvery = 1;
  value.questionnaires.definitions[0].items[0].prompt = "later caller mutation";
  assert.deepEqual(await result, expected);
});

test("label grouping matches explicit repetition and heterogeneous participant labels, never codes", async () => {
  const { questionnaires: { definitions: [definition] } } = await questionnaireRecipeFixture();
  definition.items = Array.from({ length: 12 }, () => structuredClone(definition.items[0]));
  definition.items[1].options[0].scoreValue = -99;
  assert.deepEqual(questionnairePresentationGroups(definition, 5), [{ start: 0, end: 5 }, { start: 5, end: 10 }, { start: 10, end: 12 }]);
  assert.equal(questionnairePresentationGroups(definition, 1).length, 12);
  assert.deepEqual(questionnairePresentationGroups(definition, 10), [{ start: 0, end: 10 }, { start: 10, end: 12 }]);
  definition.items[2].options[0].label = "Different visible label";
  assert.deepEqual(questionnairePresentationGroups(definition, 5), [{ start: 0, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 8 }, { start: 8, end: 12 }]);
  assert.throws(() => questionnairePresentationGroups(definition, 0));
  assert.throws(() => createQuestionnairePresentationV1([definition], []));
});

function reopen(source) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/questionnaire-recipe-reopen.js", import.meta.url))],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Questionnaire reproduction timed out.")); }, 20000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { errors += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(errors)); });
    child.stdin.on("error", reject); child.stdin.end(source);
  });
}

test("two independent editable instances reproduce identical full P2 successor bytes", async () => {
  const source = `${canonicalJson(await questionnaireRecipeFixture())}\n`;
  const results = await Promise.all([reopen(source), reopen(source)]);
  assert.deepEqual(results, [source, source]);
});

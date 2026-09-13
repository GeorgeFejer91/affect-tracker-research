// Real hidden Planner process and native source storage. Fictitious data only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { runPlannerCli } from "./planner-cli-driver.mjs";

const [executable, destination] = process.argv.slice(2);
assert.ok(executable && destination);
const root = resolve(destination); await mkdir(root);
const workspace = join(root, "workspace"); await mkdir(workspace);
const surveyJson = { title: { default: "CLI Survey", de: "CLI Fragebogen" }, elements: [
  { type: "boolean", name: "details" }, { type: "text", name: "answer", visibleIf: "{details} = true" },
] };
const source = join(root, "generated-survey.json"); await writeFile(source, JSON.stringify(surveyJson, null, 2));
const perform = (operation, args) => ({ kind: "perform", operation, arguments: args });
const get = field => ({ kind: "get", field });
const published = ({ response }) => assert.equal(response.result.published, true);
const steps = [
  { action: perform("selectWorkspace", { directory: workspace }), checkResponse: published },
  { action: { kind: "apply", edits: [
    { kind: "set", field: "P2.languages", value: ["en", "de"].map(l => ({ languageId: l, languageTag: l, label: l })) },
    { kind: "operation", owner: "P2", operation: "addQuestionnaire", arguments: { familyId: "custom", title: "Custom", optionCount: 5, rowCount: 0 } },
  ] } },
];
for (const language of ["en", "de"]) steps.push(
  { action: perform("importQuestionnaire", { path: source, familyId: "custom", language }), checkResponse: published },
  { action: perform("saveQuestionnaire", { questionnaireId: `custom-${language}` }), checkResponse: published },
);
steps.push({ action: get("P2.acceptedDefinitions"), expectStatus: "ok", checkResponse: ({ response }) => {
  assert.equal(response.result.value.length, 2);
  for (const d of response.result.value) { assert.equal(d.schema, "affect-research-surveyjs-definition"); assert.deepEqual(d.surveyJson, surveyJson); }
} });
steps.push({ action: perform("openRecipe", { path: resolve(import.meta.dirname, "../../test/fixtures/planner-recipe-v4-surveyjs.canonical.json") }), checkResponse: published });
steps.push({ action: get("P2.questionnaires"), expectStatus: "ok", checkResponse: ({ response }) => {
  assert.ok(response.result.value.length >= 2);
  assert.ok(response.result.value.every(d => d.kind === "surveyjs" && d.definition.engineVersion === "3.0.4"));
} });
const receipt = await runPlannerCli({ executable, steps, outputDirectory: join(root, "process"), timeoutMs: 120000 });
console.log(JSON.stringify(receipt, null, 2));
assert.equal(receipt.passed, true, receipt.failure);

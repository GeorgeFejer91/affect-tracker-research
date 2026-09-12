import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { validatePlannerRecipePolicyV1, plannerRecipePolicyFromPackageV1 } from "../site/src/research/planner-recipe-policy.js";
import { compilePlannerQuestionnaireRoutesV1, selectPlannerQuestionnaireRouteV1 } from "../site/src/research/planner-recipe-questionnaires.js";
import { createQuestionnaireSheet, setQuestionnaireGridCell, sheetToAuthoring } from "../site/src/research/questionnaire-sheet.js";

const pkg = JSON.parse(await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url), "utf8"));
const policyFixture = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-policy-v1.json", import.meta.url), "utf8"));
const definitions = [];
for (const language of ["en", "de", "fr"]) {
  const sheet = createQuestionnaireSheet({ familyId: "synthetic", language, optionCount: 2, rowCount: 1 });
  for (const [column, value] of [[0, `Synthetic fixture ${language}`], [1, "A"], [2, 7], [3, "B"], [4, 2]]) {
    setQuestionnaireGridCell(sheet, 0, column, value);
  }
  definitions.push((await sheetToAuthoring(sheet)).definition);
}
const modules = definitions.flatMap((definition) => ["beforeSession", "afterSession"].map((kind) => ({
  schema: "affect-research-questionnaire-module", version: 2, moduleId: `${definition.language}-${kind.toLowerCase()}`,
  questionnaireId: definition.questionnaireId, definitionSha256: definition.definitionSha256, placement: { kind, blockId: null },
})));
const questionnaires = { questionnaires: { algorithmVersion: pkg.settings.questionnaires.algorithmVersion, definitions, modules },
  languageSelection: { algorithmVersion: "language-tree-v1", rootNodeId: "root",
    languages: definitions.map((definition) => ({ languageId: definition.language, languageTag: definition.language, label: definition.language,
      questionnaireModuleIds: modules.filter((module) => module.questionnaireId === definition.questionnaireId).map((module) => module.moduleId) })),
    nodes: [
      { nodeId: "root", prompt: "Select group", options: [{ optionId: "all", label: "Languages", target: { kind: "node", nodeId: "languages" } }] },
      { nodeId: "languages", prompt: "Select language", options: definitions.map((definition) => ({ optionId: definition.language, label: definition.language,
        target: { kind: "language", languageId: definition.language } })) },
    ] } };

test("successor policy preserves the existing explicit acquisition, metadata, output, LSL and playback choices", async () => {
  const policy = plannerRecipePolicyFromPackageV1(pkg);
  assert.deepEqual(policy, validatePlannerRecipePolicyV1(policyFixture));
  assert.equal(await canonicalSha256(policy), "c2b30a0af779d28e1ca5c753f84b36717ce10af241ab7a2837be49df6c982f21");
  assert.equal(policy.participantCount, pkg.settings.experiment.participantCount);
  assert.equal(policy.samplingFrequencyHz, 137);
  assert.deepEqual(policy.output, pkg.settings.output);
  assert.deepEqual(policy.lsl, pkg.settings.advanced.lsl);
  assert.deepEqual(policy.playback, pkg.playback);
  assert.deepEqual(validatePlannerRecipePolicyV1(policy), policy);
  policy.playback.audio.volume = 0;
  assert.equal(pkg.playback.audio.volume, 1);
  assert.throws(() => validatePlannerRecipePolicyV1(policy), /complete-video/);
});

test("policy parsing never defaults or repairs missing, unknown or invalid choices", () => {
  const source = plannerRecipePolicyFromPackageV1(pkg);
  for (const field of Object.keys(source)) {
    const value = structuredClone(source); delete value[field];
    assert.throws(() => validatePlannerRecipePolicyV1(value));
  }
  for (const invalid of [
    { version: 2 }, { allocate: "cyclic" }, { samplingFrequencyHz: 0 }, { samplingFrequencyHz: 241 },
    { participantCount: 1.5 }, { output: { csv: false, tsv: false } },
    { output: { ...source.output, json: true } }, { lsl: { ...source.lsl, sourceId: " trimmed " } },
    { playback: { ...source.playback, loop: true } },
  ]) assert.throws(() => validatePlannerRecipePolicyV1({ ...source, ...invalid }));
});

test("all language routes retain exact module order, full definitions and option codes", async () => {
  const { routes, contribution } = await compilePlannerQuestionnaireRoutesV1(questionnaires);
  assert.equal(canonicalJson(contribution), canonicalJson(questionnaires));
  assert.equal(routes.length, 3);
  for (const route of routes) {
    const selected = await selectPlannerQuestionnaireRouteV1(questionnaires, route);
    assert.deepEqual(selected, route);
    for (const { module, definition } of [...route.beforeSession, ...route.afterSession]) {
      assert.equal(canonicalJson(definition), canonicalJson(questionnaires.questionnaires.definitions.find((item) => item.questionnaireId === module.questionnaireId)));
    }
  }
  await assert.rejects(selectPlannerQuestionnaireRouteV1(questionnaires, { languageId: routes[0].languageId, optionIds: [] }), /explicit terminal/);
});

test("two independent processes reproduce policy and nested language routes without ambient context", async () => {
  const policyUrl = new URL("../site/src/research/planner-recipe-policy.js", import.meta.url).href;
  const formsUrl = new URL("../site/src/research/planner-recipe-questionnaires.js", import.meta.url).href;
  const canonicalUrl = new URL("../site/src/research/canonical.js", import.meta.url).href;
  const code = `
    const fail = () => { throw new Error('ambient input forbidden'); };
    Date.now = fail; Math.random = fail;
    Object.defineProperty(globalThis, 'navigator', { get: fail });
    Object.defineProperty(globalThis, 'localStorage', { get: fail });
    const { validatePlannerRecipePolicyV1 } = await import(${JSON.stringify(policyUrl)});
    const { compilePlannerQuestionnaireRoutesV1 } = await import(${JSON.stringify(formsUrl)});
    const { canonicalJson } = await import(${JSON.stringify(canonicalUrl)});
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const value = JSON.parse(input);
    process.stdout.write(canonicalJson({ policy: validatePlannerRecipePolicyV1(value.policy), forms: await compilePlannerQuestionnaireRoutesV1(value.forms) }));
  `;
  const reproduce = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { windowsHide: true });
    let out = "", error = "";
    child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject); child.on("close", (status) => status === 0 ? resolve(out) : reject(new Error(error)));
    child.stdin.end(JSON.stringify({ policy: plannerRecipePolicyFromPackageV1(pkg), forms: questionnaires }));
  });
  const [left, right] = await Promise.all([reproduce(), reproduce()]);
  assert.equal(left, right);
  assert.equal(JSON.parse(left).forms.routes.length, 3);
});

test("a hook without a variant correspondence is routed to P2 and is never discarded or reinterpreted", async () => {
  for (const placement of [{ kind: "beforeBlock", blockId: "old-block" },
    { kind: "afterStimulus", blockId: null, stimulusId: "saved-video", relativeToIsi: "after" }]) {
    const value = structuredClone(questionnaires);
    value.questionnaires.modules[0].placement = placement;
    const original = canonicalJson(value);
    await assert.rejects(compilePlannerQuestionnaireRoutesV1(value), (error) => error.segment === "P2"
      && error.code === "variant-placement-unsupported" && error.field.endsWith(".placement"));
    assert.equal(canonicalJson(value), original);
  }
});

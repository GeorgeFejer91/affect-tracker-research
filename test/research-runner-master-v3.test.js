import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV3 } from "../site/src/research/planner-recipe.js";
import { readRunnerRecipe, resolveRunnerSelection } from "../runner/src/recipe.js";
import { NativeMasterProtocolAdapter } from "../runner/src/master-protocol.js";
import { inspectInformationStream } from "../runner/src/information-stream.js";
import { inspectMasterStream } from "../runner/src/master-stream.js";
import { frameRecords } from "./fixtures/runner-information-fixture.js";

// Exact outputs of Main/S1 strict production v3 compilers via runner-master-v3-fixture.js.
// Synthetic engineering assets; no actual experiment or media qualification.
let fixturePromise;
const fixture = () => fixturePromise ??= Promise.all(["runner-master-v3-owner", "runner-master-v3-owner-selections"].map(async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.canonical.json`, import.meta.url), "utf8")))).then(([recipe, selections]) => ({ recipe, selections }));
const bytes = value => new TextEncoder().encode(`${canonicalJson(value)}\n`);

test("Runner explicitly reads master3 and preserves all owner selections and typed content", async () => {
  const { recipe, selections } = await fixture(), receipt = await readRunnerRecipe(bytes(recipe));
  assert.equal(receipt.canonicalSourceText, `${canonicalJson(recipe)}\n`);
  assert.equal(receipt.recipe.version, 3);
  for (const selected of selections) {
    const plan = await resolveRunnerSelection(receipt, "P001", selected.language.languageSelectionPath, selected.variant.variantId);
    assert.equal(plan.version, 3); assert.equal(plan.algorithmVersion, "master-sequence-v3");
    assert.deepEqual(plan.selected, selected);
    assert.deepEqual(plan.steps.filter(step => step.kind === "questionnaire").map(step => step.payload), [...selected.questionnaires.beforeSession, ...selected.questionnaires.afterSession]);
    const { planIdentitySha256, selected: ignoredSelection, steps: ignoredSteps, ...identity } = plan;
    assert.equal(planIdentitySha256, await canonicalSha256(identity));
  }
  for (const version of [0, 2, "3", 4]) await assert.rejects(readRunnerRecipe(bytes({ ...recipe, version })));
  await assert.rejects(readRunnerRecipe(bytes({ ...recipe, version: 1 })));
});

function adapterFixture(version) {
  const calls = [], plan = { version, recipeSourceByteSha256: "a".repeat(64), planIdentitySha256: "b".repeat(64), participantId: "P001" };
  const receipt = { schema: "affect-runner-master-attempt", version, ...plan, runId: "run-12345678-1234-1234-1234-123456789abc", attemptId: "attempt-test" };
  const status = { ...receipt, schema: "affect-runner-master-status", active: true, phase: "questionnaire", position: 1, answers: {} };
  const adapter = new NativeMasterProtocolAdapter({ invoke: async (name, args) => { calls.push({ name, args }); return name.includes("start") ? receipt : status; }, render: async () => {}, terminal: async () => {}, fail: assert.fail, windowObject: { setInterval: () => 1, clearInterval: () => {} } });
  return { adapter, calls, plan, status };
}

test("v3 adapter uses participant-only Start, shared status and tagged actions without text coercion", async () => {
  const { adapter, calls, plan } = adapterFixture(3);
  await assert.rejects(adapter.start(plan, { version: 2, participantId: "P001", participant: {} }), /legacy/u);
  assert.equal(calls.length, 0);
  for (const version of [1,2,4]) await assert.rejects(adapter.start(plan,{version,participantId:"P001"}),/participant/u);
  assert.equal(calls.length,0);
  await adapter.start(plan, { version: 3, participantId: "P001" });
  assert.deepEqual(calls.slice(0, 2).map(call => call.name), ["research_runner_master_start_v3", "research_runner_master_status"]);
  const answers = { fullName: { kind: "text", text: "  Jörg\nExample  " }, age: { kind: "integer", integer: 0 }, gender: { kind: "singleChoice", optionId: "preferNotToSay" } };
  await adapter.questionnaireDraft({ protocolStepPosition: 1, answers });
  const call = calls.at(-1); assert.equal(call.name, "research_runner_master_action_v3");
  assert.equal(call.args.request.version, 3); assert.deepEqual(call.args.request.action, { type: "draft", position: 1, answers: Object.entries(answers).map(([itemId, value]) => ({ itemId, value })) });
  answers.fullName.text = "changed"; assert.equal(call.args.request.action.answers[0].value.text, "  Jörg\nExample  ");
  assert.throws(() => adapter.assertStatus({ ...adapter.status, version: 1 }), /match/u);
  adapter.destroy();
});

test("v1 adapter keeps legacy commands and option ID members", async () => {
  const { adapter, calls, plan } = adapterFixture(1);
  await adapter.start(plan, { participant: { participantId: "P001" } });
  await adapter.questionnaireDraft({ protocolStepPosition: 1, answers: { item: "yes" } });
  assert.equal(calls[0].name, "research_runner_master_start");
  assert.deepEqual(calls.at(-1), { name: "research_runner_master_action", args: { runId: adapter.receipt.runId, action: { type: "draft", position: 1, answers: [{ itemId: "item", optionId: "yes" }] } } });
  adapter.destroy();
});

// Synthetic observations exercise recorded protocol reconstruction only. This is
// not native timing, video, recording or an actual participant execution receipt.
async function informationV3(languageId) {
  const source = await fixture(), { integrity, ...core } = structuredClone(source.recipe);
  core.policy.lsl.enabled = true;
  const recipe = await compilePlannerRecipeV3(core), receipt = await readRunnerRecipe(bytes(recipe));
  const selection = source.selections.find(value => value.language.languageId === languageId);
  const plan = await resolveRunnerSelection(receipt, "P001", selection.language.languageSelectionPath, selection.variant.variantId);
  const context = { runId: "run-test", attemptId: "attempt-test", recipeSourceByteSha256: plan.recipeSourceByteSha256 };
  const execution = structuredClone(plan.selected.markerProfile); execution.entries = [];
  for (const step of plan.steps) {
    const sourceCode = step.sourceCode ?? `form-source-${step.position}`;
    if (step.kind === "questionnaire") execution.codebook.push({ sourceCode, kind: "form", identitySha256: step.payload.definition.definitionSha256, durationMs: null });
    execution.entries.push({ entryId: step.entryId, sourceCode });
  }
  const profile = { schema: "affect-runner-master-stream-profile", version: 1, ...context, participantId: plan.participantId, planIdentitySha256: plan.planIdentitySha256, selector: plan.selector, plannedProfile: plan.selected.markerProfile, executionProfile: execution };
  profile.profileSha256 = await canonicalSha256(profile);
  const lsl = structuredClone(plan.selected.policy.lsl); lsl.stateStream = `P01_${lsl.stateStream}`; lsl.markerStream = `P01_${lsl.markerStream}`;
  const records = [{ kind: "startup", value: { schema: "affect-runner-startup", version: 3, recipeSourceText: receipt.canonicalSourceText, ...context, planIdentitySha256: plan.planIdentitySha256, participantId: plan.participantId, selector: plan.selector, markerProfile: profile, effectiveLsl: lsl, build: { commit: "a".repeat(40), appVersion: "test" } } }];
  delete records[0].value.runId; delete records[0].value.attemptId;
  let sequence = 0, time = 0;
  const observe = (eventType, step = null) => records.push({ kind: "observation", value: { schema: "affect-research-marker", version: 1, recipeSha256: execution.recipeSha256, ...context, variantId: execution.variantId, variantVersionSha256: execution.variantVersionSha256, sequence: ++sequence, eventType, entryId: step?.entryId ?? null, executionId: step ? `execution-${step.position}` : null, sourceCode: step ? execution.entries[step.position - 1].sourceCode : null, monotonicMs: time } });
  observe("sessionStart");
  for (const step of plan.steps) {
    time++; const kind = { questionnaire: "form", interval: "isi", video: "video" }[step.kind]; observe(`${kind}Start`, step);
    time += step.durationMs ?? 250;
    if (step.kind === "questionnaire") {
      const d = step.payload.definition;
      const responses = d.items.map(item => {
        const common = { itemId: item.itemId, itemOrder: item.order, responseLatencyMs: 125 };
        if (d.schema === "affect-research-questionnaire-definition") {
          const option = item.options[0]; return { ...common, optionId: option.optionId, optionOrder: option.order, responseLabel: option.label, scoreValue: option.scoreValue, subscale: item.subscale };
        }
        if (item.response.kind === "text") return { ...common, value: { kind: "text", text: "  Fictitious Änne\nExample  " } };
        if (item.response.kind === "integer") return { ...common, value: { kind: "integer", integer: 0 } };
        const option = item.response.options.find(option => option.optionId === "preferNotToSay");
        return { ...common, value: { kind: "singleChoice", optionId: option.optionId }, optionOrder: option.order, responseLabel: option.label };
      });
      records.push({ kind: "responses", value: { schema: "affect-runner-master-responses", version: 2, ...context, participantId: plan.participantId, planIdentitySha256: plan.planIdentitySha256, entryId: step.entryId, position: step.position, module: step.payload.module, questionnaireId: d.questionnaireId, questionnaireVersion: d.questionnaireVersion, definitionSha256: d.definitionSha256, status: "submitted", monotonicMs: time, responses } });
    }
    observe(`${kind}End`, step);
  }
  time++; observe("complete");
  // Planned marker observations retain their exact existing fields.
  for (const record of records.filter(record => record.kind === "observation")) delete record.value.recipeSourceByteSha256;
  records.push({ kind: "outcome", value: { schema: "affect-runner-outcome", version: 1, protocolOutcome: "completed", completedStepCount: plan.steps.length, failureCode: null, monotonicMs: time + 1, localCheckpoint: "durable", recordingFinalization: "pending" } });
  return { plan, records, context };
}

test("startup3 reconstructs EN/DE typed and unchanged Likert rows without legacy identity preparation", async () => {
  for (const language of ["en", "de"]) {
    const f = await informationV3(language), result = await inspectInformationStream(await frameRecords(f.records, f.context));
    assert.equal(result.status, "complete", JSON.stringify(result.issues)); assert.deepEqual(result.plan, f.plan);
    assert.equal(Object.hasOwn(result.startup, "legacyCodedParticipant"), false);
    const typed = result.records.find(record => record.kind === "responses" && record.value.responses[0].value);
    assert.equal(typed.value.responses[0].value.text, "  Fictitious Änne\nExample  ");
    assert.equal(typed.value.responses[1].value.integer, 0);
    const markers = [{ value: canonicalJson(f.records[0].value.markerProfile), timestamp: 0 }, ...f.records.filter(record => record.kind === "observation").map((record, index) => ({ value: canonicalJson(record.value), timestamp: index + 1 }))];
    await assert.rejects(inspectMasterStream(markers), /selection/u);
    assert.equal((await inspectMasterStream(markers, { planVersion: 3 })).status, "complete");
  }
});

test("information3 rejects empty submissions, type/version confusion and extra legacy identity", async () => {
  const f = await informationV3("en"), index = f.records.findIndex(record => record.kind === "responses" && record.value.responses[0].value);
  for (const mutate of [
    records => records[index].value.responses.pop(),
    records => records[index].value.responses[0].value.text = " \u0085\uFEFF ",
    records => records[index].value.responses[1].value.integer = "0",
    records => records[index].value.responses[0].scoreValue = 1,
    records => records[index].value.version = 1,
    records => records[index].value.version = 3,
    records => records[index].value.responses[0].responseLatencyMs = -1,
    records => records[0].value.legacyCodedParticipant = {},
    records => records[0].value.version = 1,
    records => records[0].value.version = 2,
  ]) {
    const records = structuredClone(f.records); mutate(records);
    await assert.rejects(inspectInformationStream(await frameRecords(records, f.context)));
  }
});


test("validation information remains permanently unqualified after reconstruction", async () => {
  const f = await informationV3("en");
  const qualification = {schema:"affect-runner-execution-qualification",version:1,sessionKind:"local-validation",researchQualified:false,reason:"explicit-unqualified-validation"};
  f.records[0].value = {schema:"affect-runner-validation-startup",version:1,executionQualification:qualification,startup:f.records[0].value};
  const result = await inspectInformationStream(await frameRecords(f.records, f.context));
  assert.equal(result.status, "complete");
  assert.deepEqual(result.executionQualification, qualification);
  assert.deepEqual(result.plan, f.plan);
  f.records[0].value.executionQualification.researchQualified = true;
  await assert.rejects(inspectInformationStream(await frameRecords(f.records, f.context)), /qualification/u);
});

test("validation adapter never accepts an unlabelled native receipt", async () => {
  const {adapter, plan, calls} = adapterFixture(3);
  await assert.rejects(adapter.start(plan, {version:3,participantId:"P001"}, {validation:true}), /unqualified label/u);
  assert.equal(calls[0].name, "research_runner_master_validation_start");
  assert.equal(calls[0].args.request.acknowledgeUnqualified, true);
  assert.equal(adapter.active, false);
});

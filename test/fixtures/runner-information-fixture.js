import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalJson, canonicalSha256, sha256Hex } from "../../site/src/research/canonical.js";
import { readRunnerRecipe, resolveRunnerSelection } from "../../runner/src/recipe.js";

// Independent test encoder. Production publication is Rust-owned.
export async function frameRecords(records, context = { runId: "run-test", attemptId: "attempt-test", recipeSourceByteSha256: "a".repeat(64) }) {
  const samples = []; let sequence = 0;
  const add = payload => samples.push({ value: canonicalJson({ schema: "affect-runner-information", version: 1, ...context, sequence: ++sequence, payload }), timestamp: sequence / 1000 });
  for (const { kind, value } of records) {
    const bytes = Buffer.from(canonicalJson(value)), id = `transfer-${randomUUID()}`, hash = await sha256Hex(bytes);
    add({ kind: "header", transferId: id, contentKind: kind, byteLength: bytes.length, sha256: hash, chunkCount: Math.ceil(bytes.length / 65536) });
    for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) add({ kind: "chunk", transferId: id, index, data: bytes.subarray(offset, offset + 65536).toString("base64") });
    add({ kind: "commit", transferId: id, sha256: hash });
  }
  return samples;
}

export async function informationFixture() {
  const receipt = await readRunnerRecipe(await readFile(new URL("./runner-master-lsl-synthetic-v1.canonical.json", import.meta.url)));
  const plan = await resolveRunnerSelection(receipt, "P001", ["both", "en"], "variant-3");
  const context = { runId: "run-test", attemptId: "attempt-test", recipeSourceByteSha256: plan.recipeSourceByteSha256 };
  const execution = structuredClone(plan.selected.markerProfile); execution.entries = [];
  for (const step of plan.steps) {
    const sourceCode = step.sourceCode ?? `form-source-${step.position}`;
    if (step.kind === "questionnaire") execution.codebook.push({ sourceCode, kind: "form", identitySha256: step.payload.definition.definitionSha256, durationMs: null });
    execution.entries.push({ entryId: step.entryId, sourceCode });
  }
  const profile = { schema: "affect-runner-master-stream-profile", version: 1, ...context, participantId: plan.participantId, planIdentitySha256: plan.planIdentitySha256, selector: plan.selector, plannedProfile: plan.selected.markerProfile, executionProfile: execution };
  profile.profileSha256 = await canonicalSha256(profile);
  const lsl = structuredClone(plan.selected.policy.lsl); lsl.stateStream = "P01_" + lsl.stateStream; lsl.markerStream = "P01_" + lsl.markerStream;
  const records = [{ kind: "startup", value: { schema: "affect-runner-startup", version: 1, recipeSourceText: receipt.canonicalSourceText, recipeSourceByteSha256: plan.recipeSourceByteSha256, planIdentitySha256: plan.planIdentitySha256, participantId: plan.participantId, selector: plan.selector, markerProfile: profile, effectiveLsl: lsl, legacyCodedParticipant: { participantId: "P001", participantCode: "TP", age: 30, gender: "X", handedness: "R" }, build: { commit: "a".repeat(40), appVersion: "test" } } }];
  let sequence = 0, time = 0;
  const observe = (eventType, step = null) => records.push({ kind: "observation", value: { schema: "affect-research-marker", version: 1, recipeSha256: execution.recipeSha256, runId: context.runId, attemptId: context.attemptId, variantId: execution.variantId, variantVersionSha256: execution.variantVersionSha256, sequence: ++sequence, eventType, entryId: step?.entryId ?? null, executionId: step ? `execution-${step.position}` : null, sourceCode: step ? execution.entries[step.position - 1].sourceCode : null, monotonicMs: time } });
  observe("sessionStart");
  for (const step of plan.steps) {
    time++; const kind = { questionnaire: "form", interval: "isi", video: "video" }[step.kind]; observe(kind + "Start", step);
    time += step.durationMs ?? 250;
    if (step.kind === "questionnaire") {
      const d = step.payload.definition;
      records.push({ kind: "responses", value: { schema: "affect-runner-master-responses", version: 1, ...context, participantId: plan.participantId, planIdentitySha256: plan.planIdentitySha256, entryId: step.entryId, position: step.position, module: step.payload.module, questionnaireId: d.questionnaireId, questionnaireVersion: d.questionnaireVersion, definitionSha256: d.definitionSha256, status: "submitted", monotonicMs: time,
        responses: d.items.map(i => ({ itemId: i.itemId, itemOrder: i.order, optionId: i.options[0].optionId, optionOrder: i.options[0].order, responseLabel: i.options[0].label, scoreValue: i.options[0].scoreValue, subscale: i.subscale, responseLatencyMs: 125 })) } });
    }
    observe(kind + "End", step);
  }
  time++; observe("complete");
  records.push({ kind: "outcome", value: { schema: "affect-runner-outcome", version: 1, protocolOutcome: "completed", completedStepCount: plan.steps.length, failureCode: null, monotonicMs: time + 1, localCheckpoint: "durable", recordingFinalization: "pending" } });
  return { plan, records, context, samples: await frameRecords(records, context) };
}

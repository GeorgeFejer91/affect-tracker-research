import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../site/src/research/canonical.js";
import { InformationAssembler, inspectInformationStream } from "../runner/src/information-stream.js";
import { inspectMasterStream } from "../runner/src/master-stream.js";
import { frameRecords, informationFixture } from "./fixtures/runner-information-fixture.js";

const change = (samples, index, fn) => { const copy = structuredClone(samples), frame = JSON.parse(copy[index].value); fn(frame); copy[index].value = canonicalJson(frame); return copy; };
const assemble = async samples => { const reader = new InformationAssembler(), values = []; for (const sample of samples) { const value = await reader.push(sample); if (value) values.push(value); } return { status: reader.finish(), values }; };

test("prior dictionary stream remains readable and rejects comma-colliding profile fields", async () => {
  const fixture = await informationFixture(), profile = fixture.records[0].value.markerProfile;
  const samples = [{ value: canonicalJson(profile), timestamp: 0 }, ...fixture.records.filter(r => r.kind === "observation").map((r, i) => ({ value: canonicalJson(r.value), timestamp: i + 1 }))];
  assert.equal((await inspectMasterStream(samples)).status, "complete");
  const malformed = structuredClone(profile); malformed["executionProfile,participantId"] = null; delete malformed.executionProfile; delete malformed.participantId;
  await assert.rejects(inspectMasterStream([{ value: canonicalJson(malformed), timestamp: 0 }]), /profile binding/u);
});

test("bounded multi-chunk Unicode transfer preserves exact values and both observed LSL times", async () => {
  const value = { text: "ü𝄞 test ".repeat(15000) }, samples = await frameRecords([{ kind: "startup", value }, { kind: "outcome", value: {} }]);
  const result = await assemble(samples); assert.equal(result.status.complete, true); assert.deepEqual(result.values[0].value, value);
  assert.ok(result.values[0].lastSequence > 3); assert.ok(result.values[0].commitLslTimeSeconds > result.values[0].firstLslTimeSeconds);
});

test("missing, duplicated, reordered, corrupt and oversized information cannot commit", async () => {
  const samples = await frameRecords([{ kind: "startup", value: { text: "x".repeat(100000) } }, { kind: "outcome", value: {} }]);
  await assert.rejects(assemble(samples.slice(1)), /sequence/u);
  await assert.rejects(assemble(samples.filter((_, i) => i !== 1)), /sequence/u);
  await assert.rejects(assemble([...samples.slice(0, 2), samples[1], ...samples.slice(2)]), /sequence/u);
  await assert.rejects(assemble([samples[0], samples[2], samples[1], ...samples.slice(3)]), /sequence/u);
  await assert.rejects(assemble(change(samples, 1, f => f.payload.index++)), /index/u);
  await assert.rejects(assemble(change(samples, 1, f => f.payload.data = "!" + f.payload.data.slice(1))), /base64/u);
  await assert.rejects(assemble(change(samples, 0, f => f.payload.byteLength = 64 * 1024 * 1024 + 1)), /bound/u);
  await assert.rejects(assemble(change(samples, 0, f => f.payload.extra = true)), /unknown/u);
  await assert.rejects(assemble(change(samples, 0, f => {
    f.payload["chunkCount,contentKind"] = null; delete f.payload.chunkCount; delete f.payload.contentKind;
  })), /missing or unknown fields/u);
  await assert.rejects(assemble(change(samples, 1, f => f.attemptId = "attempt-other")), /context/u);
  await assert.rejects(assemble(change(samples, 3, f => f.payload.sha256 = "a".repeat(64))), /hash/u);
  await assert.rejects(assemble(change(samples, 1, f => f.payload.data = "A" + f.payload.data.slice(1))), /hash/u);
  const reversed = structuredClone(samples); reversed[2].timestamp = 0; await assert.rejects(assemble(reversed), /reversed/u);
  const late = structuredClone(samples); late[1].timestamp += 31; await assert.rejects(assemble(late), /30 seconds/u);
  const truncated = await assemble(samples.slice(0, -1)); assert.equal(truncated.status.complete, false);
  const giantFrame = [{ value: "x".repeat(128 * 1024 + 1), timestamp: 0 }]; await assert.rejects(assemble(giantFrame), /bound/u);
});

test("complete information reconstructs source, layout, definitions, mandatory answers and ordered outcomes", async () => {
  const fixture = await informationFixture(), result = await inspectInformationStream(fixture.samples);
  assert.equal(result.status, "complete", JSON.stringify(result.issues)); assert.deepEqual(result.plan, fixture.plan);
  assert.equal(result.occurrences.length, 10); assert.equal(result.records.filter(r => r.kind === "responses").length, 2);
  assert.equal(result.recordingFinalization, "requires-xdf-footer-verification");
  assert.deepEqual(result.plan.selected.feedback, fixture.plan.selected.feedback);
});

test("submitted optional omissions, forged codes/scores, wrong forms and native clock reversal reject", async () => {
  const fixture = await informationFixture(), responseIndex = fixture.records.findIndex(r => r.kind === "responses");
  for (const [mutate, pattern] of [
    [r => r[responseIndex].value.responses.pop(), /every questionnaire/iu],
    [r => r[responseIndex].value.responses[0].scoreValue = 100000, /score/u],
    [r => r[responseIndex].value.responses[0].optionId = "missing", /identity/u],
    [r => r[responseIndex].value.responses.push(r[responseIndex].value.responses[0]), /count|order/u],
    [r => r[responseIndex].value.responses[0].responseLatencyMs = -1, /latency/u],
    [r => r[responseIndex].value.monotonicMs = 0, /clock/u],
    [r => r[responseIndex].value.entryId = "form-other", /occurrence/u],
    [r => r[0].value.recipeSourceByteSha256 = "b".repeat(64), /identity/u],
    [r => r.at(-1).value.completedStepCount = 0, /count/u],
  ]) {
    const records = structuredClone(fixture.records); mutate(records);
    await assert.rejects(inspectInformationStream(await frameRecords(records, fixture.context)), pattern);
  }
  const missing = fixture.records.filter((_, i) => i !== responseIndex);
  assert.equal((await inspectInformationStream(await frameRecords(missing, fixture.context))).status, "incomplete");
  const draft = structuredClone(fixture.records); draft[responseIndex].value.status = "draft";
  assert.equal((await inspectInformationStream(await frameRecords(draft, fixture.context))).status, "incomplete");
});

import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../experiment-planner/web/src/research/canonical.js";
import { InformationAssembler, inspectInformationStream } from "../experiment-runner/src/information-stream.js";
import { inspectMasterStream } from "../experiment-runner/src/master-stream.js";
import { reconstructInformationXdf } from "../scripts/qualification/runner-information-stream.mjs";
import { frameRecords, informationFixture } from "./fixtures/runner-information-fixture.js";

const change = (samples, index, fn) => { const copy = structuredClone(samples), frame = JSON.parse(copy[index].value); fn(frame); copy[index].value = canonicalJson(frame); return copy; };
const assemble = async samples => { const reader = new InformationAssembler(), values = []; for (const sample of samples) { const value = await reader.push(sample); if (value) values.push(value); } return { status: reader.finish(), values }; };

test("master4 information independently reconstructs complete SurveyJS JSON, nested data and engine validation", async () => {
  const fixture = await informationFixture({ surveyJs: true });
  const result = await inspectInformationStream(fixture.samples);
  assert.equal(result.status, "complete"); assert.equal(result.plan.version, 4);
  assert.deepEqual(result.plan, fixture.plan);
  const responseIndex = fixture.records.findIndex(r => r.kind === "responses");
  assert.equal(result.records.find(r => r.kind === "responses").value.responses.data.explanation, "Fictitious response 🌻");
  for (const mutate of [r => delete r.responses.data.explanation, r => r.responses.data.choices = ["a"], r => r.responses.randomSeed++, r => r.version = 2, r => r.responses.language = "de", r => r.responses.data.unknown = "forged"]) {
    const records = structuredClone(fixture.records); mutate(records[responseIndex].value);
    await assert.rejects(inspectInformationStream(await frameRecords(records, fixture.context)));
  }
});

test("SurveyJS validation recordings preserve the unqualified label and full questionnaire replay", async () => {
  const f = await informationFixture({ surveyJs: true });
  const qualification = { schema: "affect-runner-execution-qualification", version: 1, sessionKind: "local-validation", researchQualified: false, reason: "explicit-unqualified-validation" };
  f.records[0].value = { schema: "affect-runner-validation-startup", version: 1, executionQualification: qualification, startup: f.records[0].value };
  const result = await inspectInformationStream(await frameRecords(f.records, f.context));
  assert.equal(result.status, "complete");
  assert.equal(result.plan.version, 4);
  assert.deepEqual(result.executionQualification, qualification);
  f.records[0].value.executionQualification.researchQualified = true;
  await assert.rejects(inspectInformationStream(await frameRecords(f.records, f.context)), /qualification/u);
});

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

test("independent XDF reconstruction binds the Flubber stream to authored rate and channel semantics", async () => {
  const fixture = await informationFixture();
  const startup = fixture.records[0].value;
  const stream = (name, format, rate, channels, timestamps, samples) => ({
    name, type: format === "string" ? "Markers" : "Affect", channelCount: channels.length,
    channelFormat: format, sourceId: `test:${name}`, nominalSampleRateHz: rate, channels,
    sampleCount: samples.length, footerVerified: true, timestamps, samples,
  });
  const marker = stream(startup.effectiveLsl.markerStream, "string", 0,
    [{ label: "marker", unit: null, type: "Markers" }],
    fixture.samples.map(sample => sample.timestamp), fixture.samples.map(sample => [sample.value]));
  const stateChannels = [
    ["current_valence", "normalized"], ["current_arousal", "normalized"],
    ["target_valence", "normalized"], ["target_arousal", "normalized"],
    ["radius", "normalized"], ["angle_degrees", "degrees"],
    ["animation_active", "boolean"], ["input_active", "boolean"],
  ].map(([label, unit]) => ({ label, unit, type: "Affect" }));
  const affect = stream(startup.effectiveLsl.stateStream, "float32", fixture.plan.selected.policy.samplingFrequencyHz,
    stateChannels, [0.01, 0.02, 0.03], [[0, 0, 0, 0, 0, 0, 0, 0], [0.25, -0.5, 0.25, -0.5, Math.hypot(0.25, -0.5), 296.565051177078, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]]);
  const data = { schema: "affect-runner-independent-xdf-export", version: 2,
    reader: { name: "pyxdf", version: "test", synchronizeClocks: false, dejitterTimestamps: false },
    xdfSha256: "a".repeat(64), primaryStreamIndex: 1, streams: [affect, marker] };
  const receipt = await reconstructInformationXdf(data);
  assert.equal(receipt.version, 2); assert.equal(receipt.affectCadence.authoredHz, 137);
  assert.equal(receipt.affectCadence.sampleCount, 3); assert.equal(receipt.result.status, "complete");
  for (const mutate of [
    copy => copy.streams[0].nominalSampleRateHz = 130,
    copy => copy.streams[0].channels.reverse(),
    copy => copy.streams[0].samples[1][2] = 0.1,
    copy => copy.streams[0].samples[1][4] = 0.1,
    copy => copy.streams[0].timestamps[2] = copy.streams[0].timestamps[1],
  ]) {
    const copy = structuredClone(data); mutate(copy);
    await assert.rejects(reconstructInformationXdf(copy));
  }
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

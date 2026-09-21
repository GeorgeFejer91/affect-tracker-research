import test from "node:test";
import assert from "node:assert/strict";
import { inspectEvidenceStream, inspectInputStreamV2, inspectSampleStreamV2 } from "../experiment-runner/src/evidence-stream-v2.js";

const hash = character => character.repeat(64);
const expected = {
  recipeSourceByteSha256: hash("a"), planIdentitySha256: hash("b"),
  runId: "run-test", attemptId: "attempt-test", participantId: "P001",
};
const executionProfile = {
  recipeSha256: hash("c"), variantId: "variant-1", variantVersionSha256: hash("d"),
  entries: [{ entryId: "entry-1", sourceCode: "source-1" }],
  codebook: [{ sourceCode: "source-1", kind: "video", identitySha256: hash("e"), durationMs: 1000 }],
};
const profile = { executionProfile };

function event(sequence, eventType, acceptedMonotonicMs, occurrence = false, payload = { kind: "lifecycle" }, phase = "playing") {
  return {
    schema: "affect-runner-evidence-event", version: 2, ...expected,
    variantId: "variant-1", variantVersionSha256: hash("d"), sequence, eventType, phase,
    entryId: occurrence ? "entry-1" : null, executionId: occurrence ? "execution-1" : null,
    sourceCode: occurrence ? "source-1" : null, observedMonotonicMs: acceptedMonotonicMs,
    acceptedMonotonicMs, wallUnixMs: 1_800_000_000_000 + sequence, payload,
  };
}

function trace() {
  return [
    event(1, "sessionStart", 0, false, { kind: "lifecycle" }, "awaitingPresentation"),
    event(2, "videoStart", 1, true),
    { ...event(3, "inputEdge", 2, true, { kind: "inputEdge", direction: "right", detail: "keyboard:ArrowRight", applyStep: true, inputActive: true, impulse: false, stateAfter: { valence: 0.1, arousal: 0 } }), observedMonotonicMs: 1.5 },
    event(4, "timingGap", 3, true, { kind: "timingGap", gapKind: "sampleDeadline", detail: { missedSlots: 1 } }),
    event(5, "videoEnd", 4, true),
    event(6, "neutralReset", 4.1, true, { kind: "neutralReset", reason: "videoEnd", stateAfter: { valence: 0, arousal: 0 } }),
    event(7, "complete", 5, false, { kind: "lifecycle" }, "finished"),
  ];
}

test("evidence v2 reconstructs lifecycle while retaining input, reset and gap facts", () => {
  const result = inspectEvidenceStream(profile, trace(), expected);
  assert.equal(result.status, "complete");
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.observations.length, 7);
});

test("evidence v2 reports missing sequence and rejects changed identity", () => {
  assert.equal(inspectEvidenceStream(profile, trace().filter(row => row.sequence !== 3), expected).status, "incomplete");
  const changed = trace(); changed[2].planIdentitySha256 = hash("f");
  assert.throws(() => inspectEvidenceStream(profile, changed, expected), /binding/u);
});

function sample(sequence, scheduledElapsedMs, observedElapsedMs, missedSlotsBefore, schedulerJitterMs) {
  return {
    schema: "affect-runner-master-sample", version: 2, sequence, ...expected,
    phase: "awaitingPresentation", entryId: null, executionId: null, monotonicMs: observedElapsedMs,
    lslTimeSeconds: null, mediaTimeMs: null, sampleRateHz: 100, scheduledElapsedMs, observedElapsedMs,
    schedulerLatenessMs: observedElapsedMs - scheduledElapsedMs, schedulerJitterMs, stateAnchorAgeMs: observedElapsedMs,
    missedSlotsBefore, valence: 0, arousal: 0, radius: 0, angleDegrees: 0, inputActive: false,
    animationActive: false, inputKind: "digital", feedbackVisible: false, oscillationFrequency: 0.5,
    edgeSmoothness: 0.5, projectionAmplitude: 0.2, pulseSynchrony: 0.2, waveSizeVariation: 0.4, saturation: 0,
  };
}

test("sample v2 validates the no-catch-up affect grid", () => {
  const rows = [sample(1, 10, 11, 0, 0), sample(2, 30, 32, 1, 1)];
  assert.equal(inspectSampleStreamV2(rows, expected).status, "complete");
  rows[1].valence = 0.2;
  assert.throws(() => inspectSampleStreamV2(rows, expected), /neutral/u);
});

test("input v2 keeps continuous observations separate and binds every digital edge", () => {
  const events = trace();
  const inputs = [
    { schema: "affect-runner-input-observation", version: 2, ...expected, sequence: 1, inputKind: "digital", phase: "playing",
      entryId: "entry-1", executionId: "execution-1", observedMonotonicMs: 1.5, acceptedMonotonicMs: 1.8,
      payload: { direction: "right", detail: "keyboard:ArrowRight", applyStep: true, inputActive: true, impulse: false, stateAfter: { valence: 0.1, arousal: 0 } } },
    { schema: "affect-runner-input-observation", version: 2, ...expected, sequence: 2, inputKind: "continuous", phase: "playing",
      entryId: "entry-1", executionId: "execution-1", observedMonotonicMs: 2.2, acceptedMonotonicMs: 2.3,
      payload: { detail: "gamepad:left-stick", inputActive: true, x: 0.25, y: -0.5, stateAfter: { valence: 0.25, arousal: -0.5 } } },
  ];
  const result = inspectInputStreamV2(inputs, expected, events);
  assert.equal(result.digitalCount, 1);
  assert.equal(result.continuousCount, 1);
  assert.throws(() => inspectInputStreamV2([{ ...inputs[1], sequence: 1 }], expected, events), /differ/u);
});

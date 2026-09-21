import { inspectPlannedMarkerTrace } from "../../experiment-planner/web/src/research/planned-marker-contract.js";

const sha = /^[a-f0-9]{64}$/u;
const code = /^[A-Za-z][A-Za-z0-9-]{0,95}$/u;
const phases = new Set(["awaitingPresentation", "questionnaire", "interval", "preparing", "playing", "paused", "finished", "failed"]);
const lifecycle = new Set(["sessionStart", "videoStart", "videoEnd", "isiStart", "isiEnd", "formStart", "formEnd", "pause", "resume", "interruption", "restart", "complete", "partial"]);
const eventTypes = new Set([...lifecycle, "inputEdge", "neutralReset", "timingGap"]);
const eventKeys = ["schema", "version", "recipeSourceByteSha256", "planIdentitySha256", "runId", "attemptId", "participantId", "variantId", "variantVersionSha256", "sequence", "eventType", "phase", "entryId", "executionId", "sourceCode", "observedMonotonicMs", "acceptedMonotonicMs", "wallUnixMs", "payload"];
const sampleKeys = ["schema", "version", "sequence", "runId", "attemptId", "participantId", "recipeSourceByteSha256", "planIdentitySha256", "phase", "entryId", "executionId", "monotonicMs", "lslTimeSeconds", "mediaTimeMs", "sampleRateHz", "scheduledElapsedMs", "observedElapsedMs", "schedulerLatenessMs", "schedulerJitterMs", "stateAnchorAgeMs", "missedSlotsBefore", "valence", "arousal", "radius", "angleDegrees", "inputActive", "animationActive", "inputKind", "feedbackVisible", "oscillationFrequency", "edgeSmoothness", "projectionAmplitude", "pulseSynchrony", "waveSizeVariation", "saturation"];
const inputKeys = ["schema", "version", "recipeSourceByteSha256", "planIdentitySha256", "runId", "attemptId", "participantId", "sequence", "inputKind", "phase", "entryId", "executionId", "observedMonotonicMs", "acceptedMonotonicMs", "payload"];

function require(value, message) { if (!value) throw new Error(message); }
function exact(value, keys, label) {
  require(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing or unknown fields.`);
}
function boundedNumber(value) { return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }

function validatePayload(event) {
  const payload = event.payload;
  if (lifecycle.has(event.eventType)) {
    exact(payload, ["kind"], "Lifecycle evidence payload");
    require(payload.kind === "lifecycle", "Invalid lifecycle evidence payload.");
    return;
  }
  if (event.eventType === "inputEdge") {
    exact(payload, ["kind", "direction", "detail", "applyStep", "inputActive", "impulse", "stateAfter"], "Input-edge evidence payload");
    exact(payload.stateAfter, ["valence", "arousal"], "Input-edge state");
    require(payload.kind === "inputEdge" && ["up", "down", "left", "right"].includes(payload.direction)
      && typeof payload.detail === "string" && new TextEncoder().encode(payload.detail).length <= 128
      && [payload.applyStep, payload.inputActive, payload.impulse].every(value => typeof value === "boolean")
      && [payload.stateAfter.valence, payload.stateAfter.arousal].every(value => Number.isFinite(value) && value >= -1 && value <= 1), "Invalid input-edge evidence payload.");
    return;
  }
  if (event.eventType === "neutralReset") {
    exact(payload, ["kind", "reason", "stateAfter"], "Neutral-reset evidence payload");
    exact(payload.stateAfter, ["valence", "arousal"], "Neutral-reset state");
    require(payload.kind === "neutralReset" && ["videoEnd", "intervalAdmission"].includes(payload.reason)
      && payload.stateAfter.valence === 0 && payload.stateAfter.arousal === 0, "Invalid neutral-reset evidence payload.");
    return;
  }
  exact(payload, ["kind", "gapKind", "detail"], "Timing-gap evidence payload");
  require(payload.kind === "timingGap" && ["inputObservation", "sampleDeadline"].includes(payload.gapKind)
    && payload.detail && Object.getPrototypeOf(payload.detail) === Object.prototype, "Invalid timing-gap evidence payload.");
}

/** Independent evidence-v2 consumer. Engine/render state is never treated as
 * evidence authority; only the closed native event envelope is reconstructed. */
export function inspectEvidenceStream(profile, events, expected) {
  require(Array.isArray(events) && events.length <= 200000, "Evidence trace exceeds its bound.");
  const entrySources = new Map(profile.executionProfile.entries.map(entry => [entry.entryId, entry.sourceCode]));
  const issues = [], lifecycleRecords = [];
  let sequence = 0, accepted = -1, terminal = false;
  for (const event of events) {
    exact(event, eventKeys, "Evidence event");
    require(event.schema === "affect-runner-evidence-event" && event.version === 2
      && event.recipeSourceByteSha256 === expected.recipeSourceByteSha256 && event.planIdentitySha256 === expected.planIdentitySha256
      && event.runId === expected.runId && event.attemptId === expected.attemptId && event.participantId === expected.participantId
      && event.variantId === profile.executionProfile.variantId && event.variantVersionSha256 === profile.executionProfile.variantVersionSha256
      && sha.test(event.recipeSourceByteSha256) && sha.test(event.planIdentitySha256) && code.test(event.runId) && code.test(event.attemptId)
      && Number.isSafeInteger(event.sequence) && event.sequence >= 1 && event.sequence <= Number.MAX_SAFE_INTEGER
      && eventTypes.has(event.eventType) && phases.has(event.phase)
      && boundedNumber(event.observedMonotonicMs) && boundedNumber(event.acceptedMonotonicMs) && event.observedMonotonicMs <= event.acceptedMonotonicMs
      && Number.isSafeInteger(event.wallUnixMs) && event.wallUnixMs >= 0, "Evidence envelope or immutable binding is invalid.");
    for (const key of ["entryId", "executionId", "sourceCode"]) require(event[key] === null || code.test(event[key]), "Evidence identity must be a bounded code or explicit null.");
    require((event.entryId === null) === (event.executionId === null) && (event.entryId === null) === (event.sourceCode === null), "Evidence occurrence context is incomplete.");
    if (event.entryId !== null) require(entrySources.get(event.entryId) === event.sourceCode, "Evidence source is absent from the execution profile.");
    if (["sessionStart", "complete", "partial"].includes(event.eventType)) require(event.entryId === null, "Session evidence cannot claim occurrence context.");
    if (event.eventType === "inputEdge") require(event.phase === "playing" && event.entryId !== null, "Input evidence requires an active video occurrence.");
    validatePayload(event);
    if (event.sequence !== sequence + 1) issues.push({ sequence: event.sequence, code: "sequence-gap-or-reorder" });
    if (event.acceptedMonotonicMs < accepted) issues.push({ sequence: event.sequence, code: "time-reversed" });
    if (terminal) issues.push({ sequence: event.sequence, code: "after-terminal" });
    sequence = event.sequence; accepted = event.acceptedMonotonicMs;
    if (["complete", "partial"].includes(event.eventType)) terminal = true;
    if (lifecycle.has(event.eventType)) lifecycleRecords.push({
      schema: "affect-research-marker", version: 1, recipeSha256: profile.executionProfile.recipeSha256,
      runId: event.runId, attemptId: event.attemptId, variantId: event.variantId,
      variantVersionSha256: event.variantVersionSha256, sequence: lifecycleRecords.length + 1,
      eventType: event.eventType, entryId: event.entryId, executionId: event.executionId,
      sourceCode: event.sourceCode, monotonicMs: event.acceptedMonotonicMs,
    });
  }
  const reconstructed = inspectPlannedMarkerTrace(profile.executionProfile, lifecycleRecords);
  return { ...reconstructed, status: issues.length || reconstructed.issues.length ? "incomplete" : reconstructed.status,
    issues: [...issues, ...reconstructed.issues], observations: events };
}

/** Strict validator for the primary continuous affect outcome. It verifies the
 * no-catch-up sampling grid and retains every accepted row for analysis. */
export function inspectSampleStreamV2(samples, expected) {
  require(Array.isArray(samples) && samples.length <= 5_000_000, "Affect sample trace exceeds its bound.");
  const issues = [];
  let previousMonotonic = -1, previousScheduled = 0, previousLateness = null;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    exact(sample, sampleKeys, "Affect sample");
    require(sample.schema === "affect-runner-master-sample" && sample.version === 2 && sample.sequence === index + 1
      && sample.runId === expected.runId && sample.attemptId === expected.attemptId && sample.participantId === expected.participantId
      && sample.recipeSourceByteSha256 === expected.recipeSourceByteSha256 && sample.planIdentitySha256 === expected.planIdentitySha256
      && phases.has(sample.phase) && boundedNumber(sample.monotonicMs)
      && Number.isSafeInteger(sample.sampleRateHz) && sample.sampleRateHz >= 1 && sample.sampleRateHz <= 240
      && [sample.scheduledElapsedMs, sample.observedElapsedMs, sample.schedulerLatenessMs, sample.stateAnchorAgeMs].every(boundedNumber)
      && Number.isFinite(sample.schedulerJitterMs) && Number.isSafeInteger(sample.missedSlotsBefore) && sample.missedSlotsBefore >= 0
      && [sample.valence, sample.arousal].every(value => Number.isFinite(value) && value >= -1 && value <= 1)
      && boundedNumber(sample.radius) && sample.radius <= 1 && boundedNumber(sample.angleDegrees) && sample.angleDegrees < 360
      && [sample.inputActive, sample.animationActive, sample.feedbackVisible].every(value => typeof value === "boolean")
      && ["digital", "absolute", "gamepad"].includes(sample.inputKind)
      && [sample.oscillationFrequency, sample.edgeSmoothness, sample.projectionAmplitude, sample.pulseSynchrony, sample.waveSizeVariation, sample.saturation].every(Number.isFinite)
      && (sample.lslTimeSeconds === null || Number.isFinite(sample.lslTimeSeconds))
      && (sample.mediaTimeMs === null || boundedNumber(sample.mediaTimeMs)), "Invalid affect sample or immutable binding.");
    require((sample.entryId === null) === (sample.executionId === null)
      && (sample.entryId === null || code.test(sample.entryId) && code.test(sample.executionId)), "Affect sample occurrence context is invalid.");
    require(sample.phase !== "awaitingPresentation" || sample.entryId === null, "Awaiting-presentation samples cannot claim an occurrence.");
    require(!["questionnaire", "interval", "preparing", "playing", "paused"].includes(sample.phase) || sample.entryId !== null, "Active-phase samples require occurrence context.");
    require(sample.inputActive === false || sample.phase === "playing", "Input cannot be active outside playback.");
    if (!["playing", "paused"].includes(sample.phase)) require(sample.valence === 0 && sample.arousal === 0 && sample.radius === 0, "Non-video affect state must be neutral.");
    const calculatedRadius = Math.min(1, Math.hypot(sample.valence, sample.arousal));
    require(Math.abs(calculatedRadius - sample.radius) <= 1e-12, "Affect sample radius differs from its coordinates.");
    const calculatedAngle = sample.radius === 0 ? 0 : (Math.atan2(sample.arousal, sample.valence) * 180 / Math.PI + 360) % 360;
    require(Math.abs(calculatedAngle - sample.angleDegrees) <= 1e-9, "Affect sample angle differs from its coordinates.");
    const period = 1000 / sample.sampleRateHz;
    const scheduledDelta = sample.scheduledElapsedMs - previousScheduled;
    require(Math.abs(scheduledDelta - period * (sample.missedSlotsBefore + 1)) <= 0.001
      && sample.observedElapsedMs + 1e-9 >= sample.scheduledElapsedMs
      && Math.abs(sample.schedulerLatenessMs - (sample.observedElapsedMs - sample.scheduledElapsedMs)) <= 0.001,
    "Affect sample does not follow the declared no-catch-up deadline grid.");
    const expectedJitter = previousLateness === null ? 0 : sample.schedulerLatenessMs - previousLateness;
    require(Math.abs(sample.schedulerJitterMs - expectedJitter) <= 0.001, "Affect sample jitter differs from deadline lateness.");
    if (sample.monotonicMs < previousMonotonic) issues.push({ sequence: sample.sequence, code: "sample-time-reversed" });
    previousMonotonic = sample.monotonicMs; previousScheduled = sample.scheduledElapsedMs; previousLateness = sample.schedulerLatenessMs;
  }
  return { status: issues.length ? "incomplete" : "complete", sampleCount: samples.length, issues, samples };
}

/** Validates the separate admitted-input layer. Digital observations must also
 * have a one-for-one semantic edge event; continuous positions remain in this
 * artifact and the regular affect state stream rather than flooding markers. */
export function inspectInputStreamV2(inputs, expected, evidenceEvents = []) {
  require(Array.isArray(inputs) && inputs.length <= 5_000_000, "Input observation trace exceeds its bound.");
  let accepted = -1;
  const digital = [];
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    exact(input, inputKeys, "Input observation");
    require(input.schema === "affect-runner-input-observation" && input.version === 2 && input.sequence === index + 1
      && input.runId === expected.runId && input.attemptId === expected.attemptId && input.participantId === expected.participantId
      && input.recipeSourceByteSha256 === expected.recipeSourceByteSha256 && input.planIdentitySha256 === expected.planIdentitySha256
      && ["digital", "continuous"].includes(input.inputKind) && input.phase === "playing"
      && code.test(input.entryId) && code.test(input.executionId)
      && boundedNumber(input.observedMonotonicMs) && boundedNumber(input.acceptedMonotonicMs)
      && input.observedMonotonicMs <= input.acceptedMonotonicMs && input.acceptedMonotonicMs >= accepted,
    "Input observation or immutable binding is invalid.");
    const payload = input.payload;
    if (input.inputKind === "digital") {
      exact(payload, ["direction", "detail", "applyStep", "inputActive", "impulse", "stateAfter"], "Digital input observation");
      require(["up", "down", "left", "right"].includes(payload.direction)
        && [payload.applyStep, payload.inputActive, payload.impulse].every(value => typeof value === "boolean"), "Invalid digital input observation.");
      digital.push(input);
    } else {
      exact(payload, ["detail", "inputActive", "x", "y", "stateAfter"], "Continuous input observation");
      require(typeof payload.inputActive === "boolean" && [payload.x, payload.y].every(value => Number.isFinite(value) && value >= -1 && value <= 1), "Invalid continuous input observation.");
    }
    exact(payload.stateAfter, ["valence", "arousal"], "Admitted input state");
    require(typeof payload.detail === "string" && new TextEncoder().encode(payload.detail).length <= 128
      && [payload.stateAfter.valence, payload.stateAfter.arousal].every(value => Number.isFinite(value) && value >= -1 && value <= 1), "Invalid admitted input state.");
    accepted = input.acceptedMonotonicMs;
  }
  const edges = evidenceEvents.filter(event => event.eventType === "inputEdge");
  require(edges.length === digital.length, "Digital input observations and semantic edge events differ.");
  for (let index = 0; index < digital.length; index++) {
    const input = digital[index], edge = edges[index];
    require(edge.observedMonotonicMs === input.observedMonotonicMs && edge.entryId === input.entryId && edge.executionId === input.executionId
      && ["direction", "detail", "applyStep", "inputActive", "impulse", "stateAfter"].every(key => JSON.stringify(edge.payload[key]) === JSON.stringify(input.payload[key])),
    "Digital input semantic projection differs from its admitted observation.");
  }
  return { status: "complete", inputCount: inputs.length, digitalCount: digital.length, continuousCount: inputs.length - digital.length, inputs };
}

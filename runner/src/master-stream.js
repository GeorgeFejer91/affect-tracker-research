import { canonicalJson, canonicalSha256 } from "../../site/src/research/canonical.js";
import { inspectPlannedMarkerTrace } from "../../site/src/research/planned-marker-contract.js";
import { masterParticipantId } from "./master-recipe.js";

const profileKeys = ["schema", "version", "recipeSourceByteSha256", "planIdentitySha256", "participantId", "selector", "runId", "attemptId", "plannedProfile", "executionProfile", "profileSha256"];
const sha = /^[a-f0-9]{64}$/u, code = /^[A-Za-z][A-Za-z0-9-]{0,95}$/u;
const runnerKeys = ["schema", "version", "recipeSha256", "runId", "attemptId", "variantId", "variantVersionSha256", "sequence", "eventType", "entryId", "executionId", "sourceCode", "monotonicMs", "observedMonotonicMs"];
const inputKeys = ["direction", "applyStep", "inputActive", "impulse"];
function parse(text, maximum) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > maximum) throw new Error("Master stream payload exceeds its byte bound.");
  const value = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new Error("Master stream payload is not canonical JSON.");
  return value;
}

/** Independent recorded-stream consumer. No codebook sidecar, gap repair or
 * clock substitution. Each sample is {value: canonical marker text,timestamp}.
 * The version is supplied by verified startup context for v2/v3; the historical
 * dictionary-only entrypoint retains v1 by default. No hash-probing fallback. */
export async function inspectMasterStream(samples, { planVersion = 1 } = {}) {
  if (![1, 2, 3, 4, 5].includes(planVersion)) throw new Error("Unsupported master plan version.");
  if (!Array.isArray(samples) || samples.length > 200001) throw new Error("Master stream trace exceeds its bound.");
  if (!samples.length) return { status: "incomplete", occurrences: [], issues: [{ code: "missing-profile" }] };
  const profile = parse(samples[0].value, 4 * 1024 * 1024);
  if (profile.schema !== "affect-runner-master-stream-profile") return { status: "incomplete", occurrences: [], issues: [{ code: "missing-profile" }] };
  if (Object.keys(profile).length !== profileKeys.length || profileKeys.some(key => !Object.hasOwn(profile, key)) || profile.version !== 1 || !sha.test(profile.recipeSourceByteSha256) || !sha.test(profile.planIdentitySha256)
    || !code.test(profile.runId) || !code.test(profile.attemptId)) throw new Error("Invalid master profile binding.");
  masterParticipantId(profile.participantId);
  const { profileSha256, ...body } = profile;
  if (profileSha256 !== await canonicalSha256(body)) throw new Error("Master profile integrity differs.");
  const identity = { schema: "affect-runner-master-plan", version: planVersion, algorithmVersion: `master-sequence-v${planVersion}`,
    recipeSourceByteSha256: profile.recipeSourceByteSha256, participantId: profile.participantId, selector: profile.selector };
  if (profile.planIdentitySha256 !== await canonicalSha256(identity)) throw new Error("Master profile has a different immutable selection.");
  for (const key of ["recipeSha256", "variantId", "variantVersionSha256"]) if (profile.plannedProfile[key] !== profile.executionProfile[key]) throw new Error("Master execution profile changes a planned identity.");
  if (profile.selector.variantId !== profile.plannedProfile.variantId) throw new Error("Master profile variant differs from its explicit selection.");
  const plannedEntries = profile.plannedProfile.entries;
  const retained = profile.executionProfile.entries.filter(entry => !entry.entryId.startsWith("form-"));
  if (canonicalJson(retained) !== canonicalJson(plannedEntries) || canonicalJson(profile.executionProfile.codebook.slice(0, profile.plannedProfile.codebook.length)) !== canonicalJson(profile.plannedProfile.codebook)) throw new Error("Master execution profile does not preserve the complete planned dictionary.");
  let last = -Infinity;
  for (const sample of samples) {
    if (!Number.isFinite(sample.timestamp) || sample.timestamp < last) throw new Error("Recorded master LSL timestamps are invalid or reversed.");
    last = sample.timestamp;
  }
  const observations = samples.slice(1).map(sample => parse(sample.value, 2048));
  if (!observations.some(observation => observation.version === 2)) {
    for (const observation of observations) if (observation.runId !== profile.runId || observation.attemptId !== profile.attemptId) throw new Error("Recorded master markers belong to another run or attempt.");
    const result = inspectPlannedMarkerTrace(profile.executionProfile, observations);
    return { ...result, profile, observations, lslTimestamps: samples.map(sample => sample.timestamp) };
  }
  const lifecycle = [];
  let prior = null, activeVideo = null, paused = false, lastTime = -1;
  for (const observation of observations) {
    if (observation.runId !== profile.runId || observation.attemptId !== profile.attemptId) throw new Error("Recorded master markers belong to another run or attempt.");
    if (!Number.isSafeInteger(observation.sequence) || observation.sequence !== (prior?.sequence ?? 0) + 1
      || !Number.isFinite(observation.monotonicMs) || observation.monotonicMs < lastTime) throw new Error("Recorded master marker sequence or clock is invalid.");
    lastTime = observation.monotonicMs;
    if (observation.version === 2) {
      const keys = observation.eventType === "inputEdge" ? [...runnerKeys, "input"] : runnerKeys;
      if (Object.keys(observation).length !== keys.length || keys.some(key => !Object.hasOwn(observation, key))
        || observation.schema !== "affect-research-marker" || !["inputEdge", "neutralReset"].includes(observation.eventType)
        || observation.recipeSha256 !== profile.executionProfile.recipeSha256
        || observation.variantId !== profile.executionProfile.variantId
        || observation.variantVersionSha256 !== profile.executionProfile.variantVersionSha256
        || !Number.isFinite(observation.observedMonotonicMs) || observation.observedMonotonicMs < 0
        || observation.observedMonotonicMs > observation.monotonicMs
        || !code.test(observation.entryId) || !code.test(observation.executionId)
        || !code.test(observation.sourceCode)) throw new Error("Invalid Runner v2 marker.");
      const sameOccurrence = candidate => candidate && ["entryId", "executionId", "sourceCode"].every(key => candidate[key] === observation[key]);
      if (observation.eventType === "inputEdge") {
        const input = observation.input;
        if (!activeVideo || paused || !sameOccurrence(activeVideo)
          || !input || Object.keys(input).length !== inputKeys.length || inputKeys.some(key => !Object.hasOwn(input, key))
          || !["up", "down", "left", "right"].includes(input.direction)
          || ["applyStep", "inputActive", "impulse"].some(key => typeof input[key] !== "boolean")) throw new Error("Input edge is not bound to active video and physical input state.");
      } else if (prior?.eventType !== "videoEnd" || !sameOccurrence(prior)
        || observation.observedMonotonicMs !== observation.monotonicMs) {
        throw new Error("Neutral reset must follow its video end.");
      }
    } else {
      lifecycle.push({ ...observation, sequence: lifecycle.length + 1 });
      if (observation.eventType === "videoStart") { activeVideo = observation; paused = false; }
      else if (observation.eventType === "pause") paused = true;
      else if (observation.eventType === "resume") paused = false;
      else if (["videoEnd", "interruption", "complete", "partial"].includes(observation.eventType)) { activeVideo = null; paused = false; }
    }
    prior = observation;
  }
  const result = inspectPlannedMarkerTrace(profile.executionProfile, lifecycle);
  return { ...result, profile, observations, lslTimestamps: samples.map(sample => sample.timestamp) };
}

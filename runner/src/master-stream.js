import { canonicalJson, canonicalSha256 } from "../../site/src/research/canonical.js";
import { inspectPlannedMarkerTrace } from "../../site/src/research/planned-marker-contract.js";
import { masterParticipantId } from "./master-recipe.js";

const profileKeys = ["schema", "version", "recipeSourceByteSha256", "planIdentitySha256", "participantId", "selector", "runId", "attemptId", "plannedProfile", "executionProfile", "profileSha256"].sort().join(",");
const sha = /^[a-f0-9]{64}$/u, code = /^[A-Za-z][A-Za-z0-9-]{0,95}$/u;
function parse(text, maximum) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > maximum) throw new Error("Master stream payload exceeds its byte bound.");
  const value = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new Error("Master stream payload is not canonical JSON.");
  return value;
}

/** Independent recorded-stream consumer. No codebook sidecar, gap repair or
 * clock substitution. Each sample is {value: canonical marker text,timestamp}. */
export async function inspectMasterStream(samples) {
  if (!Array.isArray(samples) || samples.length > 200001) throw new Error("Master stream trace exceeds its bound.");
  if (!samples.length) return { status: "incomplete", occurrences: [], issues: [{ code: "missing-profile" }] };
  const profile = parse(samples[0].value, 4 * 1024 * 1024);
  if (profile.schema !== "affect-runner-master-stream-profile") return { status: "incomplete", occurrences: [], issues: [{ code: "missing-profile" }] };
  if (Object.keys(profile).sort().join(",") !== profileKeys || profile.version !== 1 || !sha.test(profile.recipeSourceByteSha256) || !sha.test(profile.planIdentitySha256)
    || !code.test(profile.runId) || !code.test(profile.attemptId)) throw new Error("Invalid master profile binding.");
  masterParticipantId(profile.participantId);
  const { profileSha256, ...body } = profile;
  if (profileSha256 !== await canonicalSha256(body)) throw new Error("Master profile integrity differs.");
  const identity = { schema: "affect-runner-master-plan", version: 1, algorithmVersion: "master-sequence-v1",
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
  for (const observation of observations) if (observation.runId !== profile.runId || observation.attemptId !== profile.attemptId) throw new Error("Recorded master markers belong to another run or attempt.");
  const result = inspectPlannedMarkerTrace(profile.executionProfile, observations);
  return { ...result, profile, observations, lslTimestamps: samples.map(sample => sample.timestamp) };
}

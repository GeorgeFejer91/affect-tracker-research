import { boundedInteger, exactKeys, MARKER_CONTRACT } from "./variant-design.js";
import { canonicalSha256 } from "./canonical.js";
import { indexVariantVideos } from "./variant-video-catalogue.js";

const SHA = /^[a-f0-9]{64}$/u;
const CODE = /^[A-Za-z][A-Za-z0-9-]{0,95}$/u;
const KEYS = ["schema", "version", "recipeSha256", "runId", "attemptId", "variantId", "variantVersionSha256", "sequence", "eventType", "entryId", "executionId", "sourceCode", "monotonicMs"];

export async function createPlannedMarkerProfile(contribution, variantId, videos, recipeSha256) {
  const videoIndex = indexVariantVideos(videos, contribution.version === 2 ? 6144 : 160);
  if (!SHA.test(recipeSha256)) throw new TypeError("A marker profile must bind the final recipe SHA-256.");
  const variant = contribution.variants.find(item => item.variantId === variantId);
  if (!variant) throw new TypeError("Unknown variant.");
  const codebook = [], codes = new Map(), entries = [];
  for (const entry of variant.entries) {
    if (contribution.version === 2 && entry.kind === "video" && videoIndex.get(entry.referenceId)?.assetId !== entry.assetId) throw new TypeError("Marker video location and content identity do not match Segment 1.");
    const key = `${entry.kind}:${entry.referenceId}`;
    if (!codes.has(key)) {
      const sourceCode = `source-${codebook.length + 1}`;
      const source = entry.kind === "video" ? videoIndex.get(entry.referenceId)
        : contribution.isiDefinitions.find(isi => isi.isiId === entry.referenceId);
      if (!source) throw new TypeError("Marker source is missing from the accepted catalogue or dictionary.");
      boundedInteger(source.durationMs, entry.kind === "video" ? 1 : 0, entry.kind === "isi" ? 3600000 : Number.MAX_SAFE_INTEGER, "Marker source duration");
      const identitySha256 = entry.kind === "video" ? contribution.version === 2
        ? await canonicalSha256({ annotationId: source.annotationId, assetId: source.assetId })
        : source.sha256 : await canonicalSha256(source);
      if (!SHA.test(identitySha256)) throw new TypeError("Marker source requires its exact identity hash.");
      codes.set(key, sourceCode); codebook.push({ sourceCode, kind: entry.kind, identitySha256, durationMs: source.durationMs });
    }
    entries.push({ entryId: entry.entryId, sourceCode: codes.get(key) });
  }
  return { recipeSha256, variantId, variantVersionSha256: variant.versionSha256, entries, codebook };
}

/** Planned reconstruction specification exercised with synthetic traces, never a recorder or clock. */
export function inspectPlannedMarkerTrace(profile, records) {
  exactKeys(profile, ["recipeSha256", "variantId", "variantVersionSha256", "entries", "codebook"], "Marker profile");
  if (!SHA.test(profile.recipeSha256) || !SHA.test(profile.variantVersionSha256) || !CODE.test(profile.variantId)
    || !Array.isArray(profile.entries) || !profile.entries.length || profile.entries.length > 32000 || !Array.isArray(profile.codebook) || profile.codebook.length > 11024) throw new TypeError("Invalid marker profile.");
  const sources = new Map(), entries = new Map();
  for (const source of profile.codebook) {
    exactKeys(source, ["sourceCode", "kind", "identitySha256", "durationMs"], "Marker codebook entry");
    if (!CODE.test(source.sourceCode) || sources.has(source.sourceCode) || !["video", "isi", "form"].includes(source.kind) || !SHA.test(source.identitySha256)) throw new TypeError("Invalid marker source identity.");
    if (source.kind === "form") { if (source.durationMs !== null) throw new TypeError("Questionnaire response duration is unknown in a plan."); }
    else boundedInteger(source.durationMs, source.kind === "video" ? 1 : 0, source.kind === "isi" ? 3600000 : Number.MAX_SAFE_INTEGER, "Planned source duration");
    sources.set(source.sourceCode, source);
  }
  for (const entry of profile.entries) {
    exactKeys(entry, ["entryId", "sourceCode"], "Planned marker entry");
    if (!CODE.test(entry.entryId) || entries.has(entry.entryId) || !sources.has(entry.sourceCode)) throw new TypeError("Invalid planned marker entry.");
    entries.set(entry.entryId, entry);
  }
  if (!Array.isArray(records) || records.length > 200000) throw new TypeError("Marker trace exceeds its bound.");
  const issues = [], occurrences = [], executions = new Set();
  let previous = 0, lastTime = -1, context = null, started = false, terminal = false, open = null, paused = false, position = 0, restartRequired = false;
  const issue = (sequence, code) => issues.push({ sequence, code });
  for (const record of records) {
    exactKeys(record, KEYS, "Marker envelope");
    if (record.schema !== "affect-research-marker" || record.version !== 1 || record.recipeSha256 !== profile.recipeSha256 || record.variantId !== profile.variantId || record.variantVersionSha256 !== profile.variantVersionSha256
      || !CODE.test(record.runId) || !CODE.test(record.attemptId) || !MARKER_CONTRACT.vocabulary.includes(record.eventType)
      || typeof record.monotonicMs !== "number" || !Number.isFinite(record.monotonicMs) || record.monotonicMs < 0 || record.monotonicMs > Number.MAX_SAFE_INTEGER) throw new TypeError("Marker envelope or profile binding is invalid.");
    boundedInteger(record.sequence, 1, Number.MAX_SAFE_INTEGER, "Marker sequence");
    for (const key of ["entryId", "executionId", "sourceCode"]) if (record[key] !== null && !CODE.test(record[key])) throw new TypeError("Marker identity must be a bounded code or explicit null.");
    const identity = `${record.runId}/${record.attemptId}`;
    if (context && context !== identity) throw new TypeError("A marker trace cannot mix runs or attempts.");
    context = identity;
    if (record.sequence !== previous + 1) issue(record.sequence, "sequence-gap-or-reorder");
    if (record.monotonicMs < lastTime) issue(record.sequence, "time-reversed");
    previous = record.sequence; lastTime = record.monotonicMs;
    if (terminal) { issue(record.sequence, "after-terminal"); continue; }
    const type = record.eventType;
    if (type === "sessionStart") {
      if (started || record.entryId !== null || record.executionId !== null || record.sourceCode !== null) issue(record.sequence, "invalid-session-start");
      started = true; continue;
    }
    if (!started) issue(record.sequence, "missing-session-start");
    if (["videoStart", "isiStart", "formStart"].includes(type)) {
      const entry = profile.entries[position], source = sources.get(record.sourceCode);
      if (open || paused || restartRequired || !entry || entry.entryId !== record.entryId || entry.sourceCode !== record.sourceCode || !source || `${source.kind}Start` !== type || !record.executionId || executions.has(record.executionId)) { issue(record.sequence, "unexpected-occurrence-start"); continue; }
      executions.add(record.executionId); open = { entryId: record.entryId, executionId: record.executionId, sourceCode: record.sourceCode, startMs: record.monotonicMs, endMs: null, state: "open" };
      occurrences.push(open); continue;
    }
    if (["videoEnd", "isiEnd", "formEnd"].includes(type)) {
      const source = sources.get(record.sourceCode);
      if (!open || paused || open.entryId !== record.entryId || open.executionId !== record.executionId || open.sourceCode !== record.sourceCode || !source || `${source.kind}End` !== type) { issue(record.sequence, "unpaired-end"); continue; }
      open.endMs = record.monotonicMs; open.state = "ended"; open = null; position++; continue;
    }
    if (type === "pause" || type === "resume") {
      if (!open || open.entryId !== record.entryId || open.executionId !== record.executionId || open.sourceCode !== record.sourceCode || paused === (type === "pause")) issue(record.sequence, "unpaired-pause-resume");
      else paused = type === "pause";
      continue;
    }
    if (type === "interruption") {
      if (!open || open.entryId !== record.entryId || open.executionId !== record.executionId || open.sourceCode !== record.sourceCode) issue(record.sequence, "unbound-interruption");
      else { open.state = "interrupted"; open = null; paused = false; restartRequired = true; }
      continue;
    }
    if (type === "restart") {
      const prior = occurrences.at(-1);
      if (!restartRequired || !prior || record.entryId !== prior.entryId || record.executionId !== prior.executionId || record.sourceCode !== prior.sourceCode) issue(record.sequence, "unbound-restart");
      else restartRequired = false;
      continue;
    }
    if (type === "complete" || type === "partial") {
      if (record.entryId !== null || record.executionId !== null || record.sourceCode !== null) issue(record.sequence, "invalid-terminal-context");
      if (type === "complete" && (open || paused || restartRequired || position !== profile.entries.length)) issue(record.sequence, "premature-completion");
      terminal = type;
    }
  }
  if (open) issue(previous, "unclosed-occurrence");
  if (!terminal) issue(previous, "missing-terminal");
  return { status: issues.length ? "incomplete" : terminal === "complete" ? "complete" : "partial", occurrences, issues };
}

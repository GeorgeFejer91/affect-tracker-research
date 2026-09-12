import { canonicalJson, canonicalSha256, sha256Hex } from "../../site/src/research/canonical.js";
import { readRunnerRecipe, resolveRunnerSelection } from "./recipe.js";
import { inspectMasterStream } from "./master-stream.js";
import { validateTypedResponseRows } from "./typed-responses.js";

export const INFORMATION_LIMITS = Object.freeze({ frameBytes: 128 * 1024, transferBytes: 64 * 1024 * 1024, chunkBytes: 64 * 1024, frames: 1_000_000 });
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const sha = /^[a-f0-9]{64}$/u, code = /^[A-Za-z][A-Za-z0-9-]{0,95}$/u;
const transferId = /^transfer-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const kinds = ["startup", "observation", "responses", "outcome"];
function require(value, message) { if (!value) throw new Error(message); }
function exact(value, keys, label) {
  require(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing or unknown fields.`);
}
function integer(n, min, max) { return Number.isSafeInteger(n) && n >= min && n <= max; }
function canonicalParse(text, maximum, label) {
  require(typeof text === "string" && text.length <= maximum && encoder.encode(text).length <= maximum, `${label} exceeds its byte bound.`);
  const value = JSON.parse(text);
  require(canonicalJson(value) === text, `${label} is not canonical JSON.`); return value;
}

/** Incremental, one-buffer receiver. Callers must await each push; no frame gap
 * repair, timestamp substitution, implicit retry or unbounded transfer queue. */
export class InformationAssembler {
  constructor() { this.sequence = 0; this.context = null; this.pending = null; this.started = false; this.ended = false; this.failed = false; this.busy = false; this.lastTime = -Infinity; this.ids = new Set(); }
  async push(sample) {
    require(!this.failed && !this.busy && !this.ended, "Information receiver is closed or busy."); this.busy = true;
    try { return await this.accept(sample); }
    catch (error) { this.failed = true; this.pending = null; throw error; }
    finally { this.busy = false; }
  }
  async accept(sample) {
    exact(sample, ["value", "timestamp"], "Information sample");
    const frame = canonicalParse(sample.value, INFORMATION_LIMITS.frameBytes, "Information frame");
    exact(frame, ["schema", "version", "runId", "attemptId", "recipeSourceByteSha256", "sequence", "payload"], "Information frame");
    require(frame.schema === "affect-runner-information" && frame.version === 1 && code.test(frame.runId) && code.test(frame.attemptId) && sha.test(frame.recipeSourceByteSha256), "Invalid information context.");
    require(integer(frame.sequence, 1, INFORMATION_LIMITS.frames) && frame.sequence === this.sequence + 1, "Information frame sequence gap, duplicate or reorder.");
    const context = { runId: frame.runId, attemptId: frame.attemptId, recipeSourceByteSha256: frame.recipeSourceByteSha256 };
    require(!this.context || canonicalJson(context) === canonicalJson(this.context), "Information context changed.");
    require(Number.isFinite(sample.timestamp) && sample.timestamp >= this.lastTime, "Information LSL timestamps are invalid or reversed.");
    this.context = context; this.sequence = frame.sequence; this.lastTime = sample.timestamp;
    const p = frame.payload;
    require(p && transferId.test(p.transferId), "Invalid information transfer ID.");
    if (p.kind === "header") {
      exact(p, ["kind", "transferId", "contentKind", "byteLength", "sha256", "chunkCount"], "Information header");
      require(!this.pending && !this.ids.has(p.transferId), "Overlapping or duplicate information transfer.");
      require(kinds.includes(p.contentKind) && this.started !== (p.contentKind === "startup"), "Information startup must be first and unique.");
      require(integer(p.byteLength, 1, INFORMATION_LIMITS.transferBytes) && sha.test(p.sha256) && p.chunkCount === Math.ceil(p.byteLength / INFORMATION_LIMITS.chunkBytes), "Information header length, hash or chunk count exceeds its bound.");
      this.ids.add(p.transferId);
      this.pending = { header: p, bytes: new Uint8Array(p.byteLength), next: 0, offset: 0, timestamp: sample.timestamp, sequence: frame.sequence };
      return null;
    }
    const active = this.pending;
    require(active && active.header.transferId === p.transferId, "Information chunk or commit has no matching header.");
    require(sample.timestamp - active.timestamp <= 30, "Information transfer publication exceeded 30 seconds.");
    if (p.kind === "chunk") {
      exact(p, ["kind", "transferId", "index", "data"], "Information chunk");
      require(p.index === active.next && p.index < active.header.chunkCount, "Information chunk index is missing, duplicated or reordered.");
      const length = Math.min(INFORMATION_LIMITS.chunkBytes, active.bytes.length - active.offset);
      require(typeof p.data === "string" && p.data.length === 4 * Math.ceil(length / 3) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(p.data), "Information chunk has invalid base64 or length.");
      const raw = atob(p.data);
      require(raw.length === length && btoa(raw) === p.data, "Information chunk is not canonical base64.");
      active.bytes.set(Uint8Array.from(raw, c => c.charCodeAt(0)), active.offset); active.offset += length; active.next++;
      return null;
    }
    exact(p, ["kind", "transferId", "sha256"], "Information commit");
    require(p.kind === "commit" && active.next === active.header.chunkCount && active.offset === active.bytes.length, "Information commit precedes complete chunks.");
    require(p.sha256 === active.header.sha256 && p.sha256 === await sha256Hex(active.bytes), "Information transfer hash differs.");
    const value = canonicalParse(decoder.decode(active.bytes), INFORMATION_LIMITS.transferBytes, "Information transfer");
    const result = { kind: active.header.contentKind, value, byteLength: active.bytes.length, firstSequence: active.sequence, lastSequence: frame.sequence, firstLslTimeSeconds: active.timestamp, commitLslTimeSeconds: sample.timestamp };
    this.pending = null; this.started = true; this.ended = result.kind === "outcome"; return result;
  }
  finish() { return { complete: !this.failed && !this.pending && this.started && this.ended, frameCount: this.sequence, context: this.context }; }
}

async function reconstructStartup(startup, context) {
  require(startup?.schema === "affect-runner-startup" && [1, 2, 3].includes(startup.version) && startup.recipeSourceByteSha256 === context.recipeSourceByteSha256, "Invalid startup identity.");
  const keys = ["schema", "version", "recipeSourceText", "recipeSourceByteSha256", "planIdentitySha256", "participantId", "selector", "markerProfile", "effectiveLsl", "build"];
  if (startup.version === 1) keys.push("legacyCodedParticipant");
  exact(startup, keys, "Information startup");
  const receipt = await readRunnerRecipe(encoder.encode(startup.recipeSourceText));
  require(receipt.recipe && receipt.canonicalSourceText === startup.recipeSourceText && receipt.canonicalSourceByteSha256 === startup.recipeSourceByteSha256, "Startup does not contain its exact canonical master source.");
  const plan = await resolveRunnerSelection(receipt, startup.participantId, startup.selector.languageSelectionPath, startup.selector.variantId);
  require(plan.version === startup.version, "Startup version differs from its exact master source.");
  require(plan.planIdentitySha256 === startup.planIdentitySha256 && canonicalJson(plan.selector) === canonicalJson(startup.selector), "Startup selection differs from reconstructed master.");
  const planned = plan.selected.markerProfile, execution = structuredClone(planned); execution.entries = [];
  for (const step of plan.steps) {
    const sourceCode = step.kind === "questionnaire" ? `form-source-${step.position}` : step.sourceCode;
    if (step.kind === "questionnaire") execution.codebook.push({ sourceCode, kind: "form", identitySha256: step.payload.definition.definitionSha256, durationMs: null });
    execution.entries.push({ entryId: step.entryId, sourceCode });
  }
  const profile = { schema: "affect-runner-master-stream-profile", version: 1, ...context, participantId: plan.participantId, planIdentitySha256: plan.planIdentitySha256, selector: plan.selector, plannedProfile: planned, executionProfile: execution };
  profile.profileSha256 = await canonicalSha256(profile);
  require(canonicalJson(profile) === canonicalJson(startup.markerProfile), "Startup marker profile differs from complete reconstructed definitions.");
  const lsl = structuredClone(plan.selected.policy.lsl), prefix = `P${String(Number(plan.participantId.slice(1))).padStart(2, "0")}_`;
  lsl.stateStream = prefix + lsl.stateStream; lsl.markerStream = prefix + lsl.markerStream;
  require(lsl.enabled && canonicalJson(lsl) === canonicalJson(startup.effectiveLsl), "Information stream names or policy differ from the selected participant.");
  exact(startup.build, ["commit", "appVersion"], "Startup build");
  require(typeof startup.build.commit === "string" && /^[a-f0-9]{7,64}(?:-dirty)?$/u.test(startup.build.commit) && typeof startup.build.appVersion === "string" && startup.build.appVersion.length <= 100, "Invalid startup build identity.");
  // Historical startup1 retains its coded participant preparation. Startup2/3
  // binds only participantId; demographics are ordinary mandatory form answers.
  if (startup.version === 1) {
    const p = startup.legacyCodedParticipant;
    exact(p, ["participantId", "participantCode", "age", "gender", "handedness"], "Legacy participant");
    require(p.participantId === plan.participantId && typeof p.participantCode === "string" && encoder.encode(p.participantCode).length <= 32 && p.participantCode === p.participantCode.normalize("NFC").toUpperCase() && [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(p.participantCode)].length === 2 && !/[<>:"/\\|?*_\p{Cc}]/u.test(p.participantCode) && integer(p.age, 1, 120) && ["W", "M", "N", "S", "X"].includes(p.gender) && ["L", "R", "A"].includes(p.handedness), "Invalid legacy coded participant.");
  }
  return plan;
}

function validateResponses(record, plan, context, open, alreadySubmitted) {
  exact(record, ["schema", "version", "entryId", "position", "module", "questionnaireId", "questionnaireVersion", "definitionSha256", "status", "responses", "runId", "attemptId", "participantId", "recipeSourceByteSha256", "planIdentitySha256", "monotonicMs"], "Response record");
  require(record.schema === "affect-runner-master-responses" && record.version === ({1:1,2:2,3:2}[plan.version]) && ["draft", "submitted"].includes(record.status), "Unsupported response schema or status.");
  const step = plan.steps[record.position - 1];
  require(step?.kind === "questionnaire" && step.entryId === record.entryId && open === record.entryId && !alreadySubmitted.has(record.entryId), "Answers do not belong to the current unsubmitted form occurrence.");
  const definition = step.payload.definition;
  for (const key of ["runId", "attemptId", "recipeSourceByteSha256"]) require(record[key] === context[key], "Responses belong to another attempt.");
  require(record.participantId === plan.participantId && record.planIdentitySha256 === plan.planIdentitySha256 && canonicalJson(record.module) === canonicalJson(step.payload.module), "Response selection or module differs.");
  for (const key of ["questionnaireId", "questionnaireVersion", "definitionSha256"]) require(record[key] === definition[key], "Response definition differs.");
  if (definition.schema === "affect-research-form-definition" && definition.version === 1 && [2, 3].includes(plan.version)) {
    validateTypedResponseRows(definition, record.responses, { submitted: record.status === "submitted", monotonicMs: record.monotonicMs });
    if (record.status === "submitted") alreadySubmitted.add(record.entryId);
    return;
  }
  require(definition.schema === "affect-research-questionnaire-definition" && definition.version === 1, "Unsupported response definition.");
  require(Array.isArray(record.responses) && record.responses.length <= definition.items.length, "Response count exceeds definition.");
  let previous = 0;
  for (const response of record.responses) {
    exact(response, ["itemId", "itemOrder", "optionId", "optionOrder", "responseLabel", "scoreValue", "subscale", "responseLatencyMs"], "Questionnaire response");
    const item = definition.items.find(i => i.itemId === response.itemId), option = item?.options.find(o => o.optionId === response.optionId);
    require(item && option && item.order === response.itemOrder && item.order > previous && option.order === response.optionOrder && option.label === response.responseLabel && option.scoreValue === response.scoreValue && item.subscale === response.subscale, "Answer identity, order, label or score differs from its frozen definition.");
    require(Number.isFinite(response.responseLatencyMs) && response.responseLatencyMs >= 0 && response.responseLatencyMs <= Math.min(86_400_000, record.monotonicMs), "Invalid native response latency."); previous = item.order;
  }
  require(record.status !== "submitted" || record.responses.length === definition.items.length, "Every questionnaire item must be answered before submission.");
  if (record.status === "submitted") alreadySubmitted.add(record.entryId);
}

/** Reconstruct from recorded information only. The caller independently checks
 * XDF footers; protocol completion alone never asserts recording finalization.
 * This convenience collector caps retained decoded data at 256 MiB. Larger
 * analyses can consume the bounded incremental assembler without collecting. */
export async function inspectInformationStream(samples) {
  require(Array.isArray(samples) && samples.length <= INFORMATION_LIMITS.frames, "Information trace exceeds its frame bound.");
  const assembler = new InformationAssembler(), records = [], issues = [], submitted = new Set(), markerSamples = [];
  let startup = null, plan = null, outcome = null, openForm = null, monotonic = -1, retainedBytes = 0;
  for (const sample of samples) {
    const transfer = await assembler.push(sample); if (!transfer) continue;
    retainedBytes += transfer.byteLength;
    require(retainedBytes <= 256 * 1024 * 1024, "Information collector exceeds its retained-data bound; use incremental analysis.");
    const value = transfer.value;
    if (transfer.kind === "startup") {
      startup = value; plan = await reconstructStartup(startup, assembler.context);
      markerSamples.push({ value: canonicalJson(startup.markerProfile), timestamp: transfer.commitLslTimeSeconds });
    } else {
      require(Number.isFinite(value.monotonicMs) && value.monotonicMs >= monotonic && value.monotonicMs >= 0 && value.monotonicMs <= Number.MAX_SAFE_INTEGER, "Native observation clock is invalid or reversed."); monotonic = value.monotonicMs;
      if (transfer.kind === "observation") {
        markerSamples.push({ value: canonicalJson(value), timestamp: transfer.firstLslTimeSeconds });
        if (value.eventType === "formStart") openForm = value.entryId;
        if (value.eventType === "formEnd") { if (!submitted.has(value.entryId)) issues.push({ code: "form-ended-without-submission", entryId: value.entryId }); openForm = null; }
        if (["interruption", "partial", "complete"].includes(value.eventType)) openForm = null;
      } else if (transfer.kind === "responses") validateResponses(value, plan, assembler.context, openForm, submitted);
      else {
        exact(value, ["schema", "version", "protocolOutcome", "completedStepCount", "failureCode", "monotonicMs", "localCheckpoint", "recordingFinalization"], "Outcome");
        require(value.schema === "affect-runner-outcome" && value.version === 1 && ["completed", "partial"].includes(value.protocolOutcome) && integer(value.completedStepCount, 0, plan.steps.length) && (value.failureCode === null || typeof value.failureCode === "string" && /^[a-zA-Z0-9_-]{1,128}$/u.test(value.failureCode)) && value.localCheckpoint === "durable" && value.recordingFinalization === "pending", "Invalid native outcome.");
        outcome = value;
      }
    }
    records.push(transfer);
  }
  const framing = assembler.finish();
  if (!framing.complete) issues.push({ code: "uncommitted-or-missing-information" });
  const trace = await inspectMasterStream(markerSamples, { planVersion: plan?.version ?? 1 });
  issues.push(...trace.issues);
  if (outcome) {
    require(outcome.completedStepCount === trace.occurrences.filter(o => o.state === "ended").length, "Outcome completed count differs from observed occurrences.");
    const terminal = trace.observations?.at(-1)?.eventType;
    require(terminal === (outcome.protocolOutcome === "completed" ? "complete" : "partial"), "Outcome differs from observed terminal marker.");
    require(outcome.protocolOutcome !== "completed" || outcome.failureCode === null, "Completed outcome contains a failure.");
  }
  return { status: issues.length ? "incomplete" : trace.status, recordingFinalization: "requires-xdf-footer-verification", startup, plan, records, occurrences: trace.occurrences, outcome, issues, framing };
}

import {
  RESEARCH_EVENT_SCHEMA,
  RESEARCH_EVENT_TYPES,
  RESEARCH_RUN_MANIFEST_SCHEMA,
  validateResearchEventV1,
} from "./contracts.js";
import { createSessionStem } from "./identity.js";

export const RESEARCH_RUN_MANIFEST_V3_SCHEMA = RESEARCH_RUN_MANIFEST_SCHEMA;

export const RESEARCH_EVENT_V2_TYPES = Object.freeze([
  ...RESEARCH_EVENT_TYPES,
  "questionnaireStarted",
  "questionnaireDraftCheckpointed",
  "questionnaireCompleted",
]);

export const RESEARCH_MANIFEST_V3_OUTPUT_KINDS = Object.freeze([
  "settings",
  "protocolPlan",
  "events",
  "ratingsCsv",
  "ratingsTsv",
  "questionnaireCsv",
  "questionnaireTsv",
]);

const QUESTIONNAIRE_EVENT_TYPES = new Set([
  "questionnaireStarted",
  "questionnaireDraftCheckpointed",
  "questionnaireCompleted",
]);
const HASH = /^[a-f0-9]{64}$/u;
const CANONICAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const PARTICIPANT_ID = /^P\d{3,6}$/u;
const MONOTONIC_NS = /^(0|[1-9]\d{0,29})$/u;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const MAX_STIMULI = 10_000;
const MAX_PROTOCOL_STEPS = 20_000;
const MAX_PARTICIPANTS = 100_000;

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, path, fields) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path} contains unknown field ${unknown}.`);
  const missing = fields.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`${path} is missing required field ${missing}.`);
  return value;
}

function text(value, path, { maximum = 240, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || value.trim().normalize("NFC") !== value || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${path} must be bounded canonical text.`);
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TypeError(`${path} must be a safe identifier.`);
  }
  return value;
}

function participantId(value, path) {
  if (typeof value !== "string" || !PARTICIPANT_ID.test(value)
    || Number(value.slice(1)) < 1 || Number(value.slice(1)) > MAX_PARTICIPANTS) {
    throw new TypeError(`${path} must be a P-prefixed zero-padded participant ID.`);
  }
  return value;
}

function sha256(value, path) {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be an integer within ${minimum}–${maximum}.`);
  }
  return value;
}

function enumeration(value, path, values) {
  if (!values.includes(value)) throw new TypeError(`${path} must be one of: ${values.join(", ")}.`);
  return value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be true or false.`);
  return value;
}

function utc(value, path) {
  const normalized = text(value, path, { maximum: 40 });
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 timestamp.`);
  }
  return normalized;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function stimulusIdentity(value, path) {
  exactObject(value, path, [
    "kind", "stimulusId", "sha256", "byteLength", "durationMs", "url", "videoId",
  ]);
  const kind = enumeration(value.kind, `${path}.kind`, ["workspaceFile", "repositoryAsset", "youtube"]);
  const durationMs = integer(value.durationMs, `${path}.durationMs`, 1, 86_400_000);
  const output = {
    kind,
    stimulusId: identifier(value.stimulusId, `${path}.stimulusId`),
    sha256: value.sha256 === null ? null : sha256(value.sha256, `${path}.sha256`),
    byteLength: value.byteLength === null ? null : integer(value.byteLength, `${path}.byteLength`, 1),
    durationMs,
    url: value.url === null ? null : text(value.url, `${path}.url`, { maximum: 2_048 }),
    videoId: value.videoId === null ? null : text(value.videoId, `${path}.videoId`, { maximum: 11 }),
  };
  if (kind === "youtube") {
    if (output.sha256 !== null || output.byteLength !== null || output.url === null || output.videoId === null) {
      throw new TypeError(`${path} experimental YouTube identity cannot claim local bytes.`);
    }
    let parsed;
    try { parsed = new URL(output.url); } catch { throw new TypeError(`${path}.url must be an absolute URL.`); }
    if (!YOUTUBE_VIDEO_ID.test(output.videoId)
      || parsed.protocol !== "https:" || parsed.hostname !== "www.youtube.com"
      || parsed.pathname !== "/watch" || parsed.searchParams.size !== 1
      || parsed.searchParams.get("v") !== output.videoId || parsed.hash !== ""
      || parsed.username !== "" || parsed.password !== "" || parsed.port !== ""
      || parsed.toString() !== output.url) {
      throw new TypeError(`${path} has a noncanonical YouTube URL or video ID.`);
    }
  } else if (output.sha256 === null || output.byteLength === null
    || output.url !== null || output.videoId !== null) {
    throw new TypeError(`${path} local identity requires hash and byte length only.`);
  }
  return output;
}

/** Strict ResearchEventV2 reader. Historical ResearchEventV1 remains unchanged. */
export function validateResearchEventV2(value) {
  exactObject(value, "ResearchEventV2", [
    "schema", "version", "sequence", "runId", "participantId", "attemptNumber",
    "settingsSha256", "assignmentPlanSha256", "protocolPlanSha256",
    "wallTimeUtc", "monotonicTimeNs", "type", "stimulusIdentity", "stimulusPosition",
    "protocolStepPosition", "moduleId", "questionnaireId", "definitionSha256",
    "mediaTimeMs", "missedSlotCount", "detailCode",
  ]);
  if (value.schema !== RESEARCH_EVENT_SCHEMA || value.version !== 2) {
    throw new TypeError("ResearchEventV2 has an unsupported schema or version.");
  }
  if (!RESEARCH_EVENT_V2_TYPES.includes(value.type)) {
    throw new TypeError("ResearchEventV2 has an unsupported event type.");
  }
  if (typeof value.runId !== "string" || !CANONICAL_UUID.test(value.runId)) {
    throw new TypeError("ResearchEventV2.runId must be a canonical UUID.");
  }
  if (typeof value.monotonicTimeNs !== "string" || !MONOTONIC_NS.test(value.monotonicTimeNs)) {
    throw new TypeError("ResearchEventV2.monotonicTimeNs must be unsigned decimal nanoseconds.");
  }
  const questionnaireEvent = QUESTIONNAIRE_EVENT_TYPES.has(value.type);
  const projected = validateResearchEventV1({
    schema: RESEARCH_EVENT_SCHEMA,
    version: 1,
    sequence: value.sequence,
    runId: value.runId,
    participantId: value.participantId,
    attemptNumber: value.attemptNumber,
    settingsSha256: value.settingsSha256,
    assignmentPlanSha256: value.assignmentPlanSha256,
    wallTimeUtc: value.wallTimeUtc,
    monotonicTimeNs: value.monotonicTimeNs,
    type: questionnaireEvent ? "sessionStarted" : value.type,
    stimulusIdentity: value.stimulusIdentity,
    stimulusPosition: value.stimulusPosition,
    mediaTimeMs: value.mediaTimeMs,
    missedSlotCount: value.missedSlotCount,
    detailCode: value.detailCode,
  });
  const protocolStepPosition = value.protocolStepPosition === null
    ? null
    : integer(value.protocolStepPosition, "ResearchEventV2.protocolStepPosition", 1, MAX_PROTOCOL_STEPS);
  let moduleId = null;
  let questionnaireId = null;
  let definitionSha256 = null;
  if (questionnaireEvent) {
    if (protocolStepPosition === null || value.stimulusIdentity !== null
      || value.stimulusPosition !== null || value.mediaTimeMs !== null
      || value.missedSlotCount !== null) {
      throw new TypeError("Questionnaire events require one protocol step and no stimulus timing.");
    }
    moduleId = identifier(value.moduleId, "ResearchEventV2.moduleId");
    questionnaireId = identifier(value.questionnaireId, "ResearchEventV2.questionnaireId");
    definitionSha256 = sha256(value.definitionSha256, "ResearchEventV2.definitionSha256");
  } else if (value.moduleId !== null || value.questionnaireId !== null
    || value.definitionSha256 !== null) {
    throw new TypeError("Non-questionnaire events cannot carry questionnaire identity.");
  }
  if (!questionnaireEvent && value.stimulusIdentity !== null && protocolStepPosition === null) {
    throw new TypeError("Stimulus events require their frozen protocol step position.");
  }
  return deepFreeze({
    ...projected,
    version: 2,
    protocolPlanSha256: sha256(value.protocolPlanSha256, "ResearchEventV2.protocolPlanSha256"),
    type: value.type,
    protocolStepPosition,
    moduleId,
    questionnaireId,
    definitionSha256,
  });
}

function manifestOutput(value, path) {
  exactObject(value, path, ["kind", "fileName", "sha256", "byteLength", "rowCount"]);
  const kind = enumeration(value.kind, `${path}.kind`, RESEARCH_MANIFEST_V3_OUTPUT_KINDS);
  const fileName = text(value.fileName, `${path}.fileName`, { maximum: 240 });
  if (fileName === "." || fileName === ".." || /[<>:"/\\|?*]|\p{Cc}/u.test(fileName)) {
    throw new TypeError(`${path}.fileName must be a safe basename.`);
  }
  const tabular = kind.startsWith("ratings") || kind.startsWith("questionnaire");
  const rowCount = value.rowCount === null
    ? null
    : integer(value.rowCount, `${path}.rowCount`);
  if (tabular !== (rowCount !== null)) {
    throw new TypeError(`${path}.rowCount must be present exactly for tabular outputs.`);
  }
  return {
    kind,
    fileName,
    sha256: sha256(value.sha256, `${path}.sha256`),
    byteLength: integer(value.byteLength, `${path}.byteLength`, 1),
    rowCount,
  };
}

function questionnaireDefinitionReceipt(value, path) {
  exactObject(value, path, ["questionnaireId", "definitionSha256"]);
  return {
    questionnaireId: identifier(value.questionnaireId, `${path}.questionnaireId`),
    definitionSha256: sha256(value.definitionSha256, `${path}.definitionSha256`),
  };
}

function questionnaireModuleReceipt(value, path) {
  exactObject(value, path, [
    "protocolStepPosition", "moduleId", "questionnaireId", "definitionSha256",
    "status", "responseCount",
  ]);
  const status = enumeration(value.status, `${path}.status`, ["submitted", "draft", "notReached"]);
  const responseCount = integer(value.responseCount, `${path}.responseCount`);
  if (status === "notReached" && responseCount !== 0) {
    throw new TypeError(`${path} notReached module cannot have response rows.`);
  }
  return {
    protocolStepPosition: integer(value.protocolStepPosition, `${path}.protocolStepPosition`, 1, MAX_PROTOCOL_STEPS),
    moduleId: identifier(value.moduleId, `${path}.moduleId`),
    questionnaireId: identifier(value.questionnaireId, `${path}.questionnaireId`),
    definitionSha256: sha256(value.definitionSha256, `${path}.definitionSha256`),
    status,
    responseCount,
  };
}

/** Strict ResearchRunManifestV3 reader. Historical ManifestV2 remains unchanged. */
export function validateResearchRunManifestV3(value) {
  exactObject(value, "ResearchRunManifestV3", [
    "schema", "version", "runId", "experimentId", "participantId", "participantCode",
    "age", "gender", "handedness", "attemptNumber", "sessionStem", "completionStatus",
    "playbackMode", "playbackQualification", "settingsSha256", "assignmentPlanSha256",
    "protocolPlanSha256", "stimuli", "protocol", "timing", "outputs", "recovery", "build",
  ]);
  if (value.schema !== RESEARCH_RUN_MANIFEST_V3_SCHEMA || value.version !== 3) {
    throw new TypeError("ResearchRunManifestV3 has an unsupported schema or version.");
  }
  if (typeof value.runId !== "string" || !CANONICAL_UUID.test(value.runId)) {
    throw new TypeError("ResearchRunManifestV3.runId must be a canonical UUID.");
  }
  exactObject(value.protocol, "ResearchRunManifestV3.protocol", [
    "safeProtocolStepPosition", "protocolStepCount", "questionnaireDefinitions",
    "questionnaireModules", "submittedResponseCount", "draftResponseCount",
    "submittedResponsesSha256", "draftResponsesSha256",
  ]);
  exactObject(value.timing, "ResearchRunManifestV3.timing", [
    "sampleRateHz", "sampleCount", "eventCount", "gapEventCount", "missedSlotCount",
    "questionnaireSubmittedResponseCount", "questionnaireDraftResponseCount",
    "startedAt", "finalizedAt",
  ]);
  exactObject(value.recovery, "ResearchRunManifestV3.recovery", [
    "resumed", "sourceRunId", "restartedStimulusIds",
  ]);
  exactObject(value.build, "ResearchRunManifestV3.build", [
    "platform", "appVersion", "buildCommit",
  ]);
  if (!Array.isArray(value.stimuli) || value.stimuli.length < 1
    || value.stimuli.length > MAX_STIMULI) {
    throw new RangeError("ResearchRunManifestV3.stimuli are invalid.");
  }
  if (!Array.isArray(value.outputs) || value.outputs.length < 5
    || value.outputs.length > RESEARCH_MANIFEST_V3_OUTPUT_KINDS.length) {
    throw new RangeError("ResearchRunManifestV3.outputs are invalid.");
  }
  if (!Array.isArray(value.protocol.questionnaireDefinitions)
    || value.protocol.questionnaireDefinitions.length > 256
    || !Array.isArray(value.protocol.questionnaireModules)
    || value.protocol.questionnaireModules.length > 1_024) {
    throw new RangeError("ResearchRunManifestV3 questionnaire receipts are invalid.");
  }
  if (!Array.isArray(value.recovery.restartedStimulusIds)
    || value.recovery.restartedStimulusIds.length > MAX_STIMULI) {
    throw new RangeError("ResearchRunManifestV3 recovery stimuli are invalid.");
  }

  const participantCode = text(value.participantCode, "ResearchRunManifestV3.participantCode", { maximum: 32 });
  if (participantCode !== participantCode.toLocaleUpperCase("und")
    || /[<>:"/\\|?*_]|\p{Cc}/u.test(participantCode)) {
    throw new TypeError("ResearchRunManifestV3.participantCode must be uppercase and filename-safe.");
  }
  const stimuli = value.stimuli.map((entry, index) => (
    stimulusIdentity(entry, `ResearchRunManifestV3.stimuli[${index}]`)
  ));
  if (new Set(stimuli.map(({ stimulusId }) => stimulusId)).size !== stimuli.length) {
    throw new TypeError("ResearchRunManifestV3 has duplicate stimuli.");
  }
  const definitions = value.protocol.questionnaireDefinitions.map((entry, index) => (
    questionnaireDefinitionReceipt(entry, `ResearchRunManifestV3.protocol.questionnaireDefinitions[${index}]`)
  ));
  if (new Set(definitions.map(({ questionnaireId }) => questionnaireId)).size !== definitions.length
    || new Set(definitions.map(({ definitionSha256 }) => definitionSha256)).size !== definitions.length) {
    throw new TypeError("ResearchRunManifestV3 has duplicate questionnaire definitions or hashes.");
  }
  const modules = value.protocol.questionnaireModules.map((entry, index) => (
    questionnaireModuleReceipt(entry, `ResearchRunManifestV3.protocol.questionnaireModules[${index}]`)
  ));
  if (new Set(modules.map(({ moduleId }) => moduleId)).size !== modules.length
    || new Set(modules.map(({ protocolStepPosition }) => protocolStepPosition)).size !== modules.length) {
    throw new TypeError("ResearchRunManifestV3 has duplicate questionnaire modules or positions.");
  }
  if (modules.filter(({ status }) => status === "draft").length > 1) {
    throw new TypeError("ResearchRunManifestV3 may retain at most one active questionnaire draft.");
  }
  const outputs = value.outputs.map((entry, index) => (
    manifestOutput(entry, `ResearchRunManifestV3.outputs[${index}]`)
  ));
  const outputKinds = new Set(outputs.map(({ kind }) => kind));
  const outputFileNames = new Set(outputs.map(({ fileName }) => fileName));
  if (outputKinds.size !== outputs.length
    || !["settings", "protocolPlan", "events"].every((kind) => outputKinds.has(kind))
    || !["ratingsCsv", "ratingsTsv"].some((kind) => outputKinds.has(kind))
    || !["questionnaireCsv", "questionnaireTsv"].some((kind) => outputKinds.has(kind))) {
    throw new TypeError("ResearchRunManifestV3 requires unique snapshots/events and selected rating and questionnaire tables.");
  }
  if (outputFileNames.size !== outputs.length) {
    throw new TypeError("ResearchRunManifestV3 output file names must be unique.");
  }

  const output = {
    schema: RESEARCH_RUN_MANIFEST_V3_SCHEMA,
    version: 3,
    runId: value.runId,
    experimentId: identifier(value.experimentId, "ResearchRunManifestV3.experimentId"),
    participantId: participantId(value.participantId, "ResearchRunManifestV3.participantId"),
    participantCode,
    age: integer(value.age, "ResearchRunManifestV3.age", 1, 120),
    gender: enumeration(value.gender, "ResearchRunManifestV3.gender", ["W", "M", "N", "S", "X"]),
    handedness: enumeration(value.handedness, "ResearchRunManifestV3.handedness", ["L", "R", "A"]),
    attemptNumber: integer(value.attemptNumber, "ResearchRunManifestV3.attemptNumber", 1, 999_999),
    sessionStem: text(value.sessionStem, "ResearchRunManifestV3.sessionStem", { maximum: 240 }),
    completionStatus: enumeration(value.completionStatus, "ResearchRunManifestV3.completionStatus", ["completed", "partial"]),
    playbackMode: enumeration(value.playbackMode, "ResearchRunManifestV3.playbackMode", ["nativeGstPlay", "unqualifiedWebview", "browserMediaAdapters"]),
    playbackQualification: enumeration(value.playbackQualification, "ResearchRunManifestV3.playbackQualification", ["qualifiedNative", "unqualified", "browser"]),
    settingsSha256: sha256(value.settingsSha256, "ResearchRunManifestV3.settingsSha256"),
    assignmentPlanSha256: sha256(value.assignmentPlanSha256, "ResearchRunManifestV3.assignmentPlanSha256"),
    protocolPlanSha256: sha256(value.protocolPlanSha256, "ResearchRunManifestV3.protocolPlanSha256"),
    stimuli,
    protocol: {
      safeProtocolStepPosition: integer(value.protocol.safeProtocolStepPosition, "ResearchRunManifestV3.protocol.safeProtocolStepPosition", 0, MAX_PROTOCOL_STEPS),
      protocolStepCount: integer(value.protocol.protocolStepCount, "ResearchRunManifestV3.protocol.protocolStepCount", 1, MAX_PROTOCOL_STEPS),
      questionnaireDefinitions: definitions,
      questionnaireModules: modules,
      submittedResponseCount: integer(value.protocol.submittedResponseCount, "ResearchRunManifestV3.protocol.submittedResponseCount"),
      draftResponseCount: integer(value.protocol.draftResponseCount, "ResearchRunManifestV3.protocol.draftResponseCount"),
      submittedResponsesSha256: sha256(value.protocol.submittedResponsesSha256, "ResearchRunManifestV3.protocol.submittedResponsesSha256"),
      draftResponsesSha256: sha256(value.protocol.draftResponsesSha256, "ResearchRunManifestV3.protocol.draftResponsesSha256"),
    },
    timing: {
      sampleRateHz: integer(value.timing.sampleRateHz, "ResearchRunManifestV3.timing.sampleRateHz", 1, 240),
      sampleCount: integer(value.timing.sampleCount, "ResearchRunManifestV3.timing.sampleCount"),
      eventCount: integer(value.timing.eventCount, "ResearchRunManifestV3.timing.eventCount"),
      gapEventCount: integer(value.timing.gapEventCount, "ResearchRunManifestV3.timing.gapEventCount"),
      missedSlotCount: integer(value.timing.missedSlotCount, "ResearchRunManifestV3.timing.missedSlotCount"),
      questionnaireSubmittedResponseCount: integer(value.timing.questionnaireSubmittedResponseCount, "ResearchRunManifestV3.timing.questionnaireSubmittedResponseCount"),
      questionnaireDraftResponseCount: integer(value.timing.questionnaireDraftResponseCount, "ResearchRunManifestV3.timing.questionnaireDraftResponseCount"),
      startedAt: utc(value.timing.startedAt, "ResearchRunManifestV3.timing.startedAt"),
      finalizedAt: utc(value.timing.finalizedAt, "ResearchRunManifestV3.timing.finalizedAt"),
    },
    outputs,
    recovery: {
      resumed: boolean(value.recovery.resumed, "ResearchRunManifestV3.recovery.resumed"),
      sourceRunId: value.recovery.sourceRunId === null
        ? null
        : text(value.recovery.sourceRunId, "ResearchRunManifestV3.recovery.sourceRunId", { maximum: 128 }),
      restartedStimulusIds: value.recovery.restartedStimulusIds.map((id, index) => (
        identifier(id, `ResearchRunManifestV3.recovery.restartedStimulusIds[${index}]`)
      )),
    },
    build: {
      platform: enumeration(value.build.platform, "ResearchRunManifestV3.build.platform", ["tauri-windows", "chrome", "edge"]),
      appVersion: text(value.build.appVersion, "ResearchRunManifestV3.build.appVersion", { maximum: 40 }),
      buildCommit: text(value.build.buildCommit, "ResearchRunManifestV3.build.buildCommit", { maximum: 64 }),
    },
  };

  if (/[<>:"/\\|?*]|\p{Cc}/u.test(output.sessionStem)) {
    throw new TypeError("ResearchRunManifestV3.sessionStem must be a safe basename.");
  }
  const playbackPair = `${output.playbackMode}:${output.playbackQualification}`;
  const validPlayback = output.build.platform === "tauri-windows"
    ? ["nativeGstPlay:qualifiedNative", "unqualifiedWebview:unqualified"].includes(playbackPair)
    : playbackPair === "browserMediaAdapters:browser";
  if (!validPlayback) throw new TypeError("ResearchRunManifestV3 playback mode and qualification do not match its platform.");
  if (output.recovery.sourceRunId !== null && !CANONICAL_UUID.test(output.recovery.sourceRunId)) {
    throw new TypeError("ResearchRunManifestV3.recovery.sourceRunId must be a canonical UUID.");
  }
  if (output.recovery.resumed !== (output.recovery.sourceRunId !== null)) {
    throw new TypeError("ResearchRunManifestV3 recovery source does not match resumed state.");
  }
  if (new Date(output.timing.finalizedAt) < new Date(output.timing.startedAt)) {
    throw new TypeError("ResearchRunManifestV3 finalization precedes its start.");
  }
  const expectedStem = createSessionStem({
    participantId: output.participantId,
    participantCode: output.participantCode,
    age: output.age,
    gender: output.gender,
    handedness: output.handedness,
    startedAt: output.timing.startedAt,
    attemptNumber: output.attemptNumber,
  });
  if (output.sessionStem !== expectedStem) {
    throw new TypeError("ResearchRunManifestV3.sessionStem does not match its coded participant and start time.");
  }
  if (output.protocol.safeProtocolStepPosition > output.protocol.protocolStepCount) {
    throw new TypeError("ResearchRunManifestV3 safe protocol boundary exceeds its plan.");
  }
  if (output.completionStatus === "completed"
    && output.protocol.safeProtocolStepPosition !== output.protocol.protocolStepCount) {
    throw new TypeError("ResearchRunManifestV3 completed status requires every protocol step to be safe.");
  }
  const definitionById = new Map(definitions.map((definition) => [
    definition.questionnaireId,
    definition.definitionSha256,
  ]));
  for (const module of modules) {
    if (module.protocolStepPosition > output.protocol.protocolStepCount) {
      throw new TypeError("ResearchRunManifestV3 questionnaire module position exceeds its plan.");
    }
    if (definitionById.get(module.questionnaireId) !== module.definitionSha256) {
      throw new TypeError("ResearchRunManifestV3 questionnaire module is not bound to a declared definition.");
    }
    if (module.protocolStepPosition <= output.protocol.safeProtocolStepPosition) {
      if (module.status !== "submitted") {
        throw new TypeError("ResearchRunManifestV3 questionnaire before the safe boundary must be submitted.");
      }
    } else if (module.status === "submitted") {
      throw new TypeError("ResearchRunManifestV3 questionnaire beyond the safe boundary cannot be submitted.");
    }
    if (module.status === "draft"
      && module.protocolStepPosition !== output.protocol.safeProtocolStepPosition + 1) {
      throw new TypeError("ResearchRunManifestV3 questionnaire draft must occupy the next unsafe protocol step.");
    }
  }
  const submittedCount = modules
    .filter(({ status }) => status === "submitted")
    .reduce((sum, module) => sum + module.responseCount, 0);
  const draftCount = modules
    .filter(({ status }) => status === "draft")
    .reduce((sum, module) => sum + module.responseCount, 0);
  if (submittedCount !== output.protocol.submittedResponseCount
    || draftCount !== output.protocol.draftResponseCount
    || output.timing.questionnaireSubmittedResponseCount !== submittedCount
    || output.timing.questionnaireDraftResponseCount !== draftCount) {
    throw new TypeError("ResearchRunManifestV3 questionnaire counts are inconsistent.");
  }
  if (output.completionStatus === "completed"
    && modules.some(({ status }) => status !== "submitted")) {
    throw new TypeError("ResearchRunManifestV3 completion requires every questionnaire module submitted.");
  }
  for (const entry of outputs) {
    if ((entry.kind === "ratingsCsv" || entry.kind === "ratingsTsv")
      && entry.rowCount !== output.timing.sampleCount) {
      throw new TypeError("ResearchRunManifestV3 rating table count differs from canonical samples.");
    }
    if ((entry.kind === "questionnaireCsv" || entry.kind === "questionnaireTsv")
      && entry.rowCount !== submittedCount + draftCount) {
      throw new TypeError("ResearchRunManifestV3 questionnaire table count differs from canonical responses.");
    }
  }
  if (output.timing.gapEventCount > output.timing.eventCount
    || (output.timing.gapEventCount === 0) !== (output.timing.missedSlotCount === 0)) {
    throw new TypeError("ResearchRunManifestV3 timing-gap totals are inconsistent.");
  }
  if (new Set(output.recovery.restartedStimulusIds).size
      !== output.recovery.restartedStimulusIds.length
    || output.recovery.restartedStimulusIds.some((id) => (
      !stimuli.some(({ stimulusId }) => stimulusId === id)
    ))) {
    throw new TypeError("ResearchRunManifestV3 recovery stimulus IDs must be unique assignment members.");
  }
  return deepFreeze(output);
}

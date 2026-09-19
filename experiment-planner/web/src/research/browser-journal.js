import {
  RESEARCH_EVENT_SCHEMA,
  validateResolvedAssignmentPlanV1,
  validateResearchEventV1,
  validateResearchRunManifestV2,
  validateResearchSampleV1,
} from "./contracts.js";
import { canonicalSha256 } from "./canonical.js";
import {
  createQuestionnaireResponseV1,
  validateQuestionnaireAnswers,
  validateQuestionnaireDefinitionV1,
  validateQuestionnaireModuleV1,
  validateQuestionnaireModuleV2,
  validateQuestionnaireResponseV1,
} from "./questionnaires.js";
import {
  validateResearchSettingsV2,
  validateResolvedProtocolPlanV1,
} from "./protocol-plan.js";
import {
  validateResearchSettingsV3,
  validateResolvedProtocolPlanV2,
} from "./external-protocol.js";
import {
  parseExperimentDefinitionV1,
  validateResolvedExperimentPlanV1,
} from "./external-experiment.js";
import { validateExperimentPackageRunBindingV1 } from "./experiment-package.js";
import {
  validateResearchEventV2,
  validateResearchRunManifestV3,
  validateResearchRunManifestV4,
} from "./protocol-records.js";

export const RESEARCH_JOURNAL_DATABASE = "affect-research/v1";
export const RESEARCH_JOURNAL_VERSION = 3;
// A package-backed context contains the bounded 16 MiB canonical source plus
// separately frozen settings, complete experiment plan, participant protocol,
// and asset bindings. Keep one explicit aggregate bound instead of applying
// the package-file bound to that intentionally redundant recovery envelope.
export const MAX_RESEARCH_RECOVERY_CONTEXT_BYTES = 128 * 1024 * 1024;

const RESEARCH_ATTEMPT_VERSION_V1 = 1;
const RESEARCH_ATTEMPT_VERSION_V2 = 2;
const RESEARCH_ATTEMPT_VERSION_V3 = 3;

function isProtocolAttempt(value) {
  const version = typeof value === "object" && value !== null ? value.version : value;
  return version === RESEARCH_ATTEMPT_VERSION_V2 || version === RESEARCH_ATTEMPT_VERSION_V3;
}

const ATTEMPTS = "attempts";
const SAMPLES = "samples";
const EVENTS = "events";
const QUESTIONNAIRE_RESPONSES = "questionnaire-responses";
const LOCKS = "participant-locks";
const QUARANTINE = "quarantine";

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WORKSPACE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const CANONICAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MONOTONIC_NS = /^(0|[1-9]\d{0,29})$/u;
const TERMINAL_STATUSES = new Set(["partial", "complete"]);
const QUESTIONNAIRE_EVENT_TYPES = new Set([
  "questionnaireStarted",
  "questionnaireDraftCheckpointed",
  "questionnaireCompleted",
]);
const QUESTIONNAIRE_DRAFT_SCHEMA = "affect-research-questionnaire-draft";

export class ResearchJournalError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ResearchJournalError";
    this.code = code;
  }
}

function fail(code, message, options) {
  throw new ResearchJournalError(code, message, options);
}

function clone(value) {
  return structuredClone(value);
}

function recoveryContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-record", "Attempt recovery context must be an object.");
  }
  const text = JSON.stringify(value, (key, member) => {
    if (/^(firstName|lastName|selfDescription)$/iu.test(key)) {
      fail("privacy-boundary", "Raw names and self-description must not enter recovery storage.");
    }
    if (typeof member === "number" && !Number.isFinite(member)) {
      fail("invalid-record", "Attempt recovery context must contain finite JSON values.");
    }
    return member;
  });
  if (!text || new TextEncoder().encode(text).byteLength > MAX_RESEARCH_RECOVERY_CONTEXT_BYTES) {
    fail(
      "invalid-record",
      `Attempt recovery context exceeds the ${MAX_RESEARCH_RECOVERY_CONTEXT_BYTES}-byte limit.`,
    );
  }
  return JSON.parse(text);
}

function assignmentFromContext(context, participantId) {
  const assignments = context?.plan?.assignments;
  if (!Array.isArray(assignments)) return null;
  const matches = assignments.filter((assignment) => assignment?.participantId === participantId);
  if (matches.length !== 1 || !Array.isArray(matches[0].slots)) {
    fail("corrupt-record", "Frozen recovery plan does not contain exactly one reserved participant assignment.");
  }
  return matches[0];
}

function rejectDetachedAssignment(context) {
  if (Object.hasOwn(context, "assignment")) {
    fail("invalid-record", "Recovery context must derive its assignment from the frozen plan, not store a detached copy.");
  }
}

function immutable(value) {
  const result = clone(value);
  const freeze = (current) => {
    if (current && typeof current === "object" && !Object.isFrozen(current)) {
      Object.freeze(current);
      for (const child of Object.values(current)) freeze(child);
    }
    return current;
  };
  return freeze(result);
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail("invalid-record", `${label} must be a safe identifier.`);
  }
  return value;
}

function sessionStem(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 240
    || value === "." || value === ".." || /[<>:"/\\|?*\u0000-\u001f]/u.test(value)) {
    fail("invalid-record", "sessionStem must be a filename-safe basename.");
  }
  return value;
}

function hash(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("invalid-record", `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail("invalid-record", `${label} must be an integer of at least ${minimum}.`);
  }
  return value;
}

function isoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    fail("invalid-record", `${label} must be an ISO timestamp.`);
  }
  return value;
}

function lockKey(experimentId, participantId, workspaceId = "legacy-unbound") {
  return `${identifier(workspaceId, "workspaceId")}::${identifier(experimentId, "experimentId")}::${identifier(participantId, "participantId")}`;
}

function validateReservation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid-record", "Attempt reservation must be an object.");
  }
  const allowed = [
    "runId", "experimentId", "participantId", "attemptNumber", "sessionStem",
    "settingsHash", "planHash", "createdAt", "ownerId", "context",
  ];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0 || allowed.some((key) => !(key in input))) {
    fail("invalid-record", "Attempt reservation has an unsupported shape.");
  }
  const context = recoveryContext(input.context);
  rejectDetachedAssignment(context);
  if (typeof context.workspaceId !== "string" || !WORKSPACE_ID.test(context.workspaceId)) {
    fail("invalid-record", "Attempt recovery context requires the selected workspace UUID.");
  }
  return Object.freeze({
    runId: identifier(input.runId, "runId"),
    experimentId: identifier(input.experimentId, "experimentId"),
    participantId: identifier(input.participantId, "participantId"),
    attemptNumber: integer(input.attemptNumber, "attemptNumber", 1),
    sessionStem: sessionStem(input.sessionStem),
    settingsHash: hash(input.settingsHash, "settingsHash"),
    planHash: hash(input.planHash, "planHash"),
    createdAt: isoTimestamp(input.createdAt, "createdAt"),
    ownerId: identifier(input.ownerId, "ownerId"),
    context,
  });
}

function exactObject(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-record", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    fail("invalid-record", `${label} has an unsupported shape.`);
  }
  return value;
}

async function validateProtocolReservation(input) {
  exactObject(input, "Protocol attempt reservation", [
    "runId", "experimentId", "participantId", "attemptNumber", "sessionStem",
    "settingsHash", "planHash", "protocolPlanHash", "createdAt", "ownerId", "context",
  ]);
  const reservation = validateReservation({
    runId: input.runId,
    experimentId: input.experimentId,
    participantId: input.participantId,
    attemptNumber: input.attemptNumber,
    sessionStem: input.sessionStem,
    settingsHash: input.settingsHash,
    planHash: input.planHash,
    createdAt: input.createdAt,
    ownerId: input.ownerId,
    context: input.context,
  });
  if (!CANONICAL_UUID.test(reservation.runId)) {
    fail("invalid-record", "Questionnaire-aware runId must be a canonical UUID.");
  }
  const context = reservation.context;
  if (!context.settings || !context.plan || !context.protocolPlan) {
    fail(
      "invalid-record",
      "Questionnaire-aware recovery context requires frozen settings, assignment plan, and protocol plan.",
    );
  }
  let settings;
  let plan;
  let protocolPlan;
  let experimentPackage = null;
  const externalProtocol = context.settings?.version === 3;
  try {
    if (externalProtocol) {
      settings = await validateResearchSettingsV3(context.settings);
      plan = await validateResolvedExperimentPlanV1(context.plan);
      protocolPlan = await validateResolvedProtocolPlanV2(context.protocolPlan, {
        settingsV3: settings,
        resolvedExperimentPlanV1: plan,
      });
      if (typeof context.experimentSourceText !== "string") {
        throw new TypeError("External-order recovery requires exact experiment.json text.");
      }
      const parsedExperiment = await parseExperimentDefinitionV1(
        new TextEncoder().encode(context.experimentSourceText),
      );
      if (parsedExperiment.sourceByteSha256 !== settings.externalProtocol.sourceByteSha256
        || parsedExperiment.definitionSha256 !== settings.externalProtocol.definitionSha256
        || plan.sourceByteSha256 !== parsedExperiment.sourceByteSha256
        || plan.definitionSha256 !== parsedExperiment.definitionSha256) {
        throw new TypeError("External-order recovery experiment bytes do not bind settings and plan.");
      }
      if (!Object.hasOwn(context, "experimentPackage")) {
        throw new TypeError("New ResearchSettingsV3 reservations require an experiment package binding.");
      }
      experimentPackage = await validateExperimentPackageRunBindingV1(
        context.experimentPackage,
        {
          settings,
          experimentPlan: plan,
          protocolPlan,
          participantId: reservation.participantId,
        },
      );
    } else {
      if (Object.hasOwn(context, "experimentPackage")) {
        throw new TypeError("ResearchSettingsV2 recovery cannot attach an experiment package.");
      }
      settings = await validateResearchSettingsV2(context.settings);
      plan = await validateResolvedAssignmentPlanV1(context.plan);
      protocolPlan = await validateResolvedProtocolPlanV1(context.protocolPlan, {
        settingsV2: settings,
        assignmentPlanV1: plan,
      });
    }
  } catch (error) {
    fail("invalid-record", "Questionnaire-aware recovery context violates its strict frozen contracts.", {
      cause: error,
    });
  }
  const settingsHash = await canonicalSha256(settings);
  if (reservation.settingsHash !== settingsHash
    || reservation.planHash !== plan.planHashSha256
    || input.protocolPlanHash !== protocolPlan.protocolPlanHashSha256
    || protocolPlan.settingsSha256 !== settingsHash
    || protocolPlan.assignmentPlanSha256 !== plan.planHashSha256
    || protocolPlan.participantId !== reservation.participantId
    || settings.experiment.id !== reservation.experimentId) {
    fail(
      "invalid-record",
      "Questionnaire-aware reservation hashes or identities do not bind its frozen context.",
    );
  }
  return Object.freeze({
    ...reservation,
    attemptVersion: externalProtocol ? RESEARCH_ATTEMPT_VERSION_V3 : RESEARCH_ATTEMPT_VERSION_V2,
    protocolPlanHash: hash(input.protocolPlanHash, "protocolPlanHash"),
    context: {
      ...context,
      settings: clone(settings),
      plan: clone(plan),
      protocolPlan: clone(protocolPlan),
      ...(experimentPackage ? { experimentPackage: clone(experimentPackage) } : {}),
    },
  });
}

function protocolStep(attempt, protocolStepPosition) {
  if (!isProtocolAttempt(attempt)) {
    fail("invalid-record", "Protocol state is available only for questionnaire-aware attempts.");
  }
  const steps = attempt.context?.protocolPlan?.steps;
  const step = Array.isArray(steps) ? steps[protocolStepPosition - 1] : null;
  if (!step || step.protocolPosition !== protocolStepPosition) {
    fail("unsafe-recovery", "Protocol step is outside the frozen resolved protocol plan.");
  }
  return step;
}

function validateEventV2ForAttempt(event, attempt) {
  if (event.protocolPlanSha256 !== attempt.protocolPlanHash) {
    fail("corrupt-record", "ResearchEventV2 does not bind the reserved protocol plan.");
  }
  if (event.protocolStepPosition !== null) {
    const step = protocolStep(attempt, event.protocolStepPosition);
    if (QUESTIONNAIRE_EVENT_TYPES.has(event.type)) {
      if (step.kind !== "questionnaire"
        || event.moduleId !== step.moduleId
        || event.questionnaireId !== step.questionnaireId
        || event.definitionSha256 !== step.definitionSha256) {
        fail("corrupt-record", "Questionnaire event identity differs from the frozen protocol step.");
      }
    } else if (event.stimulusIdentity !== null && (step.kind !== "stimulus"
      || event.stimulusPosition !== step.stimulusPosition
      || event.stimulusIdentity.stimulusId !== step.stimulusId)) {
      fail("corrupt-record", "Stimulus event identity differs from the frozen protocol step.");
    }
  }
  return event;
}

function validateSequencedRecords(records, runId, expectedStart, kind, attempt) {
  const label = kind === "sample" ? "samples" : "events";
  if (!Array.isArray(records)) fail("invalid-record", `${label} must be an array.`);
  return records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail("invalid-record", `${label}[${index}] must be an object.`);
    }
    if (record.runId !== runId || record.sequence !== expectedStart + index) {
      fail("sequence-conflict", `${label}[${index}] does not match the journal sequence.`);
    }
    let normalized;
    try {
      normalized = kind === "sample"
        ? validateResearchSampleV1(record)
        : isProtocolAttempt(attempt)
          ? validateEventV2ForAttempt(validateResearchEventV2(record), attempt)
          : validateResearchEventV1(record);
    } catch (error) {
      fail("corrupt-record", `${label}[${index}] violates its strict Research contract.`, { cause: error });
    }
    if (normalized.participantId !== attempt.participantId
      || normalized.attemptNumber !== attempt.attemptNumber
      || normalized.settingsSha256 !== attempt.settingsHash
      || normalized.assignmentPlanSha256 !== attempt.planHash) {
      fail("corrupt-record", `${label}[${index}] does not bind the reserved attempt.`);
    }
    if (kind === "sample" && isProtocolAttempt(attempt)) {
      const frozenStep = attempt.context.protocolPlan.steps.find((step) => (
        step.kind === "stimulus" && step.stimulusPosition === normalized.stimulusPosition
      ));
      if (!frozenStep || frozenStep.stimulusId !== normalized.stimulusIdentity.stimulusId) {
        fail("corrupt-record", `${label}[${index}] differs from the frozen stimulus protocol step.`);
      }
    }
    const assignment = assignmentFromContext(attempt.context, attempt.participantId);
    if (assignment && normalized.stimulusIdentity !== null) {
      const position = normalized.stimulusPosition;
      const slot = assignment.slots[position - 1];
      const stimulus = attempt.context.plan.stimuli?.find(({ stimulusId }) => stimulusId === slot?.stimulusId);
      if (!slot || slot.position !== position || normalized.stimulusIdentity.stimulusId !== slot.stimulusId || !stimulus) {
        fail("corrupt-record", `${label}[${index}] does not bind the resolved assignment position.`);
      }
      const source = stimulus.source;
      const sourceDuration = source.kind === "youtube" ? source.observedDurationMs : source.durationMs;
      if (normalized.stimulusIdentity.kind !== source.kind
        || normalized.stimulusIdentity.durationMs !== sourceDuration
        || (source.kind === "youtube"
          ? normalized.stimulusIdentity.videoId !== source.videoId || normalized.stimulusIdentity.url !== source.url
          : normalized.stimulusIdentity.sha256 !== source.sha256 || normalized.stimulusIdentity.byteLength !== source.byteLength)) {
        fail("corrupt-record", `${label}[${index}] stimulus identity differs from the frozen plan.`);
      }
    }
    return clone(normalized);
  });
}

function validateRecordTimeline(records, kind, previous = null) {
  let prior = previous;
  for (const record of records) {
    if (prior) {
      if (BigInt(record.monotonicTimeNs) < BigInt(prior.monotonicTimeNs)) {
        fail("corrupt-record", `${kind} monotonic timestamps move backward.`);
      }
      if (kind === "sample") {
        if (record.scheduledElapsedMs <= prior.scheduledElapsedMs
          || record.observedElapsedMs < prior.observedElapsedMs) {
          fail("corrupt-record", "Sample deadline or observation time is not monotonically increasing.");
        }
        if (record.sampleRateHz !== prior.sampleRateHz) {
          fail("corrupt-record", "Sample rate changed within one attempt.");
        }
      }
    }
    prior = record;
  }
  return records;
}

function definitionAndModuleForStep(attempt, step) {
  if (!step || step.kind !== "questionnaire") {
    fail("invalid-record", "The active protocol step is not a questionnaire.");
  }
  const questionnaires = attempt.context?.settings?.questionnaires;
  const rawDefinition = questionnaires?.definitions?.find(({ questionnaireId }) => (
    questionnaireId === step.questionnaireId
  ));
  const rawModule = questionnaires?.modules?.find(({ moduleId }) => moduleId === step.moduleId);
  if (!rawDefinition || !rawModule) {
    fail("corrupt-attempt", "The frozen questionnaire step has no matching definition or module.");
  }
  let definition;
  let module;
  try {
    definition = validateQuestionnaireDefinitionV1(rawDefinition);
    module = rawModule.version === 2
      ? validateQuestionnaireModuleV2(rawModule, { definition })
      : validateQuestionnaireModuleV1(rawModule, { definition });
  } catch (error) {
    fail("corrupt-attempt", "The frozen questionnaire definition or module is invalid.", { cause: error });
  }
  if (definition.definitionSha256 !== step.definitionSha256
    || module.questionnaireId !== step.questionnaireId
    || module.moduleId !== step.moduleId) {
    fail("corrupt-attempt", "The frozen questionnaire definition or module differs from its protocol step.");
  }
  return { definition, module };
}

function responseMatchesOption(response, definition) {
  const item = definition.items[response.itemOrder - 1];
  const option = item?.options?.[response.optionOrder - 1];
  return Boolean(item && option
    && item.itemId === response.itemId
    && option.optionId === response.optionId
    && option.label === response.responseLabel
    && Object.is(option.scoreValue, response.scoreValue)
    && Object.is(item.subscale, response.subscale));
}

function validateQuestionnaireResponseForAttempt(value, attempt, expectedStatus = "submitted") {
  let response;
  try {
    response = validateQuestionnaireResponseV1(value);
  } catch (error) {
    fail("corrupt-record", "Questionnaire response violates QuestionnaireResponseV1.", { cause: error });
  }
  if (expectedStatus !== null && response.status !== expectedStatus) {
    fail("corrupt-record", `Questionnaire response must have ${expectedStatus} status.`);
  }
  if (response.runId !== attempt.runId
    || response.participantId !== attempt.participantId
    || response.attemptNumber !== attempt.attemptNumber
    || response.settingsSha256 !== attempt.settingsHash
    || response.assignmentPlanSha256 !== attempt.planHash
    || response.protocolPlanSha256 !== attempt.protocolPlanHash) {
    fail("corrupt-record", "Questionnaire response does not bind the reserved attempt.");
  }
  const step = protocolStep(attempt, response.protocolStepPosition);
  const { definition } = definitionAndModuleForStep(attempt, step);
  if (response.moduleId !== step.moduleId
    || response.questionnaireId !== step.questionnaireId
    || response.questionnaireVersion !== definition.questionnaireVersion
    || response.definitionSha256 !== definition.definitionSha256
    || !responseMatchesOption(response, definition)) {
    fail("corrupt-record", "Questionnaire response label or score differs from the frozen definition.");
  }
  return clone(response);
}

function validateResponseTimeline(responses, previous = null) {
  let prior = previous;
  for (const response of responses) {
    if (prior && BigInt(response.monotonicTimeNs) < BigInt(prior.monotonicTimeNs)) {
      fail("corrupt-record", "Questionnaire response monotonic timestamps move backward.");
    }
    prior = response;
  }
  return responses;
}

function validateDraft(value, attempt) {
  if (value === null) return null;
  exactObject(value, "Questionnaire draft", [
    "schema", "version", "protocolStepPosition", "moduleId", "questionnaireId",
    "definitionSha256", "responses", "updatedAt",
  ]);
  if (value.schema !== QUESTIONNAIRE_DRAFT_SCHEMA || value.version !== 1) {
    fail("corrupt-attempt", "Questionnaire draft has an unsupported schema or version.");
  }
  const stepPosition = integer(value.protocolStepPosition, "Questionnaire draft protocolStepPosition", 1);
  const step = protocolStep(attempt, stepPosition);
  if (attempt.activeProtocolStep === null
    || JSON.stringify(attempt.activeProtocolStep) !== JSON.stringify(step)
    || value.moduleId !== step.moduleId
    || value.questionnaireId !== step.questionnaireId
    || value.definitionSha256 !== step.definitionSha256
    || !Array.isArray(value.responses)) {
    fail("corrupt-attempt", "Questionnaire draft does not bind the active frozen protocol step.");
  }
  isoTimestamp(value.updatedAt, "Questionnaire draft updatedAt");
  const seenItems = new Set();
  const responses = value.responses.map((response, index) => {
    const normalized = validateQuestionnaireResponseForAttempt(response, attempt, "draft");
    if (normalized.sequence !== attempt.nextQuestionnaireResponseSequence + index
      || normalized.protocolStepPosition !== stepPosition
      || seenItems.has(normalized.itemId)) {
      fail("corrupt-attempt", "Questionnaire draft responses are duplicated or non-contiguous.");
    }
    seenItems.add(normalized.itemId);
    return normalized;
  });
  validateResponseTimeline(responses);
  return {
    schema: QUESTIONNAIRE_DRAFT_SCHEMA,
    version: 1,
    protocolStepPosition: stepPosition,
    moduleId: step.moduleId,
    questionnaireId: step.questionnaireId,
    definitionSha256: step.definitionSha256,
    responses,
    updatedAt: value.updatedAt,
  };
}

function validateProtocolStateTransition({ safeProtocolStepPosition, activeProtocolStepPosition }, attempt) {
  const nextSafe = integer(safeProtocolStepPosition, "safeProtocolStepPosition");
  const stepCount = attempt.context.protocolPlan.steps.length;
  if (nextSafe < attempt.safeProtocolStepPosition
    || nextSafe > attempt.safeProtocolStepPosition + 1
    || nextSafe > stepCount) {
    fail("unsafe-recovery", "Safe protocol boundary must advance exactly one frozen step at a time.");
  }
  const nextActive = activeProtocolStepPosition === null
    ? null
    : protocolStep(attempt, integer(activeProtocolStepPosition, "activeProtocolStepPosition", 1));
  if (nextSafe > attempt.safeProtocolStepPosition) {
    if (attempt.activeProtocolStep?.kind === "questionnaire") {
      fail(
        "unsafe-recovery",
        "Questionnaire steps reach a safe boundary only through the atomic submit transaction.",
      );
    }
    if (!attempt.activeProtocolStep
      || attempt.activeProtocolStep.protocolPosition !== nextSafe
      || nextActive !== null
      || attempt.activeQuestionnaireDraft !== null) {
      fail("unsafe-recovery", "A safe protocol advance must close the exact active step without a draft.");
    }
  } else if (nextActive !== null && nextActive.protocolPosition !== nextSafe + 1) {
    fail("unsafe-recovery", "The active protocol step must begin at the next safe boundary.");
  } else if (attempt.activeProtocolStep !== null && nextActive !== null
    && JSON.stringify(attempt.activeProtocolStep) !== JSON.stringify(nextActive)) {
    fail("unsafe-recovery", "An active protocol step cannot be replaced before reaching a safe boundary.");
  } else if (nextActive === null && attempt.activeQuestionnaireDraft !== null) {
    fail("unsafe-recovery", "A questionnaire step with a durable draft cannot be cleared without submission.");
  }
  return { safeProtocolStepPosition: nextSafe, activeProtocolStep: nextActive };
}

function applyProtocolState(attempt, state) {
  const completed = state.safeProtocolStepPosition > attempt.safeProtocolStepPosition
    ? attempt.activeProtocolStep
    : null;
  attempt.safeProtocolStepPosition = state.safeProtocolStepPosition;
  attempt.activeProtocolStep = state.activeProtocolStep === null ? null : clone(state.activeProtocolStep);
  if (completed?.kind === "stimulus") {
    attempt.safeStimulusIndex = completed.stimulusPosition;
  }
  attempt.activeStimulusIndex = state.activeProtocolStep?.kind === "stimulus"
    ? state.activeProtocolStep.stimulusPosition - 1
    : null;
}

function normalizeAnswerInputs(value) {
  if (!Array.isArray(value)) fail("invalid-record", "Questionnaire answers must be an array.");
  if (value.length > 1_024) fail("invalid-record", "Questionnaire answers exceed the item limit.");
  const seen = new Set();
  return value.map((answer, index) => {
    exactObject(answer, `Questionnaire answer ${index + 1}`, [
      "itemId", "optionId", "wallTimeUtc", "monotonicTimeNs", "responseLatencyMs",
    ]);
    const itemId = identifier(answer.itemId, `Questionnaire answer ${index + 1} itemId`);
    if (seen.has(itemId)) fail("invalid-record", `Questionnaire answer ${itemId} is duplicated.`);
    seen.add(itemId);
    if (typeof answer.monotonicTimeNs !== "string" || !MONOTONIC_NS.test(answer.monotonicTimeNs)) {
      fail("invalid-record", `Questionnaire answer ${itemId} has invalid monotonic time.`);
    }
    isoTimestamp(answer.wallTimeUtc, `Questionnaire answer ${itemId} wallTimeUtc`);
    if (!Number.isFinite(answer.responseLatencyMs) || answer.responseLatencyMs < 0) {
      fail("invalid-record", `Questionnaire answer ${itemId} has invalid response latency.`);
    }
    return {
      itemId,
      optionId: identifier(answer.optionId, `Questionnaire answer ${itemId} optionId`),
      wallTimeUtc: answer.wallTimeUtc,
      monotonicTimeNs: answer.monotonicTimeNs,
      responseLatencyMs: answer.responseLatencyMs,
    };
  });
}

async function deriveQuestionnaireResponses(attempt, stepPosition, answerInputs, status) {
  const step = protocolStep(attempt, stepPosition);
  if (step.kind !== "questionnaire") fail("invalid-record", "Only questionnaire steps accept answers.");
  const { definition, module } = definitionAndModuleForStep(attempt, step);
  const answers = normalizeAnswerInputs(answerInputs);
  const answerIds = Object.fromEntries(answers.map(({ itemId, optionId }) => [itemId, optionId]));
  let normalizedAnswers;
  try {
    normalizedAnswers = validateQuestionnaireAnswers(definition, answerIds, {
      allowPartial: status === "draft",
    });
  } catch (error) {
    fail("invalid-record", "Questionnaire answers do not satisfy the frozen definition.", { cause: error });
  }
  if (status === "submitted" && !normalizedAnswers.complete) {
    fail("invalid-record", "Questionnaire submission requires every required frozen item.");
  }
  const inputByItem = new Map(answers.map((answer) => [answer.itemId, answer]));
  const orderedAnswers = [...normalizedAnswers.answers].sort((left, right) => {
    const leftTime = BigInt(inputByItem.get(left.itemId).monotonicTimeNs);
    const rightTime = BigInt(inputByItem.get(right.itemId).monotonicTimeNs);
    if (leftTime < rightTime) return -1;
    if (leftTime > rightTime) return 1;
    return left.itemOrder - right.itemOrder;
  });
  const responses = [];
  for (let index = 0; index < orderedAnswers.length; index += 1) {
    const answer = orderedAnswers[index];
    const timing = inputByItem.get(answer.itemId);
    try {
      responses.push(await createQuestionnaireResponseV1({
        definition,
        module,
        sequence: attempt.nextQuestionnaireResponseSequence + index,
        runId: attempt.runId,
        participantId: attempt.participantId,
        attemptNumber: attempt.attemptNumber,
        settingsSha256: attempt.settingsHash,
        assignmentPlanSha256: attempt.planHash,
        protocolPlanSha256: attempt.protocolPlanHash,
        protocolStepPosition: stepPosition,
        itemId: answer.itemId,
        optionId: answer.optionId,
        status,
        wallTimeUtc: timing.wallTimeUtc,
        monotonicTimeNs: timing.monotonicTimeNs,
        responseLatencyMs: timing.responseLatencyMs,
      }));
    } catch (error) {
      fail("invalid-record", "Questionnaire response could not be derived from the frozen definition.", {
        cause: error,
      });
    }
  }
  validateResponseTimeline(responses);
  return { step, responses };
}

function validateStimulusState(stimulusState, attempt) {
  if (stimulusState === null || stimulusState === undefined) return null;
  if (!stimulusState || typeof stimulusState !== "object" || Array.isArray(stimulusState)
    || Object.keys(stimulusState).sort().join(",") !== "activeStimulusIndex,safeStimulusIndex") {
    fail("invalid-record", "Stimulus state transition has an unsupported shape.");
  }
  const safeStimulusIndex = integer(stimulusState.safeStimulusIndex, "safeStimulusIndex");
  const activeStimulusIndex = stimulusState.activeStimulusIndex === null
    ? null
    : integer(stimulusState.activeStimulusIndex, "activeStimulusIndex");
  if (safeStimulusIndex < attempt.safeStimulusIndex) {
    fail("unsafe-recovery", "Safe stimulus boundary cannot move backward.");
  }
  if (activeStimulusIndex !== null && activeStimulusIndex !== safeStimulusIndex) {
    fail("unsafe-recovery", "An active stimulus must start at the recorded safe boundary.");
  }
  const assignment = assignmentFromContext(attempt.context, attempt.participantId);
  if (assignment && (safeStimulusIndex > assignment.slots.length
    || activeStimulusIndex !== null && activeStimulusIndex >= assignment.slots.length)) {
    fail("unsafe-recovery", "Stimulus state exceeds the frozen assignment.");
  }
  return { activeStimulusIndex, safeStimulusIndex };
}

function validatePendingFinalization(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "completionStatus,finalizedAt,recovery") {
    fail("corrupt-attempt", "Pending finalization has an unsupported shape.");
  }
  if (!["completed", "partial"].includes(value.completionStatus)) {
    fail("corrupt-attempt", "Pending finalization has an invalid completion status.");
  }
  isoTimestamp(value.finalizedAt, "pending finalization time");
  const recovery = value.recovery;
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)
    || Object.keys(recovery).sort().join(",") !== "restartedStimulusIds,resumed,sourceRunId"
    || typeof recovery.resumed !== "boolean"
    || recovery.resumed !== (recovery.sourceRunId !== null)
    || !Array.isArray(recovery.restartedStimulusIds)) {
    fail("corrupt-attempt", "Pending finalization recovery metadata is invalid.");
  }
  if (recovery.sourceRunId !== null) identifier(recovery.sourceRunId, "pending sourceRunId");
  recovery.restartedStimulusIds.forEach((id) => identifier(id, "pending restarted stimulus ID"));
  return value;
}

function validateManifestForAttempt(manifest, attempt) {
  let normalized;
  try {
    normalized = validateResearchRunManifestV2(manifest);
  } catch (error) {
    fail("corrupt-record", "Run manifest violates ResearchRunManifestV2.", { cause: error });
  }
  if (normalized.runId !== attempt.runId
    || normalized.experimentId !== attempt.experimentId
    || normalized.participantId !== attempt.participantId
    || normalized.attemptNumber !== attempt.attemptNumber
    || normalized.settingsSha256 !== attempt.settingsHash
    || normalized.assignmentPlanSha256 !== attempt.planHash) {
    fail("corrupt-record", "Run manifest does not bind the reserved attempt.");
  }
  const assignment = assignmentFromContext(attempt.context, attempt.participantId);
  if (assignment) {
    if (normalized.stimuli.length !== assignment.slots.length) {
      fail("corrupt-record", "Run manifest stimulus list does not cover the frozen assignment.");
    }
    normalized.stimuli.forEach((identity, index) => {
      const slot = assignment.slots[index];
      const stimulus = attempt.context.plan.stimuli?.find(({ stimulusId }) => stimulusId === slot?.stimulusId);
      const source = stimulus?.source;
      const durationMs = source?.kind === "youtube" ? source.observedDurationMs : source?.durationMs;
      if (!stimulus || identity.stimulusId !== slot.stimulusId || identity.kind !== source.kind
        || identity.durationMs !== durationMs
        || (source.kind === "youtube"
          ? identity.url !== source.url || identity.videoId !== source.videoId
          : identity.sha256 !== source.sha256 || identity.byteLength !== source.byteLength)) {
        fail("corrupt-record", `Run manifest stimulus ${index + 1} differs from the frozen assignment.`);
      }
    });
  }
  return normalized;
}

function validateManifestStimuliForAttempt(stimuli, attempt) {
  const assignment = assignmentFromContext(attempt.context, attempt.participantId);
  if (!assignment) {
    fail("corrupt-record", "Protocol finalization requires its frozen participant assignment.");
  }
  if (stimuli.length !== assignment.slots.length) {
    fail("corrupt-record", "Run manifest stimulus list does not cover the frozen assignment.");
  }
  stimuli.forEach((identity, index) => {
    const slot = assignment.slots[index];
    const stimulus = attempt.context.plan.stimuli?.find(({ stimulusId }) => (
      stimulusId === slot?.stimulusId
    ));
    const source = stimulus?.source;
    const durationMs = source?.kind === "youtube" ? source.observedDurationMs : source?.durationMs;
    if (!stimulus || identity.stimulusId !== slot.stimulusId || identity.kind !== source.kind
      || identity.durationMs !== durationMs
      || (source.kind === "youtube"
        ? identity.url !== source.url || identity.videoId !== source.videoId
          || identity.sha256 !== null || identity.byteLength !== null
        : identity.sha256 !== source.sha256 || identity.byteLength !== source.byteLength
          || identity.url !== null || identity.videoId !== null)) {
      fail("corrupt-record", `Run manifest stimulus ${index + 1} differs from the frozen assignment.`);
    }
  });
}

function expectedProtocolRecovery(attempt) {
  return {
    resumed: attempt.context.resumed === true,
    sourceRunId: attempt.context.sourceRunId ?? null,
    restartedStimulusIds: clone(attempt.context.restartedStimulusIds ?? []),
  };
}

function validateProtocolManifestIdentity(manifest, attempt) {
  let normalized;
  const packageBinding = attempt.context?.experimentPackage ?? null;
  try {
    normalized = packageBinding === null
      ? validateResearchRunManifestV3(manifest)
      : validateResearchRunManifestV4(manifest);
  } catch (error) {
    fail(
      "corrupt-record",
      packageBinding === null
        ? "Run manifest violates ResearchRunManifestV3."
        : "Package-backed run manifest violates ResearchRunManifestV4.",
      { cause: error },
    );
  }
  const participant = attempt.context?.participant;
  if (!participant || normalized.runId !== attempt.runId
    || normalized.experimentId !== attempt.experimentId
    || normalized.participantId !== attempt.participantId
    || normalized.participantCode !== participant.participantCode
    || normalized.age !== participant.age
    || normalized.gender !== participant.gender
    || normalized.handedness !== participant.handedness
    || normalized.attemptNumber !== attempt.attemptNumber
    || normalized.sessionStem !== attempt.sessionStem
    || normalized.settingsSha256 !== attempt.settingsHash
    || normalized.assignmentPlanSha256 !== attempt.planHash
    || normalized.protocolPlanSha256 !== attempt.protocolPlanHash) {
    fail("corrupt-record", "Run manifest does not bind the reserved protocol attempt.");
  }
  if (normalized.timing.startedAt !== (attempt.context.startedAt ?? attempt.createdAt)) {
    fail("corrupt-record", "Run manifest start time differs from the frozen attempt context.");
  }
  if (attempt.context.build
    && JSON.stringify(normalized.build) !== JSON.stringify(attempt.context.build)) {
    fail("corrupt-record", "Run manifest build differs from the frozen attempt context.");
  }
  if (JSON.stringify(normalized.recovery) !== JSON.stringify(expectedProtocolRecovery(attempt))) {
    fail("corrupt-record", "Run manifest recovery differs from the frozen attempt context.");
  }
  if (packageBinding !== null) {
    const receipt = normalized.experimentPackage;
    if (receipt.canonicalSourceByteSha256 !== packageBinding.sourceByteSha256
      || receipt.packageDefinitionSha256 !== packageBinding.packageDefinitionSha256
      || receipt.packageId !== packageBinding.packageId
      || receipt.languageId !== packageBinding.languageId
      || receipt.assignmentSha256 !== packageBinding.assignmentSha256
      || JSON.stringify(receipt.languageSelectionPath)
        !== JSON.stringify(packageBinding.languageSelectionPath)) {
      fail(
        "corrupt-record",
        "Run manifest package identity differs from the frozen experiment package binding.",
      );
    }
  }
  validateManifestStimuliForAttempt(normalized.stimuli, attempt);

  const expectedDefinitions = attempt.context.settings.questionnaires.definitions.map((definition) => ({
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
  }));
  if (normalized.protocol.protocolStepCount !== attempt.context.protocolPlan.steps.length
    || normalized.protocol.safeProtocolStepPosition !== attempt.safeProtocolStepPosition
    || JSON.stringify(normalized.protocol.questionnaireDefinitions)
      !== JSON.stringify(expectedDefinitions)) {
    fail("corrupt-record", "Run manifest protocol receipt differs from the frozen protocol plan.");
  }
  return normalized;
}

function protocolResponseReceipts(attempt, submittedResponses, draftResponses, events) {
  const questionnaireSteps = attempt.context.protocolPlan.steps.filter(({ kind }) => (
    kind === "questionnaire"
  ));
  const submittedByStep = new Map();
  const draftByStep = new Map();
  for (const response of submittedResponses) {
    if (!submittedByStep.has(response.protocolStepPosition)) {
      submittedByStep.set(response.protocolStepPosition, []);
    }
    submittedByStep.get(response.protocolStepPosition).push(response);
  }
  for (const response of draftResponses) {
    if (!draftByStep.has(response.protocolStepPosition)) draftByStep.set(response.protocolStepPosition, []);
    draftByStep.get(response.protocolStepPosition).push(response);
  }
  const knownPositions = new Set(questionnaireSteps.map(({ protocolPosition }) => protocolPosition));
  if ([...submittedByStep.keys(), ...draftByStep.keys()].some((position) => !knownPositions.has(position))) {
    fail("corrupt-record", "Questionnaire evidence refers to a non-questionnaire protocol step.");
  }

  const modules = questionnaireSteps.map((step) => {
    const submitted = submittedByStep.get(step.protocolPosition) ?? [];
    const draft = draftByStep.get(step.protocolPosition) ?? [];
    if (submitted.length > 0 && draft.length > 0) {
      fail("corrupt-record", "A questionnaire module cannot be both submitted and draft.");
    }
    if (step.protocolPosition <= attempt.safeProtocolStepPosition) {
      const { definition } = definitionAndModuleForStep(attempt, step);
      const itemIds = new Set(submitted.map(({ itemId }) => itemId));
      if (itemIds.size !== submitted.length
        || definition.items.some(({ itemId, required }) => required && !itemIds.has(itemId))
        || draft.length !== 0) {
        fail("corrupt-record", "A safe questionnaire step lacks unique answers for every required item.");
      }
      return {
        protocolStepPosition: step.protocolPosition,
        moduleId: step.moduleId,
        questionnaireId: step.questionnaireId,
        definitionSha256: step.definitionSha256,
        status: "submitted",
        responseCount: submitted.length,
      };
    }
    if (submitted.length !== 0) {
      fail("corrupt-record", "Submitted questionnaire evidence exists beyond the safe protocol boundary.");
    }
    const activeDraft = attempt.activeProtocolStep?.kind === "questionnaire"
      && attempt.activeProtocolStep.protocolPosition === step.protocolPosition;
    const terminalDraft = attempt.manifest?.protocol?.questionnaireModules?.some((receipt) => (
      receipt.protocolStepPosition === step.protocolPosition && receipt.status === "draft"
    ));
    if (draft.length > 0 || activeDraft || terminalDraft) {
      if (!activeDraft && !terminalDraft) {
        fail("corrupt-record", "Draft questionnaire evidence does not bind the durable active draft.");
      }
      return {
        protocolStepPosition: step.protocolPosition,
        moduleId: step.moduleId,
        questionnaireId: step.questionnaireId,
        definitionSha256: step.definitionSha256,
        status: "draft",
        responseCount: draft.length,
      };
    }
    return {
      protocolStepPosition: step.protocolPosition,
      moduleId: step.moduleId,
      questionnaireId: step.questionnaireId,
      definitionSha256: step.definitionSha256,
      status: "notReached",
      responseCount: 0,
    };
  });

  const completedEvents = events.filter(({ type }) => type === "questionnaireCompleted");
  for (const receipt of modules) {
    const matchingEvents = completedEvents.filter((event) => (
      event.protocolStepPosition === receipt.protocolStepPosition
      && event.moduleId === receipt.moduleId
      && event.questionnaireId === receipt.questionnaireId
      && event.definitionSha256 === receipt.definitionSha256
    ));
    if ((receipt.status === "submitted" && matchingEvents.length !== 1)
      || (receipt.status !== "submitted" && matchingEvents.length !== 0)) {
      fail("corrupt-record", "Questionnaire completion events differ from submitted module evidence.");
    }
  }
  if (completedEvents.length !== modules.filter(({ status }) => status === "submitted").length) {
    fail("corrupt-record", "Questionnaire completion events contain an unknown module receipt.");
  }
  return modules;
}

async function validateProtocolManifestEvidence({
  manifest,
  attempt,
  status,
  finalizedAt,
  samples,
  events,
  submittedResponses,
  draftResponses,
}) {
  if (!isProtocolAttempt(attempt)) {
    fail("invalid-record", "Protocol finalization requires a questionnaire-aware attempt.");
  }
  if (!TERMINAL_STATUSES.has(status)) {
    fail("invalid-record", "Final status must be partial or complete.");
  }
  finalizedAt = isoTimestamp(finalizedAt, "finalizedAt");
  const normalized = validateProtocolManifestIdentity(manifest, attempt);
  if (attempt.context.experimentPackage) {
    let packageBinding;
    try {
      packageBinding = await validateExperimentPackageRunBindingV1(
        attempt.context.experimentPackage,
        {
          settings: attempt.context.settings,
          experimentPlan: attempt.context.plan,
          protocolPlan: attempt.context.protocolPlan,
          participantId: attempt.participantId,
        },
      );
    } catch (error) {
      fail(
        "corrupt-record",
        "Frozen experiment package binding no longer reproduces the reserved attempt.",
        { cause: error },
      );
    }
    if (normalized.experimentPackage.assetBindingsSha256
      !== await canonicalSha256(packageBinding.assetBindings)
      || normalized.experimentPackage.assignmentSha256 !== packageBinding.assignmentSha256) {
      fail(
        "corrupt-record",
        "Run manifest assignment or asset-binding hash differs from the frozen experiment package binding.",
      );
    }
  }
  const completed = normalized.completionStatus === "completed";
  if ((status === "complete") !== completed || normalized.timing.finalizedAt !== finalizedAt) {
    fail("finalization-conflict", "Journal terminal status or time differs from the run manifest.");
  }
  if (completed && (attempt.safeProtocolStepPosition !== attempt.context.protocolPlan.steps.length
    || attempt.activeProtocolStep !== null || attempt.activeQuestionnaireDraft !== null)) {
    fail("unsafe-recovery", "A completed finalization requires every protocol step to be safe.");
  }
  const gapEvents = events.filter(({ type }) => type === "timingGap");
  const missedSlotCount = gapEvents.reduce((sum, event) => sum + event.missedSlotCount, 0);
  if (samples.length !== attempt.nextSampleSequence - 1
    || events.length !== attempt.nextEventSequence - 1
    || submittedResponses.length !== attempt.nextQuestionnaireResponseSequence - 1
    || normalized.timing.sampleRateHz !== attempt.context.settings.experiment.samplingFrequencyHz
    || normalized.timing.sampleCount !== samples.length
    || normalized.timing.eventCount !== events.length
    || normalized.timing.gapEventCount !== gapEvents.length
    || normalized.timing.missedSlotCount !== missedSlotCount) {
    fail("corrupt-record", "Run manifest timing counts differ from authoritative journal evidence.");
  }
  const modules = protocolResponseReceipts(attempt, submittedResponses, draftResponses, events);
  const submittedHash = await canonicalSha256(submittedResponses);
  const draftHash = await canonicalSha256(draftResponses);
  if (JSON.stringify(normalized.protocol.questionnaireModules) !== JSON.stringify(modules)
    || normalized.protocol.submittedResponseCount !== submittedResponses.length
    || normalized.protocol.draftResponseCount !== draftResponses.length
    || normalized.protocol.submittedResponsesSha256 !== submittedHash
    || normalized.protocol.draftResponsesSha256 !== draftHash
    || normalized.timing.questionnaireSubmittedResponseCount !== submittedResponses.length
    || normalized.timing.questionnaireDraftResponseCount !== draftResponses.length) {
    fail("corrupt-record", "Run manifest questionnaire receipts differ from authoritative evidence.");
  }
  return normalized;
}

function initialAttempt(reservation) {
  return {
    protocol: "affect-research-browser-journal",
    version: RESEARCH_ATTEMPT_VERSION_V1,
    ...reservation,
    status: "active",
    updatedAt: reservation.createdAt,
    safeStimulusIndex: 0,
    activeStimulusIndex: null,
    nextSampleSequence: 1,
    nextEventSequence: 1,
    finalizedAt: null,
    manifest: null,
    interruption: null,
    recoverable: false,
    pendingFinalization: null,
  };
}

function initialProtocolAttempt(reservation) {
  const { attemptVersion, ...baseReservation } = reservation;
  return {
    ...initialAttempt(baseReservation),
    version: attemptVersion,
    protocolPlanHash: reservation.protocolPlanHash,
    safeProtocolStepPosition: 0,
    activeProtocolStep: null,
    activeQuestionnaireDraft: null,
    nextQuestionnaireResponseSequence: 1,
  };
}

function validateStoredAttemptV1(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("corrupt-attempt", "Stored attempt must be an object.");
  }
  const allowed = [
    "protocol", "version", "runId", "experimentId", "participantId", "attemptNumber",
    "sessionStem", "settingsHash", "planHash", "createdAt", "ownerId", "context",
    "status", "updatedAt", "safeStimulusIndex", "activeStimulusIndex",
    "nextSampleSequence", "nextEventSequence", "finalizedAt", "manifest",
    "interruption", "recoverable", "pendingFinalization",
  ];
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    fail("corrupt-attempt", "Stored attempt has an unsupported shape.");
  }
  if (value.protocol !== "affect-research-browser-journal" || value.version !== RESEARCH_ATTEMPT_VERSION_V1) {
    fail("corrupt-attempt", "Stored attempt has an unsupported protocol version.");
  }
  const reservation = validateReservation(Object.fromEntries([
    "runId", "experimentId", "participantId", "attemptNumber", "sessionStem",
    "settingsHash", "planHash", "createdAt", "ownerId", "context",
  ].map((key) => [key, value[key]])));
  if (!["active", "partial", "complete"].includes(value.status)) {
    fail("corrupt-attempt", "Stored attempt has an invalid status.");
  }
  isoTimestamp(value.updatedAt, "updatedAt");
  integer(value.safeStimulusIndex, "safeStimulusIndex");
  if (value.activeStimulusIndex !== null) integer(value.activeStimulusIndex, "activeStimulusIndex");
  integer(value.nextSampleSequence, "nextSampleSequence", 1);
  integer(value.nextEventSequence, "nextEventSequence", 1);
  if (value.finalizedAt !== null) isoTimestamp(value.finalizedAt, "finalizedAt");
  if (typeof value.recoverable !== "boolean") fail("corrupt-attempt", "Stored attempt recoverable must be boolean.");
  if (value.interruption !== null) {
    if (!value.interruption || typeof value.interruption !== "object" || Array.isArray(value.interruption)
      || Object.keys(value.interruption).sort().join(",") !== "at,interruptedStimulusIndex,reason,restartStimulusIndex") {
      fail("corrupt-attempt", "Stored interruption has an unsupported shape.");
    }
    identifier(value.interruption.reason, "interruption reason");
    isoTimestamp(value.interruption.at, "interruption time");
    integer(value.interruption.restartStimulusIndex, "restartStimulusIndex");
    if (value.interruption.interruptedStimulusIndex !== null) {
      integer(value.interruption.interruptedStimulusIndex, "interruptedStimulusIndex");
    }
  }
  if (value.manifest !== null) validateManifestForAttempt(value.manifest, value);
  validatePendingFinalization(value.pendingFinalization);
  if (value.status === "active" && (value.finalizedAt !== null || value.manifest !== null || value.recoverable)) {
    fail("corrupt-attempt", "An active attempt cannot be finalized, manifested, or marked recoverable.");
  }
  if (value.status === "complete" && (value.finalizedAt === null || value.manifest === null || value.recoverable)) {
    fail("corrupt-attempt", "A complete attempt requires a terminal manifest and cannot be recoverable.");
  }
  if (value.status === "partial" && value.recoverable && (value.finalizedAt !== null || value.manifest !== null)) {
    fail("corrupt-attempt", "A recoverable partial cannot already have terminal artifacts.");
  }
  if (value.status === "partial" && !value.recoverable && (value.finalizedAt === null || value.manifest === null)) {
    fail("corrupt-attempt", "A terminal partial requires its final manifest.");
  }
  if (value.manifest !== null && (value.pendingFinalization === null
    || value.pendingFinalization.completionStatus !== value.manifest.completionStatus
    || value.pendingFinalization.finalizedAt !== value.manifest.timing.finalizedAt)) {
    fail("corrupt-attempt", "Terminal manifest does not bind its prepared finalization descriptor.");
  }
  return Object.freeze({ ...value, ...reservation });
}

function validateProtocolInterruption(value) {
  if (value === null) return null;
  exactObject(value, "Protocol interruption", [
    "at", "interruptedStimulusIndex", "reason", "restartStimulusIndex",
    "interruptedProtocolStepPosition", "interruptedProtocolStepKind",
    "restartProtocolStepPosition",
  ]);
  identifier(value.reason, "interruption reason");
  isoTimestamp(value.at, "interruption time");
  integer(value.restartStimulusIndex, "restartStimulusIndex");
  if (value.interruptedStimulusIndex !== null) {
    integer(value.interruptedStimulusIndex, "interruptedStimulusIndex");
  }
  if (value.interruptedProtocolStepPosition !== null) {
    integer(value.interruptedProtocolStepPosition, "interruptedProtocolStepPosition", 1);
  }
  if (value.interruptedProtocolStepKind !== null
    && value.interruptedProtocolStepKind !== "stimulus"
    && value.interruptedProtocolStepKind !== "questionnaire"
    && value.interruptedProtocolStepKind !== "interval") {
    fail("corrupt-attempt", "Protocol interruption has an invalid interrupted step kind.");
  }
  if ((value.interruptedProtocolStepPosition === null)
    !== (value.interruptedProtocolStepKind === null)) {
    fail("corrupt-attempt", "Protocol interruption step position and kind must be present together.");
  }
  if (value.restartProtocolStepPosition !== null) {
    integer(value.restartProtocolStepPosition, "restartProtocolStepPosition", 1);
  }
  return value;
}

function validateStoredProtocolAttempt(value, expectedVersion) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("corrupt-attempt", "Stored protocol attempt must be an object.");
  }
  const allowed = [
    "protocol", "version", "runId", "experimentId", "participantId", "attemptNumber",
    "sessionStem", "settingsHash", "planHash", "protocolPlanHash", "createdAt", "ownerId",
    "context", "status", "updatedAt", "safeStimulusIndex", "activeStimulusIndex",
    "safeProtocolStepPosition", "activeProtocolStep", "activeQuestionnaireDraft",
    "nextSampleSequence", "nextEventSequence", "nextQuestionnaireResponseSequence",
    "finalizedAt", "manifest", "interruption", "recoverable", "pendingFinalization",
  ];
  exactObject(value, "Stored protocol attempt", allowed);
  if (value.protocol !== "affect-research-browser-journal"
    || value.version !== expectedVersion
    || !isProtocolAttempt(expectedVersion)) {
    fail("corrupt-attempt", "Stored protocol attempt has an unsupported protocol version.");
  }
  const reservation = validateReservation(Object.fromEntries([
    "runId", "experimentId", "participantId", "attemptNumber", "sessionStem",
    "settingsHash", "planHash", "createdAt", "ownerId", "context",
  ].map((key) => [key, value[key]])));
  if (!CANONICAL_UUID.test(reservation.runId)) {
    fail("corrupt-attempt", "Stored questionnaire-aware runId is not a canonical UUID.");
  }
  const protocolPlanHash = hash(value.protocolPlanHash, "protocolPlanHash");
  const plan = reservation.context?.plan;
  const settings = reservation.context?.settings;
  const resolvedProtocol = reservation.context?.protocolPlan;
  if (!plan || !settings || !resolvedProtocol
    || plan.planHashSha256 !== reservation.planHash
    || resolvedProtocol.protocolPlanHashSha256 !== protocolPlanHash
    || resolvedProtocol.settingsSha256 !== reservation.settingsHash
    || resolvedProtocol.assignmentPlanSha256 !== reservation.planHash
    || resolvedProtocol.participantId !== reservation.participantId
    || settings.experiment?.id !== reservation.experimentId
    || !Array.isArray(resolvedProtocol.steps)) {
    fail("corrupt-attempt", "Stored protocol attempt hashes do not bind its frozen context.");
  }
  if (expectedVersion === RESEARCH_ATTEMPT_VERSION_V2
    && (settings.version !== 2 || resolvedProtocol.version !== 1
      || plan.schema !== "affect-research-assignment-plan")) {
    fail("corrupt-attempt", "Stored V2 attempt does not contain its historical contract family.");
  }
  if (expectedVersion === RESEARCH_ATTEMPT_VERSION_V3
    && (settings.version !== 3 || resolvedProtocol.version !== 2
      || plan.schema !== "affect-research-experiment-plan")) {
    fail("corrupt-attempt", "Stored V3 attempt does not contain the external-order contract family.");
  }
  if (!Array.isArray(settings.questionnaires?.definitions)
    || !Array.isArray(settings.questionnaires?.modules)) {
    fail("corrupt-attempt", "Stored protocol attempt has no frozen questionnaire contracts.");
  }
  for (const rawDefinition of settings.questionnaires.definitions) {
    try {
      validateQuestionnaireDefinitionV1(rawDefinition);
    } catch (error) {
      fail("corrupt-attempt", "Stored protocol attempt has an invalid questionnaire definition.", {
        cause: error,
      });
    }
  }
  if (!["active", "partial", "complete"].includes(value.status)) {
    fail("corrupt-attempt", "Stored protocol attempt has an invalid status.");
  }
  isoTimestamp(value.updatedAt, "updatedAt");
  integer(value.safeStimulusIndex, "safeStimulusIndex");
  if (value.activeStimulusIndex !== null) integer(value.activeStimulusIndex, "activeStimulusIndex");
  const safeProtocolStepPosition = integer(
    value.safeProtocolStepPosition,
    "safeProtocolStepPosition",
  );
  if (safeProtocolStepPosition > resolvedProtocol.steps.length) {
    fail("corrupt-attempt", "Safe protocol boundary exceeds the frozen protocol plan.");
  }
  let activeProtocolStep = null;
  if (value.activeProtocolStep !== null) {
    const expected = protocolStep(value, safeProtocolStepPosition + 1);
    if (JSON.stringify(value.activeProtocolStep) !== JSON.stringify(expected)) {
      fail("corrupt-attempt", "Active protocol step differs from the frozen next step.");
    }
    activeProtocolStep = expected;
  }
  const completedStimuli = resolvedProtocol.steps
    .slice(0, safeProtocolStepPosition)
    .filter(({ kind }) => kind === "stimulus").length;
  if (value.safeStimulusIndex !== completedStimuli
    || (activeProtocolStep?.kind === "stimulus"
      ? value.activeStimulusIndex !== activeProtocolStep.stimulusPosition - 1
      : value.activeStimulusIndex !== null)) {
    fail("corrupt-attempt", "Stimulus compatibility indexes differ from the protocol safe boundary.");
  }
  integer(value.nextSampleSequence, "nextSampleSequence", 1);
  integer(value.nextEventSequence, "nextEventSequence", 1);
  integer(value.nextQuestionnaireResponseSequence, "nextQuestionnaireResponseSequence", 1);
  if (value.finalizedAt !== null) isoTimestamp(value.finalizedAt, "finalizedAt");
  if (typeof value.recoverable !== "boolean") {
    fail("corrupt-attempt", "Stored protocol attempt recoverable must be boolean.");
  }
  validateProtocolInterruption(value.interruption);
  validatePendingFinalization(value.pendingFinalization);
  const attempt = { ...value, ...reservation, protocolPlanHash, activeProtocolStep };
  attempt.activeQuestionnaireDraft = validateDraft(value.activeQuestionnaireDraft, attempt);
  const normalizedManifest = value.manifest === null
    ? null
    : validateProtocolManifestIdentity(value.manifest, attempt);
  attempt.manifest = normalizedManifest === null ? null : clone(normalizedManifest);
  if (value.status === "active" && (value.finalizedAt !== null
    || normalizedManifest !== null || value.recoverable)) {
    fail("corrupt-attempt", "An active protocol attempt cannot be finalized or recoverable.");
  }
  if (value.status === "complete" && (value.finalizedAt === null
    || normalizedManifest === null || value.recoverable
    || safeProtocolStepPosition !== resolvedProtocol.steps.length
    || activeProtocolStep !== null || attempt.activeQuestionnaireDraft !== null)) {
    fail("corrupt-attempt", "A complete protocol attempt requires a fully safe terminal manifest.");
  }
  if (value.status === "partial" && value.recoverable
    && (value.finalizedAt !== null || normalizedManifest !== null)) {
    fail("corrupt-attempt", "A recoverable protocol partial cannot have terminal artifacts.");
  }
  if (value.status === "partial" && !value.recoverable
    && (value.finalizedAt === null || normalizedManifest === null
      || activeProtocolStep !== null || attempt.activeQuestionnaireDraft !== null)) {
    fail("corrupt-attempt", "A terminal protocol partial requires its closed versioned manifest.");
  }
  if (normalizedManifest !== null) {
    if ((value.status === "complete") !== (normalizedManifest.completionStatus === "completed")
      || value.finalizedAt !== normalizedManifest.timing.finalizedAt
      || value.pendingFinalization === null
      || value.pendingFinalization.completionStatus !== normalizedManifest.completionStatus
      || value.pendingFinalization.finalizedAt !== normalizedManifest.timing.finalizedAt
      || JSON.stringify(value.pendingFinalization.recovery)
        !== JSON.stringify(normalizedManifest.recovery)) {
      fail("corrupt-attempt", "Terminal protocol manifest does not bind its prepared finalization descriptor.");
    }
  }
  return Object.freeze(attempt);
}

function validateStoredAttempt(value) {
  if (value?.version === RESEARCH_ATTEMPT_VERSION_V1) return validateStoredAttemptV1(value);
  if (value?.version === RESEARCH_ATTEMPT_VERSION_V2
    || value?.version === RESEARCH_ATTEMPT_VERSION_V3) {
    return validateStoredProtocolAttempt(value, value.version);
  }
  fail("corrupt-attempt", "Stored attempt has an unsupported protocol version.");
}

function validateStoredEvidence(rawAttempt, sampleEntries, eventEntries, questionnaireResponseEntries = []) {
  const attempt = validateStoredAttempt(rawAttempt);
  const normalizeEntries = (entries, kind) => {
    const records = entries.map((entry, index) => {
      if (!entry || entry.runId !== attempt.runId || entry.sequence !== entry.value?.sequence) {
        fail("corrupt-record", `${kind}[${index}] has a corrupt storage key.`);
      }
      return entry.value;
    });
    const watermark = kind === "samples" ? attempt.nextSampleSequence : attempt.nextEventSequence;
    if (records.length !== watermark - 1) {
      fail("corrupt-record", `${kind} storage count does not match its authoritative journal watermark.`);
    }
    const normalized = validateSequencedRecords(
      records,
      attempt.runId,
      1,
      kind === "samples" ? "sample" : "event",
      attempt,
    );
    validateRecordTimeline(normalized, kind === "samples" ? "sample" : "event");
    return normalized;
  };
  const samples = normalizeEntries(sampleEntries, "samples");
  const events = normalizeEntries(eventEntries, "events");
  let questionnaireResponses = [];
  if (attempt.version === RESEARCH_ATTEMPT_VERSION_V1) {
    if (questionnaireResponseEntries.length !== 0) {
      fail("corrupt-record", "Historical V1 attempts cannot own questionnaire-response evidence.");
    }
  } else {
    const records = questionnaireResponseEntries.map((entry, index) => {
      if (!entry || entry.runId !== attempt.runId || entry.sequence !== entry.value?.sequence) {
        fail("corrupt-record", `questionnaireResponses[${index}] has a corrupt storage key.`);
      }
      return entry.value;
    });
    if (records.length !== attempt.nextQuestionnaireResponseSequence - 1) {
      fail(
        "corrupt-record",
        "Questionnaire-response storage count does not match its authoritative journal watermark.",
      );
    }
    let draftSuffix = false;
    questionnaireResponses = records.map((record, index) => {
      if (record.sequence !== index + 1) {
        fail("corrupt-record", "Questionnaire-response journal contains a silent sequence gap.");
      }
      const response = validateQuestionnaireResponseForAttempt(record, attempt, null);
      if (response.status === "draft") draftSuffix = true;
      else if (draftSuffix) {
        fail("corrupt-record", "Submitted questionnaire responses cannot follow a terminal draft suffix.");
      }
      return response;
    });
    if (draftSuffix && (attempt.manifest === null || attempt.recoverable)) {
      fail("corrupt-record", "Draft response rows are allowed only in a terminal partial attempt.");
    }
    validateResponseTimeline(questionnaireResponses);
  }
  if (attempt.manifest) {
    const gapEvents = events.filter(({ type }) => type === "timingGap");
    const missedSlots = gapEvents.reduce((sum, event) => sum + event.missedSlotCount, 0);
    if (attempt.manifest.timing.sampleCount !== samples.length
      || attempt.manifest.timing.eventCount !== events.length
      || attempt.manifest.timing.gapEventCount !== gapEvents.length
      || attempt.manifest.timing.missedSlotCount !== missedSlots) {
      fail("corrupt-record", "Terminal manifest timing totals differ from preserved journal evidence.");
    }
    if (isProtocolAttempt(attempt)) {
      const submittedResponses = questionnaireResponses.filter(({ status }) => status === "submitted");
      const draftResponses = questionnaireResponses.filter(({ status }) => status === "draft");
      const modules = protocolResponseReceipts(attempt, submittedResponses, draftResponses, events);
      if (JSON.stringify(attempt.manifest.protocol.questionnaireModules) !== JSON.stringify(modules)
        || attempt.manifest.protocol.submittedResponseCount !== submittedResponses.length
        || attempt.manifest.protocol.draftResponseCount !== draftResponses.length
        || attempt.manifest.timing.questionnaireSubmittedResponseCount
          !== submittedResponses.length
        || attempt.manifest.timing.questionnaireDraftResponseCount !== draftResponses.length) {
        fail(
          "corrupt-record",
          "Terminal manifest questionnaire totals differ from preserved journal evidence.",
        );
      }
    }
  }
  return attempt;
}

function protocolFinalizationEvidence(
  rawAttempt,
  sampleEntries,
  eventEntries,
  questionnaireResponseEntries,
) {
  const attempt = validateStoredEvidence(
    rawAttempt,
    sampleEntries,
    eventEntries,
    questionnaireResponseEntries,
  );
  if (!isProtocolAttempt(attempt)) {
    fail("invalid-record", "Protocol finalization requires a questionnaire-aware attempt.");
  }
  if (attempt.status !== "active") {
    fail("attempt-final", `Run ${attempt.runId} is already terminal.`);
  }
  const samples = sampleEntries.map(({ value }) => clone(value));
  const events = eventEntries.map(({ value }) => clone(value));
  const submittedResponses = questionnaireResponseEntries.map(({ value }) => (
    validateQuestionnaireResponseForAttempt(value, attempt, "submitted")
  ));
  const draftResponses = clone(attempt.activeQuestionnaireDraft?.responses ?? []);
  validateResponseTimeline(draftResponses, submittedResponses.at(-1) ?? null);
  return {
    attempt,
    samples,
    events,
    submittedResponses,
    draftResponses,
    rawAttempt: clone(rawAttempt),
    sampleEntries: clone(sampleEntries),
    eventEntries: clone(eventEntries),
    questionnaireResponseEntries: clone(questionnaireResponseEntries),
  };
}

function protocolFinalizationDescriptor(attempt, manifest) {
  const descriptor = attempt.pendingFinalization ?? {
    completionStatus: manifest.completionStatus,
    finalizedAt: manifest.timing.finalizedAt,
    recovery: manifest.recovery,
  };
  validatePendingFinalization(descriptor);
  if (descriptor.completionStatus !== manifest.completionStatus
    || descriptor.finalizedAt !== manifest.timing.finalizedAt
    || JSON.stringify(descriptor.recovery) !== JSON.stringify(manifest.recovery)) {
    fail("finalization-conflict", "Manifest differs from its prepared finalization metadata.");
  }
  return clone(descriptor);
}

function interruptAttempt(attempt, reason, updatedAt) {
  if (attempt.status !== "active") return attempt;
  const interruptedProtocolStep = isProtocolAttempt(attempt)
    ? attempt.activeProtocolStep
    : null;
  attempt.status = "partial";
  attempt.interruption = isProtocolAttempt(attempt)
    ? {
      reason,
      at: updatedAt,
      restartStimulusIndex: attempt.safeStimulusIndex,
      interruptedStimulusIndex: attempt.activeStimulusIndex,
      interruptedProtocolStepPosition: interruptedProtocolStep?.protocolPosition ?? null,
      interruptedProtocolStepKind: interruptedProtocolStep?.kind ?? null,
      restartProtocolStepPosition: attempt.safeProtocolStepPosition < attempt.context.protocolPlan.steps.length
        ? attempt.safeProtocolStepPosition + 1
        : null,
    }
    : {
      reason,
      at: updatedAt,
      restartStimulusIndex: attempt.safeStimulusIndex,
      interruptedStimulusIndex: attempt.activeStimulusIndex,
    };
  attempt.recoverable = true;
  attempt.activeStimulusIndex = null;
  if (interruptedProtocolStep?.kind === "stimulus"
    || interruptedProtocolStep?.kind === "interval") {
    attempt.activeProtocolStep = null;
  }
  attempt.updatedAt = updatedAt;
  return attempt;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")), { once: true });
  });
}

async function abort(transaction, completion, error) {
  try {
    transaction.abort();
  } catch {
    // The transaction may already be settled.
  }
  await completion.catch(() => {});
  throw error;
}

export class IndexedDbResearchJournal {
  constructor({
    indexedDB = globalThis.indexedDB,
    keyRange = globalThis.IDBKeyRange,
    databaseName = RESEARCH_JOURNAL_DATABASE,
  } = {}) {
    if (!indexedDB?.open || !keyRange?.bound) {
      fail("indexeddb-unavailable", "IndexedDB is required; Research does not fall back to volatile storage.");
    }
    this.indexedDB = indexedDB;
    this.keyRange = keyRange;
    this.databaseName = databaseName;
    this.databasePromise = null;
  }

  async open() {
    return this.#database();
  }

  async reserveAttempt(input) {
    const reservation = validateReservation(input);
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, LOCKS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const locks = transaction.objectStore(LOCKS);
    const key = lockKey(reservation.experimentId, reservation.participantId, reservation.context.workspaceId);
    const [existingRun, existingLock, existingAttempts] = await Promise.all([
      requestResult(attempts.get(reservation.runId)),
      requestResult(locks.get(key)),
      requestResult(attempts.getAll()),
    ]);
    if (existingRun) return abort(transaction, completion, new ResearchJournalError(
      "attempt-exists",
      `Run ${reservation.runId} already exists.`,
    ));
    if (existingLock) return abort(transaction, completion, new ResearchJournalError(
      "participant-locked",
      `Participant ${reservation.participantId} already has an active attempt.`,
    ));
    const attemptCollision = existingAttempts.some((attempt) => (
      attempt.context?.workspaceId === reservation.context.workspaceId
      && attempt.experimentId === reservation.experimentId
      && attempt.participantId === reservation.participantId
      && (attempt.attemptNumber === reservation.attemptNumber || attempt.sessionStem === reservation.sessionStem)
    ));
    if (attemptCollision) return abort(transaction, completion, new ResearchJournalError(
      "attempt-exists",
      `Attempt ${reservation.attemptNumber} already exists for ${reservation.participantId} in this workspace.`,
    ));

    const attempt = initialAttempt(reservation);
    attempts.add(attempt);
    locks.add({ key, runId: reservation.runId, ownerId: reservation.ownerId, acquiredAt: reservation.createdAt });
    await completion;
    return immutable(attempt);
  }

  async reserveProtocolAttempt(input) {
    const reservation = await validateProtocolReservation(input);
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, LOCKS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const locks = transaction.objectStore(LOCKS);
    const key = lockKey(
      reservation.experimentId,
      reservation.participantId,
      reservation.context.workspaceId,
    );
    const [existingRun, existingLock, existingAttempts] = await Promise.all([
      requestResult(attempts.get(reservation.runId)),
      requestResult(locks.get(key)),
      requestResult(attempts.getAll()),
    ]);
    if (existingRun) return abort(transaction, completion, new ResearchJournalError(
      "attempt-exists",
      `Run ${reservation.runId} already exists.`,
    ));
    if (existingLock) return abort(transaction, completion, new ResearchJournalError(
      "participant-locked",
      `Participant ${reservation.participantId} already has an active attempt.`,
    ));
    const attemptCollision = existingAttempts.some((attempt) => (
      attempt.context?.workspaceId === reservation.context.workspaceId
      && attempt.experimentId === reservation.experimentId
      && attempt.participantId === reservation.participantId
      && (attempt.attemptNumber === reservation.attemptNumber
        || attempt.sessionStem === reservation.sessionStem)
    ));
    if (attemptCollision) return abort(transaction, completion, new ResearchJournalError(
      "attempt-exists",
      `Attempt ${reservation.attemptNumber} already exists for ${reservation.participantId} in this workspace.`,
    ));
    const attempt = initialProtocolAttempt(reservation);
    attempts.add(attempt);
    locks.add({
      key,
      runId: reservation.runId,
      ownerId: reservation.ownerId,
      acquiredAt: reservation.createdAt,
    });
    await completion;
    return immutable(attempt);
  }

  async appendBatch({
    runId,
    expectedSampleSequence,
    expectedEventSequence,
    samples = [],
    events = [],
    stimulusState = null,
    updatedAt,
  }) {
    identifier(runId, "runId");
    integer(expectedSampleSequence, "expectedSampleSequence");
    integer(expectedEventSequence, "expectedEventSequence");
    isoTimestamp(updatedAt, "updatedAt");
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, SAMPLES, EVENTS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const attempt = await requestResult(attempts.get(runId));
    if (!attempt) return abort(transaction, completion, new ResearchJournalError("missing-attempt", `Run ${runId} does not exist.`));
    if (attempt.status !== "active") return abort(transaction, completion, new ResearchJournalError("attempt-final", `Run ${runId} is not active.`));
    if (attempt.nextSampleSequence !== expectedSampleSequence || attempt.nextEventSequence !== expectedEventSequence) {
      return abort(transaction, completion, new ResearchJournalError("sequence-conflict", "Journal sequence changed before the batch committed."));
    }
    const sampleStore = transaction.objectStore(SAMPLES);
    const eventStore = transaction.objectStore(EVENTS);
    const evidenceRange = this.keyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const [previousSampleEntry, previousEventEntry, storedSampleCount, storedEventCount] = await Promise.all([
      expectedSampleSequence > 1 ? requestResult(sampleStore.get([runId, expectedSampleSequence - 1])) : null,
      expectedEventSequence > 1 ? requestResult(eventStore.get([runId, expectedEventSequence - 1])) : null,
      requestResult(sampleStore.count(evidenceRange)),
      requestResult(eventStore.count(evidenceRange)),
    ]);
    let normalizedSamples;
    let normalizedEvents;
    let normalizedStimulusState;
    try {
      if (storedSampleCount !== expectedSampleSequence - 1 || storedEventCount !== expectedEventSequence - 1) {
        fail("corrupt-record", "Journal storage count differs from its append watermark.");
      }
      normalizedSamples = validateSequencedRecords(samples, runId, expectedSampleSequence, "sample", attempt);
      normalizedEvents = validateSequencedRecords(events, runId, expectedEventSequence, "event", attempt);
      if (isProtocolAttempt(attempt) && normalizedSamples.length > 0) {
        const active = attempt.activeProtocolStep;
        if (!active || active.kind !== "stimulus"
          || normalizedSamples.some((sample) => (
            sample.stimulusPosition !== active.stimulusPosition
            || sample.stimulusIdentity.stimulusId !== active.stimulusId
          ))) {
          fail("unsafe-recovery", "Samples can be appended only inside the active stimulus protocol step.");
        }
      }
      const previousSample = previousSampleEntry
        ? validateSequencedRecords([previousSampleEntry.value], runId, expectedSampleSequence - 1, "sample", attempt)[0]
        : null;
      const previousEvent = previousEventEntry
        ? validateSequencedRecords([previousEventEntry.value], runId, expectedEventSequence - 1, "event", attempt)[0]
        : null;
      validateRecordTimeline(normalizedSamples, "sample", previousSample);
      validateRecordTimeline(normalizedEvents, "event", previousEvent);
      if (isProtocolAttempt(attempt) && stimulusState !== null) {
        fail(
          "invalid-record",
          "Questionnaire-aware attempts must advance through protocol-state transitions.",
        );
      }
      normalizedStimulusState = validateStimulusState(stimulusState, attempt);
      if (normalizedSamples.length === 0 && normalizedEvents.length === 0 && !normalizedStimulusState) {
        fail("empty-batch", "Journal batches must contain evidence or a stimulus-state transition.");
      }
    } catch (error) {
      return abort(transaction, completion, error);
    }

    for (const sample of normalizedSamples) sampleStore.add({ runId, sequence: sample.sequence, value: sample });
    for (const event of normalizedEvents) eventStore.add({ runId, sequence: event.sequence, value: event });
    attempt.nextSampleSequence += normalizedSamples.length;
    attempt.nextEventSequence += normalizedEvents.length;
    if (normalizedStimulusState) {
      attempt.activeStimulusIndex = normalizedStimulusState.activeStimulusIndex;
      attempt.safeStimulusIndex = normalizedStimulusState.safeStimulusIndex;
    }
    attempt.updatedAt = updatedAt;
    attempts.put(attempt);
    await completion;
    return immutable(attempt);
  }

  async setStimulusState({ runId, activeStimulusIndex, safeStimulusIndex, updatedAt }) {
    identifier(runId, "runId");
    isoTimestamp(updatedAt, "updatedAt");
    return this.#mutateAttempt(runId, (attempt) => {
      if (attempt.status !== "active") fail("attempt-final", "Only active attempts can change stimulus state.");
      const state = validateStimulusState({ activeStimulusIndex, safeStimulusIndex }, attempt);
      attempt.activeStimulusIndex = state.activeStimulusIndex;
      attempt.safeStimulusIndex = state.safeStimulusIndex;
      attempt.updatedAt = updatedAt;
    });
  }

  async setProtocolState(input) {
    exactObject(input, "Protocol state transition", [
      "runId", "activeProtocolStepPosition", "safeProtocolStepPosition", "updatedAt",
    ]);
    identifier(input.runId, "runId");
    isoTimestamp(input.updatedAt, "updatedAt");
    return this.#mutateAttempt(input.runId, (attempt) => {
      if (!isProtocolAttempt(attempt)) {
        fail("invalid-record", "Historical V1 attempts must use stimulus-state transitions.");
      }
      if (attempt.status !== "active") fail("attempt-final", "Only active attempts can change protocol state.");
      const state = validateProtocolStateTransition(input, attempt);
      applyProtocolState(attempt, state);
      attempt.updatedAt = input.updatedAt;
    });
  }

  async checkpointQuestionnaireDraft(input) {
    exactObject(input, "Questionnaire draft checkpoint", [
      "runId", "expectedSafeProtocolStepPosition", "protocolStepPosition", "answers", "updatedAt",
    ]);
    identifier(input.runId, "runId");
    integer(input.expectedSafeProtocolStepPosition, "expectedSafeProtocolStepPosition");
    const stepPosition = integer(input.protocolStepPosition, "protocolStepPosition", 1);
    const updatedAt = isoTimestamp(input.updatedAt, "updatedAt");
    const snapshot = await this.#readAttemptSnapshot(input.runId);
    if (!snapshot || !isProtocolAttempt(snapshot) || snapshot.status !== "active") {
      fail("attempt-final", "Questionnaire drafts require an active questionnaire-aware attempt.");
    }
    const { step, responses } = await deriveQuestionnaireResponses(
      snapshot,
      stepPosition,
      input.answers,
      "draft",
    );
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS], "readwrite");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(ATTEMPTS);
    const attempt = await requestResult(store.get(input.runId));
    try {
      if (!attempt || !isProtocolAttempt(attempt) || attempt.status !== "active") {
        fail("attempt-final", "Questionnaire drafts require an active questionnaire-aware attempt.");
      }
      validateStoredAttempt(attempt);
      if (attempt.safeProtocolStepPosition !== input.expectedSafeProtocolStepPosition
        || attempt.safeProtocolStepPosition !== stepPosition - 1
        || attempt.activeProtocolStep?.protocolPosition !== stepPosition
        || JSON.stringify(attempt.activeProtocolStep) !== JSON.stringify(step)
        || attempt.nextQuestionnaireResponseSequence !== snapshot.nextQuestionnaireResponseSequence) {
        fail("sequence-conflict", "Protocol or questionnaire evidence changed before the draft committed.");
      }
      const normalizedResponses = responses.map((response) => (
        validateQuestionnaireResponseForAttempt(response, attempt, "draft")
      ));
      attempt.activeQuestionnaireDraft = {
        schema: QUESTIONNAIRE_DRAFT_SCHEMA,
        version: 1,
        protocolStepPosition: stepPosition,
        moduleId: step.moduleId,
        questionnaireId: step.questionnaireId,
        definitionSha256: step.definitionSha256,
        responses: normalizedResponses,
        updatedAt,
      };
      validateDraft(attempt.activeQuestionnaireDraft, attempt);
      attempt.updatedAt = updatedAt;
    } catch (error) {
      return abort(transaction, completion, error);
    }
    store.put(attempt);
    await completion;
    return immutable(attempt);
  }

  async submitQuestionnaireStep(input) {
    exactObject(input, "Questionnaire submit transaction", [
      "runId", "expectedEventSequence", "expectedQuestionnaireResponseSequence",
      "expectedSafeProtocolStepPosition", "protocolStepPosition", "answers",
      "completionEvent", "updatedAt",
    ]);
    identifier(input.runId, "runId");
    integer(input.expectedEventSequence, "expectedEventSequence", 1);
    integer(input.expectedQuestionnaireResponseSequence, "expectedQuestionnaireResponseSequence", 1);
    integer(input.expectedSafeProtocolStepPosition, "expectedSafeProtocolStepPosition");
    const stepPosition = integer(input.protocolStepPosition, "protocolStepPosition", 1);
    const updatedAt = isoTimestamp(input.updatedAt, "updatedAt");
    exactObject(input.completionEvent, "Questionnaire completion event descriptor", [
      "wallTimeUtc", "monotonicTimeNs", "detailCode",
    ]);
    const snapshot = await this.#readAttemptSnapshot(input.runId);
    if (!snapshot || !isProtocolAttempt(snapshot) || snapshot.status !== "active") {
      fail("attempt-final", "Questionnaire submission requires an active questionnaire-aware attempt.");
    }
    const { step, responses } = await deriveQuestionnaireResponses(
      snapshot,
      stepPosition,
      input.answers,
      "submitted",
    );
    const completionEvent = validateResearchEventV2({
      schema: RESEARCH_EVENT_SCHEMA,
      version: 2,
      sequence: input.expectedEventSequence,
      runId: snapshot.runId,
      participantId: snapshot.participantId,
      attemptNumber: snapshot.attemptNumber,
      settingsSha256: snapshot.settingsHash,
      assignmentPlanSha256: snapshot.planHash,
      protocolPlanSha256: snapshot.protocolPlanHash,
      wallTimeUtc: input.completionEvent.wallTimeUtc,
      monotonicTimeNs: input.completionEvent.monotonicTimeNs,
      type: "questionnaireCompleted",
      stimulusIdentity: null,
      stimulusPosition: null,
      protocolStepPosition: stepPosition,
      moduleId: step.moduleId,
      questionnaireId: step.questionnaireId,
      definitionSha256: step.definitionSha256,
      mediaTimeMs: null,
      missedSlotCount: null,
      detailCode: input.completionEvent.detailCode,
    });
    const database = await this.#database();
    const transaction = database.transaction(
      [ATTEMPTS, EVENTS, QUESTIONNAIRE_RESPONSES],
      "readwrite",
    );
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const events = transaction.objectStore(EVENTS);
    const responseStore = transaction.objectStore(QUESTIONNAIRE_RESPONSES);
    const attempt = await requestResult(attempts.get(input.runId));
    if (!attempt) return abort(
      transaction,
      completion,
      new ResearchJournalError("missing-attempt", `Run ${input.runId} does not exist.`),
    );
    const eventRange = this.keyRange.bound([input.runId, 0], [input.runId, Number.MAX_SAFE_INTEGER]);
    const responseRange = this.keyRange.bound([input.runId, 0], [input.runId, Number.MAX_SAFE_INTEGER]);
    const [eventCount, responseCount, previousEventEntry, previousResponseEntry] = await Promise.all([
      requestResult(events.count(eventRange)),
      requestResult(responseStore.count(responseRange)),
      input.expectedEventSequence > 1
        ? requestResult(events.get([input.runId, input.expectedEventSequence - 1]))
        : null,
      input.expectedQuestionnaireResponseSequence > 1
        ? requestResult(responseStore.get([
          input.runId,
          input.expectedQuestionnaireResponseSequence - 1,
        ]))
        : null,
    ]);
    let normalizedResponses;
    let normalizedEvent;
    try {
      validateStoredAttempt(attempt);
      if (attempt.status !== "active"
        || attempt.safeProtocolStepPosition !== input.expectedSafeProtocolStepPosition
        || attempt.safeProtocolStepPosition !== stepPosition - 1
        || attempt.activeProtocolStep?.protocolPosition !== stepPosition
        || JSON.stringify(attempt.activeProtocolStep) !== JSON.stringify(step)
        || attempt.nextEventSequence !== input.expectedEventSequence
        || attempt.nextQuestionnaireResponseSequence
          !== input.expectedQuestionnaireResponseSequence
        || eventCount !== input.expectedEventSequence - 1
        || responseCount !== input.expectedQuestionnaireResponseSequence - 1) {
        fail("sequence-conflict", "Protocol or questionnaire evidence changed before submission committed.");
      }
      normalizedResponses = responses.map((response, index) => {
        if (response.sequence !== input.expectedQuestionnaireResponseSequence + index) {
          fail("sequence-conflict", "Questionnaire response sequence changed before submission.");
        }
        return validateQuestionnaireResponseForAttempt(response, attempt, "submitted");
      });
      const previousResponse = previousResponseEntry
        ? validateQuestionnaireResponseForAttempt(previousResponseEntry.value, attempt, "submitted")
        : null;
      validateResponseTimeline(normalizedResponses, previousResponse);
      normalizedEvent = validateEventV2ForAttempt(completionEvent, attempt);
      const previousEvent = previousEventEntry
        ? validateSequencedRecords(
          [previousEventEntry.value],
          input.runId,
          input.expectedEventSequence - 1,
          "event",
          attempt,
        )[0]
        : null;
      validateRecordTimeline([normalizedEvent], "event", previousEvent);
      if (normalizedResponses.length > 0
        && BigInt(normalizedEvent.monotonicTimeNs)
          < BigInt(normalizedResponses.at(-1).monotonicTimeNs)) {
        fail("corrupt-record", "Questionnaire completion precedes its final response.");
      }
    } catch (error) {
      return abort(transaction, completion, error);
    }
    for (const response of normalizedResponses) {
      responseStore.add({ runId: input.runId, sequence: response.sequence, value: response });
    }
    events.add({ runId: input.runId, sequence: normalizedEvent.sequence, value: normalizedEvent });
    attempt.nextQuestionnaireResponseSequence += normalizedResponses.length;
    attempt.nextEventSequence += 1;
    attempt.safeProtocolStepPosition = stepPosition;
    attempt.activeProtocolStep = null;
    attempt.activeQuestionnaireDraft = null;
    attempt.activeStimulusIndex = null;
    attempt.updatedAt = updatedAt;
    attempts.put(attempt);
    await completion;
    return immutable(attempt);
  }

  async markInterrupted({ runId, reason, updatedAt }) {
    identifier(runId, "runId");
    identifier(reason, "interruption reason");
    isoTimestamp(updatedAt, "updatedAt");
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, LOCKS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const attempt = await requestResult(attempts.get(runId));
    if (!attempt) return abort(transaction, completion, new ResearchJournalError("missing-attempt", `Run ${runId} does not exist.`));
    if (attempt.status !== "active") return immutable(attempt);
    interruptAttempt(attempt, reason, updatedAt);
    attempts.put(attempt);
    transaction.objectStore(LOCKS).delete(lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId));
    await completion;
    return immutable(attempt);
  }

  async reconcileAbandonedAttempts({ reason = "exclusive-runtime-recovery", updatedAt }) {
    identifier(reason, "interruption reason");
    isoTimestamp(updatedAt, "updatedAt");
    await this.auditAndQuarantine({ quarantinedAt: updatedAt });
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, LOCKS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const locks = transaction.objectStore(LOCKS);
    const values = await requestResult(attempts.getAll());
    const changed = [];
    for (const attempt of values) {
      if (attempt.status !== "active") continue;
      interruptAttempt(attempt, reason, updatedAt);
      attempts.put(attempt);
      locks.delete(lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId));
      changed.push(immutable(attempt));
    }
    await completion;
    return Object.freeze(changed);
  }

  async prepareFinalization({ runId, completionStatus, finalizedAt, recovery }) {
    identifier(runId, "runId");
    const descriptor = clone(validatePendingFinalization({ completionStatus, finalizedAt, recovery }));
    return this.#mutateAttempt(runId, (attempt) => {
      if (attempt.status !== "active") fail("attempt-final", "Only active attempts can prepare finalization.");
      if (descriptor.completionStatus === "completed"
        && isProtocolAttempt(attempt)) {
        if (attempt.safeProtocolStepPosition !== attempt.context.protocolPlan.steps.length
          || attempt.activeProtocolStep !== null
          || attempt.activeQuestionnaireDraft !== null) {
          fail("unsafe-recovery", "A completed finalization requires every protocol step to be safe.");
        }
      } else {
        const assignment = assignmentFromContext(attempt.context, attempt.participantId);
        if (descriptor.completionStatus === "completed" && assignment
          && attempt.safeStimulusIndex !== assignment.slots.length) {
          fail("unsafe-recovery", "A completed finalization requires the final safe stimulus boundary.");
        }
      }
      if (attempt.pendingFinalization !== null
        && JSON.stringify(attempt.pendingFinalization) !== JSON.stringify(descriptor)) {
        fail("finalization-conflict", "Prepared finalization metadata cannot change across retries.");
      }
      attempt.pendingFinalization = descriptor;
      attempt.updatedAt = descriptor.finalizedAt;
    });
  }

  async finalize({ runId, status, manifest, finalizedAt }) {
    identifier(runId, "runId");
    if (!TERMINAL_STATUSES.has(status)) fail("invalid-record", "Final status must be partial or complete.");
    isoTimestamp(finalizedAt, "finalizedAt");
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, LOCKS, SAMPLES, EVENTS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const attempt = await requestResult(attempts.get(runId));
    if (!attempt) return abort(transaction, completion, new ResearchJournalError("missing-attempt", `Run ${runId} does not exist.`));
    if (attempt.status !== "active") return abort(transaction, completion, new ResearchJournalError("attempt-final", `Run ${runId} is already terminal.`));
    if (isProtocolAttempt(attempt)) return abort(
      transaction,
      completion,
      new ResearchJournalError(
        "manifest-v3-required",
        "Questionnaire-aware finalization requires the ResearchRunManifestV3/V4 persistence slice.",
      ),
    );
    const range = this.keyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const [sampleCount, eventCount] = await Promise.all([
      requestResult(transaction.objectStore(SAMPLES).count(range)),
      requestResult(transaction.objectStore(EVENTS).count(range)),
    ]);
    let normalizedManifest;
    try {
      normalizedManifest = validateManifestForAttempt(manifest, attempt);
      if ((status === "complete") !== (normalizedManifest.completionStatus === "completed")) {
        fail("finalization-conflict", "Journal terminal status differs from the run manifest completion status.");
      }
      if (sampleCount !== attempt.nextSampleSequence - 1
        || eventCount !== attempt.nextEventSequence - 1
        || normalizedManifest.timing.sampleCount !== sampleCount
        || normalizedManifest.timing.eventCount !== eventCount) {
        fail("corrupt-record", "Final manifest counts do not match journal watermarks and stored evidence.");
      }
      const descriptor = attempt.pendingFinalization ?? {
        completionStatus: normalizedManifest.completionStatus,
        finalizedAt: normalizedManifest.timing.finalizedAt,
        recovery: normalizedManifest.recovery,
      };
      validatePendingFinalization(descriptor);
      if (descriptor.completionStatus !== normalizedManifest.completionStatus
        || descriptor.finalizedAt !== normalizedManifest.timing.finalizedAt
        || JSON.stringify(descriptor.recovery) !== JSON.stringify(normalizedManifest.recovery)) {
        fail("finalization-conflict", "Manifest differs from its prepared finalization metadata.");
      }
      attempt.pendingFinalization = clone(descriptor);
    } catch (error) {
      return abort(transaction, completion, error);
    }
    attempt.status = status;
    attempt.updatedAt = finalizedAt;
    attempt.finalizedAt = finalizedAt;
    attempt.activeStimulusIndex = null;
    attempt.manifest = clone(normalizedManifest);
    attempt.recoverable = false;
    attempts.put(attempt);
    transaction.objectStore(LOCKS).delete(lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId));
    await completion;
    return immutable(attempt);
  }

  async finalizeProtocol(input) {
    exactObject(input, "Protocol finalization", ["runId", "status", "manifest", "finalizedAt"]);
    const runId = identifier(input.runId, "runId");
    if (!TERMINAL_STATUSES.has(input.status)) {
      fail("invalid-record", "Final status must be partial or complete.");
    }
    const finalizedAt = isoTimestamp(input.finalizedAt, "finalizedAt");
    const snapshot = await this.#readProtocolFinalizationSnapshot(runId);
    const normalizedManifest = await validateProtocolManifestEvidence({
      manifest: input.manifest,
      attempt: snapshot.attempt,
      status: input.status,
      finalizedAt,
      samples: snapshot.samples,
      events: snapshot.events,
      submittedResponses: snapshot.submittedResponses,
      draftResponses: snapshot.draftResponses,
    });
    const descriptor = protocolFinalizationDescriptor(snapshot.attempt, normalizedManifest);

    const database = await this.#database();
    const transaction = database.transaction(
      [ATTEMPTS, LOCKS, SAMPLES, EVENTS, QUESTIONNAIRE_RESPONSES],
      "readwrite",
    );
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const locks = transaction.objectStore(LOCKS);
    const samples = transaction.objectStore(SAMPLES);
    const events = transaction.objectStore(EVENTS);
    const responseStore = transaction.objectStore(QUESTIONNAIRE_RESPONSES);
    const range = this.keyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const key = lockKey(
      snapshot.attempt.experimentId,
      snapshot.attempt.participantId,
      snapshot.attempt.context.workspaceId,
    );
    const [attempt, lock, sampleEntries, eventEntries, responseEntries] = await Promise.all([
      requestResult(attempts.get(runId)),
      requestResult(locks.get(key)),
      requestResult(samples.getAll(range)),
      requestResult(events.getAll(range)),
      requestResult(responseStore.getAll(range)),
    ]);
    try {
      if (!attempt || attempt.status !== "active") {
        fail("attempt-final", `Run ${runId} is already terminal.`);
      }
      if (!lock || lock.runId !== runId) {
        fail("corrupt-record", "Protocol finalization requires the reserved participant lock.");
      }
      if (JSON.stringify(attempt) !== JSON.stringify(snapshot.rawAttempt)
        || JSON.stringify(sampleEntries) !== JSON.stringify(snapshot.sampleEntries)
        || JSON.stringify(eventEntries) !== JSON.stringify(snapshot.eventEntries)
        || JSON.stringify(responseEntries)
          !== JSON.stringify(snapshot.questionnaireResponseEntries)) {
        fail("sequence-conflict", "Protocol evidence changed while final artifacts were prepared.");
      }

      const terminalResponseEntries = [...responseEntries];
      for (const response of snapshot.draftResponses) {
        terminalResponseEntries.push({ runId, sequence: response.sequence, value: response });
      }
      attempt.nextQuestionnaireResponseSequence += snapshot.draftResponses.length;
      attempt.pendingFinalization = clone(descriptor);
      attempt.status = input.status;
      attempt.updatedAt = finalizedAt;
      attempt.finalizedAt = finalizedAt;
      attempt.activeStimulusIndex = null;
      attempt.activeProtocolStep = null;
      attempt.activeQuestionnaireDraft = null;
      attempt.manifest = clone(normalizedManifest);
      attempt.recoverable = false;
      validateStoredEvidence(
        attempt,
        sampleEntries,
        eventEntries,
        terminalResponseEntries,
      );

      for (const response of snapshot.draftResponses) {
        responseStore.add({ runId, sequence: response.sequence, value: response });
      }
      attempts.put(attempt);
      locks.delete(key);
    } catch (error) {
      return abort(transaction, completion, error);
    }
    await completion;
    return immutable(attempt);
  }

  async resumeAttempt({ runId, ownerId, resumedAt }) {
    identifier(runId, "runId");
    identifier(ownerId, "ownerId");
    isoTimestamp(resumedAt, "resumedAt");
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, LOCKS], "readwrite");
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const locks = transaction.objectStore(LOCKS);
    const attempt = await requestResult(attempts.get(runId));
    if (!attempt) return abort(transaction, completion, new ResearchJournalError("missing-attempt", `Run ${runId} does not exist.`));
    if (attempt.status !== "partial" || !attempt.recoverable) {
      return abort(transaction, completion, new ResearchJournalError("not-recoverable", `Run ${runId} is not recoverable.`));
    }
    const key = lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId);
    if (await requestResult(locks.get(key))) {
      return abort(transaction, completion, new ResearchJournalError("participant-locked", `Participant ${attempt.participantId} already has an active attempt.`));
    }
    attempt.status = "active";
    attempt.recoverable = false;
    attempt.ownerId = ownerId;
    attempt.updatedAt = resumedAt;
    attempt.activeStimulusIndex = null;
    const interruptedIndex = attempt.interruption?.interruptedStimulusIndex;
    if (attempt.pendingFinalization === null) {
      const assignment = assignmentFromContext(attempt.context, attempt.participantId);
      attempt.context.resumed = true;
      attempt.context.sourceRunId = runId;
      attempt.context.restartedStimulusIds = Number.isSafeInteger(interruptedIndex) && assignment
        ? [assignment.slots[interruptedIndex]?.stimulusId].filter(Boolean)
        : [];
    }
    attempts.put(attempt);
    locks.add({ key, runId, ownerId, acquiredAt: resumedAt });
    await completion;
    return immutable(attempt);
  }

  async getAttempt(runId) {
    identifier(runId, "runId");
    await this.auditAndQuarantine();
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS], "readonly");
    const completion = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(ATTEMPTS).get(runId));
    await completion;
    return value ? immutable(value) : undefined;
  }

  async readRecords(runId, { kind, fromSequence = 0, limit = 10_000 } = {}) {
    identifier(runId, "runId");
    const storeName = kind === "samples" ? SAMPLES : kind === "events" ? EVENTS : null;
    if (!storeName) fail("invalid-record", "Record kind must be samples or events.");
    integer(fromSequence, "fromSequence");
    integer(limit, "limit", 1);
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, storeName], "readonly");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(storeName);
    const startSequence = Math.max(1, fromSequence);
    const range = this.keyRange.bound([runId, startSequence], [runId, Number.MAX_SAFE_INTEGER]);
    const allRange = this.keyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const [attempt, values, totalCount, previousEntry] = await Promise.all([
      requestResult(transaction.objectStore(ATTEMPTS).get(runId)),
      requestResult(store.getAll(range, limit)),
      requestResult(store.count(allRange)),
      startSequence > 1 ? requestResult(store.get([runId, startSequence - 1])) : null,
    ]);
    await completion;
    if (!attempt) fail("missing-attempt", `Run ${runId} does not exist.`);
    validateStoredAttempt(attempt);
    const watermark = kind === "samples" ? attempt.nextSampleSequence : attempt.nextEventSequence;
    const expectedTotal = watermark - 1;
    const expectedPageLength = Math.min(limit, Math.max(0, watermark - startSequence));
    if (totalCount !== expectedTotal || values.length !== expectedPageLength) {
      fail("corrupt-record", `${kind} storage count does not match its authoritative journal watermark.`);
    }
    let expectedSequence = startSequence;
    const normalized = values.map((entry, index) => {
      if (entry.sequence !== entry.value?.sequence || entry.runId !== runId) {
        fail("corrupt-record", `${kind}[${index}] has a corrupt storage key.`);
      }
      if (entry.sequence !== expectedSequence) {
        fail("corrupt-record", `${kind}[${index}] reveals a silent journal sequence gap.`);
      }
      expectedSequence += 1;
      return validateSequencedRecords(
        [entry.value],
        runId,
        entry.sequence,
        kind === "samples" ? "sample" : "event",
        attempt,
      )[0];
    });
    const previous = previousEntry
      ? validateSequencedRecords(
        [previousEntry.value],
        runId,
        startSequence - 1,
        kind === "samples" ? "sample" : "event",
        attempt,
      )[0]
      : null;
    validateRecordTimeline(normalized, kind === "samples" ? "sample" : "event", previous);
    return Object.freeze(normalized.map(immutable));
  }

  async readQuestionnaireResponses(
    runId,
    { fromSequence = 0, limit = 10_000 } = {},
  ) {
    identifier(runId, "runId");
    integer(fromSequence, "fromSequence");
    integer(limit, "limit", 1);
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS, QUESTIONNAIRE_RESPONSES], "readonly");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(QUESTIONNAIRE_RESPONSES);
    const startSequence = Math.max(1, fromSequence);
    const range = this.keyRange.bound([runId, startSequence], [runId, Number.MAX_SAFE_INTEGER]);
    const allRange = this.keyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const [rawAttempt, values, totalCount, previousEntry] = await Promise.all([
      requestResult(transaction.objectStore(ATTEMPTS).get(runId)),
      requestResult(store.getAll(range, limit)),
      requestResult(store.count(allRange)),
      startSequence > 1 ? requestResult(store.get([runId, startSequence - 1])) : null,
    ]);
    await completion;
    if (!rawAttempt) fail("missing-attempt", `Run ${runId} does not exist.`);
    const attempt = validateStoredAttempt(rawAttempt);
    if (!isProtocolAttempt(attempt)) {
      fail("invalid-record", "Historical V1 attempts have no questionnaire responses.");
    }
    const expectedTotal = attempt.nextQuestionnaireResponseSequence - 1;
    const expectedPageLength = Math.min(limit, Math.max(0, attempt.nextQuestionnaireResponseSequence - startSequence));
    if (totalCount !== expectedTotal || values.length !== expectedPageLength) {
      fail(
        "corrupt-record",
        "Questionnaire-response storage count does not match its authoritative journal watermark.",
      );
    }
    let expectedSequence = startSequence;
    const responses = values.map((entry, index) => {
      if (entry.runId !== runId || entry.sequence !== entry.value?.sequence
        || entry.sequence !== expectedSequence) {
        fail("corrupt-record", `questionnaireResponses[${index}] reveals a corrupt key or gap.`);
      }
      expectedSequence += 1;
      return validateQuestionnaireResponseForAttempt(entry.value, attempt, null);
    });
    const previous = previousEntry
      ? validateQuestionnaireResponseForAttempt(previousEntry.value, attempt, null)
      : null;
    validateResponseTimeline(responses, previous);
    return Object.freeze(responses.map(immutable));
  }

  async listAttempts({ experimentId } = {}) {
    await this.auditAndQuarantine();
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS], "readonly");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(ATTEMPTS);
    const values = experimentId
      ? await requestResult(store.index("experimentId").getAll(identifier(experimentId, "experimentId")))
      : await requestResult(store.getAll());
    await completion;
    return Object.freeze(values.map(immutable));
  }

  async auditAndQuarantine({ quarantinedAt = new Date().toISOString() } = {}) {
    isoTimestamp(quarantinedAt, "quarantinedAt");
    const database = await this.#database();
    const transaction = database.transaction(
      [ATTEMPTS, SAMPLES, EVENTS, QUESTIONNAIRE_RESPONSES, LOCKS, QUARANTINE],
      "readwrite",
    );
    const completion = transactionDone(transaction);
    const attempts = transaction.objectStore(ATTEMPTS);
    const samples = transaction.objectStore(SAMPLES);
    const events = transaction.objectStore(EVENTS);
    const questionnaireResponses = transaction.objectStore(QUESTIONNAIRE_RESPONSES);
    const locks = transaction.objectStore(LOCKS);
    const quarantine = transaction.objectStore(QUARANTINE);
    const [values, lockValues, sampleValues, eventValues, questionnaireResponseValues] = await Promise.all([
      requestResult(attempts.getAll()),
      requestResult(locks.getAll()),
      requestResult(samples.getAll()),
      requestResult(events.getAll()),
      requestResult(questionnaireResponses.getAll()),
    ]);
    const groupByRun = (entries) => {
      const grouped = new Map();
      for (const entry of entries) {
        const key = typeof entry?.runId === "string" ? entry.runId : "<invalid-run-id>";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(entry);
      }
      return grouped;
    };
    const samplesByRun = groupByRun(sampleValues);
    const eventsByRun = groupByRun(eventValues);
    const questionnaireResponsesByRun = groupByRun(questionnaireResponseValues);
    const issues = [];
    for (const raw of values) {
      try {
        validateStoredEvidence(
          raw,
          samplesByRun.get(raw?.runId) ?? [],
          eventsByRun.get(raw?.runId) ?? [],
          questionnaireResponsesByRun.get(raw?.runId) ?? [],
        );
      } catch (error) {
        const runId = typeof raw?.runId === "string" ? raw.runId : null;
        const issue = Object.freeze({
          recordType: "attempt",
          runId,
          reasonCode: error?.code ?? "corrupt-attempt",
          reason: error instanceof Error ? error.message : String(error),
          quarantinedAt,
        });
        const rawSamples = samplesByRun.get(raw?.runId) ?? [];
        const rawEvents = eventsByRun.get(raw?.runId) ?? [];
        const rawQuestionnaireResponses = questionnaireResponsesByRun.get(raw?.runId) ?? [];
        quarantine.add({
          ...issue,
          raw: clone(raw),
          evidence: {
            attempt: clone(raw),
            samples: clone(rawSamples),
            events: clone(rawEvents),
            questionnaireResponses: clone(rawQuestionnaireResponses),
          },
        });
        attempts.delete(raw?.runId);
        for (const lock of lockValues) {
          if (lock?.runId === raw?.runId) locks.delete(lock.key);
        }
        for (const entry of rawSamples) samples.delete([entry.runId, entry.sequence]);
        for (const entry of rawEvents) events.delete([entry.runId, entry.sequence]);
        for (const entry of rawQuestionnaireResponses) {
          questionnaireResponses.delete([entry.runId, entry.sequence]);
        }
        issues.push(issue);
      }
    }
    const attemptRunIds = new Set(values.map((raw) => raw?.runId).filter((runId) => typeof runId === "string"));
    const evidenceRunIds = new Set([
      ...samplesByRun.keys(),
      ...eventsByRun.keys(),
      ...questionnaireResponsesByRun.keys(),
    ]);
    for (const orphanRunId of evidenceRunIds) {
      if (attemptRunIds.has(orphanRunId)) continue;
      const rawSamples = samplesByRun.get(orphanRunId) ?? [];
      const rawEvents = eventsByRun.get(orphanRunId) ?? [];
      const rawQuestionnaireResponses = questionnaireResponsesByRun.get(orphanRunId) ?? [];
      const issue = Object.freeze({
        recordType: "evidence",
        runId: orphanRunId === "<invalid-run-id>" ? null : orphanRunId,
        reasonCode: "orphan-evidence",
        reason: "Sample, event, or questionnaire-response evidence has no attempt header.",
        quarantinedAt,
      });
      quarantine.add({
        ...issue,
        raw: null,
        evidence: {
          attempt: null,
          samples: clone(rawSamples),
          events: clone(rawEvents),
          questionnaireResponses: clone(rawQuestionnaireResponses),
        },
      });
      for (const entry of rawSamples) samples.delete([entry.runId, entry.sequence]);
      for (const entry of rawEvents) events.delete([entry.runId, entry.sequence]);
      for (const entry of rawQuestionnaireResponses) {
        questionnaireResponses.delete([entry.runId, entry.sequence]);
      }
      issues.push(issue);
    }
    await completion;
    return Object.freeze(issues);
  }

  async listQuarantinedRecords() {
    const database = await this.#database();
    const transaction = database.transaction([QUARANTINE], "readonly");
    const completion = transactionDone(transaction);
    const values = await requestResult(transaction.objectStore(QUARANTINE).getAll());
    await completion;
    return Object.freeze(values.map(immutable));
  }

  async participantStates(experimentId, participantIds, { workspaceId } = {}) {
    const listed = await this.listAttempts({ experimentId });
    const attempts = workspaceId === undefined
      ? listed
      : listed.filter((attempt) => attempt.context?.workspaceId === workspaceId);
    const database = await this.#database();
    const transaction = database.transaction([LOCKS], "readonly");
    const completion = transactionDone(transaction);
    const locks = await requestResult(transaction.objectStore(LOCKS).getAll());
    await completion;
    const locked = new Set(locks.map((entry) => entry.key));
    return Object.freeze(participantIds.map((participantId) => {
      identifier(participantId, "participantId");
      const own = attempts.filter((attempt) => attempt.participantId === participantId);
      let state = "Available";
      const participantSuffix = `::${experimentId}::${participantId}`;
      const isLocked = workspaceId === undefined
        ? [...locked].some((key) => key.endsWith(participantSuffix))
        : locked.has(lockKey(experimentId, participantId, workspaceId));
      if (isLocked) state = "Active";
      else if (own.some((attempt) => attempt.status === "partial")) state = "Partial";
      else if (own.some((attempt) => attempt.status === "complete")) state = "Complete";
      return Object.freeze({ participantId, state, attempts: own.length });
    }));
  }

  async close() {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = null;
  }

  async #mutateAttempt(runId, mutate) {
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS], "readwrite");
    const completion = transactionDone(transaction);
    const store = transaction.objectStore(ATTEMPTS);
    const attempt = await requestResult(store.get(runId));
    if (!attempt) return abort(transaction, completion, new ResearchJournalError("missing-attempt", `Run ${runId} does not exist.`));
    try {
      mutate(attempt);
    } catch (error) {
      return abort(transaction, completion, error);
    }
    store.put(attempt);
    await completion;
    return immutable(attempt);
  }

  async #readAttemptSnapshot(runId) {
    const database = await this.#database();
    const transaction = database.transaction([ATTEMPTS], "readonly");
    const completion = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(ATTEMPTS).get(runId));
    await completion;
    if (!value) fail("missing-attempt", `Run ${runId} does not exist.`);
    return immutable(validateStoredAttempt(value));
  }

  async #readProtocolFinalizationSnapshot(runId) {
    const database = await this.#database();
    const transaction = database.transaction(
      [ATTEMPTS, SAMPLES, EVENTS, QUESTIONNAIRE_RESPONSES],
      "readonly",
    );
    const completion = transactionDone(transaction);
    const range = this.keyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const [attempt, sampleEntries, eventEntries, questionnaireResponseEntries] = await Promise.all([
      requestResult(transaction.objectStore(ATTEMPTS).get(runId)),
      requestResult(transaction.objectStore(SAMPLES).getAll(range)),
      requestResult(transaction.objectStore(EVENTS).getAll(range)),
      requestResult(transaction.objectStore(QUESTIONNAIRE_RESPONSES).getAll(range)),
    ]);
    await completion;
    if (!attempt) fail("missing-attempt", `Run ${runId} does not exist.`);
    return protocolFinalizationEvidence(
      attempt,
      sampleEntries,
      eventEntries,
      questionnaireResponseEntries,
    );
  }

  #database() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.databaseName, RESEARCH_JOURNAL_VERSION);
        request.addEventListener("upgradeneeded", () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(ATTEMPTS)) {
            const attempts = database.createObjectStore(ATTEMPTS, { keyPath: "runId" });
            attempts.createIndex("experimentId", "experimentId", { unique: false });
          }
          if (!database.objectStoreNames.contains(SAMPLES)) {
            database.createObjectStore(SAMPLES, { keyPath: ["runId", "sequence"] });
          }
          if (!database.objectStoreNames.contains(EVENTS)) {
            database.createObjectStore(EVENTS, { keyPath: ["runId", "sequence"] });
          }
          if (!database.objectStoreNames.contains(QUESTIONNAIRE_RESPONSES)) {
            database.createObjectStore(QUESTIONNAIRE_RESPONSES, {
              keyPath: ["runId", "sequence"],
            });
          }
          if (!database.objectStoreNames.contains(LOCKS)) {
            database.createObjectStore(LOCKS, { keyPath: "key" });
          }
          if (!database.objectStoreNames.contains(QUARANTINE)) {
            database.createObjectStore(QUARANTINE, { autoIncrement: true });
          }
        });
        request.addEventListener("blocked", () => reject(new ResearchJournalError(
          "indexeddb-blocked",
          "Close other Affect Research tabs so the journal can open.",
        )), { once: true });
        request.addEventListener("error", () => reject(request.error ?? new ResearchJournalError(
          "indexeddb-open",
          "The Research journal could not be opened.",
        )), { once: true });
        request.addEventListener("success", () => {
          request.result.addEventListener("versionchange", () => request.result.close());
          resolve(request.result);
        }, { once: true });
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }
}

// Explicit test/harness backend. Production construction never selects this
// when IndexedDB is missing.
export class MemoryResearchJournal {
  constructor() {
    this.attempts = new Map();
    this.samples = new Map();
    this.events = new Map();
    this.questionnaireResponses = new Map();
    this.locks = new Map();
    this.quarantine = [];
  }

  async open() { return this; }

  async reserveAttempt(input) {
    const reservation = validateReservation(input);
    const key = lockKey(reservation.experimentId, reservation.participantId, reservation.context.workspaceId);
    if (this.attempts.has(reservation.runId)) fail("attempt-exists", `Run ${reservation.runId} already exists.`);
    if (this.locks.has(key)) fail("participant-locked", `Participant ${reservation.participantId} already has an active attempt.`);
    if ([...this.attempts.values()].some((attempt) => (
      attempt.context?.workspaceId === reservation.context.workspaceId
      && attempt.experimentId === reservation.experimentId
      && attempt.participantId === reservation.participantId
      && (attempt.attemptNumber === reservation.attemptNumber || attempt.sessionStem === reservation.sessionStem)
    ))) {
      fail("attempt-exists", `Attempt ${reservation.attemptNumber} already exists for ${reservation.participantId} in this workspace.`);
    }
    const attempt = initialAttempt(reservation);
    this.attempts.set(attempt.runId, clone(attempt));
    this.samples.set(attempt.runId, []);
    this.events.set(attempt.runId, []);
    this.locks.set(key, { runId: attempt.runId, ownerId: attempt.ownerId });
    return immutable(attempt);
  }

  async reserveProtocolAttempt(input) {
    const reservation = await validateProtocolReservation(input);
    const key = lockKey(
      reservation.experimentId,
      reservation.participantId,
      reservation.context.workspaceId,
    );
    if (this.attempts.has(reservation.runId)) {
      fail("attempt-exists", `Run ${reservation.runId} already exists.`);
    }
    if (this.locks.has(key)) {
      fail("participant-locked", `Participant ${reservation.participantId} already has an active attempt.`);
    }
    if ([...this.attempts.values()].some((attempt) => (
      attempt.context?.workspaceId === reservation.context.workspaceId
      && attempt.experimentId === reservation.experimentId
      && attempt.participantId === reservation.participantId
      && (attempt.attemptNumber === reservation.attemptNumber
        || attempt.sessionStem === reservation.sessionStem)
    ))) {
      fail(
        "attempt-exists",
        `Attempt ${reservation.attemptNumber} already exists for ${reservation.participantId} in this workspace.`,
      );
    }
    const attempt = initialProtocolAttempt(reservation);
    this.attempts.set(attempt.runId, clone(attempt));
    this.samples.set(attempt.runId, []);
    this.events.set(attempt.runId, []);
    this.questionnaireResponses.set(attempt.runId, []);
    this.locks.set(key, { runId: attempt.runId, ownerId: attempt.ownerId });
    return immutable(attempt);
  }

  async appendBatch(input) {
    const attempt = this.#active(input.runId);
    if (attempt.nextSampleSequence !== input.expectedSampleSequence
      || attempt.nextEventSequence !== input.expectedEventSequence) {
      fail("sequence-conflict", "Journal sequence changed before the batch committed.");
    }
    if ((this.samples.get(input.runId) ?? []).length !== input.expectedSampleSequence - 1
      || (this.events.get(input.runId) ?? []).length !== input.expectedEventSequence - 1) {
      fail("corrupt-record", "Journal storage count differs from its append watermark.");
    }
    const samples = validateSequencedRecords(input.samples ?? [], input.runId, input.expectedSampleSequence, "sample", attempt);
    const events = validateSequencedRecords(input.events ?? [], input.runId, input.expectedEventSequence, "event", attempt);
    if (isProtocolAttempt(attempt) && samples.length > 0) {
      const active = attempt.activeProtocolStep;
      if (!active || active.kind !== "stimulus"
        || samples.some((sample) => (
          sample.stimulusPosition !== active.stimulusPosition
          || sample.stimulusIdentity.stimulusId !== active.stimulusId
        ))) {
        fail("unsafe-recovery", "Samples can be appended only inside the active stimulus protocol step.");
      }
    }
    const previousSample = this.samples.get(input.runId).at(-1) ?? null;
    const previousEvent = this.events.get(input.runId).at(-1) ?? null;
    if (previousSample) validateSequencedRecords([previousSample], input.runId, input.expectedSampleSequence - 1, "sample", attempt);
    if (previousEvent) validateSequencedRecords([previousEvent], input.runId, input.expectedEventSequence - 1, "event", attempt);
    validateRecordTimeline(samples, "sample", previousSample);
    validateRecordTimeline(events, "event", previousEvent);
    if (isProtocolAttempt(attempt) && input.stimulusState != null) {
      fail(
        "invalid-record",
        "Questionnaire-aware attempts must advance through protocol-state transitions.",
      );
    }
    const stimulusState = validateStimulusState(input.stimulusState ?? null, attempt);
    if (samples.length === 0 && events.length === 0 && !stimulusState) fail("empty-batch", "Journal batches must not be empty.");
    this.samples.get(input.runId).push(...samples);
    this.events.get(input.runId).push(...events);
    attempt.nextSampleSequence += samples.length;
    attempt.nextEventSequence += events.length;
    if (stimulusState) {
      attempt.activeStimulusIndex = stimulusState.activeStimulusIndex;
      attempt.safeStimulusIndex = stimulusState.safeStimulusIndex;
    }
    attempt.updatedAt = isoTimestamp(input.updatedAt, "updatedAt");
    return immutable(attempt);
  }

  async setStimulusState({ runId, activeStimulusIndex, safeStimulusIndex, updatedAt }) {
    const attempt = this.#active(runId);
    const state = validateStimulusState({ activeStimulusIndex, safeStimulusIndex }, attempt);
    attempt.activeStimulusIndex = state.activeStimulusIndex;
    attempt.safeStimulusIndex = state.safeStimulusIndex;
    attempt.updatedAt = isoTimestamp(updatedAt, "updatedAt");
    return immutable(attempt);
  }

  async setProtocolState(input) {
    exactObject(input, "Protocol state transition", [
      "runId", "activeProtocolStepPosition", "safeProtocolStepPosition", "updatedAt",
    ]);
    const attempt = this.#active(input.runId);
    if (!isProtocolAttempt(attempt)) {
      fail("invalid-record", "Historical V1 attempts must use stimulus-state transitions.");
    }
    const state = validateProtocolStateTransition(input, attempt);
    applyProtocolState(attempt, state);
    attempt.updatedAt = isoTimestamp(input.updatedAt, "updatedAt");
    return immutable(attempt);
  }

  async checkpointQuestionnaireDraft(input) {
    exactObject(input, "Questionnaire draft checkpoint", [
      "runId", "expectedSafeProtocolStepPosition", "protocolStepPosition", "answers", "updatedAt",
    ]);
    const attempt = this.#active(input.runId);
    if (!isProtocolAttempt(attempt)) {
      fail("invalid-record", "Questionnaire drafts require a questionnaire-aware attempt.");
    }
    const stepPosition = integer(input.protocolStepPosition, "protocolStepPosition", 1);
    const expectedResponseSequence = attempt.nextQuestionnaireResponseSequence;
    if (attempt.safeProtocolStepPosition !== input.expectedSafeProtocolStepPosition
      || attempt.safeProtocolStepPosition !== stepPosition - 1
      || attempt.activeProtocolStep?.protocolPosition !== stepPosition) {
      fail("sequence-conflict", "Protocol state changed before the questionnaire draft committed.");
    }
    const { step, responses } = await deriveQuestionnaireResponses(
      attempt,
      stepPosition,
      input.answers,
      "draft",
    );
    if (attempt.status !== "active"
      || attempt.safeProtocolStepPosition !== input.expectedSafeProtocolStepPosition
      || attempt.safeProtocolStepPosition !== stepPosition - 1
      || attempt.activeProtocolStep?.protocolPosition !== stepPosition
      || JSON.stringify(attempt.activeProtocolStep) !== JSON.stringify(step)
      || attempt.nextQuestionnaireResponseSequence !== expectedResponseSequence) {
      fail("sequence-conflict", "Protocol state changed while the questionnaire draft was derived.");
    }
    const draft = {
      schema: QUESTIONNAIRE_DRAFT_SCHEMA,
      version: 1,
      protocolStepPosition: stepPosition,
      moduleId: step.moduleId,
      questionnaireId: step.questionnaireId,
      definitionSha256: step.definitionSha256,
      responses: responses.map((response) => (
        validateQuestionnaireResponseForAttempt(response, attempt, "draft")
      )),
      updatedAt: isoTimestamp(input.updatedAt, "updatedAt"),
    };
    validateDraft(draft, { ...attempt, activeQuestionnaireDraft: draft });
    attempt.activeQuestionnaireDraft = draft;
    attempt.updatedAt = draft.updatedAt;
    return immutable(attempt);
  }

  async submitQuestionnaireStep(input) {
    exactObject(input, "Questionnaire submit transaction", [
      "runId", "expectedEventSequence", "expectedQuestionnaireResponseSequence",
      "expectedSafeProtocolStepPosition", "protocolStepPosition", "answers",
      "completionEvent", "updatedAt",
    ]);
    const attempt = this.#active(input.runId);
    if (!isProtocolAttempt(attempt)) {
      fail("invalid-record", "Questionnaire submission requires a questionnaire-aware attempt.");
    }
    integer(input.expectedEventSequence, "expectedEventSequence", 1);
    integer(input.expectedQuestionnaireResponseSequence, "expectedQuestionnaireResponseSequence", 1);
    integer(input.expectedSafeProtocolStepPosition, "expectedSafeProtocolStepPosition");
    const stepPosition = integer(input.protocolStepPosition, "protocolStepPosition", 1);
    exactObject(input.completionEvent, "Questionnaire completion event descriptor", [
      "wallTimeUtc", "monotonicTimeNs", "detailCode",
    ]);
    if (attempt.safeProtocolStepPosition !== input.expectedSafeProtocolStepPosition
      || attempt.safeProtocolStepPosition !== stepPosition - 1
      || attempt.activeProtocolStep?.protocolPosition !== stepPosition
      || attempt.nextEventSequence !== input.expectedEventSequence
      || attempt.nextQuestionnaireResponseSequence
        !== input.expectedQuestionnaireResponseSequence
      || (this.events.get(input.runId) ?? []).length !== input.expectedEventSequence - 1
      || (this.questionnaireResponses.get(input.runId) ?? []).length
        !== input.expectedQuestionnaireResponseSequence - 1) {
      fail("sequence-conflict", "Protocol or questionnaire evidence changed before submission committed.");
    }
    const { step, responses } = await deriveQuestionnaireResponses(
      attempt,
      stepPosition,
      input.answers,
      "submitted",
    );
    if (attempt.status !== "active"
      || attempt.safeProtocolStepPosition !== input.expectedSafeProtocolStepPosition
      || attempt.safeProtocolStepPosition !== stepPosition - 1
      || attempt.activeProtocolStep?.protocolPosition !== stepPosition
      || attempt.nextEventSequence !== input.expectedEventSequence
      || attempt.nextQuestionnaireResponseSequence
        !== input.expectedQuestionnaireResponseSequence
      || (this.events.get(input.runId) ?? []).length !== input.expectedEventSequence - 1
      || (this.questionnaireResponses.get(input.runId) ?? []).length
        !== input.expectedQuestionnaireResponseSequence - 1) {
      fail("sequence-conflict", "Protocol state changed while the questionnaire submission was derived.");
    }
    const normalizedResponses = responses.map((response) => (
      validateQuestionnaireResponseForAttempt(response, attempt, "submitted")
    ));
    const previousResponse = this.questionnaireResponses.get(input.runId).at(-1) ?? null;
    validateResponseTimeline(normalizedResponses, previousResponse);
    const normalizedEvent = validateEventV2ForAttempt(validateResearchEventV2({
      schema: RESEARCH_EVENT_SCHEMA,
      version: 2,
      sequence: input.expectedEventSequence,
      runId: attempt.runId,
      participantId: attempt.participantId,
      attemptNumber: attempt.attemptNumber,
      settingsSha256: attempt.settingsHash,
      assignmentPlanSha256: attempt.planHash,
      protocolPlanSha256: attempt.protocolPlanHash,
      wallTimeUtc: input.completionEvent.wallTimeUtc,
      monotonicTimeNs: input.completionEvent.monotonicTimeNs,
      type: "questionnaireCompleted",
      stimulusIdentity: null,
      stimulusPosition: null,
      protocolStepPosition: stepPosition,
      moduleId: step.moduleId,
      questionnaireId: step.questionnaireId,
      definitionSha256: step.definitionSha256,
      mediaTimeMs: null,
      missedSlotCount: null,
      detailCode: input.completionEvent.detailCode,
    }), attempt);
    const previousEvent = this.events.get(input.runId).at(-1) ?? null;
    if (previousEvent) {
      validateSequencedRecords(
        [previousEvent],
        input.runId,
        input.expectedEventSequence - 1,
        "event",
        attempt,
      );
    }
    validateRecordTimeline([normalizedEvent], "event", previousEvent);
    if (normalizedResponses.length > 0
      && BigInt(normalizedEvent.monotonicTimeNs)
        < BigInt(normalizedResponses.at(-1).monotonicTimeNs)) {
      fail("corrupt-record", "Questionnaire completion precedes its final response.");
    }
    this.questionnaireResponses.get(input.runId).push(...normalizedResponses);
    this.events.get(input.runId).push(normalizedEvent);
    attempt.nextQuestionnaireResponseSequence += normalizedResponses.length;
    attempt.nextEventSequence += 1;
    attempt.safeProtocolStepPosition = stepPosition;
    attempt.activeProtocolStep = null;
    attempt.activeQuestionnaireDraft = null;
    attempt.activeStimulusIndex = null;
    attempt.updatedAt = isoTimestamp(input.updatedAt, "updatedAt");
    return immutable(attempt);
  }

  async markInterrupted({ runId, reason, updatedAt }) {
    const attempt = this.#attempt(runId);
    if (attempt.status !== "active") return immutable(attempt);
    interruptAttempt(
      attempt,
      identifier(reason, "interruption reason"),
      isoTimestamp(updatedAt, "updatedAt"),
    );
    this.locks.delete(lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId));
    return immutable(attempt);
  }

  async reconcileAbandonedAttempts({ reason = "exclusive-runtime-recovery", updatedAt }) {
    reason = identifier(reason, "interruption reason");
    updatedAt = isoTimestamp(updatedAt, "updatedAt");
    await this.auditAndQuarantine({ quarantinedAt: updatedAt });
    const changed = [];
    for (const attempt of this.attempts.values()) {
      if (attempt.status !== "active") continue;
      interruptAttempt(attempt, reason, updatedAt);
      this.locks.delete(lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId));
      changed.push(immutable(attempt));
    }
    return Object.freeze(changed);
  }

  async prepareFinalization({ runId, completionStatus, finalizedAt, recovery }) {
    const attempt = this.#active(runId);
    const descriptor = clone(validatePendingFinalization({ completionStatus, finalizedAt, recovery }));
    if (descriptor.completionStatus === "completed"
      && isProtocolAttempt(attempt)) {
      if (attempt.safeProtocolStepPosition !== attempt.context.protocolPlan.steps.length
        || attempt.activeProtocolStep !== null
        || attempt.activeQuestionnaireDraft !== null) {
        fail("unsafe-recovery", "A completed finalization requires every protocol step to be safe.");
      }
    } else {
      const assignment = assignmentFromContext(attempt.context, attempt.participantId);
      if (descriptor.completionStatus === "completed" && assignment
        && attempt.safeStimulusIndex !== assignment.slots.length) {
        fail("unsafe-recovery", "A completed finalization requires the final safe stimulus boundary.");
      }
    }
    if (attempt.pendingFinalization !== null
      && JSON.stringify(attempt.pendingFinalization) !== JSON.stringify(descriptor)) {
      fail("finalization-conflict", "Prepared finalization metadata cannot change across retries.");
    }
    attempt.pendingFinalization = descriptor;
    attempt.updatedAt = descriptor.finalizedAt;
    return immutable(attempt);
  }

  async finalize({ runId, status, manifest, finalizedAt }) {
    const attempt = this.#active(runId);
    if (!TERMINAL_STATUSES.has(status)) fail("invalid-record", "Final status must be partial or complete.");
    if (isProtocolAttempt(attempt)) {
      fail(
        "manifest-v3-required",
        "Questionnaire-aware finalization requires the ResearchRunManifestV3/V4 persistence slice.",
      );
    }
    const normalizedManifest = validateManifestForAttempt(manifest, attempt);
    if ((status === "complete") !== (normalizedManifest.completionStatus === "completed")) {
      fail("finalization-conflict", "Journal terminal status differs from the run manifest completion status.");
    }
    const samples = this.samples.get(runId) ?? [];
    const events = this.events.get(runId) ?? [];
    if (samples.length !== attempt.nextSampleSequence - 1
      || events.length !== attempt.nextEventSequence - 1
      || normalizedManifest.timing.sampleCount !== samples.length
      || normalizedManifest.timing.eventCount !== events.length) {
      fail("corrupt-record", "Final manifest counts do not match journal watermarks and stored evidence.");
    }
    const descriptor = attempt.pendingFinalization ?? {
      completionStatus: normalizedManifest.completionStatus,
      finalizedAt: normalizedManifest.timing.finalizedAt,
      recovery: normalizedManifest.recovery,
    };
    validatePendingFinalization(descriptor);
    if (descriptor.completionStatus !== normalizedManifest.completionStatus
      || descriptor.finalizedAt !== normalizedManifest.timing.finalizedAt
      || JSON.stringify(descriptor.recovery) !== JSON.stringify(normalizedManifest.recovery)) {
      fail("finalization-conflict", "Manifest differs from its prepared finalization metadata.");
    }
    attempt.pendingFinalization = clone(descriptor);
    attempt.status = status;
    attempt.finalizedAt = isoTimestamp(finalizedAt, "finalizedAt");
    attempt.updatedAt = finalizedAt;
    attempt.activeStimulusIndex = null;
    attempt.manifest = clone(normalizedManifest);
    attempt.recoverable = false;
    this.locks.delete(lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId));
    return immutable(attempt);
  }

  async finalizeProtocol(input) {
    exactObject(input, "Protocol finalization", ["runId", "status", "manifest", "finalizedAt"]);
    const runId = identifier(input.runId, "runId");
    if (!TERMINAL_STATUSES.has(input.status)) {
      fail("invalid-record", "Final status must be partial or complete.");
    }
    const finalizedAt = isoTimestamp(input.finalizedAt, "finalizedAt");
    const rawAttempt = clone(this.#active(runId));
    const sampleRecords = clone(this.samples.get(runId) ?? []);
    const eventRecords = clone(this.events.get(runId) ?? []);
    const responseRecords = clone(this.questionnaireResponses.get(runId) ?? []);
    const wrap = (records) => records.map((value) => ({
      runId,
      sequence: value.sequence,
      value,
    }));
    const snapshot = protocolFinalizationEvidence(
      rawAttempt,
      wrap(sampleRecords),
      wrap(eventRecords),
      wrap(responseRecords),
    );
    const normalizedManifest = await validateProtocolManifestEvidence({
      manifest: input.manifest,
      attempt: snapshot.attempt,
      status: input.status,
      finalizedAt,
      samples: snapshot.samples,
      events: snapshot.events,
      submittedResponses: snapshot.submittedResponses,
      draftResponses: snapshot.draftResponses,
    });
    const descriptor = protocolFinalizationDescriptor(snapshot.attempt, normalizedManifest);
    const current = this.#active(runId);
    const key = lockKey(current.experimentId, current.participantId, current.context.workspaceId);
    if (this.locks.get(key)?.runId !== runId) {
      fail("corrupt-record", "Protocol finalization requires the reserved participant lock.");
    }
    if (JSON.stringify(current) !== JSON.stringify(rawAttempt)
      || JSON.stringify(this.samples.get(runId) ?? []) !== JSON.stringify(sampleRecords)
      || JSON.stringify(this.events.get(runId) ?? []) !== JSON.stringify(eventRecords)
      || JSON.stringify(this.questionnaireResponses.get(runId) ?? [])
        !== JSON.stringify(responseRecords)) {
      fail("sequence-conflict", "Protocol evidence changed while final artifacts were prepared.");
    }

    const terminal = clone(current);
    const terminalResponses = [...responseRecords, ...snapshot.draftResponses.map(clone)];
    terminal.nextQuestionnaireResponseSequence += snapshot.draftResponses.length;
    terminal.pendingFinalization = clone(descriptor);
    terminal.status = input.status;
    terminal.updatedAt = finalizedAt;
    terminal.finalizedAt = finalizedAt;
    terminal.activeStimulusIndex = null;
    terminal.activeProtocolStep = null;
    terminal.activeQuestionnaireDraft = null;
    terminal.manifest = clone(normalizedManifest);
    terminal.recoverable = false;
    validateStoredEvidence(
      terminal,
      wrap(sampleRecords),
      wrap(eventRecords),
      wrap(terminalResponses),
    );
    this.attempts.set(runId, terminal);
    this.questionnaireResponses.set(runId, terminalResponses);
    this.locks.delete(key);
    return immutable(terminal);
  }

  async resumeAttempt({ runId, ownerId, resumedAt }) {
    const attempt = this.#attempt(runId);
    if (attempt.status !== "partial" || !attempt.recoverable) {
      fail("not-recoverable", `Run ${runId} is not recoverable.`);
    }
    const key = lockKey(attempt.experimentId, attempt.participantId, attempt.context.workspaceId);
    if (this.locks.has(key)) fail("participant-locked", `Participant ${attempt.participantId} already has an active attempt.`);
    attempt.status = "active";
    attempt.recoverable = false;
    attempt.ownerId = identifier(ownerId, "ownerId");
    attempt.updatedAt = isoTimestamp(resumedAt, "resumedAt");
    attempt.activeStimulusIndex = null;
    const interruptedIndex = attempt.interruption?.interruptedStimulusIndex;
    if (attempt.pendingFinalization === null) {
      const assignment = assignmentFromContext(attempt.context, attempt.participantId);
      attempt.context.resumed = true;
      attempt.context.sourceRunId = runId;
      attempt.context.restartedStimulusIds = Number.isSafeInteger(interruptedIndex) && assignment
        ? [assignment.slots[interruptedIndex]?.stimulusId].filter(Boolean)
        : [];
    }
    this.locks.set(key, { runId, ownerId: attempt.ownerId });
    return immutable(attempt);
  }

  async getAttempt(runId) {
    await this.auditAndQuarantine();
    const attempt = this.attempts.get(identifier(runId, "runId"));
    return attempt ? immutable(attempt) : undefined;
  }

  async readRecords(runId, { kind, fromSequence = 0, limit = 10_000 } = {}) {
    const source = kind === "samples" ? this.samples : kind === "events" ? this.events : null;
    if (!source) fail("invalid-record", "Record kind must be samples or events.");
    integer(fromSequence, "fromSequence");
    integer(limit, "limit", 1);
    const attempt = this.#attempt(identifier(runId, "runId"));
    validateStoredAttempt(attempt);
    const all = source.get(runId) ?? [];
    const watermark = kind === "samples" ? attempt.nextSampleSequence : attempt.nextEventSequence;
    if (all.length !== watermark - 1) {
      fail("corrupt-record", `${kind} storage count does not match its authoritative journal watermark.`);
    }
    const startSequence = Math.max(1, fromSequence);
    const values = all
      .filter((record) => record.sequence >= startSequence)
      .slice(0, limit);
    const expectedPageLength = Math.min(limit, Math.max(0, watermark - startSequence));
    if (values.length !== expectedPageLength) {
      fail("corrupt-record", `${kind} page does not reach its authoritative journal watermark.`);
    }
    let expectedSequence = startSequence;
    const normalized = values.map((record, index) => {
      if (record.sequence !== expectedSequence) {
        fail("corrupt-record", `${kind}[${index}] reveals a silent journal sequence gap.`);
      }
      expectedSequence += 1;
      return validateSequencedRecords(
        [record],
        runId,
        record.sequence,
        kind === "samples" ? "sample" : "event",
        attempt,
      )[0];
    });
    const previous = startSequence > 1 ? all[startSequence - 2] ?? null : null;
    if (previous && previous.sequence !== startSequence - 1) {
      fail("corrupt-record", `${kind} predecessor does not match the requested page.`);
    }
    validateRecordTimeline(normalized, kind === "samples" ? "sample" : "event", previous);
    return Object.freeze(normalized.map(immutable));
  }

  async readQuestionnaireResponses(
    runId,
    { fromSequence = 0, limit = 10_000 } = {},
  ) {
    integer(fromSequence, "fromSequence");
    integer(limit, "limit", 1);
    const attempt = this.#attempt(identifier(runId, "runId"));
    validateStoredAttempt(attempt);
    if (!isProtocolAttempt(attempt)) {
      fail("invalid-record", "Historical V1 attempts have no questionnaire responses.");
    }
    const all = this.questionnaireResponses.get(runId) ?? [];
    if (all.length !== attempt.nextQuestionnaireResponseSequence - 1) {
      fail(
        "corrupt-record",
        "Questionnaire-response storage count does not match its authoritative journal watermark.",
      );
    }
    const startSequence = Math.max(1, fromSequence);
    const values = all.filter(({ sequence }) => sequence >= startSequence).slice(0, limit);
    const expectedPageLength = Math.min(
      limit,
      Math.max(0, attempt.nextQuestionnaireResponseSequence - startSequence),
    );
    if (values.length !== expectedPageLength) {
      fail("corrupt-record", "Questionnaire-response page does not reach its journal watermark.");
    }
    let expectedSequence = startSequence;
    const responses = values.map((response, index) => {
      if (response.sequence !== expectedSequence) {
        fail("corrupt-record", `questionnaireResponses[${index}] reveals a silent sequence gap.`);
      }
      expectedSequence += 1;
      return validateQuestionnaireResponseForAttempt(response, attempt, null);
    });
    const previous = startSequence > 1 ? all[startSequence - 2] ?? null : null;
    if (previous && previous.sequence !== startSequence - 1) {
      fail("corrupt-record", "Questionnaire-response predecessor differs from the requested page.");
    }
    validateResponseTimeline(responses, previous);
    return Object.freeze(responses.map(immutable));
  }

  async listAttempts({ experimentId } = {}) {
    if (experimentId !== undefined) identifier(experimentId, "experimentId");
    await this.auditAndQuarantine();
    return Object.freeze([...this.attempts.values()]
      .filter((attempt) => experimentId === undefined || attempt.experimentId === experimentId)
      .map(immutable));
  }

  async auditAndQuarantine({ quarantinedAt = new Date().toISOString() } = {}) {
    isoTimestamp(quarantinedAt, "quarantinedAt");
    const issues = [];
    for (const [storedKey, raw] of this.attempts.entries()) {
      try {
        validateStoredEvidence(
          raw,
          (this.samples.get(storedKey) ?? []).map((value) => ({ runId: storedKey, sequence: value.sequence, value })),
          (this.events.get(storedKey) ?? []).map((value) => ({ runId: storedKey, sequence: value.sequence, value })),
          (this.questionnaireResponses.get(storedKey) ?? []).map((value) => ({
            runId: storedKey,
            sequence: value.sequence,
            value,
          })),
        );
      } catch (error) {
        const runId = typeof raw?.runId === "string" ? raw.runId : null;
        const issue = Object.freeze({
          recordType: "attempt",
          runId,
          reasonCode: error?.code ?? "corrupt-attempt",
          reason: error instanceof Error ? error.message : String(error),
          quarantinedAt,
        });
        this.quarantine.push({
          ...issue,
          raw: clone(raw),
          evidence: {
            attempt: clone(raw),
            samples: clone(this.samples.get(storedKey) ?? []),
            events: clone(this.events.get(storedKey) ?? []),
            questionnaireResponses: clone(this.questionnaireResponses.get(storedKey) ?? []),
          },
        });
        this.attempts.delete(storedKey);
        this.samples.delete(storedKey);
        this.events.delete(storedKey);
        this.questionnaireResponses.delete(storedKey);
        for (const [key, lock] of this.locks.entries()) {
          if (lock?.runId === storedKey || lock?.runId === raw?.runId) this.locks.delete(key);
        }
        issues.push(issue);
      }
    }
    return Object.freeze(issues);
  }

  async listQuarantinedRecords() {
    return Object.freeze(this.quarantine.map(immutable));
  }

  async participantStates(experimentId, participantIds, { workspaceId } = {}) {
    identifier(experimentId, "experimentId");
    const listed = await this.listAttempts({ experimentId });
    const attempts = workspaceId === undefined
      ? listed
      : listed.filter((attempt) => attempt.context?.workspaceId === workspaceId);
    return Object.freeze(participantIds.map((participantId) => {
      const key = lockKey(experimentId, participantId, workspaceId);
      const own = attempts.filter((attempt) => attempt.participantId === participantId);
      let state = "Available";
      const participantSuffix = `::${experimentId}::${participantId}`;
      const isLocked = workspaceId === undefined
        ? [...this.locks.keys()].some((candidate) => candidate.endsWith(participantSuffix))
        : this.locks.has(key);
      if (isLocked) state = "Active";
      else if (own.some((attempt) => attempt.status === "partial")) state = "Partial";
      else if (own.some((attempt) => attempt.status === "complete")) state = "Complete";
      return Object.freeze({ participantId, state, attempts: own.length });
    }));
  }

  async close() {}

  #attempt(runId) {
    const attempt = this.attempts.get(identifier(runId, "runId"));
    if (!attempt) fail("missing-attempt", `Run ${runId} does not exist.`);
    return attempt;
  }

  #active(runId) {
    const attempt = this.#attempt(runId);
    if (attempt.status !== "active") fail("attempt-final", `Run ${runId} is not active.`);
    return attempt;
  }
}

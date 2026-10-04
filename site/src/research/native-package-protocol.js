const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PARTICIPANT_PATTERN = /^P\d{3,6}$/u;
const PACKAGE_PHASES = new Set([
  "questionnaire", "stimulusReady", "playing", "paused", "interval",
  "completeReady", "finalizing", "finished", "failed",
]);
const BACKEND_LABEL = /^[a-z][a-z0-9-]{1,63}$/u;
const CAPABILITY_KEYS = Object.freeze([
  "backend", "manifestV4Ready", "nativeStartReady", "packageV1CompilationReady",
  "protocolPlanV2Ready", "questionnaireDraftsReady", "reasonCode",
  "recoveryJournalReady", "rustOwnedProtocol", "schema", "version",
]);
const STATUS_KEYS = Object.freeze([
  "active", "attemptNumber", "coalescedInputUpdateCount", "currentArousal",
  "currentValence", "draftResponseCount", "eventCount", "failureCode",
  "gapEventCount", "inputActive", "intervalDurationMs", "intervalRemainingMs",
  "lslEnabled", "missedSlotCount", "participantId", "phase",
  "protocolStepCount", "protocolStepPosition", "questionnaire", "runId",
  "safeProtocolStepPosition", "sampleCount", "stimulus", "submittedResponseCount",
  "writeHealthy",
]);
const START_RECEIPT_KEYS = Object.freeze([
  "assignmentPlanSha256", "attemptNumber", "outputReceiptId",
  "packageSourceByteSha256", "participantId", "playbackMode",
  "playbackQualification", "protocolPlanSha256", "resumeAtProtocolStepPosition",
  "resumed", "runId", "sessionStem", "settingsSha256",
]);
const RECOVERY_LISTING_KEYS = Object.freeze([
  "packageSourceByteSha256", "participants", "quarantinedCount", "recoveries", "schema", "version",
]);
const RECOVERY_KEYS = Object.freeze([
  "assignmentPlanSha256", "assignmentSha256", "attemptNumber", "completionStatus",
  "finalizationPending", "languageId", "languageSelectionPath", "packageDefinitionSha256",
  "packageId", "participantId", "protocolPlanSha256", "protocolStepCount", "recoveryId",
  "resumable", "runId", "safeProtocolStepPosition", "settingsSha256",
]);
const PARTICIPANT_STATUS_KEYS = Object.freeze([
  "finalizationPending", "latestAttemptNumber", "participantId", "recoveryId", "state",
]);
const PARTICIPANT_STATES = new Set(["available", "active", "partial", "complete"]);
const PREFLIGHT_KEYS = Object.freeze([
  "assetBindingCount", "assetBindingsSha256", "assignmentPlanSha256", "assignmentSha256",
  "nativeStartReady", "packageDefinitionSha256", "packageSourceByteSha256", "participantId",
  "protocolPlanSha256", "protocolStepCount", "questionnaireStepCount", "schema",
  "settingsSha256", "stimulusStepCount", "version",
]);
const QUESTIONNAIRE_KEYS = Object.freeze([
  "answers", "definitionSha256", "moduleId", "protocolStepPosition", "questionnaireId",
]);
const STIMULUS_KEYS = Object.freeze([
  "durationMs", "mediaTimeMs", "prepared", "protocolStepPosition", "stimulusCount",
  "stimulusId", "stimulusPosition", "title",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function nullable(value, predicate) {
  return value === null || predicate(value);
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error?.message === "string") return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

export function validateNativePackageProtocolCapabilityV1(value) {
  if (!exactKeys(value, CAPABILITY_KEYS)
    || value.schema !== "affect-research-native-package-protocol-capability"
    || value.version !== 1
    || !BACKEND_LABEL.test(value.backend ?? "")
    || value.rustOwnedProtocol !== true
    || typeof value.packageV1CompilationReady !== "boolean"
    || typeof value.protocolPlanV2Ready !== "boolean"
    || typeof value.questionnaireDraftsReady !== "boolean"
    || typeof value.recoveryJournalReady !== "boolean"
    || typeof value.manifestV4Ready !== "boolean"
    || typeof value.nativeStartReady !== "boolean"
    || typeof value.reasonCode !== "string" || !/^[a-z0-9-]{1,128}$/u.test(value.reasonCode)) {
    throw new TypeError("Native package protocol capability v1 is malformed.");
  }
  if (value.nativeStartReady && !(value.packageV1CompilationReady
    && value.protocolPlanV2Ready
    && value.questionnaireDraftsReady
    && value.recoveryJournalReady
    && value.manifestV4Ready
    && value.reasonCode === "ready")) {
    throw new TypeError("Native package protocol capability readiness fields are inconsistent.");
  }
  return Object.freeze({ ...value });
}

function validateQuestionnaireStatus(value) {
  if (!exactKeys(value, QUESTIONNAIRE_KEYS)
    || !positiveInteger(value.protocolStepPosition)
    || typeof value.moduleId !== "string" || value.moduleId.length === 0
    || typeof value.questionnaireId !== "string" || value.questionnaireId.length === 0
    || !SHA256_PATTERN.test(value.definitionSha256 ?? "")
    || !value.answers || typeof value.answers !== "object" || Array.isArray(value.answers)
    || Object.entries(value.answers).some(([itemId, optionId]) => (
      typeof itemId !== "string" || itemId.length === 0
      || typeof optionId !== "string" || optionId.length === 0
    ))) {
    throw new TypeError("Native package questionnaire status is malformed.");
  }
  return Object.freeze({ ...value, answers: Object.freeze({ ...value.answers }) });
}

function validateStimulusStatus(value) {
  if (!exactKeys(value, STIMULUS_KEYS)
    || !positiveInteger(value.protocolStepPosition)
    || !positiveInteger(value.stimulusPosition)
    || !positiveInteger(value.stimulusCount)
    || value.stimulusPosition > value.stimulusCount
    || typeof value.stimulusId !== "string" || value.stimulusId.length === 0
    || typeof value.title !== "string" || value.title.length === 0
    || !finite(value.mediaTimeMs) || value.mediaTimeMs < 0
    || !finite(value.durationMs) || value.durationMs <= 0
    || typeof value.prepared !== "boolean") {
    throw new TypeError("Native package stimulus status is malformed.");
  }
  return Object.freeze({ ...value });
}

export function validateNativePackageRunStatusV1(value) {
  if (!exactKeys(value, STATUS_KEYS)
    || typeof value.active !== "boolean"
    || !nullable(value.runId, (item) => typeof item === "string" && UUID_PATTERN.test(item))
    || !nullable(value.participantId, (item) => typeof item === "string" && PARTICIPANT_PATTERN.test(item))
    || !nullable(value.attemptNumber, positiveInteger)
    || !PACKAGE_PHASES.has(value.phase)
    || !nullable(value.protocolStepPosition, positiveInteger)
    || !nonnegativeInteger(value.safeProtocolStepPosition)
    || !nonnegativeInteger(value.protocolStepCount)
    || !nullable(value.intervalDurationMs, nonnegativeInteger)
    || !nullable(value.intervalRemainingMs, (item) => finite(item) && item >= 0)
    || !nonnegativeInteger(value.sampleCount)
    || !nonnegativeInteger(value.eventCount)
    || !nonnegativeInteger(value.gapEventCount)
    || !nonnegativeInteger(value.missedSlotCount)
    || !nonnegativeInteger(value.coalescedInputUpdateCount)
    || !nonnegativeInteger(value.submittedResponseCount)
    || !nonnegativeInteger(value.draftResponseCount)
    || !finite(value.currentValence) || value.currentValence < -1 || value.currentValence > 1
    || !finite(value.currentArousal) || value.currentArousal < -1 || value.currentArousal > 1
    || typeof value.inputActive !== "boolean"
    || typeof value.writeHealthy !== "boolean"
    || typeof value.lslEnabled !== "boolean"
    || !nullable(value.failureCode, (item) => typeof item === "string" && item.length > 0)) {
    throw new TypeError("Native package run status v1 is malformed.");
  }
  const questionnaire = value.questionnaire === null ? null : validateQuestionnaireStatus(value.questionnaire);
  const stimulus = value.stimulus === null ? null : validateStimulusStatus(value.stimulus);
  const hasRunIdentity = value.runId !== null && value.participantId !== null && value.attemptNumber !== null;
  if (value.active !== hasRunIdentity
    || (value.protocolStepPosition !== null && value.protocolStepPosition > value.protocolStepCount)
    || (value.safeProtocolStepPosition > value.protocolStepCount)
    || (value.phase === "questionnaire") !== (questionnaire !== null)
    || (["stimulusReady", "playing", "paused"].includes(value.phase)) !== (stimulus !== null)
    || (value.phase === "interval") !== (value.intervalDurationMs !== null)) {
    throw new TypeError("Native package run status identity and phase fields are inconsistent.");
  }
  return Object.freeze({ ...value, questionnaire, stimulus });
}

export function validateNativePackageStartReceiptV1(value) {
  if (!exactKeys(value, START_RECEIPT_KEYS)
    || !UUID_PATTERN.test(value.runId ?? "")
    || !PARTICIPANT_PATTERN.test(value.participantId ?? "")
    || !positiveInteger(value.attemptNumber)
    || typeof value.sessionStem !== "string" || value.sessionStem.length === 0
    || !SHA256_PATTERN.test(value.settingsSha256 ?? "")
    || !SHA256_PATTERN.test(value.assignmentPlanSha256 ?? "")
    || !SHA256_PATTERN.test(value.protocolPlanSha256 ?? "")
    || !SHA256_PATTERN.test(value.packageSourceByteSha256 ?? "")
    || !UUID_PATTERN.test(value.outputReceiptId ?? "")
    || typeof value.resumed !== "boolean"
    || !nullable(value.resumeAtProtocolStepPosition, positiveInteger)
    || typeof value.playbackMode !== "string" || value.playbackMode.length === 0
    || typeof value.playbackQualification !== "string" || value.playbackQualification.length === 0) {
    throw new TypeError("Native package Start receipt v1 is malformed.");
  }
  return Object.freeze({ ...value });
}

export function validateNativePackageRecoveryListingV1(value) {
  if (!exactKeys(value, RECOVERY_LISTING_KEYS)
    || value.schema !== "affect-research-package-recovery-listing"
    || value.version !== 1
    || !SHA256_PATTERN.test(value.packageSourceByteSha256 ?? "")
    || !Array.isArray(value.recoveries)
    || !Array.isArray(value.participants)
    || !nonnegativeInteger(value.quarantinedCount)) {
    throw new TypeError("Native package recovery listing v1 is malformed.");
  }
  const recoveryIds = new Set();
  const recoveries = value.recoveries.map((recovery) => {
    if (!exactKeys(recovery, RECOVERY_KEYS)
      || !UUID_PATTERN.test(recovery.recoveryId ?? "")
      || recoveryIds.has(recovery.recoveryId)
      || !UUID_PATTERN.test(recovery.runId ?? "")
      || !PARTICIPANT_PATTERN.test(recovery.participantId ?? "")
      || !positiveInteger(recovery.attemptNumber)
      || !SHA256_PATTERN.test(recovery.settingsSha256 ?? "")
      || !SHA256_PATTERN.test(recovery.assignmentPlanSha256 ?? "")
      || !SHA256_PATTERN.test(recovery.protocolPlanSha256 ?? "")
      || typeof recovery.packageId !== "string" || recovery.packageId.length === 0
      || !SHA256_PATTERN.test(recovery.packageDefinitionSha256 ?? "")
      || typeof recovery.languageId !== "string" || recovery.languageId.length === 0
      || !Array.isArray(recovery.languageSelectionPath) || recovery.languageSelectionPath.length === 0
      || recovery.languageSelectionPath.some((part) => typeof part !== "string" || part.length === 0)
      || !SHA256_PATTERN.test(recovery.assignmentSha256 ?? "")
      || !nonnegativeInteger(recovery.safeProtocolStepPosition)
      || !positiveInteger(recovery.protocolStepCount)
      || recovery.safeProtocolStepPosition > recovery.protocolStepCount
      || typeof recovery.resumable !== "boolean"
      || typeof recovery.finalizationPending !== "boolean"
      || !nullable(recovery.completionStatus, (item) => ["completed", "partial"].includes(item))
      || (recovery.resumable && recovery.finalizationPending)
      || recovery.finalizationPending !== (recovery.completionStatus !== null)) {
      throw new TypeError("Native package recovery summary v1 is malformed.");
    }
    recoveryIds.add(recovery.recoveryId);
    return Object.freeze({
      ...recovery,
      languageSelectionPath: Object.freeze([...recovery.languageSelectionPath]),
    });
  });
  const participantIds = new Set();
  const participants = value.participants.map((participant) => {
    if (!exactKeys(participant, PARTICIPANT_STATUS_KEYS)
      || !PARTICIPANT_PATTERN.test(participant.participantId ?? "")
      || participantIds.has(participant.participantId)
      || !PARTICIPANT_STATES.has(participant.state)
      || !nullable(participant.latestAttemptNumber, positiveInteger)
      || !nullable(participant.recoveryId, (item) => UUID_PATTERN.test(item))
      || typeof participant.finalizationPending !== "boolean"
      || (participant.recoveryId !== null && !recoveryIds.has(participant.recoveryId))) {
      throw new TypeError("Native package participant status v1 is malformed.");
    }
    const bound = participant.recoveryId === null
      ? null
      : recoveries.find(({ recoveryId }) => recoveryId === participant.recoveryId);
    if ((participant.finalizationPending && !bound?.finalizationPending)
      || (bound && bound.participantId !== participant.participantId)
      || (bound && participant.latestAttemptNumber !== bound.attemptNumber)) {
      throw new TypeError("Native package participant and recovery projections crossed identity.");
    }
    participantIds.add(participant.participantId);
    return Object.freeze({ ...participant });
  });
  if (recoveries.some(({ participantId }) => !participantIds.has(participantId))) {
    throw new TypeError("Native package recovery references an undeclared participant.");
  }
  return Object.freeze({
    ...value,
    recoveries: Object.freeze(recoveries),
    participants: Object.freeze(participants),
  });
}

export function validateNativePackagePreflightV1(value, expected) {
  if (!exactKeys(value, PREFLIGHT_KEYS)
    || value.schema !== "affect-research-native-package-preflight"
    || value.version !== 1
    || !SHA256_PATTERN.test(value.packageSourceByteSha256 ?? "")
    || !SHA256_PATTERN.test(value.packageDefinitionSha256 ?? "")
    || !PARTICIPANT_PATTERN.test(value.participantId ?? "")
    || !SHA256_PATTERN.test(value.settingsSha256 ?? "")
    || !SHA256_PATTERN.test(value.assignmentPlanSha256 ?? "")
    || !SHA256_PATTERN.test(value.assignmentSha256 ?? "")
    || !SHA256_PATTERN.test(value.protocolPlanSha256 ?? "")
    || !SHA256_PATTERN.test(value.assetBindingsSha256 ?? "")
    || !nonnegativeInteger(value.assetBindingCount)
    || !positiveInteger(value.protocolStepCount)
    || !positiveInteger(value.stimulusStepCount)
    || !nonnegativeInteger(value.questionnaireStepCount)
    || value.stimulusStepCount + value.questionnaireStepCount > value.protocolStepCount
    || typeof value.nativeStartReady !== "boolean") {
    throw new TypeError("Native package preflight v1 is malformed.");
  }
  if (!expected || value.packageSourceByteSha256 !== expected.packageSourceByteSha256
    || value.packageDefinitionSha256 !== expected.packageDefinitionSha256
    || value.participantId !== expected.participantId
    || value.settingsSha256 !== expected.settingsSha256
    || value.assignmentPlanSha256 !== expected.assignmentPlanSha256
    || value.assignmentSha256 !== expected.assignmentSha256
    || value.protocolPlanSha256 !== expected.protocolPlanSha256
    || value.assetBindingCount !== expected.assetBindingCount
    || value.protocolStepCount !== expected.protocolStepCount
    || value.stimulusStepCount !== expected.stimulusStepCount
    || value.questionnaireStepCount !== expected.questionnaireStepCount) {
    throw new Error("Rust package preflight does not match the independently compiled UI projection.");
  }
  return Object.freeze({ ...value });
}

function unsupportedPackageStart() {
  throw new Error("This older experiment package cannot start in this version. Open a current Planner JSON recipe for HTML video playback.");
}

/** Read old package metadata without reviving its retired playback path. */
export class NativePackageProtocolAdapter {
  constructor(root, { invoke, dispatch, onRunReleased = () => {}, onRunTerminal = async () => {} } = {}) {
    if (!(root instanceof EventTarget) || typeof invoke !== "function" || typeof dispatch !== "function") {
      throw new TypeError("NativePackageProtocolAdapter dependencies are malformed.");
    }
    this.root = root;
    this.invoke = invoke;
    this.dispatch = dispatch;
    this.onRunReleased = onRunReleased;
    this.onRunTerminal = onRunTerminal;
    this.capability = null;
    this.recoveryListing = null;
    this.run = null;
  }

  get active() { return false; }

  owns(detail) {
    return typeof detail?.experimentPackageSourceText === "string"
      && detail.experimentPackageSourceText.length > 0;
  }

  async initialize() {
    const reported = validateNativePackageProtocolCapabilityV1(
      await this.invoke("research_package_protocol_capability"),
    );
    this.capability = Object.freeze({
      ...reported,
      backend: "html-video",
      nativeStartReady: false,
      reasonCode: "legacy-package-execution-retired",
    });
    return this.capability;
  }

  async refreshRecoveries(workspaceId, experimentPackageSourceText) {
    if (!UUID_PATTERN.test(workspaceId ?? "")
      || typeof experimentPackageSourceText !== "string" || experimentPackageSourceText.length === 0) {
      throw new TypeError("Package recovery discovery requires an exact workspace and package source.");
    }
    const listing = validateNativePackageRecoveryListingV1(await this.invoke(
      "research_package_recoveries",
      { request: { workspaceId, experimentPackageSourceText } },
    ));
    this.recoveryListing = listing;
    const states = Object.fromEntries(listing.participants.map(({ participantId, state }) => [participantId, state]));
    states.__recoverable = Object.freeze(Object.fromEntries(listing.participants.map(
      ({ participantId }) => [participantId, false],
    )));
    states.__finalizationPending = Object.freeze(Object.fromEntries(listing.participants.map(
      ({ participantId }) => [participantId, false],
    )));
    states.__finalizationBinding = Object.freeze({});
    states.__recoveryBinding = Object.freeze({});
    this.dispatch("affect-research:participant-states", Object.freeze(states));
    return listing;
  }

  async preflight(workspaceId, experimentPackageSourceText, selection) {
    if (!UUID_PATTERN.test(workspaceId ?? "")
      || typeof experimentPackageSourceText !== "string" || experimentPackageSourceText.length === 0
      || !selection || typeof selection !== "object" || Array.isArray(selection)
      || !PARTICIPANT_PATTERN.test(selection.participantId ?? "")
      || typeof selection.selectedLanguageId !== "string" || selection.selectedLanguageId.length === 0
      || !Array.isArray(selection.languageSelectionPath) || selection.languageSelectionPath.length === 0) {
      throw new TypeError("Native package preflight requires the exact package selection.");
    }
    const receipt = validateNativePackagePreflightV1(await this.invoke("research_package_preflight", {
      request: {
        workspaceId,
        experimentPackageSourceText,
        participantId: selection.participantId,
        selectedLanguageId: selection.selectedLanguageId,
        languageSelectionPath: [...selection.languageSelectionPath],
      },
    }), selection);
    return Object.freeze({ ...receipt, nativeStartReady: false });
  }

  async start() { unsupportedPackageStart(); }
  async refresh() { return null; }
  async questionnaireDraft() { unsupportedPackageStart(); }
  async questionnaireSubmit() { unsupportedPackageStart(); }
  async togglePause() { unsupportedPackageStart(); }
  async continue() { unsupportedPackageStart(); }
  async resize() {}
  async finish() { unsupportedPackageStart(); }

  destroy() {
    this.run = null;
    this.recoveryListing = null;
  }
}

import { nativeMediaViewportCssV1 } from "./native-media-controller.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PARTICIPANT_PATTERN = /^P\d{3,6}$/u;
const PACKAGE_PHASES = new Set([
  "questionnaire", "stimulusReady", "playing", "paused", "interval",
  "completeReady", "finalizing", "finished", "failed",
]);
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
    || value.backend !== "rust-gstplay"
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
    || value.playbackMode !== "nativeGstPlay"
    || value.playbackQualification !== "qualifiedNative") {
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

function questionnaireChoices(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new TypeError("Questionnaire answers must be an item-to-option object.");
  }
  return Object.freeze(Object.entries(answers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, optionId]) => {
      if (!itemId || typeof optionId !== "string" || !optionId) {
        throw new TypeError("Questionnaire answers contain an invalid item or option ID.");
      }
      return Object.freeze({ itemId, optionId });
    }));
}

function startRequest(detail, workspaceId) {
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)
    || typeof detail?.experimentPackageSourceText !== "string"
    || detail.experimentPackageSourceText.length === 0
    || !PARTICIPANT_PATTERN.test(detail?.participantId ?? "")
    || !detail.participant || typeof detail.participant !== "object" || Array.isArray(detail.participant)
    || typeof detail.selectedLanguageId !== "string" || detail.selectedLanguageId.length === 0
    || !Array.isArray(detail.languageSelectionPath) || detail.languageSelectionPath.length === 0
    || typeof detail.inputTestReceiptId !== "string" || detail.inputTestReceiptId.length < 8) {
    throw new TypeError("A package run requires the exact workspace, package, participant, language path, and input-test receipt.");
  }
  return Object.freeze({
    workspaceId,
    experimentPackageSourceText: detail.experimentPackageSourceText,
    participant: Object.freeze({ participantId: detail.participantId, ...detail.participant }),
    selectedLanguageId: detail.selectedLanguageId,
    languageSelectionPath: Object.freeze([...detail.languageSelectionPath]),
    rerunConfirmed: detail.rerunConfirmed === true,
    inputTestReceiptId: detail.inputTestReceiptId,
    playbackMode: "nativeGstPlay",
  });
}

function packageSourceRequest(detail, workspaceId) {
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)
    || typeof detail?.experimentPackageSourceText !== "string"
    || detail.experimentPackageSourceText.length === 0
    || !SHA256_PATTERN.test(detail.experimentPackageSourceByteSha256 ?? "")
    || !PARTICIPANT_PATTERN.test(detail.participantId ?? "")) {
    throw new TypeError("A package operation requires the exact workspace, package bytes, and participant.");
  }
  return Object.freeze({
    workspaceId,
    experimentPackageSourceText: detail.experimentPackageSourceText,
  });
}

function validateFinalizeReceipt(receipt, { recovery, completionStatus }) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || receipt.runId !== recovery.runId
    || receipt.participantId !== recovery.participantId
    || receipt.attemptNumber !== recovery.attemptNumber
    || receipt.completionStatus !== completionStatus
    || !UUID_PATTERN.test(receipt.outputReceiptId ?? "")
    || !Array.isArray(receipt.files) || receipt.files.length < 9) {
    throw new Error("Rust package finalization returned a malformed or crossed receipt.");
  }
  const names = new Set();
  for (const file of receipt.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)
      || typeof file.fileName !== "string" || file.fileName.length === 0
      || /[\\/]/u.test(file.fileName) || names.has(file.fileName)
      || !SHA256_PATTERN.test(file.sha256 ?? "")
      || !positiveInteger(file.byteLength)) {
      throw new Error("Rust package finalization returned an invalid file receipt.");
    }
    names.add(file.fileName);
  }
  for (const name of [
    "settings.snapshot.json", "experiment.json", "experiment-plan.snapshot.json",
    "experiment.package.json", "protocol-plan.snapshot.json", "events.jsonl", "manifest.json",
  ]) {
    if (!names.has(name)) throw new Error(`Rust package finalization omitted ${name}.`);
  }
  if (!names.has("ratings.csv") && !names.has("ratings.tsv")) {
    throw new Error("Rust package finalization omitted the selected ratings table.");
  }
  if (!names.has("questionnaire.csv") && !names.has("questionnaire.tsv")) {
    throw new Error("Rust package finalization omitted the selected questionnaire table.");
  }
  return Object.freeze({ ...receipt, files: Object.freeze(receipt.files.map((file) => Object.freeze({ ...file }))) });
}

export class NativePackageProtocolAdapter {
  constructor(root, {
    invoke,
    dispatch,
    resolveMediaHost = () => root.querySelector?.("#run-native-video-host"),
    resolveFallbackVideo = () => root.querySelector?.("#run-video"),
    resolvePlaceholder = () => root.querySelector?.("#run-stimulus-placeholder"),
    prepareRunInput = async () => {},
    onRunActivated = () => {},
    onRunReleased = () => {},
    onRunTerminal = async () => {},
    setIntervalObject = globalThis.setInterval?.bind(globalThis),
    clearIntervalObject = globalThis.clearInterval?.bind(globalThis),
    pollIntervalMs = 100,
  } = {}) {
    if (!(root instanceof EventTarget) || typeof invoke !== "function" || typeof dispatch !== "function"
      || typeof prepareRunInput !== "function" || typeof onRunActivated !== "function"
      || typeof onRunReleased !== "function" || typeof onRunTerminal !== "function"
      || !positiveInteger(pollIntervalMs)) {
      throw new TypeError("NativePackageProtocolAdapter dependencies are malformed.");
    }
    this.root = root;
    this.invoke = invoke;
    this.dispatch = dispatch;
    this.resolveMediaHost = resolveMediaHost;
    this.resolveFallbackVideo = resolveFallbackVideo;
    this.resolvePlaceholder = resolvePlaceholder;
    this.prepareRunInput = prepareRunInput;
    this.onRunActivated = onRunActivated;
    this.onRunReleased = onRunReleased;
    this.onRunTerminal = onRunTerminal;
    this.setInterval = setIntervalObject;
    this.clearInterval = clearIntervalObject;
    this.pollIntervalMs = pollIntervalMs;
    this.capability = null;
    this.recoveryListing = null;
    this.recoveryWorkspaceId = null;
    this.recoverySourceText = null;
    this.run = null;
    this.pollTimer = null;
    this.operation = Promise.resolve();
  }

  get active() {
    return this.run !== null;
  }

  owns(detail) {
    return typeof detail?.experimentPackageSourceText === "string"
      && detail.experimentPackageSourceText.length > 0;
  }

  async initialize() {
    this.capability = validateNativePackageProtocolCapabilityV1(
      await this.invoke("research_package_protocol_capability"),
    );
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
    this.recoveryWorkspaceId = workspaceId;
    this.recoverySourceText = experimentPackageSourceText;
    const recoveryById = new Map(listing.recoveries.map((recovery) => [recovery.recoveryId, recovery]));
    const detail = Object.fromEntries(listing.participants.map(({ participantId, state }) => [
      participantId, state,
    ]));
    detail.__recoverable = Object.freeze(Object.fromEntries(listing.participants.map((participant) => {
      const recovery = participant.recoveryId ? recoveryById.get(participant.recoveryId) : null;
      return [participant.participantId, Boolean(recovery?.resumable || recovery?.finalizationPending)];
    })));
    detail.__finalizationPending = Object.freeze(Object.fromEntries(listing.participants.map((participant) => [
      participant.participantId, participant.finalizationPending,
    ])));
    detail.__finalizationBinding = Object.freeze(Object.fromEntries(listing.participants.flatMap((participant) => {
      const recovery = participant.recoveryId ? recoveryById.get(participant.recoveryId) : null;
      return recovery?.finalizationPending ? [[participant.participantId, Object.freeze({
        settingsSha256: recovery.settingsSha256,
        assignmentPlanSha256: recovery.assignmentPlanSha256,
        protocolContract: "manifestV4",
        playbackMode: "nativeGstPlay",
        completionStatus: recovery.completionStatus,
        attemptNumber: recovery.attemptNumber,
      })]] : [];
    })));
    detail.__recoveryBinding = Object.freeze(Object.fromEntries(listing.participants.flatMap((participant) => {
      const recovery = participant.recoveryId ? recoveryById.get(participant.recoveryId) : null;
      return recovery ? [[participant.participantId, Object.freeze({
        schema: "affect-research-experiment-package-recovery-binding",
        version: 1,
        participantId: recovery.participantId,
        attemptNumber: recovery.attemptNumber,
        disposition: "resume-compatible",
        packageId: recovery.packageId,
        canonicalSourceByteSha256: listing.packageSourceByteSha256,
        packageDefinitionSha256: recovery.packageDefinitionSha256,
        languageId: recovery.languageId,
        languageSelectionPath: recovery.languageSelectionPath,
        assignmentSha256: recovery.assignmentSha256,
      })]] : [];
    })));
    this.dispatch("affect-research:participant-states", Object.freeze(detail));
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
    this.preflightReceipt = receipt;
    return receipt;
  }

  async start(detail, workspaceId) {
    if (this.run) throw new Error("A Rust package protocol attempt is already active.");
    const packageRequest = packageSourceRequest(detail, workspaceId);
    await this.#ensureRecoveries(workspaceId, detail.experimentPackageSourceText);
    if (detail.recoveryFinalizationOnly === true) {
      const recovery = this.#selectedRecovery(detail, { finalizationPending: true });
      const receipt = validateFinalizeReceipt(await this.invoke("research_finalize_package_recovery", {
        request: { ...packageRequest, recoveryId: recovery.recoveryId },
      }), { recovery, completionStatus: recovery.completionStatus });
      this.#dispatchCompletion(receipt);
      await this.onRunTerminal();
      return receipt;
    }
    if (this.capability?.nativeStartReady !== true) {
      throw new Error(`Rust package protocol unavailable (${this.capability?.reasonCode ?? "capability-not-loaded"}).`);
    }
    const recovery = detail.attemptDisposition === "resume-compatible"
      ? this.#selectedRecovery(detail, { resumable: true })
      : null;
    const command = recovery ? "research_resume_package_run" : "research_start_package_run";
    const request = recovery ? Object.freeze({
      ...packageRequest,
      recoveryId: recovery.recoveryId,
      inputTestReceiptId: detail.inputTestReceiptId,
      playbackMode: "nativeGstPlay",
    }) : startRequest(detail, workspaceId);
    let receipt;
    try {
      receipt = validateNativePackageStartReceiptV1(await this.invoke(command, { request }));
    } catch (error) {
      await this.#reconcileRejectedActivation(detail).catch(() => {});
      throw error;
    }
    if (receipt.participantId !== detail.participantId
      || receipt.packageSourceByteSha256 !== detail.experimentPackageSourceByteSha256
      || receipt.settingsSha256 !== detail.researchSettingsSha256
      || receipt.assignmentPlanSha256 !== detail.resolvedPlan?.planHashSha256
      || receipt.protocolPlanSha256 !== detail.resolvedProtocolPlan?.protocolPlanHashSha256
      || receipt.resumed !== Boolean(recovery)
      || receipt.resumeAtProtocolStepPosition !== (recovery ? recovery.safeProtocolStepPosition + 1 : 1)
      || (recovery && (receipt.runId !== recovery.runId
        || receipt.attemptNumber !== recovery.attemptNumber))) {
      const cleanupError = await this.#finishRejectedReceipt(receipt).catch((error) => error);
      throw new Error(cleanupError instanceof Error
        ? `Rust package Start receipt crossed the frozen UI projection and cleanup was not confirmed: ${messageOf(cleanupError)}`
        : "Rust package Start receipt does not match the frozen UI package projection; the attempt was finalized partial.");
    }
    this.run = {
      receipt,
      preparedPosition: null,
      projectedQuestionnaire: null,
      finalizing: false,
      lastStatus: null,
    };
    this.onRunActivated();
    this.dispatch("affect-research:run-started", receipt);
    try {
      await this.prepareRunInput();
      await this.refresh();
      this.#startPolling();
    } catch (error) {
      await this.finish("stopEarly").catch(() => {});
      throw error;
    }
    return receipt;
  }

  async refresh() {
    if (!this.run) return null;
    const status = validateNativePackageRunStatusV1(
      await this.invoke("research_package_run_status"),
    );
    if (!status.active || status.runId !== this.run.receipt.runId
      || status.participantId !== this.run.receipt.participantId
      || status.attemptNumber !== this.run.receipt.attemptNumber) {
      const error = new Error(`Rust package status crossed or lost the active run identity${status.failureCode ? ` (${status.failureCode})` : ""}.`);
      error.nativeTerminal = status.active === false;
      throw error;
    }
    this.run.lastStatus = status;
    await this.#project(status);
    return status;
  }

  async questionnaireDraft(detail) {
    return this.#questionnaireCommand("research_package_questionnaire_draft", detail);
  }

  async questionnaireSubmit(detail) {
    await this.#questionnaireCommand("research_package_questionnaire_submit", detail);
    await this.refresh();
  }

  async togglePause() {
    const run = this.#requiredRun();
    const phase = run.lastStatus?.phase;
    const command = phase === "playing"
      ? "research_package_pause"
      : phase === "paused"
        ? "research_package_play"
        : null;
    if (!command) return;
    await this.invoke(command, { request: { runId: run.receipt.runId } });
    await this.refresh();
  }

  async continue() {
    const run = this.#requiredRun();
    if (run.lastStatus?.phase !== "stimulusReady") return;
    await this.#prepareAndPlay(run.lastStatus);
  }

  async resize() {
    const run = this.run;
    if (!run || run.preparedPosition === null || !run.lastStatus?.stimulus) return;
    const viewport = this.#viewport();
    await this.invoke("research_package_set_media_viewport", {
      request: { runId: run.receipt.runId, viewport },
    });
  }

  async finish(outcome) {
    const run = this.#requiredRun();
    if (run.finalizing) return null;
    if (!["completed", "stopEarly"].includes(outcome)) throw new TypeError("Unknown package run outcome.");
    run.finalizing = true;
    this.#stopPolling();
    try {
      const receipt = validateFinalizeReceipt(await this.invoke("research_finish_package_run", {
        request: { runId: run.receipt.runId, outcome },
      }), {
        recovery: {
          runId: run.receipt.runId,
          participantId: run.receipt.participantId,
          attemptNumber: run.receipt.attemptNumber,
        },
        completionStatus: outcome === "completed" ? "completed" : "partial",
      });
      this.#releaseRun();
      this.#dispatchCompletion(receipt);
      await this.onRunTerminal();
      return receipt;
    } catch (error) {
      run.finalizing = false;
      this.#startPolling();
      throw error;
    }
  }

  destroy() {
    this.#stopPolling();
    this.#showNativeMedia(false);
    this.run = null;
  }

  #queue(operation) {
    this.operation = this.operation.then(operation, operation).catch((error) => {
      if (this.run) {
        this.dispatch("affect-research:run-status", {
          stimulus: "Native package run needs attention",
          timing: "Rust protocol projection stopped.",
          write: messageOf(error),
          paused: true,
          pauseAvailable: false,
          ratingInputActive: false,
          transitionActive: false,
        });
        if (error?.nativeTerminal === true) {
          this.#releaseRun();
          this.root.researchUi?.setMode?.("setup");
          void Promise.resolve(this.onRunTerminal()).catch(() => {});
        }
      }
    });
    return this.operation;
  }

  #startPolling() {
    this.#stopPolling();
    this.pollTimer = this.setInterval?.(() => this.#queue(() => this.refresh()), this.pollIntervalMs) ?? null;
  }

  #stopPolling() {
    if (this.pollTimer !== null) this.clearInterval?.(this.pollTimer);
    this.pollTimer = null;
  }

  async #questionnaireCommand(command, detail) {
    const run = this.#requiredRun();
    const position = detail?.protocolStepPosition;
    if (!positiveInteger(position) || position !== run.lastStatus?.questionnaire?.protocolStepPosition) {
      throw new Error("Questionnaire answers target a stale Rust protocol step.");
    }
    await this.invoke(command, {
      request: {
        runId: run.receipt.runId,
        protocolStepPosition: position,
        answers: questionnaireChoices(detail.answers),
      },
    });
  }

  async #project(status) {
    const run = this.#requiredRun();
    if (status.phase === "questionnaire") {
      this.#showNativeMedia(false);
      const signature = JSON.stringify(status.questionnaire);
      if (run.projectedQuestionnaire !== signature) {
        run.projectedQuestionnaire = signature;
        this.dispatch("affect-research:questionnaire-status", {
          active: true,
          moduleId: status.questionnaire.moduleId,
          questionnaireId: status.questionnaire.questionnaireId,
          protocolStepPosition: status.questionnaire.protocolStepPosition,
          answers: status.questionnaire.answers,
        });
      }
    } else if (run.projectedQuestionnaire !== null) {
      run.projectedQuestionnaire = null;
      this.dispatch("affect-research:questionnaire-status", { active: false });
    }

    const stimulusLabel = status.stimulus
      ? `${status.stimulus.stimulusPosition}/${status.stimulus.stimulusCount} · ${status.stimulus.title}`
      : status.phase === "questionnaire"
        ? "Questionnaire"
        : status.phase === "interval"
          ? "Between videos"
          : status.phase === "completeReady" ? "Protocol complete" : "Preparing protocol";
    const intervalMessage = status.intervalRemainingMs === null
      ? null
      : `Sampling is stopped and rating is neutral. Next video in ${(status.intervalRemainingMs / 1_000).toFixed(1)} seconds.`;
    this.dispatch("affect-research:run-status", {
      stimulus: stimulusLabel,
      timing: `${status.sampleCount} rows · ${status.gapEventCount} gap events · ${status.missedSlotCount} missed slots · ${status.coalescedInputUpdateCount} coalesced inputs`,
      write: status.writeHealthy ? `${status.eventCount} durable events · ${status.submittedResponseCount} submitted questionnaire rows` : "Native output writer failed closed.",
      lsl: status.lslEnabled ? "LSL enabled and Rust-owned" : "LSL disabled",
      x: status.currentValence,
      y: status.currentArousal,
      paused: status.phase === "paused",
      pauseAvailable: ["playing", "paused"].includes(status.phase),
      ratingInputActive: status.phase === "playing",
      transitionActive: status.phase === "interval",
      transitionMode: "fixed",
      transitionMessage: intervalMessage,
    });

    if (status.phase === "stimulusReady") {
      this.#showNativeMedia(true);
      await this.#prepareAndPlay(status);
    } else if (["playing", "paused"].includes(status.phase)) {
      this.#showNativeMedia(true);
    } else if (!["stimulusReady"].includes(status.phase)) {
      this.#showNativeMedia(false);
    }
    if (status.phase === "completeReady" && !run.finalizing) await this.finish("completed");
    if (status.phase === "failed") {
      throw new Error(`Rust package runtime failed closed (${status.failureCode ?? "unknown"}).`);
    }
  }

  async #prepareAndPlay(status) {
    const run = this.#requiredRun();
    const position = status.stimulus?.protocolStepPosition;
    if (!positiveInteger(position) || run.preparedPosition === position) return;
    run.preparedPosition = position;
    try {
      // The participant may have resized while a questionnaire hid feedback.
      // Re-establish the visible region before native playback accepts input.
      await this.prepareRunInput();
      await this.invoke("research_package_prepare_media", {
        request: { runId: run.receipt.runId, viewport: this.#viewport() },
      });
      await this.invoke("research_package_play", { request: { runId: run.receipt.runId } });
    } catch (error) {
      run.preparedPosition = null;
      throw error;
    }
  }

  #viewport() {
    const host = this.resolveMediaHost();
    const revision = (this.run?.viewportRevision ?? 0) + 1;
    this.run.viewportRevision = revision;
    return nativeMediaViewportCssV1(host, revision);
  }

  #showNativeMedia(visible) {
    const host = this.resolveMediaHost();
    const fallback = this.resolveFallbackVideo();
    const placeholder = this.resolvePlaceholder();
    if (host) host.hidden = !visible;
    if (fallback) fallback.hidden = true;
    if (placeholder) placeholder.hidden = visible;
  }

  #requiredRun() {
    if (!this.run) throw new Error("No Rust package protocol attempt is active.");
    return this.run;
  }

  #releaseRun() {
    this.#stopPolling();
    this.#showNativeMedia(false);
    this.run = null;
    this.onRunReleased();
  }

  async #ensureRecoveries(workspaceId, sourceText) {
    if (this.recoveryWorkspaceId !== workspaceId || this.recoverySourceText !== sourceText) {
      await this.refreshRecoveries(workspaceId, sourceText);
    }
  }

  #selectedRecovery(detail, requirement) {
    const participant = this.recoveryListing?.participants
      .find((candidate) => candidate.participantId === detail.participantId);
    const recovery = participant?.recoveryId
      ? this.recoveryListing.recoveries.find((candidate) => candidate.recoveryId === participant.recoveryId)
      : null;
    if (!recovery
      || (requirement.resumable === true && recovery.resumable !== true)
      || (requirement.finalizationPending === true && recovery.finalizationPending !== true)
      || recovery.settingsSha256 !== detail.researchSettingsSha256
      || recovery.assignmentPlanSha256 !== detail.resolvedPlan?.planHashSha256
      || recovery.protocolPlanSha256 !== detail.resolvedProtocolPlan?.protocolPlanHashSha256
      || recovery.languageId !== detail.selectedLanguageId
      || JSON.stringify(recovery.languageSelectionPath) !== JSON.stringify(detail.languageSelectionPath)
      || recovery.assignmentSha256 !== detail.packageAssignmentSha256
      || (detail.pendingFinalizationAttemptNumber !== undefined
        && recovery.attemptNumber !== detail.pendingFinalizationAttemptNumber)
      || (detail.pendingFinalizationCompletionStatus !== undefined
        && recovery.completionStatus !== detail.pendingFinalizationCompletionStatus)) {
      throw new Error("No exact package-bound recovery matches this participant, language route, settings, assignment, protocol, and attempt.");
    }
    return recovery;
  }

  async #finishRejectedReceipt(receipt) {
    await this.invoke("research_finish_package_run", {
      request: { runId: receipt.runId, outcome: "stopEarly" },
    });
  }

  async #reconcileRejectedActivation(detail) {
    const status = validateNativePackageRunStatusV1(await this.invoke("research_package_run_status"));
    if (status.active && status.participantId === detail.participantId && status.runId) {
      await this.invoke("research_finish_package_run", {
        request: { runId: status.runId, outcome: "stopEarly" },
      });
    }
  }

  #dispatchCompletion(receipt) {
    this.dispatch("affect-research:run-complete", {
      status: receipt.completionStatus,
      participant: receipt.participantId,
      attempt: receipt.attemptNumber,
      receipt: receipt.outputReceiptId,
      files: receipt.files.map(({ fileName }) => fileName).join(", "),
    });
  }
}

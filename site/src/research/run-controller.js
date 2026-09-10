import {
  RESEARCH_EVENT_SCHEMA,
  RESEARCH_RUN_MANIFEST_SCHEMA,
  RESEARCH_SAMPLE_SCHEMA,
  validateResearchEventV1,
  validateResearchRunManifestV2,
  validateResearchSampleV1,
  validateResearchSettingsV1,
  validateResolvedAssignmentPlanV1,
} from "./contracts.js";
import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import { createSessionStem, validateDerivedParticipantRecord } from "./identity.js";
import { affectCoordinates, evaluateFlubberMappings } from "./mappings.js";
import { samplesToCsv, samplesToTsv } from "./tabular.js";
import {
  projectResearchSettingsV2ToAssignmentSettingsV1,
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
  questionnaireResponsesToCsv,
  questionnaireResponsesToTsv,
} from "./questionnaires.js";
import {
  RESEARCH_RUN_MANIFEST_V3_SCHEMA,
  RESEARCH_RUN_MANIFEST_V4_SCHEMA,
  validateResearchEventV2,
  validateResearchRunManifestV3,
  validateResearchRunManifestV4,
} from "./protocol-records.js";

const encoder = new TextEncoder();
const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_FLUSH_INTERVAL_MS = 100;
const WORKER_COMMAND_TIMEOUT_MS = 5_000;

function isProtocolAttemptVersion(version) {
  return version === 2 || version === 3;
}

function uuid(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoObject?.getRandomValues?.(bytes);
  if (bytes.every((byte) => byte === 0)) throw new Error("Secure run identity generation is unavailable.");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function monotonicNs(monotonicMs) {
  return BigInt(Math.max(0, Math.round(monotonicMs * 1_000_000))).toString();
}

function isoNow(now) {
  return new Date(now()).toISOString();
}

function stimulusIdentity(stimulus) {
  const source = stimulus.source;
  if (source.kind === "youtube") {
    if (!Number.isFinite(source.observedDurationMs) || source.observedDurationMs <= 0) {
      throw new TypeError(`Experimental YouTube stimulus ${stimulus.stimulusId} requires observed duration metadata before Start.`);
    }
    return Object.freeze({
      kind: "youtube",
      stimulusId: stimulus.stimulusId,
      sha256: null,
      byteLength: null,
      durationMs: source.observedDurationMs,
      url: source.url,
      videoId: source.videoId,
    });
  }
  return Object.freeze({
    kind: source.kind,
    stimulusId: stimulus.stimulusId,
    sha256: source.sha256,
    byteLength: source.byteLength,
    durationMs: source.durationMs,
    url: null,
    videoId: null,
  });
}

function assertDependency(value, methods, label) {
  if (!value || methods.some((method) => typeof value[method] !== "function")) {
    throw new TypeError(`${label} must implement ${methods.join(", ")}.`);
  }
  return value;
}

function validateParticipantRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Privacy-safe participant record is required.");
  }
  const expected = ["participantCode", "age", "gender", "handedness"].sort();
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Participant record must contain only code, age, gender, and handedness.");
  }
  return validateDerivedParticipantRecord(value);
}

function detectBrowserPlatform(userAgent = globalThis.navigator?.userAgent ?? "") {
  if (/Edg\//u.test(userAgent)) return "edge";
  if (/Chrome\//u.test(userAgent) || /Chromium\//u.test(userAgent)) return "chrome";
  throw new Error("Affect Research v1 browser runs require desktop Chrome or Edge.");
}

export function browserPreflight(settings, plan, {
  inputTestPassed = false,
  verifiedStimulusIds = [],
  directoryPermission = false,
  indexedDbReady = false,
  timingWorkerReady = false,
  storageReady = false,
  manifestReady = false,
  packageReady = false,
} = {}) {
  const verified = new Set(verifiedStimulusIds);
  const blockers = [];
  if (settings.advanced.lsl.enabled) blockers.push({ code: "browser-lsl", message: "Disable LSL or run the Windows Tauri application." });
  if (!inputTestPassed) blockers.push({ code: "input-test", message: "Complete the live input test." });
  if (!directoryPermission) blockers.push({ code: "workspace-permission", message: "Renew read/write access to the selected workspace." });
  if (!indexedDbReady) blockers.push({ code: "indexeddb", message: "The authoritative browser recovery journal is unavailable." });
  if (!timingWorkerReady) blockers.push({ code: "timing-worker", message: "The dedicated sampling worker is not ready." });
  if (!storageReady) blockers.push({ code: "storage", message: "The browser write/quota probe has not covered this resolved plan." });
  if (!manifestReady) blockers.push({ code: "manifest", message: "The frozen settings and assignment manifest is not ready." });
  if (settings.version === 3 && !packageReady) {
    blockers.push({
      code: "experiment-package",
      message: "Load and verify the canonical experiment package before Start.",
    });
  }
  for (const stimulus of plan.stimuli) {
    if (stimulus.source.kind !== "youtube" && !verified.has(stimulus.stimulusId)) {
      blockers.push({ code: "stimulus-unverified", stimulusId: stimulus.stimulusId, message: `Verify ${stimulus.title} against its hash, size, duration, and decoder.` });
    }
    if (stimulus.source.kind === "youtube" && !Number.isFinite(stimulus.source.observedDurationMs)) {
      blockers.push({ code: "youtube-unverified", stimulusId: stimulus.stimulusId, message: `Load metadata for experimental YouTube stimulus ${stimulus.title}.` });
    }
  }
  if (plan.settingsSha256 === undefined) blockers.push({ code: "plan", message: "Resolve and hash the assignment plan." });
  return Object.freeze({ passed: blockers.length === 0, blockers: Object.freeze(blockers.map(Object.freeze)) });
}

async function readAll(journal, runId, kind) {
  const rows = [];
  let fromSequence = 1;
  while (true) {
    const page = await journal.readRecords(runId, { kind, fromSequence, limit: 10_000 });
    if (page.length === 0) break;
    rows.push(...page);
    fromSequence = page.at(-1).sequence + 1;
    if (page.length < 10_000) break;
  }
  return rows;
}

async function readAllQuestionnaireResponses(journal, runId) {
  const rows = [];
  let fromSequence = 1;
  while (true) {
    const page = await journal.readQuestionnaireResponses(runId, {
      fromSequence,
      limit: 10_000,
    });
    if (page.length === 0) break;
    rows.push(...page);
    fromSequence = page.at(-1).sequence + 1;
    if (page.length < 10_000) break;
  }
  return rows;
}

function byteLength(text) {
  return encoder.encode(text).byteLength;
}

export class BrowserResearchRunController extends EventTarget {
  constructor({
    journal,
    workspace,
    workerFactory = () => new Worker(new URL("./sampling-worker.js", import.meta.url), { type: "module" }),
    now = () => Date.now(),
    monotonicNow = () => performance.now(),
    monotonicTimeOriginMs = globalThis.performance?.timeOrigin ?? 0,
    cryptoObject = globalThis.crypto,
    platform = detectBrowserPlatform(),
    appVersion = "0.4.0-alpha.1",
    buildCommit = "development",
    batchSize = DEFAULT_BATCH_SIZE,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  } = {}) {
    super();
    this.journal = assertDependency(journal, [
      "open", "reserveAttempt", "resumeAttempt", "appendBatch", "setStimulusState",
      "markInterrupted", "prepareFinalization", "finalize", "getAttempt", "readRecords",
    ], "Research journal");
    this.workspace = assertDependency(workspace, [
      "createAttemptDirectory", "openAttemptDirectory", "writeAttemptArtifacts",
      "quarantineIncompleteAttemptArtifacts",
    ], "Research workspace");
    if (!["chrome", "edge"].includes(platform)) throw new TypeError("Browser platform must be chrome or edge.");
    if (!Number.isFinite(monotonicTimeOriginMs)) throw new TypeError("Browser monotonic time origin must be finite.");
    this.workerFactory = workerFactory;
    this.now = now;
    this.monotonicNow = monotonicNow;
    this.monotonicTimeOriginMs = monotonicTimeOriginMs;
    this.cryptoObject = cryptoObject;
    this.platform = platform;
    this.appVersion = appVersion;
    this.buildCommit = buildCommit;
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.mode = "setup";
    this.context = null;
    this.worker = null;
    this.workerReady = false;
    this.pendingSamples = [];
    this.pendingEvents = [];
    this.persistedSampleSequence = 1;
    this.persistedEventSequence = 1;
    this.persistedQuestionnaireResponseSequence = 1;
    this.issuedSampleSequence = 1;
    this.issuedEventSequence = 1;
    this.writeChain = Promise.resolve();
    this.writePromise = null;
    this.writeState = "idle";
    this.writeFailure = null;
    this.pendingStimulusState = null;
    this.flushTimer = null;
    this.pendingMissedSlots = 0;
    this.previousLatenessMs = null;
    this.paused = false;
    this.workerSessionToken = null;
    this.workerCommandSequence = 1;
    this.workerCommands = new Map();
    this.activeStimulusEpoch = null;
    this.nextStimulusEpoch = 1;
    this.expectedWorkerSampleSequence = 1;
    this.workerStimulusActive = false;
  }

  async initialize() {
    await this.journal.open();
    return this;
  }

  async start({
    settings: settingsInput,
    plan: planInput,
    protocolPlan: protocolPlanInput = null,
    experimentSourceText: experimentSourceTextInput = null,
    experimentPackageBinding: experimentPackageBindingInput = null,
    participantId,
    participant: participantInput,
    attemptNumber,
    preflight,
  }) {
    if (this.mode !== "setup" || this.context) throw new Error("A Research attempt is already active.");
    const externalProtocol = settingsInput?.version === 3;
    const protocolAware = settingsInput?.version === 2 || externalProtocol;
    const settings = externalProtocol
      ? await validateResearchSettingsV3(settingsInput)
      : protocolAware
        ? await validateResearchSettingsV2(settingsInput)
        : validateResearchSettingsV1(settingsInput);
    if (!protocolAware && protocolPlanInput !== null) {
      throw new TypeError("Historical ResearchSettingsV1 attempts cannot attach a protocol plan.");
    }
    const assignmentSettings = settings.version === 2
      ? await projectResearchSettingsV2ToAssignmentSettingsV1(settings)
      : settings;
    const plan = externalProtocol
      ? await validateResolvedExperimentPlanV1(planInput)
      : await validateResolvedAssignmentPlanV1(planInput);
    let experimentSourceText = null;
    if (externalProtocol) {
      if (typeof experimentSourceTextInput !== "string") {
        throw new TypeError("External-order Start requires the exact imported experiment.json text.");
      }
      const parsedExperiment = await parseExperimentDefinitionV1(encoder.encode(experimentSourceTextInput));
      if (parsedExperiment.sourceByteSha256 !== settings.externalProtocol.sourceByteSha256
        || parsedExperiment.definitionSha256 !== settings.externalProtocol.definitionSha256
        || canonicalJson(parsedExperiment.definition) !== canonicalJson(settings.externalProtocol.definition)
        || plan.sourceByteSha256 !== parsedExperiment.sourceByteSha256
        || plan.definitionSha256 !== parsedExperiment.definitionSha256) {
        throw new TypeError("The exact experiment.json source does not bind settings and the resolved plan.");
      }
      experimentSourceText = parsedExperiment.sourceText;
    }
    const settingsHash = await canonicalSha256(settings);
    const assignmentSettingsHash = await canonicalSha256(assignmentSettings);
    if (plan.settingsSha256 !== assignmentSettingsHash) {
      throw new TypeError("Assignment plan does not bind the selected settings projection.");
    }
    const protocolPlan = externalProtocol
      ? await validateResolvedProtocolPlanV2(protocolPlanInput, {
        settingsV3: settings,
        resolvedExperimentPlanV1: plan,
      })
      : protocolAware
        ? await validateResolvedProtocolPlanV1(protocolPlanInput, {
          settingsV2: settings,
          assignmentPlanV1: plan,
        })
        : null;
    if (protocolAware && protocolPlan.participantId !== participantId) {
      throw new TypeError("Protocol plan does not bind the selected participant.");
    }
    if (experimentPackageBindingInput !== null && !externalProtocol) {
      throw new TypeError("Experiment package runs require ResearchSettingsV3 external order.");
    }
    if (externalProtocol && experimentPackageBindingInput === null) {
      throw new TypeError("New ResearchSettingsV3 attempts require a canonical experiment package binding.");
    }
    const experimentPackage = experimentPackageBindingInput === null
      ? null
      : await validateExperimentPackageRunBindingV1(experimentPackageBindingInput, {
        settings,
        experimentPlan: plan,
        protocolPlan,
        participantId,
      });
    const assignment = plan.assignments.find((candidate) => candidate.participantId === participantId);
    if (!assignment) throw new TypeError("Selected participant is not present in the assignment plan.");
    const checks = browserPreflight(settings, plan, preflight);
    if (!checks.passed) {
      const error = new Error(`Research preflight failed: ${checks.blockers.map(({ code }) => code).join(", ")}.`);
      error.blockers = checks.blockers;
      throw error;
    }

    const participant = validateParticipantRecord(participantInput);
    const workspaceId = this.workspace.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new TypeError("The selected workspace has no persistent Research identity.");
    }
    const startedAt = isoNow(this.now);
    const sessionStem = createSessionStem({
      participantId,
      participantCode: participant.participantCode,
      age: participant.age,
      gender: participant.gender,
      handedness: participant.handedness,
      startedAt,
      attemptNumber,
    });
    const runId = protocolAware ? uuid(this.cryptoObject) : `run-${uuid(this.cryptoObject)}`;
    const ownerId = `tab-${uuid(this.cryptoObject)}`;
    const build = { platform: this.platform, appVersion: this.appVersion, buildCommit: this.buildCommit };
    const recoveryContext = {
      workspaceId,
      settings,
      plan,
      ...(protocolAware ? { protocolPlan } : {}),
      ...(externalProtocol ? { experimentSourceText } : {}),
      ...(experimentPackage ? { experimentPackage } : {}),
      participant,
      build,
      startedAt,
      startedMonotonicMs: this.monotonicNow(),
      elapsedOffsetMs: 0,
      resumed: false,
      sourceRunId: null,
      restartedStimulusIds: [],
    };
    if (protocolAware) {
      assertDependency(this.journal, [
        "reserveProtocolAttempt", "setProtocolState", "checkpointQuestionnaireDraft",
        "submitQuestionnaireStep", "readQuestionnaireResponses", "finalizeProtocol",
      ], "Questionnaire-aware Research journal");
    }
    const reserve = protocolAware
      ? this.journal.reserveProtocolAttempt.bind(this.journal)
      : this.journal.reserveAttempt.bind(this.journal);
    const attempt = await reserve({
      runId,
      experimentId: settings.experiment.id,
      participantId,
      attemptNumber,
      sessionStem,
      settingsHash,
      planHash: plan.planHashSha256,
      ...(protocolAware ? { protocolPlanHash: protocolPlan.protocolPlanHashSha256 } : {}),
      createdAt: startedAt,
      ownerId,
      context: recoveryContext,
    });

    let attemptDirectory;
    try {
      attemptDirectory = await this.workspace.createAttemptDirectory({
        experimentId: settings.experiment.id,
        participantId,
        sessionStem,
      });
    } catch (error) {
      await this.journal.markInterrupted({ runId, reason: "workspace-create-failed", updatedAt: isoNow(this.now) });
      throw error;
    }

    this.#adoptContext(attempt, attemptDirectory);
    try {
      await this.#startWorker();
      this.#queueEvent("sessionPrepared", { detailCode: "preflight-passed" });
      this.#queueEvent("sessionStarted", { detailCode: "browser-run-started" });
      await this.flush();
      this.mode = "run";
      this.#emitStatus();
      return this.snapshot();
    } catch (error) {
      await this.#abandonPreparation(runId, "browser-start-failed");
      throw error;
    }
  }

  async resume({ runId, ownerId = `tab-${uuid(this.cryptoObject)}` }) {
    if (this.mode !== "setup" || this.context) throw new Error("A Research attempt is already active.");
    const prior = await this.journal.getAttempt(runId);
    if (!prior?.recoverable) throw new Error(`Run ${runId} is not recoverable.`);
    if (prior.context?.workspaceId !== this.workspace.workspaceId) {
      throw new Error("Recovery evidence belongs to a different Research workspace.");
    }
    const resumedAt = isoNow(this.now);
    const attempt = await this.journal.resumeAttempt({ runId, ownerId, resumedAt });
    try {
      const externalProtocol = attempt.version === 3;
      const protocolAware = isProtocolAttemptVersion(attempt.version);
      const settings = externalProtocol
        ? await validateResearchSettingsV3(attempt.context.settings)
        : protocolAware
          ? await validateResearchSettingsV2(attempt.context.settings)
          : validateResearchSettingsV1(attempt.context.settings);
      const assignmentSettings = attempt.version === 2
        ? await projectResearchSettingsV2ToAssignmentSettingsV1(settings)
        : settings;
      const plan = externalProtocol
        ? await validateResolvedExperimentPlanV1(attempt.context.plan)
        : await validateResolvedAssignmentPlanV1(attempt.context.plan);
      const settingsHash = await canonicalSha256(settings);
      const assignmentSettingsHash = await canonicalSha256(assignmentSettings);
      const protocolPlan = externalProtocol
        ? await validateResolvedProtocolPlanV2(attempt.context.protocolPlan, {
          settingsV3: settings,
          resolvedExperimentPlanV1: plan,
        })
        : protocolAware
          ? await validateResolvedProtocolPlanV1(attempt.context.protocolPlan, {
            settingsV2: settings,
            assignmentPlanV1: plan,
          })
          : null;
      if (externalProtocol) {
        const parsedExperiment = await parseExperimentDefinitionV1(
          encoder.encode(attempt.context.experimentSourceText),
        );
        if (parsedExperiment.sourceByteSha256 !== settings.externalProtocol.sourceByteSha256
          || parsedExperiment.definitionSha256 !== settings.externalProtocol.definitionSha256
          || plan.sourceByteSha256 !== parsedExperiment.sourceByteSha256
          || plan.definitionSha256 !== parsedExperiment.definitionSha256) {
          throw new TypeError("Recovery experiment.json bytes no longer bind the frozen protocol.");
        }
        if (attempt.context.experimentPackage) {
          await validateExperimentPackageRunBindingV1(attempt.context.experimentPackage, {
            settings,
            experimentPlan: plan,
            protocolPlan,
            participantId: attempt.participantId,
          });
        }
      }
      if (settingsHash !== attempt.settingsHash
        || plan.settingsSha256 !== assignmentSettingsHash
        || plan.planHashSha256 !== attempt.planHash
        || protocolAware && protocolPlan.protocolPlanHashSha256 !== attempt.protocolPlanHash) {
        throw new TypeError("Recovery context no longer matches its frozen hashes.");
      }
      if (protocolAware) {
        assertDependency(this.journal, [
          "setProtocolState", "checkpointQuestionnaireDraft", "submitQuestionnaireStep",
          "readQuestionnaireResponses", "finalizeProtocol",
        ], "Questionnaire-aware Research journal");
      }
      validateParticipantRecord(attempt.context.participant);
      const directory = await this.workspace.openAttemptDirectory({
        experimentId: attempt.experimentId,
        participantId: attempt.participantId,
        sessionStem: attempt.sessionStem,
      });
      const priorSamples = await readAll(this.journal, runId, "samples");
      const priorEvents = await readAll(this.journal, runId, "events");
      const resumedContext = structuredClone(attempt.context);
      resumedContext.settings = settings;
      resumedContext.plan = plan;
      if (protocolAware) resumedContext.protocolPlan = protocolPlan;
      const lastSampleElapsedMs = priorSamples.at(-1)?.observedElapsedMs ?? 0;
      const lastEventElapsedMs = priorEvents.length
        ? Number(BigInt(priorEvents.at(-1).monotonicTimeNs)) / 1_000_000
        : 0;
      const priorQuestionnaireResponses = protocolAware
        ? await readAllQuestionnaireResponses(this.journal, runId)
        : [];
      const lastQuestionnaireElapsedMs = priorQuestionnaireResponses.length
        ? Number(BigInt(priorQuestionnaireResponses.at(-1).monotonicTimeNs)) / 1_000_000
        : 0;
      resumedContext.elapsedOffsetMs = Math.max(
        lastSampleElapsedMs,
        lastEventElapsedMs,
        lastQuestionnaireElapsedMs,
      );
      resumedContext.startedMonotonicMs = this.monotonicNow();
      const resumedAttempt = { ...attempt, context: resumedContext };
      this.#adoptContext(resumedAttempt, directory);
      if (attempt.pendingFinalization) {
        this.context.pendingFinalization = structuredClone(attempt.pendingFinalization);
        this.context.finalizationRetry = true;
        this.mode = "run";
        this.#emitStatus();
        return this.snapshot();
      }
      await this.#startWorker();
      this.#queueEvent("recoveryStarted", { detailCode: "safe-boundary" });
      this.#queueEvent("recoveryCompleted", {
        detailCode: protocolAware && this.context.interruptedProtocolStepKind === "questionnaire"
          ? "restore-questionnaire-draft"
          : protocolAware && this.context.interruptedProtocolStepKind === "interval"
            ? "restart-current-interval"
            : protocolAware && this.context.interruptedProtocolStepKind === "stimulus"
              ? "restart-current-video"
              : "resume-safe-protocol-boundary",
      });
      await this.flush();
      this.mode = "run";
      this.#emitStatus();
      return this.snapshot();
    } catch (error) {
      await this.#abandonPreparation(runId, "browser-recovery-start-failed");
      throw error;
    }
  }

  updateAffect({ currentValence, currentArousal, targetValence = currentValence, targetArousal = currentArousal, inputActive = false, mediaTimeMs = 0 }) {
    this.#assertRunning();
    if (this.context.protocolAware && this.context.activeProtocolStep?.kind !== "stimulus") {
      throw new Error("Rating input is disabled outside an active stimulus protocol step.");
    }
    const current = affectCoordinates(currentValence, currentArousal);
    const target = affectCoordinates(targetValence, targetArousal);
    const mappingValues = evaluateFlubberMappings(this.context.settings.advanced.mappings, {
      x: current.x,
      y: current.y,
    });
    this.context.lastAffect = {
      currentValence: current.x,
      currentArousal: current.y,
      targetValence: target.x,
      targetArousal: target.y,
      inputActive: Boolean(inputActive),
    };
    this.worker.postMessage({
      type: "state",
      sessionToken: this.workerSessionToken,
      state: {
        currentValence: current.x,
        currentArousal: current.y,
        targetValence: target.x,
        targetArousal: target.y,
        animationActive: this.context.settings.visual.flubberEnabled && !this.paused,
        inputActive,
        stimulusTimeMs: Math.max(0, Number(mediaTimeMs) || 0),
        mappingValues,
        anchorMonotonicMs: this.monotonicNow(),
      },
    });
  }

  nextProtocolStep() {
    this.#assertProtocolRun();
    const active = this.context.activeProtocolStep;
    if (active) return Object.freeze(structuredClone(active));
    return Object.freeze(structuredClone(
      this.context.protocolPlan.steps[this.context.safeProtocolStepPosition] ?? null,
    ));
  }

  activeQuestionnaire() {
    this.#assertProtocolRun();
    const step = this.context.activeProtocolStep;
    if (step?.kind !== "questionnaire") return null;
    const definition = this.#questionnaireDefinition(step);
    const module = this.context.settings.questionnaires.modules.find(({ moduleId }) => (
      moduleId === step.moduleId
    ));
    if (!module) throw new TypeError("The frozen questionnaire module is unavailable.");
    const draft = this.context.activeQuestionnaireDraft;
    return Object.freeze({
      step: structuredClone(step),
      definition: structuredClone(definition),
      module: structuredClone(module),
      answers: Object.freeze(Object.fromEntries(
        (draft?.responses ?? []).map(({ itemId, optionId }) => [itemId, optionId]),
      )),
      answerEvidence: Object.freeze((draft?.responses ?? []).map((response) => Object.freeze({
        itemId: response.itemId,
        optionId: response.optionId,
        wallTimeUtc: response.wallTimeUtc,
        monotonicTimeNs: response.monotonicTimeNs,
        responseLatencyMs: response.responseLatencyMs,
      }))),
    });
  }

  async beginQuestionnaireStep() {
    this.#assertProtocolRun();
    let step = this.context.activeProtocolStep;
    if (step !== null) {
      if (step.kind !== "questionnaire") throw new Error("The active protocol step is not a questionnaire.");
      return this.activeQuestionnaire();
    }
    step = this.context.protocolPlan.steps[this.context.safeProtocolStepPosition];
    if (!step || step.kind !== "questionnaire") {
      throw new Error("The next safe protocol step is not a questionnaire.");
    }
    await this.flush();
    const attempt = await this.journal.setProtocolState({
      runId: this.context.runId,
      activeProtocolStepPosition: step.protocolPosition,
      safeProtocolStepPosition: this.context.safeProtocolStepPosition,
      updatedAt: isoNow(this.now),
    });
    this.#adoptProtocolState(attempt);
    this.context.questionnaireOpenedElapsedMs = this.#elapsedMs();
    this.#queueEvent("questionnaireStarted", {
      protocolStep: step,
      detailCode: "questionnaire-form-opened",
    });
    await this.flush();
    this.#emitStatus();
    return this.activeQuestionnaire();
  }

  async checkpointQuestionnaireDraft(answers) {
    this.#assertActiveQuestionnaire();
    await this.flush();
    const step = this.context.activeProtocolStep;
    const answerRecords = this.#questionnaireAnswerRecords(answers);
    const attempt = await this.journal.checkpointQuestionnaireDraft({
      runId: this.context.runId,
      expectedSafeProtocolStepPosition: this.context.safeProtocolStepPosition,
      protocolStepPosition: step.protocolPosition,
      answers: answerRecords,
      updatedAt: isoNow(this.now),
    });
    this.#adoptProtocolState(attempt);
    this.#queueEvent("questionnaireDraftCheckpointed", {
      protocolStep: step,
      detailCode: "questionnaire-draft-durable",
    });
    await this.flush();
    this.#emitStatus();
    return this.activeQuestionnaire();
  }

  async submitQuestionnaire(answers) {
    this.#assertActiveQuestionnaire();
    await this.flush();
    const step = this.context.activeProtocolStep;
    const answerRecords = this.#questionnaireAnswerRecords(answers);
    const elapsedMs = this.context.elapsedOffsetMs
      + Math.max(0, this.monotonicNow() - this.context.startedMonotonicMs);
    const answerTimes = answerRecords.map(({ monotonicTimeNs }) => BigInt(monotonicTimeNs));
    const completedAtNs = answerTimes.reduce(
      (latest, value) => value > latest ? value : latest,
      BigInt(monotonicNs(elapsedMs)),
    ).toString();
    const attempt = await this.journal.submitQuestionnaireStep({
      runId: this.context.runId,
      expectedEventSequence: this.persistedEventSequence,
      expectedQuestionnaireResponseSequence: this.persistedQuestionnaireResponseSequence,
      expectedSafeProtocolStepPosition: this.context.safeProtocolStepPosition,
      protocolStepPosition: step.protocolPosition,
      answers: answerRecords,
      completionEvent: {
        wallTimeUtc: isoNow(this.now),
        monotonicTimeNs: completedAtNs,
        detailCode: "questionnaire-submitted",
      },
      updatedAt: isoNow(this.now),
    });
    this.persistedEventSequence = attempt.nextEventSequence;
    this.issuedEventSequence = attempt.nextEventSequence;
    this.persistedQuestionnaireResponseSequence = attempt.nextQuestionnaireResponseSequence;
    this.#adoptProtocolState(attempt);
    this.#emitStatus();
    return Object.freeze({
      completedStep: structuredClone(step),
      nextStep: structuredClone(
        this.context.protocolPlan.steps[this.context.safeProtocolStepPosition] ?? null,
      ),
    });
  }

  async startStimulus(index) {
    this.#assertRunning();
    if (this.context.activeStimulusIndex !== null) throw new Error("A stimulus is already active.");
    if (index !== this.context.safeStimulusIndex) throw new Error("Stimuli must start at the authoritative safe boundary.");
    const slot = this.context.assignment.slots[index];
    if (!slot) throw new RangeError("Stimulus index is outside this participant assignment.");
    const stimulus = this.context.stimuliById.get(slot.stimulusId);
    let protocolStep = null;
    if (this.context.protocolAware) {
      if (this.context.activeProtocolStep !== null) {
        throw new Error("A protocol step is already active.");
      }
      protocolStep = this.context.protocolPlan.steps[this.context.safeProtocolStepPosition];
      if (!protocolStep || protocolStep.kind !== "stimulus"
        || protocolStep.stimulusPosition !== index + 1
        || protocolStep.stimulusId !== stimulus.stimulusId) {
        throw new Error("Stimulus start does not match the next frozen protocol step.");
      }
      const attempt = await this.journal.setProtocolState({
        runId: this.context.runId,
        activeProtocolStepPosition: protocolStep.protocolPosition,
        safeProtocolStepPosition: this.context.safeProtocolStepPosition,
        updatedAt: isoNow(this.now),
      });
      this.#adoptProtocolState(attempt);
    }
    this.context.activeStimulusIndex = index;
    this.activeStimulusEpoch = this.nextStimulusEpoch;
    this.nextStimulusEpoch += 1;
    this.paused = false;
    this.previousLatenessMs = null;
    this.pendingMissedSlots = 0;
    this.updateAffect({ currentValence: 0, currentArousal: 0, inputActive: false, mediaTimeMs: 0 });
    if (!this.context.protocolAware) {
      this.#stageStimulusState({
        activeStimulusIndex: index,
        safeStimulusIndex: index,
      });
    }
    this.#queueEvent("stimulusStarted", {
      stimulus,
      position: index + 1,
      mediaTimeMs: 0,
      protocolStep,
      deferWrite: true,
    });
    await this.flush();
    await this.#sendWorkerCommand("stimulus-start", {
      stimulusIndex: index,
      stimulusId: stimulus.stimulusId,
      stimulusEpoch: this.activeStimulusEpoch,
    });
    this.workerStimulusActive = true;
    this.#emitStatus();
    return Object.freeze({ slot: structuredClone(slot), stimulus: structuredClone(stimulus) });
  }

  async pause(mediaTimeMs) {
    this.#assertActiveStimulus();
    if (this.paused) return;
    this.paused = true;
    await this.#sendWorkerCommand("pause", { stimulusEpoch: this.activeStimulusEpoch });
    const stimulus = this.#currentStimulus();
    this.#queueEvent("stimulusPaused", {
      stimulus,
      position: this.context.activeStimulusIndex + 1,
      mediaTimeMs,
    });
    await this.flush();
    this.#emitStatus();
  }

  async resumeStimulus(mediaTimeMs) {
    this.#assertActiveStimulus();
    if (!this.paused) return;
    this.previousLatenessMs = null;
    this.pendingMissedSlots = 0;
    this.updateAffect({ ...this.context.lastAffect, mediaTimeMs });
    const stimulus = this.#currentStimulus();
    this.#queueEvent("stimulusResumed", {
      stimulus,
      position: this.context.activeStimulusIndex + 1,
      mediaTimeMs,
    });
    await this.flush();
    await this.#sendWorkerCommand("resume", { stimulusEpoch: this.activeStimulusEpoch });
    this.paused = false;
    this.updateAffect({ ...this.context.lastAffect, mediaTimeMs });
    this.#emitStatus();
  }

  async completeStimulus(mediaTimeMs) {
    this.#assertActiveStimulus();
    const index = this.context.activeStimulusIndex;
    const stimulus = this.#currentStimulus();
    const protocolStep = this.context.protocolAware
      ? this.context.activeProtocolStep
      : null;
    await this.#sendWorkerCommand("stimulus-stop", { stimulusEpoch: this.activeStimulusEpoch });
    this.workerStimulusActive = false;
    this.#queueEvent("stimulusCompleted", {
      stimulus,
      position: index + 1,
      mediaTimeMs,
      protocolStep,
      deferWrite: true,
    });
    if (!this.context.protocolAware) {
      this.#stageStimulusState({
        activeStimulusIndex: null,
        safeStimulusIndex: index + 1,
      });
    }
    await this.flush();
    if (this.context.protocolAware) {
      const attempt = await this.journal.setProtocolState({
        runId: this.context.runId,
        activeProtocolStepPosition: null,
        safeProtocolStepPosition: protocolStep.protocolPosition,
        updatedAt: isoNow(this.now),
      });
      this.#adoptProtocolState(attempt);
    } else {
      this.context.safeStimulusIndex = index + 1;
      this.context.activeStimulusIndex = null;
    }
    this.activeStimulusEpoch = null;
    this.paused = false;
    this.#emitStatus();
  }

  async beginTransition() {
    this.#assertRunning();
    if (this.context.activeStimulusIndex !== null) throw new Error("Transition begins only after a complete stimulus boundary.");
    const transition = await this.#resolvedTransition();
    this.#queueEvent("transitionStarted", { detailCode: transition.mode });
    await this.flush();
    return transition;
  }

  async completeTransition() {
    this.#assertRunning();
    this.#queueEvent("transitionCompleted", { detailCode: this.context.settings.experiment.betweenVideos.mode });
    await this.flush();
  }

  async beginIntervalStep() {
    this.#assertProtocolRun();
    if (this.context.settings.version !== 3) {
      throw new Error("Explicit interval steps require an external experiment protocol.");
    }
    if (this.context.activeStimulusIndex !== null || this.context.activeProtocolStep !== null) {
      throw new Error("An interval can begin only at a safe protocol boundary.");
    }
    const step = this.context.protocolPlan.steps[this.context.safeProtocolStepPosition];
    if (!step || step.kind !== "interval") {
      throw new Error("The next safe protocol step is not an interval.");
    }
    await this.flush();
    const attempt = await this.journal.setProtocolState({
      runId: this.context.runId,
      activeProtocolStepPosition: step.protocolPosition,
      safeProtocolStepPosition: this.context.safeProtocolStepPosition,
      updatedAt: isoNow(this.now),
    });
    this.#adoptProtocolState(attempt);
    this.#queueEvent("transitionStarted", {
      protocolStep: step,
      detailCode: "external-isi",
    });
    await this.flush();
    this.#emitStatus();
    return Object.freeze(structuredClone(step));
  }

  async completeIntervalStep() {
    this.#assertProtocolRun();
    const step = this.context.activeProtocolStep;
    if (this.context.settings.version !== 3 || step?.kind !== "interval") {
      throw new Error("No external interval step is active.");
    }
    this.#queueEvent("transitionCompleted", {
      protocolStep: step,
      detailCode: "external-isi",
    });
    await this.flush();
    const attempt = await this.journal.setProtocolState({
      runId: this.context.runId,
      activeProtocolStepPosition: null,
      safeProtocolStepPosition: step.protocolPosition,
      updatedAt: isoNow(this.now),
    });
    this.#adoptProtocolState(attempt);
    this.#emitStatus();
    return Object.freeze({
      completedStep: structuredClone(step),
      nextStep: structuredClone(
        this.context.protocolPlan.steps[this.context.safeProtocolStepPosition] ?? null,
      ),
    });
  }

  queueInputEdge({ direction, action, active }) {
    this.#assertRunning();
    if (this.context.protocolAware && this.context.activeProtocolStep?.kind !== "stimulus") {
      throw new Error("Rating input is disabled outside an active stimulus protocol step.");
    }
    const actionCode = action?.kind === "keyboard"
      ? action.code
      : action?.kind === "mouseButton"
        ? `button-${action.button}`
        : action?.kind === "wheel"
          ? action.direction
          : action?.kind === "gamepadButton"
            ? `button-${action.button}`
            : "unknown";
    this.#queueEvent("inputEdge", {
      protocolStep: this.context.activeProtocolStep,
      detailCode: `${direction}-${action?.kind ?? "unknown"}-${actionCode}-${active ? "down" : "up"}`,
    });
  }

  async stopEarly(detailCode = "operator-stop") {
    this.#assertRunning();
    if (this.context.activeStimulusIndex !== null) {
      await this.#sendWorkerCommand("stimulus-stop", { stimulusEpoch: this.activeStimulusEpoch });
      this.workerStimulusActive = false;
    }
    this.#queueEvent("stoppedEarly", { detailCode });
    return this.#finalize("partial");
  }

  async complete() {
    this.#assertRunning();
    if (this.context.activeStimulusIndex !== null) throw new Error("Complete the active stimulus first.");
    const sequenceComplete = this.context.protocolAware
      ? this.context.safeProtocolStepPosition === this.context.protocolPlan.steps.length
        && this.context.activeProtocolStep === null
      : this.context.safeStimulusIndex === this.context.assignment.slots.length;
    if (!sequenceComplete) {
      throw new Error("All assigned stimuli must complete before the session can complete.");
    }
    this.#queueEvent("sessionCompleted", { detailCode: "assignment-complete" });
    return this.#finalize("completed");
  }

  async finalizePendingOutput() {
    if (this.mode !== "run" || !this.context?.pendingFinalization || this.worker) {
      throw new Error("No prepared Research finalization is waiting for output recovery.");
    }
    return this.#materializeFinalization(this.context.pendingFinalization);
  }

  async interrupt(reason = "unexpected-interruption") {
    if (!this.context || this.mode !== "run") return undefined;
    await this.#stopWorker();
    await this.flush();
    const partial = await this.journal.markInterrupted({
      runId: this.context.runId,
      reason,
      updatedAt: isoNow(this.now),
    });
    this.mode = "setup";
    this.context = null;
    this.#emitStatus();
    return partial;
  }

  async flush() {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.writeState === "failed") throw this.writeFailure;
    this.#scheduleWrite();
    if (this.writePromise) await this.writePromise;
    if (this.writeState === "failed") throw this.writeFailure;
  }

  async retryWrites() {
    if (!this.context || this.writeState !== "failed") {
      throw new Error("No failed Research journal write is waiting for retry.");
    }
    if (this.writePromise) await this.writePromise.catch(() => {});
    this.writeState = "idle";
    this.writeFailure = null;
    await this.flush();
    this.#queueEvent("writeRecovered", { detailCode: "journal-write-recovered", deferWrite: true });
    await this.flush();
    this.#emitStatus();
    return this.snapshot();
  }

  snapshot() {
    if (!this.context) return Object.freeze({ mode: "setup", runId: null });
    return Object.freeze({
      mode: this.mode,
      runId: this.context.runId,
      participantId: this.context.participantId,
      attemptNumber: this.context.attemptNumber,
      sessionStem: this.context.sessionStem,
      activeStimulusIndex: this.context.activeStimulusIndex,
      safeStimulusIndex: this.context.safeStimulusIndex,
      totalStimuli: this.context.assignment.slots.length,
      protocolAware: this.context.protocolAware,
      activeProtocolStep: this.context.activeProtocolStep
        ? structuredClone(this.context.activeProtocolStep)
        : null,
      safeProtocolStepPosition: this.context.protocolAware
        ? this.context.safeProtocolStepPosition
        : null,
      totalProtocolSteps: this.context.protocolAware
        ? this.context.protocolPlan.steps.length
        : null,
      questionnaireDraftActive: Boolean(this.context.activeQuestionnaireDraft),
      interruptedProtocolStepKind: this.context.protocolAware
        ? this.context.interruptedProtocolStepKind
        : null,
      paused: this.paused,
      persistedSamples: this.persistedSampleSequence - 1,
      persistedEvents: this.persistedEventSequence - 1,
      workerReady: this.workerReady,
      writeState: this.writeState,
      pendingSamples: this.pendingSamples.length,
      pendingEvents: this.pendingEvents.length,
      finalizationPending: Boolean(this.context.pendingFinalization),
    });
  }

  #adoptContext(attempt, attemptDirectory) {
    const saved = attempt.context;
    const assignment = saved.plan.assignments.find(({ participantId }) => participantId === attempt.participantId);
    if (!assignment) throw new TypeError("Recovery plan does not contain the reserved participant assignment.");
    this.context = {
      ...structuredClone(saved),
      assignment: structuredClone(assignment),
      runId: attempt.runId,
      experimentId: attempt.experimentId,
      participantId: attempt.participantId,
      attemptNumber: attempt.attemptNumber,
      sessionStem: attempt.sessionStem,
      settingsHash: attempt.settingsHash,
      planHash: attempt.planHash,
      protocolAware: isProtocolAttemptVersion(attempt.version),
      protocolPlanHash: isProtocolAttemptVersion(attempt.version) ? attempt.protocolPlanHash : null,
      interruptedProtocolStepKind: isProtocolAttemptVersion(attempt.version)
        ? attempt.interruption?.interruptedProtocolStepKind ?? null
        : null,
      safeProtocolStepPosition: isProtocolAttemptVersion(attempt.version) ? attempt.safeProtocolStepPosition : null,
      activeProtocolStep: isProtocolAttemptVersion(attempt.version) && attempt.activeProtocolStep
        ? structuredClone(attempt.activeProtocolStep)
        : null,
      activeQuestionnaireDraft: isProtocolAttemptVersion(attempt.version) && attempt.activeQuestionnaireDraft
        ? structuredClone(attempt.activeQuestionnaireDraft)
        : null,
      questionnaireAnswerEvidence: isProtocolAttemptVersion(attempt.version)
        ? structuredClone(attempt.activeQuestionnaireDraft?.responses ?? []).map((response) => ({
          itemId: response.itemId,
          optionId: response.optionId,
          wallTimeUtc: response.wallTimeUtc,
          monotonicTimeNs: response.monotonicTimeNs,
          responseLatencyMs: response.responseLatencyMs,
        }))
        : [],
      questionnaireOpenedElapsedMs: isProtocolAttemptVersion(attempt.version)
        && attempt.activeProtocolStep?.kind === "questionnaire"
        ? saved.elapsedOffsetMs ?? 0
        : null,
      safeStimulusIndex: attempt.safeStimulusIndex,
      activeStimulusIndex: null,
      attemptDirectory,
      stimuliById: new Map(saved.plan.stimuli.map((stimulus) => [stimulus.stimulusId, stimulus])),
      gapEventCount: 0,
      missedSlotCount: 0,
      lastAffect: {
        currentValence: 0,
        currentArousal: 0,
        targetValence: 0,
        targetArousal: 0,
        inputActive: false,
      },
    };
    this.persistedSampleSequence = attempt.nextSampleSequence;
    this.persistedEventSequence = attempt.nextEventSequence;
    this.persistedQuestionnaireResponseSequence = isProtocolAttemptVersion(attempt.version)
      ? attempt.nextQuestionnaireResponseSequence
      : 1;
    this.issuedSampleSequence = attempt.nextSampleSequence;
    this.issuedEventSequence = attempt.nextEventSequence;
    this.pendingSamples = [];
    this.pendingEvents = [];
    this.pendingMissedSlots = 0;
    this.previousLatenessMs = null;
    this.pendingStimulusState = null;
    this.writeState = "idle";
    this.writeFailure = null;
    this.activeStimulusEpoch = null;
    this.nextStimulusEpoch = 1;
    this.expectedWorkerSampleSequence = 1;
    this.workerStimulusActive = false;
  }

  #adoptProtocolState(attempt) {
    if (!this.context?.protocolAware || !isProtocolAttemptVersion(attempt.version)
      || attempt.runId !== this.context.runId
      || attempt.protocolPlanHash !== this.context.protocolPlanHash) {
      throw new TypeError("Protocol journal state no longer binds the active attempt.");
    }
    this.context.safeProtocolStepPosition = attempt.safeProtocolStepPosition;
    this.context.safeStimulusIndex = attempt.safeStimulusIndex;
    this.context.activeProtocolStep = attempt.activeProtocolStep
      ? structuredClone(attempt.activeProtocolStep)
      : null;
    this.context.activeStimulusIndex = attempt.activeStimulusIndex;
    this.context.activeQuestionnaireDraft = attempt.activeQuestionnaireDraft
      ? structuredClone(attempt.activeQuestionnaireDraft)
      : null;
    this.context.questionnaireAnswerEvidence = structuredClone(
      attempt.activeQuestionnaireDraft?.responses ?? [],
    ).map((response) => ({
      itemId: response.itemId,
      optionId: response.optionId,
      wallTimeUtc: response.wallTimeUtc,
      monotonicTimeNs: response.monotonicTimeNs,
      responseLatencyMs: response.responseLatencyMs,
    }));
    if (attempt.activeProtocolStep?.kind !== "questionnaire") {
      this.context.questionnaireOpenedElapsedMs = null;
    }
    this.persistedQuestionnaireResponseSequence = attempt.nextQuestionnaireResponseSequence;
  }

  async #startWorker() {
    this.worker = this.workerFactory();
    if (!this.worker?.postMessage || !this.worker?.addEventListener) throw new TypeError("Sampling worker factory returned an invalid Worker.");
    this.workerReady = false;
    this.workerSessionToken = `sampling-${uuid(this.cryptoObject)}`;
    this.workerCommandSequence = 1;
    this.workerCommands.clear();
    this.expectedWorkerSampleSequence = 1;
    this.worker.addEventListener("message", ({ data }) => this.#workerMessage(data));
    const workerFailure = () => {
      if (!this.worker) return;
      this.#terminateWorker(new Error("Sampling worker failed."));
      this.dispatchEvent(new CustomEvent("runtimeerror", { detail: { code: "sampling-worker" } }));
      void this.interrupt("sampling-worker-failed");
    };
    this.worker.addEventListener("error", workerFailure);
    this.worker.addEventListener("messageerror", workerFailure);
    const ready = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.worker?.removeEventListener("message", listener);
        this.worker?.removeEventListener("error", errorListener);
        this.worker?.removeEventListener("messageerror", errorListener);
      };
      const listener = ({ data }) => {
        if (data?.type !== "ready") return;
        if (data.sessionToken !== this.workerSessionToken
          || data.samplingFrequencyHz !== this.context.settings.experiment.samplingFrequencyHz
          || data.clockDomain !== "controller-performance-v1"
          || data.controllerTimeOriginMs !== this.monotonicTimeOriginMs
          || !Number.isFinite(data.workerTimeOriginMs)
          || !Number.isFinite(data.clockOffsetMs)) {
          cleanup();
          reject(new Error("Sampling worker returned an invalid clock-domain handshake."));
          return;
        }
        cleanup();
        resolve();
      };
      const errorListener = () => {
        cleanup();
        reject(new Error("Sampling worker failed before readiness."));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Sampling worker readiness timed out."));
      }, 5_000);
      this.worker.addEventListener("message", listener);
      this.worker.addEventListener("error", errorListener, { once: true });
      this.worker.addEventListener("messageerror", errorListener, { once: true });
    });
    this.worker.postMessage({
      type: "configure",
      sessionToken: this.workerSessionToken,
      controllerTimeOriginMs: this.monotonicTimeOriginMs,
      samplingFrequencyHz: this.context.settings.experiment.samplingFrequencyHz,
    });
    await ready;
    this.workerReady = true;
  }

  #workerMessage(data) {
    if (data?.type === "ack") {
      const pending = this.workerCommands.get(data.commandId);
      if (!pending) return;
      const provenanceMatches = ["stimulusEpoch", "stimulusIndex", "stimulusId"]
        .every((field) => !Object.hasOwn(pending.expected, field) || data[field] === pending.expected[field]);
      if (data.sessionToken !== this.workerSessionToken || data.commandType !== pending.commandType) {
        pending.reject(new Error("Sampling worker acknowledgement provenance changed."));
      } else if (!provenanceMatches) {
        pending.reject(new Error("Sampling worker acknowledgement stimulus provenance changed."));
      } else {
        pending.resolve(data);
      }
      this.workerCommands.delete(data.commandId);
      return;
    }
    if (!this.context || this.mode === "setup") return;
    if (data?.sessionToken !== this.workerSessionToken) {
      this.#workerProtocolFailure("sampling-provenance");
      return;
    }
    if (data?.type === "sample") {
      try {
        this.#validateWorkerEvidence(data.sample, "sample");
        this.#queueSample(data.sample);
        this.expectedWorkerSampleSequence += 1;
      } catch (error) {
        this.dispatchEvent(new CustomEvent("runtimeerror", { detail: { code: "sample-validation", error } }));
        void this.interrupt("sample-validation-failed");
      }
    } else if (data?.type === "gap") {
      try {
        this.#validateWorkerEvidence(data.event, "gap");
        this.pendingMissedSlots += data.event.missedSlots;
        this.context.gapEventCount += 1;
        this.context.missedSlotCount += data.event.missedSlots;
        this.#queueEvent("timingGap", {
          stimulus: this.#currentStimulus(),
          position: this.context.activeStimulusIndex + 1,
          missedSlotCount: data.event.missedSlots,
          detailCode: "scheduler-deadline-missed",
        });
      } catch (error) {
        this.dispatchEvent(new CustomEvent("runtimeerror", { detail: { code: "gap-validation", error } }));
        void this.interrupt("gap-validation-failed");
      }
    } else if (data?.type === "error") {
      const pending = Number.isSafeInteger(data.commandId) ? this.workerCommands.get(data.commandId) : null;
      if (pending) {
        pending.reject(new Error(data.message ?? "Sampling worker command failed."));
        this.workerCommands.delete(data.commandId);
      }
      this.dispatchEvent(new CustomEvent("runtimeerror", { detail: { code: data.code ?? "sampling-worker" } }));
      void this.interrupt("sampling-worker-failed");
    }
  }

  #validateWorkerEvidence(raw, kind) {
    if (!raw || typeof raw !== "object" || this.context.activeStimulusIndex === null) {
      throw new TypeError(`Sampling worker ${kind} has no active stimulus.`);
    }
    const stimulus = this.#currentStimulus();
    if (raw.stimulusEpoch !== this.activeStimulusEpoch
      || raw.stimulusIndex !== this.context.activeStimulusIndex
      || raw.stimulusId !== stimulus?.stimulusId
      || raw.samplingFrequencyHz !== this.context.settings.experiment.samplingFrequencyHz) {
      throw new TypeError(`Sampling worker ${kind} does not bind the active stimulus epoch and rate.`);
    }
    if (!Number.isFinite(raw.observedMonotonicMs)) {
      throw new TypeError(`Sampling worker ${kind} has an invalid observed time.`);
    }
    if (kind === "sample") {
      if (raw.sequence !== this.expectedWorkerSampleSequence
        || !Number.isFinite(raw.scheduledMonotonicMs)
        || !Number.isFinite(raw.latenessMs)
        || raw.observedMonotonicMs + 0.001 < raw.scheduledMonotonicMs
        || Math.abs(raw.latenessMs - Math.max(0, raw.observedMonotonicMs - raw.scheduledMonotonicMs)) > 0.001) {
        throw new TypeError("Sampling worker sample sequence or deadline evidence is invalid.");
      }
    } else if (!Number.isSafeInteger(raw.missedSlots) || raw.missedSlots < 1
      || !Number.isFinite(raw.firstMissedMonotonicMs)
      || !Number.isFinite(raw.durationMs)) {
      throw new TypeError("Sampling worker gap evidence is invalid.");
    }
  }

  #workerProtocolFailure(code) {
    this.dispatchEvent(new CustomEvent("runtimeerror", { detail: { code } }));
    void this.interrupt("sampling-worker-failed");
  }

  #queueSample(raw) {
    this.#assertActiveStimulus();
    const stimulus = this.#currentStimulus();
    const identity = stimulusIdentity(stimulus);
    const position = this.context.activeStimulusIndex + 1;
    const mediaTimeMs = Math.max(0, Math.min(identity.durationMs, Number(raw.stimulusTimeMs) || 0));
    const scheduledElapsedMs = this.context.elapsedOffsetMs
      + Math.max(0, raw.scheduledMonotonicMs - this.context.startedMonotonicMs);
    const observedElapsedMs = this.context.elapsedOffsetMs
      + Math.max(0, raw.observedMonotonicMs - this.context.startedMonotonicMs);
    const sample = validateResearchSampleV1({
      schema: RESEARCH_SAMPLE_SCHEMA,
      version: 1,
      sequence: this.issuedSampleSequence,
      runId: this.context.runId,
      participantId: this.context.participantId,
      attemptNumber: this.context.attemptNumber,
      settingsSha256: this.context.settingsHash,
      assignmentPlanSha256: this.context.planHash,
      stimulusPosition: position,
      stimulusIdentity: identity,
      wallTimeUtc: raw.wallTimeUtc,
      monotonicTimeNs: monotonicNs(observedElapsedMs),
      lslTimeSeconds: null,
      sampleRateHz: this.context.settings.experiment.samplingFrequencyHz,
      scheduledElapsedMs,
      observedElapsedMs,
      schedulerLatenessMs: raw.latenessMs,
      schedulerJitterMs: this.previousLatenessMs === null ? 0 : raw.latenessMs - this.previousLatenessMs,
      stateAnchorAgeMs: raw.anchorAgeMs,
      missedSlotsBefore: this.pendingMissedSlots,
      mediaTimeMs,
      currentValence: raw.currentValence,
      currentArousal: raw.currentArousal,
      targetValence: raw.targetValence,
      targetArousal: raw.targetArousal,
      radius: raw.radius,
      angleDegrees: raw.angleDegrees,
      oscillationFrequency: raw.mappingValues.oscillationFrequency,
      edgeSmoothness: raw.mappingValues.edgeSmoothness,
      projectionAmplitude: raw.mappingValues.projectionAmplitude,
      pulseSynchrony: raw.mappingValues.pulseSynchrony,
      waveSizeVariation: raw.mappingValues.waveSizeVariation,
      saturation: raw.mappingValues.saturation,
      animationActive: raw.animationActive,
      inputActive: raw.inputActive,
      inputKind: this.context.settings.input.kind,
      feedbackVisible: !this.context.settings.visual.hideFeedback
        && (this.context.settings.visual.gridEnabled || this.context.settings.visual.flubberEnabled),
    });
    this.previousLatenessMs = raw.latenessMs;
    this.pendingMissedSlots = 0;
    this.issuedSampleSequence += 1;
    this.pendingSamples.push(sample);
    if (this.pendingSamples.length >= this.batchSize) this.#scheduleWrite();
    else this.#scheduleTimedFlush();
  }

  #queueEvent(type, {
    stimulus = null,
    position = null,
    protocolStep = undefined,
    mediaTimeMs = null,
    missedSlotCount = null,
    detailCode = null,
    deferWrite = false,
  } = {}) {
    const elapsedMs = this.context.elapsedOffsetMs
      + Math.max(0, this.monotonicNow() - this.context.startedMonotonicMs);
    const shared = {
      schema: RESEARCH_EVENT_SCHEMA,
      sequence: this.issuedEventSequence,
      runId: this.context.runId,
      participantId: this.context.participantId,
      attemptNumber: this.context.attemptNumber,
      settingsSha256: this.context.settingsHash,
      assignmentPlanSha256: this.context.planHash,
      wallTimeUtc: isoNow(this.now),
      monotonicTimeNs: monotonicNs(elapsedMs),
      type,
      stimulusIdentity: stimulus ? stimulusIdentity(stimulus) : null,
      stimulusPosition: position,
      mediaTimeMs: mediaTimeMs === null
        ? null
        : Math.min(stimulus ? stimulusIdentity(stimulus).durationMs : Number.MAX_SAFE_INTEGER, Math.max(0, Number(mediaTimeMs) || 0)),
      missedSlotCount,
      detailCode,
    };
    const event = this.context.protocolAware
      ? (() => {
        const boundStep = protocolStep === undefined
          ? this.context.activeProtocolStep
          : protocolStep;
        const questionnaireEvent = type === "questionnaireStarted"
          || type === "questionnaireDraftCheckpointed"
          || type === "questionnaireCompleted";
        return validateResearchEventV2({
          ...shared,
          version: 2,
          protocolPlanSha256: this.context.protocolPlanHash,
          protocolStepPosition: boundStep?.protocolPosition ?? null,
          moduleId: questionnaireEvent ? boundStep?.moduleId ?? null : null,
          questionnaireId: questionnaireEvent ? boundStep?.questionnaireId ?? null : null,
          definitionSha256: questionnaireEvent ? boundStep?.definitionSha256 ?? null : null,
        });
      })()
      : validateResearchEventV1({ ...shared, version: 1 });
    this.issuedEventSequence += 1;
    this.pendingEvents.push(event);
    if (!deferWrite) {
      if (this.pendingEvents.length >= this.batchSize) this.#scheduleWrite();
      else this.#scheduleTimedFlush();
    }
    return event;
  }

  #scheduleTimedFlush() {
    if (this.flushTimer !== null || this.writeState === "failed") return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.#scheduleWrite();
    }, this.flushIntervalMs);
  }

  #scheduleWrite() {
    if (this.writePromise || this.writeState === "failed"
      || (this.pendingSamples.length === 0 && this.pendingEvents.length === 0 && !this.pendingStimulusState)) return;
    const operation = this.#drainWrites();
    this.writePromise = operation.finally(() => {
      this.writePromise = null;
    });
    this.writeChain = this.writePromise;
    void this.writePromise.catch(() => {});
  }

  async #drainWrites() {
    this.writeState = "writing";
    try {
      while (this.context && (this.pendingSamples.length > 0 || this.pendingEvents.length > 0 || this.pendingStimulusState)) {
        const sampleCount = this.pendingSamples.length;
        const eventCount = this.pendingEvents.length;
        const samples = this.pendingSamples.slice(0, sampleCount);
        const events = this.pendingEvents.slice(0, eventCount);
        const stimulusState = this.pendingStimulusState;
        await this.journal.appendBatch({
          runId: this.context.runId,
          expectedSampleSequence: this.persistedSampleSequence,
          expectedEventSequence: this.persistedEventSequence,
          samples,
          events,
          stimulusState,
          updatedAt: isoNow(this.now),
        });
        this.pendingSamples.splice(0, sampleCount);
        this.pendingEvents.splice(0, eventCount);
        if (this.pendingStimulusState === stimulusState) this.pendingStimulusState = null;
        this.persistedSampleSequence += sampleCount;
        this.persistedEventSequence += eventCount;
        this.#emitStatus();
      }
      this.writeState = "idle";
      this.writeFailure = null;
    } catch (error) {
      await this.#handleWriteFailure(error);
      throw error;
    }
  }

  async #handleWriteFailure(error) {
    if (this.writeState === "failed") return;
    this.writeState = "failed";
    this.writeFailure = error;
    this.paused = true;
    if (this.workerStimulusActive && this.workerReady) {
      await this.#sendWorkerCommand("pause", { stimulusEpoch: this.activeStimulusEpoch }).catch(() => {
        this.#terminateWorker(new Error("Sampling worker could not fence a failed journal write."));
      });
    }
    if (this.context) {
      this.#queueEvent("writeInterrupted", { detailCode: "journal-write-failed", deferWrite: true });
    }
    this.dispatchEvent(new CustomEvent("runtimeerror", { detail: { code: "journal-write", error } }));
    this.#emitStatus();
  }

  #stageStimulusState({ activeStimulusIndex, safeStimulusIndex }) {
    if (this.pendingStimulusState) throw new Error("A stimulus-state journal transition is already pending.");
    this.pendingStimulusState = Object.freeze({ activeStimulusIndex, safeStimulusIndex });
  }

  #sendWorkerCommand(commandType, details = {}) {
    if (!this.worker || !this.workerReady || !this.workerSessionToken) {
      return Promise.reject(new Error("Sampling worker is unavailable."));
    }
    const commandId = this.workerCommandSequence;
    this.workerCommandSequence += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.workerCommands.delete(commandId)) return;
        reject(new Error(`Sampling worker ${commandType} acknowledgement timed out.`));
      }, WORKER_COMMAND_TIMEOUT_MS);
      this.workerCommands.set(commandId, {
        commandType,
        expected: structuredClone(details),
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.worker.postMessage({
        type: commandType,
        commandId,
        sessionToken: this.workerSessionToken,
        ...details,
      });
    });
  }

  async #stopWorker() {
    if (!this.worker) return;
    try {
      if (this.workerReady) await this.#sendWorkerCommand("stop");
    } finally {
      this.#terminateWorker(new Error("Sampling worker stopped."));
    }
  }

  #terminateWorker(error) {
    this.#rejectWorkerCommands(error);
    this.worker?.terminate?.();
    this.worker = null;
    this.workerReady = false;
    this.workerSessionToken = null;
    this.workerStimulusActive = false;
  }

  #rejectWorkerCommands(error) {
    for (const pending of this.workerCommands.values()) pending.reject(error);
    this.workerCommands.clear();
  }

  async #resolvedTransition() {
    const policy = this.context.settings.experiment.betweenVideos;
    if (policy.mode === "fixed") return Object.freeze({ mode: "fixed", durationMs: policy.durationMs });
    if (policy.mode === "continueWhenReady") return Object.freeze({ mode: "continueWhenReady", durationMs: null });
    const digest = await sha256Hex(`${this.context.settings.stimuli.seed}\0${this.context.participantId}\0${this.context.safeStimulusIndex}`);
    const index = Number.parseInt(digest.slice(0, 8), 16) % policy.durationsMs.length;
    return Object.freeze({ mode: "jitter", durationMs: policy.durationsMs[index], selectedIndex: index });
  }

  async #abandonPreparation(runId, reason) {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.#terminateWorker(new Error("Research attempt preparation was abandoned."));
    await this.journal.markInterrupted({
      runId,
      reason,
      updatedAt: isoNow(this.now),
    }).catch(() => {});
    this.mode = "setup";
    this.context = null;
    this.pendingSamples = [];
    this.pendingEvents = [];
    this.#emitStatus();
  }

  async #finalize(completionStatus) {
    await this.#stopWorker();
    await this.flush();
    const descriptor = this.context.pendingFinalization ?? Object.freeze({
      completionStatus,
      finalizedAt: isoNow(this.now),
      recovery: Object.freeze({
        resumed: this.context.resumed,
        sourceRunId: this.context.sourceRunId,
        restartedStimulusIds: Object.freeze([...this.context.restartedStimulusIds]),
      }),
    });
    if (descriptor.completionStatus !== completionStatus) {
      throw new Error("Prepared Research finalization status cannot change across retries.");
    }
    await this.journal.prepareFinalization({
      runId: this.context.runId,
      ...structuredClone(descriptor),
    });
    this.context.pendingFinalization = structuredClone(descriptor);
    return this.#materializeFinalization(descriptor);
  }

  async #materializeFinalization(descriptor) {
    try {
    const samples = await readAll(this.journal, this.context.runId, "samples");
    const events = await readAll(this.journal, this.context.runId, "events");
    if (this.context.protocolAware) {
      return await this.#materializeProtocolFinalization(descriptor, samples, events);
    }
    const { completionStatus, finalizedAt, recovery } = descriptor;
    const settingsText = `${canonicalJson(this.context.settings)}\n`;
    const eventsText = `${events.map((event) => canonicalJson(event)).join("\n")}\n`;
    const artifacts = {
      "settings.snapshot.json": settingsText,
      "events.jsonl": eventsText,
    };
    const outputs = [
      {
        kind: "settings",
        fileName: "settings.snapshot.json",
        sha256: await sha256Hex(settingsText),
        byteLength: byteLength(settingsText),
        rowCount: null,
      },
      {
        kind: "events",
        fileName: "events.jsonl",
        sha256: await sha256Hex(eventsText),
        byteLength: byteLength(eventsText),
        rowCount: null,
      },
    ];
    if (this.context.settings.output.csv) {
      const csv = samplesToCsv(samples);
      artifacts["ratings.csv"] = csv;
      outputs.push({ kind: "csv", fileName: "ratings.csv", sha256: await sha256Hex(csv), byteLength: byteLength(csv), rowCount: samples.length });
    }
    if (this.context.settings.output.tsv) {
      const tsv = samplesToTsv(samples);
      artifacts["ratings.tsv"] = tsv;
      outputs.push({ kind: "tsv", fileName: "ratings.tsv", sha256: await sha256Hex(tsv), byteLength: byteLength(tsv), rowCount: samples.length });
    }
    const manifest = validateResearchRunManifestV2({
      schema: RESEARCH_RUN_MANIFEST_SCHEMA,
      version: 2,
      runId: this.context.runId,
      experimentId: this.context.experimentId,
      participantId: this.context.participantId,
      participantCode: this.context.participant.participantCode,
      age: this.context.participant.age,
      gender: this.context.participant.gender,
      handedness: this.context.participant.handedness,
      attemptNumber: this.context.attemptNumber,
      sessionStem: this.context.sessionStem,
      completionStatus,
      playbackMode: "browserMediaAdapters",
      playbackQualification: "browser",
      settingsSha256: this.context.settingsHash,
      assignmentPlanSha256: this.context.planHash,
      stimuli: this.context.assignment.slots.map((slot) => stimulusIdentity(this.context.stimuliById.get(slot.stimulusId))),
      timing: {
        sampleRateHz: this.context.settings.experiment.samplingFrequencyHz,
        sampleCount: samples.length,
        eventCount: events.length,
        gapEventCount: events.filter(({ type }) => type === "timingGap").length,
        missedSlotCount: events.reduce((sum, event) => sum + (event.missedSlotCount ?? 0), 0),
        startedAt: this.context.startedAt,
        finalizedAt,
      },
      outputs,
      recovery,
      build: this.context.build,
    });
    artifacts["manifest.json"] = `${canonicalJson(manifest)}\n`;

      let files;
      try {
        files = await this.workspace.writeAttemptArtifacts(this.context.attemptDirectory, artifacts);
      } catch (error) {
        if (!this.context.finalizationRetry || error?.code !== "artifact-conflict") throw error;
        await this.workspace.quarantineIncompleteAttemptArtifacts(this.context.attemptDirectory);
        files = await this.workspace.writeAttemptArtifacts(this.context.attemptDirectory, artifacts);
      }
      const terminal = await this.journal.finalize({
        runId: this.context.runId,
        status: completionStatus === "completed" ? "complete" : "partial",
        manifest,
        finalizedAt,
      });
      const receipt = Object.freeze({
        runId: this.context.runId,
        logicalPath: `outputs/${this.context.experimentId}/${this.context.participantId}/${this.context.sessionStem}/`,
        files,
        settingsSha256: this.context.settingsHash,
        assignmentPlanSha256: this.context.planHash,
        sampleCount: samples.length,
        eventCount: events.length,
        completionStatus,
        manifest,
        terminal,
      });
      this.mode = "setup";
      this.context = null;
      this.#emitStatus();
      return receipt;
    } catch (error) {
      await this.journal.markInterrupted({
        runId: this.context.runId,
        reason: "output-write-failed",
        updatedAt: isoNow(this.now),
      }).catch(() => {});
      this.mode = "setup";
      this.context = null;
      this.#emitStatus();
      throw error;
    }
  }

  async #materializeProtocolFinalization(descriptor, samples, events) {
    const { completionStatus, finalizedAt, recovery } = descriptor;
    const attempt = await this.journal.getAttempt(this.context.runId);
    if (!attempt || !isProtocolAttemptVersion(attempt.version)
      || attempt.protocolPlanHash !== this.context.protocolPlanHash) {
      throw new TypeError("Questionnaire recovery evidence no longer binds the frozen protocol.");
    }
    const submittedResponses = await readAllQuestionnaireResponses(
      this.journal,
      this.context.runId,
    );
    const draftResponses = attempt.activeQuestionnaireDraft?.responses ?? [];
    const questionnaireResponses = [...submittedResponses, ...draftResponses];
    const settingsText = `${canonicalJson(this.context.settings)}\n`;
    const experimentSourceText = this.context.settings.version === 3
      ? this.context.experimentSourceText
      : null;
    const experimentPlanText = this.context.settings.version === 3
      ? `${canonicalJson(this.context.plan)}\n`
      : null;
    const protocolPlanText = `${canonicalJson(this.context.protocolPlan)}\n`;
    const eventsText = `${events.map((event) => canonicalJson(event)).join("\n")}\n`;
    const artifacts = {
      "settings.snapshot.json": settingsText,
      ...(experimentSourceText === null ? {} : { "experiment.json": experimentSourceText }),
      ...(experimentPlanText === null ? {} : { "experiment-plan.snapshot.json": experimentPlanText }),
      ...(this.context.experimentPackage
        ? { "experiment.package.json": this.context.experimentPackage.sourceText }
        : {}),
      "protocol-plan.snapshot.json": protocolPlanText,
      "events.jsonl": eventsText,
    };
    const outputs = [
      {
        kind: "settings",
        fileName: "settings.snapshot.json",
        sha256: await sha256Hex(settingsText),
        byteLength: byteLength(settingsText),
        rowCount: null,
      },
      ...(experimentSourceText === null ? [] : [
        {
          kind: "experimentSource",
          fileName: "experiment.json",
          sha256: await sha256Hex(experimentSourceText),
          byteLength: byteLength(experimentSourceText),
          rowCount: null,
        },
        {
          kind: "experimentPlan",
          fileName: "experiment-plan.snapshot.json",
          sha256: await sha256Hex(experimentPlanText),
          byteLength: byteLength(experimentPlanText),
          rowCount: null,
        },
      ]),
      ...(this.context.experimentPackage ? [{
        kind: "experimentPackage",
        fileName: "experiment.package.json",
        sha256: this.context.experimentPackage.sourceByteSha256,
        byteLength: byteLength(this.context.experimentPackage.sourceText),
        rowCount: null,
      }] : []),
      {
        kind: "protocolPlan",
        fileName: "protocol-plan.snapshot.json",
        sha256: await sha256Hex(protocolPlanText),
        byteLength: byteLength(protocolPlanText),
        rowCount: null,
      },
      {
        kind: "events",
        fileName: "events.jsonl",
        sha256: await sha256Hex(eventsText),
        byteLength: byteLength(eventsText),
        rowCount: null,
      },
    ];
    if (this.context.settings.output.csv) {
      const ratingsCsv = samplesToCsv(samples);
      const questionnaireCsv = questionnaireResponsesToCsv(questionnaireResponses);
      artifacts["ratings.csv"] = ratingsCsv;
      artifacts["questionnaire-responses.csv"] = questionnaireCsv;
      outputs.push(
        {
          kind: "ratingsCsv",
          fileName: "ratings.csv",
          sha256: await sha256Hex(ratingsCsv),
          byteLength: byteLength(ratingsCsv),
          rowCount: samples.length,
        },
        {
          kind: "questionnaireCsv",
          fileName: "questionnaire-responses.csv",
          sha256: await sha256Hex(questionnaireCsv),
          byteLength: byteLength(questionnaireCsv),
          rowCount: questionnaireResponses.length,
        },
      );
    }
    if (this.context.settings.output.tsv) {
      const ratingsTsv = samplesToTsv(samples);
      const questionnaireTsv = questionnaireResponsesToTsv(questionnaireResponses);
      artifacts["ratings.tsv"] = ratingsTsv;
      artifacts["questionnaire-responses.tsv"] = questionnaireTsv;
      outputs.push(
        {
          kind: "ratingsTsv",
          fileName: "ratings.tsv",
          sha256: await sha256Hex(ratingsTsv),
          byteLength: byteLength(ratingsTsv),
          rowCount: samples.length,
        },
        {
          kind: "questionnaireTsv",
          fileName: "questionnaire-responses.tsv",
          sha256: await sha256Hex(questionnaireTsv),
          byteLength: byteLength(questionnaireTsv),
          rowCount: questionnaireResponses.length,
        },
      );
    }

    const submittedByStep = new Map();
    for (const response of submittedResponses) {
      submittedByStep.set(
        response.protocolStepPosition,
        (submittedByStep.get(response.protocolStepPosition) ?? 0) + 1,
      );
    }
    const questionnaireModules = this.context.protocolPlan.steps
      .filter(({ kind }) => kind === "questionnaire")
      .map((step) => {
        const submittedCount = submittedByStep.get(step.protocolPosition) ?? 0;
        const wasSubmitted = step.protocolPosition <= attempt.safeProtocolStepPosition;
        const isDraft = attempt.activeProtocolStep?.kind === "questionnaire"
          && attempt.activeProtocolStep.protocolPosition === step.protocolPosition;
        return {
          protocolStepPosition: step.protocolPosition,
          moduleId: step.moduleId,
          questionnaireId: step.questionnaireId,
          definitionSha256: step.definitionSha256,
          status: wasSubmitted ? "submitted" : isDraft ? "draft" : "notReached",
          responseCount: wasSubmitted
            ? submittedCount
            : isDraft ? draftResponses.length : 0,
        };
      });
    const protocol = {
      safeProtocolStepPosition: attempt.safeProtocolStepPosition,
      protocolStepCount: this.context.protocolPlan.steps.length,
      questionnaireDefinitions: this.context.settings.questionnaires.definitions.map((definition) => ({
        questionnaireId: definition.questionnaireId,
        definitionSha256: definition.definitionSha256,
      })),
      questionnaireModules,
      submittedResponseCount: submittedResponses.length,
      draftResponseCount: draftResponses.length,
      submittedResponsesSha256: await canonicalSha256(submittedResponses),
      draftResponsesSha256: await canonicalSha256(draftResponses),
    };
    const manifestFields = {
      runId: this.context.runId,
      experimentId: this.context.experimentId,
      participantId: this.context.participantId,
      participantCode: this.context.participant.participantCode,
      age: this.context.participant.age,
      gender: this.context.participant.gender,
      handedness: this.context.participant.handedness,
      attemptNumber: this.context.attemptNumber,
      sessionStem: this.context.sessionStem,
      completionStatus,
      playbackMode: "browserMediaAdapters",
      playbackQualification: "browser",
      settingsSha256: this.context.settingsHash,
      assignmentPlanSha256: this.context.planHash,
      protocolPlanSha256: this.context.protocolPlanHash,
      stimuli: this.context.assignment.slots.map((slot) => (
        stimulusIdentity(this.context.stimuliById.get(slot.stimulusId))
      )),
      protocol,
      timing: {
        sampleRateHz: this.context.settings.experiment.samplingFrequencyHz,
        sampleCount: samples.length,
        eventCount: events.length,
        gapEventCount: events.filter(({ type }) => type === "timingGap").length,
        missedSlotCount: events.reduce((sum, event) => sum + (event.missedSlotCount ?? 0), 0),
        questionnaireSubmittedResponseCount: submittedResponses.length,
        questionnaireDraftResponseCount: draftResponses.length,
        startedAt: this.context.startedAt,
        finalizedAt,
      },
      outputs,
      recovery,
      build: this.context.build,
    };
    const manifest = this.context.experimentPackage
      ? validateResearchRunManifestV4({
        schema: RESEARCH_RUN_MANIFEST_V4_SCHEMA,
        version: 4,
        ...manifestFields,
        experimentPackage: {
          canonicalSourceByteSha256: this.context.experimentPackage.sourceByteSha256,
          packageDefinitionSha256: this.context.experimentPackage.packageDefinitionSha256,
          packageId: this.context.experimentPackage.packageId,
          languageId: this.context.experimentPackage.languageId,
          languageSelectionPath: [...this.context.experimentPackage.languageSelectionPath],
          assignmentSha256: this.context.experimentPackage.assignmentSha256,
          assetBindingsSha256: await canonicalSha256(
            this.context.experimentPackage.assetBindings,
          ),
        },
      })
      : validateResearchRunManifestV3({
        schema: RESEARCH_RUN_MANIFEST_V3_SCHEMA,
        version: 3,
        ...manifestFields,
      });
    artifacts["manifest.json"] = `${canonicalJson(manifest)}\n`;

    let files;
    try {
      files = await this.workspace.writeAttemptArtifacts(this.context.attemptDirectory, artifacts);
    } catch (error) {
      if (!this.context.finalizationRetry || error?.code !== "artifact-conflict") throw error;
      await this.workspace.quarantineIncompleteAttemptArtifacts(this.context.attemptDirectory);
      files = await this.workspace.writeAttemptArtifacts(this.context.attemptDirectory, artifacts);
    }
    const terminal = await this.journal.finalizeProtocol({
      runId: this.context.runId,
      status: completionStatus === "completed" ? "complete" : "partial",
      manifest,
      finalizedAt,
    });
    const receipt = Object.freeze({
      runId: this.context.runId,
      logicalPath: `outputs/${this.context.experimentId}/${this.context.participantId}/${this.context.sessionStem}/`,
      files,
      settingsSha256: this.context.settingsHash,
      assignmentPlanSha256: this.context.planHash,
      ...(this.context.experimentPackage
        ? { assignmentSha256: this.context.experimentPackage.assignmentSha256 }
        : {}),
      protocolPlanSha256: this.context.protocolPlanHash,
      sampleCount: samples.length,
      eventCount: events.length,
      questionnaireResponseCount: questionnaireResponses.length,
      completionStatus,
      manifest,
      terminal,
    });
    this.mode = "setup";
    this.context = null;
    this.#emitStatus();
    return receipt;
  }

  #currentStimulus() {
    const slot = this.context.assignment.slots[this.context.activeStimulusIndex];
    return slot ? this.context.stimuliById.get(slot.stimulusId) : null;
  }

  #questionnaireDefinition(step) {
    const definition = this.context.settings.questionnaires.definitions.find(({ questionnaireId }) => (
      questionnaireId === step.questionnaireId
    ));
    if (!definition || definition.definitionSha256 !== step.definitionSha256) {
      throw new TypeError("The frozen questionnaire definition differs from its protocol step.");
    }
    return definition;
  }

  #elapsedMs() {
    return this.context.elapsedOffsetMs
      + Math.max(0, this.monotonicNow() - this.context.startedMonotonicMs);
  }

  #questionnaireAnswerRecords(value) {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("Questionnaire answers must be an item-to-option object.");
    }
    const step = this.context.activeProtocolStep;
    const definition = this.#questionnaireDefinition(step);
    const knownItems = new Set(definition.items.map(({ itemId }) => itemId));
    const unknown = Object.keys(value).find((itemId) => !knownItems.has(itemId));
    if (unknown) throw new TypeError(`Questionnaire answers contain unknown item ${unknown}.`);
    const previous = new Map(this.context.questionnaireAnswerEvidence.map((answer) => [
      answer.itemId,
      answer,
    ]));
    const elapsedMs = this.#elapsedMs();
    const openedAt = this.context.questionnaireOpenedElapsedMs ?? elapsedMs;
    return definition.items.flatMap(({ itemId }) => {
      if (!Object.hasOwn(value, itemId)) return [];
      const optionId = value[itemId];
      const prior = previous.get(itemId);
      if (prior?.optionId === optionId) return [structuredClone(prior)];
      return [{
        itemId,
        optionId,
        wallTimeUtc: isoNow(this.now),
        monotonicTimeNs: monotonicNs(elapsedMs),
        responseLatencyMs: Math.max(0, elapsedMs - openedAt),
      }];
    });
  }

  #assertRunning() {
    if (this.mode !== "run" || !this.context || !this.workerReady) throw new Error("No Research run is active.");
  }

  #assertActiveStimulus() {
    this.#assertRunning();
    if (this.context.activeStimulusIndex === null) throw new Error("No stimulus is active.");
    if (this.context.protocolAware && this.context.activeProtocolStep?.kind !== "stimulus") {
      throw new Error("The active protocol step is not a stimulus.");
    }
  }

  #assertProtocolRun() {
    this.#assertRunning();
    if (!this.context.protocolAware) {
      throw new Error("This historical attempt has no questionnaire protocol sequence.");
    }
  }

  #assertActiveQuestionnaire() {
    this.#assertProtocolRun();
    if (this.context.activeProtocolStep?.kind !== "questionnaire") {
      throw new Error("No questionnaire protocol step is active.");
    }
  }

  #emitStatus() {
    this.dispatchEvent(new CustomEvent("statuschange", { detail: this.snapshot() }));
  }
}

export { detectBrowserPlatform, stimulusIdentity };

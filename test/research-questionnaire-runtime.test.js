import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { canonicalSha256 } from "../site/src/research/canonical.js";
import { MemoryResearchJournal } from "../site/src/research/browser-journal.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { resolveAssignmentPlan } from "../site/src/research/counterbalancer.js";
import {
  QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
  projectResearchSettingsV2ToAssignmentSettingsV1,
  resolveProtocolPlanV1,
  validateResearchSettingsV2,
} from "../site/src/research/protocol-plan.js";
import {
  validateResearchEventV2,
  validateResearchRunManifestV3,
} from "../site/src/research/protocol-records.js";
import { BrowserResearchRunController } from "../site/src/research/run-controller.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/app.js";
import { BrowserResearchRuntimeBridge } from "../site/src/research/runtime-bridge.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const PREFLIGHT = Object.freeze({
  inputTestPassed: true,
  verifiedStimulusIds: ["video-1"],
  directoryPermission: true,
  indexedDbReady: true,
  timingWorkerReady: true,
  storageReady: true,
  manifestReady: true,
});

async function questionnaireDefinition({ itemRequirements = [true, true] } = {}) {
  const definition = {
    schema: "affect-research-questionnaire-definition",
    version: 1,
    questionnaireId: "brief-check-in",
    questionnaireVersion: "1.0",
    title: "Brief check-in",
    language: "en",
    instructions: "Choose one response for every item.",
    attribution: "Project-authored questionnaire runtime fixture.",
    source: {
      kind: "researcherCsv",
      logicalName: "brief-check-in.csv",
      sourceDocumentSha256: null,
      formatVersion: "questionnaire-csv-v1",
      byteLength: 256,
      sha256: digest("brief-check-in-source"),
    },
    items: [
      {
        itemId: "item-01",
        order: 1,
        prompt: "How calm do you feel?",
        required: itemRequirements[0],
        subscale: "calm",
        options: [
          { optionId: "low", order: 1, label: "Low", scoreValue: 0 },
          { optionId: "high", order: 2, label: "High", scoreValue: 4 },
        ],
      },
      {
        itemId: "item-02",
        order: 2,
        prompt: "How alert do you feel?",
        required: itemRequirements[1],
        subscale: "alert",
        options: [
          { optionId: "low", order: 1, label: "Low", scoreValue: 0 },
          { optionId: "high", order: 2, label: "High", scoreValue: 4 },
        ],
      },
    ],
    definitionSha256: "0".repeat(64),
  };
  definition.definitionSha256 = await canonicalSha256(definition, {
    omitRootKeys: ["definitionSha256"],
  });
  return definition;
}

function questionnaireModule(moduleId, definition, kind, poolId = null) {
  return {
    schema: "affect-research-questionnaire-module",
    version: 1,
    moduleId,
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
    placement: { kind, poolId },
  };
}

async function protocolFixture({ itemRequirements = [true, true] } = {}) {
  const definition = await questionnaireDefinition({ itemRequirements });
  const rawSettings = structuredClone(createDefaultResearchSettings());
  rawSettings.version = 2;
  rawSettings.experiment.participantCount = 1;
  rawSettings.output.tsv = true;
  rawSettings.stimuli.items = [{
    stimulusId: "video-1",
    title: "Video One",
    source: {
      kind: "workspaceFile",
      relativePath: "stimuli/video-one.mp4",
      mimeType: "video/mp4",
      sha256: digest("video-one"),
      byteLength: 1_024,
      durationMs: 2_000,
    },
  }];
  rawSettings.stimuli.pools = [{
    poolId: "all-videos",
    label: "All videos",
    videosPerParticipant: 1,
    stimulusIds: ["video-1"],
  }];
  rawSettings.questionnaires = {
    algorithmVersion: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    definitions: [definition],
    modules: [
      questionnaireModule("before-session", definition, "beforeSession"),
      questionnaireModule("before-block", definition, "beforeBlock", "all-videos"),
      questionnaireModule("after-block", definition, "afterBlock", "all-videos"),
      questionnaireModule("after-session", definition, "afterSession"),
    ],
  };
  const settings = await validateResearchSettingsV2(rawSettings);
  const assignmentSettings = await projectResearchSettingsV2ToAssignmentSettingsV1(settings);
  const plan = await resolveAssignmentPlan(assignmentSettings);
  const protocolPlan = await resolveProtocolPlanV1(settings, plan, "P001");
  return { settings, plan, protocolPlan };
}

class QuestionnaireSamplingWorker extends EventTarget {
  constructor() {
    super();
    this.messages = [];
    this.sessionToken = null;
    this.state = null;
    this.stimulus = null;
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(structuredClone(message));
    if (message.type === "configure") {
      this.sessionToken = message.sessionToken;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
        type: "ready",
        sessionToken: message.sessionToken,
        samplingFrequencyHz: message.samplingFrequencyHz,
        clockDomain: "controller-performance-v1",
        controllerTimeOriginMs: message.controllerTimeOriginMs,
        workerTimeOriginMs: message.controllerTimeOriginMs + 100,
        clockOffsetMs: 100,
      } })));
    }
    if (message.type === "state") this.state = structuredClone(message.state);
    if (message.type === "stimulus-start") this.stimulus = structuredClone(message);
    if (["stimulus-start", "stimulus-stop", "pause", "resume", "stop"].includes(message.type)) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: {
        type: "ack",
        commandType: message.type,
        commandId: message.commandId,
        sessionToken: message.sessionToken,
        stimulusEpoch: message.stimulusEpoch,
        stimulusIndex: message.stimulusIndex,
        stimulusId: message.stimulusId,
      } })));
    }
  }

  emitSample({ sequence = 1, scheduledMonotonicMs, observedMonotonicMs, wallTimeUtc }) {
    const state = this.state;
    this.dispatchEvent(new MessageEvent("message", { data: {
      type: "sample",
      sessionToken: this.sessionToken,
      sample: {
        sequence,
        stimulusIndex: this.stimulus.stimulusIndex,
        stimulusId: this.stimulus.stimulusId,
        stimulusEpoch: this.stimulus.stimulusEpoch,
        stimulusTimeMs: 500,
        wallTimeUtc,
        scheduledMonotonicMs,
        observedMonotonicMs,
        latenessMs: observedMonotonicMs - scheduledMonotonicMs,
        anchorAgeMs: 1,
        samplingFrequencyHz: 130,
        currentValence: state.currentValence,
        currentArousal: state.currentArousal,
        targetValence: state.targetValence,
        targetArousal: state.targetArousal,
        radius: Math.hypot(state.currentValence, state.currentArousal),
        angleDegrees: 0,
        animationActive: state.animationActive,
        inputActive: state.inputActive,
        mappingValues: state.mappingValues,
      },
    } }));
  }

  terminate() { this.terminated = true; }
}

function runtimeHarness(journal = new MemoryResearchJournal()) {
  let wall = Date.parse("2026-09-08T14:30:12.482Z");
  let monotonic = 0;
  let uuid = 1;
  const workers = [];
  const workspace = {
    workspaceId: WORKSPACE_ID,
    artifacts: null,
    async createAttemptDirectory() { return { kind: "directory", name: "attempt" }; },
    async openAttemptDirectory() { return { kind: "directory", name: "attempt" }; },
    async writeAttemptArtifacts(_directory, artifacts) {
      this.artifacts = structuredClone(artifacts);
      return Object.freeze(Object.keys(artifacts));
    },
    async quarantineIncompleteAttemptArtifacts() { return []; },
  };
  const clock = {
    tick(milliseconds = 10) {
      wall += milliseconds;
      monotonic += milliseconds;
      return monotonic;
    },
    wallTimeUtc() { return new Date(wall).toISOString(); },
    monotonic() { return monotonic; },
  };
  const controller = () => new BrowserResearchRunController({
    journal,
    workspace,
    workerFactory: () => {
      const worker = new QuestionnaireSamplingWorker();
      workers.push(worker);
      return worker;
    },
    cryptoObject: {
      randomUUID: () => `00000000-0000-4000-8000-${String(uuid++).padStart(12, "0")}`,
    },
    platform: "chrome",
    now: () => wall,
    monotonicNow: () => monotonic,
    flushIntervalMs: 1_000_000,
  });
  return { journal, workspace, clock, workers, controller };
}

async function startProtocol(controller, fixture) {
  await controller.initialize();
  return controller.start({
    ...fixture,
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    attemptNumber: 1,
    preflight: PREFLIGHT,
  });
}

async function submitActiveQuestionnaire(controller, clock, answers = {
  "item-01": "high",
  "item-02": "low",
}) {
  clock.tick();
  const opened = await controller.beginQuestionnaireStep();
  assert.equal(opened.step.kind, "questionnaire");
  assert.throws(
    () => controller.updateAffect({ currentValence: 0, currentArousal: 0 }),
    /disabled outside an active stimulus/u,
  );
  clock.tick();
  await controller.checkpointQuestionnaireDraft({ "item-01": answers["item-01"] });
  clock.tick();
  return controller.submitQuestionnaire(answers);
}

test("questionnaire protocol runs before session, around a block, and after session without sampling forms", async () => {
  const fixture = await protocolFixture();
  const harness = runtimeHarness();
  const controller = harness.controller();
  const runtimeErrors = [];
  controller.addEventListener("runtimeerror", ({ detail }) => runtimeErrors.push(detail));
  const started = await startProtocol(controller, fixture);

  assert.deepEqual(
    fixture.protocolPlan.steps.map((step) => step.kind === "questionnaire" ? step.moduleId : step.kind),
    ["before-session", "before-block", "stimulus", "after-block", "after-session"],
  );
  assert.equal(started.safeProtocolStepPosition, 0);
  assert.equal(harness.workers[0].messages.some(({ type }) => type === "stimulus-start"), false);

  await submitActiveQuestionnaire(controller, harness.clock);
  assert.equal((await harness.journal.readRecords(started.runId, { kind: "samples" })).length, 0);
  await submitActiveQuestionnaire(controller, harness.clock);
  assert.equal(harness.workers[0].messages.some(({ type }) => type === "stimulus-start"), false);

  harness.clock.tick();
  await controller.startStimulus(0);
  assert.equal(harness.workers[0].messages.filter(({ type }) => type === "stimulus-start").length, 1);
  harness.clock.tick();
  controller.updateAffect({
    currentValence: 0.5,
    currentArousal: 0,
    inputActive: true,
    mediaTimeMs: 500,
  });
  const sampleTime = harness.clock.tick();
  harness.workers[0].emitSample({
    scheduledMonotonicMs: sampleTime - 1,
    observedMonotonicMs: sampleTime,
    wallTimeUtc: harness.clock.wallTimeUtc(),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runtimeErrors, []);
  await controller.flush();
  harness.clock.tick();
  await controller.completeStimulus(2_000);

  await submitActiveQuestionnaire(controller, harness.clock, {
    "item-01": "low",
    "item-02": "high",
  });
  await submitActiveQuestionnaire(controller, harness.clock, {
    "item-01": "low",
    "item-02": "low",
  });
  assert.equal(controller.nextProtocolStep(), null);
  harness.clock.tick();
  const receipt = await controller.complete();

  assert.equal(receipt.completionStatus, "completed");
  assert.equal(receipt.sampleCount, 1);
  assert.equal(receipt.questionnaireResponseCount, 8);
  assert.equal(receipt.protocolPlanSha256, fixture.protocolPlan.protocolPlanHashSha256);
  assert.deepEqual(validateResearchRunManifestV3(receipt.manifest), receipt.manifest);
  assert.deepEqual(
    receipt.manifest.protocol.questionnaireModules.map(({ moduleId, status, responseCount }) => ({
      moduleId, status, responseCount,
    })),
    [
      { moduleId: "before-session", status: "submitted", responseCount: 2 },
      { moduleId: "before-block", status: "submitted", responseCount: 2 },
      { moduleId: "after-block", status: "submitted", responseCount: 2 },
      { moduleId: "after-session", status: "submitted", responseCount: 2 },
    ],
  );
  const events = await harness.journal.readRecords(started.runId, { kind: "events" });
  assert.deepEqual(events.map(validateResearchEventV2), events);
  assert.equal(events.filter(({ type }) => type === "questionnaireCompleted").length, 4);
  assert.equal(events.filter(({ type }) => type === "stimulusStarted").length, 1);
  assert.equal(events.filter(({ type }) => type === "stimulusCompleted").length, 1);
  assert.match(harness.workspace.artifacts["protocol-plan.snapshot.json"], /brief-check-in/u);
  assert.equal(harness.workspace.artifacts["ratings.csv"].split("\r\n").length,
    harness.workspace.artifacts["ratings.tsv"].split("\r\n").length);
  assert.equal(harness.workspace.artifacts["questionnaire-responses.csv"].split("\r\n").length,
    harness.workspace.artifacts["questionnaire-responses.tsv"].split("\r\n").length);
  assert.equal((await harness.journal.getAttempt(started.runId)).status, "complete");
});

test("all-optional modules finalize as submitted with a canonical empty response table", async () => {
  const fixture = await protocolFixture({ itemRequirements: [false, false] });
  const harness = runtimeHarness();
  const controller = harness.controller();
  await startProtocol(controller, fixture);

  for (let index = 0; index < 2; index += 1) {
    harness.clock.tick();
    await controller.beginQuestionnaireStep();
    harness.clock.tick();
    await controller.submitQuestionnaire({});
  }
  harness.clock.tick();
  await controller.startStimulus(0);
  harness.clock.tick();
  await controller.completeStimulus(2_000);
  for (let index = 0; index < 2; index += 1) {
    harness.clock.tick();
    await controller.beginQuestionnaireStep();
    harness.clock.tick();
    await controller.submitQuestionnaire({});
  }
  harness.clock.tick();
  const receipt = await controller.complete();

  assert.equal(receipt.questionnaireResponseCount, 0);
  assert.deepEqual(
    receipt.manifest.protocol.questionnaireModules.map(({ status, responseCount }) => ({
      status, responseCount,
    })),
    Array.from({ length: 4 }, () => ({ status: "submitted", responseCount: 0 })),
  );
  assert.match(harness.workspace.artifacts["questionnaire-responses.csv"], /^schema,version,/u);
  assert.equal(harness.workspace.artifacts["questionnaire-responses.csv"].split("\r\n").length, 2);
});

test("an interrupted questionnaire restores its durable draft, then a controlled stop finalizes later draft evidence", async () => {
  const fixture = await protocolFixture();
  const harness = runtimeHarness();
  const first = harness.controller();
  const started = await startProtocol(first, fixture);

  harness.clock.tick();
  await first.beginQuestionnaireStep();
  harness.clock.tick();
  const drafted = await first.checkpointQuestionnaireDraft({ "item-01": "high" });
  const originalEvidence = drafted.answerEvidence[0];
  harness.clock.tick();
  const interrupted = await first.interrupt("forced-termination");
  assert.equal(interrupted.interruption.interruptedProtocolStepKind, "questionnaire");
  assert.equal(interrupted.activeQuestionnaireDraft.responses.length, 1);
  assert.equal((await harness.journal.readRecords(started.runId, { kind: "samples" })).length, 0);

  const resumedController = harness.controller();
  harness.clock.tick();
  await resumedController.initialize();
  const resumed = await resumedController.resume({ runId: started.runId });
  assert.equal(resumed.interruptedProtocolStepKind, "questionnaire");
  assert.equal(resumed.questionnaireDraftActive, true);
  const restored = await resumedController.beginQuestionnaireStep();
  assert.deepEqual(restored.answers, { "item-01": "high" });
  assert.deepEqual(restored.answerEvidence[0], originalEvidence);
  assert.throws(
    () => resumedController.queueInputEdge({ direction: "right", action: { kind: "keyboard", code: "ArrowRight" }, active: true }),
    /disabled outside an active stimulus/u,
  );

  harness.clock.tick();
  await resumedController.submitQuestionnaire({
    "item-01": "high",
    "item-02": "low",
  });
  const submitted = await harness.journal.readQuestionnaireResponses(started.runId);
  assert.equal(submitted[0].monotonicTimeNs, originalEvidence.monotonicTimeNs,
    "an unchanged recovered answer retains its original response evidence");

  harness.clock.tick();
  await resumedController.beginQuestionnaireStep();
  harness.clock.tick();
  await resumedController.checkpointQuestionnaireDraft({ "item-01": "low" });
  harness.clock.tick();
  const receipt = await resumedController.stopEarly("operator-stop");

  assert.equal(receipt.completionStatus, "partial");
  assert.equal(receipt.sampleCount, 0);
  assert.equal(receipt.questionnaireResponseCount, 3);
  assert.equal(receipt.manifest.recovery.resumed, true);
  assert.equal(receipt.manifest.recovery.sourceRunId, started.runId);
  assert.deepEqual(
    receipt.manifest.protocol.questionnaireModules.map(({ status, responseCount }) => ({ status, responseCount })),
    [
      { status: "submitted", responseCount: 2 },
      { status: "draft", responseCount: 1 },
      { status: "notReached", responseCount: 0 },
      { status: "notReached", responseCount: 0 },
    ],
  );
  assert.equal(receipt.manifest.protocol.safeProtocolStepPosition, 1);
  assert.equal((await harness.journal.getAttempt(started.runId)).recoverable, false);
  assert.deepEqual(
    (await harness.journal.readQuestionnaireResponses(started.runId)).map(({ status }) => status),
    ["submitted", "submitted", "draft"],
  );
  assert.equal((await harness.journal.readRecords(started.runId, { kind: "samples" })).length, 0,
    "no canonical rating rows are created while questionnaire forms are active");
});

test("an interrupted protocol video restarts from its durable protocol boundary rather than mid-video", async () => {
  const fixture = await protocolFixture();
  const harness = runtimeHarness();
  const first = harness.controller();
  const started = await startProtocol(first, fixture);
  await submitActiveQuestionnaire(first, harness.clock);
  await submitActiveQuestionnaire(first, harness.clock);

  harness.clock.tick();
  await first.startStimulus(0);
  const firstSampleTime = harness.clock.tick();
  harness.workers[0].emitSample({
    scheduledMonotonicMs: firstSampleTime - 1,
    observedMonotonicMs: firstSampleTime,
    wallTimeUtc: harness.clock.wallTimeUtc(),
  });
  await first.flush();
  harness.clock.tick();
  const partial = await first.interrupt("forced-termination");
  assert.equal(partial.safeProtocolStepPosition, 2);
  assert.equal(partial.safeStimulusIndex, 0);
  assert.equal(partial.interruption.interruptedProtocolStepKind, "stimulus");
  assert.equal(partial.interruption.interruptedProtocolStepPosition, 3);
  assert.deepEqual(partial.context.restartedStimulusIds, []);

  const resumedController = harness.controller();
  harness.clock.tick();
  await resumedController.initialize();
  const resumed = await resumedController.resume({ runId: started.runId });
  assert.equal(resumed.safeProtocolStepPosition, 2);
  assert.equal(resumed.safeStimulusIndex, 0);
  assert.equal(resumed.activeProtocolStep, null);
  assert.equal(resumed.interruptedProtocolStepKind, "stimulus");
  assert.deepEqual(resumedController.nextProtocolStep(), fixture.protocolPlan.steps[2]);

  harness.clock.tick();
  await resumedController.startStimulus(0);
  assert.equal(harness.workers[1].stimulus.stimulusIndex, 0,
    "the restarted worker begins the complete stimulus at assignment index zero");
  harness.clock.tick();
  await resumedController.completeStimulus(2_000);
  await submitActiveQuestionnaire(resumedController, harness.clock);
  await submitActiveQuestionnaire(resumedController, harness.clock);
  harness.clock.tick();
  const receipt = await resumedController.complete();

  assert.equal(receipt.completionStatus, "completed");
  assert.equal(receipt.sampleCount, 1,
    "accepted pre-crash evidence remains explicit instead of being silently rewritten");
  assert.deepEqual(receipt.manifest.recovery.restartedStimulusIds, ["video-1"]);
  const events = await harness.journal.readRecords(started.runId, { kind: "events" });
  assert.equal(events.filter(({ type }) => type === "stimulusStarted").length, 2);
  assert.equal(events.filter(({ type }) => type === "stimulusCompleted").length, 1);
});

test("protocol records reject unknown V2/V3 fields instead of reinterpreting them", async () => {
  const fixture = await protocolFixture();
  const harness = runtimeHarness();
  const controller = harness.controller();
  await startProtocol(controller, fixture);
  await submitActiveQuestionnaire(controller, harness.clock);
  const event = (await harness.journal.readRecords(controller.snapshot().runId, { kind: "events" }))[0];
  assert.throws(() => validateResearchEventV2({ ...event, futureMeaning: true }), /unknown field/u);
  await controller.stopEarly("contract-test-stop");
  const manifest = JSON.parse(harness.workspace.artifacts["manifest.json"]);
  assert.throws(() => validateResearchRunManifestV3({ ...manifest, futureMeaning: true }), /unknown field/u);
});

test("ManifestV3 rejects cross-runtime identity, boundary, count, and output collisions", async () => {
  const fixture = await protocolFixture();
  const harness = runtimeHarness();
  const controller = harness.controller();
  await startProtocol(controller, fixture);
  await submitActiveQuestionnaire(controller, harness.clock);
  const receipt = await controller.stopEarly("manifest-hardening-test");
  const manifest = receipt.manifest;
  assert.deepEqual(validateResearchRunManifestV3(manifest), manifest);

  const definitionMismatch = structuredClone(manifest);
  definitionMismatch.protocol.questionnaireModules[0].definitionSha256 = "f".repeat(64);
  assert.throws(
    () => validateResearchRunManifestV3(definitionMismatch),
    /not bound to a declared definition/u,
  );

  const moduleBeyondPlan = structuredClone(manifest);
  moduleBeyondPlan.protocol.questionnaireModules.at(-1).protocolStepPosition = 6;
  assert.throws(
    () => validateResearchRunManifestV3(moduleBeyondPlan),
    /position exceeds its plan/u,
  );

  const unsafePastBoundary = structuredClone(manifest);
  unsafePastBoundary.protocol.questionnaireModules[0].status = "notReached";
  unsafePastBoundary.protocol.questionnaireModules[0].responseCount = 0;
  assert.throws(
    () => validateResearchRunManifestV3(unsafePastBoundary),
    /before the safe boundary must be submitted/u,
  );

  const submittedBeyondBoundary = structuredClone(manifest);
  submittedBeyondBoundary.protocol.questionnaireModules[1].status = "submitted";
  assert.throws(
    () => validateResearchRunManifestV3(submittedBeyondBoundary),
    /beyond the safe boundary cannot be submitted/u,
  );

  const misplacedDraft = structuredClone(manifest);
  misplacedDraft.protocol.questionnaireModules[2].status = "draft";
  assert.throws(
    () => validateResearchRunManifestV3(misplacedDraft),
    /draft must occupy the next unsafe protocol step/u,
  );

  const duplicateOutputName = structuredClone(manifest);
  duplicateOutputName.outputs[1].fileName = duplicateOutputName.outputs[0].fileName;
  assert.throws(
    () => validateResearchRunManifestV3(duplicateOutputName),
    /file names must be unique/u,
  );

  const excessiveAttempt = structuredClone(manifest);
  excessiveAttempt.attemptNumber = 1_000_000;
  assert.throws(() => validateResearchRunManifestV3(excessiveAttempt), /1–999999/u);

  const excessiveMissedSlots = structuredClone(manifest);
  excessiveMissedSlots.timing.missedSlotCount = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => validateResearchRunManifestV3(excessiveMissedSlots), /integer within/u);

  const excessiveParticipant = structuredClone(manifest);
  excessiveParticipant.participantId = "P100001";
  assert.throws(() => validateResearchRunManifestV3(excessiveParticipant), /P-prefixed/u);

  const dottedStimulus = structuredClone(manifest);
  dottedStimulus.stimuli[0].stimulusId = "video.1";
  assert.throws(() => validateResearchRunManifestV3(dottedStimulus), /safe identifier/u);

  const fractionalDuration = structuredClone(manifest);
  fractionalDuration.stimuli[0].durationMs = 2_000.5;
  assert.throws(() => validateResearchRunManifestV3(fractionalDuration), /must be an integer/u);

  const canonicalYouTube = structuredClone(manifest);
  canonicalYouTube.stimuli[0] = {
    kind: "youtube",
    stimulusId: "youtube-1",
    sha256: null,
    byteLength: null,
    durationMs: 2_000,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoId: "dQw4w9WgXcQ",
  };
  assert.doesNotThrow(() => validateResearchRunManifestV3(canonicalYouTube));
  canonicalYouTube.stimuli[0].url = "https://youtu.be/dQw4w9WgXcQ";
  assert.throws(
    () => validateResearchRunManifestV3(canonicalYouTube),
    /noncanonical YouTube URL or video ID/u,
  );
});

test("browser UI questionnaire draft and submit events stay bound to the active frozen step", async () => {
  class RuntimeRoot extends EventTarget {
    constructor() {
      super();
      this.video = Object.assign(new EventTarget(), {
        currentTime: 0,
        hidden: true,
        pause() {},
        load() {},
        removeAttribute() {},
      });
      this.youtube = Object.assign(new EventTarget(), {
        hidden: true,
        inert: false,
        dataset: {},
        replaceChildren() {},
      });
      this.status = { textContent: "" };
      this.researchUi = {};
    }

    querySelector(selector) {
      if (selector === "#run-video") return this.video;
      if (selector === "#run-youtube-player") return this.youtube;
      if (selector === "#start-status") return this.status;
      return null;
    }
  }

  const frozen = {
    step: {
      kind: "questionnaire",
      protocolPosition: 1,
      moduleId: "before-session",
      questionnaireId: "brief-check-in",
      definitionSha256: "a".repeat(64),
    },
    module: { moduleId: "before-session" },
    definition: {
      questionnaireId: "brief-check-in",
      definitionSha256: "a".repeat(64),
      title: "Brief check-in",
    },
    answers: {},
  };
  const next = structuredClone(frozen);
  next.step.protocolPosition = 2;
  next.step.moduleId = "before-block";
  next.module.moduleId = "before-block";
  let current = frozen;
  const calls = [];
  const controller = new EventTarget();
  Object.assign(controller, {
    activeQuestionnaire: () => structuredClone(current),
    checkpointQuestionnaireDraft: async (answers) => { calls.push(["draft", structuredClone(answers)]); },
    submitQuestionnaire: async (answers) => {
      calls.push(["submit", structuredClone(answers)]);
      current = next;
    },
    nextProtocolStep: () => structuredClone(current.step),
    beginQuestionnaireStep: async () => structuredClone(current),
    interrupt: async () => {},
  });
  const root = new RuntimeRoot();
  const statuses = [];
  root.addEventListener(RESEARCH_UI_EVENTS.questionnaireStatus, ({ detail }) => statuses.push(detail));
  const journal = {
    async open() {},
    async auditAndQuarantine() { return []; },
    async reconcileAbandonedAttempts() { return []; },
    async close() {},
  };
  const bridge = new BrowserResearchRuntimeBridge(root, {
    journal,
    controllerFactory: () => controller,
    leaseFactory: async () => ({ release() {} }),
    workerProbe: async () => true,
    storageProbe: async () => ({ sufficient: true }),
    documentObject: null,
    windowObject: null,
  });
  await bridge.initialize();
  bridge.controller = controller;
  bridge.run = {
    protocolPlan: {},
    questionnaireActive: true,
    initialReady: false,
    transitionPending: false,
  };

  const detail = {
    moduleId: "before-session",
    questionnaireId: "brief-check-in",
    definitionSha256: "a".repeat(64),
    protocolStepPosition: 1,
    answers: { "item-01": "high" },
  };
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.questionnaireDraftRequest, {
    detail,
    cancelable: true,
  }));
  await new Promise((resolve) => setImmediate(resolve));
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.questionnaireSubmitRequest, {
    detail: { ...detail, answers: { "item-01": "high", "item-02": "low" }, complete: true },
    cancelable: true,
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ["draft", { "item-01": "high" }],
    ["submit", { "item-01": "high", "item-02": "low" }],
  ]);
  assert.deepEqual(statuses.map(({ active, moduleId }) => ({ active, moduleId })), [
    { active: false, moduleId: undefined },
    { active: true, moduleId: "before-block" },
  ]);
  bridge.destroy();
});

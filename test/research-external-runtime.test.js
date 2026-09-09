import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { RESEARCH_UI_EVENTS } from "../site/src/research/app.js";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { MemoryResearchJournal } from "../site/src/research/browser-journal.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import {
  EXTERNAL_ORDER_ALGORITHM_VERSION,
  parseExperimentDefinitionV1,
  resolveExternalExperimentPlanV1,
} from "../site/src/research/external-experiment.js";
import {
  QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
  resolveProtocolPlanV2,
  validateResearchSettingsV3,
} from "../site/src/research/external-protocol.js";
import {
  compileExperimentPackageSelectionV1,
  createExperimentPackageV1,
  createFlatLanguageSelectionV1,
  parseExperimentPackageV1,
  serializeExperimentPackageV1,
} from "../site/src/research/experiment-package.js";
import {
  validateResearchEventV2,
  validateResearchRunManifestV4,
} from "../site/src/research/protocol-records.js";
import { BrowserResearchRunController } from "../site/src/research/run-controller.js";
import { BrowserResearchRuntimeBridge } from "../site/src/research/runtime-bridge.js";
import { BrowserResearchWorkspace } from "../site/src/research/workspace.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const PREFLIGHT = Object.freeze({
  inputTestPassed: true,
  verifiedStimulusIds: ["calm-01", "active-01"],
  directoryPermission: true,
  indexedDbReady: true,
  timingWorkerReady: true,
  storageReady: true,
  manifestReady: true,
  packageReady: true,
});

class MemoryFileHandle {
  constructor(name, file) {
    this.kind = "file";
    this.name = name;
    this.file = file;
  }

  async getFile() { return this.file; }

  async createWritable() {
    const chunks = [];
    return {
      write: async (chunk) => chunks.push(chunk),
      close: async () => {
        this.file = new File(chunks, this.name, { type: "application/octet-stream" });
      },
      abort: async () => {},
    };
  }
}

class MemoryDirectoryHandle {
  constructor(name = "workspace") {
    this.kind = "directory";
    this.name = name;
    this.children = new Map();
  }

  async queryPermission() { return "granted"; }
  async requestPermission() { return "granted"; }

  async getDirectoryHandle(name, { create = false } = {}) {
    const current = this.children.get(name);
    if (current?.kind === "directory") return current;
    if (current || !create) throw Object.assign(new Error("Missing directory"), { name: "NotFoundError" });
    const directory = new MemoryDirectoryHandle(name);
    this.children.set(name, directory);
    return directory;
  }

  async getFileHandle(name, { create = false } = {}) {
    const current = this.children.get(name);
    if (current?.kind === "file") return current;
    if (current || !create) throw Object.assign(new Error("Missing file"), { name: "NotFoundError" });
    const handle = new MemoryFileHandle(name, new File([], name));
    this.children.set(name, handle);
    return handle;
  }

  async removeEntry(name) {
    if (!this.children.delete(name)) throw Object.assign(new Error("Missing entry"), { name: "NotFoundError" });
  }

  async *entries() { yield* this.children.entries(); }
}

async function externalProtocolFixture({ isiAfterMs = 2_500 } = {}) {
  const mediaBytes = new Map([
    ["calm-01", "package video bytes: calm-01"],
    ["active-01", "package video bytes: active-01"],
  ]);
  const source = new TextEncoder().encode(JSON.stringify({
    schema: "affect-research-experiment",
    version: 1,
    experimentId: "external-runtime",
    title: "External Runtime",
    stimuli: [
      {
        stimulusId: "calm-01",
        title: "Calm 01",
        relativePath: "stimuli/calm-01.mp4",
      },
      {
        stimulusId: "active-01",
        title: "Active 01",
        relativePath: "stimuli/active-01.mp4",
      },
    ],
    blocks: [{ blockId: "main", label: "Main" }],
    schedules: [{
      participantId: "P001",
      blocks: [{
        blockId: "main",
        videos: [
          { stimulusId: "calm-01", isiAfterMs },
          { stimulusId: "active-01", isiAfterMs: 0 },
        ],
      }],
    }],
  }));
  const parsed = await parseExperimentDefinitionV1(source);
  const stimuli = parsed.definition.stimuli.map((reference, index) => ({
    stimulusId: reference.stimulusId,
    title: reference.title,
    source: {
      kind: "workspaceFile",
      relativePath: reference.relativePath,
      mimeType: "video/mp4",
      sha256: digest(mediaBytes.get(reference.stimulusId)),
      byteLength: new TextEncoder().encode(mediaBytes.get(reference.stimulusId)).byteLength,
      durationMs: 2_000 + index * 1_000,
    },
  }));
  const defaults = createDefaultResearchSettings();
  const settings = await validateResearchSettingsV3({
    schema: defaults.schema,
    version: 3,
    experiment: {
      id: parsed.definition.experimentId,
      title: parsed.definition.title,
      participantCount: parsed.definition.schedules.length,
      samplingFrequencyHz: 130,
    },
    stimuli: { items: stimuli },
    input: defaults.input,
    visual: defaults.visual,
    advanced: defaults.advanced,
    output: { csv: true, tsv: true },
    questionnaires: {
      algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
      definitions: [],
      modules: [],
    },
    externalProtocol: {
      algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
      sourceByteSha256: parsed.sourceByteSha256,
      definitionSha256: parsed.definitionSha256,
      definition: parsed.definition,
    },
  });
  const settingsSha256 = await canonicalSha256(settings);
  const plan = await resolveExternalExperimentPlanV1(parsed, stimuli, settingsSha256);
  const protocolPlan = await resolveProtocolPlanV2(settings, plan, "P001");
  return { settings, plan, protocolPlan, experimentSourceText: parsed.sourceText, mediaBytes };
}

async function experimentPackageFixture(options = {}) {
  const external = await externalProtocolFixture(options);
  const definition = {
    schema: "affect-research-questionnaire-definition",
    version: 1,
    questionnaireId: "video-check",
    questionnaireVersion: "1.0",
    title: "Video check",
    language: "en",
    instructions: "Choose one response.",
    attribution: "Project-authored package runtime fixture.",
    source: {
      kind: "researcherCsv",
      logicalName: "video-check.csv",
      sourceDocumentSha256: null,
      formatVersion: "questionnaire-csv-v1",
      byteLength: 128,
      sha256: digest("video-check-source"),
    },
    items: [{
      itemId: "ready",
      order: 1,
      prompt: "Are you ready to continue?",
      required: true,
      subscale: null,
      options: [
        { optionId: "no", order: 1, label: "No", scoreValue: 0 },
        { optionId: "yes", order: 2, label: "Yes", scoreValue: 1 },
      ],
    }],
    definitionSha256: "0".repeat(64),
  };
  definition.definitionSha256 = await canonicalSha256(definition, {
    omitRootKeys: ["definitionSha256"],
  });
  const packageSettings = await validateResearchSettingsV3({
    ...structuredClone(external.settings),
    questionnaires: {
      algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
      definitions: [definition],
      modules: [
        {
          schema: "affect-research-questionnaire-module",
          version: 2,
          moduleId: "after-video-before-isi",
          questionnaireId: definition.questionnaireId,
          definitionSha256: definition.definitionSha256,
          placement: {
            kind: "afterStimulus",
            blockId: null,
            stimulusId: "calm-01",
            relativeToIsi: "before",
          },
        },
        {
          schema: "affect-research-questionnaire-module",
          version: 2,
          moduleId: "after-video-after-isi",
          questionnaireId: definition.questionnaireId,
          definitionSha256: definition.definitionSha256,
          placement: {
            kind: "afterStimulus",
            blockId: null,
            stimulusId: "calm-01",
            relativeToIsi: "after",
          },
        },
      ],
    },
  });
  const packageValue = await createExperimentPackageV1({
    packageId: "external-runtime-package",
    languageSelection: createFlatLanguageSelectionV1([
      {
        languageId: "en",
        languageTag: "en",
        label: "English",
        questionnaireModuleIds: [
          "after-video-before-isi",
          "after-video-after-isi",
        ],
      },
    ]),
    settings: packageSettings,
  });
  const sourceText = await serializeExperimentPackageV1(packageValue);
  const parsed = await parseExperimentPackageV1(new TextEncoder().encode(sourceText));
  const compiled = await compileExperimentPackageSelectionV1(packageValue, {
    languageId: "en",
    languageSelectionPath: ["en"],
    participantId: "P001",
  });
  return {
    settings: compiled.settings,
    plan: compiled.experimentPlan,
    protocolPlan: compiled.protocolPlan,
    experimentSourceText: compiled.experimentDocument.sourceText,
    experimentPackageBinding: {
      schema: "affect-research-experiment-package-run-binding",
      version: 1,
      sourceText,
      sourceByteSha256: parsed.canonicalSourceByteSha256,
      packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
      packageId: packageValue.packageId,
      languageId: compiled.languageId,
      languageSelectionPath: compiled.languageSelectionPath,
      assignmentSha256: compiled.assignmentSha256,
      assetBindings: compiled.assetBindings,
    },
    mediaBytes: external.mediaBytes,
  };
}

class ExternalProtocolSamplingWorker extends EventTarget {
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
    const radius = Math.hypot(state.currentValence, state.currentArousal);
    const angleDegrees = radius === 0
      ? 0
      : (Math.atan2(state.currentArousal, state.currentValence) * 180 / Math.PI + 360) % 360;
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
        radius,
        angleDegrees,
        animationActive: state.animationActive,
        inputActive: state.inputActive,
        mappingValues: state.mappingValues,
      },
    } }));
  }

  terminate() {
    this.terminated = true;
  }
}

function runtimeHarness() {
  let wall = Date.parse("2026-09-09T14:30:12.482Z");
  let monotonic = 0;
  let uuid = 1;
  const journal = new MemoryResearchJournal();
  const workers = [];
  const workspace = {
    workspaceId: WORKSPACE_ID,
    artifacts: null,
    async createAttemptDirectory() {
      return { kind: "directory", name: "attempt" };
    },
    async openAttemptDirectory() {
      return { kind: "directory", name: "attempt" };
    },
    async writeAttemptArtifacts(_directory, artifacts) {
      this.artifacts = structuredClone(artifacts);
      return Object.freeze(Object.keys(artifacts));
    },
    async quarantineIncompleteAttemptArtifacts() {
      return [];
    },
  };
  const clock = {
    tick(milliseconds = 10) {
      wall += milliseconds;
      monotonic += milliseconds;
      return monotonic;
    },
    wallTimeUtc() {
      return new Date(wall).toISOString();
    },
  };
  const createController = () => new BrowserResearchRunController({
    journal,
    workspace,
    workerFactory: () => {
      const worker = new ExternalProtocolSamplingWorker();
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
  return { journal, workspace, workers, clock, createController };
}

class BridgeProbeVideo extends EventTarget {
  constructor(durationSeconds) {
    super();
    this.duration = durationSeconds;
    this.videoWidth = 1_920;
    this.videoHeight = 1_080;
    this.readyState = 1;
    this._currentTime = 0;
    this.src = "";
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    this._currentTime = value;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }

  load() {
    if (this.src) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }

  pause() {}

  removeAttribute(name) {
    if (name === "src") this.src = "";
  }

  requestVideoFrameCallback(callback) {
    queueMicrotask(() => callback(0, { mediaTime: this.currentTime }));
    return 1;
  }
}

class BridgeRuntimeVideo extends EventTarget {
  constructor() {
    super();
    this.readyState = 1;
    this.currentTime = 0;
    this.hidden = true;
    this.src = "";
    this.playCalls = 0;
    this.pauseCalls = 0;
  }

  async play() {
    this.playCalls += 1;
  }

  pause() {
    this.pauseCalls += 1;
  }

  load() {}

  removeAttribute(name) {
    if (name === "src") this.src = "";
  }
}

class BridgeRuntimeDocument extends EventTarget {
  constructor(durationsSeconds) {
    super();
    this.baseURI = "https://example.test/research/";
    this.visibilityState = "visible";
    this.durationsSeconds = [...durationsSeconds];
    this.probeVideos = [];
  }

  createElement(name) {
    assert.equal(name, "video");
    const video = new BridgeProbeVideo(this.durationsSeconds.shift() ?? 1);
    this.probeVideos.push(video);
    return video;
  }
}

class BridgeRuntimeRoot extends EventTarget {
  constructor(video, workspace, settings, plan) {
    super();
    this.video = video;
    this.startStatus = { textContent: "" };
    this.resetReasons = [];
    this.researchUi = {
      workspace,
      settings,
      plan,
      resetAffect: (reason) => this.resetReasons.push(reason),
    };
  }

  querySelector(selector) {
    if (selector === "#run-video") return this.video;
    if (selector === "#start-status") return this.startStatus;
    return null;
  }
}

function installBridgeDocument(documentObject) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentObject });
  return () => {
    if (prior) Object.defineProperty(globalThis, "document", prior);
    else delete globalThis.document;
  };
}

async function putPackageAsset(root, packagePath, contents) {
  const parts = packagePath.split("/");
  const fileName = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  directory.children.set(fileName, new MemoryFileHandle(
    fileName,
    new File([contents], fileName, { type: "video/mp4" }),
  ));
}

async function packageBridgeHarness({ isiAfterMs = 80 } = {}) {
  const fixture = await experimentPackageFixture({ isiAfterMs });
  const rootDirectory = new MemoryDirectoryHandle("package-root");
  const workspace = new BrowserResearchWorkspace(rootDirectory);
  await workspace.initialize();
  await workspace.saveExperimentPackage(fixture.experimentPackageBinding.sourceText);
  for (const binding of fixture.experimentPackageBinding.assetBindings) {
    await putPackageAsset(rootDirectory, binding.packagePath, fixture.mediaBytes.get(binding.stimulusId));
  }

  const journal = new MemoryResearchJournal();
  const workers = [];
  let uuid = 1;
  const runtimeVideo = new BridgeRuntimeVideo();
  const runtimeDocument = new BridgeRuntimeDocument([2, 3]);
  const restoreDocument = installBridgeDocument(runtimeDocument);
  const root = new BridgeRuntimeRoot(runtimeVideo, workspace, fixture.settings, fixture.plan);
  const statuses = [];
  const questionnaires = [];
  const completions = [];
  const started = [];
  root.addEventListener(RESEARCH_UI_EVENTS.runStatus, ({ detail }) => statuses.push(structuredClone(detail)));
  root.addEventListener(RESEARCH_UI_EVENTS.questionnaireStatus, ({ detail }) => questionnaires.push(structuredClone(detail)));
  root.addEventListener(RESEARCH_UI_EVENTS.runComplete, ({ detail }) => completions.push(structuredClone(detail)));
  root.addEventListener(RESEARCH_UI_EVENTS.runStarted, ({ detail }) => started.push(structuredClone(detail)));
  const bridge = new BrowserResearchRuntimeBridge(root, {
    journal,
    controllerFactory: ({ workspace: selectedWorkspace }) => new BrowserResearchRunController({
      journal,
      workspace: selectedWorkspace,
      workerFactory: () => {
        const worker = new ExternalProtocolSamplingWorker();
        workers.push(worker);
        return worker;
      },
      cryptoObject: {
        randomUUID: () => `00000000-0000-4000-8000-${String(uuid++).padStart(12, "0")}`,
      },
      platform: "chrome",
      flushIntervalMs: 1_000_000,
    }),
    workerProbe: async () => true,
    storageProbe: async ({ requiredBytes }) => ({
      usageBytes: 0,
      quotaBytes: 1_000_000_000,
      availableBytes: 1_000_000_000,
      requiredBytes,
      sufficient: true,
      persisted: true,
      persistenceRequested: false,
    }),
    leaseFactory: async () => ({ release() {} }),
    createObjectURL: (() => {
      let id = 0;
      return () => `blob:package-runtime-${++id}`;
    })(),
    revokeObjectURL: () => {},
    documentObject: runtimeDocument,
    windowObject: new EventTarget(),
  });
  await bridge.initialize();
  const settingsSha256 = await canonicalSha256(fixture.settings);
  const binding = fixture.experimentPackageBinding;
  const startDetail = {
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    settings: fixture.settings,
    settingsSha256,
    researchSettings: fixture.settings,
    researchSettingsSha256: settingsSha256,
    resolvedPlan: fixture.plan,
    resolvedProtocolPlan: fixture.protocolPlan,
    experimentSourceText: fixture.experimentSourceText,
    experimentPackageSourceText: binding.sourceText,
    experimentPackageSourceByteSha256: binding.sourceByteSha256,
    experimentPackageDefinitionSha256: binding.packageDefinitionSha256,
    experimentPackageId: binding.packageId,
    selectedLanguageId: binding.languageId,
    languageSelectionPath: binding.languageSelectionPath,
    packageAssignmentSha256: binding.assignmentSha256,
    packageAssetBindings: binding.assetBindings,
    attemptDisposition: "new-attempt",
    preflight: PREFLIGHT,
    outputFormats: { csv: true, tsv: true },
  };
  return {
    bridge,
    completions,
    fixture,
    journal,
    questionnaires,
    root,
    rootDirectory,
    runtimeDocument,
    runtimeVideo,
    startDetail,
    started,
    statuses,
    workspace,
    workers,
    async settle(milliseconds = 0) {
      if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
      else await new Promise((resolve) => setImmediate(resolve));
      await bridge.operation;
    },
    destroy() {
      bridge.destroy();
      restoreDocument();
    },
  };
}

function submitActiveQuestionnaire(harness, moduleId) {
  const active = harness.questionnaires.findLast((detail) => detail.active !== false && detail.moduleId === moduleId);
  assert.ok(active, `questionnaire ${moduleId} should be active`);
  return dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.questionnaireSubmitRequest, {
    ...active,
    answers: { ready: "yes" },
    complete: true,
  });
}

function dispatchBridgeRequest(root, type, detail = undefined) {
  const event = new CustomEvent(type, { detail, cancelable: true });
  root.dispatchEvent(event);
  return event;
}

test("Browser runtime executes the canonical package V3 video/questionnaire/ISI route without hidden sampling", { concurrency: false }, async () => {
  const harness = await packageBridgeHarness({ isiAfterMs: 80 });
  try {
    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.startRequest, harness.startDetail);
    await harness.settle();
    assert.equal(harness.started.length, 1);
    assert.equal(harness.runtimeVideo.playCalls, 0, "the first package video waits for the explicit Begin gesture");
    assert.equal(harness.statuses.at(-1).pauseAvailable, false);
    assert.equal(harness.statuses.at(-1).ratingInputActive, false);

    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.inputTestState, {
      x: 0.9,
      y: -0.7,
      inputActive: true,
    });
    assert.equal(harness.workers[0].state, null, "rating input is rejected at the prepared safe boundary");

    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.continueRequest);
    await harness.settle();
    assert.equal(harness.runtimeVideo.playCalls, 1);
    assert.equal(harness.workers[0].state.currentValence, 0);
    assert.equal(harness.workers[0].state.currentArousal, 0);
    assert.equal(harness.workers[0].state.inputActive, false, "every package video starts from authoritative neutral");
    assert.equal(harness.statuses.at(-1).pauseAvailable, true);
    assert.equal(harness.statuses.at(-1).ratingInputActive, true);

    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.inputTestState, {
      x: 0.6,
      y: -0.4,
      inputActive: true,
    });
    assert.equal(harness.workers[0].state.currentValence, 0.6);
    assert.equal(harness.workers[0].state.currentArousal, -0.4);

    harness.runtimeVideo.currentTime = 2;
    harness.runtimeVideo.dispatchEvent(new Event("ended"));
    await harness.settle();
    const beforeIsi = harness.questionnaires.findLast((detail) => detail.active !== false);
    assert.equal(beforeIsi.moduleId, "after-video-before-isi");
    assert.equal(harness.statuses.at(-1).pauseAvailable, false);
    const stateBeforeRejectedInput = structuredClone(harness.workers[0].state);
    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.inputTestState, {
      x: -1,
      y: 1,
      inputActive: true,
    });
    assert.deepEqual(harness.workers[0].state, stateBeforeRejectedInput,
      "questionnaire navigation cannot mutate rating authority");

    submitActiveQuestionnaire(harness, "after-video-before-isi");
    await harness.settle();
    assert.equal(harness.runtimeDocument.probeVideos.length, 2,
      "the next exact local asset is hash/decode-attested before interval timing begins");
    assert.equal(harness.runtimeVideo.hidden, true);
    assert.equal(harness.runtimeVideo.playCalls, 1);
    assert.ok(harness.statuses.some(({ write }) => write === "Next local asset attested before interval start"));

    harness.runtimeDocument.visibilityState = "hidden";
    harness.runtimeDocument.dispatchEvent(new Event("visibilitychange"));
    await harness.settle();
    await harness.settle(110);
    assert.equal(harness.runtimeVideo.playCalls, 1, "a hidden interval never starts the next video");
    assert.equal(
      harness.questionnaires.some((detail) => detail.active !== false && detail.moduleId === "after-video-after-isi"),
      false,
      "the post-ISI module cannot begin while the interval clock is visibility-frozen",
    );
    assert.ok(harness.statuses.some(({ timing }) => timing === "Paused · browser hidden"));

    harness.runtimeDocument.visibilityState = "visible";
    harness.runtimeDocument.dispatchEvent(new Event("visibilitychange"));
    await harness.settle(110);
    const afterIsi = harness.questionnaires.findLast((detail) => detail.active !== false);
    assert.equal(afterIsi.moduleId, "after-video-after-isi");
    assert.equal(harness.runtimeVideo.playCalls, 1, "post-ISI questionnaire precedes the next video");
    assert.equal(harness.statuses.at(-1).pauseAvailable, false);
    assert.equal(harness.statuses.at(-1).ratingInputActive, false);

    submitActiveQuestionnaire(harness, "after-video-after-isi");
    await harness.settle();
    assert.equal(harness.runtimeVideo.playCalls, 2, "the already-attested asset starts without a second preparation pass");
    assert.equal(harness.runtimeDocument.probeVideos.length, 2);
    assert.equal(harness.workers[0].state.currentValence, 0);
    assert.equal(harness.workers[0].state.currentArousal, 0);
    assert.equal(harness.workers[0].state.inputActive, false);

    harness.runtimeVideo.currentTime = 3;
    harness.runtimeVideo.dispatchEvent(new Event("ended"));
    await harness.settle(20);
    assert.equal(harness.completions.length, 1);
    assert.equal(harness.completions[0].result, "completed");
    assert.equal(harness.bridge.run, null);
    assert.equal(harness.bridge.controller, null);

    const audit = await harness.workspace.listRunManifests(harness.fixture.settings.experiment.id);
    assert.equal(audit.issues.length, 0);
    assert.equal(audit.manifests.length, 1);
    const manifest = audit.manifests[0];
    assert.equal(manifest.experimentPackage.canonicalSourceByteSha256,
      harness.fixture.experimentPackageBinding.sourceByteSha256);
    assert.equal(manifest.experimentPackage.packageDefinitionSha256,
      harness.fixture.experimentPackageBinding.packageDefinitionSha256);
    assert.equal(manifest.experimentPackage.assignmentSha256,
      harness.fixture.experimentPackageBinding.assignmentSha256);
    assert.equal(manifest.experimentPackage.assetBindingsSha256,
      await canonicalSha256(harness.fixture.experimentPackageBinding.assetBindings));

    const events = await harness.journal.readRecords(harness.started[0].runId, { kind: "events" });
    const lifecycle = events.map(({ type }) => type);
    const firstStimulusStarted = lifecycle.indexOf("stimulusStarted");
    const beforeStarted = lifecycle.indexOf("questionnaireStarted");
    const intervalStarted = lifecycle.indexOf("transitionStarted", beforeStarted + 1);
    const intervalCompleted = lifecycle.indexOf("transitionCompleted", intervalStarted + 1);
    const afterStarted = lifecycle.indexOf("questionnaireStarted", beforeStarted + 1);
    const secondStimulusStarted = lifecycle.indexOf("stimulusStarted", firstStimulusStarted + 1);
    assert.ok(beforeStarted < intervalStarted && intervalStarted < intervalCompleted
      && intervalCompleted < afterStarted && afterStarted < secondStimulusStarted,
    "package route preserves before-ISI, interval, after-ISI, then next-video order");
  } finally {
    harness.destroy();
  }
});

test("Browser runtime converts a post-Start package asset failure into a durable recoverable partial", { concurrency: false }, async () => {
  const harness = await packageBridgeHarness({ isiAfterMs: 80 });
  try {
    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.startRequest, harness.startDetail);
    await harness.settle();
    dispatchBridgeRequest(harness.root, RESEARCH_UI_EVENTS.continueRequest);
    await harness.settle();
    harness.runtimeVideo.currentTime = 2;
    harness.runtimeVideo.dispatchEvent(new Event("ended"));
    await harness.settle();

    const binding = harness.fixture.experimentPackageBinding.assetBindings
      .find(({ stimulusId }) => stimulusId === "active-01");
    await putPackageAsset(harness.rootDirectory, binding.packagePath, "changed after the frozen Start gate");
    submitActiveQuestionnaire(harness, "after-video-before-isi");
    await harness.settle();

    assert.equal(harness.runtimeVideo.playCalls, 1);
    assert.equal(harness.bridge.run, null, "bridge authority is released after the failed advance");
    assert.equal(harness.bridge.controller, null);
    assert.equal(harness.completions.at(-1).result, "interrupted");
    assert.match(harness.completions.at(-1).error, /SHA-256 changed|byte length changed/u);
    assert.match(harness.completions.at(-1).recovery, /partial attempt is journaled/u);
    const attempts = await harness.journal.listAttempts({
      experimentId: harness.fixture.settings.experiment.id,
    });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, "partial");
    assert.equal(attempts[0].recoverable, true);
    assert.equal(attempts[0].safeProtocolStepPosition, 2,
      "recovery resumes from the last fully committed questionnaire boundary");
  } finally {
    harness.destroy();
  }
});

async function emitOneSample(controller, worker, clock, sequence, affect) {
  clock.tick();
  controller.updateAffect({
    ...affect,
    inputActive: true,
    mediaTimeMs: 500,
  });
  const observedMonotonicMs = clock.tick();
  worker.emitSample({
    sequence,
    scheduledMonotonicMs: observedMonotonicMs - 1,
    observedMonotonicMs,
    wallTimeUtc: clock.wallTimeUtc(),
  });
  await new Promise((resolve) => setImmediate(resolve));
  await controller.flush();
}

test("V3 Start rejects experiment source bytes that do not match the frozen receipt", async () => {
  const fixture = await experimentPackageFixture();
  const harness = runtimeHarness();
  const controller = harness.createController();
  await controller.initialize();
  await assert.rejects(controller.start({
    ...fixture,
    experimentSourceText: `${fixture.experimentSourceText}\n`,
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    attemptNumber: 1,
    preflight: PREFLIGHT,
  }), /exact experiment\.json source does not bind/u);
});

test("new V3 Start rejects a package-less external protocol before reservation", async () => {
  const fixture = await externalProtocolFixture();
  const harness = runtimeHarness();
  const controller = harness.createController();
  await controller.initialize();
  await assert.rejects(controller.start({
    ...fixture,
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    attemptNumber: 1,
    preflight: PREFLIGHT,
  }), /require a canonical experiment package binding/u);
  assert.equal((await harness.journal.listAttempts(fixture.settings.experiment.id)).length, 0);
});

test("package-backed V3 attempts freeze exact package bytes through recovery and output attestation", async () => {
  const fixture = await experimentPackageFixture();
  const harness = runtimeHarness();
  const controller = harness.createController();
  await controller.initialize();
  const started = await controller.start({
    ...fixture,
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    attemptNumber: 1,
    preflight: PREFLIGHT,
  });
  const reserved = await harness.journal.getAttempt(started.runId);
  assert.equal(
    reserved.context.experimentPackage.sourceByteSha256,
    fixture.experimentPackageBinding.sourceByteSha256,
  );
  harness.clock.tick();
  const receipt = await controller.stopEarly();
  assert.equal(receipt.completionStatus, "partial");
  assert.equal(receipt.manifest.version, 4);
  assert.deepEqual(validateResearchRunManifestV4(receipt.manifest), receipt.manifest);
  assert.deepEqual(receipt.manifest.experimentPackage, {
    canonicalSourceByteSha256: fixture.experimentPackageBinding.sourceByteSha256,
    packageDefinitionSha256: fixture.experimentPackageBinding.packageDefinitionSha256,
    packageId: fixture.experimentPackageBinding.packageId,
    languageId: fixture.experimentPackageBinding.languageId,
    languageSelectionPath: fixture.experimentPackageBinding.languageSelectionPath,
    assignmentSha256: fixture.experimentPackageBinding.assignmentSha256,
    assetBindingsSha256: await canonicalSha256(fixture.experimentPackageBinding.assetBindings),
  });
  assert.throws(
    () => validateResearchRunManifestV4({ ...receipt.manifest, futureMeaning: true }),
    /unknown field/u,
  );
  assert.throws(
    () => validateResearchRunManifestV4({
      ...receipt.manifest,
      outputs: receipt.manifest.outputs.filter(({ kind }) => kind !== "experimentPackage"),
    }),
    /exact canonical experiment\.package\.json output/u,
  );
  assert.equal(
    harness.workspace.artifacts["experiment.package.json"],
    fixture.experimentPackageBinding.sourceText,
  );
  assert.deepEqual(
    receipt.manifest.outputs
      .filter(({ kind }) => kind === "experimentPackage")
      .map(({ kind, fileName, sha256 }) => [kind, fileName, sha256]),
    [[
      "experimentPackage",
      "experiment.package.json",
      fixture.experimentPackageBinding.sourceByteSha256,
    ]],
  );

  const auditedWorkspace = new BrowserResearchWorkspace(new MemoryDirectoryHandle());
  await auditedWorkspace.initialize();
  const auditedDirectory = await auditedWorkspace.createAttemptDirectory({
    experimentId: receipt.manifest.experimentId,
    participantId: receipt.manifest.participantId,
    sessionStem: receipt.manifest.sessionStem,
  });
  await auditedWorkspace.writeAttemptArtifacts(auditedDirectory, harness.workspace.artifacts);
  const audit = await auditedWorkspace.listRunManifests(receipt.manifest.experimentId);
  assert.deepEqual(audit.issues, []);
  assert.deepEqual(audit.manifests, [receipt.manifest]);

  const wrongAssetBindings = structuredClone(receipt.manifest);
  wrongAssetBindings.experimentPackage.assetBindingsSha256 = "f".repeat(64);
  auditedDirectory.children.get("manifest.json").file = new File(
    [`${canonicalJson(wrongAssetBindings)}\n`],
    "manifest.json",
    { type: "application/json" },
  );
  const rejectedAudit = await auditedWorkspace.listRunManifests(
    receipt.manifest.experimentId,
  );
  assert.equal(rejectedAudit.manifests.length, 0);
  assert.equal(rejectedAudit.issues[0]?.code, "artifact-experiment-package-binding");

  const wrongAssignment = structuredClone(receipt.manifest);
  wrongAssignment.experimentPackage.assignmentSha256 = "e".repeat(64);
  auditedDirectory.children.get("manifest.json").file = new File(
    [`${canonicalJson(wrongAssignment)}\n`],
    "manifest.json",
    { type: "application/json" },
  );
  const rejectedAssignmentAudit = await auditedWorkspace.listRunManifests(
    receipt.manifest.experimentId,
  );
  assert.equal(rejectedAssignmentAudit.manifests.length, 0);
  assert.equal(rejectedAssignmentAudit.issues[0]?.code, "artifact-experiment-package-binding");

  const changedBinding = structuredClone(fixture.experimentPackageBinding);
  changedBinding.languageId = "de";
  const rejectedHarness = runtimeHarness();
  const rejected = rejectedHarness.createController();
  await rejected.initialize();
  await assert.rejects(rejected.start({
    ...fixture,
    experimentPackageBinding: changedBinding,
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    attemptNumber: 1,
    preflight: PREFLIGHT,
  }), /terminal route|reproduce|binding/u);
});

test("package controller preserves authored intervals through recovery and ManifestV4 finalization", async () => {
  const fixture = await experimentPackageFixture();
  assert.deepEqual(fixture.protocolPlan.steps.map((step) => (
    step.kind === "interval"
      ? [step.kind, step.stimulusId, step.durationMs]
      : step.kind === "questionnaire"
        ? [step.kind, step.moduleId, step.relativeToIsi]
        : [step.kind, step.stimulusId]
  )), [
    ["stimulus", "calm-01"],
    ["questionnaire", "after-video-before-isi", "before"],
    ["interval", "calm-01", 2_500],
    ["questionnaire", "after-video-after-isi", "after"],
    ["stimulus", "active-01"],
    ["interval", "active-01", 0],
  ]);

  const harness = runtimeHarness();
  const first = harness.createController();
  await first.initialize();
  const started = await first.start({
    ...fixture,
    participantId: "P001",
    participant: { participantCode: "LF", age: 27, gender: "W", handedness: "R" },
    attemptNumber: 1,
    preflight: PREFLIGHT,
  });
  assert.equal(started.protocolAware, true);
  assert.equal((await harness.journal.getAttempt(started.runId)).version, 3);

  harness.clock.tick();
  await first.startStimulus(0);
  await emitOneSample(first, harness.workers[0], harness.clock, 1, {
    currentValence: -0.25,
    currentArousal: 0.5,
    targetValence: -0.25,
    targetArousal: 0.5,
  });
  harness.clock.tick();
  await first.completeStimulus(2_000);
  assert.equal(first.nextProtocolStep().moduleId, "after-video-before-isi");
  harness.clock.tick();
  await first.beginQuestionnaireStep();
  harness.clock.tick();
  await first.submitQuestionnaire({ ready: "yes" });
  assert.equal(first.nextProtocolStep().kind, "interval");

  harness.clock.tick();
  const firstInterval = await first.beginIntervalStep();
  assert.equal(firstInterval.durationMs, 2_500);
  assert.throws(
    () => first.updateAffect({ currentValence: 1, currentArousal: 1 }),
    /disabled outside an active stimulus/u,
  );
  const sampleCountBeforeInterruption = (
    await harness.journal.readRecords(started.runId, { kind: "samples" })
  ).length;
  harness.clock.tick(1_000);
  const interrupted = await first.interrupt("forced-termination");
  assert.equal(interrupted.interruption.interruptedProtocolStepKind, "interval");
  assert.equal(interrupted.interruption.restartProtocolStepPosition, 3);
  assert.equal(interrupted.safeProtocolStepPosition, 2);
  assert.equal(
    (await harness.journal.readRecords(started.runId, { kind: "samples" })).length,
    sampleCountBeforeInterruption,
    "an active authored interval emits no rating rows",
  );

  const resumedController = harness.createController();
  harness.clock.tick();
  await resumedController.initialize();
  const resumed = await resumedController.resume({ runId: started.runId });
  assert.equal(resumed.interruptedProtocolStepKind, "interval");
  assert.equal(resumed.safeProtocolStepPosition, 2);
  assert.deepEqual(resumedController.nextProtocolStep(), firstInterval,
    "recovery restarts the complete authored interval rather than an elapsed remainder");
  const recoveryEvents = await harness.journal.readRecords(started.runId, { kind: "events" });
  assert.equal(
    recoveryEvents.find(({ type }) => type === "recoveryCompleted")?.detailCode,
    "restart-current-interval",
  );

  harness.clock.tick();
  const restartedInterval = await resumedController.beginIntervalStep();
  assert.equal(restartedInterval.durationMs, 2_500);
  harness.clock.tick(restartedInterval.durationMs);
  const afterInterval = await resumedController.completeIntervalStep();
  assert.equal(afterInterval.nextStep.kind, "questionnaire");
  assert.equal(afterInterval.nextStep.moduleId, "after-video-after-isi");
  harness.clock.tick();
  await resumedController.beginQuestionnaireStep();
  harness.clock.tick();
  const afterQuestionnaire = await resumedController.submitQuestionnaire({ ready: "yes" });
  assert.equal(afterQuestionnaire.nextStep.kind, "stimulus");
  assert.equal(afterQuestionnaire.nextStep.stimulusId, "active-01");

  harness.clock.tick();
  await resumedController.startStimulus(1);
  await emitOneSample(resumedController, harness.workers[1], harness.clock, 1, {
    currentValence: 0.75,
    currentArousal: -0.5,
    targetValence: 0.75,
    targetArousal: -0.5,
  });
  harness.clock.tick();
  await resumedController.completeStimulus(3_000);

  harness.clock.tick();
  const terminalInterval = await resumedController.beginIntervalStep();
  assert.equal(terminalInterval.durationMs, 0);
  const terminalCompletion = await resumedController.completeIntervalStep();
  assert.equal(terminalCompletion.nextStep, null);
  assert.equal(resumedController.nextProtocolStep(), null);

  harness.clock.tick();
  const receipt = await resumedController.complete();
  assert.equal(receipt.completionStatus, "completed");
  assert.equal(receipt.sampleCount, 2);
  assert.equal(receipt.questionnaireResponseCount, 2);
  assert.equal(receipt.assignmentPlanSha256, fixture.plan.planHashSha256);
  assert.equal(receipt.assignmentSha256, fixture.experimentPackageBinding.assignmentSha256);
  assert.notEqual(receipt.assignmentSha256, receipt.assignmentPlanSha256);
  assert.equal(receipt.protocolPlanSha256, fixture.protocolPlan.protocolPlanHashSha256);
  assert.deepEqual(validateResearchRunManifestV4(receipt.manifest), receipt.manifest);
  assert.equal(receipt.manifest.protocol.safeProtocolStepPosition, 6);
  assert.equal(receipt.manifest.protocol.protocolStepCount, 6);
  assert.deepEqual(
    receipt.manifest.protocol.questionnaireModules.map(({ moduleId, status }) => [moduleId, status]),
    [
      ["after-video-before-isi", "submitted"],
      ["after-video-after-isi", "submitted"],
    ],
  );
  assert.deepEqual(receipt.manifest.recovery, {
    resumed: true,
    sourceRunId: started.runId,
    restartedStimulusIds: [],
  });

  const events = await harness.journal.readRecords(started.runId, { kind: "events" });
  assert.deepEqual(events.map(validateResearchEventV2), events);
  assert.equal(events.filter(({ type }) => type === "stimulusStarted").length, 2);
  assert.equal(events.filter(({ type }) => type === "stimulusCompleted").length, 2);
  assert.equal(events.filter(({ type }) => type === "transitionStarted").length, 3);
  assert.equal(events.filter(({ type }) => type === "transitionCompleted").length, 2);
  assert.equal(events.filter(({ type }) => type === "questionnaireStarted").length, 2);
  assert.equal(events.filter(({ type }) => type === "questionnaireCompleted").length, 2);
  assert.equal(events.filter(({ type }) => type === "recoveryStarted").length, 1);
  assert.equal(events.filter(({ type }) => type === "recoveryCompleted").length, 1);

  assert.match(harness.workspace.artifacts["settings.snapshot.json"], /"version":3/u);
  assert.equal(harness.workspace.artifacts["experiment.json"], fixture.experimentSourceText);
  assert.deepEqual(
    JSON.parse(harness.workspace.artifacts["experiment-plan.snapshot.json"]),
    fixture.plan,
  );
  assert.equal(
    digest(harness.workspace.artifacts["experiment.json"]),
    fixture.settings.externalProtocol.sourceByteSha256,
  );
  assert.deepEqual(
    receipt.manifest.outputs
      .filter(({ kind }) => kind === "experimentSource" || kind === "experimentPlan")
      .map(({ kind, fileName }) => [kind, fileName]),
    [
      ["experimentSource", "experiment.json"],
      ["experimentPlan", "experiment-plan.snapshot.json"],
    ],
  );
  assert.match(harness.workspace.artifacts["protocol-plan.snapshot.json"], /"durationMs":2500/u);
  assert.match(harness.workspace.artifacts["protocol-plan.snapshot.json"], /"durationMs":0/u);
  assert.equal(
    harness.workspace.artifacts["ratings.csv"].split("\r\n").length,
    harness.workspace.artifacts["ratings.tsv"].split("\r\n").length,
  );
  const auditedWorkspace = new BrowserResearchWorkspace(new MemoryDirectoryHandle());
  await auditedWorkspace.initialize();
  const auditedDirectory = await auditedWorkspace.createAttemptDirectory({
    experimentId: receipt.manifest.experimentId,
    participantId: receipt.manifest.participantId,
    sessionStem: receipt.manifest.sessionStem,
  });
  await auditedWorkspace.writeAttemptArtifacts(auditedDirectory, harness.workspace.artifacts);
  const audit = await auditedWorkspace.listRunManifests(receipt.manifest.experimentId);
  assert.deepEqual(audit.issues, []);
  assert.deepEqual(audit.manifests, [receipt.manifest]);
  assert.equal((await harness.journal.getAttempt(started.runId)).status, "complete");
});

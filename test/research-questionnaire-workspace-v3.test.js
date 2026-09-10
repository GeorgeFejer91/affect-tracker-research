import test from "node:test";
import assert from "node:assert/strict";

import { canonicalJson, canonicalSha256, sha256Hex } from "../site/src/research/canonical.js";
import {
  RESEARCH_EVENT_SCHEMA,
  RESEARCH_RUN_MANIFEST_SCHEMA,
  RESEARCH_SAMPLE_SCHEMA,
  createDefaultResearchSettings,
  validateResearchSampleV1,
} from "../site/src/research/contracts.js";
import { resolveAssignmentPlan } from "../site/src/research/counterbalancer.js";
import {
  projectResearchSettingsV2ToAssignmentSettingsV1,
  resolveProtocolPlanV1,
  validateResearchSettingsV2,
} from "../site/src/research/protocol-plan.js";
import {
  createQuestionnaireResponseV1,
  questionnaireResponsesToCsv,
  questionnaireResponsesToTsv,
} from "../site/src/research/questionnaires.js";
import {
  RESEARCH_RUN_MANIFEST_V3_SCHEMA,
  validateResearchEventV2,
  validateResearchRunManifestV3,
} from "../site/src/research/protocol-records.js";
import { samplesToCsv, samplesToTsv } from "../site/src/research/tabular.js";
import { BrowserResearchWorkspace } from "../site/src/research/workspace.js";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const STARTED_AT = "2026-09-08T14:30:12.482Z";
const FINALIZED_AT = "2026-09-08T14:31:12.482Z";
const SESSION_STEM = "P001_EF_A27_GW_HR_20260908T143012482Z_R01";

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
    const existing = this.children.get(name);
    if (existing?.kind === "directory") return existing;
    if (existing || !create) throw Object.assign(new Error("Missing directory"), { name: "NotFoundError" });
    const directory = new MemoryDirectoryHandle(name);
    this.children.set(name, directory);
    return directory;
  }

  async getFileHandle(name, { create = false } = {}) {
    const existing = this.children.get(name);
    if (existing?.kind === "file") return existing;
    if (existing || !create) throw Object.assign(new Error("Missing file"), { name: "NotFoundError" });
    const handle = new MemoryFileHandle(name, new File([], name));
    this.children.set(name, handle);
    return handle;
  }

  async removeEntry(name) {
    if (!this.children.delete(name)) throw Object.assign(new Error("Missing entry"), { name: "NotFoundError" });
  }

  async *entries() { yield* this.children.entries(); }
}

async function questionnaireDefinition() {
  const definition = {
    schema: "affect-research-questionnaire-definition",
    version: 1,
    questionnaireId: "workspace-check",
    questionnaireVersion: "1.0",
    title: "Workspace check",
    language: "en",
    instructions: "Choose one answer.",
    attribution: "Project-authored workspace attestation fixture.",
    source: {
      kind: "researcherCsv",
      logicalName: "workspace-check.csv",
      sourceDocumentSha256: null,
      formatVersion: "questionnaire-csv-v1",
      byteLength: 128,
      sha256: await sha256Hex("workspace-questionnaire-source"),
    },
    items: [{
      itemId: "item-01",
      order: 1,
      prompt: "Ready?",
      required: true,
      subscale: "readiness",
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
  return definition;
}

async function createFixture({ partial = false } = {}) {
  const definition = await questionnaireDefinition();
  const module = {
    schema: "affect-research-questionnaire-module",
    version: 1,
    moduleId: "before-session",
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
    placement: { kind: "beforeSession", poolId: null },
  };
  const rawSettings = structuredClone(createDefaultResearchSettings());
  rawSettings.version = 2;
  rawSettings.experiment.id = "experiment-1";
  rawSettings.experiment.participantCount = 1;
  rawSettings.output.tsv = true;
  rawSettings.stimuli.items = [{
    stimulusId: "video-1",
    title: "Video One",
    source: {
      kind: "workspaceFile",
      relativePath: "stimuli/video-one.mp4",
      mimeType: "video/mp4",
      sha256: await sha256Hex("video-one"),
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
    algorithmVersion: "questionnaire-hooks-v1",
    definitions: [definition],
    modules: [module],
  };
  const settings = await validateResearchSettingsV2(rawSettings);
  const assignmentSettings = await projectResearchSettingsV2ToAssignmentSettingsV1(settings);
  const assignmentPlan = await resolveAssignmentPlan(assignmentSettings);
  const protocolPlan = await resolveProtocolPlanV1(settings, assignmentPlan, "P001");
  const stimulus = {
    kind: "workspaceFile",
    stimulusId: "video-1",
    sha256: rawSettings.stimuli.items[0].source.sha256,
    byteLength: 1_024,
    durationMs: 2_000,
    url: null,
    videoId: null,
  };
  const response = await createQuestionnaireResponseV1({
    definition,
    module,
    sequence: 1,
    runId: RUN_ID,
    participantId: "P001",
    attemptNumber: 1,
    settingsSha256: protocolPlan.settingsSha256,
    assignmentPlanSha256: assignmentPlan.planHashSha256,
    protocolPlanSha256: protocolPlan.protocolPlanHashSha256,
    protocolStepPosition: 1,
    itemId: "item-01",
    optionId: "yes",
    status: partial ? "draft" : "submitted",
    wallTimeUtc: "2026-09-08T14:30:13.000Z",
    monotonicTimeNs: "1000000",
    responseLatencyMs: 500,
  });
  const event = (sequence, type, fields = {}) => validateResearchEventV2({
    schema: RESEARCH_EVENT_SCHEMA,
    version: 2,
    sequence,
    runId: RUN_ID,
    participantId: "P001",
    attemptNumber: 1,
    settingsSha256: protocolPlan.settingsSha256,
    assignmentPlanSha256: assignmentPlan.planHashSha256,
    protocolPlanSha256: protocolPlan.protocolPlanHashSha256,
    wallTimeUtc: "2026-09-08T14:30:13.000Z",
    monotonicTimeNs: String(sequence * 1_000_000),
    type,
    stimulusIdentity: null,
    stimulusPosition: null,
    protocolStepPosition: 1,
    moduleId: definition.questionnaireId === "workspace-check" ? module.moduleId : null,
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
    mediaTimeMs: null,
    missedSlotCount: null,
    detailCode: "workspace-test",
    ...fields,
  });
  const events = [event(1, "questionnaireStarted")];
  if (partial) events.push(event(2, "questionnaireDraftCheckpointed"));
  else {
    events.push(event(2, "questionnaireCompleted"));
    events.push(event(3, "stimulusStarted", {
      stimulusIdentity: stimulus,
      stimulusPosition: 1,
      protocolStepPosition: 2,
      moduleId: null,
      questionnaireId: null,
      definitionSha256: null,
      mediaTimeMs: 0,
    }));
    events.push(event(4, "stimulusCompleted", {
      stimulusIdentity: stimulus,
      stimulusPosition: 1,
      protocolStepPosition: 2,
      moduleId: null,
      questionnaireId: null,
      definitionSha256: null,
      mediaTimeMs: 2_000,
    }));
  }
  const samples = partial ? [] : [validateResearchSampleV1({
    schema: RESEARCH_SAMPLE_SCHEMA,
    version: 1,
    sequence: 1,
    runId: RUN_ID,
    participantId: "P001",
    attemptNumber: 1,
    settingsSha256: protocolPlan.settingsSha256,
    assignmentPlanSha256: assignmentPlan.planHashSha256,
    stimulusPosition: 1,
    stimulusIdentity: stimulus,
    wallTimeUtc: "2026-09-08T14:30:14.000Z",
    monotonicTimeNs: "3000000",
    lslTimeSeconds: null,
    sampleRateHz: 130,
    scheduledElapsedMs: 10,
    observedElapsedMs: 10,
    schedulerLatenessMs: 0,
    schedulerJitterMs: 0,
    stateAnchorAgeMs: 0,
    missedSlotsBefore: 0,
    mediaTimeMs: 500,
    currentValence: 0,
    currentArousal: 0,
    targetValence: 0,
    targetArousal: 0,
    radius: 0,
    angleDegrees: 0,
    oscillationFrequency: 0.5,
    edgeSmoothness: 0.5,
    projectionAmplitude: 0.2,
    pulseSynchrony: 0.2,
    waveSizeVariation: 0.8,
    saturation: 0,
    animationActive: true,
    inputActive: false,
    inputKind: "digital",
    feedbackVisible: true,
  })];
  const settingsText = `${canonicalJson(settings)}\n`;
  const protocolText = `${canonicalJson(protocolPlan)}\n`;
  const eventsText = `${events.map(canonicalJson).join("\n")}\n`;
  const ratingsCsv = samplesToCsv(samples);
  const ratingsTsv = samplesToTsv(samples);
  const questionnaireCsv = questionnaireResponsesToCsv([response]);
  const questionnaireTsv = questionnaireResponsesToTsv([response]);
  const artifacts = {
    "settings.snapshot.json": settingsText,
    "protocol-plan.snapshot.json": protocolText,
    "events.jsonl": eventsText,
    "ratings.csv": ratingsCsv,
    "ratings.tsv": ratingsTsv,
    "questionnaire-responses.csv": questionnaireCsv,
    "questionnaire-responses.tsv": questionnaireTsv,
  };
  const outputKind = (kind, fileName, text, rowCount = null) => ({
    kind,
    fileName,
    sha256: null,
    byteLength: new TextEncoder().encode(text).byteLength,
    rowCount,
  });
  const outputs = [
    outputKind("settings", "settings.snapshot.json", settingsText),
    outputKind("protocolPlan", "protocol-plan.snapshot.json", protocolText),
    outputKind("events", "events.jsonl", eventsText),
    outputKind("ratingsCsv", "ratings.csv", ratingsCsv, samples.length),
    outputKind("questionnaireCsv", "questionnaire-responses.csv", questionnaireCsv, 1),
    outputKind("ratingsTsv", "ratings.tsv", ratingsTsv, samples.length),
    outputKind("questionnaireTsv", "questionnaire-responses.tsv", questionnaireTsv, 1),
  ];
  for (const output of outputs) output.sha256 = await sha256Hex(artifacts[output.fileName]);
  const submitted = partial ? [] : [response];
  const drafts = partial ? [response] : [];
  const manifest = validateResearchRunManifestV3({
    schema: RESEARCH_RUN_MANIFEST_V3_SCHEMA ?? RESEARCH_RUN_MANIFEST_SCHEMA,
    version: 3,
    runId: RUN_ID,
    experimentId: "experiment-1",
    participantId: "P001",
    participantCode: "EF",
    age: 27,
    gender: "W",
    handedness: "R",
    attemptNumber: 1,
    sessionStem: SESSION_STEM,
    completionStatus: partial ? "partial" : "completed",
    playbackMode: "browserMediaAdapters",
    playbackQualification: "browser",
    settingsSha256: protocolPlan.settingsSha256,
    assignmentPlanSha256: assignmentPlan.planHashSha256,
    protocolPlanSha256: protocolPlan.protocolPlanHashSha256,
    stimuli: [stimulus],
    protocol: {
      safeProtocolStepPosition: partial ? 0 : protocolPlan.steps.length,
      protocolStepCount: protocolPlan.steps.length,
      questionnaireDefinitions: [{
        questionnaireId: definition.questionnaireId,
        definitionSha256: definition.definitionSha256,
      }],
      questionnaireModules: [{
        protocolStepPosition: 1,
        moduleId: module.moduleId,
        questionnaireId: definition.questionnaireId,
        definitionSha256: definition.definitionSha256,
        status: partial ? "draft" : "submitted",
        responseCount: 1,
      }],
      submittedResponseCount: submitted.length,
      draftResponseCount: drafts.length,
      submittedResponsesSha256: await canonicalSha256(submitted),
      draftResponsesSha256: await canonicalSha256(drafts),
    },
    timing: {
      sampleRateHz: 130,
      sampleCount: samples.length,
      eventCount: events.length,
      gapEventCount: 0,
      missedSlotCount: 0,
      questionnaireSubmittedResponseCount: submitted.length,
      questionnaireDraftResponseCount: drafts.length,
      startedAt: STARTED_AT,
      finalizedAt: FINALIZED_AT,
    },
    outputs,
    recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
    build: { platform: "chrome", appVersion: "0.4.0-alpha.1", buildCommit: "workspace-v3-test" },
  });
  artifacts["manifest.json"] = `${canonicalJson(manifest)}\n`;
  return { artifacts, manifest, response, samples };
}

async function materialize(fixture) {
  const root = new MemoryDirectoryHandle();
  const workspace = new BrowserResearchWorkspace(root);
  await workspace.initialize();
  const directory = await workspace.createAttemptDirectory({
    experimentId: "experiment-1",
    participantId: "P001",
    sessionStem: SESSION_STEM,
  });
  await workspace.writeAttemptArtifacts(directory, fixture.artifacts);
  return { workspace, directory };
}

test("Manifest V3 workspace attestation accepts a complete canonical questionnaire attempt", async () => {
  const fixture = await createFixture();
  const { workspace } = await materialize(fixture);
  const result = await workspace.listRunManifests("experiment-1");
  assert.deepEqual(result.issues, []);
  assert.equal(result.manifests.length, 1);
  assert.equal(result.manifests[0].version, 3);
  assert.equal(result.manifests[0].completionStatus, "completed");
});

test("Manifest V3 workspace attestation accepts a partial attempt with one bound draft", async () => {
  const fixture = await createFixture({ partial: true });
  const { workspace } = await materialize(fixture);
  const result = await workspace.listRunManifests("experiment-1");
  assert.deepEqual(result.issues, []);
  assert.equal(result.manifests[0].protocol.questionnaireModules[0].status, "draft");
  assert.equal(result.manifests[0].protocol.safeProtocolStepPosition, 0);
});

test("Manifest V3 workspace attestation isolates missing and tampered questionnaire artifacts", async (t) => {
  await t.test("missing protocol snapshot", async () => {
    const fixture = await createFixture();
    const { workspace, directory } = await materialize(fixture);
    await directory.removeEntry("protocol-plan.snapshot.json");
    const result = await workspace.listRunManifests("experiment-1");
    assert.equal(result.manifests.length, 0);
    assert.equal(result.issues[0].code, "artifact-missing");
  });
  await t.test("tampered response bytes", async () => {
    const fixture = await createFixture();
    const { workspace, directory } = await materialize(fixture);
    const handle = directory.children.get("questionnaire-responses.csv");
    handle.file = new File([`${fixture.artifacts["questionnaire-responses.csv"]}x`], handle.name);
    const result = await workspace.listRunManifests("experiment-1");
    assert.equal(result.manifests.length, 0);
    assert.equal(result.issues[0].code, "artifact-size");
  });
  await t.test("mislabeled output kind", async () => {
    const fixture = await createFixture();
    const changed = structuredClone(fixture.manifest);
    changed.outputs.find(({ kind }) => kind === "protocolPlan").fileName = "protocol.json";
    fixture.artifacts["manifest.json"] = `${canonicalJson(changed)}\n`;
    const { workspace } = await materialize(fixture);
    const result = await workspace.listRunManifests("experiment-1");
    assert.equal(result.manifests.length, 0);
    assert.equal(result.issues[0].code, "artifact-name");
  });
});

test("Manifest V3 workspace attestation rejects semantic questionnaire CSV/TSV drift", async () => {
  const fixture = await createFixture();
  const changedResponse = { ...fixture.response, responseLatencyMs: 501 };
  const changedTsv = questionnaireResponsesToTsv([changedResponse]);
  fixture.artifacts["questionnaire-responses.tsv"] = changedTsv;
  const changedManifest = structuredClone(fixture.manifest);
  const receipt = changedManifest.outputs.find(({ kind }) => kind === "questionnaireTsv");
  receipt.sha256 = await sha256Hex(changedTsv);
  receipt.byteLength = new TextEncoder().encode(changedTsv).byteLength;
  fixture.artifacts["manifest.json"] = `${canonicalJson(changedManifest)}\n`;
  const { workspace } = await materialize(fixture);
  const result = await workspace.listRunManifests("experiment-1");
  assert.equal(result.manifests.length, 0);
  assert.equal(result.issues[0].code, "artifact-table-parity");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { canonicalSha256 } from "../site/src/research/canonical.js";
import {
  IndexedDbResearchJournal,
  MemoryResearchJournal,
  RESEARCH_JOURNAL_VERSION,
} from "../site/src/research/browser-journal.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { resolveAssignmentPlan } from "../site/src/research/counterbalancer.js";
import {
  QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
  projectResearchSettingsV2ToAssignmentSettingsV1,
  resolveProtocolPlanV1,
  validateResearchSettingsV2,
} from "../site/src/research/protocol-plan.js";
import { RESEARCH_RUN_MANIFEST_V3_SCHEMA } from "../site/src/research/protocol-records.js";
import {
  idbRequestResult,
  idbTransactionDone,
  ResearchIdbKeyRange,
  ResearchIndexedDbHarness,
} from "./support/research-indexeddb-harness.js";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function definition({ itemRequirements = [true, true] } = {}) {
  const value = {
    schema: "affect-research-questionnaire-definition",
    version: 1,
    questionnaireId: "check-in",
    questionnaireVersion: "1.0",
    title: "Check-in",
    language: "en",
    instructions: "Choose one response for every item.",
    attribution: "Project-authored browser journal fixture.",
    source: {
      kind: "researcherCsv",
      logicalName: "check-in.csv",
      sourceDocumentSha256: null,
      formatVersion: "questionnaire-csv-v1",
      byteLength: 128,
      sha256: digest("check-in-source"),
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
        prompt: "How tense do you feel?",
        required: itemRequirements[1],
        subscale: "calm",
        options: [
          { optionId: "low", order: 1, label: "Low", scoreValue: 4 },
          { optionId: "high", order: 2, label: "High", scoreValue: 0 },
        ],
      },
    ],
    definitionSha256: "0".repeat(64),
  };
  value.definitionSha256 = await canonicalSha256(value, {
    omitRootKeys: ["definitionSha256"],
  });
  return value;
}

function stimulus() {
  return {
    stimulusId: "video-01",
    title: "Video 01",
    source: {
      kind: "workspaceFile",
      relativePath: "stimuli/video-01.mp4",
      mimeType: "video/mp4",
      sha256: digest("video-01"),
      byteLength: 1_024,
      durationMs: 30_000,
    },
  };
}

async function fixture({ itemRequirements = [true, true] } = {}) {
  const questionnaire = await definition({ itemRequirements });
  const rawSettings = structuredClone(createDefaultResearchSettings());
  rawSettings.version = 2;
  rawSettings.experiment.participantCount = 1;
  rawSettings.stimuli.items = [stimulus()];
  rawSettings.stimuli.pools = [{
    poolId: "main",
    label: "Main",
    videosPerParticipant: 1,
    stimulusIds: ["video-01"],
  }];
  rawSettings.questionnaires = {
    algorithmVersion: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    definitions: [questionnaire],
    modules: [{
      schema: "affect-research-questionnaire-module",
      version: 1,
      moduleId: "before-session-check-in",
      questionnaireId: questionnaire.questionnaireId,
      definitionSha256: questionnaire.definitionSha256,
      placement: { kind: "beforeSession", poolId: null },
    }],
  };
  const settings = await validateResearchSettingsV2(rawSettings);
  const assignmentSettings = await projectResearchSettingsV2ToAssignmentSettingsV1(settings);
  const plan = await resolveAssignmentPlan(assignmentSettings);
  const protocolPlan = await resolveProtocolPlanV1(settings, plan, "P001");
  return {
    settings,
    plan,
    protocolPlan,
    reservation: {
      runId: RUN_ID,
      experimentId: settings.experiment.id,
      participantId: "P001",
      attemptNumber: 1,
      sessionStem: "P001_EF_A27_GW_HR_20260908T143012482Z_R01",
      settingsHash: protocolPlan.settingsSha256,
      planHash: plan.planHashSha256,
      protocolPlanHash: protocolPlan.protocolPlanHashSha256,
      createdAt: "2026-09-08T14:30:12.482Z",
      ownerId: "tab-questionnaire-1",
      context: {
        workspaceId: WORKSPACE_ID,
        settings,
        plan,
        protocolPlan,
        participant: { participantCode: "EF", age: 27, gender: "W", handedness: "R" },
        resumed: false,
        sourceRunId: null,
        restartedStimulusIds: [],
      },
    },
  };
}

function answer(itemId, optionId, index) {
  return {
    itemId,
    optionId,
    wallTimeUtc: `2026-09-08T14:30:${String(13 + index).padStart(2, "0")}.000Z`,
    monotonicTimeNs: String(100 + index),
    responseLatencyMs: 250 + index,
  };
}

function submission(answers) {
  return {
    runId: RUN_ID,
    expectedEventSequence: 1,
    expectedQuestionnaireResponseSequence: 1,
    expectedSafeProtocolStepPosition: 0,
    protocolStepPosition: 1,
    answers,
    completionEvent: {
      wallTimeUtc: "2026-09-08T14:30:20.000Z",
      monotonicTimeNs: "200",
      detailCode: "questionnaire-complete",
    },
    updatedAt: "2026-09-08T14:30:20.000Z",
  };
}

async function prepareQuestionnaire(journal, data) {
  await journal.reserveProtocolAttempt(data.reservation);
  return journal.setProtocolState({
    runId: RUN_ID,
    activeProtocolStepPosition: 1,
    safeProtocolStepPosition: 0,
    updatedAt: "2026-09-08T14:30:13.000Z",
  });
}

function createIndexedJournal(indexedDB, databaseName) {
  return new IndexedDbResearchJournal({
    indexedDB,
    keyRange: ResearchIdbKeyRange,
    databaseName,
  });
}

async function manifestV3(journal, data, { completionStatus, finalizedAt }) {
  const attempt = await journal.getAttempt(RUN_ID);
  const submitted = await journal.readQuestionnaireResponses(RUN_ID);
  const draft = attempt.activeQuestionnaireDraft?.responses ?? [];
  const samples = await journal.readRecords(RUN_ID, { kind: "samples" });
  const events = await journal.readRecords(RUN_ID, { kind: "events" });
  const questionnaireSteps = data.protocolPlan.steps.filter(({ kind }) => kind === "questionnaire");
  const questionnaireModules = questionnaireSteps.map((step) => {
    const submittedRows = submitted.filter(({ protocolStepPosition }) => (
      protocolStepPosition === step.protocolPosition
    ));
    const draftRows = draft.filter(({ protocolStepPosition }) => (
      protocolStepPosition === step.protocolPosition
    ));
    return {
      protocolStepPosition: step.protocolPosition,
      moduleId: step.moduleId,
      questionnaireId: step.questionnaireId,
      definitionSha256: step.definitionSha256,
      status: step.protocolPosition <= attempt.safeProtocolStepPosition
        ? "submitted"
        : (draftRows.length > 0
          || attempt.activeProtocolStep?.protocolPosition === step.protocolPosition)
          ? "draft"
          : "notReached",
      responseCount: submittedRows.length + draftRows.length,
    };
  });
  const gapEvents = events.filter(({ type }) => type === "timingGap");
  const stimulusIdentities = data.plan.assignments[0].slots.map((slot) => {
    const selected = data.plan.stimuli.find(({ stimulusId }) => stimulusId === slot.stimulusId);
    const source = selected.source;
    return {
      kind: source.kind,
      stimulusId: selected.stimulusId,
      sha256: source.kind === "youtube" ? null : source.sha256,
      byteLength: source.kind === "youtube" ? null : source.byteLength,
      durationMs: source.kind === "youtube" ? source.observedDurationMs : source.durationMs,
      url: source.kind === "youtube" ? source.url : null,
      videoId: source.kind === "youtube" ? source.videoId : null,
    };
  });
  const questionnaireRowCount = submitted.length + draft.length;
  return {
    schema: RESEARCH_RUN_MANIFEST_V3_SCHEMA,
    version: 3,
    runId: RUN_ID,
    experimentId: attempt.experimentId,
    participantId: attempt.participantId,
    participantCode: attempt.context.participant.participantCode,
    age: attempt.context.participant.age,
    gender: attempt.context.participant.gender,
    handedness: attempt.context.participant.handedness,
    attemptNumber: attempt.attemptNumber,
    sessionStem: attempt.sessionStem,
    completionStatus,
    playbackMode: "browserMediaAdapters",
    playbackQualification: "browser",
    settingsSha256: attempt.settingsHash,
    assignmentPlanSha256: attempt.planHash,
    protocolPlanSha256: attempt.protocolPlanHash,
    stimuli: stimulusIdentities,
    protocol: {
      safeProtocolStepPosition: attempt.safeProtocolStepPosition,
      protocolStepCount: data.protocolPlan.steps.length,
      questionnaireDefinitions: data.settings.questionnaires.definitions.map((entry) => ({
        questionnaireId: entry.questionnaireId,
        definitionSha256: entry.definitionSha256,
      })),
      questionnaireModules,
      submittedResponseCount: submitted.length,
      draftResponseCount: draft.length,
      submittedResponsesSha256: await canonicalSha256(submitted),
      draftResponsesSha256: await canonicalSha256(draft),
    },
    timing: {
      sampleRateHz: data.settings.experiment.samplingFrequencyHz,
      sampleCount: samples.length,
      eventCount: events.length,
      gapEventCount: gapEvents.length,
      missedSlotCount: gapEvents.reduce((sum, event) => sum + event.missedSlotCount, 0),
      questionnaireSubmittedResponseCount: submitted.length,
      questionnaireDraftResponseCount: draft.length,
      startedAt: attempt.context.startedAt ?? attempt.createdAt,
      finalizedAt,
    },
    outputs: [
      { kind: "settings", fileName: "settings.snapshot.json", sha256: digest("settings-output"), byteLength: 10, rowCount: null },
      { kind: "protocolPlan", fileName: "protocol-plan.snapshot.json", sha256: digest("protocol-output"), byteLength: 10, rowCount: null },
      { kind: "events", fileName: "events.jsonl", sha256: digest("events-output"), byteLength: 10, rowCount: null },
      { kind: "ratingsCsv", fileName: "ratings.csv", sha256: digest("ratings-output"), byteLength: 10, rowCount: samples.length },
      { kind: "questionnaireCsv", fileName: "questionnaire-responses.csv", sha256: digest("questionnaire-output"), byteLength: 10, rowCount: questionnaireRowCount },
    ],
    recovery: {
      resumed: attempt.context.resumed === true,
      sourceRunId: attempt.context.sourceRunId ?? null,
      restartedStimulusIds: structuredClone(attempt.context.restartedStimulusIds ?? []),
    },
    build: attempt.context.build ?? {
      platform: "chrome",
      appVersion: "0.4.0-alpha.1",
      buildCommit: "questionnaire-journal-test",
    },
  };
}

async function completeProtocol(journal, data) {
  await prepareQuestionnaire(journal, data);
  await journal.submitQuestionnaireStep(submission([
    answer("item-01", "low", 0),
    answer("item-02", "high", 1),
  ]));
  await journal.setProtocolState({
    runId: RUN_ID,
    activeProtocolStepPosition: 2,
    safeProtocolStepPosition: 1,
    updatedAt: "2026-09-08T14:30:21.000Z",
  });
  return journal.setProtocolState({
    runId: RUN_ID,
    activeProtocolStepPosition: null,
    safeProtocolStepPosition: 2,
    updatedAt: "2026-09-08T14:30:22.000Z",
  });
}

test("Memory V2 restores a durable questionnaire draft and atomically derives submitted scores", async () => {
  const data = await fixture();
  const journal = new MemoryResearchJournal();
  await prepareQuestionnaire(journal, data);

  await assert.rejects(journal.checkpointQuestionnaireDraft({
    runId: RUN_ID,
    expectedSafeProtocolStepPosition: 0,
    protocolStepPosition: 1,
    answers: [{ ...answer("item-01", "high", 0), scoreValue: 999 }],
    updatedAt: "2026-09-08T14:30:14.000Z",
  }), /unsupported shape/u);

  const drafted = await journal.checkpointQuestionnaireDraft({
    runId: RUN_ID,
    expectedSafeProtocolStepPosition: 0,
    protocolStepPosition: 1,
    answers: [answer("item-01", "high", 0)],
    updatedAt: "2026-09-08T14:30:14.000Z",
  });
  assert.equal(drafted.activeQuestionnaireDraft.responses[0].scoreValue, 4);
  assert.equal(drafted.activeQuestionnaireDraft.responses[0].status, "draft");
  await assert.rejects(journal.setProtocolState({
    runId: RUN_ID,
    activeProtocolStepPosition: null,
    safeProtocolStepPosition: 1,
    updatedAt: "2026-09-08T14:30:14.500Z",
  }), /atomic submit transaction/u);

  const interrupted = await journal.markInterrupted({
    runId: RUN_ID,
    reason: "forced-termination",
    updatedAt: "2026-09-08T14:30:15.000Z",
  });
  assert.equal(interrupted.status, "partial");
  assert.equal(interrupted.activeProtocolStep.kind, "questionnaire");
  assert.equal(interrupted.activeQuestionnaireDraft.responses[0].optionId, "high");

  const resumed = await journal.resumeAttempt({
    runId: RUN_ID,
    ownerId: "tab-questionnaire-2",
    resumedAt: "2026-09-08T14:30:16.000Z",
  });
  assert.equal(resumed.activeProtocolStep.protocolPosition, 1);
  assert.equal(resumed.activeQuestionnaireDraft.responses.length, 1);

  const submitted = await journal.submitQuestionnaireStep(submission([
    answer("item-01", "low", 0),
    answer("item-02", "high", 1),
  ]));
  assert.equal(submitted.safeProtocolStepPosition, 1);
  assert.equal(submitted.activeProtocolStep, null);
  assert.equal(submitted.activeQuestionnaireDraft, null);
  assert.equal(submitted.nextQuestionnaireResponseSequence, 3);
  assert.equal(submitted.nextEventSequence, 2);

  const responses = await journal.readQuestionnaireResponses(RUN_ID);
  assert.deepEqual(responses.map(({ itemId, optionId, responseLabel, scoreValue, status }) => ({
    itemId,
    optionId,
    responseLabel,
    scoreValue,
    status,
  })), [
    { itemId: "item-01", optionId: "low", responseLabel: "Low", scoreValue: 0, status: "submitted" },
    { itemId: "item-02", optionId: "high", responseLabel: "High", scoreValue: 0, status: "submitted" },
  ]);
  const events = await journal.readRecords(RUN_ID, { kind: "events" });
  assert.equal(events[0].version, 2);
  assert.equal(events[0].type, "questionnaireCompleted");
  assert.equal(events[0].protocolPlanSha256, data.protocolPlan.protocolPlanHashSha256);

  await assert.rejects(journal.prepareFinalization({
    runId: RUN_ID,
    completionStatus: "completed",
    finalizedAt: "2026-09-08T14:30:21.000Z",
    recovery: { resumed: true, sourceRunId: RUN_ID, restartedStimulusIds: [] },
  }), /every protocol step/u);
});

test("optional questionnaire items may remain unanswered through atomic submission and finalization", async () => {
  for (const testCase of [
    {
      label: "one-required-one-optional",
      itemRequirements: [true, false],
      answers: [answer("item-01", "low", 0)],
    },
    {
      label: "all-optional",
      itemRequirements: [false, false],
      answers: [],
    },
  ]) {
    const data = await fixture({ itemRequirements: testCase.itemRequirements });
    const journal = new MemoryResearchJournal();
    await prepareQuestionnaire(journal, data);
    const submitted = await journal.submitQuestionnaireStep(submission(testCase.answers));
    assert.equal(submitted.safeProtocolStepPosition, 1, testCase.label);
    assert.equal(submitted.nextQuestionnaireResponseSequence, testCase.answers.length + 1, testCase.label);
    await journal.setProtocolState({
      runId: RUN_ID,
      activeProtocolStepPosition: 2,
      safeProtocolStepPosition: 1,
      updatedAt: "2026-09-08T14:30:21.000Z",
    });
    await journal.setProtocolState({
      runId: RUN_ID,
      activeProtocolStepPosition: null,
      safeProtocolStepPosition: 2,
      updatedAt: "2026-09-08T14:30:22.000Z",
    });
    const finalizedAt = "2026-09-08T14:30:23.000Z";
    await journal.prepareFinalization({
      runId: RUN_ID,
      completionStatus: "completed",
      finalizedAt,
      recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
    });
    const manifest = await manifestV3(journal, data, {
      completionStatus: "completed",
      finalizedAt,
    });
    const terminal = await journal.finalizeProtocol({
      runId: RUN_ID,
      status: "complete",
      manifest,
      finalizedAt,
    });
    assert.equal(terminal.status, "complete", testCase.label);
    assert.deepEqual(terminal.manifest.protocol.questionnaireModules, [{
      protocolStepPosition: 1,
      moduleId: "before-session-check-in",
      questionnaireId: "check-in",
      definitionSha256: data.settings.questionnaires.definitions[0].definitionSha256,
      status: "submitted",
      responseCount: testCase.answers.length,
    }], testCase.label);
  }
});

test("IndexedDB abort and quota failure preserve the last draft and no submitted prefix after reload", async () => {
  for (const failure of ["abort", "quota"]) {
    const data = await fixture();
    const indexedDB = new ResearchIndexedDbHarness();
    const databaseName = `questionnaire-${failure}`;
    const first = createIndexedJournal(indexedDB, databaseName);
    await prepareQuestionnaire(first, data);
    await first.checkpointQuestionnaireDraft({
      runId: RUN_ID,
      expectedSafeProtocolStepPosition: 0,
      protocolStepPosition: 1,
      answers: [answer("item-01", "high", 0)],
      updatedAt: "2026-09-08T14:30:14.000Z",
    });
    if (failure === "abort") {
      indexedDB.abortNextReadwriteCommit();
    } else {
      indexedDB.rejectNextRequest({
        storeName: "questionnaire-responses",
        operation: "add",
        error: new DOMException("Injected quota rejection.", "QuotaExceededError"),
      });
    }
    await assert.rejects(first.submitQuestionnaireStep(submission([
      answer("item-01", "low", 0),
      answer("item-02", "high", 1),
    ])), failure === "quota" ? /quota/iu : /abort/iu);
    await first.close();

    const reloaded = createIndexedJournal(indexedDB, databaseName);
    const attempt = await reloaded.getAttempt(RUN_ID);
    assert.equal(attempt.safeProtocolStepPosition, 0);
    assert.equal(attempt.nextQuestionnaireResponseSequence, 1);
    assert.equal(attempt.nextEventSequence, 1);
    assert.equal(attempt.activeQuestionnaireDraft.responses[0].optionId, "high");
    assert.deepEqual(await reloaded.readQuestionnaireResponses(RUN_ID), []);
    assert.deepEqual(await reloaded.readRecords(RUN_ID, { kind: "events" }), []);
    const reconciled = await reloaded.reconcileAbandonedAttempts({
      reason: "exclusive-runtime-recovery",
      updatedAt: "2026-09-08T14:30:21.000Z",
    });
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].status, "partial");
    assert.equal(reconciled[0].activeProtocolStep.kind, "questionnaire");
    assert.equal(reconciled[0].activeQuestionnaireDraft.responses[0].optionId, "high");
    const resumed = await reloaded.resumeAttempt({
      runId: RUN_ID,
      ownerId: `tab-${failure}-reloaded`,
      resumedAt: "2026-09-08T14:30:22.000Z",
    });
    assert.equal(resumed.activeProtocolStep.protocolPosition, 1);
    assert.equal(resumed.activeQuestionnaireDraft.responses.length, 1);
    await reloaded.close();
  }
});

test("Memory finalizeProtocol binds a complete ManifestV3 and releases the participant lock", async () => {
  const data = await fixture();
  const journal = new MemoryResearchJournal();
  await completeProtocol(journal, data);
  const finalizedAt = "2026-09-08T14:30:23.000Z";
  await journal.prepareFinalization({
    runId: RUN_ID,
    completionStatus: "completed",
    finalizedAt,
    recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
  });
  const manifest = await manifestV3(journal, data, { completionStatus: "completed", finalizedAt });
  const terminal = await journal.finalizeProtocol({
    runId: RUN_ID,
    status: "complete",
    manifest,
    finalizedAt,
  });

  assert.equal(terminal.status, "complete");
  assert.equal(terminal.safeProtocolStepPosition, data.protocolPlan.steps.length);
  assert.equal(terminal.activeProtocolStep, null);
  assert.equal(terminal.activeQuestionnaireDraft, null);
  assert.deepEqual(terminal.manifest, manifest);
  assert.deepEqual(await journal.participantStates(
    data.settings.experiment.id,
    ["P001"],
    { workspaceId: WORKSPACE_ID },
  ), [{ participantId: "P001", state: "Complete", attempts: 1 }]);
  assert.equal((await journal.readQuestionnaireResponses(RUN_ID)).length, 2);
  assert.equal((await journal.getAttempt(RUN_ID)).status, "complete");
  assert.deepEqual(await journal.listQuarantinedRecords(), []);
});

test("Memory finalizeProtocol preserves a partial draft and rejects a spoofed response hash", async () => {
  const data = await fixture();
  const journal = new MemoryResearchJournal();
  await prepareQuestionnaire(journal, data);
  await journal.checkpointQuestionnaireDraft({
    runId: RUN_ID,
    expectedSafeProtocolStepPosition: 0,
    protocolStepPosition: 1,
    answers: [answer("item-01", "high", 0)],
    updatedAt: "2026-09-08T14:30:14.000Z",
  });
  const finalizedAt = "2026-09-08T14:30:23.000Z";
  await journal.prepareFinalization({
    runId: RUN_ID,
    completionStatus: "partial",
    finalizedAt,
    recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
  });
  const manifest = await manifestV3(journal, data, { completionStatus: "partial", finalizedAt });
  const spoofed = structuredClone(manifest);
  spoofed.protocol.draftResponsesSha256 = digest("spoofed-response-rows");
  await assert.rejects(journal.finalizeProtocol({
    runId: RUN_ID,
    status: "partial",
    manifest: spoofed,
    finalizedAt,
  }), /questionnaire receipts/u);
  const stillActive = await journal.getAttempt(RUN_ID);
  assert.equal(stillActive.status, "active");
  assert.equal(stillActive.activeQuestionnaireDraft.responses.length, 1);
  assert.deepEqual(await journal.readQuestionnaireResponses(RUN_ID), []);

  const terminal = await journal.finalizeProtocol({
    runId: RUN_ID,
    status: "partial",
    manifest,
    finalizedAt,
  });
  assert.equal(terminal.status, "partial");
  assert.equal(terminal.recoverable, false);
  assert.equal(terminal.activeQuestionnaireDraft, null);
  const responses = await journal.readQuestionnaireResponses(RUN_ID);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, "draft");
  assert.equal(responses[0].scoreValue, 4);
  assert.deepEqual(await journal.participantStates(
    data.settings.experiment.id,
    ["P001"],
    { workspaceId: WORKSPACE_ID },
  ), [{ participantId: "P001", state: "Partial", attempts: 1 }]);
});

test("Memory finalizeProtocol records an opened unanswered questionnaire as an empty draft", async () => {
  const data = await fixture();
  const journal = new MemoryResearchJournal();
  await prepareQuestionnaire(journal, data);
  const finalizedAt = "2026-09-08T14:30:23.000Z";
  await journal.prepareFinalization({
    runId: RUN_ID,
    completionStatus: "partial",
    finalizedAt,
    recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
  });
  const manifest = await manifestV3(journal, data, { completionStatus: "partial", finalizedAt });
  assert.equal(manifest.protocol.questionnaireModules[0].status, "draft");
  assert.equal(manifest.protocol.questionnaireModules[0].responseCount, 0);
  const terminal = await journal.finalizeProtocol({
    runId: RUN_ID,
    status: "partial",
    manifest,
    finalizedAt,
  });
  assert.equal(terminal.manifest.protocol.draftResponseCount, 0);
  assert.deepEqual(await journal.readQuestionnaireResponses(RUN_ID), []);
  assert.equal((await journal.getAttempt(RUN_ID)).status, "partial");
});

test("IndexedDB finalizeProtocol abort and quota failure retain draft, manifest intent, and lock", async () => {
  for (const failure of ["abort", "quota"]) {
    const data = await fixture();
    const indexedDB = new ResearchIndexedDbHarness();
    const databaseName = `questionnaire-finalize-${failure}`;
    const first = createIndexedJournal(indexedDB, databaseName);
    await prepareQuestionnaire(first, data);
    await first.checkpointQuestionnaireDraft({
      runId: RUN_ID,
      expectedSafeProtocolStepPosition: 0,
      protocolStepPosition: 1,
      answers: [answer("item-01", "high", 0)],
      updatedAt: "2026-09-08T14:30:14.000Z",
    });
    const finalizedAt = "2026-09-08T14:30:23.000Z";
    await first.prepareFinalization({
      runId: RUN_ID,
      completionStatus: "partial",
      finalizedAt,
      recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
    });
    const manifest = await manifestV3(first, data, { completionStatus: "partial", finalizedAt });
    if (failure === "abort") {
      indexedDB.abortNextReadwriteCommit();
    } else {
      indexedDB.rejectNextRequest({
        storeName: "questionnaire-responses",
        operation: "add",
        error: new DOMException("Injected quota rejection.", "QuotaExceededError"),
      });
    }
    await assert.rejects(first.finalizeProtocol({
      runId: RUN_ID,
      status: "partial",
      manifest,
      finalizedAt,
    }), failure === "quota" ? /quota/iu : /abort/iu);
    await first.close();

    const reloaded = createIndexedJournal(indexedDB, databaseName);
    const attempt = await reloaded.getAttempt(RUN_ID);
    assert.equal(attempt.status, "active");
    assert.equal(attempt.manifest, null);
    assert.equal(attempt.pendingFinalization.finalizedAt, finalizedAt);
    assert.equal(attempt.activeQuestionnaireDraft.responses[0].optionId, "high");
    assert.deepEqual(await reloaded.readQuestionnaireResponses(RUN_ID), []);
    assert.deepEqual(await reloaded.participantStates(
      data.settings.experiment.id,
      ["P001"],
      { workspaceId: WORKSPACE_ID },
    ), [{ participantId: "P001", state: "Active", attempts: 1 }]);
    await reloaded.close();
  }
});

test("IndexedDB finalizeProtocol persists one terminal draft transaction across reload", async () => {
  const data = await fixture();
  const indexedDB = new ResearchIndexedDbHarness();
  const databaseName = "questionnaire-finalize-success";
  const first = createIndexedJournal(indexedDB, databaseName);
  await prepareQuestionnaire(first, data);
  await first.checkpointQuestionnaireDraft({
    runId: RUN_ID,
    expectedSafeProtocolStepPosition: 0,
    protocolStepPosition: 1,
    answers: [answer("item-01", "high", 0)],
    updatedAt: "2026-09-08T14:30:14.000Z",
  });
  const finalizedAt = "2026-09-08T14:30:23.000Z";
  await first.prepareFinalization({
    runId: RUN_ID,
    completionStatus: "partial",
    finalizedAt,
    recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
  });
  const manifest = await manifestV3(first, data, { completionStatus: "partial", finalizedAt });
  const terminal = await first.finalizeProtocol({
    runId: RUN_ID,
    status: "partial",
    manifest,
    finalizedAt,
  });
  assert.equal(terminal.nextQuestionnaireResponseSequence, 2);
  await first.close();

  const reloaded = createIndexedJournal(indexedDB, databaseName);
  const restored = await reloaded.getAttempt(RUN_ID);
  assert.equal(restored.status, "partial");
  assert.equal(restored.recoverable, false);
  assert.equal(restored.manifest.protocol.draftResponseCount, 1);
  assert.equal(restored.activeQuestionnaireDraft, null);
  const responses = await reloaded.readQuestionnaireResponses(RUN_ID);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, "draft");
  assert.deepEqual(await reloaded.listQuarantinedRecords(), []);
  await reloaded.close();
});

test("IndexedDB V3 migration adds response storage without rewriting a historical V1 attempt", async () => {
  const indexedDB = new ResearchIndexedDbHarness();
  const databaseName = "questionnaire-v1-migration";
  const legacyMemory = new MemoryResearchJournal();
  const legacyAttempt = await legacyMemory.reserveAttempt({
    runId: "run-legacy-001",
    experimentId: "experiment-1",
    participantId: "P009",
    attemptNumber: 1,
    sessionStem: "P009_EF_A27_GW_HR_20260908T143012482Z_R01",
    settingsHash: "a".repeat(64),
    planHash: "b".repeat(64),
    createdAt: "2026-09-08T14:30:12.482Z",
    ownerId: "tab-legacy-1",
    context: {
      workspaceId: WORKSPACE_ID,
      participant: { participantCode: "EF", age: 27, gender: "W", handedness: "R" },
    },
  });
  const oldOpen = indexedDB.open(databaseName, 2);
  oldOpen.addEventListener("upgradeneeded", () => {
    const database = oldOpen.result;
    const attempts = database.createObjectStore("attempts", { keyPath: "runId" });
    attempts.createIndex("experimentId", "experimentId", { unique: false });
    database.createObjectStore("samples", { keyPath: ["runId", "sequence"] });
    database.createObjectStore("events", { keyPath: ["runId", "sequence"] });
    database.createObjectStore("participant-locks", { keyPath: "key" });
    database.createObjectStore("quarantine", { autoIncrement: true });
  });
  const oldDatabase = await idbRequestResult(oldOpen);
  const oldWrite = oldDatabase.transaction(["attempts"], "readwrite");
  oldWrite.objectStore("attempts").add(structuredClone(legacyAttempt));
  await idbTransactionDone(oldWrite);
  oldDatabase.close();

  const migrated = createIndexedJournal(indexedDB, databaseName);
  assert.deepEqual(await migrated.getAttempt("run-legacy-001"), legacyAttempt);
  await assert.rejects(
    migrated.readQuestionnaireResponses("run-legacy-001"),
    /Historical V1 attempts/u,
  );
  await migrated.close();

  const readbackDatabase = await idbRequestResult(
    indexedDB.open(databaseName, RESEARCH_JOURNAL_VERSION),
  );
  assert.equal(readbackDatabase.objectStoreNames.contains("questionnaire-responses"), true);
  const readback = readbackDatabase.transaction(["attempts"], "readonly");
  const rawAttempt = await idbRequestResult(readback.objectStore("attempts").get("run-legacy-001"));
  await idbTransactionDone(readback);
  assert.deepEqual(rawAttempt, legacyAttempt);
  readbackDatabase.close();
});

test("IndexedDB audit preserves and quarantines a response whose score was corrupted", async () => {
  const data = await fixture();
  const indexedDB = new ResearchIndexedDbHarness();
  const databaseName = "questionnaire-corruption";
  const first = createIndexedJournal(indexedDB, databaseName);
  await prepareQuestionnaire(first, data);
  await first.submitQuestionnaireStep(submission([
    answer("item-01", "low", 0),
    answer("item-02", "high", 1),
  ]));
  await first.close();

  const database = await idbRequestResult(indexedDB.open(databaseName, RESEARCH_JOURNAL_VERSION));
  const read = database.transaction(["questionnaire-responses"], "readonly");
  const entry = await idbRequestResult(
    read.objectStore("questionnaire-responses").get([RUN_ID, 1]),
  );
  await idbTransactionDone(read);
  entry.value.scoreValue = 999;
  const write = database.transaction(["questionnaire-responses"], "readwrite");
  write.objectStore("questionnaire-responses").put(entry);
  await idbTransactionDone(write);
  database.close();

  const reloaded = createIndexedJournal(indexedDB, databaseName);
  assert.equal(await reloaded.getAttempt(RUN_ID), undefined);
  const quarantine = await reloaded.listQuarantinedRecords();
  assert.equal(quarantine.length, 1);
  assert.match(quarantine[0].reason, /score differs/u);
  assert.equal(quarantine[0].evidence.questionnaireResponses.length, 2);
  assert.equal(quarantine[0].evidence.questionnaireResponses[0].value.scoreValue, 999);
  await reloaded.close();
});

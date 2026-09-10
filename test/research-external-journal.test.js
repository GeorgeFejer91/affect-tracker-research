import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { canonicalSha256 } from "../site/src/research/canonical.js";
import {
  IndexedDbResearchJournal,
  MemoryResearchJournal,
} from "../site/src/research/browser-journal.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import {
  EXTERNAL_ORDER_ALGORITHM_VERSION,
  parseExperimentDefinitionV1,
} from "../site/src/research/external-experiment.js";
import {
  QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
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
  RESEARCH_RUN_MANIFEST_V3_SCHEMA,
  RESEARCH_RUN_MANIFEST_V4_SCHEMA,
  validateResearchRunManifestV3,
} from "../site/src/research/protocol-records.js";
import {
  ResearchIdbKeyRange,
  ResearchIndexedDbHarness,
} from "./support/research-indexeddb-harness.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function questionnaireDefinition() {
  const definition = {
    schema: "affect-research-questionnaire-definition",
    version: 1,
    questionnaireId: "readiness",
    questionnaireVersion: "1.0",
    title: "Readiness",
    language: "en",
    instructions: "Choose one response.",
    attribution: "Project-authored external journal fixture.",
    source: {
      kind: "researcherCsv",
      logicalName: "readiness.csv",
      sourceDocumentSha256: null,
      formatVersion: "questionnaire-csv-v1",
      byteLength: 128,
      sha256: digest("readiness-source"),
    },
    items: [{
      itemId: "ready",
      order: 1,
      prompt: "Are you ready?",
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
  return definition;
}

async function fixture(runId, ownerId) {
  const experimentSource = new TextEncoder().encode(JSON.stringify({
    schema: "affect-research-experiment",
    version: 1,
    experimentId: "external-journal",
    title: "External Journal",
    stimuli: [{
      stimulusId: "video-01",
      title: "Video 01",
      relativePath: "stimuli/video-01.mp4",
    }],
    blocks: [{ blockId: "main", label: "Main" }],
    schedules: [{
      participantId: "P001",
      blocks: [{
        blockId: "main",
        videos: [{ stimulusId: "video-01", isiAfterMs: 2_500 }],
      }],
    }],
  }));
  const parsed = await parseExperimentDefinitionV1(experimentSource);
  const stimulus = {
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
  const definition = await questionnaireDefinition();
  const defaults = createDefaultResearchSettings();
  const settings = await validateResearchSettingsV3({
    schema: defaults.schema,
    version: 3,
    experiment: {
      id: parsed.definition.experimentId,
      title: parsed.definition.title,
      participantCount: 1,
      samplingFrequencyHz: 130,
    },
    stimuli: { items: [stimulus] },
    input: defaults.input,
    visual: defaults.visual,
    advanced: defaults.advanced,
    output: defaults.output,
    questionnaires: {
      algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
      definitions: [definition],
      modules: [{
        schema: "affect-research-questionnaire-module",
        version: 2,
        moduleId: "before-session-readiness",
        questionnaireId: definition.questionnaireId,
        definitionSha256: definition.definitionSha256,
        placement: { kind: "beforeSession", blockId: null },
      }],
    },
    externalProtocol: {
      algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
      sourceByteSha256: parsed.sourceByteSha256,
      definitionSha256: parsed.definitionSha256,
      definition: parsed.definition,
    },
  });
  const packageValue = await createExperimentPackageV1({
    packageId: "external-journal-package",
    languageSelection: createFlatLanguageSelectionV1([
      {
        languageId: "en",
        languageTag: "en",
        label: "English",
        questionnaireModuleIds: ["before-session-readiness"],
      },
    ]),
    settings,
  });
  const packageSourceText = await serializeExperimentPackageV1(packageValue);
  const parsedPackage = await parseExperimentPackageV1(
    new TextEncoder().encode(packageSourceText),
  );
  const compiled = await compileExperimentPackageSelectionV1(packageValue, {
    languageId: "en",
    languageSelectionPath: ["en"],
    participantId: "P001",
  });
  const selectedSettings = compiled.settings;
  const plan = compiled.experimentPlan;
  const protocolPlan = compiled.protocolPlan;
  const settingsHash = await canonicalSha256(selectedSettings);
  const experimentPackage = {
    schema: "affect-research-experiment-package-run-binding",
    version: 1,
    sourceText: packageSourceText,
    sourceByteSha256: parsedPackage.canonicalSourceByteSha256,
    packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
    packageId: packageValue.packageId,
    languageId: compiled.languageId,
    languageSelectionPath: compiled.languageSelectionPath,
    assignmentSha256: compiled.assignmentSha256,
    assetBindings: compiled.assetBindings,
  };
  return {
    settings: selectedSettings,
    plan,
    protocolPlan,
    experimentPackage,
    reservation: {
      runId,
      experimentId: selectedSettings.experiment.id,
      participantId: "P001",
      attemptNumber: 1,
      sessionStem: "P001_EF_A27_GW_HR_20260909T143012482Z_R01",
      settingsHash,
      planHash: plan.planHashSha256,
      protocolPlanHash: protocolPlan.protocolPlanHashSha256,
      createdAt: "2026-09-09T14:30:12.482Z",
      ownerId,
      context: {
        workspaceId: WORKSPACE_ID,
        settings: selectedSettings,
        plan,
        protocolPlan,
        experimentSourceText: compiled.experimentDocument.sourceText,
        experimentPackage,
        participant: { participantCode: "EF", age: 27, gender: "W", handedness: "R" },
        startedAt: "2026-09-09T14:30:12.482Z",
        resumed: false,
        sourceRunId: null,
        restartedStimulusIds: [],
        build: {
          platform: "chrome",
          appVersion: "0.4.0-alpha.1",
          buildCommit: "external-journal-test",
        },
      },
    },
  };
}

async function manifest(journal, data, finalizedAt) {
  const attempt = await journal.getAttempt(data.reservation.runId);
  const submitted = await journal.readQuestionnaireResponses(data.reservation.runId);
  const events = await journal.readRecords(data.reservation.runId, { kind: "events" });
  const samples = await journal.readRecords(data.reservation.runId, { kind: "samples" });
  const source = data.plan.stimuli[0].source;
  return {
    schema: RESEARCH_RUN_MANIFEST_V4_SCHEMA,
    version: 4,
    runId: attempt.runId,
    experimentId: attempt.experimentId,
    participantId: attempt.participantId,
    participantCode: attempt.context.participant.participantCode,
    age: attempt.context.participant.age,
    gender: attempt.context.participant.gender,
    handedness: attempt.context.participant.handedness,
    attemptNumber: attempt.attemptNumber,
    sessionStem: attempt.sessionStem,
    completionStatus: "completed",
    playbackMode: "browserMediaAdapters",
    playbackQualification: "browser",
    settingsSha256: attempt.settingsHash,
    assignmentPlanSha256: attempt.planHash,
    protocolPlanSha256: attempt.protocolPlanHash,
    stimuli: [{
      kind: source.kind,
      stimulusId: "video-01",
      sha256: source.sha256,
      byteLength: source.byteLength,
      durationMs: source.durationMs,
      url: null,
      videoId: null,
    }],
    protocol: {
      safeProtocolStepPosition: attempt.safeProtocolStepPosition,
      protocolStepCount: data.protocolPlan.steps.length,
      questionnaireDefinitions: [{
        questionnaireId: data.settings.questionnaires.definitions[0].questionnaireId,
        definitionSha256: data.settings.questionnaires.definitions[0].definitionSha256,
      }],
      questionnaireModules: [{
        protocolStepPosition: 1,
        moduleId: "before-session-readiness",
        questionnaireId: "readiness",
        definitionSha256: data.settings.questionnaires.definitions[0].definitionSha256,
        status: "submitted",
        responseCount: 1,
      }],
      submittedResponseCount: submitted.length,
      draftResponseCount: 0,
      submittedResponsesSha256: await canonicalSha256(submitted),
      draftResponsesSha256: await canonicalSha256([]),
    },
    timing: {
      sampleRateHz: 130,
      sampleCount: samples.length,
      eventCount: events.length,
      gapEventCount: 0,
      missedSlotCount: 0,
      questionnaireSubmittedResponseCount: submitted.length,
      questionnaireDraftResponseCount: 0,
      startedAt: attempt.context.startedAt,
      finalizedAt,
    },
    outputs: [
      { kind: "settings", fileName: "settings.snapshot.json", sha256: digest("settings"), byteLength: 10, rowCount: null },
      {
        kind: "experimentPackage",
        fileName: "experiment.package.json",
        sha256: data.experimentPackage.sourceByteSha256,
        byteLength: new TextEncoder().encode(data.experimentPackage.sourceText).byteLength,
        rowCount: null,
      },
      { kind: "protocolPlan", fileName: "protocol-plan.snapshot.json", sha256: digest("protocol"), byteLength: 10, rowCount: null },
      { kind: "events", fileName: "events.jsonl", sha256: digest("events"), byteLength: 10, rowCount: null },
      { kind: "ratingsCsv", fileName: "ratings.csv", sha256: digest("ratings"), byteLength: 10, rowCount: samples.length },
      { kind: "questionnaireCsv", fileName: "questionnaire-responses.csv", sha256: digest("questionnaire"), byteLength: 10, rowCount: submitted.length },
    ],
    recovery: {
      resumed: true,
      sourceRunId: attempt.runId,
      restartedStimulusIds: [],
    },
    build: structuredClone(attempt.context.build),
    experimentPackage: {
      canonicalSourceByteSha256: data.experimentPackage.sourceByteSha256,
      packageDefinitionSha256: data.experimentPackage.packageDefinitionSha256,
      packageId: data.experimentPackage.packageId,
      languageId: data.experimentPackage.languageId,
      languageSelectionPath: data.experimentPackage.languageSelectionPath,
      assignmentSha256: data.experimentPackage.assignmentSha256,
      assetBindingsSha256: await canonicalSha256(data.experimentPackage.assetBindings),
    },
  };
}

function backends() {
  return [
    {
      name: "Memory",
      create: () => new MemoryResearchJournal(),
    },
    {
      name: "IndexedDB",
      create: () => new IndexedDbResearchJournal({
        indexedDB: new ResearchIndexedDbHarness(),
        keyRange: ResearchIdbKeyRange,
        databaseName: "external-journal-v3",
      }),
    },
  ];
}

for (const [index, backend] of backends().entries()) {
  test(`${backend.name} V3 checkpoints questionnaires and restarts an interrupted authored ISI`, async () => {
    const runId = `33333333-3333-4333-8333-33333333333${index}`;
    const data = await fixture(runId, `external-journal-${index}`);
    const journal = backend.create();
    const reserved = await journal.reserveProtocolAttempt(data.reservation);
    assert.equal(reserved.version, 3);
    assert.deepEqual(data.protocolPlan.steps.map(({ kind }) => kind), [
      "questionnaire", "stimulus", "interval",
    ]);

    await journal.setProtocolState({
      runId,
      activeProtocolStepPosition: 1,
      safeProtocolStepPosition: 0,
      updatedAt: "2026-09-09T14:30:13.000Z",
    });
    const answers = [{
      itemId: "ready",
      optionId: "yes",
      wallTimeUtc: "2026-09-09T14:30:14.000Z",
      monotonicTimeNs: "100",
      responseLatencyMs: 250,
    }];
    const checkpoint = await journal.checkpointQuestionnaireDraft({
      runId,
      expectedSafeProtocolStepPosition: 0,
      protocolStepPosition: 1,
      answers,
      updatedAt: "2026-09-09T14:30:14.000Z",
    });
    assert.equal(checkpoint.activeQuestionnaireDraft.responses.length, 1);
    await journal.submitQuestionnaireStep({
      runId,
      expectedEventSequence: 1,
      expectedQuestionnaireResponseSequence: 1,
      expectedSafeProtocolStepPosition: 0,
      protocolStepPosition: 1,
      answers,
      completionEvent: {
        wallTimeUtc: "2026-09-09T14:30:15.000Z",
        monotonicTimeNs: "200",
        detailCode: "questionnaire-complete",
      },
      updatedAt: "2026-09-09T14:30:15.000Z",
    });
    await journal.setProtocolState({
      runId,
      activeProtocolStepPosition: 2,
      safeProtocolStepPosition: 1,
      updatedAt: "2026-09-09T14:30:16.000Z",
    });
    await journal.setProtocolState({
      runId,
      activeProtocolStepPosition: null,
      safeProtocolStepPosition: 2,
      updatedAt: "2026-09-09T14:30:17.000Z",
    });
    await journal.setProtocolState({
      runId,
      activeProtocolStepPosition: 3,
      safeProtocolStepPosition: 2,
      updatedAt: "2026-09-09T14:30:18.000Z",
    });

    const interrupted = await journal.markInterrupted({
      runId,
      reason: "test-interruption",
      updatedAt: "2026-09-09T14:30:19.000Z",
    });
    assert.equal(interrupted.interruption.interruptedProtocolStepKind, "interval");
    assert.equal(interrupted.interruption.restartProtocolStepPosition, 3);
    assert.equal(interrupted.activeProtocolStep, null);
    assert.equal(interrupted.safeStimulusIndex, 1);

    const resumed = await journal.resumeAttempt({
      runId,
      ownerId: `external-resume-${index}`,
      resumedAt: "2026-09-09T14:30:20.000Z",
    });
    assert.equal(resumed.version, 3);
    assert.equal(resumed.safeProtocolStepPosition, 2);
    assert.deepEqual(resumed.context.restartedStimulusIds, []);
    await journal.setProtocolState({
      runId,
      activeProtocolStepPosition: 3,
      safeProtocolStepPosition: 2,
      updatedAt: "2026-09-09T14:30:21.000Z",
    });
    await journal.setProtocolState({
      runId,
      activeProtocolStepPosition: null,
      safeProtocolStepPosition: 3,
      updatedAt: "2026-09-09T14:30:24.000Z",
    });

    const finalizedAt = "2026-09-09T14:30:25.000Z";
    await journal.prepareFinalization({
      runId,
      completionStatus: "completed",
      finalizedAt,
      recovery: { resumed: true, sourceRunId: runId, restartedStimulusIds: [] },
    });
    const finalManifest = await manifest(journal, data, finalizedAt);
    const wrongLanguage = structuredClone(finalManifest);
    wrongLanguage.experimentPackage.languageId = "de";
    await assert.rejects(journal.finalizeProtocol({
      runId,
      status: "complete",
      manifest: wrongLanguage,
      finalizedAt,
    }), (error) => error.code === "corrupt-record"
      && /package identity/u.test(error.message));
    const wrongAssetBindings = structuredClone(finalManifest);
    wrongAssetBindings.experimentPackage.assetBindingsSha256 = "f".repeat(64);
    await assert.rejects(journal.finalizeProtocol({
      runId,
      status: "complete",
      manifest: wrongAssetBindings,
      finalizedAt,
    }), (error) => error.code === "corrupt-record"
      && /asset-binding hash/u.test(error.message));
    const terminal = await journal.finalizeProtocol({
      runId,
      status: "complete",
      manifest: finalManifest,
      finalizedAt,
    });
    assert.equal(terminal.version, 3);
    assert.equal(terminal.status, "complete");
    assert.equal(terminal.manifest.version, 4);
    assert.equal(terminal.manifest.protocol.safeProtocolStepPosition, 3);
    assert.equal((await journal.readQuestionnaireResponses(runId)).length, 1);
    await journal.close?.();
  });
}

test("a stored package-less V3 attempt remains readable and finalizable as ManifestV3", async () => {
  const runId = "44444444-4444-4444-8444-444444444444";
  const data = await fixture(runId, "historical-v3-owner");
  const journal = new MemoryResearchJournal();
  await journal.reserveProtocolAttempt(data.reservation);

  // Simulate a record written by the historical package-optional V3 journal.
  const stored = journal.attempts.get(runId);
  delete stored.context.experimentPackage;
  const historical = await journal.getAttempt(runId);
  assert.equal(historical.version, 3);
  assert.equal(Object.hasOwn(historical.context, "experimentPackage"), false);

  const finalizedAt = "2026-09-09T14:30:13.000Z";
  const packageManifest = await manifest(journal, data, finalizedAt);
  const v4Fields = structuredClone(packageManifest);
  delete v4Fields.experimentPackage;
  const emptyResponsesSha256 = await canonicalSha256([]);
  const manifestV3 = {
    ...v4Fields,
    schema: RESEARCH_RUN_MANIFEST_V3_SCHEMA,
    version: 3,
    completionStatus: "partial",
    protocol: {
      ...v4Fields.protocol,
      safeProtocolStepPosition: 0,
      questionnaireModules: v4Fields.protocol.questionnaireModules.map((receipt) => ({
        ...receipt,
        status: "notReached",
        responseCount: 0,
      })),
      submittedResponseCount: 0,
      draftResponseCount: 0,
      submittedResponsesSha256: emptyResponsesSha256,
      draftResponsesSha256: emptyResponsesSha256,
    },
    timing: {
      ...v4Fields.timing,
      sampleCount: 0,
      eventCount: 0,
      gapEventCount: 0,
      missedSlotCount: 0,
      questionnaireSubmittedResponseCount: 0,
      questionnaireDraftResponseCount: 0,
    },
    outputs: v4Fields.outputs.filter(({ kind }) => kind !== "experimentPackage"),
    recovery: { resumed: false, sourceRunId: null, restartedStimulusIds: [] },
  };
  assert.deepEqual(validateResearchRunManifestV3(manifestV3), manifestV3);
  await journal.prepareFinalization({
    runId,
    completionStatus: "partial",
    finalizedAt,
    recovery: manifestV3.recovery,
  });
  const terminal = await journal.finalizeProtocol({
    runId,
    status: "partial",
    manifest: manifestV3,
    finalizedAt,
  });
  assert.equal(terminal.status, "partial");
  assert.equal(terminal.manifest.version, 3);
});

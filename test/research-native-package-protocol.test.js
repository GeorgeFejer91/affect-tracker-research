import assert from "node:assert/strict";
import test from "node:test";

import {
  NativePackageProtocolAdapter,
  validateNativePackageProtocolCapabilityV1,
  validateNativePackagePreflightV1,
  validateNativePackageRecoveryListingV1,
  validateNativePackageRunStatusV1,
} from "../site/src/research/native-package-protocol.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OUTPUT = "33333333-3333-4333-8333-333333333333";
const SETTINGS_HASH = "a".repeat(64);
const ASSIGNMENT_HASH = "b".repeat(64);
const PROTOCOL_HASH = "c".repeat(64);
const PACKAGE_HASH = "d".repeat(64);

function capability(overrides = {}) {
  return {
    schema: "affect-research-native-package-protocol-capability",
    version: 1,
    backend: "rust-gstplay",
    rustOwnedProtocol: true,
    packageV1CompilationReady: true,
    protocolPlanV2Ready: true,
    questionnaireDraftsReady: true,
    recoveryJournalReady: true,
    manifestV4Ready: true,
    nativeStartReady: true,
    reasonCode: "ready",
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    active: true,
    runId: RUN,
    participantId: "P001",
    attemptNumber: 1,
    phase: "stimulusReady",
    protocolStepPosition: 1,
    safeProtocolStepPosition: 0,
    protocolStepCount: 3,
    questionnaire: null,
    stimulus: {
      protocolStepPosition: 1,
      stimulusPosition: 1,
      stimulusCount: 1,
      stimulusId: "calm-01",
      title: "Calm video",
      mediaTimeMs: 0,
      durationMs: 12_345,
      prepared: false,
    },
    intervalDurationMs: null,
    intervalRemainingMs: null,
    sampleCount: 0,
    eventCount: 2,
    gapEventCount: 0,
    missedSlotCount: 0,
    coalescedInputUpdateCount: 0,
    submittedResponseCount: 0,
    draftResponseCount: 0,
    currentValence: 0,
    currentArousal: 0,
    inputActive: false,
    writeHealthy: true,
    lslEnabled: false,
    failureCode: null,
    ...overrides,
  };
}

function startReceipt() {
  return {
    runId: RUN,
    participantId: "P001",
    attemptNumber: 1,
    sessionStem: "P001_EF_A27_GW_HR_20260910T120000000Z_R01",
    settingsSha256: SETTINGS_HASH,
    assignmentPlanSha256: ASSIGNMENT_HASH,
    protocolPlanSha256: PROTOCOL_HASH,
    packageSourceByteSha256: PACKAGE_HASH,
    outputReceiptId: OUTPUT,
    resumed: false,
    resumeAtProtocolStepPosition: 1,
    playbackMode: "nativeGstPlay",
    playbackQualification: "qualifiedNative",
  };
}

function recoveryListing(overrides = {}) {
  return {
    schema: "affect-research-package-recovery-listing",
    version: 1,
    packageSourceByteSha256: PACKAGE_HASH,
    recoveries: [],
    participants: [{
      participantId: "P001",
      state: "available",
      latestAttemptNumber: null,
      recoveryId: null,
      finalizationPending: false,
    }],
    quarantinedCount: 0,
    ...overrides,
  };
}

function recovery(overrides = {}) {
  return {
    recoveryId: "44444444-4444-4444-8444-444444444444",
    runId: RUN,
    participantId: "P001",
    attemptNumber: 1,
    settingsSha256: SETTINGS_HASH,
    assignmentPlanSha256: ASSIGNMENT_HASH,
    protocolPlanSha256: PROTOCOL_HASH,
    packageId: "demo-package",
    packageDefinitionSha256: "e".repeat(64),
    languageId: "en",
    languageSelectionPath: ["en"],
    assignmentSha256: "f".repeat(64),
    safeProtocolStepPosition: 1,
    protocolStepCount: 3,
    resumable: true,
    finalizationPending: false,
    completionStatus: null,
    ...overrides,
  };
}

function listingWithRecovery(recoveryValue = recovery()) {
  return recoveryListing({
    recoveries: [recoveryValue],
    participants: [{
      participantId: "P001",
      state: "partial",
      latestAttemptNumber: recoveryValue.attemptNumber,
      recoveryId: recoveryValue.recoveryId,
      finalizationPending: recoveryValue.finalizationPending,
    }],
  });
}

function finalFiles() {
  return [
    "settings.snapshot.json", "experiment.json", "experiment-plan.snapshot.json",
    "experiment.package.json", "protocol-plan.snapshot.json", "events.jsonl",
    "ratings.csv", "questionnaire.csv", "manifest.json",
  ].map((fileName, index) => ({
    fileName,
    sha256: String(index + 1).repeat(64).slice(0, 64),
    byteLength: 100 + index,
  }));
}

function detail() {
  return {
    participantId: "P001",
    participant: { participantCode: "EF", age: 27, gender: "W", handedness: "R" },
    experimentPackageSourceText: "{canonical}\n",
    experimentPackageSourceByteSha256: PACKAGE_HASH,
    selectedLanguageId: "en",
    languageSelectionPath: ["en"],
    rerunConfirmed: false,
    inputTestReceiptId: "input-test-receipt",
    researchSettingsSha256: SETTINGS_HASH,
    resolvedPlan: { planHashSha256: ASSIGNMENT_HASH },
    resolvedProtocolPlan: { protocolPlanHashSha256: PROTOCOL_HASH },
  };
}

function rootAndHost() {
  const root = new EventTarget();
  const host = {
    hidden: true,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 640, height: 360 }),
  };
  const video = { hidden: false };
  const placeholder = { hidden: false };
  return { root, host, video, placeholder };
}

test("Rust package capability and status projections are closed-world", () => {
  assert.equal(validateNativePackageProtocolCapabilityV1(capability()).nativeStartReady, true);
  assert.throws(() => validateNativePackageProtocolCapabilityV1({ ...capability(), extra: true }), /malformed/u);
  assert.throws(() => validateNativePackageProtocolCapabilityV1(capability({ protocolPlanV2Ready: false })), /inconsistent/u);
  assert.equal(validateNativePackageRunStatusV1(status()).phase, "stimulusReady");
  assert.throws(() => validateNativePackageRunStatusV1(status({ questionnaire: {} })), /malformed|inconsistent/u);
  assert.throws(() => validateNativePackageRunStatusV1(status({ runId: null })), /identity/u);
});

test("Rust package preflight and recovery projections are exact and package-bound", () => {
  const expected = {
    packageSourceByteSha256: PACKAGE_HASH,
    packageDefinitionSha256: "e".repeat(64),
    participantId: "P001",
    settingsSha256: SETTINGS_HASH,
    assignmentPlanSha256: ASSIGNMENT_HASH,
    assignmentSha256: "f".repeat(64),
    protocolPlanSha256: PROTOCOL_HASH,
    assetBindingCount: 2,
    protocolStepCount: 4,
    stimulusStepCount: 2,
    questionnaireStepCount: 1,
  };
  const preflight = {
    schema: "affect-research-native-package-preflight",
    version: 1,
    ...expected,
    assetBindingsSha256: "1".repeat(64),
    nativeStartReady: true,
  };
  assert.equal(validateNativePackagePreflightV1(preflight, expected).nativeStartReady, true);
  assert.throws(() => validateNativePackagePreflightV1({ ...preflight, extra: true }, expected), /malformed/u);
  assert.throws(() => validateNativePackagePreflightV1({ ...preflight, participantId: "P002" }, expected), /does not match/u);
  assert.equal(validateNativePackageRecoveryListingV1(listingWithRecovery()).recoveries[0].resumable, true);
  assert.throws(() => validateNativePackageRecoveryListingV1({
    ...listingWithRecovery(),
    recoveries: [{ ...recovery(), finalizationPending: true }],
  }), /malformed|crossed/u);
});

test("package adapter starts from exact package bytes and lets Rust own prepare and play", async () => {
  const calls = [];
  const events = [];
  const { root, host, video, placeholder } = rootAndHost();
  let inputPreparations = 0;
  const invoke = async (command, payload) => {
    if (command === "research_package_prepare_media") assert.equal(inputPreparations, 2, "Native prepare waits for the revealed input region.");
    calls.push([command, payload]);
    if (command === "research_package_protocol_capability") return capability();
    if (command === "research_package_recoveries") return recoveryListing();
    if (command === "research_start_package_run") return startReceipt();
    if (command === "research_package_run_status") return status();
    return { state: command.endsWith("play") ? "playing" : "preparing" };
  };
  const adapter = new NativePackageProtocolAdapter(root, {
    invoke,
    dispatch: (type, eventDetail) => events.push([type, eventDetail]),
    resolveMediaHost: () => host,
    resolveFallbackVideo: () => video,
    resolvePlaceholder: () => placeholder,
    prepareRunInput: async () => { await Promise.resolve(); inputPreparations += 1; },
    setIntervalObject: () => 7,
    clearIntervalObject: () => {},
  });
  await adapter.initialize();
  await adapter.start(detail(), WORKSPACE);
  assert.equal(inputPreparations, 2, "Refresh the visible input region before preparing native video.");
  assert.equal(adapter.active, true);
  assert.equal(host.hidden, false);
  assert.equal(video.hidden, true);
  assert.equal(placeholder.hidden, true);
  assert.deepEqual(calls.find(([command]) => command === "research_start_package_run")[1], {
    request: {
      workspaceId: WORKSPACE,
      experimentPackageSourceText: "{canonical}\n",
      participant: { participantId: "P001", participantCode: "EF", age: 27, gender: "W", handedness: "R" },
      selectedLanguageId: "en",
      languageSelectionPath: ["en"],
      rerunConfirmed: false,
      inputTestReceiptId: "input-test-receipt",
      playbackMode: "nativeGstPlay",
    },
  });
  assert.deepEqual(calls.filter(([command]) => command.startsWith("research_package_"))
    .map(([command]) => command), [
    "research_package_protocol_capability",
    "research_package_recoveries",
    "research_package_run_status",
    "research_package_prepare_media",
    "research_package_play",
  ]);
  assert.ok(events.some(([type]) => type === "affect-research:run-started"));
  assert.ok(events.some(([type, value]) => type === "affect-research:run-status" && value.ratingInputActive === false));
  assert.doesNotMatch(JSON.stringify(calls), /[A-Z]:\\\\|(?:file|root|output)Path/u);
});

test("package adapter submits questionnaire choices then finalizes complete exactly once", async () => {
  const calls = [];
  const events = [];
  const { root, host, video, placeholder } = rootAndHost();
  let current = status({
    phase: "questionnaire",
    protocolStepPosition: 1,
    questionnaire: {
      protocolStepPosition: 1,
      moduleId: "maia-before",
      questionnaireId: "maia-2-en",
      definitionSha256: "e".repeat(64),
      answers: {},
    },
    stimulus: null,
  });
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "research_package_protocol_capability") return capability();
    if (command === "research_package_recoveries") return recoveryListing();
    if (command === "research_start_package_run") return startReceipt();
    if (command === "research_package_run_status") return current;
    if (command === "research_package_questionnaire_submit") {
      current = status({
        phase: "completeReady",
        protocolStepPosition: null,
        safeProtocolStepPosition: 3,
        questionnaire: null,
        stimulus: null,
      });
      return null;
    }
    if (command === "research_finish_package_run") {
      return {
        runId: RUN,
        participantId: "P001",
        attemptNumber: 1,
        completionStatus: "completed",
        outputReceiptId: OUTPUT,
        files: finalFiles(),
      };
    }
    return null;
  };
  const adapter = new NativePackageProtocolAdapter(root, {
    invoke,
    dispatch: (type, eventDetail) => events.push([type, eventDetail]),
    resolveMediaHost: () => host,
    resolveFallbackVideo: () => video,
    resolvePlaceholder: () => placeholder,
    setIntervalObject: () => 1,
    clearIntervalObject: () => {},
  });
  await adapter.initialize();
  await adapter.start(detail(), WORKSPACE);
  await adapter.questionnaireSubmit({
    protocolStepPosition: 1,
    answers: { "item-02": "o3", "item-01": "o2" },
  });
  const submission = calls.find(([command]) => command === "research_package_questionnaire_submit")[1];
  assert.deepEqual(submission.request.answers, [
    { itemId: "item-01", optionId: "o2" },
    { itemId: "item-02", optionId: "o3" },
  ]);
  assert.equal(calls.filter(([command]) => command === "research_finish_package_run").length, 1);
  assert.equal(adapter.active, false);
  assert.equal(events.at(-1)[0], "affect-research:run-complete");
});

test("package adapter resumes only the exact package recovery and restores its safe boundary", async () => {
  const calls = [];
  const events = [];
  const { root, host, video, placeholder } = rootAndHost();
  const recovered = recovery();
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "research_package_protocol_capability") return capability();
    if (command === "research_package_recoveries") return listingWithRecovery(recovered);
    if (command === "research_resume_package_run") return {
      ...startReceipt(),
      resumed: true,
      resumeAtProtocolStepPosition: 2,
    };
    if (command === "research_package_run_status") return status({
      protocolStepPosition: 2,
      safeProtocolStepPosition: 1,
      stimulus: { ...status().stimulus, protocolStepPosition: 2 },
    });
    return {};
  };
  const adapter = new NativePackageProtocolAdapter(root, {
    invoke,
    dispatch: (type, value) => events.push([type, value]),
    resolveMediaHost: () => host,
    resolveFallbackVideo: () => video,
    resolvePlaceholder: () => placeholder,
    setIntervalObject: () => 1,
    clearIntervalObject: () => {},
  });
  await adapter.initialize();
  await adapter.start({
    ...detail(),
    attemptDisposition: "resume-compatible",
    packageAssignmentSha256: recovered.assignmentSha256,
  }, WORKSPACE);
  const resume = calls.find(([command]) => command === "research_resume_package_run");
  assert.deepEqual(resume[1].request, {
    workspaceId: WORKSPACE,
    experimentPackageSourceText: "{canonical}\n",
    recoveryId: recovered.recoveryId,
    inputTestReceiptId: "input-test-receipt",
    playbackMode: "nativeGstPlay",
  });
  assert.equal(calls.some(([command]) => command === "research_start_package_run"), false);
  const stateEvent = events.find(([type]) => type === "affect-research:participant-states");
  assert.equal(stateEvent[1].P001, "partial");
  assert.equal(stateEvent[1].__recoveryBinding.P001.assignmentSha256, recovered.assignmentSha256);
});

test("package pending finalization performs no acquisition and emits an immutable receipt", async () => {
  const calls = [];
  const events = [];
  let terminalRefreshes = 0;
  const { root } = rootAndHost();
  const pending = recovery({
    resumable: false,
    finalizationPending: true,
    completionStatus: "partial",
  });
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "research_package_protocol_capability") return capability();
    if (command === "research_package_recoveries") return listingWithRecovery(pending);
    if (command === "research_finalize_package_recovery") return {
      runId: RUN,
      participantId: "P001",
      attemptNumber: 1,
      completionStatus: "partial",
      outputReceiptId: OUTPUT,
      files: finalFiles(),
    };
    return null;
  };
  const adapter = new NativePackageProtocolAdapter(root, {
    invoke,
    dispatch: (type, value) => events.push([type, value]),
    onRunTerminal: async () => { terminalRefreshes += 1; },
  });
  await adapter.initialize();
  await adapter.start({
    ...detail(),
    recoveryFinalizationOnly: true,
    pendingFinalizationAttemptNumber: 1,
    pendingFinalizationCompletionStatus: "partial",
    packageAssignmentSha256: pending.assignmentSha256,
  }, WORKSPACE);
  assert.equal(calls.some(([command]) => command === "research_start_package_run"), false);
  assert.equal(calls.some(([command]) => command === "research_resume_package_run"), false);
  assert.equal(calls.filter(([command]) => command === "research_finalize_package_recovery").length, 1);
  assert.equal(terminalRefreshes, 1);
  assert.equal(events.at(-1)[0], "affect-research:run-complete");
});

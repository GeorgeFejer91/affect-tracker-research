import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  NativeResearchRuntimeBridge,
  authorizeDesktopPlaybackMode,
  closeMalformedNativeStartBoundary,
  closeNativeRendererFailureBoundary,
  invokeNativeRunActivation,
  mediaFailureReport,
  nativeInputBindingSupported,
  nativeFinalizeReceiptMatches,
  nativeInputPresetAvailability,
  nativeInputRegionRequest,
  nativeMediaGenerationMatches,
  nativePendingFinalizationContract,
  nativeProtocolExecutionReady,
  participantStateDetail,
  probeAndAttestNativeVideo,
  nativeRendererRunFenceMatches,
  nativeRunStatusHandshake,
  nativeRunStatusMatchesFence,
  nativeStartReceiptMatches,
  nativeStatusPollMayProject,
  nativeWorkspaceBindingsForProtocol,
  selectPendingNativeFinalizationRecovery,
  validateNativeMediaCapabilityV2,
  validateNativeProtocolCapabilityV1,
  validateNativeProtocolPreflightV1,
} from "../site/src/research/native-bridge.js";
import { createInputBindingPreset } from "../site/src/research/contracts.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";
import { requestPlannerFile, PLANNER_LOAD_REQUEST, PLANNER_SAVE_REQUEST } from "../site/src/research/planner-file-request.js";

test("Planner native file requests acknowledge exact results without rescanning media or invoking Runner", async () => {
  const root = new EventTarget(), win = new EventTarget(), calls = [];
  root.dataset = { researchProgram: "planner" }; root.querySelector = () => null; root.researchUi = {};
  let response = { kind: "planner-recipe-v1", document: { canonicalSourceText: "strict adapter fixture" } }, fail = false;
  const bridge = new NativeResearchRuntimeBridge(root, { windowObject: win,
    setIntervalObject: () => 1, clearIntervalObject: () => {}, invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "research_desktop_identity") return { schema: "affect-research-desktop-identity", version: 1, program: "planner" };
      if (command === "research_native_media_capability") return nativeMediaCapability();
      if (command === "research_input_capability") return { nativeAuthorityReady: false, supportedPresets: [] };
      if (["research_load_planner_recipe", "research_save_planner_recipe"].includes(command)) {
        if (fail) throw Error("selected file failed");
        return response;
      }
      return {};
    } });
  await bridge.initialize(); calls.length = 0;
  assert.deepEqual(await requestPlannerFile(root, PLANNER_LOAD_REQUEST), response);
  assert.deepEqual(calls.map(item => item.command), ["research_load_planner_recipe"]);
  response = { acknowledged: "transport fixture; full workflow validates its exact receipt" };
  assert.deepEqual(await requestPlannerFile(root, PLANNER_SAVE_REQUEST, { sourceText: "exact source" }), response);
  assert.deepEqual(calls.at(-1), { command: "research_save_planner_recipe", payload: { sourceText: "exact source" } });
  response = null; assert.equal(await requestPlannerFile(root, PLANNER_LOAD_REQUEST), null);
  fail = true; await assert.rejects(requestPlannerFile(root, PLANNER_SAVE_REQUEST, { sourceText: "exact source" }), /selected file failed/u);
  const count = calls.length;
  bridge.plannerOnly = false;
  await assert.rejects(requestPlannerFile(root, PLANNER_SAVE_REQUEST, { sourceText: "exact source" }), /Experiment Planner/u);
  assert.equal(calls.length, count);
  bridge.plannerOnly = true; bridge.destroy();
});

test("native capture fences cancelled, rearmed, rejected and delayed results", async () => {
  const root = new EventTarget(), win = new EventTarget(), projected = [], captures = [], calls = [], polls = [];
  const binding = createInputBindingPreset("arrowKeys");
  const grid = { getBoundingClientRect: () => ({left:0,top:0,right:100,bottom:100,width:100,height:100}), getClientRects: () => [1] };
  root.ownerDocument = {activeElement:grid};
  const video = {pause(){},removeAttribute(){},load(){}};
  root.querySelector = selector => selector === "#run-video" ? video : selector === ".input-test-grid" || selector.includes(".dialog-content") ? grid : null;
  root.researchUi = { inputBinding:binding, applyNativeInputStatus: s => projected.push(s), applyNativeCapture: c => { captures.push(c); return c.captureId !== "rejected"; } };
  win.innerWidth = 800; win.innerHeight = 600;
  let deferredStatus = null, deferredBegin = null;
  const bridge = new NativeResearchRuntimeBridge(root, {windowObject:win,setIntervalObject:fn=>{polls.push(fn);return polls.length;},clearIntervalObject:()=>{},invoke:async(command, payload)=>{
    calls.push([command,payload]);
    if(command === "research_native_media_capability") return nativeMediaCapability();
    if(command === "research_native_protocol_capability") return nativeProtocolCapability();
    if(command === "research_input_capability") return {nativeAuthorityReady:true,supportsCustomKeyboard:true,supportedPresets:["arrowKeys","custom"]};
    if(command === "research_input_status") return deferredStatus ? deferredStatus.promise : {};
    if(command === "research_input_begin_capture") return deferredBegin ? deferredBegin.promise : {};
    return {};
  }});
  bridge.packageProtocol.initialize = async()=>({nativeStartReady:false,manifestV4Ready:false});
  await bridge.initialize();
  const arm=()=>root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputCaptureRequest,{detail:{binding,direction:"left"}}));
  const cancel=()=>root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputCaptureCancel));
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await bridge.operation;};
  const poll=()=>polls.at(-1)();
  arm();await bridge.operation;
  assert.equal(bridge.activeInputCaptureGeneration,bridge.inputCaptureGeneration);
  deferredStatus=deferred();poll();
  cancel();arm();await bridge.operation;
  const before=projected.length;
  deferredStatus.resolve({capture:{captureId:"old",direction:"left",binding}});await flush();
  assert.equal(projected.length,before);assert.equal(captures.length,0);assert.equal(calls.filter(([c])=>c==="research_input_begin_test").length,0);
  deferredStatus=deferred();poll();deferredStatus.resolve({capture:{captureId:"current",direction:"left",binding}});await flush();
  assert.deepEqual(captures.map(c=>c.captureId),["current"]);
  assert.equal(calls.filter(([c])=>c==="research_input_begin_test").length,1);
  arm();await bridge.operation;deferredStatus=deferred();poll();deferredStatus.resolve({capture:{captureId:"rejected",direction:"left",binding}});await flush();
  assert.equal(calls.filter(([c])=>c==="research_input_begin_test").length,1,"UI rejection must not reconfigure native test");
  deferredBegin=deferred();arm();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(bridge.activeInputCaptureGeneration,null,"not active before begin acknowledgment");
  cancel();arm();const oldBegin=deferredBegin;deferredBegin=null;oldBegin.reject(new Error("stale begin failure"));await flush();
  assert.equal(bridge.activeInputCaptureGeneration,bridge.inputCaptureGeneration,"old failure cannot clear rearmed capture");
  deferredStatus=deferred();poll();cancel();await bridge.operation;const finalCount=projected.length;
  deferredStatus.resolve({capture:{captureId:"cancelled",direction:"left",binding}});await flush();
  assert.equal(projected.length,finalCount);assert.equal(captures.length,2);
  bridge.destroy();
});

function nativeStatus(overrides = {}) {
  return {
    active: false,
    runId: null,
    participantId: null,
    attemptNumber: null,
    phase: "finished",
    sampleCount: 0,
    eventCount: 0,
    gapEventCount: 0,
    missedSlotCount: 0,
    coalescedInputUpdateCount: 0,
    currentValence: 0,
    currentArousal: 0,
    inputActive: false,
    activeStimulusPosition: null,
    lastSafeStimulusPosition: 0,
    mediaTimeMs: null,
    transitionDurationMs: null,
    transitionRemainingMs: null,
    transitionReady: false,
    writeHealthy: true,
    lslEnabled: false,
    failureCode: null,
    playbackMode: null,
    playbackQualification: null,
    ...overrides,
  };
}

function finalizedFiles() {
  return ["settings.snapshot.json", "events.jsonl", "ratings.csv", "manifest.json"].map((fileName) => ({
    fileName,
    sha256: "a".repeat(64),
    byteLength: 1,
  }));
}

function nativeMediaCapability(overrides = {}) {
  return {
    schema: "affect-research-native-media-capability",
    version: 2,
    backend: "gstreamer-gstplay",
    api: "gstplay",
    pinnedRuntimeVersion: "1.28.6",
    bindingsVersion: "0.25",
    target: "msvc-x86_64",
    runtimeInstallerSha256: "059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5",
    runtimeTreeManifestSha256: "51c27b6a25db1d86dea20cc108e88240fc340758b34ae1e497dd91d8de1b5566",
    defaultPlaybackMode: "nativeGstPlay",
    unqualifiedFallbackMode: "unqualifiedWebview",
    runtimeBundleState: "notStaged",
    runtimeIntegrityVerified: false,
    runtimeFileCount: null,
    runtimeByteLength: null,
    playerActorReady: false,
    qualifiedStartAvailable: false,
    qualifiedFormatMatrixReady: false,
    redistributionReviewReady: false,
    ambientRuntimeAllowed: false,
    requiredForQualifiedRun: true,
    rendererReceivesFilesystemPaths: false,
    reasonCode: "runtime-not-staged",
    ...overrides,
  };
}

function nativeProtocolCapability(overrides = {}) {
  return {
    schema: "affect-research-native-questionnaire-protocol-capability",
    version: 1,
    settingsV2ValidationReady: true,
    questionnaireCsvImportReady: true,
    protocolPlanValidationReady: true,
    nativeStartResumeReady: false,
    durableDraftCheckpointReady: false,
    atomicSubmissionReady: false,
    manifestV3FinalizationReady: false,
    reasonCode: "native-questionnaire-runtime-v3-not-integrated",
    ...overrides,
  };
}

function nativeProtocolFixture({ withQuestionnaire = false } = {}) {
  const settingsSha256 = "a".repeat(64);
  const assignmentSettingsSha256 = "b".repeat(64);
  const assignmentPlanSha256 = "c".repeat(64);
  const protocolPlanSha256 = "d".repeat(64);
  const definitionSha256 = "e".repeat(64);
  const definitions = withQuestionnaire ? [{
    questionnaireId: "maia-2-de",
    definitionSha256,
  }] : [];
  const steps = [
    ...(withQuestionnaire ? [{ kind: "questionnaire", moduleId: "maia-before" }] : []),
    { kind: "stimulus", stimulusId: "stimulus-a" },
  ];
  const researchSettings = {
    version: 2,
    stimuli: { items: [] },
    questionnaires: {
      definitions,
      modules: withQuestionnaire ? [{ moduleId: "maia-before" }] : [],
    },
  };
  const assignmentPlan = {
    settingsSha256: assignmentSettingsSha256,
    planHashSha256: assignmentPlanSha256,
  };
  const resolvedProtocolPlan = {
    participantId: "P001",
    settingsSha256,
    assignmentPlanSha256,
    protocolPlanHashSha256: protocolPlanSha256,
    steps,
  };
  const receipt = {
    schema: "affect-research-native-protocol-preflight",
    version: 1,
    participantId: "P001",
    settingsSha256,
    assignmentSettingsSha256,
    assignmentPlanSha256,
    protocolPlanSha256,
    definitionHashes: definitions,
    protocolStepCount: steps.length,
    questionnaireStepCount: withQuestionnaire ? 1 : 0,
    stimulusStepCount: 1,
    nativeStartReady: false,
    blockingReasonCode: "native-questionnaire-runtime-v3-not-integrated",
  };
  return { researchSettings, assignmentPlan, resolvedProtocolPlan, receipt };
}

test("native questionnaire capability is exact and cannot overclaim readiness", () => {
  assert.deepEqual(validateNativeProtocolCapabilityV1(nativeProtocolCapability()), nativeProtocolCapability());
  assert.throws(
    () => validateNativeProtocolCapabilityV1(nativeProtocolCapability({ futureField: true })),
    /malformed/u,
  );
  assert.throws(
    () => validateNativeProtocolCapabilityV1(nativeProtocolCapability({ nativeStartResumeReady: true })),
    /inconsistent/u,
  );
});

test("native protocol preflight is exact and unavailable capability blocks V2 protocol execution", () => {
  const inputs = nativeProtocolFixture({ withQuestionnaire: true });
  const receipt = validateNativeProtocolPreflightV1(inputs.receipt, inputs);
  assert.deepEqual(receipt, inputs.receipt);
  assert.equal(nativeProtocolExecutionReady(nativeProtocolCapability(), receipt), false);
  assert.equal(nativeProtocolExecutionReady({
    ...nativeProtocolCapability(),
    nativeStartResumeReady: true,
    durableDraftCheckpointReady: true,
    atomicSubmissionReady: true,
    manifestV3FinalizationReady: true,
  }, { ...receipt, nativeStartReady: true }), true);
  assert.throws(
    () => validateNativeProtocolPreflightV1({
      ...inputs.receipt,
      protocolPlanSha256: "f".repeat(64),
    }, inputs),
    /does not match/u,
  );
  assert.throws(
    () => validateNativeProtocolPreflightV1({ ...inputs.receipt, futureField: true }, inputs),
    /malformed/u,
  );
});

test("native workspace bindings contain exactly the selected participant protocol stimuli", () => {
  const workspaceSource = (relativePath, digit, byteLength) => ({
    kind: "workspaceFile",
    relativePath,
    sha256: digit.repeat(64),
    byteLength,
    durationMs: 1_000,
    decodeStatus: "attestedUnqualified",
    decodeBackend: "webviewVideoFrameCallback",
    decodeAttestation: "representativeFramesV1",
    decodedPositionsMs: [20, 500, 980],
  });
  const sourceA = workspaceSource("a.mp4", "a", 101);
  const sourceC = workspaceSource("nested/c.mp4", "c", 303);
  const researchSettings = {
    version: 2,
    stimuli: {
      items: [
        { stimulusId: "stimulus-a", title: "A", source: sourceA },
        {
          stimulusId: "stimulus-b",
          title: "B",
          source: { kind: "repositoryAsset", assetPath: "demo/b.mp4", sha256: "b".repeat(64), byteLength: 202, durationMs: 1_000 },
        },
        { stimulusId: "stimulus-c", title: "C", source: sourceC },
      ],
    },
  };
  const resolvedProtocolPlan = {
    steps: [
      { kind: "questionnaire", moduleId: "before-session" },
      { kind: "stimulus", stimulusId: "stimulus-c" },
      { kind: "stimulus", stimulusId: "stimulus-a" },
    ],
  };
  const catalogEntries = [
    { summary: { source: sourceA, sha256: sourceA.sha256, byteLength: sourceA.byteLength, workspaceFileId: `wf-${"1".repeat(24)}` } },
    { summary: { source: sourceC, sha256: sourceC.sha256, byteLength: sourceC.byteLength, workspaceFileId: `wf-${"3".repeat(24)}` } },
  ];
  assert.deepEqual(nativeWorkspaceBindingsForProtocol({
    researchSettings,
    resolvedProtocolPlan,
    catalogEntries,
  }), [
    { stimulusId: "stimulus-c", workspaceFileId: `wf-${"3".repeat(24)}` },
    { stimulusId: "stimulus-a", workspaceFileId: `wf-${"1".repeat(24)}` },
  ]);
  assert.throws(() => nativeWorkspaceBindingsForProtocol({
    researchSettings,
    resolvedProtocolPlan: { steps: [{ kind: "stimulus", stimulusId: "stimulus-b" }] },
    catalogEntries,
  }), /not qualified/u);
  assert.throws(() => nativeWorkspaceBindingsForProtocol({
    researchSettings,
    resolvedProtocolPlan: {
      steps: [
        { kind: "stimulus", stimulusId: "stimulus-a" },
        { kind: "stimulus", stimulusId: "stimulus-a" },
      ],
    },
    catalogEntries,
  }), /unique stimulus steps/u);
});

test("native timing readiness requires a complete bounded RunStatus handshake", () => {
  assert.equal(nativeRunStatusHandshake(nativeStatus()), true);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ sampleCount: -1 })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ coalescedInputUpdateCount: -1 })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ currentValence: 1.01 })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ transitionReady: "yes" })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ phase: "playing" })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ playbackMode: "unqualifiedWebview" })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ writeHealthy: false, failureCode: "write-failed" })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ sampleCount: 1 })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({ active: true })), false);
  assert.equal(nativeRunStatusHandshake(nativeStatus({
    active: true,
    runId: "11111111-1111-4111-8111-111111111111",
    participantId: "P001",
    attemptNumber: 1,
    phase: "prepared",
    playbackMode: "unqualifiedWebview",
    playbackQualification: "unqualified",
  })), true);
});

test("renderer fences require both the local epoch and native run ID", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const otherRunId = "22222222-2222-4222-8222-222222222222";
  const run = {
    rendererEpoch: 7,
    receipt: {
      runId,
      participantId: "P001",
      attemptNumber: 1,
      playbackMode: "unqualifiedWebview",
      playbackQualification: "unqualified",
    },
  };
  const fence = { rendererEpoch: 7, runId };
  const matchingStatus = nativeStatus({
    active: true,
    runId,
    participantId: "P001",
    attemptNumber: 1,
    phase: "playing",
    activeStimulusPosition: 1,
    mediaTimeMs: 125,
    playbackMode: "unqualifiedWebview",
    playbackQualification: "unqualified",
  });
  assert.equal(nativeRendererRunFenceMatches(run, fence), true);
  assert.equal(nativeRendererRunFenceMatches(run, { ...fence, rendererEpoch: 6 }), false);
  assert.equal(nativeRendererRunFenceMatches(run, { ...fence, runId: otherRunId }), false);
  assert.equal(nativeRunStatusMatchesFence(matchingStatus, run, fence), true);
  assert.equal(nativeRunStatusMatchesFence({ ...matchingStatus, runId: otherRunId }, run, fence), false);
  assert.equal(nativeRunStatusMatchesFence({ ...matchingStatus, participantId: "P002" }, run, fence), false);
  assert.equal(nativeRunStatusMatchesFence({ ...matchingStatus, attemptNumber: 2 }, run, fence), false);
  assert.equal(nativeRunStatusMatchesFence({
    ...matchingStatus,
    playbackMode: "nativeLibvlc",
    playbackQualification: "qualifiedNative",
  }, run, fence), false);
  assert.equal(nativeRunStatusMatchesFence({ ...matchingStatus, active: false }, run, fence), false);
});

test("media event provenance requires the current detached element and source generation", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const currentVideo = {};
  const priorVideo = {};
  const run = { rendererEpoch: 7, mediaEpoch: 12, receipt: { runId } };
  const fence = { rendererEpoch: 7, runId };
  assert.equal(nativeMediaGenerationMatches(run, fence, 12, currentVideo, currentVideo), true);
  assert.equal(nativeMediaGenerationMatches(run, fence, 11, currentVideo, currentVideo), false);
  assert.equal(nativeMediaGenerationMatches(run, fence, 12, currentVideo, priorVideo), false);
  assert.equal(nativeMediaGenerationMatches(run, { ...fence, rendererEpoch: 6 }, 12, currentVideo, currentVideo), false);
});

test("status polls cannot project across a lifecycle command or newer poll", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const fence = { rendererEpoch: 7, runId };
  const run = {
    rendererEpoch: 7,
    receipt: { runId },
    terminalInFlight: null,
    lifecycleInFlight: false,
    lifecycleRevision: 4,
    lastProjectedStatusSequence: 8,
  };
  assert.equal(nativeStatusPollMayProject(run, fence, 4, 9), true);
  assert.equal(nativeStatusPollMayProject({ ...run, lifecycleInFlight: true }, fence, 4, 9), false);
  assert.equal(nativeStatusPollMayProject(run, fence, 3, 9), false);
  assert.equal(nativeStatusPollMayProject(run, fence, 4, 8), false);
  assert.equal(nativeStatusPollMayProject({ ...run, terminalInFlight: "failClosed" }, fence, 4, 9), false);
});

test("renderer lifecycle failure negotiates one run-bound recovery or partial boundary", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const report = mediaFailureReport({
    runId,
    mediaErrorCode: 3,
    stimulusId: "video-a",
    stimulusPosition: 1,
    mediaTimeMs: 250,
  });
  const recoveryCalls = [];
  const recovered = await closeNativeRendererFailureBoundary({
    runId,
    participantId: "P001",
    attemptNumber: 1,
    report,
    async invoke(command, payload) {
      recoveryCalls.push([command, payload]);
      return {
        runId,
        recoveryId: "recovery-1",
        failureCode: "media-decode",
        interruptedStimulusPosition: 1,
        lastSafeStimulusPosition: 0,
      };
    },
  });
  assert.equal(recovered.confirmed, true);
  assert.equal(recovered.failureReceipt.recoveryId, "recovery-1");
  assert.equal(recovered.finishReceipt, null);
  assert.deepEqual(recoveryCalls, [["research_report_media_failure", { report }]]);

  const fallbackCalls = [];
  const finalized = await closeNativeRendererFailureBoundary({
    runId,
    participantId: "P001",
    attemptNumber: 1,
    report,
    async invoke(command, payload) {
      fallbackCalls.push([command, payload]);
      if (command === "research_report_media_failure") throw new Error("report unavailable");
      return {
        runId,
        participantId: "P001",
        attemptNumber: 1,
        completionStatus: "partial",
        outputReceiptId: "33333333-3333-4333-8333-333333333333",
        files: finalizedFiles(),
      };
    },
  });
  assert.equal(finalized.confirmed, true);
  assert.equal(finalized.failureReceipt, null);
  assert.equal(finalized.finishReceipt.outputReceiptId, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(fallbackCalls.map(([command]) => command), [
    "research_report_media_failure",
    "research_finish_run",
  ]);
  assert.deepEqual(fallbackCalls[1][1], { runId, outcome: "stopEarly" });
});

test("renderer lifecycle failure remains unconfirmed when both native terminal paths fail", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const report = mediaFailureReport({
    runId,
    mediaErrorCode: 3,
    stimulusId: "video-a",
    stimulusPosition: 1,
    mediaTimeMs: 250,
  });
  const result = await closeNativeRendererFailureBoundary({
    runId,
    participantId: "P001",
    attemptNumber: 1,
    report,
    async invoke() { throw new Error("native IPC unavailable"); },
  });
  assert.equal(result.confirmed, false);
  assert.equal(result.failureReceipt, null);
  assert.equal(result.finishReceipt, null);
  assert.equal(result.reconciliation, "unavailable");
  assert.match(result.boundaryError.message, /native IPC unavailable/u);
  const stillActive = await closeNativeRendererFailureBoundary({
    runId,
    participantId: "P001",
    attemptNumber: 1,
    report,
    async invoke(command) {
      if (command === "research_run_status") return nativeStatus({
        active: true,
        runId,
        participantId: "P001",
        attemptNumber: 1,
        phase: "playing",
        activeStimulusPosition: 1,
        mediaTimeMs: 250,
        playbackMode: "unqualifiedWebview",
        playbackQualification: "unqualified",
      });
      throw new Error("terminal path unavailable");
    },
  });
  assert.equal(stillActive.confirmed, false);
  assert.equal(stillActive.reconciliation, "nativeStillActive");
  assert.equal(stillActive.reconciliationStatus.runId, runId);
  await assert.rejects(closeNativeRendererFailureBoundary({
    runId,
    participantId: "P001",
    attemptNumber: 1,
    report: { ...report, runId: "22222222-2222-4222-8222-222222222222" },
    async invoke() {},
  }), /one authoritative run ID/u);
});

test("terminal receipts bind run, participant, attempt, outcome, and mandatory artifacts", () => {
  const receipt = {
    runId: "11111111-1111-4111-8111-111111111111",
    participantId: "P001",
    attemptNumber: 2,
    completionStatus: "partial",
    outputReceiptId: "33333333-3333-4333-8333-333333333333",
    files: finalizedFiles(),
  };
  const expected = {
    runId: receipt.runId,
    participantId: "P001",
    attemptNumber: 2,
    completionStatus: "partial",
  };
  assert.equal(nativeFinalizeReceiptMatches(receipt, expected), true);
  assert.equal(nativeFinalizeReceiptMatches({ ...receipt, completionStatus: "completed" }, expected), false);
  assert.equal(nativeFinalizeReceiptMatches({ ...receipt, participantId: "P002" }, expected), false);
  assert.equal(nativeFinalizeReceiptMatches({ ...receipt, files: receipt.files.slice(1) }, expected), false);
  assert.equal(nativeFinalizeReceiptMatches({ ...receipt, files: [...receipt.files, receipt.files[0]] }, expected), false);
});

test("Start and Resume receipts bind the selected participant, hashes, attempt identity, and safe boundary", () => {
  const receipt = {
    runId: "11111111-1111-4111-8111-111111111111",
    participantId: "P001",
    attemptNumber: 2,
    sessionStem: "P001_EF_A27_GW_HR_20260903T143012482Z_R02",
    settingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    outputReceiptId: "33333333-3333-4333-8333-333333333333",
    resumed: false,
    resumeAtStimulusPosition: 1,
    playbackMode: "unqualifiedWebview",
    playbackQualification: "unqualified",
  };
  const expected = {
    participantId: "P001",
    settingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    playbackMode: "unqualifiedWebview",
    resumed: false,
    slotCount: 3,
  };
  assert.equal(nativeStartReceiptMatches(receipt, expected), true);
  assert.equal(nativeStartReceiptMatches({ ...receipt, participantId: "P002" }, expected), false);
  assert.equal(nativeStartReceiptMatches({ ...receipt, attemptNumber: 0 }, expected), false);
  assert.equal(nativeStartReceiptMatches({ ...receipt, settingsSha256: "c".repeat(64) }, expected), false);
  assert.equal(nativeStartReceiptMatches({ ...receipt, outputReceiptId: "output-1" }, expected), false);
  assert.equal(nativeStartReceiptMatches({ ...receipt, sessionStem: "../escape" }, expected), false);
  assert.equal(nativeStartReceiptMatches({ ...receipt, resumeAtStimulusPosition: null }, expected), false);

  const recovery = {
    runId: receipt.runId,
    participantId: "P001",
    attemptNumber: 2,
    lastSafeStimulusPosition: 1,
  };
  const resumed = { ...receipt, resumed: true, resumeAtStimulusPosition: 2 };
  const resumeExpected = { ...expected, resumed: true, recovery };
  assert.equal(nativeStartReceiptMatches(resumed, resumeExpected), true);
  assert.equal(nativeStartReceiptMatches({ ...resumed, resumeAtStimulusPosition: 1 }, resumeExpected), false);
  assert.equal(nativeStartReceiptMatches(resumed, {
    ...resumeExpected,
    recovery: { ...recovery, runId: "22222222-2222-4222-8222-222222222222" },
  }), false);
});

test("malformed Start receipt rollback uses only a matching authoritative native status identity", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  const result = await closeMalformedNativeStartBoundary({
    receipt: { runId: "not-a-run" },
    participantId: "P001",
    playbackMode: "unqualifiedWebview",
    async invoke(command, payload) {
      calls.push([command, payload]);
      if (command === "research_run_status") return nativeStatus({
        active: true,
        runId,
        participantId: "P001",
        attemptNumber: 3,
        phase: "prepared",
        playbackMode: "unqualifiedWebview",
        playbackQualification: "unqualified",
      });
      if (command === "research_finish_run") return {
        runId,
        participantId: "P001",
        attemptNumber: 3,
        completionStatus: "partial",
        outputReceiptId: "33333333-3333-4333-8333-333333333333",
        files: finalizedFiles(),
      };
      throw new Error(`Unexpected ${command}`);
    },
  });
  assert.equal(result.confirmed, true);
  assert.deepEqual(calls.map(([command]) => command), ["research_run_status", "research_finish_run"]);
  assert.deepEqual(calls[1][1], { runId, outcome: "stopEarly" });

  const mismatchCalls = [];
  const mismatch = await closeMalformedNativeStartBoundary({
    receipt: { runId },
    participantId: "P001",
    playbackMode: "unqualifiedWebview",
    async invoke(command) {
      mismatchCalls.push(command);
      return nativeStatus({
        active: true,
        runId: "22222222-2222-4222-8222-222222222222",
        participantId: "P001",
        attemptNumber: 3,
        phase: "prepared",
        playbackMode: "unqualifiedWebview",
        playbackQualification: "unqualified",
      });
    },
  });
  assert.equal(mismatch.confirmed, false);
  assert.equal(mismatch.reconciliation, "statusMismatch");
  assert.deepEqual(mismatchCalls, ["research_run_status"]);
});

test("rejected native activation rolls back only the matching run activated after an idle snapshot", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  let statusReads = 0;
  await assert.rejects(invokeNativeRunActivation({
    command: "research_start_run",
    payload: { request: { opaque: true } },
    participantId: "P001",
    playbackMode: "unqualifiedWebview",
    async invoke(command, payload) {
      calls.push([command, payload]);
      if (command === "research_run_status") {
        statusReads += 1;
        return statusReads === 1 ? nativeStatus() : nativeStatus({
          active: true,
          runId,
          participantId: "P001",
          attemptNumber: 4,
          phase: "prepared",
          playbackMode: "unqualifiedWebview",
          playbackQualification: "unqualified",
        });
      }
      if (command === "research_start_run") throw new Error("IPC response lost after activation");
      if (command === "research_finish_run") return {
        runId,
        participantId: "P001",
        attemptNumber: 4,
        completionStatus: "partial",
        outputReceiptId: "33333333-3333-4333-8333-333333333333",
        files: finalizedFiles(),
      };
      throw new Error(`Unexpected ${command}`);
    },
  }), (error) => {
    assert.equal(error.nativeActivationReconciliation, "rolledBack");
    assert.match(error.message, /rejected after activation; the matching run was finalized as Partial/u);
    return true;
  });
  assert.deepEqual(calls.map(([command]) => command), [
    "research_run_status",
    "research_start_run",
    "research_run_status",
    "research_finish_run",
  ]);
  assert.deepEqual(calls[3][1], { runId, outcome: "stopEarly" });
});

test("rejected native activation never stops an ambiguous or mismatched active identity", async () => {
  const calls = [];
  let statusReads = 0;
  await assert.rejects(invokeNativeRunActivation({
    command: "research_resume_run",
    payload: { request: { opaque: true } },
    participantId: "P001",
    playbackMode: "unqualifiedWebview",
    expectedRunId: "11111111-1111-4111-8111-111111111111",
    expectedAttemptNumber: 2,
    async invoke(command) {
      calls.push(command);
      if (command === "research_run_status") {
        statusReads += 1;
        return statusReads === 1 ? nativeStatus() : nativeStatus({
          active: true,
          runId: "22222222-2222-4222-8222-222222222222",
          participantId: "P001",
          attemptNumber: 3,
          phase: "prepared",
          playbackMode: "unqualifiedWebview",
          playbackQualification: "unqualified",
        });
      }
      if (command === "research_resume_run") throw new Error("IPC rejected");
      throw new Error(`Unexpected terminal command ${command}`);
    },
  }), (error) => {
    assert.equal(error.nativeActivationReconciliation, "unreconciled");
    assert.match(error.message, /does not match this request.*outcome is unknown.*restart/u);
    return true;
  });
  assert.deepEqual(calls, ["research_run_status", "research_resume_run", "research_run_status"]);
});

test("ordinary activation rejection with authoritative idle status needs no rollback", async () => {
  const calls = [];
  await assert.rejects(invokeNativeRunActivation({
    command: "research_start_run",
    payload: { request: { opaque: true } },
    participantId: "P001",
    playbackMode: "unqualifiedWebview",
    async invoke(command) {
      calls.push(command);
      if (command === "research_run_status") return nativeStatus();
      if (command === "research_start_run") throw new Error("validation rejected");
      throw new Error(`Unexpected ${command}`);
    },
  }), (error) => {
    assert.equal(error.nativeActivationReconciliation, "inactiveAfterRejection");
    assert.match(error.message, /rejected before activation/u);
    return true;
  });
  assert.deepEqual(calls, ["research_run_status", "research_start_run", "research_run_status"]);
});

test("versioned protocol activation uses its distinct Start command and reconciliation fence", async () => {
  const calls = [];
  await assert.rejects(invokeNativeRunActivation({
    command: "research_start_protocol_run",
    payload: { request: { researchSettings: {}, assignmentPlan: {}, resolvedProtocolPlan: {} } },
    participantId: "P001",
    playbackMode: "unqualifiedWebview",
    async invoke(command) {
      calls.push(command);
      if (command === "research_run_status") return nativeStatus();
      if (command === "research_start_protocol_run") {
        throw new Error("native questionnaire runtime unavailable");
      }
      throw new Error(`Unexpected ${command}`);
    },
  }), (error) => {
    assert.equal(error.nativeActivationReconciliation, "inactiveAfterRejection");
    assert.match(error.message, /Start was rejected before activation/u);
    return true;
  });
  assert.deepEqual(calls, [
    "research_run_status",
    "research_start_protocol_run",
    "research_run_status",
  ]);
});

test("pending recovery finalization preserves separate ManifestV2 and ManifestV3 contracts", () => {
  const settings = { schema: "affect-research-settings", version: 1 };
  const researchSettings = { schema: "affect-research-settings", version: 2 };
  const assignmentPlan = {
    schema: "affect-research-assignment-plan",
    settingsSha256: "d".repeat(64),
    planHashSha256: "b".repeat(64),
  };
  const resolvedProtocolPlan = {
    participantId: "P001",
    settingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    protocolPlanHashSha256: "c".repeat(64),
  };
  const sharedContext = {
    workspaceId: "44444444-4444-4444-8444-444444444444",
    participantId: "P001",
    settingsSha256: "d".repeat(64),
    researchSettingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    playbackMode: "unqualifiedWebview",
    settings,
    researchSettings,
    assignmentPlan,
    resolvedProtocolPlan,
  };
  const sharedRecovery = {
    recoveryId: "55555555-5555-4555-8555-555555555555",
    runId: "11111111-1111-4111-8111-111111111111",
    participantId: "P001",
    attemptNumber: 2,
    assignmentPlanSha256: "b".repeat(64),
    playbackMode: "unqualifiedWebview",
    playbackQualification: "unqualified",
    finalizationPending: true,
    pendingCompletionStatus: "partial",
  };
  const v2Recovery = {
    ...sharedRecovery,
    protocolContract: "manifestV2",
    settingsSha256: "d".repeat(64),
  };
  const v2Contract = nativePendingFinalizationContract(v2Recovery, {
    ...sharedContext,
    protocolContract: "manifestV2",
  });
  assert.equal(v2Contract.command, "research_finalize_recovery");
  assert.deepEqual(v2Contract.request, {
    workspaceId: sharedContext.workspaceId,
    recoveryId: v2Recovery.recoveryId,
    settings,
    assignmentPlan,
  });
  assert.equal("researchSettings" in v2Contract.request, false);
  assert.equal("resolvedProtocolPlan" in v2Contract.request, false);

  const v3Recovery = {
    ...sharedRecovery,
    protocolContract: "manifestV3",
    settingsSha256: "a".repeat(64),
  };
  const v3Context = { ...sharedContext, protocolContract: "manifestV3" };
  const v3Contract = nativePendingFinalizationContract(v3Recovery, v3Context);
  assert.equal(v3Contract.command, "research_finalize_protocol_recovery");
  assert.deepEqual(v3Contract.request, {
    workspaceId: sharedContext.workspaceId,
    recoveryId: v3Recovery.recoveryId,
    researchSettings,
    assignmentPlan,
    resolvedProtocolPlan,
  });
  assert.deepEqual(v3Contract.expectedReceipt, {
    runId: v3Recovery.runId,
    participantId: "P001",
    attemptNumber: 2,
    completionStatus: "partial",
  });
  assert.equal("inputTestReceiptId" in v3Contract.request, false);
  assert.equal("workspaceFiles" in v3Contract.request, false);
  assert.equal("playbackMode" in v3Contract.request, false);
  assert.equal("settings" in v3Contract.request, false);
  assert.equal(nativePendingFinalizationContract({
    ...v3Recovery,
    finalizationPending: false,
    pendingCompletionStatus: null,
  }, v3Context), null);
  assert.throws(() => nativePendingFinalizationContract({
    ...v3Recovery,
    pendingCompletionStatus: null,
  }, v3Context), /not bound to the selected run/u);
  assert.throws(() => nativePendingFinalizationContract({
    ...v3Recovery,
    runId: "renderer-run",
  }, v3Context), /not bound to the selected run/u);
  assert.throws(() => nativePendingFinalizationContract(v3Recovery, {
    ...v3Context,
    resolvedProtocolPlan: { ...resolvedProtocolPlan, protocolPlanHashSha256: "invalid" },
  }), /ManifestV3 protocol contract/u);
  assert.throws(() => nativePendingFinalizationContract(v3Recovery, {
    ...sharedContext,
    protocolContract: "manifestV2",
  }), /not bound to the selected run/u);
  assert.throws(() => nativePendingFinalizationContract({
    ...v3Recovery,
    finalizationPending: false,
  }, v3Context), /inconsistent or unsupported/u);
});

test("explicit pending finalization cannot be retargeted by a newer resumable recovery", () => {
  const pending = {
    participantId: "P001",
    protocolContract: "manifestV2",
    attemptNumber: 2,
    settingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    playbackMode: "unqualifiedWebview",
    finalizationPending: true,
    pendingCompletionStatus: "partial",
  };
  const newerResumable = {
    ...pending,
    attemptNumber: 3,
    finalizationPending: false,
    pendingCompletionStatus: null,
  };
  const expected = {
    participantId: "P001",
    protocolContract: "manifestV2",
    settingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    playbackMode: "unqualifiedWebview",
    attemptNumber: 2,
    completionStatus: "partial",
  };
  assert.equal(selectPendingNativeFinalizationRecovery([newerResumable, pending], expected), pending);
  assert.equal(selectPendingNativeFinalizationRecovery([newerResumable, pending], {
    ...expected,
    attemptNumber: 3,
  }), null);
  assert.equal(selectPendingNativeFinalizationRecovery([pending], {
    ...expected,
    completionStatus: "completed",
  }), null);
  assert.throws(() => selectPendingNativeFinalizationRecovery([pending, { ...pending }], expected), /duplicate pending finalization identities/u);
});

test("Tauri projects each native input preset through explicit backend capabilities", () => {
  const capability = {
    nativeAuthorityReady: true,
    supportedPresets: [
      "arrowKeys", "wasd", "ijkl", "numpad", "pointerGrid", "mouseButtonsWheel",
      "gamepadDpad", "gamepadLeftStick", "gamepadRightStick", "custom",
    ],
    supportsCustomKeyboard: true,
    supportsCustomMouseButtons: true,
    supportsCustomWheel: true,
    supportsCustomGamepadButtons: true,
    supportsAbsolutePointer: true,
    supportsGamepad: true,
  };
  const availability = nativeInputPresetAvailability(capability);
  assert.equal(availability["arrow-keys"], true);
  assert.equal(availability["pointer-grid"], true);
  assert.equal(availability["gamepad-dpad"], true);

  const pointer = {
    preset: "pointerGrid", kind: "absolute",
    axes: {
      x: { kind: "pointerAxis", axis: "x", invert: false },
      y: { kind: "pointerAxis", axis: "y", invert: true },
    },
  };
  const dpad = {
    preset: "gamepadDpad", kind: "digital",
    directions: {
      up: { kind: "gamepadButton", button: 12 },
      down: { kind: "gamepadButton", button: 13 },
      left: { kind: "gamepadButton", button: 14 },
      right: { kind: "gamepadButton", button: 15 },
    },
  };
  const leftStick = {
    preset: "gamepadLeftStick", kind: "analog",
    axes: {
      x: { kind: "gamepadAxis", index: 0, invert: false },
      y: { kind: "gamepadAxis", index: 1, invert: true },
    },
  };
  const rightStick = {
    ...leftStick,
    preset: "gamepadRightStick",
    axes: {
      x: { kind: "gamepadAxis", index: 2, invert: false },
      y: { kind: "gamepadAxis", index: 3, invert: true },
    },
  };
  const mixedCustom = {
    preset: "custom", kind: "digital",
    directions: {
      up: { kind: "keyboard", code: "KeyW" },
      down: { kind: "mouseButton", button: 0 },
      left: { kind: "wheel", direction: "left" },
      right: { kind: "gamepadButton", button: 0 },
    },
  };
  for (const binding of [pointer, dpad, leftStick, rightStick, mixedCustom]) {
    assert.equal(nativeInputBindingSupported(binding, capability), true);
  }
  assert.equal(nativeInputBindingSupported(pointer, {
    ...capability, supportsAbsolutePointer: false,
  }), false);
  assert.equal(nativeInputBindingSupported(leftStick, {
    ...capability, supportsGamepad: false,
  }), false);
  assert.equal(nativeInputBindingSupported(dpad, {
    ...capability, supportsCustomGamepadButtons: false,
  }), false);
  assert.equal(nativeInputBindingSupported(mixedCustom, {
    ...capability, supportsCustomWheel: false,
  }), false);
  assert.equal(nativeInputBindingSupported({
    ...dpad, directions: { ...dpad.directions, right: undefined },
  }, capability), false);
});

test("native input regions remain bounded to visible client coordinates", () => {
  assert.deepEqual(nativeInputRegionRequest({
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200 }),
  }, "runFeedback", 7, { innerWidth: 800, innerHeight: 600 }), {
    purpose: "runFeedback", layoutEpoch: 7, left: 10, top: 20, width: 100, height: 200,
    viewportWidth: 800, viewportHeight: 600,
  });
});

test("desktop playback defaults qualified and requires an explicit unqualified fallback", () => {
  const unavailable = nativeMediaCapability();
  assert.throws(() => authorizeDesktopPlaybackMode(undefined, unavailable), /Qualified native playback is unavailable/u);
  assert.equal(authorizeDesktopPlaybackMode("unqualifiedWebview", unavailable), "unqualifiedWebview");
  const ready = nativeMediaCapability({
    runtimeBundleState: "verified",
    runtimeIntegrityVerified: true,
    runtimeFileCount: 827,
    runtimeByteLength: 340362958,
    qualifiedStartAvailable: true,
    playerActorReady: true,
    qualifiedFormatMatrixReady: true,
    redistributionReviewReady: true,
    reasonCode: "qualified-native-gstplay-ready",
  });
  assert.equal(authorizeDesktopPlaybackMode("nativeGstPlay", ready), "nativeGstPlay");
  assert.throws(() => authorizeDesktopPlaybackMode("nativeLibvlc", unavailable), /retired/u);
  assert.throws(() => authorizeDesktopPlaybackMode("ambientVlc", unavailable), /Unknown native playback mode/u);

  const interfaceOnly = nativeMediaCapability({
    reasonCode: "native-acquisition-platform-unsupported",
  });
  assert.throws(
    () => authorizeDesktopPlaybackMode("unqualifiedWebview", interfaceOnly),
    /Setup and interface evaluation only/u,
  );
  assert.throws(
    () => authorizeDesktopPlaybackMode("nativeGstPlay", interfaceOnly),
    /native experiment acquisition requires the Windows build/u,
  );
});

test("native media capability v2 is exact, pinned, isolated, and internally consistent", () => {
  assert.deepEqual(validateNativeMediaCapabilityV2(nativeMediaCapability()), nativeMediaCapability());
  assert.throws(() => validateNativeMediaCapabilityV2({
    ...nativeMediaCapability(), extra: true,
  }), /malformed/u);
  assert.throws(() => validateNativeMediaCapabilityV2(nativeMediaCapability({
    ambientRuntimeAllowed: true,
  })), /malformed/u);
  assert.throws(() => validateNativeMediaCapabilityV2(nativeMediaCapability({
    qualifiedStartAvailable: true,
  })), /inconsistent/u);
});

test("native participant projection distinguishes terminal and recoverable partials", () => {
  const detail = participantStateDetail([
    { participantId: "P001", state: "Partial", recoverable: true },
    { participantId: "P002", state: "Partial", recoverable: false },
  ], [{
    participantId: "P001",
    protocolContract: "manifestV2",
    attemptNumber: 2,
    settingsSha256: "a".repeat(64),
    assignmentPlanSha256: "b".repeat(64),
    playbackMode: "unqualifiedWebview",
    pendingCompletionStatus: "partial",
  }]);
  assert.deepEqual(detail, {
    P001: "partial",
    P002: "partial",
    __recoverable: { P001: true, P002: false },
    __finalizationPending: { P001: true, P002: false },
    __finalizationBinding: {
      P001: {
        settingsSha256: "a".repeat(64),
        assignmentPlanSha256: "b".repeat(64),
        protocolContract: "manifestV2",
        playbackMode: "unqualifiedWebview",
        completionStatus: "partial",
        attemptNumber: 2,
      },
    },
  });
});

test("WebView media errors become bounded path-free native interruption reports", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(mediaFailureReport({
    runId,
    mediaErrorCode: 3,
    stimulusId: "video-a",
    stimulusPosition: 2,
    mediaTimeMs: 125.5,
  }), {
    runId,
    reason: "decode",
    stimulusId: "video-a",
    stimulusPosition: 2,
    mediaTimeMs: 125.5,
  });
  assert.equal("path" in mediaFailureReport({
    runId,
    mediaErrorCode: 4,
    stimulusId: "video-a",
    stimulusPosition: 1,
    mediaTimeMs: 0,
  }), false);
  assert.throws(() => mediaFailureReport({
    runId: "stale-renderer-selected-run",
    mediaErrorCode: 3,
    stimulusId: "video-a",
    stimulusPosition: 1,
    mediaTimeMs: 0,
  }), /active native run and opaque stimulus position/u);
});

class ProbeVideo extends EventTarget {
  constructor() {
    super();
    this.duration = 12.5;
    this.videoWidth = 1_920;
    this.videoHeight = 1_080;
    this._currentTime = 0;
    this.paused = true;
    this.seeks = [];
    this.decodedFrames = [];
  }

  get currentTime() { return this._currentTime; }

  set currentTime(value) {
    this._currentTime = value;
    this.seeks.push(value);
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }

  load() {
    if (!this.src) return;
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }

  async play() {
    this.paused = false;
  }

  pause() { this.paused = true; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  requestVideoFrameCallback(callback) {
    const mediaTime = this.currentTime;
    this.decodedFrames.push(mediaTime);
    queueMicrotask(() => callback(0, { mediaTime }));
    return this.decodedFrames.length;
  }
}

test("native WebView attestation requires near-start, midpoint, and near-end decoded frames", async () => {
  const calls = [];
  const verified = {
    workspaceFileId: "file-opaque-1",
    displayName: "Complete Video.mp4",
    sha256: "a".repeat(64),
    byteLength: 4_096,
    mimeType: "video/mp4",
    durationMs: 12_500,
    decodeStatus: "attestedUnqualified",
    decodeBackend: "webviewVideoFrameCallback",
    decodeAttestation: "representativeFramesV1",
    decodedPositionsMs: [250, 6_250, 12_250],
    source: {
      kind: "workspaceFile",
      relativePath: "stimuli/.workspace/file-opaque-1",
      mimeType: "video/mp4",
      sha256: "a".repeat(64),
      byteLength: 4_096,
      durationMs: 12_500,
    },
  };
  let clock = 100;
  const result = await probeAndAttestNativeVideo({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    summary: {
      ...verified,
      durationMs: null,
      decodeStatus: "unverified",
      decodeBackend: null,
      decodeAttestation: null,
      decodedPositionsMs: [],
      source: null,
    },
    videoFactory: () => new ProbeVideo(),
    performanceNow: () => { clock += 100; return clock; },
    async invoke(command, payload) {
      calls.push([command, structuredClone(payload)]);
      if (command === "research_workspace_media_url") {
        return {
          mediaGrantId: "grant-opaque-1",
          workspaceFileId: "file-opaque-1",
          mediaUrl: "http://research-media.localhost/grant-opaque-1",
          byteLength: 4_096,
          mimeType: "video/mp4",
          durationMs: null,
          decodeStatus: "unverified",
          decodeBackend: null,
          decodeAttestation: null,
          decodedPositionsMs: [],
        };
      }
      if (command === "research_attest_workspace_decode") return verified;
      throw new Error(`Unexpected command ${command}`);
    },
  });
  assert.deepEqual(result, verified);
  assert.deepEqual(calls.map(([command]) => command), [
    "research_workspace_media_url",
    "research_attest_workspace_decode",
  ]);
  const attestation = calls[1][1].attestation;
  assert.equal(attestation.attestationKind, "attestRepresentativeFramesV1");
  assert.equal(attestation.decodeBackend, "webviewVideoFrameCallback");
  assert.equal(attestation.observedDurationMs, 12_500);
  assert.equal(attestation.videoWidth, 1_920);
  assert.equal(attestation.videoHeight, 1_080);
  assert.ok(attestation.mutedPlaybackMs >= 50);
  assert.deepEqual(attestation.decodedPositionsMs, [250, 6_250, 12_250]);
  assert.equal("path" in attestation, false);
  assert.equal("relativePath" in attestation, false);
});

test("native metadata and seeking cannot pass without frame callbacks, and the grant is revoked", async () => {
  const video = new ProbeVideo();
  video.requestVideoFrameCallback = undefined;
  const calls = [];
  const summary = {
    workspaceFileId: "file-opaque-2",
    displayName: "Metadata Only.mp4",
    sha256: "b".repeat(64),
    byteLength: 2_048,
    mimeType: "video/mp4",
    durationMs: null,
    decodeStatus: "unverified",
    decodeBackend: null,
    decodeAttestation: null,
    decodedPositionsMs: [],
    source: null,
  };
  await assert.rejects(probeAndAttestNativeVideo({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    summary,
    videoFactory: () => video,
    probeTimeoutMs: 25,
    async invoke(command, payload) {
      calls.push([command, structuredClone(payload)]);
      if (command === "research_workspace_media_url") {
        return {
          mediaGrantId: "grant-opaque-2",
          workspaceFileId: summary.workspaceFileId,
          mediaUrl: "http://research-media.localhost/grant-opaque-2",
          byteLength: summary.byteLength,
          mimeType: summary.mimeType,
          durationMs: null,
          decodeStatus: "unverified",
          decodeBackend: null,
          decodeAttestation: null,
          decodedPositionsMs: [],
        };
      }
      if (command === "research_attest_workspace_decode") return summary;
      throw new Error(`Unexpected command ${command}`);
    },
  }), /Decoded-frame verification requires desktop Chrome or Edge/u);
  assert.deepEqual(calls.map(([command]) => command), [
    "research_workspace_media_url",
    "research_attest_workspace_decode",
  ]);
  assert.deepEqual(calls[1][1].attestation, {
    attestationKind: "revokeGrant",
    decodeBackend: "webviewVideoFrameCallback",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    mediaGrantId: "grant-opaque-2",
    workspaceFileId: summary.workspaceFileId,
    sha256: summary.sha256,
    byteLength: summary.byteLength,
    mimeType: summary.mimeType,
  });
});

test("desktop entrypoint sequences the shared UI before the path-free Research native bridge", async () => {
  const [html, entrySource, source, appSource] = await Promise.all([
    readFile(new URL("../desktop/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/src/research/native-entry.js", import.meta.url), "utf8"),
    readFile(new URL("../site/src/research/native-bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../site/src/research/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /src="\.\.\/site\/src\/research\/native-entry\.js"/u);
  assert.doesNotMatch(html, /runtime-bridge\.js|app\.js/u);
  assert.match(entrySource, /import \{ bootNativeBridge \} from "\.\/native-bridge\.js"/u);
  assert.match(entrySource, /bootstrapResearchSurface\(\{[\s\S]*surface: "tauri",[\s\S]*initializeRuntime: bootNativeBridge/u);
  for (const command of [
    "research_choose_workspace",
    "research_open_workspace_location",
    "research_store_questionnaire_asset",
    "research_rescan_stimuli",
    "research_import_stimuli",
    "research_video_library",
    "research_save_stimulus_order",
    "research_export_video_library",
    "research_native_media_capability",
    "research_native_protocol_capability",
    "research_protocol_preflight",
    "research_input_capability",
    "research_input_set_region",
    "research_input_begin_test",
    "research_input_begin_capture",
    "research_input_status",
    "research_storage_readiness",
    "research_start_run",
    "research_resume_run",
    "research_finalize_recovery",
    "research_start_protocol_run",
    "research_resume_protocol_run",
    "research_finalize_protocol_recovery",
    "research_run_status",
    "research_finish_run",
    "research_report_media_failure",
  ]) assert.match(source, new RegExp(`"${command}"`, "u"));
  assert.match(source, /async #importStimuli\(selectionKind, workspaceId\)[\s\S]*?research_import_stimuli[\s\S]*?if \(result\) await this\.#catalogue\(result\)/u);
  assert.doesNotMatch(source, /this\.invoke\("research_import_library_videos"/u);
  assert.match(source, /const WORKSPACE_LOCATIONS = new Set\(\["workspaceRoot", "videoLibrary", "experimentPackage"\]\)/u);
  assert.match(source, /research_open_workspace_location", \{\s*workspaceId: this\.workspace\.workspaceId,\s*location,/u);
  assert.doesNotMatch(source, /#stimulus-add-repository|#stimulus-add-youtube|#stimulus-source/u);
  assert.match(source, /playbackMode/u);
  assert.match(source, /let decodeQualification = "attestedUnqualified"/u);
  assert.match(source, /decodeQualification = "attestedQualified"/u);
  assert.match(source, /NativeMediaController/u);
  assert.match(source, /attestNativeGstCatalogue/u);
  assert.match(source, /this\.nativeTimingReady = \(nativeRunStatusHandshake\(status\)[\s\S]+nativePackageProtocolCapability\.nativeStartReady/u);
  assert.match(source, /NativePackageProtocolAdapter/u);
  assert.doesNotMatch(source, /timingWorkerReady:\s*true/u);
  assert.match(source, /const video = previous\.cloneNode\?\.\(false\)/u);
  assert.match(source, /#mediaGenerationMatches\(fence, mediaEpoch, video\)/u);
  assert.match(source, /this\.run\.lifecycleInFlight/u);
  assert.match(source, /run\.terminalInFlight = "failClosedPending"/u);
  assert.match(source, /Native run outcome unknown — restart required/u);
  assert.match(source, /Native recovery-finalization receipt did not match the pending durable run contract/u);
  assert.match(source, /selectPendingNativeFinalizationRecovery\(compatibleRecoveries/u);
  assert.match(source, /command: hasQuestionnaires \? "research_resume_protocol_run" : "research_resume_run"/u);
  assert.match(source, /command: hasQuestionnaires \? "research_start_protocol_run" : "research_start_run"/u);
  assert.match(source, /this\.invoke\(pendingFinalization\.command, \{\s*request: pendingFinalization\.request,/u);
  assert.match(source, /request: hasQuestionnaires \? \{[\s\S]+researchSettings,[\s\S]+assignmentPlan: plan,[\s\S]+resolvedProtocolPlan,[\s\S]+\} : \{[\s\S]+settings,[\s\S]+assignmentPlan: plan,/u);
  assert.match(source, /hasQuestionnaires[\s\S]+\? this\.#protocolWorkspaceBindings\(researchSettings, resolvedProtocolPlan\)[\s\S]+: this\.#workspaceBindings\(plan\)/u);
  assert.match(appSource, /recoveryFinalizationOnly: true,[\s\S]+pendingFinalizationProtocolContract: pendingFinalization\.protocolContract,[\s\S]+researchSettings: protocolSettingsSnapshot,[\s\S]+resolvedProtocolPlan: protocolPlan,/u);
  assert.match(source, /Native status did not match the active renderer run/u);
  assert.doesNotMatch(source, /Stopped by native error/u);
  assert.doesNotMatch(source, /research_update_affect_state|research_gamepad_button/u);
  assert.doesNotMatch(source, /invoke\([^\n]+(?:filePath|rootPath|outputPath)/u);
});

const preparedWorkspaceId = "11111111-1111-4111-8111-111111111111";
function preparedWorkspaceReceipt(workspaceId = preparedWorkspaceId) {
  return { selected: true, workspaceId, displayName: "Synthetic workspace", namespace: "research",
    stimuliCount: 0, librariesReady: true };
}
function preparedScanSummary(name = "one") {
  return { workspaceFileId: name, displayName: `${name}.mp4`, sha256: "a".repeat(64), byteLength: 10,
    mimeType: "video/mp4", durationMs: 1000, decodeStatus: "unverified", source: null };
}
async function preparedBridgeFixture() {
  const root = new EventTarget(), win = new EventTarget(), events = [], calls = [], actorCalls = [];
  const mode = { value: "nativeGstPlay" }, progress = { textContent: "unchanged" };
  const viewport = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  let connector, scan = { workspaceId: preparedWorkspaceId, stimuli: [preparedScanSummary()] };
  root.dataset = { researchProgram: "planner" };
  root.querySelector = selector => selector === "#native-playback-mode" ? mode
    : selector === "#workspace-status" ? progress : selector === ".preview-pane .preview-primary-stage" ? viewport : null;
  root.researchUi = { settings: { stimuli: { items: [] } }, connectPlannerNativeWorkspace: value => { connector = value; } };
  for (const name of [RESEARCH_UI_EVENTS.workspaceReady, RESEARCH_UI_EVENTS.stimuliCatalogued]) {
    root.addEventListener(name, event => events.push({ type: name, detail: structuredClone(event.detail) }));
  }
  const bridge = new NativeResearchRuntimeBridge(root, { windowObject: win,
    setIntervalObject: () => 1, clearIntervalObject: () => {}, invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "research_desktop_identity") return { schema: "affect-research-desktop-identity", version: 1, program: "planner" };
      if (command === "research_native_media_capability") return nativeMediaCapability({ runtimeBundleState: "verified",
        runtimeIntegrityVerified: true, runtimeFileCount: 827, runtimeByteLength: 340362958, playerActorReady: true });
      if (command === "research_input_capability") return { nativeAuthorityReady: false, supportedPresets: [] };
      if (command === "research_rescan_stimuli") return structuredClone(scan);
      return {};
    } });
  await bridge.initialize();
  // Synthetic controller receipts exercise the actual catalogue orchestration,
  // not native playback or the truth of a media qualification claim.
  bridge.nativeMedia = {
    prepare: async ({ summary }) => { actorCalls.push(["prepare", summary.workspaceFileId]); },
    awaitPrepared: async () => { actorCalls.push(["await"]); },
    attestDecode: async ({ summary }) => { actorCalls.push(["attest", summary.workspaceFileId]); return {
      ...summary, decodeStatus: "attestedQualified", decodeBackend: "nativeGstPlay", decodeAttestation: "nativeDecodedSnapshotsV1",
      displayGeometry: { synthetic: true }, source: { kind: "workspaceFile", relativePath: `stimuli/${summary.displayName}` },
    }; },
    stop: async () => { actorCalls.push(["stop"]); },
  };
  return { root, bridge, connector, events, calls, actorCalls, mode, progress, scan,
    setScan: value => { scan = value; } };
}

test("Planner connector prepares detached workspace data and commits without events or rescans", async () => {
  const f = await preparedBridgeFixture();
  assert.deepEqual(Object.keys(f.connector).sort(), ["getWorkspaceId", "prepareCatalogue", "prepareWorkspace"]);
  assert.equal(f.connector.getWorkspaceId(), null);
  const receipt = preparedWorkspaceReceipt(), count = f.calls.length;
  const prepared = f.connector.prepareWorkspace(receipt);
  receipt.displayName = "Changed caller data";
  prepared.projection.label = "Changed projection copy";
  assert.equal(prepared.projection.label, "Synthetic workspace");
  assert.equal(f.bridge.workspace, null); assert.equal(f.events.length, 0); assert.equal(f.calls.length, count);
  assert.equal(prepared.commit(), undefined);
  assert.equal(f.connector.getWorkspaceId(), preparedWorkspaceId);
  assert.equal(f.bridge.workspace.displayName, "Synthetic workspace");
  assert.equal(f.events.length, 0); assert.equal(f.calls.length, count);
  assert.throws(() => prepared.commit(), /stale|already committed/u);
  assert.throws(() => f.connector.prepareWorkspace({ ...receipt, librariesReady: false }), /libraries/u);
  assert.throws(() => f.connector.prepareWorkspace({ ...receipt, workspaceId: "not-a-uuid" }), /libraries/u);
  f.bridge.destroy(); assert.equal(f.connector.getWorkspaceId(), null);
});

test("prepared catalogue uses existing sequential authority without early state/events/progress", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  const original = f.bridge.catalog;
  const prepared = await f.connector.prepareCatalogue(f.scan, { isCurrent: () => true });
  assert.equal(f.bridge.catalog, original); assert.equal(original.size, 0);
  assert.equal(f.events.length, 0); assert.equal(f.progress.textContent, "unchanged");
  assert.deepEqual(f.actorCalls.map(([name]) => name), ["prepare", "await", "attest", "stop"]);
  const projection = prepared.projection;
  projection.items[0].stimulus.title = "Mutated copy";
  assert.equal(prepared.projection.items[0].stimulus.title, "one.mp4");
  prepared.commit();
  assert.equal(f.bridge.catalog.get("one").stimulus.title, "one.mp4");
  assert.equal(f.events.length, 0); assert.equal(f.progress.textContent, "unchanged");
  assert.throws(() => prepared.commit(), /stale|already committed/u);
  f.bridge.destroy();
});

test("prepared catalogue guards caller, workspace, mode, settings, capability, newer catalogue and destruction", async () => {
  for (const change of ["caller", "workspace", "mode", "settings", "capability", "catalogue", "destroy"]) {
    const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
    let current = true;
    const prepared = await f.connector.prepareCatalogue(f.scan, { isCurrent: () => current });
    if (change === "caller") current = false;
    if (change === "workspace") f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
    if (change === "mode") f.mode.value = "unqualifiedWebview";
    if (change === "settings") f.root.researchUi.settings.stimuli.items.push({ stimulusId: "new", source: { relativePath: "new.mp4" } });
    if (change === "capability") f.bridge.nativeMediaCapability = { ...f.bridge.nativeMediaCapability, playerActorReady: false };
    if (change === "catalogue") (await f.connector.prepareCatalogue({ workspaceId: preparedWorkspaceId, stimuli: [] })).commit();
    if (change === "destroy") f.bridge.destroy();
    const catalogue = f.bridge.catalog;
    assert.equal(prepared.isCurrent(), false, change);
    assert.throws(() => prepared.commit(), /stale/u, change);
    assert.equal(f.bridge.catalog, catalogue); assert.equal(f.events.length, 0);
    if (change !== "destroy") f.bridge.destroy();
  }
});

test("workspace prepare is canceled by a later bridge publication or caller lifetime", async () => {
  const f = await preparedBridgeFixture();
  let current = true;
  const canceled = f.connector.prepareWorkspace(preparedWorkspaceReceipt(), { isCurrent: () => current });
  current = false; assert.throws(() => canceled.commit(), /stale/u); assert.equal(f.bridge.workspace, null);
  const old = f.connector.prepareWorkspace(preparedWorkspaceReceipt());
  f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
  assert.throws(() => old.commit(), /stale/u);
  f.bridge.destroy();
});

test("a canceled pending native probe stops its actor and cannot publish or change progress", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  let entered, resume, current = true;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { resume = resolve; });
  f.bridge.nativeMedia.awaitPrepared = async () => { entered(); await pending; };
  const work = f.connector.prepareCatalogue(f.scan, { isCurrent: () => current });
  await started; current = false; resume();
  await assert.rejects(work, /stale/u);
  assert.equal(f.bridge.catalog.size, 0); assert.equal(f.events.length, 0);
  assert.equal(f.progress.textContent, "unchanged");
  assert.equal(f.actorCalls.filter(([name]) => name === "stop").length, 1);
  f.bridge.destroy();
});

test("failed or duplicate catalogue preparation never partially accepts verified entries", async () => {
  for (const failure of ["decode", "duplicate"]) {
    const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
    const original = f.bridge.catalog;
    const decode = f.bridge.nativeMedia.attestDecode;
    if (failure === "decode") f.bridge.nativeMedia.attestDecode = async args => {
      if (args.summary.workspaceFileId === "two") throw Error("Synthetic decode failure"); return decode(args);
    };
    await assert.rejects(f.connector.prepareCatalogue({ workspaceId: preparedWorkspaceId,
      stimuli: [preparedScanSummary(), preparedScanSummary(failure === "decode" ? "two" : "one")] }), /failed/u);
    assert.equal(f.bridge.catalog, original); assert.equal(original.size, 0); assert.equal(f.events.length, 0);
    f.bridge.destroy();
  }
});

test("legacy GUI scan reuses preparation, projects after commit and withdraws on a current failure", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  f.root.id = "native-playback-mode";
  f.root.dispatchEvent(new Event("change")); await f.bridge.operation;
  assert.equal(f.events.length, 1); assert.equal(f.events[0].detail.items.length, 1);
  assert.equal(f.bridge.catalog.size, 1); assert.match(f.progress.textContent, /complete/u);
  f.bridge.nativeMedia.attestDecode = async () => { throw Error("Synthetic decode failure"); };
  f.root.dispatchEvent(new Event("change")); await f.bridge.operation;
  assert.equal(f.bridge.catalog.size, 0); assert.deepEqual(f.events.at(-1).detail, { items: [], replace: true });
  f.bridge.destroy();
});

test("a late GUI scan cannot erase a newly selected workspace catalogue", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  let entered, resume;
  const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { resume = resolve; });
  f.bridge.nativeMedia.awaitPrepared = async () => { entered(); await pending; };
  f.root.id = "native-playback-mode"; f.root.dispatchEvent(new Event("change"));
  await started;
  f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
  const catalogue = f.bridge.catalog;
  resume(); await f.bridge.operation;
  assert.equal(f.bridge.catalog, catalogue); assert.equal(f.events.length, 0);
  f.bridge.destroy();
});

test("native scan receipts are fenced before awaiting I/O, including same-workspace newer publication", async () => {
  for (const changeWorkspace of [false, true]) {
    const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
    let entered, resume;
    const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { resume = resolve; });
    const invoke = f.bridge.invoke;
    f.bridge.invoke = async (command, payload) => {
      if (command === "research_rescan_stimuli") { entered(); return pending; }
      return invoke(command, payload);
    };
    f.root.id = "native-playback-mode"; f.root.dispatchEvent(new Event("change")); await started;
    if (changeWorkspace) f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
    const id = f.connector.getWorkspaceId();
    (await f.connector.prepareCatalogue({ workspaceId: id, stimuli: [preparedScanSummary("newer")] })).commit();
    const currentCatalogue = f.bridge.catalog;
    resume(f.scan); await f.bridge.operation;
    assert.equal(f.bridge.catalog, currentCatalogue); assert.ok(currentCatalogue.has("newer"));
    assert.equal(f.events.length, 0);
    assert.equal(f.actorCalls.filter(([kind]) => kind === "prepare").length, 1);
    f.bridge.destroy();
  }
});

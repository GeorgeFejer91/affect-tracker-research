import test from "node:test";
import assert from "node:assert/strict";

import {
  NativeResearchRuntimeBridge,
} from "../site/src/research/native-bridge.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/app.js";

const FINISHED_RUN_STATUS = Object.freeze({
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
});

const NATIVE_MEDIA_CAPABILITY = Object.freeze({
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
});

const NATIVE_PROTOCOL_CAPABILITY = Object.freeze({
  schema: "affect-research-native-questionnaire-protocol-capability",
  version: 1,
  settingsV2ValidationReady: true,
  questionnaireCsvImportReady: true,
  protocolPlanValidationReady: true,
  nativeStartResumeReady: false,
  durableDraftCheckpointReady: false,
  atomicSubmissionReady: false,
  manifestV3FinalizationReady: false,
  reasonCode: "native-external-protocol-not-integrated",
});

class ResearchRoot extends EventTarget {
  constructor() {
    super();
    this.startStatus = { textContent: "" };
    this.runVideo = {
      hidden: false,
      pause() {},
      removeAttribute() {},
      load() {},
    };
    this.researchUi = {
      inputBinding: null,
      applyNativeInputStatus() {},
    };
  }

  querySelector(selector) {
    if (selector === "#start-status") return this.startStatus;
    if (selector === "#run-video") return this.runVideo;
    return null;
  }
}

function definitionReceipt() {
  return {
    definition: {
      schema: "affect-research-experiment",
      version: 1,
      experimentId: "video-affect-v1",
      title: "Video Affect Study",
      stimuli: [{
        stimulusId: "calm-01",
        title: "Calm video 01",
        relativePath: "stimuli/calm-01.mp4",
      }],
      blocks: [{ blockId: "main", label: "Main block" }],
      schedules: [{
        participantId: "P001",
        blocks: [{
          blockId: "main",
          videos: [{ stimulusId: "calm-01", isiAfterMs: 3_000 }],
        }],
      }],
    },
    sourceByteSha256: "a".repeat(64),
    definitionSha256: "b".repeat(64),
  };
}

test("native experiment load event invokes the path-free picker and forwards its receipt", async () => {
  const root = new ResearchRoot();
  const calls = [];
  let experimentResult = definitionReceipt();
  let packageResult = {
    package: { packageId: "portable-study" },
    sourceText: "{}\n",
    sourceByteSha256: "c".repeat(64),
    canonicalSourceText: "{}\n",
    canonicalSourceByteSha256: "c".repeat(64),
  };
  const invoke = async (...args) => {
    const [command] = args;
    calls.push(args);
    if (command === "research_workspace_status") return { selected: false };
    if (command === "research_source_capabilities") return {};
    if (command === "research_native_media_capability") return NATIVE_MEDIA_CAPABILITY;
    if (command === "research_native_protocol_capability") return NATIVE_PROTOCOL_CAPABILITY;
    if (command === "research_input_capability") return { nativeAuthorityReady: false, supportedPresets: [] };
    if (command === "research_input_status") return {};
    if (command === "research_run_status") return FINISHED_RUN_STATUS;
    if (command === "research_load_experiment") {
      if (experimentResult instanceof Error) throw experimentResult;
      return experimentResult;
    }
    if (command === "research_load_experiment_package") return packageResult;
    if (command === "research_save_experiment_package") return {
      schema: "affect-research-saved-experiment-package-receipt",
      version: 1,
      packageId: "portable-study",
      packageDefinitionSha256: "d".repeat(64),
      canonicalSourceByteSha256: "c".repeat(64),
      byteLength: 3,
    };
    throw new Error(`Unexpected command: ${command}`);
  };
  const bridge = new NativeResearchRuntimeBridge(root, {
    invoke,
    windowObject: new EventTarget(),
    setIntervalObject: () => 1,
    clearIntervalObject: () => {},
  });
  await bridge.initialize();

  const received = [];
  root.addEventListener(RESEARCH_UI_EVENTS.experimentLoaded, (event) => received.push(event.detail));
  const request = new CustomEvent(RESEARCH_UI_EVENTS.loadExperimentRequest, { cancelable: true });
  root.dispatchEvent(request);
  await bridge.operation;

  assert.equal(request.defaultPrevented, true);
  assert.deepEqual(received, [{ receipt: experimentResult }]);
  const loaderCalls = calls.filter(([command]) => command === "research_load_experiment");
  assert.deepEqual(loaderCalls, [["research_load_experiment"]]);

  experimentResult = null;
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.loadExperimentRequest, { cancelable: true }));
  await bridge.operation;
  assert.equal(received.length, 1, "native picker cancellation must not replace the loaded experiment");

  experimentResult = new Error("experiment-contract-invalid");
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.loadExperimentRequest, { cancelable: true }));
  await bridge.operation;
  assert.equal(root.startStatus.textContent, "experiment-contract-invalid");
  assert.equal(received.length, 1, "native parse errors must not dispatch an experiment receipt");

  const packageReceipts = [];
  root.addEventListener(RESEARCH_UI_EVENTS.experimentPackageLoaded, (event) => {
    packageReceipts.push(event.detail);
  });
  const packageRequest = new CustomEvent(
    RESEARCH_UI_EVENTS.loadExperimentPackageRequest,
    { cancelable: true },
  );
  root.dispatchEvent(packageRequest);
  await bridge.operation;
  assert.equal(packageRequest.defaultPrevented, true);
  assert.deepEqual(packageReceipts, [{ receipt: packageResult }]);
  assert.deepEqual(
    calls.filter(([command]) => command === "research_load_experiment_package"),
    [["research_load_experiment_package"]],
  );

  const saveRequest = new CustomEvent(
    RESEARCH_UI_EVENTS.saveExperimentPackageRequest,
    { cancelable: true, detail: { sourceText: "{}\n" } },
  );
  root.dispatchEvent(saveRequest);
  await bridge.operation;
  assert.equal(saveRequest.defaultPrevented, true);
  assert.deepEqual(
    calls.filter(([command]) => command === "research_save_experiment_package"),
    [["research_save_experiment_package", { sourceText: "{}\n" }]],
  );

  packageResult = null;
  root.dispatchEvent(new CustomEvent(
    RESEARCH_UI_EVENTS.loadExperimentPackageRequest,
    { cancelable: true },
  ));
  await bridge.operation;
  assert.equal(packageReceipts.length, 1, "native package picker cancellation must preserve state");

  bridge.destroy();
});

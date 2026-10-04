import assert from "node:assert/strict";
import test from "node:test";

import {
  NativePackageProtocolAdapter,
  validateNativePackageProtocolCapabilityV1,
  validateNativePackagePreflightV1,
  validateNativePackageRecoveryListingV1,
  validateNativePackageRunStatusV1,
  validateNativePackageStartReceiptV1,
} from "../site/src/research/native-package-protocol.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const OUTPUT = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const SOURCE = "{old package metadata}";

function capability(overrides = {}) {
  return {
    schema: "affect-research-native-package-protocol-capability",
    version: 1,
    backend: "historical-backend",
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

function recoveryListing() {
  const recoveryId = "44444444-4444-4444-8444-444444444444";
  return {
    schema: "affect-research-package-recovery-listing",
    version: 1,
    packageSourceByteSha256: HASH,
    recoveries: [{
      recoveryId, runId: RUN, participantId: "P001", attemptNumber: 1,
      settingsSha256: HASH, assignmentPlanSha256: HASH, protocolPlanSha256: HASH,
      packageId: "old-package", packageDefinitionSha256: HASH,
      languageId: "en", languageSelectionPath: ["en"], assignmentSha256: HASH,
      safeProtocolStepPosition: 1, protocolStepCount: 3,
      resumable: true, finalizationPending: false, completionStatus: null,
    }],
    participants: [{
      participantId: "P001", state: "partial", latestAttemptNumber: 1,
      recoveryId, finalizationPending: false,
    }],
    quarantinedCount: 0,
  };
}

test("historical package capability is readable but execution is always unavailable", async () => {
  assert.equal(validateNativePackageProtocolCapabilityV1(capability()).nativeStartReady, true);
  assert.throws(() => validateNativePackageProtocolCapabilityV1({ ...capability(), extra: true }), /malformed/u);
  assert.throws(() => validateNativePackageProtocolCapabilityV1(capability({ protocolPlanV2Ready: false })), /inconsistent/u);
  const calls = [];
  const adapter = new NativePackageProtocolAdapter(new EventTarget(), {
    invoke: async command => { calls.push(command); return capability(); },
    dispatch: () => {},
  });
  const reported = await adapter.initialize();
  assert.deepEqual(calls, ["research_package_protocol_capability"]);
  assert.equal(reported.backend, "html-video");
  assert.equal(reported.nativeStartReady, false);
  assert.equal(reported.reasonCode, "legacy-package-execution-retired");
  assert.equal(adapter.active, false);
  assert.equal(adapter.owns({ experimentPackageSourceText: SOURCE }), true);
});

test("historical recovery metadata is displayed without offering resume or finalization", async () => {
  const events = [], calls = [];
  const adapter = new NativePackageProtocolAdapter(new EventTarget(), {
    invoke: async (command, payload) => {
      calls.push([command, payload]);
      return recoveryListing();
    },
    dispatch: (type, detail) => events.push([type, detail]),
  });
  const listing = await adapter.refreshRecoveries(WORKSPACE, SOURCE);
  assert.equal(listing.recoveries[0].resumable, true);
  assert.deepEqual(calls, [["research_package_recoveries", {
    request: { workspaceId: WORKSPACE, experimentPackageSourceText: SOURCE },
  }]]);
  assert.equal(events[0][0], "affect-research:participant-states");
  assert.equal(events[0][1].P001, "partial");
  assert.deepEqual(events[0][1].__recoverable, { P001: false });
  assert.deepEqual(events[0][1].__finalizationPending, { P001: false });
  assert.deepEqual(events[0][1].__recoveryBinding, {});
  assert.deepEqual(events[0][1].__finalizationBinding, {});
  assert.throws(() => validateNativePackageRecoveryListingV1({
    ...recoveryListing(), participants: [],
  }), /undeclared/u);
});

test("historical preflight reads exact metadata while withholding Start readiness", async () => {
  const expected = {
    packageSourceByteSha256: HASH, packageDefinitionSha256: HASH,
    participantId: "P001", settingsSha256: HASH, assignmentPlanSha256: HASH,
    assignmentSha256: HASH, protocolPlanSha256: HASH, assetBindingCount: 2,
    protocolStepCount: 3, stimulusStepCount: 2, questionnaireStepCount: 1,
  };
  const receipt = {
    schema: "affect-research-native-package-preflight", version: 1,
    ...expected, assetBindingsSha256: HASH, nativeStartReady: true,
  };
  assert.equal(validateNativePackagePreflightV1(receipt, expected).nativeStartReady, true);
  assert.throws(() => validateNativePackagePreflightV1({ ...receipt, extra: true }, expected), /malformed/u);
  const calls = [];
  const adapter = new NativePackageProtocolAdapter(new EventTarget(), {
    invoke: async (command, payload) => { calls.push([command, payload]); return receipt; },
    dispatch: () => {},
  });
  const projected = await adapter.preflight(WORKSPACE, SOURCE, {
    ...expected, selectedLanguageId: "en", languageSelectionPath: ["en"],
  });
  assert.equal(projected.nativeStartReady, false);
  assert.deepEqual(calls, [["research_package_preflight", { request: {
    workspaceId: WORKSPACE, experimentPackageSourceText: SOURCE,
    participantId: "P001", selectedLanguageId: "en", languageSelectionPath: ["en"],
  } }]]);
});

test("historical Start and run commands fail closed before any IPC", async () => {
  const calls = [];
  const adapter = new NativePackageProtocolAdapter(new EventTarget(), {
    invoke: async command => { calls.push(command); throw new Error("unexpected IPC"); },
    dispatch: () => {},
  });
  await assert.rejects(adapter.start({}, WORKSPACE), /older experiment package cannot start/u);
  for (const method of ["questionnaireDraft", "questionnaireSubmit", "togglePause", "continue", "finish"]) {
    await assert.rejects(adapter[method](), /older experiment package cannot start/u);
  }
  assert.equal(await adapter.refresh(), null);
  assert.equal(await adapter.resize(), undefined);
  assert.deepEqual(calls, []);
  adapter.destroy();
  assert.equal(adapter.active, false);
});

test("historical Start receipts and status remain readable as opaque metadata", () => {
  const receipt = {
    runId: RUN, participantId: "P001", attemptNumber: 1,
    sessionStem: "P001_20260910T120000000Z_R01",
    settingsSha256: HASH, assignmentPlanSha256: HASH, protocolPlanSha256: HASH,
    packageSourceByteSha256: HASH, outputReceiptId: OUTPUT,
    resumed: false, resumeAtProtocolStepPosition: 1,
    playbackMode: "historical-mode", playbackQualification: "historical",
  };
  assert.equal(validateNativePackageStartReceiptV1(receipt).playbackMode, "historical-mode");
  assert.throws(() => validateNativePackageStartReceiptV1({ ...receipt, playbackMode: "" }), /malformed/u);
  const status = {
    active: true, runId: RUN, participantId: "P001", attemptNumber: 1,
    phase: "playing", protocolStepPosition: 1, safeProtocolStepPosition: 0,
    protocolStepCount: 3, questionnaire: null, stimulus: {
      protocolStepPosition: 1, stimulusPosition: 1, stimulusCount: 1,
      stimulusId: "calm-01", title: "Calm video", mediaTimeMs: 0,
      durationMs: 12_345, prepared: true,
    },
    intervalDurationMs: null, intervalRemainingMs: null,
    sampleCount: 0, eventCount: 2, gapEventCount: 0, missedSlotCount: 0,
    coalescedInputUpdateCount: 0, submittedResponseCount: 0, draftResponseCount: 0,
    currentValence: 0, currentArousal: 0, inputActive: false,
    writeHealthy: true, lslEnabled: false, failureCode: null,
  };
  assert.equal(validateNativePackageRunStatusV1(status).phase, "playing");
  assert.throws(() => validateNativePackageRunStatusV1({ ...status, runId: null }), /identity/u);
});

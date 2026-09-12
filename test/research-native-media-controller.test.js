import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NativeMediaController,
  nativeMediaViewportCssV1,
  validateNativeDecodedStimulusSummaryV1,
  validateNativeDecodedStimulusSummaryV2,
  validateNativeMediaPrepareReceiptV1,
  validateNativeMediaStatusV1,
} from "../site/src/research/native-media-controller.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";
const WORKSPACE = "33333333-3333-4333-8333-333333333333";
const FILE = `wf-${"a".repeat(24)}`;
const PACKAGE_FILE = `pa-${"c".repeat(64)}`;

test("native serialized Planner summary v2 uses a safe declared location independently of opaque ID", () => {
  // Rust serializes the actual workspace producer into this same fixture shape,
  // normalizing only the opaque test ID; no native ID recipe is copied into JS.
  const summary = JSON.parse(readFileSync(new URL("./fixtures/native-decoded-summary-v2.json", import.meta.url)));
  assert.deepEqual(validateNativeDecodedStimulusSummaryV2(summary), summary);
  assert.throws(() => validateNativeDecodedStimulusSummaryV1(summary), /malformed/u);
  for (const relativePath of ["stimuli/group/clip.mp4", "stimuli/grüppe/clip.mp4"]) {
    assert.equal(validateNativeDecodedStimulusSummaryV2({ ...summary, source: { ...summary.source, relativePath } }).source.relativePath, relativePath);
  }
  for (const relativePath of ["../clip.mp4", "stimuli/../clip.mp4", "stimuli//clip.mp4", "stimuli/./clip.mp4",
    "assets/stimuli/clip.mp4", "C:/clip.mp4", "stimuli/group\\clip.mp4", "stimuli/group /clip.mp4",
    "stimuli/group./clip.mp4", "stimuli/clip.mp4 ", "stimuli/gru\u0308ppe/clip.mp4", "stimuli/clip\u0000.mp4"]) {
    assert.throws(() => validateNativeDecodedStimulusSummaryV2({ ...summary, source: { ...summary.source, relativePath } }), /malformed/u);
  }
  const historical = decodedSummary();
  assert.throws(() => validateNativeDecodedStimulusSummaryV1({ ...historical, source: { ...historical.source, relativePath: "stimuli/clip.mp4" } }), /malformed/u);
});

test("controlled summary v2 is explicit, strict and preserves the complete proof", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/controlled-video-geometry-v3.json", import.meta.url)));
  const geometry = fixture.workspace.videoCatalogue.entries[0].geometry;
  const summary = decodedSummary({ decodeAttestation: "nativeDecodedSnapshotsV2", displayGeometry: geometry });
  assert.deepEqual(validateNativeDecodedStimulusSummaryV2(summary).displayGeometry, geometry);
  assert.throws(() => validateNativeDecodedStimulusSummaryV1(summary), /malformed/u);
  assert.throws(() => validateNativeDecodedStimulusSummaryV2(decodedSummary()), /malformed/u);
  assert.throws(() => validateNativeDecodedStimulusSummaryV2({ ...summary, extra: true }), /malformed/u);
  const malformed = structuredClone(summary);
  malformed.displayGeometry.nativeDisplayMetadata.renderer.readbackRotationDegrees = 90;
  assert.throws(() => validateNativeDecodedStimulusSummaryV2(malformed), /malformed/u);
  const calls = [];
  const controller = new NativeMediaController({ invoke: async (command, payload) => {
    calls.push([command, payload]);
    return command === "research_native_media_prepare" ? receipt() : summary;
  } });
  await controller.prepare({ workspaceId: WORKSPACE, summary, host: {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
  } });
  assert.deepEqual(await controller.attestDecodeV2({ workspaceId: WORKSPACE, summary }), summary);
  assert.equal(calls.at(-1)[0], "research_native_media_attest_decode_v2");
  assert.deepEqual(calls.at(-1)[1].request.fence, { sessionId: SESSION, generation: 1 });
  controller.invoke = async () => {
    controller.fence = { sessionId: SESSION, generation: 2 };
    return summary;
  };
  await assert.rejects(() => controller.attestDecodeV2({ workspaceId: WORKSPACE, summary }), /generation fence/u);
});

function viewport() {
  return { leftPx: 10, topPx: 20, widthPx: 640, heightPx: 360, layoutRevision: 1 };
}

function status(overrides = {}) {
  return {
    schema: "affect-research-native-media-status",
    version: 1,
    actorReady: true,
    sequence: 2,
    generation: 1,
    sessionId: SESSION,
    mediaGrantId: GRANT,
    workspaceFileId: FILE,
    state: "paused",
    durationMs: 2500.25,
    positionMs: 0,
    videoWidth: 1920,
    videoHeight: 1080,
    audioStreamCount: 1,
    bufferingPercent: null,
    warningCount: 0,
    viewport: viewport(),
    reasonCode: null,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    schema: "affect-research-native-media-prepare-receipt",
    version: 1,
    sessionId: SESSION,
    generation: 1,
    mediaGrantId: GRANT,
    workspaceFileId: FILE,
    state: "preparing",
    ...overrides,
  };
}

function decodedSummary(overrides = {}) {
  const sha256 = "b".repeat(64);
  return {
    workspaceFileId: FILE,
    displayName: "stimulus.mp4",
    sha256,
    byteLength: 1234,
    mimeType: "video/mp4",
    durationMs: 2500.25,
    decodeStatus: "attestedQualified",
    decodeBackend: "nativeGstPlay",
    decodeAttestation: "nativeDecodedSnapshotsV1",
    decodedPositionsMs: [250, 1250.125, 2250.25],
    displayGeometry: {
      status: "verified",
      source: "native-gstplay-metadata",
      displayWidthPx: 1080,
      displayHeightPx: 1920,
      displayAspect: { numerator: 9, denominator: 16 },
      rotationDegrees: 90,
      pixelAspectRatio: { numerator: 1, denominator: 1 },
      metadataInterpretation: "explicit-orientation-and-square-pixel-snapshot",
    },
    source: {
      kind: "workspaceFile",
      relativePath: `stimuli/.workspace/${FILE}`,
      mimeType: "video/mp4",
      sha256,
      byteLength: 1234,
      durationMs: 2500.25,
    },
    ...overrides,
  };
}

test("native media receipts are strict and generation bound", () => {
  assert.equal(validateNativeMediaPrepareReceiptV1(receipt()).generation, 1);
  assert.equal(validateNativeMediaStatusV1(status()).state, "paused");
  assert.throws(() => validateNativeMediaPrepareReceiptV1({ ...receipt(), extra: true }), /malformed/u);
  assert.throws(() => validateNativeMediaStatusV1(status({ sessionId: null })), /inconsistent/u);
  assert.throws(() => validateNativeMediaStatusV1(status({ sessionId: null, mediaGrantId: null })), /inconsistent/u);
  assert.throws(() => validateNativeMediaStatusV1(status({ positionMs: Number.NaN })), /malformed/u);
});

test("qualified native decode summaries are strict and identity-bound", () => {
  assert.equal(validateNativeDecodedStimulusSummaryV1(decodedSummary()).decodeStatus, "attestedQualified");
  assert.throws(() => validateNativeDecodedStimulusSummaryV1({ ...decodedSummary(), extra: true }), /malformed/u);
  assert.throws(() => validateNativeDecodedStimulusSummaryV1(decodedSummary({ decodeStatus: "attestedUnqualified" })), /malformed/u);
  assert.throws(() => validateNativeDecodedStimulusSummaryV1(decodedSummary({ decodedPositionsMs: [1, 1, 2] })), /malformed/u);
  assert.throws(() => validateNativeDecodedStimulusSummaryV1(decodedSummary({
    displayGeometry: { ...decodedSummary().displayGeometry, source: "browser-decoder" },
  })), /malformed/u);
  assert.equal(validateNativeDecodedStimulusSummaryV1(decodedSummary({
    workspaceFileId: PACKAGE_FILE,
    source: { ...decodedSummary().source, relativePath: "stimuli/demo/video.mp4" },
  })).source.relativePath, "stimuli/demo/video.mp4");
});

test("viewport requests retain CSS coordinates and monotonic revision", () => {
  const host = { getBoundingClientRect: () => ({ left: 12.5, top: 40, width: 800, height: 450 }) };
  assert.deepEqual(nativeMediaViewportCssV1(host, 3), {
    leftCssPx: 12.5,
    topCssPx: 40,
    widthCssPx: 800,
    heightCssPx: 450,
    layoutRevision: 3,
  });
  assert.throws(() => nativeMediaViewportCssV1({ getBoundingClientRect: () => ({ left: -1, top: 0, width: 1, height: 1 }) }, 1));
});

test("controller sends no path or native handle and fences every control", async () => {
  const calls = [];
  let polled = 0;
  const invoke = async (command, payload) => {
    calls.push([command, payload]);
    if (command === "research_native_media_prepare") return receipt();
    if (command === "research_native_media_status") {
      polled += 1;
      return polled === 1 ? status({ state: "preparing", durationMs: null, videoWidth: null, videoHeight: null }) : status();
    }
    if (command === "research_native_media_attest_decode") return decodedSummary();
    if (command === "research_native_media_stop") {
      return status({ state: "idle", sessionId: null, mediaGrantId: null, workspaceFileId: null, durationMs: null, positionMs: null, videoWidth: null, videoHeight: null, audioStreamCount: null });
    }
    return status();
  };
  const controller = new NativeMediaController({ invoke, wait: async () => {} });
  const host = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 640, height: 360 }) };
  await controller.prepare({
    workspaceId: WORKSPACE,
    summary: { workspaceFileId: FILE, sha256: "b".repeat(64), byteLength: 1234, mimeType: "video/mp4" },
    host,
  });
  await controller.awaitPrepared({ attempts: 2, intervalMs: 1 });
  const attested = await controller.attestDecode({
    workspaceId: WORKSPACE,
    summary: { workspaceFileId: FILE, sha256: "b".repeat(64), byteLength: 1234, mimeType: "video/mp4" },
  });
  assert.equal(attested.decodeBackend, "nativeGstPlay");
  await controller.play();
  await controller.setViewport(host);
  await controller.pause();
  await controller.stop();
  assert.equal(controller.activeFence, null);
  assert.equal(JSON.stringify(calls).includes("path"), false);
  assert.equal(JSON.stringify(calls).includes("handle"), false);
  for (const [command, payload] of calls.filter(([name]) => ["research_native_media_play", "research_native_media_pause"].includes(name))) {
    assert.equal(command.startsWith("research_native_media_"), true);
    assert.deepEqual(payload.fence, { sessionId: SESSION, generation: 1 });
  }
  const attestationPayload = calls.find(([name]) => name === "research_native_media_attest_decode")[1];
  assert.deepEqual(attestationPayload.request.fence, { sessionId: SESSION, generation: 1 });
  assert.equal(JSON.stringify(attestationPayload).includes("path"), false);
});

test("controller rejects status from a different native generation", async () => {
  const invoke = async (command) => command === "research_native_media_prepare"
    ? receipt()
    : status({ generation: 2, sessionId: "44444444-4444-4444-8444-444444444444" });
  const controller = new NativeMediaController({ invoke, wait: async () => {} });
  const host = { getBoundingClientRect: () => ({ left: 1, top: 1, width: 10, height: 10 }) };
  await controller.prepare({
    workspaceId: WORKSPACE,
    summary: { workspaceFileId: FILE, sha256: "b".repeat(64), byteLength: 1, mimeType: "video/mp4" },
    host,
  });
  await assert.rejects(() => controller.status(), /generation fence/u);
});

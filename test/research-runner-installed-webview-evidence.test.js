import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessInstalledWebview } from "../scripts/qualification/runner-installed-webview.mjs";

const commit = "a".repeat(40), installerHash = "b".repeat(64), exeHash = "c".repeat(64);
const recipeHash = "d".repeat(64), planHash = "e".repeat(64), assetHash = "f".repeat(64);
function evidence() {
  return {
    sourceCommit: commit, installerSha256: installerHash, installedExeSha256: exeHash,
    expectedInstallerSha256: installerHash, expectedInstalledExeSha256: exeHash, recipeSha256: recipeHash,
    videoPosition: 3, minDecodedFrames: 2, maxVideoSpanErrorMs: 20,
    attempt: { runId: "run-1", attemptId: "attempt-1", buildCommit: commit, status: "completed",
      recipeSourceByteSha256: recipeHash, planIdentitySha256: planHash,
      executionQualification: { sessionKind: "local-validation", researchQualified: false } },
    plan: { recipeSourceByteSha256: recipeHash, planIdentitySha256: planHash,
      steps: [{ kind: "video", position: 3, entryId: "video-3", durationMs: 100,
        payload: { asset: { sha256: assetHash } } }] },
    events: [
      { observation: { eventType: "videoStart", runId: "run-1", attemptId: "attempt-1", entryId: "video-3", sequence: 2, monotonicMs: 100 } },
      { observation: { eventType: "videoEnd", runId: "run-1", attemptId: "attempt-1", entryId: "video-3", sequence: 3, monotonicMs: 200 } },
    ],
    diagnostics: [
      { code: "webview-media-observation", runId: "run-1", attemptId: "attempt-1", position: 3, monotonicMs: 110,
        detail: { state: "playing", sha256: assetHash, workspaceFileId: "opaque-file", generation: 1, sequence: 1, decodedFrames: 1 } },
      { code: "webview-media-observation", runId: "run-1", attemptId: "attempt-1", position: 3, monotonicMs: 195,
        detail: { state: "ended", sha256: assetHash, workspaceFileId: "opaque-file", generation: 1, sequence: 2, decodedFrames: 10 } },
    ],
    samples: [{ entryId: "video-3", runId: "run-1", attemptId: "attempt-1", recipeSourceByteSha256: recipeHash,
      planIdentitySha256: planHash, monotonicMs: 150, lslTimeSeconds: 1.5, scheduledElapsedMs: 50,
      observedElapsedMs: 50.1, schedulerLatenessMs: 0.1, schedulerJitterMs: 0.1, missedSlotsBefore: 0,
      valence: 0.25, arousal: -0.5, radius: Math.hypot(0.25, -0.5), angleDegrees: 296.565051177078,
      animationActive: true, inputActive: false }],
    xdf: { xdfSha256: "1".repeat(64), reader: { name: "pyxdf", synchronizeClocks: false, dejitterTimestamps: false },
      streams: [{ name: "state", sourceId: "study-source:state:run-1", channelCount: 8, channelFormat: "float32",
        footerVerified: true, sampleCount: 1, timestamps: [1.5], samples: [[0.25, -0.5, 0.25, -0.5,
          Math.fround(Math.hypot(0.25, -0.5)), Math.fround(296.565051177078), 1, 0]] }] },
    reconstruction: { xdfSha256: "1".repeat(64), result: { status: "complete",
      executionQualification: { researchQualified: false }, framing: { context: { runId: "run-1", attemptId: "attempt-1",
        recipeSourceByteSha256: recipeHash } }, startup: { build: { commit }, recipeSourceByteSha256: recipeHash,
        effectiveLsl: { stateStream: "state", sourceId: "study-source" } }, plan: { planIdentitySha256: planHash } } },
  };
}

test("installed evidence accepts one bound decoded video and independently read native sample", () => {
  const result = assessInstalledWebview(evidence());
  assert.deepEqual(result.issues, []);
  assert.equal(result.video.endedDecodedFrames, 10);
  assert.equal(result.timing.videoSampleCount, 1);
});

test("installed evidence rejects stale playback, wrong artifact and mismatched XDF", () => {
  const stale = structuredClone(evidence());
  stale.diagnostics[1].detail.generation = 2;
  stale.expectedInstalledExeSha256 = "0".repeat(64);
  stale.xdf.streams[0].timestamps[0] = 2;
  const codes = assessInstalledWebview(stale).issues.map(issue => issue.code);
  assert.ok(codes.includes("video-file-generation-binding-mismatch"));
  assert.ok(codes.includes("candidate-artifact-hash-mismatch"));
  assert.ok(codes.includes("xdf-state-timestamps-mismatch"));
});

test("XDF identity and all eight state values bind to the selected native attempt", () => {
  const changed = evidence();
  changed.reconstruction.result.framing.context.attemptId = "attempt-other";
  changed.xdf.streams[0].sourceId = "study-source:state:run-other";
  changed.xdf.streams[0].samples[0][5] = 0;
  const codes = assessInstalledWebview(changed).issues.map(issue => issue.code);
  assert.ok(codes.includes("xdf-attempt-identity-mismatch"));
  assert.ok(codes.includes("xdf-state-source-mismatch"));
  assert.ok(codes.includes("xdf-state-values-mismatch"));
});

test("declared frame and video-span limits fail closed", () => {
  const changed = evidence();
  changed.minDecodedFrames = 11;
  changed.maxVideoSpanErrorMs = 2;
  const codes = assessInstalledWebview(changed).issues.map(issue => issue.code);
  assert.ok(codes.includes("decoded-frame-limit-not-met"));
  assert.ok(codes.includes("video-span-limit-not-met"));
  changed.minDecodedFrames = 1;
  assert.ok(assessInstalledWebview(changed).issues.some(issue => issue.code === "video-timing-limits-invalid"));
});

test("missing installed evidence writes a fail-closed receipt", () => {
  const folder = mkdtempSync(join(tmpdir(), "runner-installed-evidence-test-"));
  try {
    const output = join(folder, "receipt.json");
    const command = spawnSync(process.execPath, ["scripts/qualification/runner-installed-webview.mjs", "--out", output],
      { encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)) });
    assert.equal(command.status, 2);
    const receipt = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(receipt.result, "fail");
    assert.equal(receipt.issues[0].code, "evidence-reading-failed");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

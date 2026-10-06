/** Evidence reader for one real installed Runner validation attempt. No playback is simulated. */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const finite = value => typeof value === "number" && Number.isFinite(value);
const sameTime = (a, b) => finite(a) && finite(b) && Math.abs(a - b) < 0.0001;
const stateValues = row => [row.valence, row.arousal, row.valence, row.arousal,
  row.radius, row.angleDegrees, Number(row.animationActive), Number(row.inputActive)];
const sameState = (recorded, journal) => Array.isArray(recorded) && recorded.length === 8
  && journal.every(finite) && recorded.every((value, index) => finite(value) && value === Math.fround(journal[index]));

function requireCheck(issues, okay, code, detail = null) {
  if (!okay) issues.push({ code, detail });
}

export function assessInstalledWebview({ sourceCommit, installerSha256, installedExeSha256, recipeSha256,
  expectedInstallerSha256, expectedInstalledExeSha256, attempt, plan, events, samples, diagnostics, xdf, reconstruction, videoPosition,
  minDecodedFrames, maxVideoSpanErrorMs }) {
  const issues = [];
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const video = steps.find(step => step.position === videoPosition && step.kind === "video");
  const observation = events.map(row => row.observation).filter(Boolean);
  const media = diagnostics.filter(row => row.code === "webview-media-observation" && row.position === videoPosition);
  const starts = observation.filter(row => row.eventType === "videoStart" && row.entryId === video?.entryId);
  const ends = observation.filter(row => row.eventType === "videoEnd" && row.entryId === video?.entryId);
  const playing = media.find(row => row.detail?.state === "playing" && row.detail.decodedFrames > 0);
  const ended = media.find(row => row.detail?.state === "ended");
  const videoSamples = samples.filter(row => row.entryId === video?.entryId);
  const runId = attempt?.runId, attemptId = attempt?.attemptId;
  const sourceHash = attempt?.recipeSourceByteSha256;
  const planHash = attempt?.planIdentitySha256;
  requireCheck(issues, /^[a-f0-9]{40}$/u.test(sourceCommit), "source-commit-invalid");
  requireCheck(issues, /^[a-f0-9]{64}$/u.test(installerSha256) && /^[a-f0-9]{64}$/u.test(installedExeSha256), "artifact-hash-invalid");
  requireCheck(issues, installerSha256 === expectedInstallerSha256 && installedExeSha256 === expectedInstalledExeSha256, "candidate-artifact-hash-mismatch");
  requireCheck(issues, !!video, "selected-video-absent", videoPosition);
  requireCheck(issues, sourceHash === recipeSha256 && sourceHash === plan?.recipeSourceByteSha256, "recipe-hash-mismatch");
  requireCheck(issues, planHash === plan?.planIdentitySha256, "plan-hash-mismatch");
  requireCheck(issues, attempt?.buildCommit === sourceCommit && reconstruction?.result?.startup?.build?.commit === sourceCommit, "build-commit-mismatch");
  requireCheck(issues, attempt?.status === "completed" && attempt?.executionQualification?.researchQualified === false && attempt?.executionQualification?.sessionKind === "local-validation", "validation-attempt-not-complete-and-unqualified");
  requireCheck(issues, reconstruction?.result?.status === "complete" && reconstruction?.result?.executionQualification?.researchQualified === false, "xdf-reconstruction-not-complete-and-unqualified");
  requireCheck(issues, reconstruction?.result?.startup?.recipeSourceByteSha256 === sourceHash && reconstruction?.result?.plan?.planIdentitySha256 === planHash, "xdf-plan-identity-mismatch");
  const xdfContext = reconstruction?.result?.framing?.context;
  requireCheck(issues, xdfContext?.runId === runId && xdfContext?.attemptId === attemptId
    && xdfContext?.recipeSourceByteSha256 === sourceHash, "xdf-attempt-identity-mismatch");
  requireCheck(issues, xdf?.xdfSha256 === reconstruction?.xdfSha256 && xdf?.reader?.name === "pyxdf" && xdf?.reader?.synchronizeClocks === false && xdf?.reader?.dejitterTimestamps === false, "independent-xdf-reader-mismatch");
  requireCheck(issues, [starts.length, ends.length].every(count => count === 1) && starts[0]?.runId === runId && ends[0]?.runId === runId && starts[0]?.attemptId === attemptId && ends[0]?.attemptId === attemptId && starts[0]?.sequence < ends[0]?.sequence && starts[0]?.monotonicMs < ends[0]?.monotonicMs, "video-marker-pair-missing");
  requireCheck(issues, !!playing && !!ended && playing.detail.sequence < ended.detail.sequence && playing.monotonicMs <= ended.monotonicMs, "decoded-playing-ended-pair-missing");
  const asset = video?.payload?.asset;
  const bound = row => row?.runId === runId && row.attemptId === attemptId && row.detail?.sha256 === asset?.sha256 && row.detail?.workspaceFileId && row.detail?.generation > 0;
  requireCheck(issues, bound(playing) && bound(ended) && playing?.detail?.workspaceFileId === ended?.detail?.workspaceFileId && playing?.detail?.generation === ended?.detail?.generation && ended?.detail?.decodedFrames >= playing?.detail?.decodedFrames, "video-file-generation-binding-mismatch");
  const durationMs = video?.durationMs;
  const observedSpanMs = playing && ended ? ended.monotonicMs - playing.monotonicMs : null;
  const markerSpanMs = starts[0] && ends[0] ? ends[0].monotonicMs - starts[0].monotonicMs : null;
  requireCheck(issues, Number.isSafeInteger(minDecodedFrames) && minDecodedFrames >= 2
    && Number.isSafeInteger(maxVideoSpanErrorMs) && maxVideoSpanErrorMs >= 0,
  "video-timing-limits-invalid");
  requireCheck(issues, Number.isSafeInteger(durationMs) && durationMs > 0
    && Number.isSafeInteger(ended?.detail?.decodedFrames) && ended.detail.decodedFrames >= minDecodedFrames
    && ended.detail.decodedFrames > playing?.detail?.decodedFrames, "decoded-frame-limit-not-met");
  requireCheck(issues, finite(observedSpanMs) && observedSpanMs > 0 && finite(markerSpanMs) && markerSpanMs > 0 && finite(durationMs)
    && finite(maxVideoSpanErrorMs) && Math.abs(observedSpanMs - durationMs) <= maxVideoSpanErrorMs
    && Math.abs(markerSpanMs - durationMs) <= maxVideoSpanErrorMs, "video-span-limit-not-met");
  requireCheck(issues, videoSamples.length > 0 && videoSamples.every(row => row.runId === runId && row.attemptId === attemptId && row.recipeSourceByteSha256 === sourceHash && row.planIdentitySha256 === planHash && finite(row.lslTimeSeconds) && finite(row.scheduledElapsedMs) && finite(row.observedElapsedMs) && finite(row.schedulerLatenessMs) && finite(row.schedulerJitterMs)), "native-samples-missing-or-invalid");
  requireCheck(issues, videoSamples.every(row => row.monotonicMs >= starts[0]?.monotonicMs && row.monotonicMs <= ends[0]?.monotonicMs), "samples-outside-video-markers");
  const stateName = reconstruction?.result?.startup?.effectiveLsl?.stateStream;
  const stateSourceId = reconstruction?.result?.startup?.effectiveLsl?.sourceId;
  const stateStreams = xdf?.streams?.filter(stream => stream.name === stateName) ?? [];
  const state = stateStreams[0];
  requireCheck(issues, stateStreams.length === 1 && typeof stateSourceId === "string"
    && state?.sourceId === `${stateSourceId}:state:${runId}`, "xdf-state-source-mismatch");
  requireCheck(issues, state?.channelCount === 8 && state?.channelFormat === "float32" && state?.footerVerified === true && state?.sampleCount === samples.length, "xdf-state-stream-count-mismatch");
  const recordedTimes = state?.timestamps ?? [];
  requireCheck(issues, recordedTimes.length === samples.length && samples.every((sample, index) => sameTime(recordedTimes[index], sample.lslTimeSeconds)), "xdf-state-timestamps-mismatch");
  const recordedStates = state?.samples ?? [];
  requireCheck(issues, recordedStates.length === samples.length
    && samples.every((sample, index) => sameState(recordedStates[index], stateValues(sample))), "xdf-state-values-mismatch");
  const lateness = videoSamples.map(row => row.schedulerLatenessMs).filter(finite);
  const missed = videoSamples.reduce((sum, row) => sum + (Number.isInteger(row.missedSlotsBefore) ? row.missedSlotsBefore : 0), 0);
  return { issues, video: video ? { position: videoPosition, entryId: video.entryId, assetSha256: asset?.sha256 ?? null,
    workspaceFileId: playing?.detail?.workspaceFileId ?? null, generation: playing?.detail?.generation ?? null,
    firstDecodedFrames: playing?.detail?.decodedFrames ?? null, endedDecodedFrames: ended?.detail?.decodedFrames ?? null } : null,
  timing: { videoSampleCount: videoSamples.length, missedSlots: missed,
    maxSchedulerLatenessMs: lateness.length ? lateness.reduce((max, value) => Math.max(max, value), -Infinity) : null,
    videoMarkerSpanMs: markerSpanMs, observedVideoSpanMs: observedSpanMs,
    declaredVideoDurationMs: durationMs ?? null, minDecodedFrames, maxVideoSpanErrorMs } };
}

function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith("--") || !args[i + 1]) throw new Error("Supply --installer, --installed-exe, --source-commit, --session, --xdf, --video-position and --out.");
    out[args[i].slice(2)] = args[i + 1];
  }
  return out;
}
async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function jsonLines(path) { return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map(JSON.parse); }
async function oneVersioned(session, stem) {
  const files = (await readdir(session)).filter(name => new RegExp(`^${stem}\\.v[1-5]\\.json$`, "u").test(name));
  if (files.length !== 1) throw new Error(`Expected one ${stem} file in the attempt directory.`);
  return json(join(session, files[0]));
}
function run(command, args) {
  const child = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
  if (child.error || child.status !== 0) throw new Error(`${basename(command)} failed: ${(child.stderr || child.error?.message || "").slice(0, 1000)}`);
}

async function main() {
  const opt = options(process.argv.slice(2));
  for (const key of ["installer", "installed-exe", "source-commit", "installer-sha256", "installed-exe-sha256", "session", "xdf", "video-position", "min-decoded-frames", "max-video-span-error-ms", "out"]) if (!opt[key]) throw new Error(`Missing --${key}.`);
  if (process.platform !== "win32") throw new Error("Installed Runner qualification must run on Windows.");
  const installer = resolve(opt.installer), executable = resolve(opt["installed-exe"]), session = resolve(opt.session), xdfPath = resolve(opt.xdf);
  const out = resolve(opt.out), position = Number(opt["video-position"]);
  const minDecodedFrames = Number(opt["min-decoded-frames"]), maxVideoSpanErrorMs = Number(opt["max-video-span-error-ms"]);
  if (!Number.isInteger(position) || position < 1) throw new Error("--video-position must be a positive integer.");
  const temporary = await mkdtemp(join(tmpdir(), `runner-installed-${randomUUID()}-`));
  try {
    const [installerSha256, installedExeSha256, recipeBytes, attempt, plan, events, samples, diagnostics, xdfInfo] = await Promise.all([
      fileHash(installer), fileHash(executable), readFile(join(session, "experiment.master.json")),
      oneVersioned(session, "master-attempt"), oneVersioned(session, "master-plan"),
      jsonLines(join(session, "master-events.v1.jsonl")), jsonLines(join(session, "master-samples.v1.jsonl")),
      jsonLines(join(session, "master-diagnostics.v1.jsonl")), stat(xdfPath),
    ]);
    if (xdfInfo.size < 1 || xdfInfo.size > 512 * 1024 * 1024) throw new Error("XDF is empty or exceeds the 512 MiB independent-reader bound.");
    const exportPath = join(temporary, "xdf-export.json"), reconstructedPath = join(temporary, "reconstructed.json");
    run(opt.python || "python", [join(here, "runner-information-xdf.py"), xdfPath, exportPath]);
    run(process.execPath, [join(here, "runner-information-stream.mjs"), exportPath, reconstructedPath]);
    const xdf = await json(exportPath), reconstruction = await json(reconstructedPath);
    const result = assessInstalledWebview({ sourceCommit: opt["source-commit"], installerSha256,
      installedExeSha256, expectedInstallerSha256: opt["installer-sha256"],
      expectedInstalledExeSha256: opt["installed-exe-sha256"], recipeSha256: sha256(recipeBytes), attempt, plan, events, samples,
      diagnostics, xdf, reconstruction, videoPosition: position, minDecodedFrames, maxVideoSpanErrorMs });
    const receipt = { schema: "affect-runner-installed-webview-evidence", version: 1, generatedAt: new Date().toISOString(),
      result: result.issues.length ? "fail" : "source-evidence-pass-installed-review-required",
      candidate: { installer, installerSha256, expectedInstallerSha256: opt["installer-sha256"], installedExecutable: executable,
        installedExecutableSha256: installedExeSha256, expectedInstalledExeSha256: opt["installed-exe-sha256"], sourceCommit: opt["source-commit"], appVersion: attempt.appVersion },
      attempt: { session, runId: attempt.runId, attemptId: attempt.attemptId, status: attempt.status,
        failureCode: attempt.failureCode ?? null, executionQualification: attempt.executionQualification },
      failure: { terminalStatus: attempt.status, code: attempt.failureCode ?? null,
        mediaFailedObservations: diagnostics.filter(row => row.code === "webview-media-observation" && row.detail?.state === "failed").length,
        partialMarkers: events.filter(row => row.observation?.eventType === "partial").length },
      xdf: { path: xdfPath, sha256: xdf.xdfSha256, reader: xdf.reader,
        streamCounts: xdf.streams.map(stream => ({ name: stream.name, count: stream.sampleCount })) },
      ...result, claim: "File-bound evidence from one unqualified validation attempt. Candidate hashes require independent build/install provenance; this script does not launch or observe the app. Physical playback/input, external streams, full timing/failure trials and research qualification require separate observed receipts." };
    await writeFile(out, JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ result: receipt.result, receipt: out, issues: receipt.issues }, null, 2));
    if (receipt.issues.length) process.exitCode = 2;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => {
    const index = process.argv.indexOf("--out"), out = index < 0 ? null : process.argv[index + 1];
    if (out) {
      const receipt = { schema: "affect-runner-installed-webview-evidence", version: 1,
        generatedAt: new Date().toISOString(), result: "fail", issues: [{ code: "evidence-reading-failed", detail: error.message }],
        claim: "The installed candidate was not qualified." };
      try { await writeFile(resolve(out), JSON.stringify(receipt, null, 2), { flag: "wx" }); } catch { /* Keep the original error visible. */ }
    }
    console.error(error.message); process.exitCode = 2;
  });
}

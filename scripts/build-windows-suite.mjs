// One unsigned NSIS installer containing the Planner and its hash-bound Runner.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statfsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stage = resolve(root, "src-tauri/suite");
const target = "x86_64-pc-windows-msvc";
const require = createRequire(import.meta.url);
const cargo = process.env.CARGO ?? resolve(homedir(), ".cargo/bin/cargo.exe");
const checkOnly = process.argv.length === 3 && process.argv[2] === "--check";
assert.ok(process.argv.length === 2 || checkOnly, "Use --check or no argument.");
assert.equal(process.platform, "win32", "Build on Windows.");
assert.equal(process.arch, "x64", "Build on Windows x64.");
assert.equal(stage, join(root, "src-tauri", "suite"));

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed.`);
  return result.stdout.trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.suite.conf.json"), "utf8"));
assert.equal(config.mainBinaryName, "Experiment Planner");
assert.deepEqual(config.bundle.externalBin, ["suite/Experiment Runner", "suite/affect-runner-engine"]);
assert.equal(config.bundle.resources["suite/current-build.json"], "current-build.json");
assert.equal(config.bundle.resources["suite/launcher-receipt.json"], "launcher-receipt.json");
for (const path of ["bin/ffmpeg.exe", "bin/ffprobe.exe", "LICENSE", "README.txt", "SOURCE.txt", "receipt.json"]) {
  assert.equal(config.bundle.resources[`suite/ffmpeg/${path}`], `ffmpeg/${path}`);
}
assert.equal(config.bundle.windows.nsis.installerHooks, "./windows/suite-hooks.nsh");
assert.ok(existsSync(join(root, "src-tauri/windows/suite-hooks.nsh")));
if (checkOnly) {
  console.log("Suite packaging configuration passes structural checks; binaries and installer were not built.");
  process.exit(0);
}

assert.ok(!existsSync(stage), "Remove the prior generated src-tauri/suite stage before a new build.");
const disk = statfsSync(root);
assert.ok(disk.bavail * disk.bsize >= 6 * 1024 ** 3, "At least 6 GiB free on the build volume is required before compiling the suite.");
assert.ok(existsSync(cargo), `Cargo unavailable at ${cargo}.`);
for (const key of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]) {
  assert.ok(!process.env[key], `${key} must be absent for the unsigned suite.`);
}
const sourceCommit = run("git", ["rev-parse", "--verify", "HEAD"]);
assert.match(sourceCommit, /^[0-9a-f]{40}$/u);
assert.equal(run("git", ["status", "--porcelain=v1", "--untracked-files=normal"]), "", "Build from a clean commit.");
const sourceBranch = run("git", ["branch", "--show-current"]);
const buildEnv = { ...process.env, AFFECT_TRACKER_BUILD_COMMIT: sourceCommit };
delete buildEnv.TAURI_CONFIG;
const runnerConfig = readFileSync(join(root, "src-tauri/tauri.runner.conf.json"), "utf8");
const vite = resolve(require.resolve("vite/package.json"), "../bin/vite.js");
run(process.execPath, [vite, "build", "--config", "runner/vite.config.js"], buildEnv);
run(process.execPath, ["scripts/verify-runner-build.js"], buildEnv);
run(cargo, [
  "build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--release",
  "--bin", "affect-runner", "--features", "tauri/custom-protocol",
], { ...buildEnv, TAURI_CONFIG: runnerConfig });

const engine = resolve(root, process.env.CARGO_TARGET_DIR ?? "src-tauri/target", "release/affect-runner.exe");
assert.ok(existsSync(engine), "Runner engine release executable is missing.");
mkdirSync(stage);
const launcherTarget = resolve(root, "src-tauri/native-launcher/target");
run("pwsh.exe", [
  "-NoProfile", "-NonInteractive", "-File", "src-tauri/native-launcher/prepare.ps1",
  "-EnginePath", engine, "-ApplicationDirectory", stage, "-BuildDirectory", launcherTarget,
], buildEnv);

const receipt = JSON.parse(readFileSync(join(stage, "launcher-receipt.json"), "utf8").replace(/^\uFEFF/u, ""));
const launcherFile = join(stage, "Experiment Runner.exe");
const engineFile = join(stage, "affect-runner-engine.exe");
assert.equal(receipt.launcherSha256, sha256(launcherFile));
assert.equal(receipt.engineSha256, sha256(engineFile));
assert.equal(receipt.runtimeVerified, true);
assert.equal(receipt.researchQualified, false);
run("pwsh.exe", [
  "-NoProfile", "-NonInteractive", "-File", "scripts/prepare-ffmpeg-windows-suite.ps1",
  "-StageDirectory", stage,
], buildEnv);
const ffmpegReceipt = JSON.parse(readFileSync(join(stage, "ffmpeg/receipt.json"), "utf8").replace(/^\uFEFF/u, ""));
for (const [key, path] of [
  ["ffmpegSha256", "ffmpeg/bin/ffmpeg.exe"],
  ["ffprobeSha256", "ffmpeg/bin/ffprobe.exe"],
  ["licenseSha256", "ffmpeg/LICENSE"],
  ["readmeSha256", "ffmpeg/README.txt"],
  ["sourceNoticeSha256", "ffmpeg/SOURCE.txt"],
]) assert.equal(ffmpegReceipt[key], sha256(join(stage, path)));
writeFileSync(join(stage, "current-build.json"), `${JSON.stringify({
  schema: "affect-runner-current-build-receipt",
  sourceCommit,
  sourceBranch,
  sourceDirty: false,
  builtAt: new Date().toISOString(),
  authoritativeLaunchPath: "Experiment Runner.exe",
  enginePath: "affect-runner-engine.exe",
  launcherSha256: receipt.launcherSha256,
  engineSha256: receipt.engineSha256,
  ffmpegArchiveSha256: ffmpegReceipt.archiveSha256,
  ffmpegSha256: ffmpegReceipt.ffmpegSha256,
  ffprobeSha256: ffmpegReceipt.ffprobeSha256,
  ffmpegLicenseSha256: ffmpegReceipt.licenseSha256,
  ffmpegReadmeSha256: ffmpegReceipt.readmeSha256,
  ffmpegSourceNoticeSha256: ffmpegReceipt.sourceNoticeSha256,
  researchQualified: false,
}, null, 2)}\n`);
renameSync(launcherFile, join(stage, `Experiment Runner-${target}.exe`));
renameSync(engineFile, join(stage, `affect-runner-engine-${target}.exe`));

const tauri = require.resolve("@tauri-apps/cli/tauri.js");
run(process.execPath, [
  tauri, "build", "--ci", "--no-sign", "--bundles", "nsis",
  "--config", "src-tauri/tauri.suite.conf.json", "--", "--locked", "--no-default-features",
], buildEnv);
console.log(JSON.stringify({ sourceCommit, stagedRunnerSha256: receipt.engineSha256,
  installerDirectory: join(root, "src-tauri/target/release/bundle/nsis"), researchQualified: false }, null, 2));

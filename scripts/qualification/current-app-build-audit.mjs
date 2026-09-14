import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DEFAULT_APP_DIR = "D:/GitHub/.affect-checks/current-apps";

function usage() {
  return [
    "Usage:",
    "  node scripts/qualification/current-app-build-audit.mjs [--app-dir <dir>] [--out <receipt.json>] [--require-current]",
  ].join("\n");
}

function optionValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith("--"), `${name} requires a value.\n${usage()}`);
  return value;
}

function optionFlag(name) {
  return process.argv.includes(name);
}

async function sha256File(path) {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trimEnd();
}

const appDir = resolve(optionValue("--app-dir", DEFAULT_APP_DIR));
const outPath = optionValue("--out", null);
const requireCurrent = optionFlag("--require-current");
const unknown = process.argv.slice(2).filter((value, index, args) => {
  if (["--app-dir", "--out"].includes(args[index - 1])) return false;
  return value.startsWith("--") && !["--app-dir", "--out", "--require-current"].includes(value);
});
assert.deepEqual(unknown, [], `Unknown options: ${unknown.join(", ")}\n${usage()}`);

const currentHead = git(["rev-parse", "--verify", "HEAD"]);
const currentBranch = git(["branch", "--show-current"]);
const gitStatus = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
const worktreeClean = gitStatus.length === 0;

const buildPath = join(appDir, "current-build.json");
const launcherReceiptPath = join(appDir, "launcher-receipt.json");
const launcherPath = join(appDir, "Experiment Runner.exe");
const enginePath = join(appDir, "affect-runner-engine.exe");

const [build, launcherReceipt, launcherInfo, engineInfo, launcherSha256, engineSha256] = await Promise.all([
  readFile(buildPath, "utf8").then(JSON.parse),
  readFile(launcherReceiptPath, "utf8").then(JSON.parse),
  stat(launcherPath),
  stat(enginePath),
  sha256File(launcherPath),
  sha256File(enginePath),
]);

const issues = [];
function check(ok, code, detail) {
  if (!ok) issues.push({ code, detail });
}

check(build.schema === "affect-runner-current-build-receipt", "invalid-current-build-schema", build.schema);
check(build.authoritativeLaunchPath && resolve(build.authoritativeLaunchPath) === launcherPath, "launcher-path-differs", build.authoritativeLaunchPath);
check(build.enginePath && resolve(build.enginePath) === enginePath, "engine-path-differs", build.enginePath);
check(build.launcherSha256 === launcherSha256, "launcher-hash-differs", { receipt: build.launcherSha256, actual: launcherSha256 });
check(build.engineSha256 === engineSha256, "engine-hash-differs", { receipt: build.engineSha256, actual: engineSha256 });
check(launcherReceipt.launcherSha256 === launcherSha256, "launcher-receipt-launcher-hash-differs", { receipt: launcherReceipt.launcherSha256, actual: launcherSha256 });
check(launcherReceipt.engineSha256 === engineSha256, "launcher-receipt-engine-hash-differs", { receipt: launcherReceipt.engineSha256, actual: engineSha256 });
check(launcherReceipt.runtimeVerified === true, "launcher-runtime-not-verified", launcherReceipt.runtimeVerified);
check(launcherReceipt.researchQualified === false, "launcher-research-qualified-flag-unexpected", launcherReceipt.researchQualified);
check(build.sourceCommit === currentHead, "source-commit-not-current-head", { receipt: build.sourceCommit, currentHead });
check(build.sourceDirty === false, "receipt-source-dirty", build.sourceDirtyFiles ?? build.sourceDirty);
check(worktreeClean, "current-worktree-dirty", gitStatus.split(/\r?\n/u).filter(Boolean));

const report = {
  schema: "affect-runner-current-app-build-audit",
  version: 1,
  generatedAt: new Date().toISOString(),
  result: issues.length === 0 ? "pass" : "fail",
  issues,
  repository: {
    branch: currentBranch,
    head: currentHead,
    clean: worktreeClean,
  },
  currentBuild: {
    path: buildPath,
    sourceCommit: build.sourceCommit ?? null,
    sourceBranch: build.sourceBranch ?? null,
    sourceDirty: build.sourceDirty ?? null,
    builtAt: build.builtAt ?? null,
    researchQualified: build.researchQualified ?? null,
  },
  app: {
    directory: appDir,
    launcherPath,
    enginePath,
    launcherSha256,
    engineSha256,
    launcherBytes: launcherInfo.size,
    engineBytes: engineInfo.size,
    runtimeVerified: launcherReceipt.runtimeVerified === true,
    researchQualified: launcherReceipt.researchQualified === true,
  },
  claim: "This audit proves only whether the authoritative current-app Runner binaries match their adjacent receipts and the checked-out source HEAD. It does not launch the GUI, execute an experiment, qualify playback, validate input, or prove XDF correctness.",
};

if (outPath) {
  const destination = resolve(outPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2), { flag: "wx" });
}

console.log(JSON.stringify(report, null, 2));
if (requireCurrent && issues.length > 0) process.exit(2);

// Read-only installed-file audit. A passing result is not experiment qualification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
const appDir = option("--app-dir");
assert.ok(appDir && !appDir.startsWith("--"), "Pass --app-dir <installed suite directory>.");
const expectedCommit = option("--expected-commit");
assert.ok(!expectedCommit || /^[0-9a-f]{40}$/u.test(expectedCommit), "Expected commit must be a full lowercase Git SHA-1.");
const verifyLauncher = process.argv.includes("--verify-launcher");
const used = new Set(["--app-dir", appDir, "--expected-commit", expectedCommit, "--verify-launcher"]);
assert.ok(process.argv.slice(2).every(value => used.has(value)), "Unknown argument.");
const root = resolve(appDir);
const files = {
  planner: "Experiment Planner.exe",
  launcher: "Experiment Runner.exe",
  engine: "affect-runner-engine.exe",
  build: "current-build.json",
  bootstrap: "launcher-receipt.json",
};
const issues = [];
const paths = Object.fromEntries(Object.entries(files).map(([key, name]) => [key, join(root, name)]));

async function sha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
async function json(path) {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/u, ""));
}
for (const [key, path] of Object.entries(paths)) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) issues.push(`${key}-not-regular-file`);
  } catch {
    issues.push(`${key}-missing`);
  }
}
let build;
let bootstrap;
if (!issues.includes("build-missing") && !issues.includes("bootstrap-missing")) {
  try {
    [build, bootstrap] = await Promise.all([json(paths.build), json(paths.bootstrap)]);
  } catch {
    issues.push("receipt-invalid-json");
  }
}
if (build && bootstrap) {
  if (build.schema !== "affect-runner-current-build-receipt") issues.push("build-schema");
  if (bootstrap.schema !== "affect-runner-bootstrap-receipt-v1") issues.push("bootstrap-schema");
  if (build.authoritativeLaunchPath !== basename(paths.launcher)) issues.push("launcher-path");
  if (build.enginePath !== basename(paths.engine)) issues.push("engine-path");
  if (!/^[0-9a-f]{40}$/u.test(build.sourceCommit ?? "")) issues.push("source-commit");
  if (expectedCommit && build.sourceCommit !== expectedCommit) issues.push("expected-commit");
  if (build.sourceDirty !== false) issues.push("dirty-source");
  if (build.researchQualified !== false || bootstrap.researchQualified !== false) issues.push("qualification-flag");
  if (bootstrap.runtimeVerified !== true) issues.push("launcher-stage-verification");
  for (const key of ["launcher", "engine"]) {
    if (issues.some(issue => issue.startsWith(`${key}-`))) continue;
    const actual = await sha256(paths[key]);
    if (build[`${key}Sha256`] !== actual || bootstrap[`${key}Sha256`] !== actual) {
      issues.push(`${key}-hash`);
    }
  }
}
if (verifyLauncher && !issues.length) {
  const result = spawnSync(paths.launcher, ["--verify-only"], { cwd: root, windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0) issues.push("launcher-verification");
}
const report = {
  schema: "affect-windows-suite-installed-audit-v1",
  result: issues.length ? "fail" : "pass",
  issues,
  directory: root,
  sourceCommit: build?.sourceCommit ?? null,
  launcherVerified: verifyLauncher && !issues.length,
  claim: "Installed file layout, portable receipts, Runner hashes, and optional launcher verification only; no Planner GUI, participant execution, video, LSL, timing, or XDF claim.",
};
console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exitCode = 2;

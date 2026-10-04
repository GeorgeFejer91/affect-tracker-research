import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";

const audit = resolve(import.meta.dirname, "../scripts/qualification/windows-suite-installed-audit.mjs");
const hash = value => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);

test("installed suite audit accepts relocated receipts and rejects changed Runner bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "affect-suite-audit-"));
  assert.ok(root.startsWith(resolve(tmpdir()) + sep));
  try {
    const launcher = Buffer.from("launcher-fixture");
    const engine = Buffer.from("engine-fixture");
    await Promise.all([
      writeFile(join(root, "Experiment Planner.exe"), "planner-fixture"),
      writeFile(join(root, "Experiment Runner.exe"), launcher),
      writeFile(join(root, "affect-runner-engine.exe"), engine),
    ]);
    await writeFile(join(root, "launcher-receipt.json"), JSON.stringify({
      schema: "affect-runner-bootstrap-receipt-v1",
      launcherSha256: hash(launcher), engineSha256: hash(engine),
      runtimeVerified: true, researchQualified: false,
    }));
    const buildPath = join(root, "current-build.json");
    const build = {
      schema: "affect-runner-current-build-receipt", sourceCommit: commit,
      sourceDirty: false, researchQualified: false,
      authoritativeLaunchPath: "Experiment Runner.exe", enginePath: "affect-runner-engine.exe",
      launcherSha256: hash(launcher), engineSha256: hash(engine),
    };
    await writeFile(buildPath, JSON.stringify(build));
    const run = () => {
      const result = spawnSync(process.execPath, [audit, "--app-dir", root, "--expected-commit", commit], { encoding: "utf8" });
      return { code: result.status, report: JSON.parse(result.stdout) };
    };
    assert.deepEqual(run().report.issues, []);
    await writeFile(join(root, "affect-runner-engine.exe"), "changed");
    assert.ok(run().report.issues.includes("engine-hash"));
    assert.notEqual(run().code, 0);
    await writeFile(join(root, "affect-runner-engine.exe"), engine);
    build.enginePath = "../affect-runner-engine.exe";
    await writeFile(buildPath, JSON.stringify(build));
    assert.ok(run().report.issues.includes("engine-path"));
    assert.equal(JSON.parse(await readFile(buildPath, "utf8")).enginePath, "../affect-runner-engine.exe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

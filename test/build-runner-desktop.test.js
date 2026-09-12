import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

// Execute the real wrapper body with process spawning and file access replaced.
// These tests must never build, stage a runtime or launch an application.
const source = readFileSync(new URL("../scripts/build-runner-desktop.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gmu, "")
  .replaceAll("import.meta.dirname", '"/fixture/scripts"')
  .replaceAll("import.meta.url", '"file:///fixture/scripts/build-runner-desktop.js"');
function invoke(flags) {
  const calls = [];
  runInNewContext(source, {
    resolve, Set, Error,
    existsSync: () => true, readFileSync: () => '{"identifier":"runner-fixture"}',
    homedir: () => "/fixture/home", createRequire: () => ({ resolve: () => "/fixture/vite/package.json" }),
    process: { argv: ["node", "wrapper", ...flags], env: { CARGO: "fixture-cargo" }, platform: "win32", execPath: "fixture-node", exit: code => { throw new Error(`Unexpected exit ${code}`); } },
    spawnSync: (command, args, options) => { calls.push(JSON.parse(JSON.stringify({ command, args, options }))); return { status: 0 }; },
  });
  return calls;
}
test("Runner wrapper preserves run/release combinations and explicitly selects GStreamer features", () => {
  for (const run of [false, true]) for (const release of [false, true]) for (const native of [false, true]) {
    const flags = [...(run ? ["--run"] : []), ...(release ? ["--release"] : []), ...(native ? ["--native-gstreamer"] : [])];
    const calls = invoke(flags);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].command, "fixture-node");
    assert.deepEqual(calls[0].args.slice(-3), ["build", "--config", "runner/vite.config.js"]);
    assert.deepEqual(calls[1].args, ["scripts/verify-runner-build.js"]);
    assert.equal(calls[2].command, "fixture-cargo");
    assert.deepEqual(calls[2].args, [run ? "run" : "build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--bin", "affect-runner", "--features", native ? "tauri/custom-protocol,native-gstreamer" : "tauri/custom-protocol", ...(release ? ["--release"] : [])]);
    assert.equal(calls[2].args.includes("--native-gstreamer"), false);
    assert.equal(calls[2].options.windowsHide, true);
    assert.equal(calls[2].options.env.TAURI_CONFIG, '{"identifier":"runner-fixture"}');
  }
});
test("Runner wrapper still rejects unsupported arguments", () => {
  for (const flag of ["--unknown", "--features", "--no-default-features"]) assert.throws(() => invoke([flag]), /Use --run/u);
});

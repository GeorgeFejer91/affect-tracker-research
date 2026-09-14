import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function rustStringArray(source, name) {
  return source
    .match(new RegExp(`const ${name}: \\[&str; 8\\] = \\[([\\s\\S]*?)\\];`, "u"))[1]
    .match(/"([^"]+)"/gu)
    .map((value) => value.slice(1, -1));
}

test("standalone LSL loopback diagnostic is feature-gated and mirrors the Runner state contract", async () => {
  const [cargoToml, runnerLsl, diagnostic] = await Promise.all([
    read("src-tauri/Cargo.toml"),
    read("src-tauri/src/research_lsl.rs"),
    read("src-tauri/src/bin/lsl-loopback.rs"),
  ]);

  assert.match(
    cargoToml,
    /\[\[bin\]\]\s+name = "affect-lsl-loopback"\s+path = "src\/bin\/lsl-loopback\.rs"\s+required-features = \["lsl-streaming"\]/u,
  );
  assert.deepEqual(rustStringArray(diagnostic, "CHANNEL_LABELS"), rustStringArray(runnerLsl, "CHANNEL_LABELS"));
  assert.match(diagnostic, /schema: "affect-research-standalone-lsl-loopback"/u);
  assert.match(diagnostic, /does not qualify Runner playback, Tauri command wiring, XDF recording, LabRecorder, packaging, or research readiness/u);
  assert.match(diagnostic, /same-machine loopback through labstream/u);
  assert.match(diagnostic, /validate_marker\("participant free text"\)\.is_err\(\)/u);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Runner recording diagnostic is feature-gated and uses the product recorder/XDF path", async () => {
  const [cargoToml, lib, diagnostic, bin, fixture] = await Promise.all([
    read("src-tauri/Cargo.toml"),
    read("src-tauri/src/lib.rs"),
    read("src-tauri/src/research_recorder_diagnostic.rs"),
    read("src-tauri/src/bin/runner-recording-diagnostic.rs"),
    read("test/fixtures/runner-recording-master-v5-lsl.bundle.json"),
  ]);

  assert.match(
    cargoToml,
    /\[\[bin\]\]\s+name = "affect-runner-recording-diagnostic"\s+path = "src\/bin\/runner-recording-diagnostic\.rs"\s+required-features = \["lsl-streaming"\]/u,
  );
  assert.match(lib, /pub mod research_recorder_diagnostic/u);
  assert.match(diagnostic, /RecorderService::default\(\)/u);
  assert.match(diagnostic, /recorder\.discover\(\)/u);
  assert.match(diagnostic, /RecordStartRequest\s*\{/u);
  assert.match(diagnostic, /MasterLslService::start/u);
  assert.match(diagnostic, /runner-recording-master-v5-lsl\.bundle\.json/u);
  assert.match(diagnostic, /prepared\.plan\.version != 5/u);
  assert.match(diagnostic, /validate_survey_data_seed/u);
  assert.match(diagnostic, /questionnaire_asset_count/u);
  assert.match(diagnostic, /ContentKind::Responses/u);
  assert.match(diagnostic, /ContentKind::Outcome/u);
  assert.match(diagnostic, /external_outlet\s*\.\s*push_at/u);
  assert.match(diagnostic, /schema: "affect-runner-master-recording-diagnostic"/u);
  assert.match(diagnostic, /does not qualify installed GUI playback, Tauri command wiring, external LabRecorder, full-duration timing, or research readiness/u);
  assert.match(bin, /affect_research::research_recorder_diagnostic::run/u);
  const bundle = JSON.parse(fixture);
  assert.equal(bundle.schema, "affect-research-planner-asset-bundle");
  assert.equal(bundle.version, 1);
  assert.equal(JSON.parse(bundle.recipeSourceText).version, 5);
  assert.equal(JSON.parse(bundle.recipeSourceText).policy.lsl.enabled, true);
  assert.equal(bundle.questionnaireAssets.length, 4);
});

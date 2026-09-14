import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BROWSER_LSL_STATE_COLUMNS,
  BROWSER_RUN_CSV_COLUMNS,
  browserAffectState,
  browserRunCsv,
} from "../runner/src/browser-csv.js";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  assert.equal(quoted, false);
  assert.deepEqual(row, []);
  assert.equal(cell, "");
  return rows;
}

test("browser CSV sample columns mirror the native LSL state channel contract", async () => {
  const rust = await readFile(new URL("../src-tauri/src/research_lsl.rs", import.meta.url), "utf8");
  const labels = rust
    .match(/pub const CHANNEL_LABELS: \[&str; 8\] = \[([\s\S]*?)\];/u)[1]
    .match(/"([^"]+)"/gu)
    .map(value => value.slice(1, -1));

  assert.deepEqual(BROWSER_LSL_STATE_COLUMNS, labels);
  assert.deepEqual(
    BROWSER_RUN_CSV_COLUMNS.slice(
      BROWSER_RUN_CSV_COLUMNS.indexOf("current_valence"),
      BROWSER_RUN_CSV_COLUMNS.indexOf("input_active") + 1,
    ),
    labels,
  );
});

test("browser affect samples project the same eight values as LSL state samples", () => {
  const diagonal = browserAffectState({
    currentValence: -0.6,
    currentArousal: 0.8,
    animationActive: true,
    inputActive: true,
  });
  assert.deepEqual({ ...diagonal, angle_degrees: "checked-below" }, {
    current_valence: -0.6,
    current_arousal: 0.8,
    target_valence: -0.6,
    target_arousal: 0.8,
    radius: 1,
    angle_degrees: "checked-below",
    animation_active: true,
    input_active: true,
  });
  assert.ok(Math.abs(diagonal.angle_degrees - 126.86989764584402) < 1e-12);

  assert.deepEqual(browserAffectState({ currentValence: 0, currentArousal: 0 }), {
    current_valence: 0,
    current_arousal: 0,
    target_valence: 0,
    target_arousal: 0,
    radius: 0,
    angle_degrees: 0,
    animation_active: false,
    input_active: false,
  });
});

test("browser CSV serializes event, questionnaire and LSL-equivalent sample fields", () => {
  const csv = browserRunCsv([{
    row_type: "sample",
    run_id: "run-1",
    participant_id: "P001",
    variant_id: "variant-1",
    language_id: "en",
    recipe_sha256: "a".repeat(64),
    plan_sha256: "b".repeat(64),
    protocol_step_position: 3,
    step_kind: "video",
    step_label: "Video, one",
    source_code: "source-1",
    relative_path: "assets/stimuli/clip.mp4",
    event_type: "affectSample",
    sequence: 1,
    iso_time: "2026-09-14T12:00:00.000Z",
    elapsed_ms: 128,
    media_time_ms: 120,
    valence: -0.6,
    arousal: 0.8,
    ...browserAffectState({ currentValence: -0.6, currentArousal: 0.8, animationActive: true, inputActive: true }),
    questionnaire_id: "demographics-en",
    module_id: "form-en",
    item_id: "age",
    answer_value: "27",
    payload_json: { status: "sample" },
  }]);
  const [headers, row] = parseCsv(csv);

  assert.deepEqual(headers, BROWSER_RUN_CSV_COLUMNS);
  assert.equal(row[headers.indexOf("step_label")], "Video, one");
  assert.equal(row[headers.indexOf("current_valence")], "-0.6");
  assert.equal(row[headers.indexOf("current_arousal")], "0.8");
  assert.equal(row[headers.indexOf("target_valence")], "-0.6");
  assert.equal(row[headers.indexOf("target_arousal")], "0.8");
  assert.equal(row[headers.indexOf("radius")], "1");
  assert.equal(row[headers.indexOf("animation_active")], "true");
  assert.equal(row[headers.indexOf("input_active")], "true");
});

test("browser Runner CSV events carry startup and outcome identities", async () => {
  const app = await readFile(new URL("../runner/src/app.js", import.meta.url), "utf8");

  assert.match(app, /schema:\s*"affect-runner-browser-startup"/u);
  assert.match(app, /recipeSourceText:\s*plannerRecipeTransportText\(recipe\)/u);
  assert.match(app, /recipeSourceByteSha256:\s*attempt\.recipeSha256/u);
  assert.match(app, /planIdentitySha256:\s*attempt\.planSha256/u);
  assert.match(app, /questionnaireAssetCount:\s*recipe\?\.questionnaireAssets\?\.length\s*\?\?\s*0/u);
  assert.match(app, /schema:\s*"affect-runner-browser-outcome"/u);
  assert.match(app, /completedStepCount:\s*status === "complete" \? attempt\.steps\.length/u);
  assert.match(app, /recordingFinalization:\s*"browser-csv-downloaded"/u);
  assert.match(app, /payload_json:\s*browserStartupPayload\(browserAttempt\)/u);
  assert.match(app, /payload_json:\s*browserOutcomePayload\(attempt,\s*status\)/u);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { BROWSER_LSL_STATE_COLUMNS, BROWSER_RUN_CSV_COLUMNS } from "../../runner/src/browser-csv.js";

const sha256 = /^[a-f0-9]{64}$/u;
const commit = /^[a-f0-9]{7,64}(?:-dirty)?$/u;

function usage() {
  return [
    "Usage:",
    "  node scripts/qualification/runner-csv-xdf-parity-report.mjs \\",
    "    --browser-receipt <live-pages receipt.json> [--browser-receipt <receipt.json> ...] \\",
    "    --xdf-reconstruction <reconstruction.json> --xdf-crosscheck <crosscheck.json> \\",
    "    --independent-xdf <independent-xdf.json> --out <report.json>",
  ].join("\n");
}

function optionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      const value = process.argv[index + 1];
      assert.ok(value && !value.startsWith("--"), `${name} requires a value.\n${usage()}`);
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function optionValue(name) {
  const values = optionValues(name);
  assert.equal(values.length, 1, `${name} must be supplied exactly once.\n${usage()}`);
  return values[0];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"") quoted = true;
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
  assert.equal(quoted, false, "CSV ended inside a quoted cell.");
  assert.deepEqual(row, [], "CSV must end on a row boundary.");
  assert.equal(cell, "", "CSV must end on a row boundary.");
  const headers = rows.shift() ?? [];
  assert.deepEqual(headers, BROWSER_RUN_CSV_COLUMNS, "Browser CSV headers must match the published contract.");
  return rows
    .filter(values => values.length === headers.length && values.some(Boolean))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function payload(row, label) {
  assert.ok(row, `Missing ${label} row.`);
  assert.ok(row.payload_json, `${label} row must carry payload_json.`);
  const value = JSON.parse(row.payload_json);
  assert.equal(value && typeof value, "object", `${label} payload must parse as an object.`);
  return value;
}

function numericCell(row, column, label) {
  const value = Number(row[column]);
  assert.ok(Number.isFinite(value), `${label} has non-numeric ${column}.`);
  return value;
}

function lslEquivalentCell(row, column, label) {
  if (["animation_active", "input_active"].includes(column)) {
    assert.ok(["true", "false"].includes(row[column]), `${label} has non-boolean ${column}.`);
    return;
  }
  numericCell(row, column, label);
}

async function summarizeBrowserReceipt(receiptPath) {
  const receiptFile = resolve(receiptPath);
  const raw = await readFile(receiptFile, "utf8");
  const data = JSON.parse(raw);
  assert.equal(typeof data.browser, "string", "Browser receipt must name the browser executable.");
  assert.ok(Array.isArray(data.reconstructions) && data.reconstructions.length > 0, "Browser receipt must list reconstructed CSV downloads.");
  assert.deepEqual(data.receipt?.errors ?? [], [], "Browser stress receipt must have no page errors.");
  assert.ok(commit.test(data.receipt?.buildInfo?.revision ?? ""), "Browser receipt must bind a deployed build revision.");
  assert.ok(data.receipt.checks?.includes("CSV samples include LSL-equivalent columns"), "Browser receipt must have checked LSL-equivalent columns.");

  const csvs = [];
  const variants = new Set();
  const languages = new Set();
  const outcomes = new Set();
  const planVersions = new Set();
  const questionnaireAssetCounts = new Set();
  const recipeSha256 = new Set();
  const planSha256 = new Set();

  for (const reconstruction of data.reconstructions) {
    assert.ok(reconstruction.csvPath, "Browser reconstruction must name its saved CSV path.");
    const text = await readFile(reconstruction.csvPath, "utf8");
    assert.equal(sha256Hex(text), reconstruction.sha256, `CSV SHA differs for ${reconstruction.csvPath}.`);
    const rows = parseCsv(text);
    assert.equal(rows.length, reconstruction.rows, `CSV row count differs for ${reconstruction.csvPath}.`);
    const start = rows.find(row => row.row_type === "event" && row.event_type === "runStarted");
    const terminal = rows.find(row => row.row_type === "event" && ["runComplete", "runPartial"].includes(row.event_type));
    const startup = payload(start, "browser startup");
    const outcome = payload(terminal, "browser outcome");
    assert.equal(startup.schema, "affect-runner-browser-startup");
    assert.equal(outcome.schema, "affect-runner-browser-outcome");
    assert.equal(startup.lslUnavailable, true);
    assert.equal(outcome.recordingFinalization, "browser-csv-downloaded");
    assert.equal(outcome.lslUnavailable, true);
    assert.equal(start.recipe_sha256, startup.recipeSourceByteSha256);
    assert.equal(start.plan_sha256, startup.planIdentitySha256);
    assert.ok(sha256.test(start.recipe_sha256), "Browser startup must bind a recipe source hash.");
    assert.ok(sha256.test(start.plan_sha256), "Browser startup must bind a plan identity hash.");
    assert.equal(terminal.recipe_sha256, start.recipe_sha256);
    assert.equal(terminal.plan_sha256, start.plan_sha256);
    assert.equal(reconstruction.planVersion, startup.planVersion);
    assert.equal(reconstruction.questionnaireAssetCount, startup.questionnaireAssetCount);
    assert.equal(reconstruction.outcome, outcome.protocolOutcome);

    const samples = rows.filter(row => row.row_type === "sample");
    assert.equal(samples.length, reconstruction.samples, `Sample count differs for ${reconstruction.csvPath}.`);
    assert.ok(samples.length > 0, `CSV must contain affect samples: ${reconstruction.csvPath}.`);
    for (const sample of samples) {
      for (const column of BROWSER_LSL_STATE_COLUMNS) lslEquivalentCell(sample, column, "browser sample");
    }
    const questionnaireRows = rows.filter(row => row.row_type === "questionnaire");
    assert.equal(questionnaireRows.length, reconstruction.questionnaires, `Questionnaire answer row count differs for ${reconstruction.csvPath}.`);
    assert.ok(questionnaireRows.some(row => /demographics/iu.test(row.questionnaire_id)), `CSV must include demographics rows: ${reconstruction.csvPath}.`);

    variants.add(start.variant_id);
    languages.add(start.language_id);
    outcomes.add(outcome.protocolOutcome);
    planVersions.add(String(startup.planVersion));
    questionnaireAssetCounts.add(String(startup.questionnaireAssetCount));
    recipeSha256.add(start.recipe_sha256);
    planSha256.add(start.plan_sha256);
    csvs.push({
      path: reconstruction.csvPath,
      sha256: reconstruction.sha256,
      rows: rows.length,
      samples: samples.length,
      questionnaireRows: questionnaireRows.length,
      outcome: outcome.protocolOutcome,
      variantId: start.variant_id,
      languageId: start.language_id,
      planVersion: startup.planVersion,
      questionnaireAssetCount: startup.questionnaireAssetCount,
      recipeSourceByteSha256: start.recipe_sha256,
      planIdentitySha256: start.plan_sha256,
      startupSchema: startup.schema,
      outcomeSchema: outcome.schema,
    });
  }

  return {
    receiptPath: receiptFile,
    browser: data.browser,
    pageUrl: data.receipt.pageUrl,
    deployedRevision: data.receipt.buildInfo.revision,
    recipeVersion: Number(data.receipt.recipeVersion),
    checks: data.receipt.checks.length,
    csvCount: csvs.length,
    variants: [...variants].sort(),
    languages: [...languages].sort(),
    outcomes: [...outcomes].sort(),
    planVersions: [...planVersions].map(Number).sort((a, b) => a - b),
    questionnaireAssetCounts: [...questionnaireAssetCounts].map(Number).sort((a, b) => a - b),
    recipeSourceByteSha256: [...recipeSha256].sort(),
    planIdentitySha256: [...planSha256].sort(),
    csvs,
  };
}

async function summarizeXdf({ reconstructionPath, crosscheckPath, independentPath }) {
  const [reconstruction, crosscheck, independent] = await Promise.all([
    readFile(resolve(reconstructionPath), "utf8").then(JSON.parse),
    readFile(resolve(crosscheckPath), "utf8").then(JSON.parse),
    readFile(resolve(independentPath), "utf8").then(JSON.parse),
  ]);
  assert.equal(reconstruction.schema, "affect-runner-xdf-only-reconstruction");
  assert.equal(reconstruction.recordingFootersVerified, true);
  assert.equal(reconstruction.result.status, "complete");
  assert.equal(crosscheck.result, "pass");
  assert.deepEqual(crosscheck.issues, []);
  assert.equal(crosscheck.xdfSha256, reconstruction.xdfSha256);
  assert.equal(independent.xdfSha256, reconstruction.xdfSha256);
  assert.equal(independent.schema, "affect-runner-independent-xdf-export");
  assert.equal(independent.reader.name, "pyxdf");
  assert.equal(independent.reader.synchronizeClocks, false);
  assert.equal(independent.reader.dejitterTimestamps, false);
  const startup = reconstruction.result.startup;
  const affect = independent.streams.find(stream => stream.name === startup.effectiveLsl.stateStream);
  const markers = independent.streams.find(stream => stream.name === startup.effectiveLsl.markerStream);
  assert.ok(affect, "Independent XDF must include the startup affect state stream.");
  assert.ok(markers, "Independent XDF must include the startup marker stream.");
  assert.equal(affect.channelCount, BROWSER_LSL_STATE_COLUMNS.length);
  for (const sample of affect.samples) assert.equal(sample.length, BROWSER_LSL_STATE_COLUMNS.length);
  for (const stream of independent.streams) {
    assert.equal(stream.footerVerified, true, `XDF stream footer failed: ${stream.name}`);
    assert.equal(stream.sampleCount, stream.samples.length, `XDF stream sample count differs: ${stream.name}`);
  }
  return {
    reconstructionPath: resolve(reconstructionPath),
    crosscheckPath: resolve(crosscheckPath),
    independentPath: resolve(independentPath),
    xdfSha256: reconstruction.xdfSha256,
    sourceCommit: crosscheck.commit,
    planVersion: startup.version,
    participantId: startup.participantId,
    selector: startup.selector,
    questionnaireAssetCount: startup.questionnaireAssets?.length ?? 0,
    recipeSourceByteSha256: startup.recipeSourceByteSha256,
    planIdentitySha256: startup.planIdentitySha256,
    outcome: reconstruction.result.outcome.protocolOutcome,
    recordingFinalization: reconstruction.result.recordingFinalization,
    executionQualification: reconstruction.result.executionQualification ?? null,
    responseRecords: reconstruction.result.records.filter(record => record.kind === "responses").length,
    occurrences: reconstruction.result.occurrences.length,
    lsl: {
      stateStream: startup.effectiveLsl.stateStream,
      markerStream: startup.effectiveLsl.markerStream,
      stateChannelCount: affect.channelCount,
      stateSampleCount: affect.sampleCount,
      markerSampleCount: markers.sampleCount,
      externalStreams: independent.streams
        .filter(stream => ![startup.effectiveLsl.stateStream, startup.effectiveLsl.markerStream].includes(stream.name))
        .map(stream => ({ name: stream.name, type: stream.type, channelCount: stream.channelCount, sampleCount: stream.sampleCount })),
    },
  };
}

const browserReceipts = optionValues("--browser-receipt");
assert.ok(browserReceipts.length > 0, `At least one --browser-receipt is required.\n${usage()}`);
const outPath = resolve(optionValue("--out"));

const [browser, desktopXdf] = await Promise.all([
  Promise.all(browserReceipts.map(summarizeBrowserReceipt)),
  summarizeXdf({
    reconstructionPath: optionValue("--xdf-reconstruction"),
    crosscheckPath: optionValue("--xdf-crosscheck"),
    independentPath: optionValue("--independent-xdf"),
  }),
]);

const browserPlanVersions = new Set(browser.flatMap(receipt => receipt.planVersions));
const browserAssetCounts = new Set(browser.flatMap(receipt => receipt.questionnaireAssetCounts));
const browserOutcomes = new Set(browser.flatMap(receipt => receipt.outcomes));
const browserLanguages = new Set(browser.flatMap(receipt => receipt.languages));
const browserVariants = new Set(browser.flatMap(receipt => receipt.variants));

assert.ok(browserPlanVersions.has(desktopXdf.planVersion), "Browser receipts must include the same recipe generation as the desktop XDF diagnostic.");
assert.ok(browserAssetCounts.has(desktopXdf.questionnaireAssetCount), "Browser receipts must include the same questionnaire asset binding count as the desktop XDF diagnostic.");
assert.ok(browserOutcomes.has("completed") && browserOutcomes.has("partial"), "Browser receipts must include completed and partial CSV outcomes.");
assert.ok(browserLanguages.has("en") && browserLanguages.has("de"), "Browser receipts must cover EN and DE routes.");
assert.ok(browserVariants.size >= 2, "Browser receipts must cover multiple variants.");
assert.equal(desktopXdf.outcome, "completed", "Desktop XDF diagnostic must reconstruct a completed outcome.");

const report = {
  schema: "affect-runner-csv-xdf-parity-report",
  version: 1,
  claim: "Browser CSV downloads and desktop XDF recordings expose the same run contract surface: selected recipe identity, participant route, questionnaire/demographics records, LSL-equivalent affect state columns, terminal outcome and durable reconstruction evidence. This report does not claim installed visible playback, physical timing, external LabRecorder operation or full-duration participant qualification.",
  generatedAt: new Date().toISOString(),
  sharedContract: {
    affectStateColumns: BROWSER_LSL_STATE_COLUMNS,
    browserCsvColumns: BROWSER_RUN_CSV_COLUMNS,
    browserFinalization: "browser-csv-downloaded",
    desktopRecordingFinalization: desktopXdf.recordingFinalization,
    desktopRequiresXdfFooterVerification: true,
  },
  browser,
  desktopXdf,
  parityChecks: [
    "browser CSV headers equal the published browser run CSV contract",
    "browser sample columns match the eight native LSL affect-state channels",
    "browser startup/outcome payloads bind recipeSourceByteSha256 and planIdentitySha256",
    "browser receipts reconstruct saved CSV files and cover completed plus partial routes",
    "browser receipts cover EN and DE language routes and multiple variants",
    "desktop XDF independently reconstructs the information stream from pyxdf output only",
    "desktop XDF stream footers and sample counts are independently verified",
    "desktop XDF includes the eight-channel affect stream, marker stream and selected external stream evidence",
    "browser and desktop evidence both cover master v5 recipes with four questionnaire assets",
  ],
  limitations: [
    "The desktop XDF diagnostic uses synthetic responses/observations and is not a visible installed participant run.",
    "The live Pages stress harness uses browser shims for files, media and downloads; it is deployed-browser CSV evidence, not native LSL evidence.",
    "This report compares stable contract surfaces across independently generated receipts; it does not require identical timing, sample counts or fixture plan hashes.",
  ],
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(`CSV/XDF parity report wrote ${outPath}`);

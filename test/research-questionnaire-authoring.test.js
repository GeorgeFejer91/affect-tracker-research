import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  QUESTIONNAIRE_CSV_FORMAT_VERSION,
  QUESTIONNAIRE_JSON_FORMAT_VERSION,
  QUESTIONNAIRE_TXT_FORMAT_VERSION,
  detectQuestionnaireAuthoringFormat,
  importQuestionnaireAuthoring,
} from "../site/src/research/questionnaire-authoring.js";
import {
  importQuestionnaireCsv,
  questionnaireToCsv,
} from "../site/src/research/questionnaires.js";

const csvTemplateUrl = new URL("../site/questionnaires/questionnaire-template.csv", import.meta.url);
const txtTemplateUrl = new URL("../site/questionnaires/questionnaire-template.txt", import.meta.url);
const jsonTemplateUrl = new URL("../site/questionnaires/questionnaire-template.json", import.meta.url);
const HASH_A = "a".repeat(64);
const MAX_AUTHORING_BYTES = 4 * 1024 * 1024;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function questionnaireContent(definition) {
  return {
    questionnaireId: definition.questionnaireId,
    questionnaireVersion: definition.questionnaireVersion,
    title: definition.title,
    language: definition.language,
    instructions: definition.instructions,
    attribution: definition.attribution,
    items: definition.items,
  };
}

test("authoring format detection is explicit and rejects ambiguous or unsupported files", () => {
  assert.equal(QUESTIONNAIRE_CSV_FORMAT_VERSION, "questionnaire-csv-v1");
  assert.equal(QUESTIONNAIRE_TXT_FORMAT_VERSION, "questionnaire-txt-v1");
  assert.equal(QUESTIONNAIRE_JSON_FORMAT_VERSION, "questionnaire-json-v1");
  assert.equal(detectQuestionnaireAuthoringFormat("study.CSV"), QUESTIONNAIRE_CSV_FORMAT_VERSION);
  assert.equal(
    detectQuestionnaireAuthoringFormat("study.txt", "text/plain; charset=utf-8"),
    QUESTIONNAIRE_TXT_FORMAT_VERSION,
  );
  assert.equal(
    detectQuestionnaireAuthoringFormat("study", "application/json"),
    QUESTIONNAIRE_JSON_FORMAT_VERSION,
  );
  assert.equal(
    detectQuestionnaireAuthoringFormat("study.json", "application/questionnaire+json"),
    QUESTIONNAIRE_JSON_FORMAT_VERSION,
  );
  assert.throws(
    () => detectQuestionnaireAuthoringFormat("study.csv", "application/json"),
    /extension and MIME type disagree/u,
  );
  assert.throws(() => detectQuestionnaireAuthoringFormat("study.tsv"), /CSV, TXT, or JSON/u);
  assert.throws(() => detectQuestionnaireAuthoringFormat("folder/study.csv"), /path-free/u);
});

test("CSV authoring is a byte-for-byte pass-through with an exact immutable receipt", async () => {
  const bytes = await readFile(csvTemplateUrl);
  const expectedSha256 = sha256(bytes);
  const imported = await importQuestionnaireAuthoring(bytes, {
    logicalName: "questionnaire-template.csv",
    sourceDocumentSha256: HASH_A,
  });
  const direct = await importQuestionnaireCsv(bytes, {
    sourceKind: "researcherCsv",
    logicalName: "questionnaire-template.csv",
    sourceDocumentSha256: HASH_A,
  });

  assert.deepEqual({
    definition: imported.definition,
    sourceSha256: imported.sourceSha256,
    definitionSha256: imported.definitionSha256,
  }, direct);
  assert.deepEqual(imported.authoringReceipt, {
    original: {
      formatVersion: QUESTIONNAIRE_CSV_FORMAT_VERSION,
      logicalName: "questionnaire-template.csv",
      sha256: expectedSha256,
      byteLength: bytes.byteLength,
    },
    canonicalCsv: {
      sha256: expectedSha256,
      byteLength: bytes.byteLength,
    },
  });
  assert.equal(Object.isFrozen(imported), true);
  assert.equal(Object.isFrozen(imported.authoringReceipt), true);
  assert.equal(Object.isFrozen(imported.authoringReceipt.original), true);
  assert.equal(Object.isFrozen(imported.authoringReceipt.canonicalCsv), true);
});

test("TXT and JSON templates normalize to equivalent questionnaire data and canonical CSV", async () => {
  const [csvBytes, txtBytes, jsonBytes] = await Promise.all([
    readFile(csvTemplateUrl),
    readFile(txtTemplateUrl),
    readFile(jsonTemplateUrl),
  ]);
  const [csv, txt, json] = await Promise.all([
    importQuestionnaireAuthoring(csvBytes, { logicalName: "questionnaire-template.csv" }),
    importQuestionnaireAuthoring(txtBytes, { logicalName: "questionnaire-template.txt" }),
    importQuestionnaireAuthoring(jsonBytes, { logicalName: "questionnaire-template.json" }),
  ]);

  assert.deepEqual(questionnaireContent(txt.definition), questionnaireContent(csv.definition));
  assert.deepEqual(questionnaireContent(json.definition), questionnaireContent(csv.definition));
  assert.equal(txt.definition.source.logicalName, "questionnaire-template.csv");
  assert.equal(json.definition.source.logicalName, "questionnaire-template.csv");
  assert.equal(txt.definition.source.sourceDocumentSha256, sha256(txtBytes));
  assert.equal(json.definition.source.sourceDocumentSha256, sha256(jsonBytes));

  const canonicalCsv = new TextEncoder().encode(await questionnaireToCsv(txt.definition));
  assert.equal(txt.authoringReceipt.canonicalCsv.sha256, sha256(canonicalCsv));
  assert.equal(txt.authoringReceipt.canonicalCsv.byteLength, canonicalCsv.byteLength);
  assert.deepEqual(json.authoringReceipt.canonicalCsv, txt.authoringReceipt.canonicalCsv);
  assert.equal(txt.sourceSha256, json.sourceSha256);
  assert.notEqual(txt.definitionSha256, json.definitionSha256);
  assert.deepEqual(txt.authoringReceipt.original, {
    formatVersion: QUESTIONNAIRE_TXT_FORMAT_VERSION,
    logicalName: "questionnaire-template.txt",
    sha256: sha256(txtBytes),
    byteLength: txtBytes.byteLength,
  });
  assert.deepEqual(json.authoringReceipt.original, {
    formatVersion: QUESTIONNAIRE_JSON_FORMAT_VERSION,
    logicalName: "questionnaire-template.json",
    sha256: sha256(jsonBytes),
    byteLength: jsonBytes.byteLength,
  });
});

test("TXT authoring is strict, bounded, UTF-8, tab-delimited, and versioned", async () => {
  const source = await readFile(txtTemplateUrl, "utf8");
  const firstDataRow = source.split("\n")[1];

  await assert.rejects(
    importQuestionnaireAuthoring(source.replace("format_version", "version"), {
      logicalName: "questionnaire-template.txt",
    }),
    /header must be exactly/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(source.replace(QUESTIONNAIRE_TXT_FORMAT_VERSION, "questionnaire-txt-v2"), {
      logicalName: "questionnaire-template.txt",
    }),
    /format_version/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(source.replace(firstDataRow, `${firstDataRow}\textra`), {
      logicalName: "questionnaire-template.txt",
    }),
    /exactly 14 tab-delimited columns/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(source.replace("\n", "\r"), {
      logicalName: "questionnaire-template.txt",
    }),
    /bare carriage return/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(Uint8Array.of(0xff, 0xfe, 0x00), {
      logicalName: "questionnaire-template.txt",
    }),
    /UTF-8/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(new Uint8Array(MAX_AUTHORING_BYTES + 1), {
      logicalName: "questionnaire-template.txt",
    }),
    /1–4194304 bytes/u,
  );
});

test("JSON authoring rejects duplicate keys, schema drift, invalid types, UTF-8, and bounds", async () => {
  const source = await readFile(jsonTemplateUrl, "utf8");
  const value = JSON.parse(source);

  await assert.rejects(
    importQuestionnaireAuthoring(source.replace(
      '"format_version": "questionnaire-json-v1",',
      '"format_version": "questionnaire-json-v1",\n  "format_version": "questionnaire-json-v1",',
    ), { logicalName: "questionnaire-template.json" }),
    /Duplicate JSON key "format_version"/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(JSON.stringify({ ...value, surprise: true }), {
      logicalName: "questionnaire-template.json",
    }),
    /unknown field surprise/u,
  );
  const missing = structuredClone(value);
  delete missing.language;
  await assert.rejects(
    importQuestionnaireAuthoring(JSON.stringify(missing), {
      logicalName: "questionnaire-template.json",
    }),
    /missing required field language/u,
  );
  const badItem = structuredClone(value);
  badItem.items[0].surprise = true;
  await assert.rejects(
    importQuestionnaireAuthoring(JSON.stringify(badItem), {
      logicalName: "questionnaire-template.json",
    }),
    /items\[0\] contains unknown field surprise/u,
  );
  const badOption = structuredClone(value);
  badOption.items[0].options[0].required = true;
  await assert.rejects(
    importQuestionnaireAuthoring(JSON.stringify(badOption), {
      logicalName: "questionnaire-template.json",
    }),
    /options\[0\] contains unknown field required/u,
  );
  const badRequired = structuredClone(value);
  badRequired.items[0].required = "true";
  await assert.rejects(
    importQuestionnaireAuthoring(JSON.stringify(badRequired), {
      logicalName: "questionnaire-template.json",
    }),
    /required must be a boolean/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(Uint8Array.of(0xc3, 0x28), {
      logicalName: "questionnaire-template.json",
    }),
    /encoded data was not valid|UTF-8/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(new Uint8Array(MAX_AUTHORING_BYTES + 1), {
      logicalName: "questionnaire-template.json",
    }),
    /1–4194304 bytes/u,
  );
  await assert.rejects(
    importQuestionnaireAuthoring(source, {
      logicalName: "questionnaire-template.json",
      surprise: true,
    }),
    /unknown field surprise/u,
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  QUESTIONNAIRE_CSV_COLUMNS,
  QUESTIONNAIRE_CSV_FORMAT_VERSION,
  QUESTIONNAIRE_DEFINITION_SCHEMA,
  QUESTIONNAIRE_MODULE_SCHEMA,
  QUESTIONNAIRE_RESPONSE_COLUMNS,
  QUESTIONNAIRE_RESPONSE_SCHEMA,
  createQuestionnaireResponseV1,
  importQuestionnaireCsv,
  parseQuestionnaireCsvRecords,
  questionnaireResponsesToCsv,
  questionnaireResponsesToTsv,
  questionnaireToCsv,
  validateQuestionnaireAnswers,
  validateQuestionnaireDefinitionV1,
  validateQuestionnaireModuleV1,
  validateQuestionnaireResponseV1,
  verifyQuestionnaireDefinitionV1,
} from "../site/src/research/questionnaires.js";

const fixtureUrl = new URL("../site/questionnaires/maia-2-de.csv", import.meta.url);
const templateUrl = new URL("../site/questionnaires/questionnaire-template.csv", import.meta.url);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const WORD_SOURCE_SHA256 = "7402c80c6da71d4a11543676acdf0a7640cdb842d55afc10dde6ad3d4978fdbe";

function importTemplate(input) {
  return importQuestionnaireCsv(input, {
    sourceKind: "researcherCsv",
    logicalName: "questionnaire-template.csv",
  });
}

function importMaia(input) {
  return importQuestionnaireCsv(input, {
    sourceKind: "bundled",
    logicalName: "maia-2-de.csv",
    sourceDocumentSha256: WORD_SOURCE_SHA256,
  });
}

function moduleFixture(definition, kind = "beforeSession", poolId = null) {
  return {
    schema: QUESTIONNAIRE_MODULE_SCHEMA,
    version: 1,
    moduleId: "baseline-questionnaire",
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
    placement: { kind, poolId },
  };
}

function stableDefinitionContent(definition) {
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

test("the authoring template is exact Questionnaire CSV v1 and imports immutably", async () => {
  const bytes = await readFile(templateUrl);
  const imported = await importTemplate(bytes);
  const { definition } = imported;

  assert.deepEqual(
    (await readFile(templateUrl, "utf8")).split(/\r?\n/u)[0].split(","),
    QUESTIONNAIRE_CSV_COLUMNS,
  );
  assert.equal(QUESTIONNAIRE_CSV_COLUMNS.length, 14);
  assert.equal(definition.schema, QUESTIONNAIRE_DEFINITION_SCHEMA);
  assert.equal(definition.questionnaireId, "example-questionnaire");
  assert.equal(definition.items.length, 2);
  assert.deepEqual(definition.items.map(({ options }) => options.length), [3, 2]);
  assert.equal(definition.items.every((item) => !Object.hasOwn(item, "responseType")), true);
  assert.deepEqual(definition.items[0].options.map(({ scoreValue }) => scoreValue), [0, 1, 2]);
  assert.deepEqual(definition.items[1].options.map(({ scoreValue }) => scoreValue), [null, null]);
  assert.deepEqual(definition.source, {
    kind: "researcherCsv",
    logicalName: "questionnaire-template.csv",
    sourceDocumentSha256: null,
    formatVersion: QUESTIONNAIRE_CSV_FORMAT_VERSION,
    byteLength: bytes.byteLength,
    sha256: imported.sourceSha256,
  });
  assert.match(imported.sourceSha256, /^[a-f0-9]{64}$/u);
  assert.match(imported.definitionSha256, /^[a-f0-9]{64}$/u);
  assert.equal(definition.definitionSha256, imported.definitionSha256);
  assert.equal(Object.isFrozen(definition), true);
  assert.equal(Object.isFrozen(definition.source), true);
  assert.equal(Object.isFrozen(definition.items[0].options[0]), true);

  const canonicalCsv = await questionnaireToCsv(definition);
  const reimported = await importTemplate(canonicalCsv);
  assert.deepEqual(stableDefinitionContent(reimported.definition), stableDefinitionContent(definition));
  assert.notEqual(reimported.sourceSha256, imported.sourceSha256);
});

test("the bundled German MAIA-2 has 37 exact items and explicit official scoring", async () => {
  const bytes = await readFile(fixtureUrl);
  const imported = await importMaia(bytes);
  const { definition } = imported;

  assert.equal(definition.questionnaireId, "maia-2-de");
  assert.equal(definition.questionnaireVersion, "2 (2018)");
  assert.equal(definition.items.length, 37);
  assert.equal(definition.items.every(({ required, options }) => required && options.length === 6), true);
  assert.equal(definition.items[0].prompt, "Wenn ich angespannt bin, merke ich, wo in meinem Körper die Anspannung auftritt.");
  assert.equal(definition.items[36].prompt, "Ich vertraue meinen Körperempfindungen.");
  assert.deepEqual(definition.items[0].options.map(({ label }) => label), ["Nie", "1", "2", "3", "4", "Immer"]);
  const reverseItems = definition.items
    .filter(({ options }) => options[0].scoreValue === 5)
    .map(({ order }) => order);
  assert.deepEqual(reverseItems, [5, 6, 7, 8, 9, 10, 11, 12, 15]);
  assert.deepEqual(definition.items[4].options.map(({ scoreValue }) => scoreValue), [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(definition.items[12].options.map(({ scoreValue }) => scoreValue), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...new Set(definition.items.map(({ subscale }) => subscale))], [
    "Bemerken",
    "Nicht-Ablenken",
    "Sich-Keine-Sorgen-Machen",
    "Aufmerksamkeitsregulation",
    "Emotionales Gewahrsein",
    "Selbstregulation",
    "Auf-den-Leib-Hören",
    "Vertrauen",
  ]);
  assert.match(definition.instructions, /Kreisen Sie in jeder Reihe eine Zahl ein\.$/u);
  assert.match(definition.attribution, /Mehling WE et al\. \(2018\)/u);
  assert.match(definition.attribution, /Michael Eggart/u);
  assert.match(definition.attribution, new RegExp(WORD_SOURCE_SHA256, "u"));
  assert.deepEqual(definition.source, {
    kind: "bundled",
    logicalName: "maia-2-de.csv",
    sourceDocumentSha256: WORD_SOURCE_SHA256,
    formatVersion: QUESTIONNAIRE_CSV_FORMAT_VERSION,
    byteLength: 241_104,
    sha256: "2cf89fe2cb88ca79ddf7c3f6d06394563bcce055f6aade280fb7b38272d85fba",
  });
  assert.equal(definition.definitionSha256, "0f64e2c3a36a5b58607ef4238ed55b826328542cefaf1d45524b06ec1702ff75");
});

test("the RFC 4180 parser handles BOM, escaped quotes, commas, and record newlines", async () => {
  assert.deepEqual(parseQuestionnaireCsvRecords('a,b\r\n"x,y","line 1\r\nline 2"\r\n'), [
    ["a", "b"],
    ["x,y", "line 1\r\nline 2"],
  ]);
  assert.deepEqual(parseQuestionnaireCsvRecords('\uFEFFa,b\n"""quoted""",value\n'), [
    ["a", "b"],
    ['"quoted"', "value"],
  ]);
  assert.throws(() => parseQuestionnaireCsvRecords('a,b\n"unterminated,b\n'), /unterminated/u);
  assert.throws(() => parseQuestionnaireCsvRecords('a,b\n"closed"tail,b\n'), /closing quote/u);
  assert.throws(() => parseQuestionnaireCsvRecords("a,b\rvalue"), /bare carriage return/u);
  await assert.rejects(importTemplate(Uint8Array.of(0xff, 0xfe, 0x00)), /UTF-8/u);

  const template = await readFile(templateUrl);
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), template]);
  const imported = await importTemplate(withBom);
  assert.equal(imported.definition.source.byteLength, template.byteLength + 3);
  assert.notEqual(imported.sourceSha256, (await importTemplate(template)).sourceSha256);
});

test("CSV import rejects schema drift, inconsistent rows, controls, duplicates, and score ambiguity", async () => {
  const source = await readFile(templateUrl, "utf8");
  const lines = source.trimEnd().split("\n");

  await assert.rejects(
    importTemplate(source.replace(QUESTIONNAIRE_CSV_COLUMNS.join(","), "title,item_id")),
    /header must be exactly/u,
  );
  await assert.rejects(
    importTemplate(source.replace(QUESTIONNAIRE_CSV_FORMAT_VERSION, "questionnaire-csv-v2")),
    /format_version/u,
  );
  await assert.rejects(
    importTemplate(source.replace(
      "Replace with questionnaire title,en,Replace with concise participant instructions.",
      "Changed title,en,Replace with concise participant instructions.",
    )),
    /changes questionnaire metadata/u,
  );
  await assert.rejects(
    importTemplate(source.replace("sometimes,Sometimes,1", "never,Sometimes,1")),
    /duplicate option ID never/u,
  );
  await assert.rejects(
    importTemplate(source.replace("sometimes,Sometimes,1", "sometimes,Sometimes,")),
    /all declare scoreValue/u,
  );
  const noncontiguous = [lines[0], lines[1], lines[4], lines[5], lines[2], lines[3]].join("\n") + "\n";
  await assert.rejects(importTemplate(noncontiguous), /noncontiguous item ID item-01/u);
  await assert.rejects(
    importTemplate(source.replace("Replace with the first prompt.", "Unsafe\tfirst prompt.")),
    /canonical safe characters/u,
  );
  await assert.rejects(importQuestionnaireCsv(source, { surprise: true }), /unknown field surprise/u);
});

test("definition and module validators reject unknown fields, bad hashes, and invalid placement", async () => {
  const { definition } = await importTemplate(await readFile(templateUrl));
  assert.throws(
    () => validateQuestionnaireDefinitionV1({ ...definition, surprise: true }),
    /unknown field surprise/u,
  );
  const wrongOrder = structuredClone(definition);
  wrongOrder.items[1].order = 7;
  assert.throws(() => validateQuestionnaireDefinitionV1(wrongOrder), /order/u);
  const changed = structuredClone(definition);
  changed.title = "A changed title";
  await assert.rejects(verifyQuestionnaireDefinitionV1(changed), /does not match/u);
  assert.equal((await verifyQuestionnaireDefinitionV1(definition)).definitionSha256, definition.definitionSha256);

  assert.deepEqual(
    validateQuestionnaireModuleV1(moduleFixture(definition), { definition, poolIds: ["calm"] }),
    moduleFixture(definition),
  );
  assert.deepEqual(
    validateQuestionnaireModuleV1(moduleFixture(definition, "afterBlock", "calm"), {
      definition,
      poolIds: ["calm", "intense"],
    }).placement,
    { kind: "afterBlock", poolId: "calm" },
  );
  assert.throws(
    () => validateQuestionnaireModuleV1(moduleFixture(definition, "beforeSession", "calm")),
    /require poolId null/u,
  );
  assert.throws(
    () => validateQuestionnaireModuleV1(moduleFixture(definition, "beforeBlock", "missing"), {
      poolIds: ["calm"],
    }),
    /unknown pool missing/u,
  );
  assert.throws(
    () => validateQuestionnaireModuleV1({ ...moduleFixture(definition), required: true }),
    /unknown field required/u,
  );
  assert.throws(
    () => validateQuestionnaireModuleV1({ ...moduleFixture(definition), definitionSha256: HASH_A }, {
      definition,
    }),
    /does not bind/u,
  );
});

test("answer validation and the response creator derive the declared label and score", async () => {
  const { definition } = await importTemplate(await readFile(templateUrl));
  const module = moduleFixture(definition);
  const partial = validateQuestionnaireAnswers(definition, { "item-02": "yes" }, { allowPartial: true });
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missingRequired, ["item-01"]);
  assert.throws(
    () => validateQuestionnaireAnswers(definition, { "item-01": "unknown" }),
    /declared options/u,
  );
  assert.throws(
    () => validateQuestionnaireAnswers(definition, { "item-02": "yes" }),
    /requires answers for/u,
  );

  const response = await createQuestionnaireResponseV1({
    definition,
    module,
    sequence: 1,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    participantId: "P001",
    attemptNumber: 1,
    settingsSha256: HASH_A,
    assignmentPlanSha256: HASH_B,
    protocolPlanSha256: HASH_C,
    protocolStepPosition: 1,
    itemId: "item-01",
    optionId: "often",
    status: "submitted",
    wallTimeUtc: "2026-09-08T12:00:00.000Z",
    monotonicTimeNs: "1000000",
    responseLatencyMs: 1250.5,
  });
  assert.equal(response.schema, QUESTIONNAIRE_RESPONSE_SCHEMA);
  assert.equal(response.responseLabel, "Often");
  assert.equal(response.scoreValue, 2);
  assert.equal(response.subscale, "Example scale");
  assert.equal(response.definitionSha256, definition.definitionSha256);
  assert.equal(Object.isFrozen(response), true);
  await assert.rejects(
    createQuestionnaireResponseV1({
      definition,
      module,
      sequence: 1,
      runId: "123e4567-e89b-42d3-a456-426614174000",
      participantId: "P001",
      attemptNumber: 1,
      settingsSha256: HASH_A,
      assignmentPlanSha256: HASH_B,
      protocolPlanSha256: HASH_C,
      protocolStepPosition: 1,
      itemId: "item-01",
      optionId: "missing",
      status: "draft",
      wallTimeUtc: "2026-09-08T12:00:00.000Z",
      monotonicTimeNs: "1000000",
      responseLatencyMs: 5,
    }),
    /has no option missing/u,
  );
});

test("QuestionnaireResponseV1 is closed and CSV/TSV share canonical columns and rows", async () => {
  const { definition } = await importTemplate(await readFile(templateUrl));
  const module = moduleFixture(definition);
  const shared = {
    definition,
    module,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    participantId: "P001",
    attemptNumber: 1,
    settingsSha256: HASH_A,
    assignmentPlanSha256: HASH_B,
    protocolPlanSha256: HASH_C,
    protocolStepPosition: 1,
    status: "submitted",
    wallTimeUtc: "2026-09-08T12:00:00.000Z",
    responseLatencyMs: 250,
  };
  const responses = [
    await createQuestionnaireResponseV1({
      ...shared,
      sequence: 1,
      itemId: "item-01",
      optionId: "never",
      monotonicTimeNs: "1000000",
    }),
    await createQuestionnaireResponseV1({
      ...shared,
      sequence: 2,
      itemId: "item-02",
      optionId: "yes",
      monotonicTimeNs: "2000000",
    }),
  ];
  assert.throws(
    () => validateQuestionnaireResponseV1({ ...responses[0], surprise: true }),
    /unknown field surprise/u,
  );
  const csv = questionnaireResponsesToCsv(responses);
  const tsv = questionnaireResponsesToTsv(responses);
  assert.equal(csv.split("\r\n")[0], QUESTIONNAIRE_RESPONSE_COLUMNS.join(","));
  assert.equal(tsv.split("\r\n")[0], QUESTIONNAIRE_RESPONSE_COLUMNS.join("\t"));
  assert.equal(csv.split("\r\n").filter(Boolean).length, 3);
  assert.equal(tsv.split("\r\n").filter(Boolean).length, 3);
  assert.equal(csv.replaceAll(",", "\t"), tsv);
  assert.match(csv, new RegExp(definition.definitionSha256, "u"));
  assert.throws(
    () => questionnaireResponsesToCsv([responses[1], responses[0]]),
    /sequence must start at one|contiguous/u,
  );
});

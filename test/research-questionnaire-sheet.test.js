import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importQuestionnaireAuthoring } from "../site/src/research/questionnaire-authoring.js";
import { questionnaireToCsv } from "../site/src/research/questionnaires.js";
import {
  QUESTIONNAIRE_SHEET_LIMITS,
  appendSheetRows,
  applySheetPaste,
  cloneQuestionnaireSheet,
  createQuestionnaireSheet,
  parseSheetTable,
  removeSheetRow,
  reverseSheetRowCodes,
  setOptionCount,
  setOptionLabels,
  setSheetCell,
  sheetFromDefinition,
  sheetToAuthoring,
} from "../site/src/research/questionnaire-sheet.js";

const make = (options = {}) => createQuestionnaireSheet({ familyId: "custom", language: "en", title: "Study questionnaire", ...options });
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function heterogeneousImport() {
  return importQuestionnaireAuthoring(JSON.stringify({
    format_version: "questionnaire-json-v1", questionnaire_id: "original-en", questionnaire_version: "2.1",
    title: "Original title", language: "en", instructions: "Original instructions.", attribution: "Original source and terms.",
    items: [
      { item_id: "original-a", prompt: "First item", required: true, subscale: "first", options: [
        { option_id: "never", option_label: "Never", score_value: 5 },
        { option_id: "always", option_label: "Always", score_value: -3 },
      ] },
      { item_id: "original-b", prompt: "Second item", required: false, subscale: null, options: [
        { option_id: "no", option_label: "No", score_value: null },
        { option_id: "maybe", option_label: "Maybe", score_value: null },
        { option_id: "yes", option_label: "Yes", score_value: null },
      ] },
    ],
  }), { logicalName: "original.json" });
}

test("Excel TSV rectangles preserve quoted Unicode prompts, escaped quotes, BOM and trailing empty codes", () => {
  assert.deepEqual(parseSheetTable('\uFEFF"How, exactly, do you ""feel""?"\t4\t3\t2\t1\r\n"Wie fühlen Sie sich?"\t1\t2\t3\t\r\n'), [
    ['How, exactly, do you "feel"?', "4", "3", "2", "1"], ["Wie fühlen Sie sich?", "1", "2", "3", ""],
  ]);
  assert.deepEqual(parseSheetTable('"A, quoted prompt",2,1\r\nSecond,1,2', { delimiter: "," }), [
    ["A, quoted prompt", "2", "1"], ["Second", "1", "2"],
  ]);
  assert.deepEqual(parseSheetTable('"First\r\nsecond"\t1'), [["First\r\nsecond", "1"]]);
});

test("pasting from any item/code cell changes only its rectangle and keeps other language sheets independent", () => {
  const english = make({ rowCount: 2, optionCount: 4 });
  const german = make({ language: "de", rowCount: 2, optionCount: 4 });
  const untouchedGerman = structuredClone(german);
  applySheetPaste(english, "First\t1\t2\t3\t4\nSecond\t4\t3\t2\t1");
  const before = structuredClone(english);
  assert.equal(applySheetPaste(english, "-1\t0.5", { row: 1, column: 2 }), english);
  assert.deepEqual(english.rows[0], before.rows[0]);
  assert.deepEqual(english.rows[1].options.map((option) => option.scoreValue), [4, -1, 0.5, 1]);
  assert.equal(english.rows[1].prompt, "Second");
  assert.deepEqual(german, untouchedGerman);
  assert.equal(english.modified, true);
});

test("CSV item rows use their accordion identity and serialize custom/reverse codes separately from labels", async () => {
  const sheet = make({ optionCount: 4 });
  setOptionLabels(sheet, ["Never", "Rarely", "Often", "Always"]);
  applySheetPaste(sheet, '"How, today?",4,3,2,1\r\nSecond item,10,20,30,40', { delimiter: "," });
  const result = await sheetToAuthoring(sheet);
  assert.equal(result.definition.questionnaireId, "custom-en");
  assert.equal(result.definition.language, "en");
  assert.equal(result.definition.items.length, 2);
  assert.deepEqual(result.definition.items[0].options.map(({ label, scoreValue }) => [label, scoreValue]), [
    ["Never", 4], ["Rarely", 3], ["Often", 2], ["Always", 1],
  ]);
  assert.equal(result.authoringReceipt.original.sha256, digest(result.sourceBytes));
  assert.equal(result.definition.source.sha256, digest(result.sourceBytes));
  assert.equal(result.unchanged, false);
  assert.equal(new TextDecoder().decode(result.sourceBytes), await questionnaireToCsv(result.definition));
  const repeated = await sheetToAuthoring(sheet);
  assert.deepEqual(result, repeated);
});

test("invalid numeric cells and overflowing pastes reject atomically without partial edits", () => {
  const sheet = make({ rowCount: 1, optionCount: 2 });
  applySheetPaste(sheet, "Original\t1\t2");
  for (const bad of ["=1+2", "+SUM(A1)", "NaN", "Infinity", "1e309", "1000000001", "0x10", "1,5", "--2"]) {
    const before = structuredClone(sheet);
    assert.throws(() => applySheetPaste(sheet, `Would replace\t1\t${bad}`), /codes/u);
    assert.deepEqual(sheet, before);
  }
  const before = structuredClone(sheet);
  assert.throws(() => applySheetPaste(sheet, "1\t2\t3", { column: 1 }), /fit/u);
  assert.throws(() => applySheetPaste(sheet, "one\ntwo", { row: 1023 }), /fit/u);
  assert.deepEqual(sheet, before);
});

test("bounds and malformed clipboard text reject before mutation", () => {
  const sheet = make();
  const before = structuredClone(sheet);
  for (const text of ['"unclosed', '"closed"extra\t1', "A\rB", "A\uFEFFB", "A\t1\nB", "A\n".repeat(1025), "x".repeat(4001)]) {
    assert.throws(() => applySheetPaste(sheet, text));
    assert.deepEqual(sheet, before);
  }
  assert.throws(() => parseSheetTable("ä".repeat(QUESTIONNAIRE_SHEET_LIMITS.bytes / 2 + 1)), /4 MiB/u);
  assert.throws(() => parseSheetTable(Array(66).fill("1").join("\t")), /65 columns/u);
  assert.throws(() => parseSheetTable("one;two", { delimiter: ";" }), /tab or comma/u);
  assert.throws(() => applySheetPaste(sheet, '"Line\nline"'), /control/u);
  assert.deepEqual(sheet, before);
});

test("wholly empty new sheets cannot be saved and only untouched placeholder rows are omitted", async () => {
  const sheet = make();
  await assert.rejects(sheetToAuthoring(sheet), /at least one/u);
  applySheetPaste(sheet, "First item");
  assert.equal((await sheetToAuthoring(sheet)).definition.items.length, 1);
  setSheetCell(sheet, 1, 1, 99);
  await assert.rejects(sheetToAuthoring(sheet), /needs a prompt/u);
  removeSheetRow(sheet, 1);
  assert.equal((await sheetToAuthoring(sheet)).definition.items.length, 1);
});

test("numeric or unscored options work, but an incomplete scoring row cannot be saved", async () => {
  const sheet = make({ rowCount: 1, optionCount: 2 });
  applySheetPaste(sheet, "Unscored item\t\t");
  assert.deepEqual((await sheetToAuthoring(sheet)).definition.items[0].options.map((option) => option.scoreValue), [null, null]);
  setSheetCell(sheet, 0, 1, 5);
  await assert.rejects(sheetToAuthoring(sheet), /either all declare scoreValue/u);
  setSheetCell(sheet, 0, 2, -0);
  assert.deepEqual((await sheetToAuthoring(sheet)).definition.items[0].options.map((option) => option.scoreValue), [5, 0]);
});

test("opening and saving existing heterogeneous definitions preserves exact content and provenance", async () => {
  const original = await heterogeneousImport();
  const sheet = sheetFromDefinition(original.definition, { familyId: "original", authoringResult: original });
  assert.deepEqual(sheet.optionLabels, [null, null, null]);
  assert.deepEqual(sheet.rows.map((row) => row.options.length), [2, 3]);
  setOptionCount(sheet, 3);
  const result = await sheetToAuthoring(sheet);
  assert.equal(result.unchanged, true);
  assert.equal(result.sourceBytes, null);
  assert.equal(sheet.modified, false);
  assert.deepEqual(result.definition, original.definition);
  assert.deepEqual(result.authoringReceipt, original.authoringReceipt);
  assert.equal(result.definitionSha256, original.definitionSha256);
});

test("a narrow edit retains all untouched heterogeneous item fields and marks a derivative source", async () => {
  const original = await heterogeneousImport();
  const sheet = sheetFromDefinition(original.definition, { familyId: "original" });
  setSheetCell(sheet, 0, 0, "Edited first item");
  const result = await sheetToAuthoring(sheet);
  assert.equal(sheet.modified, true);
  assert.equal(result.definition.items[0].itemId, "original-a");
  assert.deepEqual(result.definition.items[0].options, original.definition.items[0].options);
  assert.deepEqual(result.definition.items[1], original.definition.items[1]);
  assert.equal(result.definition.questionnaireVersion, "2.1");
  assert.equal(result.definition.attribution, original.definition.attribution);
  assert.equal(result.definition.source.kind, "researcherCsv");
  assert.equal(result.definition.source.sourceDocumentSha256, original.definition.source.sourceDocumentSha256);
  assert.notEqual(result.definitionSha256, original.definitionSha256);
});

test("direct metadata edits cannot masquerade as an unchanged imported definition", async () => {
  const original = await heterogeneousImport();
  const sheet = sheetFromDefinition(original.definition);
  sheet.title = "Explicitly edited title";
  const result = await sheetToAuthoring(sheet);
  assert.equal(result.unchanged, false);
  assert.equal(result.definition.title, "Explicitly edited title");
  assert.notEqual(result.definitionSha256, original.definitionSha256);
});

test("explicit shared-label and option-count edits retain surviving codes and identities", async () => {
  const original = await heterogeneousImport();
  const sheet = sheetFromDefinition(original.definition);
  const oldIds = sheet.rows[0].options.map((option) => option.optionId);
  setOptionLabels(sheet, ["Shared first", null, null]);
  assert.deepEqual(sheet.rows[0].options.map((option) => option.label), ["Shared first", "Always"]);
  assert.deepEqual(sheet.rows[1].options.map((option) => option.label), ["Shared first", "Maybe", "Yes"]);
  setOptionCount(sheet, 4);
  assert.deepEqual(sheet.rows[0].options.slice(0, 2).map((option) => option.optionId), oldIds);
  assert.deepEqual(sheet.rows[0].options.map((option) => option.scoreValue), [5, -3, 3, 4]);
  assert.deepEqual(sheet.rows[1].options.map((option) => option.scoreValue), [null, null, null, null]);
  setOptionCount(sheet, 2);
  assert.deepEqual(sheet.rows[0].options.map((option) => option.scoreValue), [5, -3]);
  assert.deepEqual(sheet.rows[1].options.map((option) => option.scoreValue), [null, null]);
  const before = structuredClone(sheet);
  assert.throws(() => setOptionCount(sheet, 65));
  assert.throws(() => setOptionLabels(sheet, ["fine", "bad\u0000"]));
  assert.deepEqual(sheet, before);
});

test("reverse, append and delete preserve stable item/option identity and stay bounded", () => {
  const sheet = make({ optionCount: 4, rowCount: 1 });
  applySheetPaste(sheet, "First\t10\t20\t30\t40");
  const labels = sheet.rows[0].options.map(({ optionId, label }) => [optionId, label]);
  reverseSheetRowCodes(sheet, 0);
  assert.deepEqual(sheet.rows[0].options.map((option) => option.scoreValue), [40, 30, 20, 10]);
  assert.deepEqual(sheet.rows[0].options.map(({ optionId, label }) => [optionId, label]), labels);
  appendSheetRows(sheet, 2);
  const lastId = sheet.rows[2].itemId;
  removeSheetRow(sheet, 1);
  assert.equal(sheet.rows[1].itemId, lastId);
  appendSheetRows(sheet);
  assert.equal(new Set(sheet.rows.map((row) => row.itemId)).size, 3);
  const before = structuredClone(sheet);
  assert.throws(() => appendSheetRows(sheet, 1024), /1024/u);
  assert.throws(() => removeSheetRow(sheet, -1));
  assert.deepEqual(sheet, before);
});

test("bundled English/German MAIA opening/saving does not alter item text, scoring, IDs or source hashes", async () => {
  for (const language of ["en", "de"]) {
    const logicalName = `maia-2-${language}.csv`;
    const bytes = await readFile(new URL(`../site/questionnaires/${logicalName}`, import.meta.url));
    const original = await importQuestionnaireAuthoring(bytes, { logicalName, sourceKind: "bundled" });
    const sheet = sheetFromDefinition(original.definition, { familyId: "maia-2", authoringResult: original });
    const result = await sheetToAuthoring(sheet);
    assert.equal(result.unchanged, true);
    assert.equal(result.sourceBytes, null);
    assert.deepEqual(result.definition, original.definition);
    assert.equal(result.definition.items.length, 37);
  }
});

test("unknown-language drafts, unsafe IDs, and tampered imported definition hashes are rejected", async () => {
  assert.throws(() => make({ familyId: "../outside" }));
  assert.throws(() => make({ language: "und" }));
  assert.throws(() => make({ language: "en/../../de" }));
  assert.throws(() => make({ optionCount: 1 }));
  const original = await heterogeneousImport();
  const changed = structuredClone(original.definition);
  changed.items[0].prompt = "Tampered content";
  const sheet = sheetFromDefinition(changed);
  await assert.rejects(sheetToAuthoring(sheet), /does not match/u);
  assert.throws(() => sheetFromDefinition(original.definition, { authoringResult: { definition: changed } }), /does not belong/u);
});

test("canonical source expansion enforces its own byte and option-row bounds without changing the draft", async () => {
  const sheet = make({ rowCount: 0, optionCount: 64 });
  applySheetPaste(sheet, Array.from({ length: 391 }, (_, index) => `Item ${index + 1}`).join("\n"));
  const before = structuredClone(sheet);
  await assert.rejects(sheetToAuthoring(sheet), /25000/u);
  assert.deepEqual(sheet, before);
  const expanded = make({ rowCount: 0, optionCount: 64 });
  expanded.attribution = "x".repeat(12000);
  applySheetPaste(expanded, "One\nTwo\nThree\nFour\nFive\nSix");
  await assert.rejects(sheetToAuthoring(expanded), /4 MiB/u);
});

test("Undo clones retain source provenance and isolated placeholder tracking across subsequent edits", async () => {
  const original = await heterogeneousImport();
  const sheet = sheetFromDefinition(original.definition, { familyId: "original", authoringResult: original });
  const undo = cloneQuestionnaireSheet(sheet);
  setSheetCell(sheet, 0, 0, "Changed after snapshot");
  assert.equal((await sheetToAuthoring(sheet)).unchanged, false);
  const restored = await sheetToAuthoring(undo);
  assert.equal(restored.unchanged, true);
  assert.deepEqual(restored.definition, original.definition);
  assert.deepEqual(restored.authoringReceipt, original.authoringReceipt);
  setSheetCell(undo, 1, 0, "Edit after Undo");
  assert.equal((await sheetToAuthoring(undo)).definition.items[1].prompt, "Edit after Undo");
  assert.equal(sheet.rows[1].prompt, "Second item");

  const blank = make();
  applySheetPaste(blank, "Only item");
  const blankUndo = cloneQuestionnaireSheet(blank);
  setSheetCell(blank, 1, 1, 9);
  await assert.rejects(sheetToAuthoring(blank), /needs a prompt/u);
  assert.equal((await sheetToAuthoring(blankUndo)).definition.items.length, 1);
  const codeUndo = cloneQuestionnaireSheet(blank);
  await assert.rejects(sheetToAuthoring(codeUndo), /needs a prompt/u);
  blank.title = "An unfinished\nmetadata edit";
  assert.doesNotThrow(() => cloneQuestionnaireSheet(blank));
});

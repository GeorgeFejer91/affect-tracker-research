import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createQuestionnaireSheet, cloneQuestionnaireSheet, applyQuestionnaireGridPaste,
  setQuestionnaireGridCell, questionnaireGridRows, serializeQuestionnaireGrid,
  sheetFromDefinition, sheetToAuthoring,
} from "../site/src/research/questionnaire-sheet.js";
import { importQuestionnaireAuthoring } from "../site/src/research/questionnaire-authoring.js";
import { PREBUILT_QUESTIONNAIRE_ASSETS, prebuiltQuestionnaireAvailability } from "../site/src/research/questionnaire-prebuilt.js";

const make = () => createQuestionnaireSheet({ familyId: "custom", language: "en" });
const table = 'Item\tAnswer 1\tCode 1\tAnswer 2\tCode 2\tRequired\r\n"How, exactly, do you ""feel""?"\tNever\t4\tAlways\t-2\ttrue\r\nSecond item\tNo\t0\tYes\t1\tfalse\r\n';

test("one Excel paste replaces item, label, code and required cells together and sets the option count", async () => {
  const sheet = make(); applyQuestionnaireGridPaste(sheet, table);
  assert.equal(sheet.optionCount, 2); assert.equal(sheet.rows.length, 2);
  const { definition } = await sheetToAuthoring(sheet);
  assert.equal(definition.items[0].prompt, 'How, exactly, do you "feel"?');
  assert.deepEqual(definition.items[0].options.map((o) => [o.label, o.scoreValue]), [["Never", 4], ["Always", -2]]);
  assert.equal(definition.items[1].required, false);
});

test("full table copy round-trips through Excel TSV and CSV including labels, negative codes and Unicode", () => {
  const sheet = make(); applyQuestionnaireGridPaste(sheet, table);
  setQuestionnaireGridCell(sheet, 1, 1, "Überhaupt nicht");
  for (const delimiter of ["\t", ","]) {
    const target = make();
    applyQuestionnaireGridPaste(target, serializeQuestionnaireGrid(sheet, { delimiter }), { delimiter });
    assert.deepEqual(questionnaireGridRows(target), questionnaireGridRows(sheet));
  }
});

test("headerless range paste and single-cell edits preserve untouched labels, codes and language variants", () => {
  const sheet = make(); applyQuestionnaireGridPaste(sheet, table);
  const other = cloneQuestionnaireSheet(sheet);
  applyQuestionnaireGridPaste(sheet, "Sometimes\t9\r\nOften\t8", { row: 0, column: 1 });
  assert.equal(sheet.rows[0].options[0].label, "Sometimes");
  assert.equal(sheet.rows[1].options[0].scoreValue, 8);
  assert.equal(sheet.rows[0].options[1].label, "Always");
  assert.equal(other.rows[0].options[0].label, "Never");
  setQuestionnaireGridCell(sheet, 0, 2, "7");
  assert.equal(sheet.rows[0].options[0].label, "Sometimes");
  assert.equal(serializeQuestionnaireGrid(sheet, { header: false, range: { top: 0, bottom: 1, left: 1, right: 2 } }), "Sometimes\t7\r\nOften\t8\r\n");
});

test("malformed full tables reject atomically before any resize, label, code or required mutation", () => {
  for (const text of [table.replace("\t4\t", "\t=1+3\t"), table.replace("\ttrue", "\tmaybe"), table.replace("Code 2", "Code 3"), table.replace("Always", "Al\nways"), table.replace("\t-2", "\tInfinity")]) {
    const sheet = make(); const before = structuredClone(sheet);
    assert.throws(() => applyQuestionnaireGridPaste(sheet, text)); assert.deepEqual(sheet, before);
  }
  assert.throws(() => applyQuestionnaireGridPaste(make(), table, { row: 1 }), /first item cell/u);
  assert.throws(() => applyQuestionnaireGridPaste(make(), "x".repeat(4 * 1024 * 1024 + 1)), /limit/u);
});

test("codes-only paste is explicit and never overwrites participant answer labels", () => {
  const sheet = make(); applyQuestionnaireGridPaste(sheet, table);
  applyQuestionnaireGridPaste(sheet, "Revised item\t2\t1", { layout: "codes-only" });
  assert.deepEqual(sheet.rows[0].options.map((o) => o.label), ["Never", "Always"]);
  assert.deepEqual(sheet.rows[0].options.map((o) => o.scoreValue), [2, 1]);
  const result = applyQuestionnaireGridPaste(sheet, "Item\tCode 1\tCode 2\r\nLegacy table\t5\t4");
  assert.equal(result.layout, "codes-only"); assert.equal(sheet.rows.length, 1);
  assert.deepEqual(sheet.rows[0].options.map((o) => o.label), ["Never", "Always"]);
});

test("blank score cells remain unscored and a partial row still fails the existing saving contract", async () => {
  const sheet = make(); applyQuestionnaireGridPaste(sheet, table.replace("\t4\t", "\t\t").replace("\t-2\t", "\t\t"));
  assert.equal((await sheetToAuthoring(sheet)).definition.items[0].options[0].scoreValue, null);
  setQuestionnaireGridCell(sheet, 0, 2, "1");
  await assert.rejects(sheetToAuthoring(sheet));
});

test("copy refuses formula-like text rather than making Excel execute it", () => {
  const sheet = make(); applyQuestionnaireGridPaste(sheet, table);
  setQuestionnaireGridCell(sheet, 0, 1, "=HYPERLINK(1)");
  assert.throws(() => serializeQuestionnaireGrid(sheet), /Formula-like/u);
});

test("both shipped MAIA variants expose all labels and codes without altering untouched definition provenance", async () => {
  for (const language of ["en", "de"]) {
    const bytes = await readFile(new URL(`../site/questionnaires/maia-2-${language}.csv`, import.meta.url));
    const imported = await importQuestionnaireAuthoring(bytes, { logicalName: `maia-2-${language}.csv`, sourceKind: "bundled" });
    const sheet = sheetFromDefinition(imported.definition, { familyId: "maia-2", authoringResult: imported });
    const rows = questionnaireGridRows(sheet);
    assert.equal(rows.length, 37); assert.equal(rows[0].length, 14);
    assert.equal(rows[0][1], imported.definition.items[0].options[0].label);
    assert.equal(rows[4][2], imported.definition.items[4].options[0].scoreValue);
    assert.equal((await sheetToAuthoring(sheet)).unchanged, true);
    const original = structuredClone(sheet);
    applyQuestionnaireGridPaste(sheet, serializeQuestionnaireGrid(sheet));
    assert.deepEqual(sheet, original);
    assert.equal((await sheetToAuthoring(sheet)).definition.definitionSha256, imported.definition.definitionSha256);
  }
});

test("catalogue has separate EN/DE variants, no implicit language addition, and cannot preload TAS or overwrite drafts", () => {
  assert.deepEqual(PREBUILT_QUESTIONNAIRE_ASSETS.map((a) => a.id), ["maia-2-en", "maia-2-de", "tas-20-en", "tas-20-de"]);
  for (const asset of PREBUILT_QUESTIONNAIRE_ASSETS) {
    assert.equal(prebuiltQuestionnaireAvailability(asset, { languages: ["en", "de"] }).disabled, !asset.ready);
    assert.equal(prebuiltQuestionnaireAvailability(asset, { languages: [], occupied: false }).disabled, true);
    assert.equal(prebuiltQuestionnaireAvailability(asset, { languages: ["en", "de"], occupied: true }).disabled, true);
    assert.equal(prebuiltQuestionnaireAvailability(asset, { languages: ["en", "de"], locked: true }).disabled, true);
  }
});

test("full labelled tables preserve heterogeneous options, identities, subscales and provenance", async () => {
  const source = make(); applyQuestionnaireGridPaste(source, table);
  // A longer second item makes the first row's trailing cells intentional padding.
  source.optionCount = 3; source.optionLabels.push(null);
  source.rows[1].options.push({ optionId: "custom-third", label: "Perhaps", scoreValue: 2 });
  source.rows[0].subscale = "original-subscale";
  const imported = await sheetToAuthoring(source);
  const sheet = sheetFromDefinition(imported.definition, { familyId: "custom", authoringResult: imported });
  applyQuestionnaireGridPaste(sheet, serializeQuestionnaireGrid(sheet));
  assert.deepEqual(sheet.rows.map(r => r.options.length), [2, 3]);
  assert.equal((await sheetToAuthoring(sheet)).unchanged, true);
  assert.deepEqual((await sheetToAuthoring(sheet)).definition, imported.definition);
});

test("whole-table replacement follows uniquely matched item metadata, not old row positions", async () => {
  const source = make(); applyQuestionnaireGridPaste(source, table);
  source.rows[0].subscale = "first-subscale";
  source.rows[1].subscale = "second-subscale";
  const original = (await sheetToAuthoring(source)).definition;
  const sheet = sheetFromDefinition(original,{familyId:"custom"});
  const lines = serializeQuestionnaireGrid(sheet).trimEnd().split("\r\n");
  applyQuestionnaireGridPaste(sheet,[lines[0],lines[2],lines[1]].join("\r\n"));
  assert.equal(sheet.rows[0].itemId,original.items[1].itemId);
  assert.equal(sheet.rows[0].subscale,"second-subscale");
  applyQuestionnaireGridPaste(sheet,serializeQuestionnaireGrid(sheet).replace("Second item","Entirely new item"));
  assert.equal(sheet.rows[0].subscale,null);
  assert.ok(!original.items.some(i=>i.itemId===sheet.rows[0].itemId));
  assert.equal(sheet.rows[1].subscale,"first-subscale");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PREBUILT_QUESTIONNAIRE_ASSETS } from "../site/src/research/questionnaire-prebuilt.js";
import { importQuestionnaireAuthoring } from "../site/src/research/questionnaire-authoring.js";
import { sheetFromDefinition, sheetToAuthoring } from "../site/src/research/questionnaire-sheet.js";

test("every ready preset provides all item labels and recorded codes to the sheet without changing provenance", async () => {
  const ready = PREBUILT_QUESTIONNAIRE_ASSETS.filter(({ ready }) => ready);
  assert.deepEqual(ready.map(({ id }) => id), ["maia-2-en", "maia-2-de"]);
  for (const asset of ready) {
    const logicalName = `${asset.id}.csv`;
    const source = await readFile(new URL(`../site/questionnaires/${logicalName}`, import.meta.url));
    const { definition } = await importQuestionnaireAuthoring(source, { logicalName, sourceKind: "bundled" });
    assert.equal(definition.questionnaireId, asset.id);
    assert.equal(definition.language, asset.language);
    assert.equal(definition.items.length, 37);
    const sheet = sheetFromDefinition(definition, { familyId: asset.familyId });
    assert.equal(sheet.familyId, "maia-2");
    assert.equal(sheet.language, asset.language);
    assert.equal(sheet.optionCount, 6);
    for (const [index, item] of definition.items.entries()) {
      assert.equal(sheet.rows[index].prompt, item.prompt);
      assert.deepEqual(sheet.rows[index].options, item.options.map(({ optionId, label, scoreValue }) => ({ optionId, label, scoreValue })));
    }
    assert.deepEqual((await sheetToAuthoring(sheet)).definition, definition);
    // Preserve local supplied annotations; bilingual content does not imply
    // that the two sources define equivalent computed scoring algorithms.
    const reverseRows = definition.items.flatMap((item, index) =>
      item.options[0].scoreValue === 5 ? [index + 1] : []);
    assert.deepEqual(reverseRows, asset.language === "de" ? [5, 6, 7, 8, 9, 10, 11, 12, 15] : []);
    assert.equal(new Set(definition.items.map(({ subscale }) => subscale)).size,
      asset.language === "de" ? 8 : 1);
    if (asset.language === "en") assert.ok(definition.items.every(({ subscale }) => subscale === null));
  }
});

test("TAS entries remain unavailable rather than masquerading as ready bilingual assets", () => {
  const assets = PREBUILT_QUESTIONNAIRE_ASSETS.filter(({ familyId }) => familyId === "tas-20");
  assert.deepEqual(assets.map(({ language }) => language), ["en", "de"]);
  assert.ok(assets.every(({ ready, description }) => !ready && description.includes("permission")));
});

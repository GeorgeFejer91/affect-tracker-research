import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyFormDefinitionV1 } from "../site/src/research/form-definition.js";
import { validateTypedResponseRows } from "../runner/src/typed-responses.js";

const fixtures = await Promise.all(["en", "de"].map(async language => verifyFormDefinitionV1(JSON.parse(await readFile(new URL(`./fixtures/demographics-${language}-form-v1.canonical.json`, import.meta.url), "utf8")))));
const makeRows = definition => definition.items.map(item => {
  const value = item.response.kind === "text" ? { kind: "text", text: "  Test Participant Ä\n李  " } : item.response.kind === "integer" ? { kind: "integer", integer: 0 } : { kind: "singleChoice", optionId: "preferNotToSay" };
  const row = { itemId: item.itemId, itemOrder: item.order, value, responseLatencyMs: 125 };
  if (value.kind === "singleChoice") { const option = item.response.options.find(o => o.optionId === value.optionId); row.optionOrder = option.order; row.responseLabel = option.label; }
  return row;
});
test("typed response reconstruction preserves EN/DE labels, exact text and explicit declined answers", () => {
  for (const definition of fixtures) {
    const rows = makeRows(definition), result = validateTypedResponseRows(definition, rows, { submitted: true, monotonicMs: 250 });
    assert.equal(result.complete, true); assert.deepEqual(result.responses, rows);
    assert.equal(result.responses[1].value.integer, 0); assert.ok(result.responses.every(row => !Object.hasOwn(row, "scoreValue")));
  }
});
test("typed recorded omissions, scores, wrong types, labels, order and latency cannot pass", () => {
  const definition = fixtures[0];
  for (const mutate of [rows => rows.pop(), rows => rows[0].value.text = " \ufeff\u0085", rows => rows[0].scoreValue = 1,
    rows => rows[1].value.integer = "30", rows => rows[1].value.integer = 1.5, rows => rows[1].value.integer = 9007199254740992,
    rows => rows[2].responseLabel = "Invented label", rows => rows[2].optionOrder = 99, rows => rows[0].value.kind = "unknown",
    rows => rows[3] = rows[2], rows => rows.reverse(), rows => rows[0].responseLatencyMs = -1,
    rows => rows[0].responseLatencyMs = 251, rows => rows[0].value.text = "ä".repeat(513)]) {
    const rows = makeRows(definition); mutate(rows); assert.throws(() => validateTypedResponseRows(definition, rows, { submitted: true, monotonicMs: 250 }));
  }
  const rows = makeRows(definition); rows[0].value.text = " \ufeff\u0085";
  const draft = validateTypedResponseRows(definition, rows, { submitted: false, monotonicMs: 250 });
  assert.equal(draft.complete, false); assert.deepEqual(draft.missingRequired, ["fullName"]); assert.deepEqual(draft.responses, rows);
  assert.equal(validateTypedResponseRows(definition, [], { submitted: false, monotonicMs: 250 }).complete, false);
});

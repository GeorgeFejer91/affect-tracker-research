import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createFormDefinitionV1, verifyFormDefinitionV1, verifyP2Definition, validateFormDefinitionV1, validateFormAnswers } from "../site/src/research/form-definition.js";
import { canonicalJson } from "../site/src/research/canonical.js";
const fixtures = await Promise.all(["en", "de"].map(async language => JSON.parse(await readFile(new URL(`./fixtures/demographics-${language}-form-v1.canonical.json`, import.meta.url), "utf8"))));
test("production form reader reproduces both frozen canonical definitions and snapshots async input", async () => {
  for (const d of fixtures) {
    assert.deepEqual(await verifyP2Definition(d), d);
    const { definitionSha256, ...core } = d;
    assert.deepEqual(await createFormDefinitionV1(core), d);
    const input = structuredClone(d), promise = verifyFormDefinitionV1(input);
    input.title = "later mutation";
    assert.equal(canonicalJson(await promise), canonicalJson(d));
  }
});
test("strict form validation rejects branch confusion, malformed Unicode, bounds, duplicates and tampering", async () => {
  for (const mutate of [d => d.version = 2, d => d.extra = true, d => delete d.provenance,
    d => d.provenance.validationStatus = "validated", d => d.items[0].response.scoreValue = 1,
    d => d.items[0].response.kind = "likert", d => d.items[0].response.maxUtf8Bytes = 1025,
    d => d.items[1].response.max = 9007199254740992, d => d.items[1].response.min = -1,
    d => d.items[1].response.max = "42", d => d.items[1].response.min = 0.5,
    d => d.items[0].prompt = "\ud800", d => d.items[0].prompt = "x".repeat(8001),
    d => d.items[1].itemId = "fullName", d => d.items[1].order = 1,
    d => d.items[2].response.options[1].optionId = "male", d => d.items[2].response.options.reverse(),
    d => d.items[2].response.options[0].scoreValue = null, d => d.items = [],
    d => d.language = "und", d => d.definitionSha256 = "A".repeat(64)]) {
    const d = structuredClone(fixtures[0]); mutate(d); assert.throws(() => validateFormDefinitionV1(d));
  }
  const changed = structuredClone(fixtures[0]); changed.title = "changed";
  await assert.rejects(verifyFormDefinitionV1(changed), /hash/);
  await assert.rejects(verifyP2Definition({ ...fixtures[0], schema: "unknown" }));
});
const answer = (itemId, value) => ({ itemId, value });
const complete = () => [answer("fullName", { kind: "text", text: "  Synthetic É例  " }), answer("age", { kind: "integer", integer: 0 }), answer("gender", { kind: "singleChoice", optionId: "preferNotToSay" }), answer("handedness", { kind: "singleChoice", optionId: "left" })];
test("definition size follows the frozen 16 MiB bound without an unapproved 4 MiB cutoff", () => {
  const d = structuredClone(fixtures[0]);
  const item = { itemId: "field", order: 1, prompt: "Prompt", required: true, response: { kind: "singleChoice",
    options: Array.from({ length: 256 }, (_, i) => ({ optionId: `option-${i}`, order: i + 1, label: "x".repeat(2000) })) } };
  d.items = Array.from({ length: 9 }, (_, i) => ({ ...structuredClone(item), itemId: `field-${i}`, order: i + 1 }));
  assert.ok(new TextEncoder().encode(canonicalJson(d)).length > 4 * 1024 * 1024);
  assert.doesNotThrow(() => validateFormDefinitionV1(d));
  d.items = Array.from({ length: 33 }, (_, i) => ({ ...structuredClone(item), itemId: `field-${i}`, order: i + 1 }));
  assert.throws(() => validateFormDefinitionV1(d), /16 MiB/);
});
test("typed answers retain exact text, canonical item order and all-displayed completion", () => {
  const d = structuredClone(fixtures[0]); d.items.forEach(i => i.required = false);
  assert.deepEqual(validateFormAnswers(d, complete().reverse()).answers, complete());
  assert.throws(() => validateFormAnswers(d, []), /every displayed/);
  assert.deepEqual(validateFormAnswers(d, [], { allowPartial: true }).missingRequired, ["fullName", "age", "gender", "handedness"]);
  for (const text of ["", "\u0085\uFEFF\u3000\t"]) {
    const values = complete(); values[0].value.text = text;
    const partial = validateFormAnswers(d, values, { allowPartial: true });
    assert.equal(partial.complete, false); assert.deepEqual(partial.missingRequired, ["fullName"]);
    assert.equal(partial.answers[0].value.text, text); assert.throws(() => validateFormAnswers(d, values));
  }
});
test("invalid values never become valid partial answers and UTF-8 limit counts bytes", () => {
  for (const value of [{ kind: "integer", integer: "1" }, { kind: "integer", integer: null },
    { kind: "integer", integer: 1.5 }, { kind: "integer", integer: -1 }, { kind: "integer", integer: 9007199254740992 },
    { kind: "text", text: "42" }]) assert.throws(() => validateFormAnswers(fixtures[0], [answer("age", value)], { allowPartial: true }));
  for (const text of ["é".repeat(513), "\ud800"]) assert.throws(() => validateFormAnswers(fixtures[0], [answer("fullName", { kind: "text", text })], { allowPartial: true }));
  assert.equal(validateFormAnswers(fixtures[0], [answer("fullName", { kind: "text", text: "é".repeat(512) })], { allowPartial: true }).answers.length, 1);
  assert.throws(() => validateFormAnswers(fixtures[0], [complete()[0], complete()[0]], { allowPartial: true }));
  assert.throws(() => validateFormAnswers(fixtures[0], [answer("gender", { kind: "singleChoice", optionId: "unknown" })], { allowPartial: true }));
});

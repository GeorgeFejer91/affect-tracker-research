import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { validateQuestionnaireDefinitionV1 } from "../site/src/research/questionnaires.js";

const root = new URL("../", import.meta.url);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(new URL("test/fixtures/demographics-form-v1.manifest.json", root));
const manifest = JSON.parse(manifestBytes);
const fixtureFiles = await Promise.all(manifest.fixtures.map(async entry => {
  const bytes = await readFile(new URL(entry.path, root));
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { entry, bytes, definition: JSON.parse(source) };
}));
const definitions = fixtureFiles.map(file => file.definition);
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());

test("manifest and two exact canonical files bind definition and physical byte hashes", async () => {
  assert.equal(manifestBytes.toString("utf8"), `${canonicalJson(manifest)}\n`);
  assert.equal(manifest.schema, "affect-research-demographics-fixture-manifest");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.status, "contractFixturesOnly");
  assert.deepEqual(manifest.fixtures.map(f => f.language), ["en", "de"]);
  for (const { entry, bytes, definition } of fixtureFiles) {
    assert.equal(entry.path, `test/fixtures/demographics-${entry.language}-form-v1.canonical.json`);
    assert.deepEqual(bytes, Buffer.from(`${canonicalJson(definition)}\n`));
    assert.equal(bytes.length, entry.byteLength);
    assert.equal(digest(bytes), entry.fileSha256);
    assert.equal(definition.definitionSha256, entry.definitionSha256);
    assert.equal(await canonicalSha256(definition, { omitRootKeys: ["definitionSha256"] }), entry.definitionSha256);
    assert.equal(definition.questionnaireId, entry.questionnaireId);
    assert.equal(definition.language, entry.language);
  }
});

test("fixtures freeze a score-free project-authored form with exact typed constraints", () => {
  assert.equal(definitions.length, 2);
  for (const d of definitions) {
    keys(d, ["schema", "version", "questionnaireId", "questionnaireVersion", "title", "language", "provenance", "items", "definitionSha256"]);
    assert.equal(d.schema, "affect-research-form-definition");
    assert.equal(d.version, 1);
    assert.equal(d.questionnaireVersion, "1");
    assert.deepEqual(d.provenance, { kind: "projectAuthored", sourceId: "affect-research-demographics", sourceVersion: "1", validationStatus: "notValidated" });
    assert.deepEqual(d.items.map(i => i.itemId), ["fullName", "age", "gender", "handedness"]);
    for (const [index, item] of d.items.entries()) {
      keys(item, ["itemId", "order", "prompt", "required", "response"]);
      assert.equal(item.order, index + 1);
      assert.equal(item.required, true);
    }
    assert.deepEqual(d.items[0].response, { kind: "text", maxUtf8Bytes: 1024 });
    assert.deepEqual(d.items[1].response, { kind: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, unit: "years" });
    for (const item of d.items.slice(2)) {
      keys(item.response, ["kind", "options"]);
      assert.equal(item.response.kind, "singleChoice");
      item.response.options.forEach((option, index) => {
        keys(option, ["optionId", "order", "label"]);
        assert.equal(option.order, index + 1);
      });
    }
  }
});

test("EN and DE preserve stable item/option identities and the exact approved wording", () => {
  const [en, de] = definitions;
  assert.equal(en.title, "Demographics");
  assert.equal(de.title, "Demografische Angaben");
  assert.deepEqual(en.items.map(i => i.prompt), ["Full name", "Age (whole years)", "Gender", "Handedness"]);
  assert.deepEqual(de.items.map(i => i.prompt), ["Vollständiger Name", "Alter (in ganzen Jahren)", "Geschlecht", "Händigkeit"]);
  for (const d of definitions) {
    assert.deepEqual(d.items[2].response.options.map(o => o.optionId), ["male", "female", "other", "preferNotToSay"]);
    assert.deepEqual(d.items[3].response.options.map(o => o.optionId), ["right", "left", "ambidextrous", "preferNotToSay"]);
  }
  assert.deepEqual(en.items[2].response.options.map(o => o.label), ["Male", "Female", "Other", "Prefer not to say"]);
  assert.deepEqual(de.items[2].response.options.map(o => o.label), ["Männlich", "Weiblich", "Andere", "Keine Angabe"]);
  assert.deepEqual(en.items[3].response.options.map(o => o.label), ["Right-handed", "Left-handed", "Ambidextrous", "Prefer not to say"]);
  assert.deepEqual(de.items[3].response.options.map(o => o.label), ["Rechtshändig", "Linkshändig", "Beidhändig", "Keine Angabe"]);
});

test("unchanged legacy definition reader rejects each typed definition without mutation", () => {
  for (const d of definitions) {
    const before = structuredClone(d);
    assert.throws(() => validateQuestionnaireDefinitionV1(d));
    assert.deepEqual(d, before);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  QUESTIONNAIRE_INSPIRATION_CATALOGUE,
  validateQuestionnaireInspirationCatalogue,
} from "../site/src/research/questionnaire-inspiration.js";

const EXPECTED_KEYS = [
  "bundledAssetIds",
  "domain",
  "forms",
  "id",
  "languageTags",
  "name",
  "reuseNote",
  "reuseStatus",
  "shortName",
  "sourceLabel",
  "sourceUrl",
];
const EXPECTED_IDS = [
  "maia-2",
  "tas-20",
  "phenomenological-control-scale-10",
  "phencon-short-adaptation",
  "perth-alexithymia-questionnaire",
  "affective-slider",
  "body-perception-questionnaire-20",
  "geneva-emotion-wheel",
  "emotional-expressivity-scale",
  "emotion-regulation-questionnaire",
];
const DOMAINS = new Set(["emotion", "interoception"]);
const REUSE_STATUSES = new Set([
  "bundled",
  "reusePermitted",
  "nonCommercial",
  "permissionRequired",
  "verifyTerms",
]);

function assertDeeplyFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const member of Object.values(value)) assertDeeplyFrozen(member);
}

test("the questionnaire inspiration catalogue is closed, sourced, and deeply frozen", () => {
  assert.deepEqual(QUESTIONNAIRE_INSPIRATION_CATALOGUE.map(({ id }) => id), EXPECTED_IDS);
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
  assertDeeplyFrozen(QUESTIONNAIRE_INSPIRATION_CATALOGUE);

  for (const entry of QUESTIONNAIRE_INSPIRATION_CATALOGUE) {
    assert.deepEqual(Object.keys(entry).sort(), EXPECTED_KEYS);
    assert.equal(DOMAINS.has(entry.domain), true);
    assert.equal(REUSE_STATUSES.has(entry.reuseStatus), true);
    assert.ok(entry.forms.length > 0);
    assert.ok(entry.languageTags.length > 0);
    assert.deepEqual(entry.languageTags, ["en", "de"]);
    assert.equal(new URL(entry.sourceUrl).protocol, "https:");
    assert.ok(entry.sourceLabel.length > 0);
    assert.ok(entry.reuseNote.length > 0);
    assert.equal(Object.hasOwn(entry, "items"), false);
  }
});

test("only the reusable MAIA-2 language variants claim bundled asset IDs", () => {
  const maia = QUESTIONNAIRE_INSPIRATION_CATALOGUE.find(({ id }) => id === "maia-2");
  assert.deepEqual(maia?.bundledAssetIds, ["maia-2-en", "maia-2-de"]);
  assert.equal(maia?.reuseStatus, "reusePermitted");

  for (const entry of QUESTIONNAIRE_INSPIRATION_CATALOGUE.filter(({ id }) => id !== "maia-2")) {
    assert.deepEqual(entry.bundledAssetIds, []);
  }
  const tas20 = QUESTIONNAIRE_INSPIRATION_CATALOGUE.find(({ id }) => id === "tas-20");
  assert.equal(tas20?.reuseStatus, "permissionRequired");
  assert.deepEqual(tas20?.bundledAssetIds, []);
  assert.match(tas20?.reuseNote ?? "", /permission or licence[\s\S]*rights holders[\s\S]*ePROVIDE/u);
  assert.match(tas20?.reuseNote ?? "", /authorized asset for every selected language/u);
});

test("full and short PhenCon leads remain explicitly unverified", () => {
  const full = QUESTIONNAIRE_INSPIRATION_CATALOGUE.find(({ id }) => id === "phenomenological-control-scale-10");
  const short = QUESTIONNAIRE_INSPIRATION_CATALOGUE.find(({ id }) => id === "phencon-short-adaptation");
  assert.deepEqual(full?.forms, ["full"]);
  assert.deepEqual(short?.forms, ["short"]);
  assert.equal(full?.reuseStatus, "verifyTerms");
  assert.equal(short?.reuseStatus, "verifyTerms");
  assert.equal(short?.name, "Custom Phenomenological Control short adaptation — not standardized");
  assert.equal(short?.shortName, "Custom PhenCon short adaptation — not standardized");
  assert.match(short?.reuseNote ?? "", /No standardized short form or explicit reuse grant has been verified/u);
  assert.match(short?.reuseNote ?? "", /rights-gated[\s\S]*authorized asset for every selected language/u);
});

test("catalogue validation rejects duplicate IDs, insecure links, and open enums", () => {
  const clone = () => structuredClone(QUESTIONNAIRE_INSPIRATION_CATALOGUE);

  const duplicate = clone();
  duplicate[1].id = duplicate[0].id;
  assert.throws(() => validateQuestionnaireInspirationCatalogue(duplicate), /repeats id/u);

  const insecure = clone();
  insecure[0].sourceUrl = "http://example.com/instrument";
  assert.throws(() => validateQuestionnaireInspirationCatalogue(insecure), /must use HTTPS/u);

  const unknownStatus = clone();
  unknownStatus[0].reuseStatus = "free";
  assert.throws(() => validateQuestionnaireInspirationCatalogue(unknownStatus), /reuseStatus is unsupported/u);

  const missingForms = clone();
  missingForms[0].forms = [];
  assert.throws(() => validateQuestionnaireInspirationCatalogue(missingForms), /forms must be a non-empty array/u);
});

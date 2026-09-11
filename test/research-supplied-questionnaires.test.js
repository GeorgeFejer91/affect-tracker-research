import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { importQuestionnaireCsv } from "../site/src/research/questionnaires.js";

const fixtures = [
  {
    fileName: "vr-exp-en.csv", questionnaireId: "vr-exp-en", itemCount: 2,
    title: "Experience with Virtual Reality and Computers",
    optionCount: 4, minimumScore: 1, maximumScore: 4,
    firstPrompt: "Previous experience with VR",
    lastPrompt: "Level of expertise with computer and/or VR",
    firstLabel: "None", lastLabel: "More than 15 hours",
    contentDigest: "de8c84bd40d7f47400c1f1f779c4ddc29773b3a9610a2b0fcdc71944f6500d65",
  },
  {
    fileName: "maia-2-en.csv", questionnaireId: "maia-2-en", itemCount: 37,
    title: "Multidimensional Assessment of Interoceptive Awareness",
    optionCount: 6, minimumScore: 0, maximumScore: 5,
    firstPrompt: "When I am tense I notice where the tension is located in my body",
    lastPrompt: "I trust my body sensations",
    firstLabel: "Never", lastLabel: "Always",
    contentDigest: "866423839e7774a3de45fc6e8685c9b0c59a5ca2a638ce692c918cee76d884f1",
  },
  {
    fileName: "ssq-six-item-en.csv", questionnaireId: "ssq-six-item-en", itemCount: 6,
    title: "Simulator Sickness Questionnaire",
    optionCount: 7, minimumScore: 0, maximumScore: 6,
    firstPrompt: "General discomfort", lastPrompt: "Difficulty concentrating",
    firstLabel: "None", lastLabel: "Severe",
    contentDigest: "9dd9b6c89468623e4e368820ae91db8435d5574909cea4a8c6041303745f8d51",
  },
];

async function importFixture(fileName) {
  return importQuestionnaireCsv(
    await readFile(new URL(`../site/questionnaires/${fileName}`, import.meta.url)),
    { sourceKind: "bundled", logicalName: fileName },
  );
}

test("distributable questionnaire CSV fixtures preserve names, IDs, wording, and ranges", async () => {
  for (const expected of fixtures) {
    const { definition } = await importFixture(expected.fileName);
    assert.equal(definition.questionnaireId, expected.questionnaireId);
    assert.equal(definition.title, expected.title);
    assert.equal(definition.language, "en");
    assert.equal(definition.items.length, expected.itemCount);
    assert.equal(definition.items.every(({ required, subscale }) => required && subscale === null), true);
    assert.deepEqual(definition.items.map(({ options }) => options.length), Array(expected.itemCount).fill(expected.optionCount));
    assert.equal(definition.items[0].prompt, expected.firstPrompt);
    assert.equal(definition.items.at(-1).prompt, expected.lastPrompt);

    const scores = Array.from(
      { length: expected.maximumScore - expected.minimumScore + 1 },
      (_, index) => expected.minimumScore + index,
    );
    for (const item of definition.items) {
      assert.deepEqual(item.options.map(({ scoreValue }) => scoreValue), scores);
    }
    assert.equal(definition.items[0].options[0].label, expected.firstLabel);
    assert.equal(definition.items[0].options.at(-1).label, expected.lastLabel);
    const exactSuppliedContent = definition.items.map(({ prompt, options }) => ({
      prompt,
      options: options.map(({ label, scoreValue }) => ({ label, scoreValue })),
    }));
    assert.equal(
      createHash("sha256").update(JSON.stringify(exactSuppliedContent)).digest("hex"),
      expected.contentDigest,
      `${expected.fileName} wording, option labels, and numeric values must remain exact`,
    );
    if (expected.questionnaireId === "maia-2-en") {
      assert.match(definition.attribution, /MAIA-2 © 2018 University of California, San Francisco/u);
      assert.match(definition.attribution, /public domain/u);
      assert.match(definition.attribution, /available without charge and no written permission is required/u);
      assert.match(definition.attribution, /Project modification disclosure/u);
      assert.match(definition.attribution, /https:\/\/osher\.ucsf\.edu\/sites\/osher\.ucsf\.edu\/files\/inline-files\/MAIA-2\.pdf/u);
      assert.match(definition.attribution, /https:\/\/doi\.org\/10\.1371\/journal\.pone\.0208034/u);
    } else {
      assert.match(definition.attribution, /Max Planck Institute for Human Brain and Cognitive Sciences/u);
      assert.match(definition.attribution, /Stephanstrasse 1a, 04103 Leipzig, Germany/u);
      assert.match(definition.attribution, /required-item flags are application authoring defaults/u);
      assert.match(definition.attribution, /Scoring\/subscale interpretation was not supplied and is not inferred\./u);
    }
  }
});

test("blank intermediate descriptions remain visible as numeric option labels", async () => {
  for (const [fileName, labels] of [
    ["maia-2-en.csv", ["Never", "1", "2", "3", "4", "Always"]],
    ["ssq-six-item-en.csv", ["None", "1", "2", "3", "4", "5", "Severe"]],
  ]) {
    const { definition } = await importFixture(fileName);
    assert.deepEqual(definition.items[0].options.map(({ label }) => label), labels);
  }
});

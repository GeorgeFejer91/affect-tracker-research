import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buttonSoundCueForDescriptor,
  createMinimalUiSounds,
  normalizeUiSoundCue,
  questionnaireSoundCueForType,
} from "../site/src/research/ui-sounds.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("minimal UI sounds stay scoped to explicit low-risk button interactions", () => {
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-launch", classes: ["primary-action"] }), "confirm");
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-settings" }), "press");
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-back" }), "back");
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-questionnaire-next", questionnaire: true, text: "Next" }), "forward");
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-questionnaire-previous", questionnaire: true, text: "Previous" }), "back");
  assert.equal(buttonSoundCueForDescriptor({ id: "plain-button" }), null);
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-launch", classes: ["primary-action"], disabled: true }), null);
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-launch", classes: ["primary-action"], dataset: { uiSound: "off" } }), null);
  assert.equal(buttonSoundCueForDescriptor({ id: "runner-launch", classes: ["primary-action"], dataset: { uiSound: "OFF" } }), null);
  assert.equal(buttonSoundCueForDescriptor({ dataset: { uiSound: "select" } }), "select");
  assert.equal(normalizeUiSoundCue("made-up"), null);
});

test("questionnaire sounds are limited to discrete choice-like SurveyJS controls", () => {
  for (const type of ["radiogroup", "checkbox", "dropdown", "tagbox", "ranking", "buttongroup", "rating", "slider", "boolean", "matrix", "matrixdropdown", "matrixdynamic", "imagepicker"]) {
    assert.equal(questionnaireSoundCueForType(type), "select", `${type} should be a selectable cue`);
  }
  for (const type of ["text", "comment", "multipletext", "panel", "paneldynamic", "file", "signaturepad", "html", "image", "expression", "", null]) {
    assert.equal(questionnaireSoundCueForType(type), null, `${type} should remain silent`);
  }
});

test("minimal UI sounds fail closed without browser audio support", () => {
  const sounds = createMinimalUiSounds({ windowObject: { performance: { now: () => 100 } } });
  assert.equal(sounds.play("press"), false);
  sounds.setEnabled(false);
  assert.equal(sounds.play("confirm"), false);
  sounds.destroy();
  assert.equal(sounds.play("press"), false);
});

test("UI sounds are project-authored synthesis, not vendored media assets", async () => {
  const source = await read("site/src/research/ui-sounds.js");
  assert.doesNotMatch(source, /\.(?:mp3|wav|ogg|flac)\b|new URL\(|fetch\(|new Audio\(/iu);
  assert.match(source, /createOscillator/u);
  assert.match(source, /volume = 0\.045/u);
});

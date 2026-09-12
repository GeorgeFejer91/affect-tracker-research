import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { readRunnerRecipe, resolveRunnerSelection } from "../runner/src/recipe.js";
import { participantNumber, participantLabel, participantCatalogue, participantTimeline } from "../runner/src/participants.js";
const recipe = await readRunnerRecipe(await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url)));
test("participant aliases resolve to the original scheduled ID without allocating another", () => {
  const catalogue = participantCatalogue(recipe);
  for (const alias of ["P01", "P001", "p1", "1", " 01 "]) assert.equal(catalogue.resolve(alias), "P001");
  assert.equal(catalogue.resolve("P03"), null);
  for (const input of ["", "P000", "-1", "P1.5", "P1e2", "P100001", "../P01"]) assert.equal(participantNumber(input), null);
  assert.equal(participantLabel("P001"), "P01");
  assert.equal(participantLabel("P100000"), "P100000");
});
test("100,000 declared participants resolve without inventing IDs outside the file", () => {
  const schedules = Array.from({ length: 100000 }, (_, i) => ({ participantId: `P${String(i + 1).padStart(3, "0")}` }));
  const catalogue = participantCatalogue({ package: { settings: { externalProtocol: { definition: { schedules } } } } });
  assert.equal(catalogue.resolve("P100000"), "P100000"); assert.equal(catalogue.ids.length, 100000);
  assert.equal(catalogue.resolve("P100001"), null);
  schedules.push({ participantId: "P0001" });
  assert.throws(() => participantCatalogue({ package: { settings: { externalProtocol: { definition: { schedules } } } } }), /ambiguous/);
});
test("timeline preserves every participant and language's exact video, form and interval order", async () => {
  for (const participant of ["P001", "P002"]) for (const language of ["en", "de"]) {
    const expected = await resolveRunnerSelection(recipe, participant, [language]);
    const timeline = await participantTimeline(recipe, participant, [language]);
    assert.deepEqual(timeline.events.map(e => [e.protocolPosition, e.kind, e.stimulusId, e.moduleId]), expected.compiled.protocolPlan.steps.map(e => [e.protocolPosition, e.kind, e.stimulusId, e.moduleId]));
    assert.ok(timeline.events.every(e => e.title && (e.durationMs === null || Number.isFinite(e.durationMs))));
    assert.equal(timeline.selection.detail.protocolPlanSha256, expected.detail.protocolPlanSha256);
  }
  const en = await participantTimeline(recipe, "P001", ["en"]);
  assert.deepEqual(en.events.map(e => e.kind), ["stimulus", "questionnaire", "questionnaire", "interval", "questionnaire", "stimulus", "interval"]);
  await assert.rejects(participantTimeline(recipe, "P001", []), /language/);
  await assert.rejects(participantTimeline(recipe, "P003", ["en"]));
});

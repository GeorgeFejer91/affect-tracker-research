import test from "node:test";
import assert from "node:assert/strict";
import { createPlannedMarkerProfile, inspectPlannedMarkerTrace } from "../site/src/research/planned-marker-contract.js";
import { readFile } from "node:fs/promises";
import { compileVariantTimeline } from "../site/src/research/variant-design.js";

const profile = {
  recipeSha256: "a".repeat(64), variantId: "variant-1", variantVersionSha256: "b".repeat(64),
  codebook: [
    { sourceCode: "source-1", kind: "video", identitySha256: "c".repeat(64), durationMs: 1000 },
    { sourceCode: "source-2", kind: "isi", identitySha256: "d".repeat(64), durationMs: 500 },
    { sourceCode: "source-3", kind: "form", identitySha256: "e".repeat(64), durationMs: null },
  ],
  entries: [ { entryId: "entry-1", sourceCode: "source-1" }, { entryId: "entry-2", sourceCode: "source-2" }, { entryId: "entry-3", sourceCode: "source-1" }, { entryId: "entry-4", sourceCode: "source-3" } ],
};
function trace(steps) {
  return steps.map(([eventType, entryId, executionId, sourceCode, monotonicMs], i) => ({
    schema: "affect-research-marker", version: 1, recipeSha256: profile.recipeSha256, runId: "run-1", attemptId: "attempt-1",
    variantId: profile.variantId, variantVersionSha256: profile.variantVersionSha256, sequence: i + 1,
    eventType, entryId, executionId, sourceCode, monotonicMs,
  }));
}
const steps = [
  ["sessionStart", null, null, null, 0],
  ["videoStart", "entry-1", "execution-1", "source-1", 2],
  ["pause", "entry-1", "execution-1", "source-1", 100],
  ["resume", "entry-1", "execution-1", "source-1", 300],
  ["videoEnd", "entry-1", "execution-1", "source-1", 1202],
  ["isiStart", "entry-2", "execution-2", "source-2", 1202],
  ["isiEnd", "entry-2", "execution-2", "source-2", 1702],
  ["videoStart", "entry-3", "execution-3", "source-1", 1704],
  ["interruption", "entry-3", "execution-3", "source-1", 1800],
  ["restart", "entry-3", "execution-3", "source-1", 1900],
  ["videoStart", "entry-3", "execution-4", "source-1", 1902],
  ["videoEnd", "entry-3", "execution-4", "source-1", 2902],
  ["formStart", "entry-4", "execution-5", "source-3", 2903],
  ["formEnd", "entry-4", "execution-5", "source-3", 5000],
  ["complete", null, null, null, 5001],
];
test("planned codebook embeds exact source identity and duration without file paths or spreadsheet names", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/variant-design-v1.json", import.meta.url), "utf8"));
  const value = await createPlannedMarkerProfile(fixture.document.contribution, "variant-1", fixture.videos, profile.recipeSha256);
  assert.equal(value.codebook.length, 3); assert.equal(value.entries.length, 3);
  assert.deepEqual(value.codebook[0], { sourceCode: "source-1", kind: "video", identitySha256: fixture.videos[0].sha256, durationMs: 1000 });
  assert.equal(value.codebook[1].durationMs, 500);
  assert.doesNotMatch(JSON.stringify(value), /assets\/stimuli|relativePath|annotationId|\.mp4/);
  await assert.rejects(createPlannedMarkerProfile(fixture.document.contribution, "variant-1", [], profile.recipeSha256));
});
test("timing and marker profiles share explicit annotation references when durable asset IDs differ", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/variant-design-v1.json", import.meta.url), "utf8"));
  const videos = fixture.videos.map(video => ({ ...video, assetId: `asset-${video.sha256}` }));
  for (const variant of fixture.document.contribution.variants) {
    const timeline = compileVariantTimeline(fixture.document.contribution, variant.variantId, videos);
    const marker = await createPlannedMarkerProfile(fixture.document.contribution, variant.variantId, videos, profile.recipeSha256);
    const sources = new Map(marker.codebook.map(source => [source.sourceCode, source]));
    assert.equal(marker.entries.reduce((total, entry) => total + sources.get(entry.sourceCode).durationMs, 0), timeline.plannedDurationMs);
    assert.deepEqual(marker.entries.map(entry => entry.entryId), variant.entries.map(entry => entry.entryId));
  }
  // Asset-only geometry records and ambiguous aliases require a validated P1
  // projection. Both consumers reject them instead of guessing precedence.
  for (const invalid of [videos.map(({ annotationId: _annotation, ...video }) => video), [...videos, videos[0]]]) {
    assert.throws(() => compileVariantTimeline(fixture.document.contribution, "variant-1", invalid), /annotationId/);
    await assert.rejects(createPlannedMarkerProfile(fixture.document.contribution, "variant-1", invalid, profile.recipeSha256), /annotationId/);
  }
});
test("synthetic marker profile reconstructs repeated video, interval, form, pauses and restart without external source files", () => {
  const result = inspectPlannedMarkerTrace(structuredClone(profile), trace(steps));
  assert.equal(result.status, "complete"); assert.deepEqual(result.issues, []);
  assert.equal(result.occurrences.length, 5);
  assert.deepEqual(result.occurrences[2], { entryId: "entry-3", executionId: "execution-3", sourceCode: "source-1", startMs: 1704, endMs: null, state: "interrupted" });
  assert.notEqual(result.occurrences[2].executionId, result.occurrences[3].executionId);
});
test("missing or reordered markers and unclosed traces remain incomplete without invented timestamps", () => {
  const records = trace(steps); records.splice(4, 1);
  const missing = inspectPlannedMarkerTrace(profile, records);
  assert.equal(missing.status, "incomplete"); assert.ok(missing.issues.some(issue => issue.code === "sequence-gap-or-reorder"));
  const partial = inspectPlannedMarkerTrace(profile, trace(steps.slice(0, 2)));
  assert.equal(partial.occurrences[0].endMs, null);
  assert.deepEqual(partial.issues.map(issue => issue.code), ["unclosed-occurrence", "missing-terminal"]);
  const outOfOrder = trace(steps); outOfOrder[4].monotonicMs = 1;
  assert.ok(inspectPlannedMarkerTrace(profile, outOfOrder).issues.some(issue => issue.code === "time-reversed"));
});
test("marker envelope rejects foreign run bindings, unknown fields and arbitrary paths or questionnaire text", () => {
  for (const mutate of [r => r.runId = "another-run", r => r.variantVersionSha256 = "f".repeat(64), r => r.sourceCode = "C:/study/video.mp4", r => r.answer = "private", r => r.monotonicMs = NaN]) {
    const records = trace(steps); mutate(records[3]); assert.throws(() => inspectPlannedMarkerTrace(profile, records));
  }
  const explicitPartial = trace([steps[0], ["partial", null, null, null, 1]]);
  assert.equal(inspectPlannedMarkerTrace(profile, explicitPartial).status, "partial");
  const premature = trace([steps[0], ["complete", null, null, null, 1]]);
  assert.equal(inspectPlannedMarkerTrace(profile, premature).status, "incomplete");
});

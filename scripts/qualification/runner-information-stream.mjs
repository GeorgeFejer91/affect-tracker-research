// This accepts only independent XDF export; no producer JSON or sidecar input.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectInformationStream } from "../../experiment-runner/src/information-stream.js";

export async function reconstructInformationXdf(data) {
  assert.equal(data.schema, "affect-runner-independent-xdf-export"); assert.equal(data.version, 2);
  assert.equal(data.reader.name, "pyxdf"); assert.equal(data.reader.synchronizeClocks, false); assert.equal(data.reader.dejitterTimestamps, false);
  const primary = data.streams[data.primaryStreamIndex];
  assert.equal(primary.channelCount, 1); assert.equal(primary.samples.length, primary.timestamps.length);
  assert.equal(primary.channelFormat, "string"); assert.equal(primary.nominalSampleRateHz, 0);
  assert.deepEqual(primary.channels, [{ label: "marker", unit: null, type: "Markers" }]);
  const samples = primary.samples.map((value, i) => ({ value: value[0], timestamp: primary.timestamps[i] }));
  const result = await inspectInformationStream(samples);
  assert.equal(result.status, "complete", JSON.stringify(result.issues));
  assert.equal(primary.name, result.startup.effectiveLsl.markerStream);
  const affect = data.streams.find(s => s.name === result.startup.effectiveLsl.stateStream);
  assert.ok(affect); assert.equal(affect.channelCount, 8);
  assert.equal(affect.channelFormat, "float32");
  assert.equal(affect.nominalSampleRateHz, result.plan.selected.policy.samplingFrequencyHz);
  assert.deepEqual(affect.channels, [
    ["current_valence", "normalized"], ["current_arousal", "normalized"],
    ["target_valence", "normalized"], ["target_arousal", "normalized"],
    ["radius", "normalized"], ["angle_degrees", "degrees"],
    ["animation_active", "boolean"], ["input_active", "boolean"],
  ].map(([label, unit]) => ({ label, unit, type: "Affect" })));
  for (let index = 0; index < affect.samples.length; index += 1) {
    const row = affect.samples[index];
    assert.equal(row.length, 8); assert.ok(row.every(Number.isFinite));
    for (const value of row.slice(0, 4)) assert.ok(value >= -1 && value <= 1);
    assert.ok(row[4] >= 0 && row[4] <= 1 && row[5] >= 0 && row[5] < 360);
    assert.ok([0, 1].includes(row[6]) && [0, 1].includes(row[7]));
    assert.ok(Math.abs(row[0] - row[2]) < 1e-6 && Math.abs(row[1] - row[3]) < 1e-6,
      "Recorded display state and admitted affect outcome must agree");
    assert.ok(Math.abs(row[4] - Math.min(1, Math.hypot(row[2], row[3]))) < 1e-5,
      "Recorded radius must derive from the two-dimensional affect outcome");
    if (index) assert.ok(affect.timestamps[index] > affect.timestamps[index - 1], "Affect timestamps must increase strictly");
  }
  for (const stream of data.streams) {
    assert.equal(stream.footerVerified, true); assert.equal(stream.sampleCount, stream.samples.length);
    assert.equal(stream.sampleCount, stream.timestamps.length); assert.ok(stream.timestamps.every(Number.isFinite));
  }
  assert.ok(affect.timestamps.every(t => t >= result.records[0].commitLslTimeSeconds && t <= result.records.at(-1).firstLslTimeSeconds), "Affect samples must follow startup commit and precede terminal outcome");
  const deltas = affect.timestamps.slice(1).map((value, index) => value - affect.timestamps[index]).sort((a, b) => a - b);
  const span = affect.timestamps.length > 1 ? affect.timestamps.at(-1) - affect.timestamps[0] : 0;
  const cadence = {
    authoredHz: affect.nominalSampleRateHz,
    sampleCount: affect.sampleCount,
    spanSeconds: span,
    observedMeanHz: span > 0 ? (affect.sampleCount - 1) / span : null,
    minimumDeltaMs: deltas.length ? deltas[0] * 1000 : null,
    medianDeltaMs: deltas.length ? deltas[Math.floor(deltas.length / 2)] * 1000 : null,
    maximumDeltaMs: deltas.length ? deltas.at(-1) * 1000 : null,
  };
  return { schema: "affect-runner-xdf-only-reconstruction", version: 2,
    claim: "XDF-only reconstruction; acquisition context is not inferred. Correlate separately with installed and physical observations.",
    xdfSha256: data.xdfSha256, reader: data.reader, recordingFootersVerified: true,
    streamCounts: data.streams.map(s => ({ name: s.name, sampleCount: s.sampleCount })),
    actualLslSpanSeconds: primary.timestamps.at(-1) - primary.timestamps[0], affectCadence: cadence, result };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, "Supply an independent XDF export and new reconstruction output path.");
  const receipt = await reconstructInformationXdf(JSON.parse(await readFile(input, "utf8")));
  await writeFile(output, JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(`XDF alone reconstructed source, ${receipt.result.plan.steps.length} occurrences, ${receipt.result.records.filter(r => r.kind === "responses").length} response records and outcome.`);
}

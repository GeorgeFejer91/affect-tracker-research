// This accepts only independent XDF export; no producer JSON or sidecar input.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { inspectInformationStream } from "../../runner/src/information-stream.js";
const [input, output] = process.argv.slice(2);
assert.ok(input && output, "Supply an independent XDF export and new reconstruction output path.");
const data = JSON.parse(await readFile(input, "utf8"));
assert.equal(data.schema, "affect-runner-independent-xdf-export"); assert.equal(data.version, 1);
assert.equal(data.reader.name, "pyxdf"); assert.equal(data.reader.synchronizeClocks, false); assert.equal(data.reader.dejitterTimestamps, false);
const primary = data.streams[data.primaryStreamIndex];
assert.equal(primary.channelCount, 1); assert.equal(primary.samples.length, primary.timestamps.length);
const samples = primary.samples.map((value, i) => ({ value: value[0], timestamp: primary.timestamps[i] }));
const result = await inspectInformationStream(samples);
assert.equal(result.status, "complete", JSON.stringify(result.issues));
assert.equal(primary.name, result.startup.effectiveLsl.markerStream);
const affect = data.streams.find(s => s.name === result.startup.effectiveLsl.stateStream);
assert.ok(affect); assert.equal(affect.channelCount, 8);
for (const stream of data.streams) { assert.equal(stream.footerVerified, true); assert.equal(stream.sampleCount, stream.samples.length); }
assert.ok(affect.timestamps.every(t => t >= result.records[0].commitLslTimeSeconds && t <= result.records.at(-1).firstLslTimeSeconds), "Affect samples must follow startup commit and precede terminal outcome");
await writeFile(output, JSON.stringify({ schema: "affect-runner-xdf-only-reconstruction", version: 1,
  claim: "Production information outlets and XDF recorder with synthetic responses/observations; no native media execution or timing qualification",
  xdfSha256: data.xdfSha256, reader: data.reader, recordingFootersVerified: true,
  streamCounts: data.streams.map(s => ({ name: s.name, sampleCount: s.sampleCount })),
  actualLslSpanSeconds: primary.timestamps.at(-1) - primary.timestamps[0], result }, null, 2), { flag: "wx" });
console.log(`XDF alone reconstructed source, ${result.plan.steps.length} occurrences, ${result.records.filter(r => r.kind === "responses").length} response records and outcome.`);

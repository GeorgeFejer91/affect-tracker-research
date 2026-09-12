// Consumes samples exported by an independent XDF reader; never executes media.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { inspectMasterStream } from "../../runner/src/master-stream.js";
const [samplesPath, receiptPath] = process.argv.slice(2);
assert.ok(samplesPath && receiptPath, "Supply independently exported marker samples and a new result path.");
const bytes = await readFile(samplesPath), samples = JSON.parse(bytes);
const result = await inspectMasterStream(samples);
assert.equal(result.status, "complete", JSON.stringify(result.issues));
assert.equal(result.occurrences.length, result.profile.executionProfile.entries.length);
const late = await inspectMasterStream(samples.slice(1)); assert.equal(late.status, "incomplete");
const missing = await inspectMasterStream(samples.filter((_, index) => index !== 3)); assert.notEqual(missing.status, "complete");
const reversed = structuredClone(samples); reversed[2].timestamp = reversed[1].timestamp - 1;
await assert.rejects(inspectMasterStream(reversed), /reversed/u);
await writeFile(receiptPath, JSON.stringify({schema:"affect-runner-master-recorded-stream-correspondence",version:1,
  claim:"Production outlets and recorder with synthetic lifecycle observations; no media execution or timing qualification",
  samplesSha256:createHash("sha256").update(bytes).digest("hex"),result,
  negativeChecks:["missing initial profile is incomplete","missing observation cannot complete","reversed LSL clock rejected"]},null,2),{flag:"wx"});
console.log(`${result.occurrences.length} recorded occurrences reconstructed from the marker stream; negative checks passed.`);

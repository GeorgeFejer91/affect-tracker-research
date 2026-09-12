// Read-only check against P5's owned producer in an isolated branch or after
// integration. Usage: node scripts/qualification/xr-feedback-interop.mjs <P5 module>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { resolveXrFeedbackFootprintV1 } from "../../site/src/research/xr-layout-feedback.js";

const producerPath = resolve(process.argv[2] ?? "site/src/research/feedback-envelope.js");
const producer = await import(pathToFileURL(producerPath));
const fixture = JSON.parse(await readFile(new URL("../../test/fixtures/xr-feedback-envelope-v1.json", import.meta.url), "utf8"));
for (const { profile, configuration, envelope, expected } of fixture.cases) {
  const actual = producer.resolveFeedbackEnvelopeV1(configuration, envelope.overlaySideCssPx);
  assert.deepEqual(actual, envelope);
  assert.deepEqual(resolveXrFeedbackFootprintV1(profile, actual), expected);
}
console.log(JSON.stringify({ pass: true, cases: fixture.cases.length, producerPath,
  producerSha256: createHash("sha256").update(await readFile(producerPath)).digest("hex") }));

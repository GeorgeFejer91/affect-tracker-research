// Consumes output produced by the actual native typed answer module's fixture
// hook. Values and elapsed times are explicitly synthetic engineering inputs.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { sha256Hex } from "../../site/src/research/canonical.js";
import { verifyFormDefinitionV1 } from "../../site/src/research/form-definition.js";
import { validateTypedResponseRows } from "../../runner/src/typed-responses.js";
const [input, output] = process.argv.slice(2); assert.ok(input && output);
const bytes = await readFile(input), fixture = JSON.parse(bytes);
assert.equal(fixture.schema, "affect-runner-typed-answer-engineering-fixture"); assert.equal(fixture.version, 1);
assert.deepEqual(fixture.forms.map(form => form.definition.language), ["en", "de"]);
const forms = [];
for (const form of fixture.forms) {
  const definition = await verifyFormDefinitionV1(form.definition);
  const result = validateTypedResponseRows(definition, form.responses, { submitted: form.submitted, monotonicMs: form.monotonicMs });
  assert.equal(result.complete, true); assert.deepEqual(result.responses, form.responses);
  forms.push({ language: definition.language, definitionSha256: definition.definitionSha256, result });
}
await writeFile(output, JSON.stringify({ schema: "affect-runner-typed-answer-correspondence", version: 1,
  claim: fixture.claim, nativeFixtureSha256: await sha256Hex(bytes), forms }, null, 2), { flag: "wx" });
console.log("Native EN/DE typed rows match the independent JS consumer with exact values, labels and calculated latencies.");

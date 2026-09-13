import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareFormSourceStorage } from "../site/src/research/form-source-storage.js";
import { sha256Hex } from "../site/src/research/canonical.js";

test("typed storage retains exact EN/DE JSON and independently binds file hash", async () => {
  for (const language of ["en", "de"]) {
    const bytes = new Uint8Array(await readFile(new URL(`./fixtures/demographics-${language}-form-v1.canonical.json`, import.meta.url)));
    const definition = JSON.parse(new TextDecoder().decode(bytes));
    const payload = await prepareFormSourceStorage(bytes, definition);
    assert.equal(payload.format, "json"); assert.equal(payload.familyId, "demographics");
    assert.equal(payload.languageTag, language); assert.deepEqual(payload.bytes, bytes);
    assert.equal(payload.sourceSha256, await sha256Hex(bytes));
    assert.notEqual(payload.sourceSha256, definition.definitionSha256);
    await assert.rejects(prepareFormSourceStorage(bytes.slice(0, -1), definition));
    const changed = structuredClone(definition); changed.title = "Changed";
    await assert.rejects(prepareFormSourceStorage(bytes, changed));
  }
});

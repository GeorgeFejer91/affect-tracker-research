import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APP_LOGO_CONCEPTS,
  buildAppLogoConcepts,
} from "../scripts/build-app-logo-concepts.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const conceptDirectory = path.join(repositoryRoot, "desktop", "icons", "concepts");

test("five deterministic app-logo concepts are checked in", async () => {
  const generated = buildAppLogoConcepts();
  const checkedInFiles = (await readdir(conceptDirectory))
    .filter((filename) => /^\d{2}-[a-z-]+\.svg$/.test(filename))
    .sort();

  assert.equal(APP_LOGO_CONCEPTS.length, 5);
  assert.equal(generated.size, 5);
  assert.deepEqual(checkedInFiles, [...generated.keys()]);

  for (const [filename, expected] of generated) {
    const actual = await readFile(path.join(conceptDirectory, filename), "utf8");
    assert.equal(actual, expected, `${filename} must match the deterministic generator`);
  }
});

test("each concept is a distinct, self-contained square SVG suitable for app-icon rendering", async () => {
  const generated = buildAppLogoConcepts();
  const digests = new Set();

  for (const [filename, svg] of generated) {
    assert.match(svg, /<svg\b[^>]*viewBox="0 0 1024 1024"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title id="title">Affect Research/);
    assert.match(svg, /<desc id="description">[^<]+<\/desc>/);
    assert.match(svg, /<path\b/);
    assert.doesNotMatch(svg, /<script\b|(?:href|src)="https?:|javascript:|<text\b|NaN|Infinity/i);
    assert.ok((svg.match(/<path\b/g) ?? []).length >= 2, `${filename} should contain layered Flubber geometry`);
    digests.add(createHash("sha256").update(svg).digest("hex"));
  }

  assert.equal(digests.size, 5, "all five concepts must be visually and structurally distinct");
});

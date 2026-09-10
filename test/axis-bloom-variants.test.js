import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AXIS_BLOOM_VARIANTS,
  buildAxisBloomVariants,
} from "../scripts/build-axis-bloom-variants.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "..");
const variantDirectory = path.join(
  repositoryRoot,
  "desktop",
  "icons",
  "concepts",
  "axis-bloom-variants",
);
const canonicalColors = ["#ffd166", "#5dffb0", "#5c7cfa", "#ff5b68"];

test("five deterministic Axis Bloom variants are checked in", async () => {
  const generated = buildAxisBloomVariants();
  const checkedInFiles = (await readdir(variantDirectory))
    .filter((filename) => /^axis-\d{2}-[a-z-]+\.svg$/.test(filename))
    .sort();

  assert.equal(AXIS_BLOOM_VARIANTS.length, 5);
  assert.equal(generated.size, 5);
  assert.deepEqual(checkedInFiles, [...generated.keys()]);

  for (const [filename, expected] of generated) {
    const actual = await readFile(path.join(variantDirectory, filename), "utf8");
    assert.equal(actual, expected, `${filename} must match the deterministic generator`);
  }
});

test("each Axis Bloom variant is distinct, portable, and retains the directional palette", async () => {
  const generated = buildAxisBloomVariants();
  const originalAxisBloom = await readFile(
    path.join(repositoryRoot, "desktop", "icons", "concepts", "03-axis-bloom.svg"),
    "utf8",
  );
  const originalDigest = createHash("sha256").update(originalAxisBloom).digest("hex");
  const digests = new Set();

  for (const [filename, svg] of generated) {
    assert.match(svg, /<svg\b[^>]*viewBox="0 0 1024 1024"/);
    assert.match(svg, /data-family="axis-bloom"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title id="title">Affect Research/);
    assert.match(svg, /<desc id="description">[^<]+<\/desc>/);
    assert.doesNotMatch(svg, /<script\b|<text\b|<image\b|<filter\b|<mask\b|mix-blend-mode|(?:href|src)="https?:|javascript:|NaN|Infinity/i);
    assert.ok((svg.match(/<path\b/g) ?? []).length >= 4, `${filename} should contain substantial vector geometry`);
    for (const color of canonicalColors) assert.match(svg, new RegExp(color, "i"));

    const digest = createHash("sha256").update(svg).digest("hex");
    assert.notEqual(digest, originalDigest, `${filename} must differ from the parent concept`);
    digests.add(digest);
  }

  assert.equal(digests.size, 5, "all five variants must be structurally distinct");
});

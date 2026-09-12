import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { projectSavedVariantCatalogue } from "../../site/src/research/variant-catalogue-adapter.js";
import { compileVariantTimeline, validateVariantDesign } from "../../site/src/research/variant-design.js";
import { createPlannedMarkerProfile } from "../../site/src/research/planned-marker-contract.js";

/** P3 assertions reusable by P7's full-master fixture. Expected entry times are
 * hand-specified in the fixture, never calculated by either compiler here. */
export async function assertVariantReproduction(workspace, contribution, recipeSha256, expected) {
  const { library, videos } = await projectSavedVariantCatalogue(workspace);
  await validateVariantDesign(contribution, library);
  assert.deepEqual(contribution.allocation, { kind: "runnerAssigned" });
  assert.deepEqual(contribution.variants.map(v => v.variantId), expected.map(v => v.variantId));
  const results = [];
  for (const [i, variant] of contribution.variants.entries()) {
    const planned = expected[i];
    assert.equal(variant.title, planned.title);
    assert.deepEqual(variant.entries, planned.entries.map(({ startMs: _start, endMs: _end, ...entry }) => entry));
    const timeline = compileVariantTimeline(contribution, variant.variantId, videos);
    assert.equal(timeline.plannedDurationMs, planned.entries.at(-1).endMs);
    assert.equal(timeline.versionSha256, variant.versionSha256);
    assert.deepEqual(timeline.events, planned.entries.flatMap((entry, position) => [
      { variantId: variant.variantId, entryId: entry.entryId, kind: entry.kind, referenceId: entry.referenceId,
        position: position + 1, eventId: `${entry.entryId}-start`, eventType: `${entry.kind}Start`, plannedOffsetMs: entry.startMs },
      { variantId: variant.variantId, entryId: entry.entryId, kind: entry.kind, referenceId: entry.referenceId,
        position: position + 1, eventId: `${entry.entryId}-end`, eventType: `${entry.kind}End`, plannedOffsetMs: entry.endMs },
    ]));
    const profile = await createPlannedMarkerProfile(contribution, variant.variantId, videos, recipeSha256);
    assert.equal(profile.recipeSha256, recipeSha256);
    assert.equal(profile.variantId, variant.variantId);
    assert.equal(profile.variantVersionSha256, variant.versionSha256);
    assert.deepEqual(profile.entries.map(entry => entry.entryId), planned.entries.map(entry => entry.entryId));
    const codebook = new Map(profile.codebook.map(source => [source.sourceCode, source]));
    assert.equal(codebook.size, profile.codebook.length);
    const references = new Map();
    for (const [j, entry] of planned.entries.entries()) {
      const sourceCode = profile.entries[j].sourceCode, source = codebook.get(sourceCode);
      assert.ok(source, "every occurrence resolves through the embedded codebook");
      assert.equal(source.kind, entry.kind);
      assert.equal(source.durationMs, entry.endMs - entry.startMs);
      const reference = `${entry.kind}:${entry.referenceId}`;
      if (references.has(reference)) assert.equal(sourceCode, references.get(reference), "repeated sources retain one code");
      else {
        assert.ok(![...references.values()].includes(sourceCode), "distinct named sources cannot be merged");
        references.set(reference, sourceCode);
      }
      const identity = entry.kind === "video"
        ? contribution.version === 2
          ? createHash("sha256").update(JSON.stringify({ annotationId: entry.referenceId, assetId: entry.assetId })).digest("hex")
          : library.videos.find(video => video.annotationId === entry.referenceId).sha256
        : createHash("sha256").update(JSON.stringify({
          durationMs: entry.endMs - entry.startMs, isiId: entry.referenceId,
        })).digest("hex");
      assert.equal(source.identitySha256, identity);
    }
    assert.equal(codebook.size, references.size, "codebook has no unrelated entries");
    assert.doesNotMatch(JSON.stringify(profile), /relativePath|annotationId|\.mp4|participant/i);
    results.push({ timeline, profile });
  }
  return results;
}

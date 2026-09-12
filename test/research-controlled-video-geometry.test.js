import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { deriveControlledVideoDisplayGeometry, validateNativeDisplayMetadataV2, validateControlledVideoDisplayGeometry } from "../site/src/research/video-display-controlled.js";
import { createVideoCatalogueContributionV3, validateVideoCatalogueContributionV3, validateVideoCatalogueContribution,
  createSupportedVideoCatalogueProducer, validateVideoDisplayGeometry } from "../site/src/research/video-catalogue-contribution.js";
import { createWorkspaceContributionV3, validateWorkspaceContributionV3, validateWorkspaceContribution } from "../site/src/research/workspace-contribution.js";
import { createLocationVariantLibrary, createLocationVariantLibraryV3, validateVariantLibrary } from "../site/src/research/variant-library.js";
const old = JSON.parse(await readFile(new URL("./fixtures/research-video-catalogue-contribution-v2.json", import.meta.url), "utf8"));
test("shared canonical vectors bind exact JS geometry and P1 bytes", async () => {
  const bytes = await readFile(new URL("./fixtures/controlled-video-geometry-v3.json", import.meta.url), "utf8"), fixture = JSON.parse(bytes);
  assert.equal(bytes, canonicalJson(fixture) + "\n");
  for (const vector of fixture.vectors) assert.deepEqual(deriveControlledVideoDisplayGeometry(vector.metadata), vector.geometry);
  assert.deepEqual(await validateWorkspaceContributionV3(fixture.workspace), fixture.workspace);
});
export const proof = () => ({ schema: "affect-research-native-display-metadata-receipt", version: 2,
  encodedWidthPx: 1920, encodedHeightPx: 1080, pixelAspectRatio: { numerator: 1, denominator: 1 },
  sourceOrientation: { stream: { status: "absent" }, media: { status: "absent" } },
  snapshotWidthPx: 1920, snapshotHeightPx: 1080, snapshotPixelAspectRatio: { numerator: 1, denominator: 1 },
  snapshotInterpretation: "pre-renderer-square-pixel",
  renderer: { sinkFactory: "d3d11videosink", configuredRotationDegrees: 0, readbackRotationDegrees: 0 } });
test("absent source remains absent; configured quarter turns apply exactly once", () => {
  const absent = deriveControlledVideoDisplayGeometry(proof());
  assert.equal(absent.rotationDegrees, 0); assert.deepEqual(absent.nativeDisplayMetadata.sourceOrientation.stream, { status: "absent" });
  for (const rotation of [0, 90, 180, 270]) {
    const p = proof(); p.sourceOrientation.stream = { status: "explicit", rotationDegrees: rotation };
    p.renderer.configuredRotationDegrees = rotation; p.renderer.readbackRotationDegrees = rotation;
    const g = deriveControlledVideoDisplayGeometry(p);
    assert.deepEqual([g.displayWidthPx, g.displayHeightPx], [90, 270].includes(rotation) ? [1080, 1920] : [1920, 1080]);
    assert.deepEqual(validateControlledVideoDisplayGeometry(g), g);
    assert.throws(() => validateVideoDisplayGeometry(g));
  }
});
test("malformed, conflicting, unsupported, unacknowledged and pre-rotated evidence rejects", () => {
  for (const change of [p => p.version = 1, p => p.extra = true, p => delete p.sourceOrientation.media,
    p => p.sourceOrientation.stream = { status: "malformed" }, p => p.sourceOrientation.stream.rotationDegrees = 0,
    p => p.sourceOrientation.stream = { status: "explicit", rotationDegrees: 45 },
    p => { p.sourceOrientation.stream = { status: "explicit", rotationDegrees: 90 }; p.sourceOrientation.media = { status: "explicit", rotationDegrees: 0 }; },
    p => p.renderer.sinkFactory = "autovideosink", p => p.renderer.readbackRotationDegrees = 90,
    p => p.snapshotPixelAspectRatio = { numerator: 2, denominator: 2 },
    p => p.encodedWidthPx = 32769, p => p.snapshotWidthPx = 1080,
    p => { p.sourceOrientation.stream = { status: "explicit", rotationDegrees: 90 }; p.renderer.configuredRotationDegrees = 90; p.renderer.readbackRotationDegrees = 90; p.snapshotWidthPx = 1080; p.snapshotHeightPx = 1920; }]) {
    const p = proof(); change(p); assert.throws(() => validateNativeDisplayMetadataV2(p));
  }
  const g = deriveControlledVideoDisplayGeometry(proof()); g.rotationDegrees = 180;
  assert.throws(() => validateControlledVideoDisplayGeometry(g));
});
test("catalogue3 retains proof in integrity while P3 identity stays geometry-free", async () => {
  const a = await createVideoCatalogueContributionV3({ revision: 1, entries: old.entries.map(e => ({ ...e, geometry: deriveControlledVideoDisplayGeometry(proof()) })) });
  const p = proof(); p.sourceOrientation.stream = { status: "explicit", rotationDegrees: 0 };
  const b = await createVideoCatalogueContributionV3({ revision: 1, entries: old.entries.map(e => ({ ...e, geometry: deriveControlledVideoDisplayGeometry(p) })) });
  assert.notEqual(a.integritySha256, b.integritySha256);
  assert.deepEqual(await validateVideoCatalogueContributionV3(a), a);
  await assert.rejects(validateVideoCatalogueContribution(a));
  const la = await createLocationVariantLibraryV3(a), lb = await createLocationVariantLibraryV3(b);
  assert.equal(la.integritySha256, lb.integritySha256);
  assert.equal(la.integritySha256, (await createLocationVariantLibrary(old)).integritySha256);
  assert.deepEqual(await validateVariantLibrary(la), la);
  await assert.rejects(createLocationVariantLibrary(a));
  const workspace = createWorkspaceContributionV3({ study: { schema: "affect-research-study-identity", version: 1, id: "controlled", title: "Controlled" }, videoCatalogue: a });
  assert.deepEqual(await validateWorkspaceContributionV3(workspace), workspace);
  await assert.rejects(validateWorkspaceContribution(workspace));
  const producer = createSupportedVideoCatalogueProducer(); await producer.replaceEntries(a.entries);
  assert.equal(producer.getSnapshot().contribution.version, 3);
  assert.equal(canonicalJson(producer.getSnapshot().contribution), canonicalJson(a));
});

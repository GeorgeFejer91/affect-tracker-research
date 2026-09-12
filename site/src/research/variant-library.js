import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { validateVideoLibrary } from "./stimulus-order.js";
import { validateVideoCatalogueContribution } from "./video-catalogue-contribution.js";

/** Explicit P1 v2 -> P3 view. The catalogue remains P1-owned; this derived
 * library is internal editor data, never a second persisted media authority. */
export async function createLocationVariantLibrary(catalogue) {
  const source = await validateVideoCatalogueContribution(catalogue);
  if (source.version !== 2) throw new TypeError("Location references require the version 2 video catalogue.");
  const videos = source.entries.map(entry => ({
    annotationId: entry.annotationId, assetId: entry.assetId,
    relativePath: entry.packageRelativePath, sha256: entry.sha256,
    byteLength: entry.byteLength, durationMs: entry.durationMs,
  }));
  const core = { schema: "affect-research-video-library", version: 2, videos };
  return { ...core, integritySha256: await canonicalSha256(core), catalogue: source };
}

export async function validateVariantLibrary(library) {
  if (library?.version === 1) return validateVideoLibrary(library);
  const expected = await createLocationVariantLibrary(library?.catalogue);
  if (canonicalJson(library) !== canonicalJson(expected)) throw new TypeError("Video location identities or library integrity do not match Segment 1.");
  return expected;
}

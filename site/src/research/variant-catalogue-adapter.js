import { canonicalJson } from "./canonical.js";
import { createVideoLibrary } from "./stimulus-order.js";
import { validateVideoCatalogueContributionV1 } from "./video-catalogue-contribution.js";
import { compileVariantTimeline, validateVariantDesign } from "./variant-design.js";

const SNAPSHOT_KEYS = ["revision", "enabled", "pending", "contribution", "dependencyRevisions"];

export function normalizeVariantCatalogueSource(snapshot) {
  if (!snapshot || Object.keys(snapshot).length !== SNAPSHOT_KEYS.length
    || SNAPSHOT_KEYS.some(key => !Object.hasOwn(snapshot, key))
    || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || typeof snapshot.enabled !== "boolean" || typeof snapshot.pending !== "boolean"
    || (snapshot.contribution !== null && (typeof snapshot.contribution !== "object" || Array.isArray(snapshot.contribution)))
    || !Array.isArray(snapshot.dependencyRevisions) || snapshot.dependencyRevisions.length !== 0) {
    throw new TypeError("Invalid Segment 1 contribution snapshot.");
  }
  return JSON.parse(canonicalJson(snapshot));
}

/** Explicit P1 contribution v1 -> P3 library/reference v1 compatibility adapter.
 * Stored P3 IDs are never rewritten to a different identity scheme. */
export async function projectVariantCatalogue(snapshot) {
  snapshot = normalizeVariantCatalogueSource(snapshot);
  if (!snapshot.enabled || snapshot.pending || !snapshot.contribution) {
    throw new TypeError("Segment 1 requires an accepted, current video catalogue.");
  }
  const catalogue = await validateVideoCatalogueContributionV1(snapshot.contribution);
  const aliases = new Set(), identities = new Map();
  for (const entry of catalogue.entries) {
    if (aliases.has(entry.annotationId)) throw new TypeError("Segment 1 video annotation aliases are ambiguous.");
    aliases.add(entry.annotationId);
    const identity = { relativePath: entry.packageRelativePath, sha256: entry.sha256, byteLength: entry.byteLength };
    identities.set(canonicalJson(identity), entry);
  }
  const library = await createVideoLibrary(catalogue.entries.map(entry => ({
    relativePath: entry.packageRelativePath, sha256: entry.sha256, byteLength: entry.byteLength,
  })));
  const videos = library.videos.map(video => {
    const { annotationId: _annotationId, ...identity } = video;
    const entry = identities.get(canonicalJson(identity));
    if (!entry) throw new TypeError("The Segment 1 identity projection is incomplete.");
    return { ...video, assetId: entry.assetId, durationMs: entry.durationMs };
  });
  return { revision: snapshot.revision, sourceIntegritySha256: catalogue.integritySha256, library, videos };
}

/** P7 registration validator: domain validation, including the actual P1
 * duration dependency, completes before P7 accepts the five-key snapshot. */
export async function validateStimulusVariantContribution(contribution, { dependencies } = {}) {
  const projection = await projectVariantCatalogue(dependencies?.P1);
  const accepted = await validateVariantDesign(contribution, projection.library);
  for (const variant of accepted.variants) compileVariantTimeline(accepted, variant.variantId, projection.videos);
  return true;
}

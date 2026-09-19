import { canonicalJson } from "./canonical.js";

/** P3 v1 references are annotationId. Other identity schemes need an explicit
 * validated projection; neither timing nor markers guesses a fallback alias. */
export function indexVariantVideos(videos, maximumAnnotationBytes = 160) {
  if (!Array.isArray(videos) || videos.length > 10000) throw new TypeError("Invalid Segment 1 video projection.");
  const index = new Map();
  for (const video of videos) {
    if (!video || typeof video.annotationId !== "string" || !video.annotationId
      || new TextEncoder().encode(video.annotationId).length > maximumAnnotationBytes || /[\p{Cc}\p{Cf}]/u.test(video.annotationId)
      || index.has(video.annotationId)) throw new TypeError("Segment 1 must supply unique explicit annotationId references for P3.");
    index.set(video.annotationId, video);
  }
  return index;
}

export function normalizeVariantCatalogue(snapshot) {
  if (snapshot === null) return null;
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new TypeError("Invalid Segment 1 catalogue snapshot.");
  indexVariantVideos(snapshot.videos, snapshot.library?.version === 2 ? 6144 : 160);
  // Validate JSON before cloning and compare its entire content, not a caller's
  // claimed revision or fingerprint alone.
  canonicalJson(snapshot);
  return structuredClone(snapshot);
}

export function validateVariantCatalogueLibrary(catalogue, library) {
  if (!catalogue) throw new TypeError("Confirm the video catalogue in Segment 1 first.");
  const videos = indexVariantVideos(catalogue.videos, library.version === 2 ? 6144 : 160);
  if (videos.size !== library.videos.length || library.videos.some(video => {
    const source = videos.get(video.annotationId);
    return !source || (library.version === 2 ? ["relativePath", "sha256", "byteLength", "assetId", "durationMs"] : ["relativePath", "sha256", "byteLength"]).some(key => source[key] !== video[key]);
  })) throw new TypeError("The Segment 1 catalogue does not match this video library. Confirm Segment 1 again.");
  return catalogue;
}

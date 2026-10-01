import { attestNativeGstCatalogue, attestNativeGstCatalogueV2 } from "../../site/src/research/native-media-catalogue.js";

export function masterUsesPreparedPlayback(recipe) {
  return [3, 4, 5].includes(recipe?.version)
    && recipe.segments?.P1?.videoCatalogue?.version === 4
    && recipe.segments.P1.videoCatalogue.entries.length > 0
    && recipe.segments.P1.videoCatalogue.entries.every(entry => entry.preparedPlayback?.strategy === "ffmpeg-browser-safe-mp4-v1"
      && entry.preparedPlayback.container === "mp4"
      && entry.preparedPlayback.videoCodec === "h264"
      && ["aac", "none"].includes(entry.preparedPlayback.audioCodec)
      && entry.preparedPlayback.pixelFormat === "yuv420p"
      && entry.preparedPlayback.fastStart === true
      && entry.preparedPlayback.packageRelativePath?.startsWith("assets/stimuli/")
      && entry.preparedPlayback.packageRelativePath.toLowerCase().endsWith(".mp4"));
}

// Fresh scans expose opaque IDs without locations. A mixed catalogue cannot
// safely choose an attestation version per location until native mapping exists.
// No ID reconstruction, geometry conversion or weaker proof fallback is allowed.
export async function attestMasterMedia({ recipe, stimuli, ...options }) {
  if (recipe.version === 1 || recipe.version === 2 || [4, 5].includes(recipe.version) && [1, 2].includes(recipe.segments.P1.version)) return attestNativeGstCatalogue({ stimuli, ...options });
  if (![3, 4, 5].includes(recipe.version) || ![3, 4].includes(recipe.segments.P1.videoCatalogue.version)) throw new Error("Expected a supported master media catalogue.");
  if (recipe.segments.P1.videoCatalogue.version === 4) {
    if (!masterUsesPreparedPlayback(recipe)) throw new Error("The master media catalogue has no prepared browser-safe playback asset.");
    return Object.freeze({ qualified: Object.freeze(stimuli ?? []), failures: Object.freeze([]) });
  }
  const kinds = new Set(recipe.segments.P1.videoCatalogue.entries.map(entry => Object.hasOwn(entry.geometry, "nativeDisplayMetadata") ? 2 : 1));
  if (kinds.size > 1) throw new Error("This experiment mixes historical and controlled video proofs. Native location mapping is required before it can run.");
  return (kinds.has(1) ? attestNativeGstCatalogue : attestNativeGstCatalogueV2)({ stimuli, ...options });
}

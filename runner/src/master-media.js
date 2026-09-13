import { attestNativeGstCatalogue, attestNativeGstCatalogueV2 } from "../../site/src/research/native-media-catalogue.js";

// Fresh scans expose opaque IDs without locations. A mixed catalogue cannot
// safely choose an attestation version per location until native mapping exists.
// No ID reconstruction, geometry conversion or weaker proof fallback is allowed.
export async function attestMasterMedia({ recipe, stimuli, ...options }) {
  if (recipe.version === 1 || recipe.version === 2 || recipe.version === 4 && [1, 2].includes(recipe.segments.P1.version)) return attestNativeGstCatalogue({ stimuli, ...options });
  if (![3, 4].includes(recipe.version) || recipe.segments.P1.videoCatalogue.version !== 3) throw new Error("Expected a supported master media catalogue.");
  const kinds = new Set(recipe.segments.P1.videoCatalogue.entries.map(entry => Object.hasOwn(entry.geometry, "nativeDisplayMetadata") ? 2 : 1));
  if (kinds.size > 1) throw new Error("This experiment mixes historical and controlled video proofs. Native location mapping is required before it can run.");
  return (kinds.has(1) ? attestNativeGstCatalogue : attestNativeGstCatalogueV2)({ stimuli, ...options });
}

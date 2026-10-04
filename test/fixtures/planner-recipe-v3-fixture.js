import { readFile } from "node:fs/promises";
import { canonicalSha256 } from "../../site/src/research/canonical.js";

// Synthetic HTML-video geometry, not a playback qualification receipt.
export async function controlledCore(name = "locations", differentRevision = false) {
  const legacy = JSON.parse(await readFile(new URL(`./planner-recipe-v2-${name}.canonical.json`, import.meta.url), "utf8"));
  const { integrity, ...core } = structuredClone(legacy);
  core.version = 3;
  core.recipeId = `html-master-${name}`;
  core.segments.P1.version = 3;
  const catalogue = core.segments.P1.videoCatalogue;
  catalogue.version = 3;
  if (differentRevision) catalogue.revision += 1;
  const { integritySha256, ...catalogueCore } = catalogue;
  catalogue.integritySha256 = await canonicalSha256(catalogueCore);
  return { core, legacy };
}

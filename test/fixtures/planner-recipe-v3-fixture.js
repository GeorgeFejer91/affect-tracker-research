import { readFile } from "node:fs/promises";
import { canonicalSha256 } from "../../experiment-planner/web/src/research/canonical.js";
import { deriveControlledVideoDisplayGeometry, HTML_VIDEO_DISPLAY_METADATA_SCHEMA } from "../../experiment-planner/web/src/research/video-display-controlled.js";

// Synthetic contract fixture, not a native renderer receipt or qualification.
export async function controlledCore(name = "locations", explicit = false) {
  const legacy = JSON.parse(await readFile(new URL(`./planner-recipe-v2-${name}.canonical.json`, import.meta.url), "utf8"));
  const { integrity, ...core } = structuredClone(legacy);
  core.version = 3;
  core.recipeId = `controlled-master-${name}`;
  core.segments.P1.version = 3;
  const catalogue = core.segments.P1.videoCatalogue;
  catalogue.version = 3;
  for (const entry of catalogue.entries) {
    const width = entry.geometry.displayWidthPx, height = entry.geometry.displayHeightPx;
    const metadata = {
      schema: HTML_VIDEO_DISPLAY_METADATA_SCHEMA,
      version: 1,
      videoWidthPx: width,
      videoHeightPx: height,
      pixelAspectRatio: { numerator: 1, denominator: 1 },
      sourceOrientation: { stream: explicit ? { status: "explicit", rotationDegrees: 0 } : { status: "absent" }, media: { status: "absent" } },
    };
    entry.geometry = deriveControlledVideoDisplayGeometry(metadata);
  }
  const { integritySha256, ...catalogueCore } = catalogue;
  catalogue.integritySha256 = await canonicalSha256(catalogueCore);
  return { core, legacy };
}

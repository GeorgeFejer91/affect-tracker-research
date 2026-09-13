import { readFile } from "node:fs/promises";
import { canonicalSha256 } from "../../site/src/research/canonical.js";

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
      schema: "affect-research-native-display-metadata-receipt", version: 2,
      encodedWidthPx: width, encodedHeightPx: height, pixelAspectRatio: { numerator: 1, denominator: 1 },
      sourceOrientation: { stream: explicit ? { status: "explicit", rotationDegrees: 0 } : { status: "absent" }, media: { status: "absent" } },
      snapshotWidthPx: width, snapshotHeightPx: height, snapshotPixelAspectRatio: { numerator: 1, denominator: 1 },
      snapshotInterpretation: "pre-renderer-square-pixel",
      renderer: { sinkFactory: "d3d11videosink", configuredRotationDegrees: 0, readbackRotationDegrees: 0 },
    };
    entry.geometry = { status: "verified", source: "native-gstplay-controlled-renderer",
      displayWidthPx: width, displayHeightPx: height, displayAspect: entry.geometry.displayAspect,
      rotationDegrees: 0, pixelAspectRatio: { numerator: 1, denominator: 1 },
      metadataInterpretation: "controlled-renderer-and-pre-sink-square-pixel-snapshot", nativeDisplayMetadata: metadata };
  }
  const { integritySha256, ...catalogueCore } = catalogue;
  catalogue.integritySha256 = await canonicalSha256(catalogueCore);
  return { core, legacy };
}

import { canonicalJson } from "./canonical.js";

export const CONTROLLED_GEOMETRY_SOURCE = "html-video-controlled-renderer";
export const CONTROLLED_GEOMETRY_INTERPRETATION = "html-video-element-intrinsic-dimensions";
export const HTML_VIDEO_DISPLAY_METADATA_SCHEMA = "affect-research-html-video-display-metadata-receipt";
const rotations = [0, 90, 180, 270];
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new TypeError("HTML video metadata has missing or unknown fields.");
}
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError("HTML video metadata has invalid dimensions or ratio.");
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function ratio(value) {
  exact(value, ["numerator", "denominator"]);
  integer(value.numerator, 65535); integer(value.denominator, 65535);
  if (gcd(value.numerator, value.denominator) !== 1) throw new TypeError("HTML video ratio must be reduced.");
}
function sourceRotation(value) {
  if (value?.status === "absent") { exact(value, ["status"]); return null; }
  exact(value, ["status", "rotationDegrees"]);
  if (value.status !== "explicit" || !rotations.includes(value.rotationDegrees) || Object.is(value.rotationDegrees, -0)) throw new TypeError("Unsupported or malformed HTML video orientation.");
  return value.rotationDegrees;
}
export function validateHtmlVideoDisplayMetadataV1(value) {
  exact(value, ["schema", "version", "videoWidthPx", "videoHeightPx", "pixelAspectRatio", "sourceOrientation"]);
  if (value.schema !== HTML_VIDEO_DISPLAY_METADATA_SCHEMA || value.version !== 1) {
    throw new TypeError("Unsupported HTML video metadata contract.");
  }
  for (const n of [value.videoWidthPx, value.videoHeightPx]) integer(n, 32768);
  ratio(value.pixelAspectRatio);
  exact(value.sourceOrientation, ["stream", "media"]);
  const stream = sourceRotation(value.sourceOrientation.stream), media = sourceRotation(value.sourceOrientation.media);
  if (stream !== null && media !== null && stream !== media) throw new TypeError("HTML video orientation tags conflict.");
  return structuredClone(value);
}
export function deriveControlledVideoDisplayGeometry(value) {
  const proof = validateHtmlVideoDisplayMetadataV1(value);
  const stream = sourceRotation(proof.sourceOrientation.stream);
  const media = sourceRotation(proof.sourceOrientation.media);
  const rotationDegrees = stream ?? media ?? 0;
  const displayWidthPx = proof.videoWidthPx;
  const displayHeightPx = proof.videoHeightPx;
  const divisor = gcd(displayWidthPx, displayHeightPx);
  return { status: "verified", source: CONTROLLED_GEOMETRY_SOURCE, displayWidthPx, displayHeightPx,
    displayAspect: { numerator: displayWidthPx / divisor, denominator: displayHeightPx / divisor },
    rotationDegrees, pixelAspectRatio: structuredClone(proof.pixelAspectRatio),
    metadataInterpretation: CONTROLLED_GEOMETRY_INTERPRETATION, htmlVideoMetadata: proof };
}
export function validateControlledVideoDisplayGeometry(value) {
  const expected = deriveControlledVideoDisplayGeometry(value?.htmlVideoMetadata);
  if (canonicalJson(value) !== canonicalJson(expected)) throw new TypeError("Controlled display geometry does not match its complete metadata proof.");
  return expected;
}

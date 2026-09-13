import { canonicalJson } from "./canonical.js";

export const CONTROLLED_GEOMETRY_SOURCE = "native-gstplay-controlled-renderer";
export const CONTROLLED_GEOMETRY_INTERPRETATION = "controlled-renderer-and-pre-sink-square-pixel-snapshot";
const rotations = [0, 90, 180, 270];
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new TypeError("Controlled display metadata has missing or unknown fields.");
}
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError("Controlled display metadata has invalid dimensions or ratio.");
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function ratio(value) {
  exact(value, ["numerator", "denominator"]);
  integer(value.numerator, 65535); integer(value.denominator, 65535);
  if (gcd(value.numerator, value.denominator) !== 1) throw new TypeError("Controlled display ratio must be reduced.");
}
function sourceRotation(value) {
  if (value?.status === "absent") { exact(value, ["status"]); return null; }
  exact(value, ["status", "rotationDegrees"]);
  if (value.status !== "explicit" || !rotations.includes(value.rotationDegrees) || Object.is(value.rotationDegrees, -0)) throw new TypeError("Unsupported or malformed source orientation.");
  return value.rotationDegrees;
}
export function validateNativeDisplayMetadataV2(value) {
  exact(value, ["schema", "version", "encodedWidthPx", "encodedHeightPx", "pixelAspectRatio", "sourceOrientation",
    "snapshotWidthPx", "snapshotHeightPx", "snapshotPixelAspectRatio", "snapshotInterpretation", "renderer"]);
  if (value.schema !== "affect-research-native-display-metadata-receipt" || value.version !== 2
    || value.snapshotInterpretation !== "pre-renderer-square-pixel") throw new TypeError("Unsupported controlled display metadata contract.");
  for (const n of [value.encodedWidthPx, value.encodedHeightPx, value.snapshotWidthPx, value.snapshotHeightPx]) integer(n, 32768);
  ratio(value.pixelAspectRatio); ratio(value.snapshotPixelAspectRatio);
  if (value.snapshotPixelAspectRatio.numerator !== 1 || value.snapshotPixelAspectRatio.denominator !== 1) throw new TypeError("Pre-renderer snapshot must have square pixels.");
  exact(value.sourceOrientation, ["stream", "media"]);
  const stream = sourceRotation(value.sourceOrientation.stream), media = sourceRotation(value.sourceOrientation.media);
  if (stream !== null && media !== null && stream !== media) throw new TypeError("Source orientation tags conflict.");
  exact(value.renderer, ["sinkFactory", "configuredRotationDegrees", "readbackRotationDegrees"]);
  const selected = stream ?? media ?? 0;
  if (value.renderer.sinkFactory !== "d3d11videosink" || value.renderer.configuredRotationDegrees !== selected
    || value.renderer.readbackRotationDegrees !== selected || Object.is(value.renderer.configuredRotationDegrees, -0)
    || Object.is(value.renderer.readbackRotationDegrees, -0)) throw new TypeError("Controlled sink rotation does not match explicit policy and readback.");
  // Inputs are bounded so cross products remain exactly representable integers.
  if (value.snapshotWidthPx * value.encodedHeightPx * value.pixelAspectRatio.denominator
    !== value.snapshotHeightPx * value.encodedWidthPx * value.pixelAspectRatio.numerator) throw new TypeError("Pre-renderer snapshot caps disagree with source aspect.");
  return structuredClone(value);
}
export function deriveControlledVideoDisplayGeometry(value) {
  const proof = validateNativeDisplayMetadataV2(value), rotationDegrees = proof.renderer.configuredRotationDegrees;
  const swap = rotationDegrees === 90 || rotationDegrees === 270;
  const displayWidthPx = swap ? proof.snapshotHeightPx : proof.snapshotWidthPx;
  const displayHeightPx = swap ? proof.snapshotWidthPx : proof.snapshotHeightPx;
  const divisor = gcd(displayWidthPx, displayHeightPx);
  return { status: "verified", source: CONTROLLED_GEOMETRY_SOURCE, displayWidthPx, displayHeightPx,
    displayAspect: { numerator: displayWidthPx / divisor, denominator: displayHeightPx / divisor },
    rotationDegrees, pixelAspectRatio: structuredClone(proof.pixelAspectRatio),
    metadataInterpretation: CONTROLLED_GEOMETRY_INTERPRETATION, nativeDisplayMetadata: proof };
}
export function validateControlledVideoDisplayGeometry(value) {
  const expected = deriveControlledVideoDisplayGeometry(value?.nativeDisplayMetadata);
  if (canonicalJson(value) !== canonicalJson(expected)) throw new TypeError("Controlled display geometry does not match its complete metadata proof.");
  return expected;
}

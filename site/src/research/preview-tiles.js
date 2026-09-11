// Transient Setup geometry only; never an input-binding or package contract.
export const DEFAULT_PREVIEW_TILE_COUNT = 21;
export const MAX_PREVIEW_TILE_COUNT = 2001;

export function parsePreviewTileCount(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 3 && count <= MAX_PREVIEW_TILE_COUNT && count % 2 === 1
    ? count : null;
}

export function previewTileIndex(value, count) {
  const half = (count - 1) / 2;
  const coordinate = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return half + Math.sign(coordinate) * Math.round(Math.abs(coordinate) * half);
}

export function snapPreviewCoordinate(value, count) {
  return (previewTileIndex(value, count) - (count - 1) / 2) * 2 / (count - 1);
}

export function previewTileGeometry(x, y, count) {
  const size = 100 / count;
  const column = previewTileIndex(x, count);
  const row = count - 1 - previewTileIndex(y, count);
  return { x: column * size, y: row * size, width: size, height: size, column, row };
}

export function previewTileLines(count) {
  const validCount = parsePreviewTileCount(count);
  if (validCount === null) throw new RangeError("Preview grid needs an odd tile count from 3 to 2001.");
  return Array.from({ length: validCount - 1 }, (_, index) => {
    const position = (index + 1) * 100 / validCount;
    return `M${position} 0V100M0 ${position}H100`;
  }).join("");
}

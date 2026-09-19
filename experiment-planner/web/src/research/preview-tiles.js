// Transient Setup geometry only; never an input-binding or package contract.
export const DEFAULT_PREVIEW_TILE_COUNT = 21;
export const MAX_PREVIEW_TILE_COUNT = 2001;

export function parsePreviewTileCount(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 3 && count <= MAX_PREVIEW_TILE_COUNT && count % 2 === 1
    ? count : null;
}

export function parsePreviewSteps(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const steps = Number(value);
  return Number.isInteger(steps) && steps >= 1 && steps <= (MAX_PREVIEW_TILE_COUNT - 1) / 2 ? steps : null;
}

export function parsePreviewGrid({ mode, steps, columns, rows }) {
  const side = parsePreviewSteps(steps);
  const tileCount = mode === "custom" ? parsePreviewTileCount(columns) : side === null ? null : 2 * side + 1;
  const tileRows = mode === "custom" ? parsePreviewTileCount(rows) : tileCount;
  return tileCount === null || tileRows === null ? null : { tileCount, tileRows };
}

export function previewTileIndex(value, count) {
  const half = (count - 1) / 2;
  const coordinate = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return half + Math.sign(coordinate) * Math.round(Math.abs(coordinate) * half);
}

export function snapPreviewCoordinate(value, count) {
  return (previewTileIndex(value, count) - (count - 1) / 2) * 2 / (count - 1);
}

export function previewTileGeometry(x, y, count, rows = count) {
  const width = 100 / count;
  const height = 100 / rows;
  const column = previewTileIndex(x, count);
  const row = rows - 1 - previewTileIndex(y, rows);
  return { x: column * width, y: row * height, width, height, column, row };
}

export function previewTileLines(count, rows = count) {
  const validCount = parsePreviewTileCount(count);
  const validRows = parsePreviewTileCount(rows);
  if (validCount === null || validRows === null) throw new RangeError("Preview grid needs odd dimensions from 3 to 2001.");
  return Array.from({ length: validCount - 1 }, (_, index) => `M${(index + 1) * 100 / validCount} 0V100`).join("")
    + Array.from({ length: validRows - 1 }, (_, index) => `M0 ${(index + 1) * 100 / validRows}H100`).join("");
}

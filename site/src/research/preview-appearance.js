import { affectPaletteColor } from "../math.js";

export const PREVIEW_GREY = "#b7b7b7";
export const PREVIEW_ANCHORS = Object.freeze(["up", "right", "down", "left"]);
export const CORNER_LABELS = Object.freeze({ up: "Upper left", right: "Upper right", down: "Lower right", left: "Lower left" });
export const MAX_RENDERED_HALO_PERCENT = 10000;

export function parsePreviewNumber(value, minimum = 0) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : null;
}

export function randomPreviewAnchors(randomBytes = bytes => globalThis.crypto.getRandomValues(bytes)) {
  const bytes = randomBytes(new Uint8Array(12));
  return Object.fromEntries(PREVIEW_ANCHORS.map((id, index) => [id,
    `#${[...bytes.slice(index * 3, index * 3 + 3)].map(value => value.toString(16).padStart(2, "0")).join("")}`]));
}

export function previewPaletteColor(x, y, colors, mode = "axes", saturation) {
  if (mode !== "corners") return affectPaletteColor(x, y, colors, saturation);
  const u = Math.max(0, Math.min(1, (x + 1) / 2)), v = Math.max(0, Math.min(1, (y + 1) / 2));
  const weights = { up: (1 - u) * v, right: u * v, down: u * (1 - v), left: (1 - u) * (1 - v) };
  const amount = Math.max(0, Math.min(1, saturation ?? 1));
  const result = [1, 3, 5].map(offset => {
    const value = PREVIEW_ANCHORS.reduce((sum, id) => sum + parseInt(colors[id].slice(offset, offset + 2), 16) * weights[id], 0);
    return Math.round(183 + (value - 183) * amount);
  });
  return `rgb(${result.join(" ")})`;
}

/** Playground 2023af03: local 21 × 21 synthetic portrait atlases. */
import catalogue from "../../assets/affect-face/photo-atlas-packs-v1.json" with { type: "json" };

export const FACE_ATLAS_SIZE = 21;
const urls = Object.freeze({
  "photo-reference-v3": new URL("../../assets/affect-face/affect-face-atlas-v3.webp", import.meta.url),
  "photo-synthetic-01": new URL("../../assets/affect-face/packs/photo-synthetic-01/atlas-v1.webp", import.meta.url),
  "photo-synthetic-02": new URL("../../assets/affect-face/packs/photo-synthetic-02/atlas-v1.webp", import.meta.url),
  "photo-synthetic-03": new URL("../../assets/affect-face/packs/photo-synthetic-03/atlas-v1.webp", import.meta.url),
  "photo-synthetic-04": new URL("../../assets/affect-face/packs/photo-synthetic-04/atlas-v1.webp", import.meta.url),
  "photo-synthetic-05": new URL("../../assets/affect-face/packs/photo-synthetic-05/atlas-v1.webp", import.meta.url),
  "photo-synthetic-06": new URL("../../assets/affect-face/packs/photo-synthetic-06/atlas-v1.webp", import.meta.url),
  "photo-synthetic-07": new URL("../../assets/affect-face/packs/photo-synthetic-07/atlas-v1.webp", import.meta.url),
  "photo-synthetic-08": new URL("../../assets/affect-face/packs/photo-synthetic-08/atlas-v1.webp", import.meta.url),
});

export function faceAtlasBlend(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -1 || x > 1 || y < -1 || y > 1) {
    throw new RangeError("Face coordinates must be within [-1, 1].");
  }
  const col = (x + 1) * 10, row = (1 - y) * 10;
  const left = Math.floor(col), top = Math.floor(row);
  const right = Math.ceil(col), bottom = Math.ceil(row);
  const dx = col - left, dy = row - top;
  const tiles = [
    { column: left, row: top, weight: (1 - dx) * (1 - dy) },
    { column: right, row: top, weight: dx * (1 - dy) },
    { column: left, row: bottom, weight: (1 - dx) * dy },
    { column: right, row: bottom, weight: dx * dy },
  ];
  return tiles.filter(tile => tile.weight > 1e-12);
}

export function faceAtlasCatalogue() {
  if (catalogue.schema !== "affect-tracker-photo-atlas-catalog" || catalogue.version !== 1
    || catalogue.packs.length !== Object.keys(urls).length
    || catalogue.packs.some(pack => !Object.hasOwn(urls, pack.id) || !pack.available
      || pack.gridSize !== FACE_ATLAS_SIZE || !/^[0-9a-f]{64}$/u.test(pack.atlasSha256))) {
    throw new Error("Face catalogue is unsupported.");
  }
  return catalogue;
}

export function faceAtlasPack(id, sha256) {
  const pack = faceAtlasCatalogue().packs.find(item => item.id === id);
  if (!pack || (sha256 !== undefined && pack.atlasSha256 !== sha256)) {
    throw new Error("Saved face pack identity or hash is unsupported.");
  }
  return pack;
}

/** Catalogue prompt cues describe the asset's styling, never a person's identity. */
export function faceAtlasPickerLabel(pack) {
  faceAtlasPack(pack?.id, pack?.atlasSha256);
  if (pack.id === "photo-reference-v3") return "Original portrait";
  const number = String(faceAtlasCatalogue().packs.findIndex(item => item.id === pack.id) + 1).padStart(2, "0");
  const style = pack.presentationStyle === "androgynous-styling" ? "androgynous style"
    : pack.presentationStyle?.replace("-coded", " style");
  const region = pack.regionalDesignInspirations?.[0]?.split("-")
    .map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
  return `Preset ${number} · ${style}${region ? ` · ${region} inspiration` : ""}`;
}

/** Verify the selected local bytes before a Planner or Runner paints them. */
export async function loadFaceAtlas(pack) {
  if (!pack || !Object.hasOwn(urls, pack.id) || !/^[0-9a-f]{64}$/u.test(pack.atlasSha256)) {
    throw new Error("Face pack identity is unsupported.");
  }
  const response = await fetch(urls[pack.id]);
  if (!response.ok) throw new Error("Selected face pack is unavailable.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== pack.atlasBytes || !globalThis.crypto?.subtle) {
    throw new Error("Selected face pack cannot be verified.");
  }
  const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== pack.atlasSha256) throw new Error("Selected face pack differs from its catalogue hash.");
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  const image = new Image();
  try {
    image.src = objectUrl;
    await image.decode();
    if (image.naturalWidth !== FACE_ATLAS_SIZE * pack.tileSize
      || image.naturalHeight !== FACE_ATLAS_SIZE * pack.tileSize) {
      throw new Error("Selected face pack has unexpected geometry.");
    }
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Source-over would bias later cells; additive weights reproduce Playground. */
export function drawFaceAtlas(context, image, x, y, side) {
  if (!context || !image || !Number.isFinite(side) || side <= 0) throw new TypeError("Face canvas is unavailable.");
  const tileSize = image.naturalWidth / FACE_ATLAS_SIZE;
  context.save();
  try {
    context.clearRect(0, 0, side, side);
    context.globalCompositeOperation = "lighter";
    for (const tile of faceAtlasBlend(x, y)) {
      context.globalAlpha = tile.weight;
      context.drawImage(image, tile.column * tileSize, tile.row * tileSize,
        tileSize, tileSize, 0, 0, side, side);
    }
  } finally {
    context.restore();
  }
}

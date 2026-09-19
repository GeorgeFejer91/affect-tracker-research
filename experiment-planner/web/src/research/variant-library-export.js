import { createLocationVariantLibrary } from "./variant-library.js";
import { videoLibraryCsv } from "./stimulus-order.js";
import { videoLibraryWorkbook } from "./stimulus-workbook.js";

/** Pure export encoding. The adapter must first verify this catalogue against
 * the current owned workspace and fence concurrent edits/changes. */
export async function createLocationLibraryExport(catalogue, expectedLibrarySha256, format) {
  if (!["csv", "xlsx"].includes(format)) throw new TypeError("Choose CSV or Excel.");
  const library = await createLocationVariantLibrary(catalogue);
  if (library.integritySha256 !== expectedLibrarySha256) throw new TypeError("Video catalogue changed before export.");
  return format === "csv" ? new TextEncoder().encode(videoLibraryCsv(library)) : videoLibraryWorkbook(library);
}

// Developer fixture generator. Expected boundaries below are independently
// specified examples; never obtain them from the timeline/marker compiler.
import { readFile, writeFile } from "node:fs/promises";
import { projectSavedVariantCatalogue } from "../site/src/research/variant-catalogue-adapter.js";
import { addIsiDurations, createVariantDraft, createVariantDesign, pasteVariantTable } from "../site/src/research/variant-design.js";

const workspace = JSON.parse(await readFile(new URL("../test/fixtures/variant-workspace-binding-v1.json", import.meta.url))).initialSnapshot.contribution;
const { library } = await projectSavedVariantCatalogue(workspace);
const [a, b] = library.videos.map(video => video.annotationId);
const cases = [
  { variantId: "variant-3", title: "Repeated and interval edges", references: ["ISI1", "ISI2", a, a, "ISI3", b, "ISI4", "ISI1"],
    bounds: [[0, 0], [0, 500], [500, 12845], [12845, 25190], [25190, 25690], [25690, 49146], [49146, 50646], [50646, 50646]] },
  { variantId: "variant-1", title: "Reverse and terminal interval", references: [b, "ISI4", a, "ISI2"],
    bounds: [[0, 23456], [23456, 24956], [24956, 37301], [37301, 37801]] },
  { variantId: "variant-2", title: "Adjacent videos", references: [a, b, a],
    bounds: [[0, 12345], [12345, 35801], [35801, 48146]] },
];
const rows = Array.from({ length: 8 }, (_, row) => cases.map(item => item.references[row] ?? ""));
const draft = pasteVariantTable(addIsiDurations(createVariantDraft(), "0,500,500,1500,73"), 0, 0,
  rows.map(row => row.join("\t")).join("\n"), library);
draft.columns = cases.map(({ variantId, title }) => ({ variantId, title }));
// Non-contiguous IDs represent retained occurrences after earlier row editing.
draft.entryIds = rows.map((_, r) => cases.map(item => `${item.variantId}-entry-${11 + r * 2}`));
const contribution = await createVariantDesign(draft, library);
const expected = cases.map(item => ({
  variantId: item.variantId, title: item.title,
  entries: item.references.map((referenceId, i) => ({
    entryId: `${item.variantId}-entry-${11 + i * 2}`, referenceId,
    kind: referenceId.startsWith("ISI") ? "isi" : "video",
    startMs: item.bounds[i][0], endMs: item.bounds[i][1],
  })),
}));
await writeFile(new URL("../test/fixtures/variant-reproduction-v1.json", import.meta.url),
  `${JSON.stringify({ workspace, draft, contribution, expected }, null, 2)}\n`);

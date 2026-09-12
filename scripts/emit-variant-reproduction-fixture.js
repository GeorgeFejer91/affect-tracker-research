// Developer fixture generator. Expected boundaries below are independently
// specified examples; never obtain them from the timeline/marker compiler.
import { readFile, writeFile } from "node:fs/promises";
import { projectSavedVariantCatalogue } from "../site/src/research/variant-catalogue-adapter.js";
import { addIsiDurations, createVariantDraft, createVariantDesign, pasteVariantTable } from "../site/src/research/variant-design.js";
import { createVideoCatalogueContribution } from "../site/src/research/video-catalogue-contribution.js";
import { createWorkspaceContribution } from "../site/src/research/workspace-contribution.js";
import { assertVariantReproduction } from "../test/fixtures/assert-variant-reproduction.js";
import { sha256Hex } from "../site/src/research/canonical.js";
import { videoLibraryCsv } from "../site/src/research/stimulus-order.js";
import { videoLibraryWorkbook } from "../site/src/research/stimulus-workbook.js";

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

const locations = JSON.parse(await readFile(new URL("../test/fixtures/research-video-catalogue-contribution-v2.json", import.meta.url)));
const portrait = structuredClone(workspace.videoCatalogue.entries[1]);
portrait.annotationId = "session2_portrait.mp4";
const locationCatalogue = await createVideoCatalogueContribution({ revision: 4, entries: [...locations.entries, portrait] });
const locationWorkspace = createWorkspaceContribution({ study: workspace.study, videoCatalogue: locationCatalogue });
const { library: locationLibrary } = await projectSavedVariantCatalogue(locationWorkspace);
const locationDraft = structuredClone(draft), locationExpected = structuredClone(expected);
const replacements = new Map([[a, "session%5Fa_clip.mp4"], [b, "session2_portrait.mp4"]]);
locationDraft.rows = locationDraft.rows.map(row => row.map(cell => replacements.get(cell) ?? cell));
locationDraft.rows[1][2] = "session-a_clip.mp4";
for (const variant of locationExpected) for (const entry of variant.entries) {
  entry.referenceId = replacements.get(entry.referenceId) ?? entry.referenceId;
  if (entry.kind === "video") entry.assetId = locationLibrary.videos.find(video => video.annotationId === entry.referenceId).assetId;
}
locationExpected[2].entries[1].referenceId = "session-a_clip.mp4";
locationExpected[2].entries[1].assetId = locations.entries[1].assetId;
[[0, 12345], [12345, 24690], [24690, 37035]].forEach(([startMs, endMs], i) => Object.assign(locationExpected[2].entries[i], { startMs, endMs }));
const locationContribution = await createVariantDesign(locationDraft, locationLibrary);
await writeFile(new URL("../test/fixtures/variant-reproduction-v2.json", import.meta.url),
  `${JSON.stringify({ workspace: locationWorkspace, draft: locationDraft, contribution: locationContribution, expected: locationExpected }, null, 2)}\n`);

for (const [version, savedWorkspace, savedContribution, independentExpected, projectedLibrary] of [
  [1, workspace, contribution, expected, library],
  [2, locationWorkspace, locationContribution, locationExpected, locationLibrary],
]) {
  const projections = await assertVariantReproduction(savedWorkspace, savedContribution, "f".repeat(64), independentExpected);
  const csvSha256 = await sha256Hex(videoLibraryCsv(projectedLibrary));
  const xlsxSha256 = await sha256Hex(videoLibraryWorkbook(projectedLibrary));
  await writeFile(new URL(`../test/fixtures/variant-native-reproduction-v${version}.json`, import.meta.url),
    `${JSON.stringify({ projections, csvSha256, xlsxSha256 }, null, 2)}\n`);
}

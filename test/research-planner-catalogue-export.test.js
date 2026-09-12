import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareVerifiedCatalogueExport } from "../site/src/research/planner-catalogue-export.js";
import { createLocationLibraryExport } from "../site/src/research/variant-library-export.js";
const master = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-locations-current-v1.canonical.json", import.meta.url)));
function fixture() {
  let current = true;
  const snapshot = { revision: 3, enabled: true, pending: false, contribution: structuredClone(master.segments.P1), dependencyRevisions: [] };
  const media = { library: { videos: master.segments.P1.videoCatalogue.entries.map(entry => ({ relativePath: entry.packageRelativePath,
    sha256: entry.sha256, byteLength: entry.byteLength })) } };
  const payload = { catalogue: snapshot.contribution.videoCatalogue, librarySha256: master.segments.P3.librarySha256, format: "csv", bytes: new Uint8Array([1]) };
  return { snapshot, media, payload, cancel() { current = false; }, options: { getSnapshot: () => snapshot, readMedia: async () => media, isCurrent: () => current } };
}
test("current-media export regenerates CSV/XLSX and ignores caller workbook bytes", async () => {
  for (const format of ["csv", "xlsx"]) {
    const f = fixture(); f.payload.format = format;
    assert.deepEqual(await prepareVerifiedCatalogueExport(f.payload, f.options),
      await createLocationLibraryExport(f.payload.catalogue, f.payload.librarySha256, format));
  }
});
test("missing/added/changed media, stale snapshots and unknown formats cannot export", async () => {
  for (const change of [f => { f.snapshot.pending = true; }, f => { f.media.library.videos.pop(); },
    f => { f.media.library.videos.push(f.media.library.videos[0]); }, f => { f.media.library.videos[0].sha256 = "a".repeat(64); },
    f => { f.media.library.videos[0].byteLength++; }, f => { f.payload.format = "exe"; }, f => { f.payload.librarySha256 = "0".repeat(64); }]) {
    const f = fixture(); change(f); await assert.rejects(prepareVerifiedCatalogueExport(f.payload, f.options));
  }
  for (const change of [f => f.cancel(), f => { f.snapshot.revision++; }]) {
    const f = fixture(); f.options.readMedia = async () => { change(f); return f.media; };
    await assert.rejects(prepareVerifiedCatalogueExport(f.payload, f.options), /changed/u);
  }
});

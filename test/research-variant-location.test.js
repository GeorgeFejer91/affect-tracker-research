import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createVideoCatalogueContribution, videoAnnotationIdFromRelativePathV1 } from "../site/src/research/video-catalogue-contribution.js";
import { createWorkspaceContribution } from "../site/src/research/workspace-contribution.js";
import { projectSavedVariantCatalogue, projectVariantCatalogue } from "../site/src/research/variant-catalogue-adapter.js";
import { createVariantDesign, createVariantDraft, compileVariantTimeline, pasteVariantTable, validateVariantDesign, variantDesignToDraft } from "../site/src/research/variant-design.js";
import { createPlannedMarkerProfile } from "../site/src/research/planned-marker-contract.js";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { videoLibraryCsv, validateVideoLibrary } from "../site/src/research/stimulus-order.js";
import { validateVariantLibrary } from "../site/src/research/variant-library.js";
import { createLocationLibraryExport } from "../site/src/research/variant-library-export.js";
import { videoLibraryWorkbook } from "../site/src/research/stimulus-workbook.js";
import { parseSheetTable } from "../site/src/research/questionnaire-sheet.js";
import { assertVariantReproduction } from "./fixtures/assert-variant-reproduction.js";

const fixturePath = fileURLToPath(new URL("./fixtures/variant-reproduction-v2.json", import.meta.url));
const { workspace, draft, contribution, expected } = JSON.parse(await readFile(fixturePath, "utf8"));
const { library, videos } = await projectSavedVariantCatalogue(workspace);
const recipeHash = "f".repeat(64);
const snapshot = (revision, ready = true, content = workspace) => ({ revision, enabled: true, pending: !ready,
  contribution: ready ? structuredClone(content) : null, dependencyRevisions: [] });

test("location variant v2 retains exact pairs and distinguishes duplicate video bytes in marker profiles", async () => {
  assert.equal(contribution.version, 2);
  assert.equal(contribution.markerContract.version, 2);
  assert.equal(contribution.markerContract.sourceIdentity, "video-location-content-pair-sha256-v1");
  assert.deepEqual(await createVariantDesign(draft, library), contribution);
  const results = await assertVariantReproduction(workspace, contribution, recipeHash, expected);
  assert.deepEqual(results.map(result => result.timeline.plannedDurationMs), [50646, 37801, 37035]);
  const pair = contribution.variants[2].entries.slice(0, 2);
  assert.equal(pair[0].assetId, pair[1].assetId);
  assert.notEqual(pair[0].referenceId, pair[1].referenceId);
  assert.notEqual(results[2].profile.codebook[0].identitySha256, results[2].profile.codebook[1].identitySha256);
  await assert.rejects(validateVideoLibrary(library), "historical library reader cannot silently admit v2");
});

test("wrong content-location pairs and forged derived projections reject", async () => {
  const changed = structuredClone(contribution);
  changed.variants[0].entries[2].assetId = `asset-${"a".repeat(64)}`;
  await assert.rejects(validateVariantDesign(changed, library));
  assert.throws(() => compileVariantTimeline(changed, "variant-3", videos), /location and content/);
  await assert.rejects(createPlannedMarkerProfile(changed, "variant-3", videos, recipeHash), /location and content/);
  for (const mutate of [value => delete value.variants[0].entries[2].assetId,
    value => value.variants[0].entries[0].assetId = videos[0].assetId,
    value => value.version = 1, value => value.markerContract.version = 1]) {
    const invalid = structuredClone(contribution); mutate(invalid);
    await assert.rejects(validateVariantDesign(invalid, library));
  }
  const forged = structuredClone(library); forged.videos[0].assetId = `asset-${"e".repeat(64)}`;
  await assert.rejects(validateVariantLibrary(forged));
});

test("moving a location invalidates its old references and requires explicit table edits", async () => {
  const entries = structuredClone(workspace.videoCatalogue.entries);
  const moved = entries.find(entry => entry.annotationId === "session%5Fa_clip.mp4");
  const assetId = moved.assetId;
  moved.sourceRelativePath = "stimuli/moved/clip.mp4";
  moved.packageRelativePath = `assets/${moved.sourceRelativePath}`;
  moved.annotationId = videoAnnotationIdFromRelativePathV1(moved.sourceRelativePath);
  const nextCatalogue = await createVideoCatalogueContribution({ revision: 5, entries });
  const nextWorkspace = createWorkspaceContribution({ study: workspace.study, videoCatalogue: nextCatalogue });
  const next = await projectSavedVariantCatalogue(nextWorkspace);
  await assert.rejects(validateVariantDesign(contribution, next.library), /Unknown annotation/);
  const changed = variantDesignToDraft(contribution);
  changed.rows = changed.rows.map(row => row.map(cell => cell === "session%5Fa_clip.mp4" ? moved.annotationId : cell));
  const accepted = await createVariantDesign(changed, next.library);
  assert.equal(accepted.variants[0].entries[2].assetId, assetId);
  assert.equal(accepted.variants[0].entries[2].referenceId, "moved_clip.mp4");
  assert.deepEqual(accepted.variants.map(v => v.entries.map(e => e.entryId)), contribution.variants.map(v => v.entries.map(e => e.entryId)));
  assert.notEqual(accepted.integritySha256, contribution.integritySha256);
});

test("long, escaped and formula-leading location IDs survive CSV, XLSX and rectangular paste exactly", async () => {
  const paths = ["stimuli/=clip.mp4", "stimuli/+clip.mp4", "stimuli/@clip.mp4", "stimuli/-clip.mp4",
    "stimuli/a_b/a%b,clip.mp4", `stimuli/${Array.from({ length: 8 }, (_, i) => `${"_".repeat(200)}${i}`).join("/")}/clip.mp4`];
  const template = workspace.videoCatalogue.entries[0];
  const entries = paths.map(sourceRelativePath => ({ ...structuredClone(template), sourceRelativePath,
    packageRelativePath: `assets/${sourceRelativePath}`, annotationId: videoAnnotationIdFromRelativePathV1(sourceRelativePath) }));
  const current = createWorkspaceContribution({ study: workspace.study,
    videoCatalogue: await createVideoCatalogueContribution({ revision: 6, entries }) });
  const { library: projected } = await projectSavedVariantCatalogue(current);
  const csv = videoLibraryCsv(projected), csvRows = parseSheetTable(csv.slice(1), { delimiter: ",", maxCellCharacters: 6144 });
  const ids = csvRows.slice(1).map(row => row[0]);
  assert.deepEqual(ids, projected.videos.map(video => video.annotationId));
  assert.ok(ids.some(id => new TextEncoder().encode(id).length > 4000));
  const pasted = pasteVariantTable(createVariantDraft(), 0, 0, ids.join("\n"), projected);
  const result = await createVariantDesign(pasted, projected);
  assert.deepEqual(result.variants[0].entries.map(entry => entry.referenceId), ids);
  assert.deepEqual(await createVariantDesign(variantDesignToDraft(result), projected), result);
  // The deterministic writer uses uncompressed ZIP entries. Exact annotation
  // text is inspectable here; the separate reader fixture covers ZIP structure.
  const workbook = new TextDecoder().decode(videoLibraryWorkbook(projected));
  for (const id of ids) assert.ok(workbook.includes(id.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")));
  assert.doesNotMatch(workbook, /<f[ >]/);
});

test("location paste keeps bounded parser options and enforces its own UTF-8 byte limit", () => {
  assert.equal(parseSheetTable("x".repeat(4000))[0][0].length, 4000);
  assert.throws(() => parseSheetTable("x".repeat(4001)), /4000 characters/);
  assert.equal(parseSheetTable("x".repeat(4800), { maxCellCharacters: 6144 })[0][0].length, 4800);
  for (const maxCellCharacters of [0, -1, 6145, 1.5, NaN, Infinity, "6144", null]) {
    assert.throws(() => parseSheetTable("x", { maxCellCharacters }), /cell character limit/);
  }
  assert.throws(() => parseSheetTable("x".repeat(6145), { maxCellCharacters: 6144 }), /6144 characters/);
  const tooManyBytes = "é".repeat(3073);
  assert.equal(parseSheetTable(tooManyBytes, { maxCellCharacters: 6144 })[0][0], tooManyBytes);
  const unchanged = createVariantDraft();
  assert.throws(() => pasteVariantTable(unchanged, 0, 0, tooManyBytes,
    { version: 2, videos: [{ annotationId: tooManyBytes }] }), /Invalid cell/);
  assert.deepEqual(unchanged, createVariantDraft());
  assert.throws(() => pasteVariantTable(unchanged, 0, 0, "x".repeat(4001),
    { version: 1, videos: [] }), /4000 characters/);
});

test("location exports regenerate bytes from the validated catalogue and reject stale identity or format", async () => {
  assert.deepEqual(await createLocationLibraryExport(workspace.videoCatalogue, library.integritySha256, "csv"),
    new TextEncoder().encode(videoLibraryCsv(library)));
  assert.deepEqual(await createLocationLibraryExport(workspace.videoCatalogue, library.integritySha256, "xlsx"),
    videoLibraryWorkbook(library));
  await assert.rejects(createLocationLibraryExport(workspace.videoCatalogue, "e".repeat(64), "csv"), /changed/);
  await assert.rejects(createLocationLibraryExport(workspace.videoCatalogue, library.integritySha256, "xls"), /CSV or Excel/);
  const forged = structuredClone(workspace.videoCatalogue); forged.entries[0].annotationId = "wrong.mp4";
  await assert.rejects(createLocationLibraryExport(forged, library.integritySha256, "xlsx"));
});

test("v2 pending editable reopen, actual revision binding, and both download payloads retain P1 authority", async () => {
  const requests = [];
  const editor = createStimulusOrderEditor({ root: { querySelector: () => null, querySelectorAll: () => [] },
    operate: async (operation, payload) => { requests.push({ operation, payload }); } });
  try {
    await editor.restoreContent(contribution, { savedWorkspaceContribution: workspace, dependencies: { P1: snapshot(40, false) } });
    await assert.rejects(editor.prepareContribution());
    await editor.setCatalogueSource(snapshot(41));
    const prepared = await editor.prepareContribution();
    assert.deepEqual(prepared.contribution, contribution);
    assert.deepEqual(prepared.dependencyRevisions, [{ segment: "P1", revision: 41 }]);
    assert.equal(requests.length, 0);
    for (const format of ["csv", "xlsx"]) await editor.download(format);
    assert.equal(requests.length, 2);
    for (const { operation, payload } of requests) {
      assert.equal(operation, "export-library");
      assert.deepEqual(payload.catalogue, workspace.videoCatalogue);
      assert.equal(payload.librarySha256, library.integritySha256);
    }
    assert.deepEqual((await projectVariantCatalogue(snapshot(41))).library, library);
  } finally { editor.destroy(); }
});

test("location-pair fixtures reproduce independently without ambient settings or allocation", async () => {
  const invoke = promisify(execFile);
  const child = fileURLToPath(new URL("./fixtures/variant-reproduction-instance.js", import.meta.url));
  const receipts = await Promise.all(["UTC", "Pacific/Auckland"].map(TZ => invoke(process.execPath, [child, fixturePath], {
    env: { ...process.env, TZ }, maxBuffer: 1024 * 1024,
  })));
  assert.equal(receipts[0].stdout, receipts[1].stdout);
  for (const receipt of receipts) assert.equal(receipt.stderr, "");
  const result = JSON.parse(receipts[0].stdout);
  assert.deepEqual(result.forbidden, []);
  assert.equal(result.canonical, canonicalJson(contribution));
});

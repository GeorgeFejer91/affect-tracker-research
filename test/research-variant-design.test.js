import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createVideoLibrary } from "../site/src/research/stimulus-order.js";
import { addIsiDurations, addVariantColumn, addVariantRow, compileVariantTimeline, createVariantDraft, createVariantDocument, editIsi, migrateLegacyOrder, pasteVariantTable, removeIsi, validateVariantDesign, validateVariantDocument, variantDesignToDraft, videoColor, videoColorMap } from "../site/src/research/variant-design.js";

const { library, document, videos, timelines } = JSON.parse(await readFile(new URL("./fixtures/variant-design-v1.json", import.meta.url), "utf8"));
const [a, b] = library.videos.map(video => video.annotationId);
const fresh = () => structuredClone(document.draft);
test("named-ISI contribution and editable reopen retain exact versions, references and boundary times", async () => {
  assert.deepEqual(await createVariantDocument(fresh(), library), document);
  assert.deepEqual(await validateVariantDesign(document.contribution, library), document.contribution);
  for (const [i, variant] of document.contribution.variants.entries()) assert.deepEqual(compileVariantTimeline(document.contribution, variant.variantId, videos), timelines[i]);
  const reopened = await createVariantDocument(variantDesignToDraft(document.contribution), library);
  assert.equal(canonicalJson(reopened.contribution), canonicalJson(document.contribution));
  assert.deepEqual(document.contribution.allocation, { kind: "runnerAssigned" });
  assert.throws(() => compileVariantTimeline(document.contribution, "variant-1", library.videos), /Segment 1/);
});
test("dictionary names survive duration changes and deletions; duplicate durations remain separate", async () => {
  let draft = addIsiDurations(fresh(), "500, 0, 3600000");
  assert.deepEqual(draft.isiDefinitions.slice(-3).map(isi => isi.isiId), ["ISI4", "ISI5", "ISI6"]);
  assert.throws(() => removeIsi(draft, "ISI1"), /used/);
  draft = removeIsi(draft, "ISI4");
  draft = addIsiDurations(draft, "500");
  assert.equal(draft.isiDefinitions.at(-1).isiId, "ISI7");
  const changed = await createVariantDocument(editIsi(fresh(), "ISI1", 501), library);
  assert.notEqual(changed.contribution.variants[0].versionSha256, document.contribution.variants[0].versionSha256);
  assert.equal(changed.contribution.variants[1].versionSha256, document.contribution.variants[1].versionSha256);
  for (const value of ["", "500,", "1.5", "-1", "01", "1e3", "3600001", "NaN", "1,,2"]) assert.throws(() => addIsiDurations(fresh(), value));
});
test("explicit repeated videos and leading, consecutive, zero and terminal ISIs remain separate occurrences", async () => {
  let draft = addIsiDurations(createVariantDraft(), "0,500");
  draft = pasteVariantTable(draft, 0, 0, `ISI1\nISI2\n${a}\n${a}\nISI1`, library);
  const result = await createVariantDocument(draft, library), variant = result.contribution.variants[0];
  assert.deepEqual(variant.entries.map(entry => entry.kind), ["isi", "isi", "video", "video", "isi"]);
  assert.equal(new Set(variant.entries.map(entry => entry.entryId)).size, 5);
  const timeline = compileVariantTimeline(result.contribution, variant.variantId, videos);
  assert.equal(timeline.events.length, 10);
  assert.deepEqual(timeline.events.slice(0, 3).map(event => event.plannedOffsetMs), [0, 0, 0]);
  assert.equal(timeline.plannedDurationMs, 2500);
});
test("paste rejects unknown, numeric and formula cells atomically with precise locations", () => {
  const draft = fresh(), before = canonicalJson(draft);
  for (const source of [`${a}\t500`, "=SUM(A1)", "ISI999", "-1", "1.5"]) assert.throws(() => pasteVariantTable(draft, 0, 0, source, library), /Event 1/);
  assert.equal(canonicalJson(draft), before);
  const grown = pasteVariantTable(draft, 4, 1, `${a}\t${b}\nISI1\tISI2`, library);
  assert.equal(grown.columns.length, 3); assert.equal(grown.rows.length, 6);
  assert.deepEqual(grown.entryIds.slice(0, 5).map(row => row.slice(0, 2)), draft.entryIds);
});
test("invalid gaps, kinds, colliding identities, hashes and policy changes cannot confirm", async () => {
  let draft = fresh(); draft.rows[1][0] = "";
  await assert.rejects(createVariantDocument(draft, library), error => error.row === 1 && error.column === 0 && /Event 2/.test(error.message));
  const conflict = structuredClone(library); conflict.videos[0].annotationId = "ISI1";
  await assert.rejects(createVariantDocument(fresh(), conflict));
  for (const mutate of [v => v.contribution.variants[0].entries[0].kind = "isi", v => v.contribution.allocation.kind = "cyclicByOrdinal", v => v.draft.rows[1][0] = "500", v => v.contribution.markerContract.clock = "animationFrame", v => v.extra = true]) {
    const value = structuredClone(document); mutate(value); await assert.rejects(validateVariantDocument(value, library));
  }
  const changed = structuredClone(document.contribution); changed.variants[0].entries[0].kind = "isi";
  await assert.rejects(validateVariantDesign(changed, library));
});
test("video colors remain attached to identities across catalogue changes and beyond ten videos", async () => {
  const expanded = await createVideoLibrary(Array.from({ length: 80 }, (_, i) => ({ relativePath: `assets/stimuli/${i}.mp4`, sha256: i.toString(16).padStart(64, "0"), byteLength: i + 1 })));
  const colors = videoColorMap(expanded), reversed = videoColorMap({ videos: [...expanded.videos].reverse() });
  assert.equal(new Set(colors.values()).size, 80);
  for (const [id, color] of colors) {
    assert.equal(reversed.get(id), color);
    assert.equal(videoColorMap({ videos: [{ annotationId: id }] }).get(id), color);
  }
  const hue = id => Number(/hsl\(([\d.]+)/u.exec(videoColor(id))[1]);
  assert.ok(Math.abs(hue(a) - hue(b)) > 90, "the example pair has clearly separated hues");
  const hues = [...colors.keys()].map(hue);
  assert.ok(Math.max(...hues) - Math.min(...hues) > 200);
});
test("unrelated library additions preserve versions; row and column growth preserve occurrence IDs", async () => {
  const entries = library.videos.map(({ annotationId, ...entry }) => entry);
  const larger = await createVideoLibrary([...entries, { relativePath: "assets/stimuli/z.mp4", sha256: "c".repeat(64), byteLength: 30 }]);
  const result = await createVariantDocument(fresh(), larger);
  assert.deepEqual(result.contribution.variants, document.contribution.variants);
  const draft = addVariantColumn(addVariantRow(fresh()));
  assert.deepEqual(draft.entryIds.slice(0, 5).map(row => row.slice(0, 2)), fresh().entryIds);
  assert.equal(videoColor(a), videoColor(a)); assert.notEqual(videoColor(a), videoColor(b));
});
test("legacy numeric conversion is explicit and never mutates the historical source", async () => {
  const old = JSON.parse(await readFile(new URL("./fixtures/stimulus-order-v1.json", import.meta.url), "utf8"));
  const before = canonicalJson(old.design), draft = migrateLegacyOrder(old.design);
  assert.deepEqual(draft.rows[1], ["ISI1", "ISI2"]);
  assert.deepEqual(draft.isiDefinitions.map(isi => isi.durationMs), [500, 1500]);
  await createVariantDocument(draft, library);
  assert.equal(canonicalJson(old.design), before);
});

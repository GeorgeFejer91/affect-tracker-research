import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson, sha256Hex } from "../site/src/research/canonical.js";
import {
  createVideoLibrary, validateVideoLibrary, createStimulusOrder, pasteStimulusOrder,
  createStimulusOrderDocument, validateStimulusOrderDocument, resolveStimulusVariants,
  videoLibraryCsv, VIDEO_LIBRARY_FILE, STIMULUS_ORDER_FILE,
} from "../site/src/research/stimulus-order.js";
import { videoLibraryWorkbook } from "../site/src/research/stimulus-workbook.js";
import { BrowserResearchWorkspace } from "../site/src/research/workspace.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/stimulus-order-v1.json", import.meta.url), "utf8"));
const { library, design } = fixture;
const [a, b] = library.videos.map((video) => video.annotationId);
const draftOf = (value = design) => structuredClone({ columns: value.columns, rows: value.rows });

test("the two counterbalanced variants retain exact identities, 500/1500 ms intervals and stable version annotations", async () => {
  assert.deepEqual(await validateVideoLibrary(library), library);
  assert.deepEqual(await createStimulusOrderDocument(draftOf(), library), design);
  assert.deepEqual(design.variants.map(({ videos }) => videos), [
    [{ stimulusId: a, isiAfterMs: 500 }, { stimulusId: b, isiAfterMs: 0 }],
    [{ stimulusId: b, isiAfterMs: 1500 }, { stimulusId: a, isiAfterMs: 0 }],
  ]);
  assert.doesNotMatch(canonicalJson(design), /participant|assignment/i);
  const changed = draftOf(); changed.rows[1][0] = "750";
  const next = await createStimulusOrderDocument(changed, library);
  assert.equal(next.variants[0].variantId, design.variants[0].variantId);
  assert.notEqual(next.variants[0].versionSha256, design.variants[0].versionSha256);
  assert.equal(next.variants[1].versionSha256, design.variants[1].versionSha256);
  changed.columns[0].title = "Order A";
  assert.notEqual((await createStimulusOrderDocument(changed, library)).variants[0].versionSha256, next.variants[0].versionSha256);
});

test("library enumeration is deterministic and unrelated additions preserve a variant's version", async () => {
  const entries = library.videos.map(({ annotationId, ...entry }) => entry);
  assert.deepEqual(await createVideoLibrary(entries.toReversed()), library);
  const expanded = await createVideoLibrary([...entries, { relativePath: "assets/stimuli/third.mp4", sha256: "c".repeat(64), byteLength: 1 }]);
  assert.deepEqual((await createStimulusOrderDocument(draftOf(), expanded)).variants, design.variants);
  await assert.rejects(validateStimulusOrderDocument(design, expanded), /different library/);
  const changed = structuredClone(entries); changed[0].byteLength++;
  assert.notEqual((await createVideoLibrary(changed)).videos[0].annotationId, a);
  for (const path of ["../one.mp4", "assets/stimuli/../one.mp4", "assets/stimuli/a\\b.mp4", "assets/stimuli/\u202eone.mp4"]) {
    await assert.rejects(createVideoLibrary([{ ...entries[0], relativePath: path }]));
  }
  await assert.rejects(createVideoLibrary([entries[0], entries[0]]), /collide/);
});

test("Excel rectangles expand the table and invalid pastes are atomic", () => {
  const empty = createStimulusOrder(), before = structuredClone(empty);
  const pasted = pasteStimulusOrder(empty, 0, 0, `${a}\t${b}\r\n500\t1500\r\n${b}\t${a}\r\n`, library);
  assert.deepEqual(pasted, draftOf());
  assert.deepEqual(empty, before);
  const longer = pasteStimulusOrder(empty, 4, 0, `${a}\n500\n${b}`, library);
  assert.equal(longer.rows.length, 7);
  for (const source of [`${a}\t=SUM(A1)`, `${a}\tunknown`, "-500", "1.5", "3600001", "001", `"unterminated`, "Variant 1\tVariant 2", `Event 1\t${a}`]) {
    assert.throws(() => pasteStimulusOrder(empty, 0, 0, source, library));
    assert.deepEqual(empty, before);
  }
  assert.throws(() => pasteStimulusOrder(empty, 0, 0, Array(66).fill(a).join("\t"), library));
});

test("confirmation rejects gaps, leading or consecutive ISIs, duplicate videos and tampering", async () => {
  for (const rows of [["500", a], [a, "", b], [a, "500", "750", b], [a, a], [""], ["video-0000000000000000"]]) {
    assert.throws(() => resolveStimulusVariants({ columns: draftOf().columns.slice(0, 1), rows: rows.map((cell) => [cell]) }, library));
  }
  const terminal = { columns: draftOf().columns.slice(0, 1), rows: [[a], [b], ["3600000"], [""]] };
  assert.deepEqual(resolveStimulusVariants(terminal, library)[0].videos.map(({ isiAfterMs }) => isiAfterMs), [0, 3600000]);
  for (const modify of [value => value.variants[0].versionSha256 = "0".repeat(64), value => value.variants[0].videos[0].isiAfterMs = 999, value => value.participants = []]) {
    const changed = structuredClone(design); modify(changed);
    await assert.rejects(validateStimulusOrderDocument(changed, library));
  }
});

test("CSV and XLSX match the cross-runtime fixture; spreadsheet-like filenames stay text", async () => {
  assert.equal(await sha256Hex(videoLibraryCsv(library)), fixture.csvSha256);
  assert.equal(await sha256Hex(videoLibraryWorkbook(library)), fixture.xlsxSha256);
  const special = await createVideoLibrary([{ relativePath: "assets/stimuli/ =1+1.mp4", sha256: "a".repeat(64), byteLength: 1 }]);
  assert.match(videoLibraryCsv(special), /"' =1\+1.mp4"/);
  const workbook = new TextDecoder().decode(videoLibraryWorkbook(special));
  assert.match(workbook, /t="inlineStr"/);
  assert.doesNotMatch(workbook, /<f>|externalLink|vbaProject/);
});

const missing = () => Object.assign(new Error("Missing entry"), { name: "NotFoundError" });
class MemoryDirectory {
  kind = "directory"; children = new Map(); permission = "granted";
  constructor(name = "workspace") { this.name = name; }
  async queryPermission() { return this.permission; }
  async requestPermission() { return this.permission; }
  async isSameEntry(other) { return this === other; }
  async getDirectoryHandle(name, { create = false } = {}) {
    let entry = this.children.get(name);
    if (!entry && create) { entry = new MemoryDirectory(name); this.children.set(name, entry); }
    if (entry?.kind !== "directory") throw missing(); return entry;
  }
  async getFileHandle(name, { create = false } = {}) {
    let entry = this.children.get(name);
    if (!entry && create) {
      entry = { kind: "file", name, file: new File([], name), async getFile() { return this.file; }, async createWritable() {
        let content; const owner = this;
        return { async write(value) { content = value; }, async close() { owner.file = new File([content], name); }, async abort() {} };
      } }; this.children.set(name, entry);
    }
    if (entry?.kind !== "file") throw missing(); return entry;
  }
  async removeEntry(name) { if (!this.children.delete(name)) throw missing(); }
  async *entries() { yield* this.children.entries(); }
}
async function workspaceFixture() {
  const root = new MemoryDirectory(), workspace = new BrowserResearchWorkspace(root);
  await workspace.initialize();
  await workspace.importLibraryVideoFiles([new File(["one"], "one.mp4"), new File(["two"], "two.mp4")]);
  return { root, workspace, assets: root.children.get("assets"), videos: root.children.get("assets").children.get("stimuli") };
}

test("browser library confirmation and saved design round-trip beside the closed video folder", async () => {
  const { root, workspace, assets, videos } = await workspaceFixture();
  const receipt = await workspace.videoLibrary({ confirm: true });
  const ids = receipt.library.videos.map(v => v.annotationId);
  const order = await createStimulusOrderDocument(pasteStimulusOrder(createStimulusOrder(), 0, 0, `${ids[0]}\t${ids[1]}\n500\t1500\n${ids[1]}\t${ids[0]}`, receipt.library), receipt.library);
  assert.equal(videos.children.has(VIDEO_LIBRARY_FILE), false);
  assert.equal(assets.children.has(VIDEO_LIBRARY_FILE), true);
  assert.deepEqual((await workspace.saveStimulusOrder(order)).design, order);
  const reloaded = new BrowserResearchWorkspace(root); await reloaded.initialize();
  assert.deepEqual((await reloaded.videoLibrary({ confirm: true })).design, order);
  const savedBytes = await assets.children.get(STIMULUS_ORDER_FILE).file.text();
  videos.children.get("one.mp4").file = new File(["changed"], "one.mp4");
  await assert.rejects(workspace.saveStimulusOrder(order), /changed/);
  assert.equal(await assets.children.get(STIMULUS_ORDER_FILE).file.text(), savedBytes);
  assert.equal((await workspace.videoLibrary()).design, null);
});

test("unconfirmed, replaced, denied, noncanonical and nonvideo libraries fail closed", async () => {
  const { root, workspace, assets, videos } = await workspaceFixture();
  const receipt = await workspace.videoLibrary();
  const order = await createStimulusOrderDocument(pasteStimulusOrder(createStimulusOrder(), 0, 0, receipt.library.videos[0].annotationId, receipt.library), receipt.library);
  await assert.rejects(workspace.saveStimulusOrder(order));
  await workspace.videoLibrary({ confirm: true });
  const annotation = assets.children.get(VIDEO_LIBRARY_FILE);
  annotation.file = new File([JSON.stringify(receipt.library, null, 2)], VIDEO_LIBRARY_FILE);
  await assert.rejects(workspace.saveStimulusOrder(order), /noncanonical/);
  assets.children.set("stimuli", new MemoryDirectory("stimuli"));
  await assert.rejects(workspace.importLibraryVideoFiles([new File(["x"], "x.mp4")]), /changed/);
  assert.equal(assets.children.get("stimuli").children.size, 0);
  assets.children.set("stimuli", videos);
  await videos.getFileHandle("extra.json", { create: true });
  await assert.rejects(workspace.videoLibrary(), /only supported/);
  root.permission = "denied";
  await assert.rejects(workspace.videoLibrary());
});

test("browser authoring accepts the same video suffixes as native imports", async () => {
  const { workspace } = await workspaceFixture();
  const receipt = await workspace.importLibraryVideoFiles([new File(["mkv"], "third.MKV"), new File(["ogv"], "fourth.ogv"), new File(["avi"], "fifth.avi")]);
  assert.equal(receipt.library.videos.length, 5);
});

test("browser named-ISI save and clean reopen preserve the contribution; corrupt saves never masquerade as accepted", async () => {
  const { createVariantDocument, createVariantDraft, addIsiDurations, pasteVariantTable } = await import("../site/src/research/variant-design.js");
  const { root, workspace, assets } = await workspaceFixture();
  const { library } = await workspace.videoLibrary({ confirm: true });
  const [a, b] = library.videos.map(video => video.annotationId);
  const draft = pasteVariantTable(addIsiDurations(createVariantDraft(), "500, 1500"), 0, 0, `${a}\t${b}\nISI1\tISI2\n${b}\t${a}`, library);
  const document = await createVariantDocument(draft, library);
  assert.deepEqual((await workspace.saveStimulusOrder(document)).design, document);
  const reopened = new BrowserResearchWorkspace(root); await reopened.initialize();
  assert.deepEqual((await reopened.videoLibrary()).design, document);
  const handle = assets.children.get(STIMULUS_ORDER_FILE), old = await handle.file.text();
  assert.equal(old, canonicalJson(document) + "\n");
  handle.file = new File([old.replace('"runnerAssigned"', '"cyclicByOrdinal"')], STIMULUS_ORDER_FILE);
  const rejected = await reopened.videoLibrary();
  assert.equal(rejected.design, null); assert.match(rejected.designError, /Saved/);
});

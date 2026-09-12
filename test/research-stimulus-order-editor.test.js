import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { createVariantDocument } from "../site/src/research/variant-design.js";
import { requestStimulusAuthoring } from "../site/src/research/stimulus-authoring-request.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";

const { library, document: design, videos } = JSON.parse(await readFile(new URL("./fixtures/variant-design-v1.json", import.meta.url), "utf8"));
function fixture(operate) {
  const handlers = new Map();
  let renders = 0;
  const host = {
    set innerHTML(_value) { renders++; },
    querySelector() { return null; },
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type) { handlers.delete(type); },
  };
  const status = { textContent: "", dataset: {} }, versions = { innerHTML: "", replaceChildren() { this.innerHTML = ""; } };
  const root = {
    querySelector(selector) { return selector === "#stimulus-order-editor" ? host : selector === "#stimulus-order-status" ? status : versions; },
    querySelectorAll() { return []; },
  };
  const editor = createStimulusOrderEditor({ root, operate });
  return { editor, handlers, status, versions, get renders() { return renders; } };
}
function cell(value) {
  return { dataset: { orderRow: "1", orderColumn: "0" }, value, removeAttribute() {}, setAttribute() {} };
}

test("typing invalidates the saved version immediately and cannot save stale cell values", async () => {
  let writes = 0;
  const ui = fixture(async (_operation, { document }) => { writes++; return { library, design: document }; });
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  assert.deepEqual(ui.editor.document, design);
  const control = cell("invalid");
  ui.handlers.get("input")({ target: control });
  assert.equal(ui.editor.document, null);
  assert.equal(ui.editor.active, true);
  assert.equal(await ui.editor.confirm(), false);
  assert.equal(writes, 0);
  control.value = "ISI2";
  ui.handlers.get("input")({ target: control });
  const renders = ui.renders;
  ui.handlers.get("change")({ target: control });
  assert.equal(ui.renders, renders, "committing a cell must preserve its DOM and ordinary Tab focus movement");
  assert.equal(await ui.editor.confirm(), true);
  assert.equal(ui.editor.document.contribution.variants[0].entries[1].referenceId, "ISI2");
  assert.notEqual(ui.editor.document.contribution.variants[0].versionSha256, design.contribution.variants[0].versionSha256);
  ui.editor.destroy();
  assert.equal(ui.handlers.size, 0);
});

test("failed or mismatched storage receipts never confirm a table", async () => {
  const ui = fixture(async () => { throw new Error("Storage unavailable"); });
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  ui.handlers.get("input")({ target: cell("ISI2") });
  assert.equal(await ui.editor.confirm(), false);
  assert.equal(ui.editor.document, null);
  assert.match(ui.status.textContent, /Storage unavailable/);
  const mismatch = fixture(async () => ({ library, design }));
  await mismatch.editor.adopt({ library, design }, { loadSaved: true });
  mismatch.handlers.get("input")({ target: cell("ISI2") });
  assert.equal(await mismatch.editor.confirm(), false);
  assert.equal(mismatch.editor.document, null);
});

test("a delayed old-workspace library receipt cannot replace a new workspace", async () => {
  let resolve;
  const ui = fixture(() => new Promise(done => { resolve = done; }));
  const confirmation = ui.editor.confirmLibrary();
  ui.editor.reset();
  resolve({ library, design });
  assert.equal(await confirmation, false);
  assert.equal(ui.editor.document, null);
  assert.equal(ui.editor.active, false);
});

test("a corrupt saved design invalidates the receipt even when the videos have not changed", async () => {
  const ui = fixture(async () => ({ library, design }));
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  await ui.editor.adopt({ library, design: null, designError: "Saved design is invalid" });
  assert.equal(ui.editor.document, null);
  assert.equal(ui.editor.active, true);
  assert.match(ui.status.textContent, /invalid/);
});

test("a delayed save receipt cannot confirm after workspace reset", async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const ui = fixture(async (_operation, { document }) => { started(); await new Promise(resolve => { release = resolve; }); return { library, design: document }; });
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  const confirmation = ui.editor.confirm();
  await ready; ui.editor.reset(); release();
  assert.equal(await confirmation, false);
  assert.equal(ui.editor.document, null);
});

test("explicit paste uses the focused destination, expands variants, and preserves the table on rejection", async () => {
  const ui = fixture(async (_operation, { document }) => ({ library, design: document }));
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  const [a, b] = library.videos.map(video => video.annotationId);
  const paste = source => ui.handlers.get("paste")({ target: { dataset: { orderRow: "0", orderColumn: "0" } }, preventDefault() {}, clipboardData: { getData() { return source; } } });
  paste(`${a}\t${b}\nISI1\tISI2\n${b}\t${a}`);
  assert.equal(await ui.editor.confirm(), true);
  const saved = ui.editor.document;
  paste(`${b}\t=SUM(A1)`);
  assert.deepEqual(ui.editor.document, saved);
  assert.deepEqual(saved, await createVariantDocument(design.draft, library));
});

test("authoring requests require a connected adapter and a successful callback", async () => {
  await assert.rejects(requestStimulusAuthoring(new EventTarget(), "confirm-library"), /not connected/);
  const root = new EventTarget();
  root.addEventListener(RESEARCH_UI_EVENTS.stimulusAuthoringRequest, event => {
    event.preventDefault(); event.detail.complete({ ok: true, receipt: { library } });
  });
  assert.deepEqual(await requestStimulusAuthoring(root, "confirm-library"), { library });
});

test("P7 contribution reopen is editable and invalid ISI edits immediately invalidate its snapshot", async () => {
  const ui = fixture(async (_operation, { document }) => ({ library, design: document }));
  await ui.editor.restoreContribution(design.contribution, { library });
  const initial = ui.editor.getSnapshot();
  assert.equal(initial.enabled, true); assert.equal(initial.pending, false);
  assert.deepEqual(initial.contribution, design.contribution);
  const input = { dataset: { isiId: "ISI1" }, value: "", removeAttribute() {}, setAttribute() {} };
  ui.handlers.get("input")({ target: input });
  const pending = ui.editor.getSnapshot();
  assert.ok(pending.revision > initial.revision); assert.equal(pending.pending, true); assert.equal(pending.contribution, null);
  assert.equal(await ui.editor.confirm(), false);
  input.value = "501"; ui.handlers.get("input")({ target: input }); ui.handlers.get("change")({ target: input });
  assert.equal(await ui.editor.confirm(), true);
  assert.equal(ui.editor.getSnapshot().pending, false);
  assert.notEqual(ui.editor.document.contribution.variants[0].versionSha256, design.contribution.variants[0].versionSha256);
  assert.equal(ui.editor.document.contribution.variants[1].versionSha256, design.contribution.variants[1].versionSha256);
});

test("catalogue withdrawal and changed content under a reused revision invalidate acceptance", async () => {
  for (const replacement of [null, { revision: 7, videos: videos.map(video => ({ ...video, durationMs: video.durationMs + 1000 })) }]) {
    const ui = fixture(async (_operation, { document }) => ({ library, design: document }));
    await ui.editor.adopt({ library, design }, { loadSaved: true });
    ui.editor.setCatalogue({ revision: 7, videos });
    assert.equal(await ui.editor.confirm(), true);
    const accepted = ui.editor.getSnapshot();
    if (replacement) assert.throws(() => ui.editor.setCatalogue(replacement), /without a new revision/);
    else ui.editor.setCatalogue(replacement);
    const withdrawn = ui.editor.getSnapshot();
    assert.equal(withdrawn.contribution, null);
    assert.equal(withdrawn.pending, true);
    assert.ok(withdrawn.revision > accepted.revision);
    assert.equal(ui.versions.innerHTML, "");
    assert.equal(await ui.editor.confirm(), false, "withdrawn or rejected dependencies must not be reaccepted");
  }
});

test("both reopen APIs keep the actual prebound P1 revision and timing without a fabricated increment", async () => {
  for (const [method, value] of [["restore", design], ["restoreContribution", design.contribution]]) {
    const ui = fixture(async () => { throw new Error("Reopen must not write."); });
    ui.editor.setCatalogue({ revision: 7, videos });
    await ui.editor[method](value, { library });
    const accepted = ui.editor.getSnapshot();
    assert.deepEqual(accepted.dependencyRevisions, [{ segment: "P1", revision: 7 }]);
    assert.equal(accepted.pending, false);
    assert.deepEqual(accepted.contribution, design.contribution);
    assert.match(ui.versions.innerHTML, /Planned duration: 3500 ms/);
    ui.editor.setCatalogue({ revision: 7, videos: structuredClone(videos) });
    assert.deepEqual(ui.editor.getSnapshot(), accepted, "an identical producer snapshot must not discard reopen acceptance");
  }
});

test("malformed catalogue inputs clear acceptance; a fresh revision can be reviewed without mutating its source", async () => {
  for (const invalid of [{ revision: -1, videos }, { revision: 7, videos: [...videos, videos[0]] }]) {
    const ui = fixture(async (_operation, { document }) => ({ library, design: document }));
    const catalogue = { revision: 7, videos: structuredClone(videos) };
    await ui.editor.restore(design, { library, catalogue });
    catalogue.videos[0].durationMs = 9000;
    assert.match(ui.versions.innerHTML, /Planned duration: 3500 ms/);
    assert.throws(() => ui.editor.setCatalogue(invalid));
    assert.equal(ui.editor.getSnapshot().contribution, null);
    assert.equal(await ui.editor.confirm(), false);
    ui.editor.setCatalogue({ revision: 8, videos });
    assert.equal(await ui.editor.confirm(), true);
    assert.deepEqual(ui.editor.getSnapshot().dependencyRevisions, [{ segment: "P1", revision: 8 }]);
  }
});

test("restore validates the supplied P1 identity and cancellation before committing any state", async () => {
  for (const [method, value] of [["restore", design], ["restoreContribution", design.contribution]]) {
    const ui = fixture(async () => {});
    await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
    const initial = ui.editor.getSnapshot();
    await assert.rejects(ui.editor[method](value, { library, catalogue: { revision: 8, videos: videos.slice(1) } }), /does not match/);
    assert.deepEqual(ui.editor.getSnapshot(), initial);
    await assert.rejects(ui.editor[method](value, { library, isCurrent: () => false }), /changed while reopening/);
    assert.deepEqual(ui.editor.getSnapshot(), initial);
    const reopening = ui.editor[method](value, { library });
    ui.editor.setCatalogue(null);
    await assert.rejects(reopening);
    assert.equal(ui.editor.getSnapshot().contribution, null);
  }
});

test("an explicit P1 withdrawal also invalidates a restored legacy library-only contribution", async () => {
  const ui = fixture(async () => {});
  await ui.editor.restore(design, { library });
  ui.editor.setCatalogue(null);
  assert.equal(ui.editor.getSnapshot().contribution, null);
  assert.equal(await ui.editor.confirm(), false);
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  assert.equal(ui.editor.getSnapshot().contribution, null);
});

test("catalogue withdrawal during compilation prevents the stale authoring write", async () => {
  let writes = 0;
  const ui = fixture(async (_operation, { document }) => { writes++; return { library, design: document }; });
  await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
  const confirmation = ui.editor.confirm();
  ui.editor.setCatalogue(null);
  assert.equal(await confirmation, false);
  assert.equal(writes, 0);
  assert.equal(ui.editor.getSnapshot().contribution, null);
});

test("master-recipe preparation confirms current edits without writing an authoring sidecar", async () => {
  let writes = 0;
  const ui = fixture(async () => { writes++; throw new Error("Unexpected sidecar write"); });
  await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
  ui.handlers.get("input")({ target: cell("ISI2") });
  const result = await ui.editor.prepareContribution();
  assert.equal(writes, 0); assert.equal(result.pending, false);
  assert.deepEqual(result, ui.editor.getSnapshot());
  assert.equal(result.contribution.variants[0].entries[1].referenceId, "ISI2");
  assert.notEqual(result.contribution.variants[0].versionSha256, design.contribution.variants[0].versionSha256);
  assert.match(ui.versions.innerHTML, /variants · versions/);
  ui.handlers.get("input")({ target: cell("unknown") });
  await assert.rejects(ui.editor.prepareContribution(), /Event 2/);
  assert.equal(ui.editor.getSnapshot().contribution, null);
  assert.equal(writes, 0);
});

test("master preparation rejects cancellation and catalogue withdrawal before acceptance", async () => {
  const ui = fixture(async () => { throw new Error("Unexpected sidecar write"); });
  await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
  ui.handlers.get("input")({ target: cell("ISI2") });
  await assert.rejects(ui.editor.prepareContribution({ isCurrent: () => false }), /changed during confirmation/);
  assert.equal(ui.editor.getSnapshot().contribution, null);
  const preparing = ui.editor.prepareContribution();
  ui.editor.setCatalogue(null);
  await assert.rejects(preparing);
  assert.equal(ui.editor.getSnapshot().contribution, null);
  assert.equal(ui.editor.getSnapshot().pending, true);
});

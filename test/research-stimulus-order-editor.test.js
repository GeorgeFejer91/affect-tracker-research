import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { createVariantDocument } from "../site/src/research/variant-design.js";
import { requestStimulusAuthoring } from "../site/src/research/stimulus-authoring-request.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";
import { createVideoCatalogueContributionV1 } from "../site/src/research/video-catalogue-contribution.js";

const { library, document: design, videos } = JSON.parse(await readFile(new URL("./fixtures/variant-design-v1.json", import.meta.url), "utf8"));
const contentFixture = JSON.parse(await readFile(new URL("./fixtures/variant-workspace-binding-v1.json", import.meta.url), "utf8"));
function fixture(operate) {
  const handlers = new Map();
  let renders = 0, markup = "", notifications = 0, announcements = 0;
  const host = {
    set innerHTML(value) { renders++; markup = value; },
    querySelector() { return null; },
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type) { handlers.delete(type); },
  };
  const status = { textContent: "", dataset: {} }, versions = { innerHTML: "", replaceChildren() { this.innerHTML = ""; } };
  const root = {
    querySelector(selector) { return selector === "#stimulus-order-editor" ? host : selector === "#stimulus-order-status" ? status : versions; },
    querySelectorAll() { return []; },
  };
  const editor = createStimulusOrderEditor({ root, operate, onChange() { notifications++; }, announce() { announcements++; } });
  return { editor, handlers, status, versions, get renders() { return renders; }, get markup() { return markup; },
    get notifications() { return notifications; }, get announcements() { return announcements; } };
}
function cell(value) {
  return { dataset: { orderRow: "1", orderColumn: "0" }, value, removeAttribute() {}, setAttribute() {} };
}

async function confirmationFixture() {
  const ui = fixture(async () => { throw Error("Prepared confirmation must not write."); });
  await ui.editor.adopt({ library, design }, { loadSaved: true });
  ui.editor.setCatalogue({ revision: 7, videos });
  return ui;
}
const projection = ui => ({ renders: ui.renders, notifications: ui.notifications,
  announcements: ui.announcements, status: ui.status.textContent, versions: ui.versions.innerHTML });

test("prepared confirmation is read-only and its detached future snapshot equals the committed real owner", async () => {
  const ui = await confirmationFixture(), before = ui.editor.getSnapshot(), view = projection(ui);
  const candidate = await ui.editor.prepareConfirmation();
  assert.deepEqual(ui.editor.getSnapshot(), before);
  assert.deepEqual(projection(ui), view);
  assert.equal(candidate.isCurrent(), true);
  const future = candidate.snapshot;
  assert.deepEqual(Object.keys(future), Object.keys(before));
  assert.equal(future.revision, before.revision + 1);
  assert.equal(future.enabled, true); assert.equal(future.pending, false);
  assert.deepEqual(future.dependencyRevisions, [{ segment: "P1", revision: 7 }]);
  const detached = candidate.snapshot; detached.contribution.variants[0].title = "caller mutation";
  assert.deepEqual(candidate.snapshot, future);
  assert.throws(() => candidate.afterCommit(), /Commit/);
  candidate.commit();
  assert.deepEqual(ui.editor.getSnapshot(), future);
  assert.deepEqual(projection(ui), view, "Commit does not render or notify");
  assert.equal(candidate.isCurrent(), false);
  assert.throws(() => candidate.commit(), /changed/);
  candidate.afterCommit();
  assert.equal(ui.renders, view.renders + 1);
  assert.equal(ui.notifications, view.notifications + 1);
  assert.equal(ui.announcements, view.announcements + 1);
  const projected = projection(ui); candidate.afterCommit(); assert.deepEqual(projection(ui), projected);
});

for (const mode of ["edit", "reset", "withdraw", "destroy", "abort", "caller"]) {
  test(`prepared confirmation rejects ${mode} without altering newer state or projection`, async () => {
    const ui = await confirmationFixture(), controller = new AbortController();
    let current = true;
    const candidate = await ui.editor.prepareConfirmation({ isCurrent: () => current, signal: controller.signal });
    if (mode === "edit") ui.handlers.get("input")({ target: cell("ISI2") });
    if (mode === "reset") ui.editor.reset();
    if (mode === "withdraw") ui.editor.setCatalogue(null);
    if (mode === "destroy") ui.editor.destroy();
    if (mode === "abort") controller.abort();
    if (mode === "caller") current = false;
    const before = ui.editor.getSnapshot(), view = projection(ui);
    assert.equal(candidate.isCurrent(), false);
    if (mode === "caller") current = true;
    assert.throws(() => candidate.commit(), /changed/);
    assert.deepEqual(ui.editor.getSnapshot(), before); assert.deepEqual(projection(ui), view);
  });
}

test("confirmation rejects invalid input or cancellation during compilation without presentation effects", async () => {
  for (const mode of ["invalid", "abort", "withdraw"]) {
    const ui = await confirmationFixture(), controller = new AbortController();
    if (mode === "invalid") ui.handlers.get("input")({ target: cell("unknown") });
    const pending = ui.editor.prepareConfirmation({ signal: controller.signal });
    if (mode === "abort") controller.abort();
    if (mode === "withdraw") ui.editor.setCatalogue(null);
    const before = ui.editor.getSnapshot(), view = projection(ui);
    await assert.rejects(pending);
    assert.deepEqual(ui.editor.getSnapshot(), before); assert.deepEqual(projection(ui), view);
  }
});

test("competing confirmations reserve no state and a delayed projection cannot overwrite newer edits", async () => {
  const ui = await confirmationFixture();
  const [a, b] = await Promise.all([ui.editor.prepareConfirmation(), ui.editor.prepareConfirmation()]);
  assert.deepEqual(a.snapshot, b.snapshot);
  a.commit(); assert.throws(() => b.commit(), /changed/);
  ui.handlers.get("input")({ target: cell("ISI2") });
  const before = ui.editor.getSnapshot(), view = projection(ui);
  a.afterCommit(); assert.deepEqual(ui.editor.getSnapshot(), before); assert.deepEqual(projection(ui), view);
});

test("prepared confirmation preserves the existing GUI compiler and real P1 source binding", async () => {
  const ui = await confirmationFixture(), gui = await confirmationFixture();
  const candidate = await ui.editor.prepareConfirmation();
  assert.deepEqual(candidate.snapshot, await gui.editor.prepareContribution());
  await ui.editor.restoreContent(contentFixture.contribution, contentOptions());
  await ui.editor.setCatalogueSource({ ...contentFixture.initialSnapshot, revision: 42 });
  const rebound = await ui.editor.prepareConfirmation();
  assert.deepEqual(rebound.snapshot.contribution, contentFixture.contribution);
  assert.deepEqual(rebound.snapshot.dependencyRevisions, [{ segment: "P1", revision: 42 }]);
  rebound.commit(); assert.deepEqual(ui.editor.getSnapshot(), rebound.snapshot);
});

test("prepared reset matches GUI reset state without rendering until one projection", async () => {
  const ui = await confirmationFixture(), gui = await confirmationFixture();
  const before = ui.editor.captureAuthoringDraft(), snapshot = ui.editor.getSnapshot(), view = projection(ui);
  const candidate = ui.editor.prepareReset();
  assert.deepEqual(ui.editor.captureAuthoringDraft(), before); assert.deepEqual(ui.editor.getSnapshot(), snapshot);
  assert.deepEqual(projection(ui), view); assert.throws(() => candidate.afterCommit(), /Commit/);
  candidate.commit(); gui.editor.reset();
  const actual = ui.editor.captureAuthoringDraft(), expected = gui.editor.captureAuthoringDraft();
  assert.deepEqual(actual, expected); assert.deepEqual(ui.editor.getSnapshot(), gui.editor.getSnapshot());
  assert.deepEqual(projection(ui), view); assert.equal(candidate.isCurrent(), false);
  assert.throws(() => candidate.commit(), /changed/);
  candidate.afterCommit(); assert.equal(ui.renders, view.renders + 1); assert.equal(ui.notifications, view.notifications + 1);
  const projected = projection(ui); candidate.afterCommit(); assert.deepEqual(projection(ui), projected);
});

test("prepared reset rejects stale or aborted candidates and suppresses delayed projection", async () => {
  for (const mode of ["edit", "dependency", "abort", "caller", "destroy"]) {
    const ui = await confirmationFixture(), controller = new AbortController(); let current = true;
    const candidate = ui.editor.prepareReset({ signal: controller.signal, isCurrent: () => current });
    if (mode === "edit") ui.handlers.get("input")({ target: cell("ISI2") });
    if (mode === "dependency") ui.editor.setCatalogue(null);
    if (mode === "abort") controller.abort();
    if (mode === "caller") current = false;
    if (mode === "destroy") ui.editor.destroy();
    const before = ui.editor.captureAuthoringDraft(), view = projection(ui);
    assert.throws(() => candidate.commit(), /changed/);
    assert.deepEqual(ui.editor.captureAuthoringDraft(), before); assert.deepEqual(projection(ui), view);
  }
  const ui = await confirmationFixture(), candidate = ui.editor.prepareReset();
  candidate.commit(); ui.editor.reset(); const view = projection(ui);
  candidate.afterCommit(); assert.deepEqual(projection(ui), view);
});

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

const unresolvedP1 = revision => ({ revision, enabled: true, pending: true, contribution: null, dependencyRevisions: [] });
const contentOptions = (revision = 41) => ({
  savedWorkspaceContribution: contentFixture.initialSnapshot.contribution,
  dependencies: { P1: unresolvedP1(revision) }, isCurrent: () => true,
});

test("saved table and ISIs reopen before media; editing survives exact rebind without extra writes", async () => {
  let writes = 0;
  const ui = fixture(async () => { writes++; throw new Error("Content restore must not write."); });
  const payload = contentFixture.contribution;
  const restored = await ui.editor.restoreContent(payload, contentOptions());
  assert.equal(restored.enabled, true); assert.equal(restored.pending, true); assert.equal(restored.contribution, null);
  assert.deepEqual(restored.dependencyRevisions, [{ segment: "P1", revision: 41 }]);
  assert.ok(ui.markup.includes(`value="${payload.variants[0].entries[0].referenceId}"`));
  assert.ok(ui.markup.includes('data-isi-id="ISI1"'));
  await assert.rejects(ui.editor.prepareContribution(), /Segment 1/);
  assert.equal(await ui.editor.confirm(), false);
  ui.handlers.get("input")({ target: cell("ISI2") });
  await ui.editor.setCatalogueSource(unresolvedP1(42));
  assert.ok(ui.markup.includes('value="ISI2"'));
  await ui.editor.setCatalogueSource({ ...contentFixture.initialSnapshot, revision: 43 });
  assert.equal(ui.editor.getSnapshot().pending, true, "media readiness alone cannot accept the edited table");
  const prepared = await ui.editor.prepareContribution();
  assert.equal(prepared.pending, false);
  assert.deepEqual(prepared.dependencyRevisions, [{ segment: "P1", revision: 43 }]);
  assert.equal(prepared.contribution.variants[0].entries[1].referenceId, "ISI2");
  assert.deepEqual(prepared.contribution.variants[1], payload.variants[1]);
  assert.equal(writes, 0);
});

test("invalid or cancelled content-only restore preserves the current draft", async () => {
  const ui = fixture(async () => {}), payload = contentFixture.contribution;
  await ui.editor.restoreContent(payload, contentOptions());
  ui.handlers.get("input")({ target: cell("ISI2") });
  const prior = ui.editor.getSnapshot(), markup = ui.markup;
  const invalid = structuredClone(payload); invalid.integritySha256 = "f".repeat(64);
  await assert.rejects(ui.editor.restoreContent(invalid, contentOptions()));
  await assert.rejects(ui.editor.restoreContent(payload, { ...contentOptions(), isCurrent: () => false }), /changed while reopening/);
  const options = contentOptions(); options.savedWorkspaceContribution = structuredClone(options.savedWorkspaceContribution);
  options.savedWorkspaceContribution.videoCatalogue.entries[0].byteLength++;
  await assert.rejects(ui.editor.restoreContent(payload, options));
  assert.deepEqual(ui.editor.getSnapshot(), prior); assert.equal(ui.markup, markup);
});

test("content-only restore cannot overtake a newer restore, edit, withdrawal or teardown", async () => {
  const payload = contentFixture.contribution;
  const ui = fixture(async () => {});
  const first = ui.editor.restoreContent(payload, contentOptions(41));
  const second = ui.editor.restoreContent(payload, contentOptions(42));
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, "rejected"); assert.equal(results[1].status, "fulfilled");
  assert.deepEqual(ui.editor.getSnapshot().dependencyRevisions, [{ segment: "P1", revision: 42 }]);
  for (const action of [editor => editor.handlers.get("input")({ target: cell("ISI2") }),
    editor => editor.editor.setCatalogueSource(unresolvedP1(43)), editor => editor.editor.destroy()]) {
    const current = fixture(async () => {});
    await current.editor.restoreContent(payload, contentOptions());
    const reopening = current.editor.restoreContent(payload, contentOptions());
    await action(current);
    await assert.rejects(reopening, /changed while reopening/);
    assert.equal(current.editor.getSnapshot().contribution, null);
  }
});

test("different freshly verified video bytes cannot silently replace saved table references", async () => {
  const ui = fixture(async () => {}), payload = contentFixture.contribution;
  await ui.editor.restoreContent(payload, contentOptions());
  const workspace = structuredClone(contentFixture.initialSnapshot.contribution);
  const entries = workspace.videoCatalogue.entries;
  entries[0].sha256 = "c".repeat(64); entries[0].assetId = `asset-${entries[0].sha256}`; entries[0].byteLength++;
  workspace.videoCatalogue = await createVideoCatalogueContributionV1({ revision: 2, entries });
  await ui.editor.setCatalogueSource({ ...contentFixture.initialSnapshot, revision: 42, contribution: workspace });
  assert.ok(ui.markup.includes(`value="${payload.variants[0].entries[0].referenceId}"`));
  await assert.rejects(ui.editor.prepareContribution(), /Event 1/);
  assert.equal(ui.editor.getSnapshot().contribution, null);
});

test("a newer content reopen supersedes an older preparation or save before it can publish", async () => {
  for (const method of ["prepareContribution", "confirm"]) {
    let writes = 0;
    const ui = fixture(async (_operation, { document }) => { writes++; return { library, design: document }; });
    await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
    const preparing = ui.editor[method]();
    const reopening = ui.editor.restoreContent(contentFixture.contribution, contentOptions());
    const results = await Promise.allSettled([preparing, reopening]);
    if (method === "prepareContribution") assert.equal(results[0].status, "rejected");
    else assert.equal(results[0].value, false);
    assert.equal(results[1].status, "fulfilled");
    assert.equal(ui.editor.getSnapshot().contribution, null);
    assert.deepEqual(ui.editor.getSnapshot().dependencyRevisions, [{ segment: "P1", revision: 41 }]);
    assert.equal(writes, 0);
  }
});

test("a library download cannot start a stale export after replacement, reset or teardown", async () => {
  for (const action of [ui => ui.editor.reset(), ui => ui.editor.destroy(),
    ui => ui.editor.setCatalogueSource(unresolvedP1(42)),
    ui => ui.editor.restoreContent(contentFixture.contribution, contentOptions())]) {
    let writes = 0;
    const ui = fixture(async () => { writes++; });
    await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
    const downloading = ui.editor.download("csv");
    await action(ui);
    await downloading;
    assert.equal(writes, 0, "a newer catalogue/editor lifetime fences the export before dispatch");
  }
});

test("an in-flight library export cannot announce success over a newer reopened design", async () => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const ui = fixture(async () => { started(); await new Promise(resolve => { release = resolve; }); });
  await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
  const downloading = ui.editor.download("xlsx");
  await entered;
  await ui.editor.restoreContent(contentFixture.contribution, contentOptions());
  const status = ui.status.textContent;
  release(); await downloading;
  assert.equal(ui.status.textContent, status);
  assert.equal(ui.editor.getSnapshot().contribution, null);
});

test("prepared content reopen leaves state and projections untouched until separate synchronous publication", async () => {
  let writes = 0;
  const ui = fixture(async () => { writes++; });
  await ui.editor.restore(design, { library, catalogue: { revision: 7, videos } });
  const before = ui.editor.captureAuthoringDraft(), snapshot = ui.editor.getSnapshot();
  const renders = ui.renders, message = ui.status.textContent;
  const content = structuredClone(contentFixture.contribution), options = contentOptions();
  const pending = ui.editor.prepareRestoreContent(content, options);
  content.variants[0].title = "Caller mutation after dispatch";
  const prepared = await pending;
  assert.deepEqual(ui.editor.captureAuthoringDraft(), before);
  assert.deepEqual(ui.editor.getSnapshot(), snapshot);
  assert.equal(ui.renders, renders); assert.equal(ui.status.textContent, message);
  assert.throws(() => prepared.afterCommit());
  assert.equal(prepared.commit(), undefined);
  assert.equal(prepared.isCurrent(), false);
  assert.equal(ui.renders, renders); assert.equal(ui.status.textContent, message);
  assert.equal(ui.editor.getSnapshot().contribution, null);
  assert.equal(ui.editor.getSnapshot().pending, true);
  assert.deepEqual(ui.editor.getSnapshot().dependencyRevisions, [{ segment: "P1", revision: 41 }]);
  assert.throws(() => prepared.commit());
  prepared.afterCommit(); const published = ui.renders;
  prepared.afterCommit(); assert.equal(ui.renders, published);
  assert.ok(published > renders); assert.equal(writes, 0);
  await assert.rejects(ui.editor.prepareContribution(), /Segment 1/);
  await ui.editor.setCatalogueSource({ ...contentFixture.initialSnapshot, revision: 42 });
  const restored = await ui.editor.prepareContribution();
  assert.deepEqual(restored.contribution, contentFixture.contribution);
});

for (const change of ["edit", "reset", "destroy", "dependency", "callerDependency", "cancel"]) {
  test(`prepared content commit rejects ${change} without replacing newer owner state`, async () => {
    const ui = fixture(async () => {}), options = contentOptions();
    let current = true; options.isCurrent = () => current;
    await ui.editor.restoreContent(contentFixture.contribution, contentOptions());
    const prepared = await ui.editor.prepareRestoreContent(contentFixture.contribution, options);
    if (change === "edit") ui.handlers.get("input")({ target: cell("ISI2") });
    if (change === "reset") ui.editor.reset();
    if (change === "destroy") ui.editor.destroy();
    if (change === "dependency") await ui.editor.setCatalogueSource(unresolvedP1(42));
    if (change === "callerDependency") options.dependencies.P1 = unresolvedP1(42);
    if (change === "cancel") current = false;
    const before = ui.editor.captureAuthoringDraft(), snapshot = ui.editor.getSnapshot(), renders = ui.renders;
    assert.equal(prepared.isCurrent(), false);
    assert.throws(() => prepared.commit(), /changed while reopening/);
    assert.deepEqual(ui.editor.captureAuthoringDraft(), before);
    assert.deepEqual(ui.editor.getSnapshot(), snapshot); assert.equal(ui.renders, renders);
  });
}

test("two read-only preparations do not reserve state and only the first committed candidate can publish", async () => {
  const ui = fixture(async () => {});
  const a = await ui.editor.prepareRestoreContent(contentFixture.contribution, contentOptions());
  const b = await ui.editor.prepareRestoreContent(contentFixture.contribution, contentOptions());
  assert.equal(a.isCurrent(), true); assert.equal(b.isCurrent(), true);
  a.commit(); assert.equal(b.isCurrent(), false); assert.throws(() => b.commit());
  ui.editor.reset(); const renders = ui.renders, message = ui.status.textContent;
  a.afterCommit(); assert.equal(ui.renders, renders); assert.equal(ui.status.textContent, message);
});

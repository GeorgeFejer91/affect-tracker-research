import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createStimulusOrderEditor } from "../site/src/research/stimulus-order-editor.js";
import { createPlannerVariantCommandOwner } from "../site/src/research/planner-authoring-p3.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { createVariantDesign, createVariantDraft, compileVariantTimeline } from "../site/src/research/variant-design.js";
import { createPlannedMarkerProfile } from "../site/src/research/planned-marker-contract.js";
import { projectSavedVariantCatalogue } from "../site/src/research/variant-catalogue-adapter.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/variant-reproduction-v2.json", import.meta.url), "utf8"));
const legacyFixture = JSON.parse(await readFile(new URL("./fixtures/variant-workspace-binding-v1.json", import.meta.url), "utf8"));
const source = (revision = 5, pending = false) => ({ revision, pending, enabled: true, contribution: pending ? null : structuredClone(fixture.workspace), dependencyRevisions: [] });
const { library, videos } = await projectSavedVariantCatalogue(fixture.workspace);
const [a, b] = library.videos.map(video => video.annotationId);
const op = (operation, args = {}) => ({ kind: "operation", owner: "P3", operation, arguments: args });
const set = (field, value) => ({ kind: "set", field, value });

function createUi() {
  const handlers = new Map(); let markup = "", publications = 0, isiList = "", session;
  const host = { set innerHTML(value) { markup = value; }, querySelector: selector => selector === "[data-isi-list]" ? { value: isiList } : null,
    addEventListener(type, handler) { handlers.set(type, handler); }, removeEventListener(type) { handlers.delete(type); } };
  const root = { querySelector: selector => selector === "#stimulus-order-editor" ? host : null, querySelectorAll: () => [],
    researchUi: { plannerContributionChanged() { publications++; if (session && !session.publishing) session.edited(); } } };
  const editor = createStimulusOrderEditor({ root, operate: async () => { throw Error("No native operation is allowed in an edit."); } });
  const owner = createPlannerVariantCommandOwner({ editor });
  session = createPlannerAuthoringSession({ owners: [owner] });
  const send = (action, expectedRevision = session.revision) => session.execute({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision, action });
  return { editor, owner, session, handlers, send, apply: edits => send({ kind: "apply", edits }),
    get raw() { return owner.read().values["P3.draft"]; }, get publications() { return publications; }, get markup() { return markup; },
    setIsiList(value) { isiList = value; },
    click(dataset = {}, attributes = []) { const button = { dataset, hasAttribute: name => attributes.includes(name) }; handlers.get("click")({ target: { closest: () => button } }); },
    input(dataset, value, change = false) { const target = { dataset, value, removeAttribute() {}, setAttribute() {} }; handlers.get("input")({ target }); if (change) handlers.get("change")({ target }); },
  };
}
async function readyUi() { const ui = createUi(); await ui.editor.setCatalogueSource(source()); return ui; }
async function restoredUi() { const ui = await readyUi(); const staged = ui.editor.stageAuthoringDraftRestore(fixture.draft); staged.commit(); ui.editor.publishAuthoringDraft(); await ui.editor.prepareContribution(); return ui; }

test("P3 catalogue/readback covers every field; identities, hashes and raw recovery are not public setters", async () => {
  const ui = await restoredUi(), read = ui.owner.read();
  assert.deepEqual(Object.keys(read.values).sort(), ui.owner.settings.map(item => item.id).sort());
  assert.deepEqual(read.issues, []);
  assert.deepEqual(read.values["P3.contribution"], fixture.contribution);
  assert.deepEqual(read.values["P3.timelines"], fixture.contribution.variants.map(variant => compileVariantTimeline(fixture.contribution, variant.variantId, videos)));
  assert.deepEqual(read.values["P3.markerContract"], fixture.contribution.markerContract);
  assert.equal(read.values["P3.contribution"].allocation.kind, "runnerAssigned");
  assert.deepEqual(ui.owner.settings.filter(field => field.writable), []);
  for (const setting of ui.owner.settings) {
    const before = ui.raw, revision = ui.session.revision;
    const result = await ui.send(set(setting.id, read.values[setting.id]));
    assert.equal(result.status, "rejected", setting.id); assert.equal(result.issues[0].code, "read_only");
    assert.deepEqual(ui.raw, before); assert.equal(ui.session.revision, revision);
  }
  read.values["P3.draft"].rows[0][0] = "outside mutation";
  assert.notDeepEqual(ui.raw, read.values["P3.draft"]);
});

test("all fourteen stable-ID operations read back ordered dictionary, variants, rows and cells", async () => {
  const ui = await readyUi(), covered = new Set();
  async function edit(name, args = {}) { covered.add(name); const result = await ui.apply([op(name, args)]); assert.ok(["applied", "incomplete"].includes(result.status), JSON.stringify(result)); return result; }
  await edit("isi.add", { durationMs: 500 }); await edit("isi.add", { durationMs: 500 });
  assert.deepEqual(ui.raw.isiDefinitions, [{ isiId: "ISI1", durationMs: 500 }, { isiId: "ISI2", durationMs: 500 }]);
  await edit("isi.setDuration", { isiId: "ISI2", durationMs: 1500 });
  await edit("isi.move", { isiId: "ISI2", beforeIsiId: "ISI1" });
  assert.deepEqual(ui.raw.isiDefinitions.map(isi => isi.isiId), ["ISI2", "ISI1"]);
  await edit("variant.add", { title: "Counterbalanced", beforeVariantId: "variant-1" });
  await edit("variant.rename", { variantId: "variant-1", title: "Original" });
  assert.deepEqual(ui.raw.columns, [{ variantId: "variant-2", title: "Counterbalanced" }, { variantId: "variant-1", title: "Original" }]);
  await edit("variant.move", { variantId: "variant-1", beforeVariantId: "variant-2" });
  await edit("table.paste", { entryId: "variant-1-entry-1", text: `${a}\t${b}\nISI1\tISI2\n${b}\t${a}` });
  assert.deepEqual(ui.raw.rows.slice(0, 3), [[a, b], ["ISI1", "ISI2"], [b, a]]);
  await edit("row.add", { beforeEntryId: "variant-2-entry-2" });
  assert.deepEqual(ui.raw.entryIds[1], ["variant-1-entry-6", "variant-2-entry-6"]);
  await edit("cell.set", { entryId: "variant-1-entry-6", referenceId: "ISI1" });
  await edit("cell.set", { entryId: "variant-2-entry-6", referenceId: "ISI2" });
  await edit("row.move", { entryId: "variant-2-entry-6", beforeEntryId: "variant-1-entry-1" });
  assert.deepEqual(ui.raw.rows[0], ["ISI1", "ISI2"]);
  assert.deepEqual(ui.raw.entryIds[0], ["variant-1-entry-6", "variant-2-entry-6"]);
  await edit("row.remove", { entryId: "variant-2-entry-6" });
  await edit("variant.remove", { variantId: "variant-2" });
  await edit("isi.remove", { isiId: "ISI2" });
  assert.deepEqual(ui.raw.isiDefinitions, [{ isiId: "ISI1", durationMs: 500 }]);
  await edit("isi.add", { durationMs: 0 });
  assert.equal(ui.raw.isiDefinitions.at(-1).isiId, "ISI3", "deleted ISI names are not reused");
  await edit("table.reset"); assert.deepEqual(ui.raw, createVariantDraft());
  assert.deepEqual([...covered].sort(), ui.owner.operations.map(item => item.id).sort());
});

test("ordered batch can add then reference resources; any invalid member leaves the entire editor and acceptance unchanged", async () => {
  const ui = await restoredUi();
  const failures = [
    op("isi.remove", { isiId: fixture.draft.isiDefinitions[0].isiId }),
    op("isi.remove", { isiId: "ISI999999" }), op("row.move", { entryId: "missing", beforeEntryId: null }),
    op("variant.add", { title: "X", beforeVariantId: "variant-999999" }),
    op("isi.setDuration", { isiId: "ISI1", durationMs: -1 }), op("isi.add", { durationMs: 2.5 }),
    op("isi.add", { durationMs: "500" }), op("isi.add", { durationMs: Infinity }),
    op("cell.set", { entryId: "variant-1-entry-1", referenceId: a, extra: true }),
    op("cell.set", { entryId: "variant-1-entry-1", referenceId: "é".repeat(3073) }),
    op("randomize", {}), op("participant.assign", {}), op("table.paste", { entryId: "variant-1-entry-1", text: "unknown-video\t500" }),
  ];
  for (const failure of failures) {
    const before = ui.editor.captureAuthoringDraft(), revision = ui.session.revision, publications = ui.publications;
    const result = await ui.apply([op("variant.rename", { variantId: "variant-1", title: "Must not leak" }), failure]);
    assert.equal(result.status, "rejected", JSON.stringify(failure));
    assert.deepEqual(ui.editor.captureAuthoringDraft(), before); assert.equal(ui.session.revision, revision); assert.equal(ui.publications, publications);
  }
  const fresh = await readyUi();
  const result = await fresh.apply([op("isi.add", { durationMs: 1750 }), op("isi.add", { durationMs: 3213 }),
    op("cell.set", { entryId: "variant-1-entry-1", referenceId: "ISI1" }),
    op("cell.set", { entryId: "variant-1-entry-2", referenceId: a }),
    op("cell.set", { entryId: "variant-1-entry-3", referenceId: "ISI2" })]);
  assert.equal(result.status, "applied"); assert.equal(fresh.owner.read().values["P3.contribution"], null);
  await fresh.editor.prepareContribution();
  assert.deepEqual(fresh.editor.document.contribution.variants[0].entries.map(entry => entry.kind), ["isi", "video", "isi"]);
});

test("incomplete raw inputs stay visible, can be repaired, and cannot publish stale derived versions", async () => {
  const ui = await restoredUi();
  const variantId = ui.raw.columns[0].variantId, entryId = ui.raw.entryIds[0][0];
  const incomplete = await ui.apply([op("variant.rename", { variantId, title: "" }),
    op("cell.set", { entryId, referenceId: "unknown" })]);
  assert.equal(incomplete.status, "incomplete", JSON.stringify(incomplete)); assert.equal(ui.raw.columns[0].title, "");
  for (const field of ["contribution", "timelines", "markerContract"]) assert.equal(ui.owner.read().values[`P3.${field}`], null);
  await assert.rejects(ui.editor.prepareContribution());
  ui.input({ isiId: "ISI1" }, "", true);
  const raw = ui.raw; assert.equal(raw.isiDefinitions.find(isi => isi.isiId === "ISI1").durationMs, "");
  assert.ok(ui.owner.read().issues.length); assert.doesNotThrow(() => JSON.parse(JSON.stringify(ui.owner.read())));
  const added = await ui.apply([op("isi.add", { durationMs: 0 }), op("variant.rename", { variantId, title: "Recovered" }),
    op("cell.set", { entryId, referenceId: a }), op("isi.setDuration", { isiId: "ISI1", durationMs: 250 })]);
  assert.equal(added.status, "applied", JSON.stringify(added));
  assert.equal(ui.raw.isiDefinitions.find(isi => isi.isiId === "ISI1").durationMs, 250);
  for (const text of ["1e", "bad", ""]) {
    ui.input({ isiId: "ISI1" }, text);
    assert.equal(ui.raw.isiDefinitions.find(isi => isi.isiId === "ISI1").durationMs, text);
  }
});

test("internal raw restoration preserves incomplete text, padding and identity cursor exactly without restoring acceptance", async () => {
  const ui = await restoredUi();
  ui.input({ isiId: "ISI1" }, "not-a-number"); ui.input({ orderRow: "1", orderColumn: "0" }, "");
  const raw = ui.raw; raw.nextIsiOrdinal = 777; raw.columns[0].title = "";
  const before = ui.raw, staged = ui.editor.stageAuthoringDraftRestore(raw);
  assert.deepEqual(ui.raw, before); raw.rows[0][0] = "mutated after staging";
  staged.commit(); ui.editor.publishAuthoringDraft();
  const expected = structuredClone(raw); expected.rows[0][0] = before.rows[0][0];
  assert.deepEqual(ui.raw, expected); assert.equal(ui.editor.document, null);
  assert.throws(() => ui.editor.stageAuthoringDraftRestore({ ...expected, participantAllocation: true }));
  const badIds = structuredClone(expected); badIds.entryIds[0][0] = badIds.entryIds[1][0];
  assert.throws(() => ui.editor.stageAuthoringDraftRestore(badIds)); assert.deepEqual(ui.raw, expected);
});

test("staging and commit have no publication, preparation, file or DOM side effects until the postcommit hook", async () => {
  const ui = await restoredUi(), before = ui.editor.captureAuthoringDraft(), markup = ui.markup, publications = ui.publications;
  const staged = await ui.owner.stage([op("isi.add", { durationMs: 500 })]);
  assert.deepEqual(ui.editor.captureAuthoringDraft(), before); assert.equal(ui.markup, markup); assert.equal(ui.publications, publications);
  assert.equal(staged.isCurrent(), true); assert.equal(staged.commit(), undefined);
  assert.equal(ui.editor.document, null); assert.equal(ui.markup, markup); assert.equal(ui.publications, publications);
  assert.equal(staged.isCurrent(), false);
  ui.editor.publishAuthoringDraft(); assert.equal(ui.publications, publications + 1);
  ui.editor.publishAuthoringDraft(); assert.equal(ui.publications, publications + 1, "publication is coalesced");
});

test("the session publishes P3 observers only after every owner installs, and reports observer failure as applied but incomplete", async () => {
  const ui = await readyUi(); let p4Value = 0, observed = 0;
  const editor = { captureAuthoringDraft: () => ui.editor.captureAuthoringDraft(), stageAuthoringDraft: (...args) => ui.editor.stageAuthoringDraft(...args),
    publishAuthoringDraft() { observed = p4Value; throw Error("Detached observer failed"); } };
  const p3 = createPlannerVariantCommandOwner({ editor });
  const p4 = { id: "P4", settings: [{ id: "P4.test", type: "integer", writable: true, classification: "authored" }], operations: [],
    read: () => ({ values: { "P4.test": p4Value }, issues: [] }), validate: () => [],
    async stage() { return { commit() { p4Value = 2; } }; } };
  const session = createPlannerAuthoringSession({ owners: [p3, p4] });
  const result = await session.execute({ schema: "affect-research-planner-command", version: 1, sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: 0,
    action: { kind: "apply", edits: [op("isi.add", { durationMs: 500 }), set("P4.test", 2)] } });
  assert.equal(observed, 2); assert.equal(result.status, "incomplete"); assert.equal(session.revision, 1);
  assert.ok(result.issues.some(item => item.code === "projection_failed")); assert.equal(ui.raw.isiDefinitions.length, 1);
});

test("missing media, bounds, stale guards, and closed owners cannot silently become ready", async () => {
  const ui = createUi();
  assert.equal((await ui.apply([op("isi.add", { durationMs: 500 })])).status, "incomplete");
  assert.equal((await ui.apply([op("table.paste", { entryId: "variant-1-entry-1", text: a })])).status, "rejected");
  assert.equal((await ui.apply([op("variant.remove", { variantId: "variant-1" })])).status, "rejected");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ui.owner.stage([op("table.reset")], { signal: controller.signal }), error => error.code === "canceled");
  await assert.rejects(ui.owner.stage([op("table.reset")], { isCurrent: () => false }), error => error.code === "stale_revision");
  const huge = ui.raw; huge.rows = Array.from({ length: 1025 }, () => [""]); huge.entryIds = huge.rows.map((_, i) => [`variant-1-entry-${i + 1}`]);
  assert.throws(() => ui.editor.stageAuthoringDraftRestore(huge), /Event count/);
  ui.editor.destroy(); assert.equal((await ui.apply([op("table.reset")])).status, "rejected");
});

test("GUI-reserved default titles use the same variant allocator while incomplete scalars remain untouched", async () => {
  const cli = await readyUi(), gui = await readyUi();
  gui.input({ orderTitle: "0" }, "Variant 2", true);
  await cli.apply([op("variant.rename", { variantId: "variant-1", title: "Variant 2" })]);
  gui.click({}, ["data-order-add-column"]);
  await cli.apply([op("variant.add", { title: "Variant 3", beforeVariantId: null })]);
  assert.deepEqual(cli.raw, gui.raw); assert.equal(cli.raw.columns[1].variantId, "variant-3");
});

for (const drift of ["gui-edit", "edit-revert", "reset", "dependency", "restore", "destroy", "abort"]) {
  test(`P3 candidate rejects ${drift} while another owner is awaiting staging, before either owner commits`, async () => {
    const ui = await restoredUi(); let release, started, p4Commits = 0;
    const waiting = new Promise(resolve => { started = resolve; });
    const p4 = { id: "P4", settings: [{ id: "P4.test", type: "integer", writable: true, classification: "authored" }], operations: [],
      read: () => ({ values: { "P4.test": 0 }, issues: [] }), validate: () => [],
      async stage() { started(); await new Promise(resolve => { release = resolve; }); return { commit() { p4Commits++; } }; } };
    const session = createPlannerAuthoringSession({ owners: [ui.owner, p4] });
    const request = { schema: "affect-research-planner-command", version: 1, sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: 0,
      action: { kind: "apply", edits: [op("variant.rename", { variantId: "variant-1", title: "Stale" }), set("P4.test", 2)] } };
    const result = session.execute(request); await waiting;
    if (drift === "gui-edit" || drift === "edit-revert") { const old = ui.raw.columns[0].title; ui.input({ orderTitle: "0" }, "Newer"); if (drift === "edit-revert") ui.input({ orderTitle: "0" }, old); }
    if (drift === "reset") ui.editor.reset();
    if (drift === "dependency") await ui.editor.setCatalogueSource(source(6, true));
    if (drift === "restore") { const staged = ui.editor.stageAuthoringDraftRestore(ui.raw); staged.commit(); }
    if (drift === "destroy") ui.editor.destroy();
    if (drift === "abort") await session.execute({ ...request, requestId: crypto.randomUUID(), expectedRevision: null, action: { kind: "cancel", requestId: request.requestId } });
    const newer = ui.editor.captureAuthoringDraft(); release();
    assert.ok(["rejected", "canceled"].includes((await result).status));
    assert.equal(p4Commits, 0); assert.deepEqual(ui.editor.captureAuthoringDraft(), newer); assert.equal(session.revision, 0);
  });
}

test("GUI and command operations preserve identical occurrence identities, contribution hashes, timelines and marker profiles", async () => {
  const cli = await readyUi(), gui = await readyUi();
  gui.setIsiList("500,1500"); gui.click({}, ["data-isi-add"]);
  gui.click({}, ["data-order-add-column"]);
  gui.input({ orderTitle: "1" }, "Reverse", true);
  gui.handlers.get("paste")({ target: { dataset: { orderRow: "0", orderColumn: "0" } }, preventDefault() {}, clipboardData: { getData: () => `${a}\t${b}\nISI1\tISI2\n${b}\t${a}` } });
  gui.input({ isiId: "ISI1" }, "1750", true);
  gui.click({ orderMove: "variant", orderIndex: "1", orderDirection: "-1" });
  gui.click({ orderMove: "row", orderIndex: "0", orderDirection: "1" });
  gui.click({ orderMove: "isi", orderIndex: "0", orderDirection: "1" });
  const result = await cli.apply([op("isi.add", { durationMs: 500 }), op("isi.add", { durationMs: 1500 }),
    op("variant.add", { title: "Reverse", beforeVariantId: null }),
    op("table.paste", { entryId: "variant-1-entry-1", text: `${a}\t${b}\nISI1\tISI2\n${b}\t${a}` }),
    op("isi.setDuration", { isiId: "ISI1", durationMs: 1750 }), op("variant.move", { variantId: "variant-2", beforeVariantId: "variant-1" }),
    op("row.move", { entryId: "variant-1-entry-1", beforeEntryId: "variant-1-entry-3" }), op("isi.move", { isiId: "ISI1", beforeIsiId: null })]);
  assert.equal(result.status, "applied", JSON.stringify(result)); assert.deepEqual(cli.raw, gui.raw);
  await cli.editor.prepareContribution(); await gui.editor.prepareContribution();
  assert.deepEqual(cli.editor.document, gui.editor.document);
  for (const variant of cli.editor.document.contribution.variants) {
    assert.deepEqual(compileVariantTimeline(cli.editor.document.contribution, variant.variantId, videos), compileVariantTimeline(gui.editor.document.contribution, variant.variantId, videos));
    assert.deepEqual(await createPlannedMarkerProfile(cli.editor.document.contribution, variant.variantId, videos, "f".repeat(64)), await createPlannedMarkerProfile(gui.editor.document.contribution, variant.variantId, videos, "f".repeat(64)));
  }
  assert.match(gui.markup, /aria-label="Move Reverse right"/);
});

test("legacy and current contribution readers retain their scientific bytes after command read and explicit re-preparation", async () => {
  for (const data of [fixture, { workspace: legacyFixture.initialSnapshot.contribution, contribution: legacyFixture.contribution }]) {
    const ui = createUi(), saved = await projectSavedVariantCatalogue(data.workspace);
    const dependency = { ...source(), contribution: data.workspace };
    await ui.editor.restoreContribution(data.contribution, { dependencies: { P1: dependency } });
    assert.deepEqual(ui.owner.read().values["P3.contribution"], data.contribution);
    const raw = ui.raw; const staged = ui.editor.stageAuthoringDraftRestore(raw); staged.commit(); ui.editor.publishAuthoringDraft();
    assert.deepEqual(await createVariantDesign(ui.raw, saved.library), data.contribution);
    await ui.editor.prepareContribution(); assert.deepEqual(ui.editor.document.contribution, data.contribution);
  }
});

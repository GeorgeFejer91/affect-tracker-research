import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlannerAuthoringSession, PLANNER_REOPEN_STEPS } from "../site/src/research/planner-authoring-session.js";
import { createPlannerFileWorkflow } from "../site/src/research/planner-file-workflow.js";
import { createPackageExportController } from "../site/src/research/package-export-controller.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { parsePlannerRecipeV1 } from "../site/src/research/planner-recipe.js";
import { preparePlannerRecipeReopen, preparePlannerRecipeReopenV1 } from "../site/src/research/planner-recipe-restore.js";

const sourceText = await readFile(new URL("./fixtures/planner-recipe-current-v1.canonical.json", import.meta.url), "utf8");
const parsed = await parsePlannerRecipeV1(new TextEncoder().encode(sourceText));
const order = PLANNER_REOPEN_STEPS.slice(1, -1);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(options = {}) {
  let document = null, parsedCount = 0;
  const state = {}, prepared = [], committed = [], projected = [];
  const registry = createPlannerContributionRegistry();
  const exporter = createPackageExportController();
  for (const [segment, value] of Object.entries(parsed.recipe.segments)) {
    registry.register(segment, () => ({ revision: 1, enabled: segment !== "P6", pending: false,
      contribution: segment === "P6" ? null : value, dependencyRevisions: [] }), { validateContribution: async () => true });
  }
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) await registry.accept(segment);
  const legacyOwners = { begin() { document = null; } };
  for (const name of order) legacyOwners[name] = async () => true;
  const workflow = createPlannerFileWorkflow({ registry, exporter, getDocument: () => document,
    adoptDocument(value) { document = value; }, getRecipeOptions: () => {}, restoreOwners: legacyOwners,
    write: async () => { throw Error("Reopening must not write a file."); }, canOperate: () => true });
  let session;
  const hooks = {
    begin() { assert.equal(session.publishing, true); document = null; committed.push("begin"); },
    afterBegin() { projected.push("begin"); },
    adoptDocument(value) { assert.equal(session.publishing, true); document = value; committed.push("adoptDocument"); },
    afterAdoptDocument() { projected.push("adoptDocument"); },
  };
  for (const name of order) hooks[name] = async (value, context) => {
    assert.equal(session.publishing, false, "Asynchronous preparation is outside publication");
    assert.equal(context.isCurrent(), true);
    assert.equal(state[name], undefined, "This owner must not be installed before its preparation");
    if (["P3", "P4"].includes(name)) { assert.ok(state.P1); assert.ok(state.P5); }
    prepared.push(name);
    const replacement = await options.prepare?.(name, value, context, { state, workflow, session });
    if (replacement !== undefined) return replacement;
    let installed = false;
    return {
      isCurrent: () => !installed,
      commit() {
        assert.equal(session.publishing, true);
        options.commit?.(name, value, { state, workflow, session });
        state[name] = value; installed = true; committed.push(name);
      },
      afterCommit() { projected.push(name); options.project?.(name); },
    };
  };
  const parseDocument = async bytes => { parsedCount++; return (options.parseDocument ?? parsePlannerRecipeV1)(bytes); };
  const owner = { id: "P7", settings: [], operations: [],
    read: () => ({ values: {}, issues: [] }), stage() { throw Error("Unexpected draft edit."); },
    validate: () => document ? [] : [{ owner: "P7", code: "not_open", message: "Restoration is unfinished." }],
    consequences: [{ id: "openRecipe", publication: "sequence",
      arguments: { type: "object", additionalProperties: false, required: [], properties: {} } }],
    async prepareConsequence(_operation, _args, context) {
      const candidate = await workflow.prepareOpen(options.sourceText ?? sourceText, {
        isCurrent: context.isCurrent, parseDocument, prepareOwners: hooks,
      });
      assert.deepEqual(prepared, [], "Initial preparation does not touch an owner");
      return { isCurrent: candidate.isCurrent, async dispatch(publication) {
        publication.recordEffect({ kind: "sourceRead", sourceSha256: parsed.canonicalSourceByteSha256 });
        await candidate.applyViaPublication(publication);
        publication.finish({ sourceSha256: candidate.document.canonicalSourceByteSha256 });
      } };
    },
  };
  session = createPlannerAuthoringSession({ owners: [owner] });
  const command = (action, expectedRevision = null) => ({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision, action });
  return { workflow, session, registry, state, prepared, committed, projected, hooks, command,
    get document() { return document; }, get parsedCount() { return parsedCount; },
    run: () => session.execute(command({ kind: "perform", operation: "openRecipe", arguments: {} }, session.revision)) };
}

test("prepared Open publishes actual owner boundaries in dependency order and adopts the exact immutable source last", async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.status, "applied"); assert.deepEqual(result.issues, []);
  assert.equal(result.revision, 10); assert.equal(f.parsedCount, 1);
  assert.deepEqual(result.result.progress, { attempted: PLANNER_REOPEN_STEPS, completed: PLANNER_REOPEN_STEPS, finished: true });
  assert.deepEqual(f.prepared, order); assert.deepEqual(f.committed, PLANNER_REOPEN_STEPS);
  assert.deepEqual(f.projected, PLANNER_REOPEN_STEPS);
  assert.equal(f.document.canonicalSourceText, sourceText); assert.equal(f.workflow.canCopy(), true);
  assert.equal(f.workflow.opening, false);
  assert.ok(f.registry.readAccepted().entries.every(entry => entry.status === "missing"));
  f.state.P1.study.title = "Later owner edit";
  assert.equal(f.document.recipe.segments.P1.study.title, parsed.recipe.segments.P1.study.title);
});

test("the supported reader is explicit and the legacy reopen entrypoint remains strictly v1", async () => {
  await assert.rejects(preparePlannerRecipeReopen(sourceText, { isCurrent: () => true }), /explicit/u);
  const changed = JSON.parse(sourceText); changed.version = 2;
  await assert.rejects(preparePlannerRecipeReopenV1(JSON.stringify(changed), { isCurrent: () => true }));
  const f = await fixture({ parseDocument: async bytes => {
    assert.equal(new TextDecoder().decode(bytes), sourceText);
    return parsePlannerRecipeV1(bytes);
  } });
  assert.equal((await f.run()).status, "applied"); assert.equal(f.parsedCount, 1);
});

test("invalid source preserves the earlier saved document and acceptance without any publication", async () => {
  const f = await fixture({ sourceText: "{}\n" });
  await f.workflow.open(() => ({ kind: "planner-recipe-v1", document: parsed }));
  const previous = f.document;
  const result = await f.run();
  assert.equal(result.status, "rejected"); assert.equal(result.revision, 0);
  assert.deepEqual(f.committed, []); assert.deepEqual(f.prepared, []);
  assert.equal(f.document, previous); assert.equal(f.workflow.canCopy(), true);
});

test("cancellation during owner preparation blocks later commits and retains source-read and completed-step evidence", async () => {
  const waiting = deferred(), release = deferred();
  const f = await fixture({ async prepare(name) { if (name === "P2") { waiting.resolve(); await release.promise; } } });
  const request = f.command({ kind: "perform", operation: "openRecipe", arguments: {} }, 0);
  const running = f.session.execute(request);
  await waiting.promise;
  assert.equal(f.workflow.opening, true);
  const busy = await f.session.execute(f.command({ kind: "snapshot" }));
  assert.equal(busy.issues[0].code, "busy");
  const canceled = await f.session.execute(f.command({ kind: "cancel", requestId: request.requestId }));
  assert.equal(canceled.result.canceled, true);
  release.resolve();
  const result = await running;
  assert.equal(result.status, "incomplete"); assert.equal(result.result.effect.kind, "sourceRead");
  assert.deepEqual(result.result.progress.completed, ["begin", "P1"]);
  assert.deepEqual(f.committed, ["begin", "P1"]);
  assert.equal(f.document, null); assert.equal(f.workflow.canCopy(), false); assert.equal(f.workflow.opening, false);
  assert.deepEqual(await f.session.execute(request), result, "Exact retry returns retained evidence without another Open");
});

test("edits and teardown at preparation boundaries preserve newer state and never adopt a partial recipe", async () => {
  for (const stop of ["P1", "P2", "P4", "presentationTarget"]) for (const mode of ["edit", "destroy"]) {
    const f = await fixture({ prepare(name, _value, _context, { state, workflow, session }) {
      if (name === stop) {
        state[name] = "newer state";
        if (mode === "edit") { workflow.edited(); session.edited(); } else workflow.destroy();
      }
    } });
    const result = await f.run();
    assert.equal(result.status, "incomplete", `${stop}/${mode}`);
    assert.deepEqual(result.result.progress.completed, PLANNER_REOPEN_STEPS.slice(0, PLANNER_REOPEN_STEPS.indexOf(stop)));
    assert.equal(f.state[stop], "newer state"); assert.equal(f.document, null);
    assert.equal(f.workflow.canCopy(), false); assert.equal(f.workflow.opening, false);
  }
});

test("owner-only drift after preparation denies that state commit", async () => {
  const f = await fixture({ prepare(name) { if (name === "P2") return {
    isCurrent: () => false, commit() { assert.fail("Stale candidate committed"); },
  }; } });
  const result = await f.run();
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.result.progress.completed, ["begin", "P1"]);
  assert.equal(f.document, null);
});

test("malformed or asynchronous owner commits never masquerade as a completed synchronous restore", async () => {
  for (const kind of ["missing", "async", "promise"]) {
    let invoked = false;
    const f = await fixture({ prepare(name) {
      if (name !== "P2") return;
      if (kind === "missing") return {};
      if (kind === "async") return { async commit() { invoked = true; } };
      return { commit() { invoked = true; return Promise.reject(Error("Invalid asynchronous mutation")); } };
    } });
    const result = await f.run();
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.result.progress.completed, ["begin", "P1"]);
    assert.deepEqual(result.result.progress.attempted, kind === "promise" ? ["begin", "P1", "P2"] : ["begin", "P1"]);
    assert.equal(invoked, kind === "promise"); assert.equal(f.document, null);
  }
});

test("a throwing state boundary records its attempt, keeps earlier state, and stops subsequent restoration", async () => {
  const f = await fixture({ commit(name, _value, { state }) {
    if (name === "P4") { state.P4 = "partial owner failure"; throw Error("Owner failed"); }
  } });
  const result = await f.run();
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.result.progress.attempted, PLANNER_REOPEN_STEPS.slice(0, 6));
  assert.deepEqual(result.result.progress.completed, PLANNER_REOPEN_STEPS.slice(0, 5));
  assert.equal(result.revision, 6); assert.equal(f.state.P4, "partial owner failure");
  assert.equal(f.state.P6, undefined); assert.equal(f.document, null);
});

test("projection failure retains completed state and yields incomplete command evidence after complete restoration", async () => {
  const f = await fixture({ project(name) { if (name === "P2") throw Error("Refresh failed"); } });
  const result = await f.run();
  assert.equal(result.status, "incomplete"); assert.equal(result.issues[0].code, "projection_failed");
  assert.deepEqual(result.result.progress.completed, PLANNER_REOPEN_STEPS);
  assert.equal(result.result.progress.finished, true);
  assert.equal(f.workflow.canCopy(), true); assert.equal(f.document.canonicalSourceText, sourceText);
});

test("a later GUI Open supersedes pending read-only preparation without revoking the newer source", async () => {
  const f = await fixture(), pending = deferred(), release = deferred();
  const earlier = f.workflow.prepareOpen(sourceText, { isCurrent: () => true, prepareOwners: f.hooks,
    async parseDocument(bytes) { pending.resolve(); await release.promise; return parsePlannerRecipeV1(bytes); } });
  await pending.promise;
  await f.workflow.open(() => ({ kind: "planner-recipe-v1", document: parsed }));
  release.resolve(); await assert.rejects(earlier, /newer edit/u);
  assert.equal(f.workflow.canCopy(), true); assert.equal(f.document.canonicalSourceText, sourceText);
  assert.deepEqual(f.committed, []);
});

test("a prepared Open is single-use across the legacy and publication apply paths", async () => {
  const candidate = await preparePlannerRecipeReopenV1(sourceText, { isCurrent: () => true });
  const owners = { begin() {}, ...Object.fromEntries(order.map(name => [name, () => true])) };
  await candidate.apply(owners);
  await assert.rejects(candidate.applyViaPublication({}, {}), /new reopen/u);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { createPlannerFileWorkflow } from "../site/src/research/planner-file-workflow.js";
import { createPackageExportController } from "../site/src/research/package-export-controller.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { capturePlannerRecipeInputPreparedFeedback } from "../site/src/research/planner-recipe-capture.js";
import { canonicalJson } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV1, compilePlannerRecipeV2, parseSupportedPlannerRecipe } from "../site/src/research/planner-recipe.js";
import { plannerRecipeV2Fixture } from "./fixtures/planner-recipe-v2-fixture.js";

const legacySource = await readFile(new URL("./fixtures/planner-recipe-current-v1.canonical.json", import.meta.url), "utf8");
const legacy = JSON.parse(legacySource);
const typed = (await plannerRecipeV2Fixture()).recipe;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const receipt = document => ({ schema: "affect-research-planner-recipe-save-receipt", version: 1,
  recipeId: document.recipe.recipeId, definitionSha256: document.recipe.integrity.definitionSha256,
  canonicalSourceByteSha256: document.canonicalSourceByteSha256,
  byteLength: new TextEncoder().encode(document.canonicalSourceText).byteLength });
const feedbackStatus = registry => registry.readAccepted().entries.find(entry => entry.segment === "P5").status;

async function fixture(options = {}) {
  const recipe = options.recipe ?? legacy;
  let document = null, compiles = 0, reads = 0, prepared, projections = 0;
  const writes = [], snapshots = new Map();
  const registry = createPlannerContributionRegistry();
  const exporter = createPackageExportController();
  for (const [segment, value] of Object.entries(recipe.segments)) {
    snapshots.set(segment, { revision: 1, enabled: segment !== "P6" || value.status === "included", pending: false,
      contribution: segment === "P6" ? value.profile ?? null : value, dependencyRevisions: [] });
    registry.register(segment, () => snapshots.get(segment), { validateContribution: async () => true });
  }
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) await registry.accept(segment);
  const recipeOptions = { recipeId: recipe.recipeId, policy: recipe.policy, presentationTarget: recipe.presentationTarget };
  const legacyOwners = { begin() { document = null; } };
  for (const name of ["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"]) legacyOwners[name] = async () => true;
  let session;
  const workflow = createPlannerFileWorkflow({ registry, exporter, getDocument: () => document,
    adoptDocument(value) { document = value; }, getRecipeOptions: () => recipeOptions, restoreOwners: legacyOwners,
    write: async () => { throw Error("Unexpected legacy writer."); }, canOperate: () => true });
  const parseDocument = async bytes => { reads++; return parseSupportedPlannerRecipe(bytes); };
  const owner = { id: "P7", settings: [], operations: [], read: () => ({ values: {}, issues: [] }),
    stage() { throw Error("Unexpected draft edit."); },
    validate: () => document ? [] : [{ owner: "P7", code: "not_saved", message: "Not saved." }],
    consequences: [{ id: "saveRecipe", arguments: { type: "object", additionalProperties: false, required: [], properties: {} } }],
    async prepareConsequence(_name, _args, context) {
      prepared = await workflow.prepareSave({ ...context, parseDocument,
        captureInput: capturePlannerRecipeInputPreparedFeedback,
        async compileDocument(input) {
          compiles++;
          assert.equal(feedbackStatus(registry), "missing", "P5 acceptance must not publish during compilation");
          assert.equal(writes.length, 0);
          await options.compile?.({ input, workflow, session, registry });
          const value = await (input.version === 2 ? compilePlannerRecipeV2 : compilePlannerRecipeV1)(input);
          return parseDocument(new TextEncoder().encode(`${canonicalJson(value)}\n`));
        },
        adoptDocument(value) {
          assert.equal(session.publishing, true);
          options.adopt?.(value);
          document = value;
        },
        afterAdoptDocument() { projections++; options.project?.(); },
      });
      return { isCurrent: prepared.isCurrent, dispatch: publication => prepared.dispatch({ ...publication,
        async write(value, lifetime) {
          assert.equal(session.publishing, false);
          if (!document) assert.equal(feedbackStatus(registry), "missing");
          assert.equal(lifetime.isCurrent(), true);
          publication.recordEffect({ kind: "write", possiblyChanged: true });
          writes.push(value);
          const ack = options.write ? await options.write(value, { workflow, session, registry, lifetime }) : receipt(value);
          publication.recordEffect({ kind: "write", acknowledgement: ack });
          return ack;
        },
      }) };
    },
  };
  session = createPlannerAuthoringSession({ owners: [owner] });
  const command = (action, expectedRevision = null) => ({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision, action });
  return { registry, snapshots, exporter, workflow, session, writes, command,
    get document() { return document; }, get compiles() { return compiles; }, get reads() { return reads; },
    get prepared() { return prepared; }, get projections() { return projections; },
    run: () => session.execute(command({ kind: "perform", operation: "saveRecipe", arguments: {} }, session.revision)) };
}

test("fresh v1 and mixed v2 saves compile read-only and publish P5 plus exact saved source only after acknowledgement", async () => {
  for (const recipe of [legacy, typed]) {
    const f = await fixture({ recipe });
    const result = await f.run();
    assert.equal(result.status, "applied"); assert.equal(result.revision, 1); assert.deepEqual(result.issues, []);
    assert.equal(result.result.result.status, "saved"); assert.equal(f.writes.length, 1);
    assert.equal(f.compiles, 1); assert.equal(f.document.recipe.version, recipe.version);
    assert.deepEqual(f.document.recipe, recipe); assert.equal(feedbackStatus(f.registry), "accepted");
    assert.deepEqual(result.result.result.receipt, receipt(f.document));
    assert.equal(f.workflow.canCopy(), true); assert.equal(f.exporter.snapshot().phase, "saved");
    assert.equal(f.projections, 1);
    assert.ok(JSON.stringify(result).length < 2500, "Retained result must not embed master source");
  }
});

test("an unchanged saved copy is parsed and reexported without recompilation or reacceptance", async () => {
  const f = await fixture(); assert.equal((await f.run()).status, "applied");
  const before = f.document, acceptance = f.registry.getAcceptanceGeneration();
  const result = await f.run();
  assert.equal(result.status, "applied"); assert.equal(result.revision, 2);
  assert.equal(f.compiles, 1); assert.equal(f.reads, 2); assert.equal(f.writes.length, 2);
  assert.equal(f.registry.getAcceptanceGeneration(), acceptance);
  assert.equal(f.document.canonicalSourceText, before.canonicalSourceText);
});

test("all other sections require real current acceptance, including an explicit optional exclusion", async () => {
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) {
    const f = await fixture();
    if (segment === "P6") f.registry.clearAcceptance(); else f.registry.invalidateAcceptance(segment);
    const result = await f.run();
    assert.equal(result.status, "rejected"); assert.equal(f.writes.length, 0); assert.equal(f.compiles, 0);
    assert.equal(feedbackStatus(f.registry), "missing"); assert.equal(f.document, null);
  }
});

test("edits, cancellation and disposal while compiling prevent any write or P5 acceptance", async () => {
  for (const mode of ["edit", "cancel", "dispose"]) {
    const compiling = deferred(), release = deferred();
    const f = await fixture({ async compile() { compiling.resolve(); await release.promise; } });
    const request = f.command({ kind: "perform", operation: "saveRecipe", arguments: {} }, 0);
    const running = f.session.execute(request); await compiling.promise;
    if (mode === "edit") { f.workflow.edited(); f.session.edited(); }
    else if (mode === "dispose") f.workflow.destroy();
    else await f.session.execute(f.command({ kind: "cancel", requestId: request.requestId }));
    release.resolve(); const result = await running;
    assert.notEqual(result.status, "applied"); assert.equal(f.writes.length, 0);
    assert.equal(feedbackStatus(f.registry), "missing"); assert.equal(f.document, null);
  }
});

test("late acknowledged writes retain exact saved-older-revision evidence without accepting or adopting changed content", async () => {
  for (const mode of ["edit", "cancel", "dispose"]) {
    const writing = deferred(), release = deferred();
    const f = await fixture({ async write(value) { writing.resolve(); await release.promise; return receipt(value); } });
    const request = f.command({ kind: "perform", operation: "saveRecipe", arguments: {} }, 0);
    const running = f.session.execute(request); await writing.promise;
    if (mode === "edit") { f.workflow.edited(); f.session.edited(); }
    else if (mode === "dispose") f.workflow.destroy();
    else await f.session.execute(f.command({ kind: "cancel", requestId: request.requestId }));
    release.resolve(); const result = await running;
    assert.equal(result.status, "incomplete"); assert.equal(result.result.published, false);
    assert.deepEqual(result.result.effect.acknowledgement, receipt(f.writes[0]));
    assert.equal(result.result.result.status, "saved-older-revision");
    assert.equal(f.document, null); assert.equal(feedbackStatus(f.registry), "missing");
    assert.equal(f.exporter.snapshot().saved.receipt.byteLength, receipt(f.writes[0]).byteLength);
    assert.deepEqual(await f.session.execute(request), result); assert.equal(f.writes.length, 1);
  }
});

test("failed, canceled and mismatched writes never publish acceptance or saved-source adoption", async () => {
  for (const mode of ["failure", "cancel", "mismatch"]) {
    const f = await fixture({ write(value) {
      if (mode === "failure") throw Error("Storage failed");
      return mode === "cancel" ? null : { ...receipt(value), byteLength: 1 };
    } });
    const result = await f.run();
    assert.equal(result.status, "incomplete"); assert.equal(result.result.published, false);
    assert.equal(feedbackStatus(f.registry), "missing"); assert.equal(f.document, null);
    assert.equal(f.workflow.canCopy(), false);
    assert.equal(result.result.effect.kind, "write");
  }
});

test("failed state adoption retains the acknowledged file and published revision without claiming current source association", async () => {
  const f = await fixture({ adopt() { throw Error("State adoption failed"); } });
  const result = await f.run();
  assert.equal(result.status, "incomplete"); assert.equal(result.revision, 1);
  assert.equal(result.result.published, true); assert.equal(result.result.effect.kind, "write");
  assert.equal(f.document, null); assert.equal(f.workflow.canCopy(), false);
  assert.equal(feedbackStatus(f.registry), "accepted", "No rollback over a partly published owner transition");
  assert.deepEqual(f.exporter.snapshot().saved.receipt, receipt(f.writes[0]));
});

test("projection failure retains saved state and exact acknowledgement while reporting incomplete refresh", async () => {
  const f = await fixture({ project() { throw Error("Refresh failed"); } });
  const result = await f.run();
  assert.equal(result.status, "incomplete"); assert.equal(result.issues[0].code, "projection_failed");
  assert.equal(result.result.result.status, "saved"); assert.equal(f.workflow.canCopy(), true);
  assert.equal(feedbackStatus(f.registry), "accepted");
});

test("prepared capture rejects substituted feedback and expires permanently on actual dependency or acceptance changes", async () => {
  const f = await fixture(), controller = new AbortController();
  const options = { recipeId: legacy.recipeId, policy: legacy.policy, presentationTarget: legacy.presentationTarget, isCurrent: () => true };
  const feedback = await f.registry.prepareAcceptance("P5", { isCurrent: options.isCurrent, signal: controller.signal });
  const changed = feedback.snapshot; changed.revision++;
  assert.throws(() => capturePlannerRecipeInputPreparedFeedback(f.registry, { ...options,
    preparedFeedback: { isCurrent: () => true, snapshot: changed } }), /exact current/u);
  const captured = capturePlannerRecipeInputPreparedFeedback(f.registry, { ...options, preparedFeedback: feedback });
  assert.equal(captured.isCurrent(), true); assert.equal(feedbackStatus(f.registry), "missing");
  f.registry.clearAcceptance(); assert.equal(captured.isCurrent(), false);
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) await f.registry.accept(segment);
  assert.equal(captured.isCurrent(), false);
  assert.equal(captured.input.version, 1); assert.deepEqual(captured.input.segments.P5, legacy.segments.P5);
});

test("prepared save dispatch is single-use and successful exact retries do not write again", async () => {
  const f = await fixture(), request = f.command({ kind: "perform", operation: "saveRecipe", arguments: {} }, 0);
  const result = await f.session.execute(request);
  assert.equal(result.status, "applied");
  assert.deepEqual(await f.session.execute(request), result); assert.equal(f.writes.length, 1);
  await assert.rejects(f.prepared.dispatch(), /new Save/u);
});

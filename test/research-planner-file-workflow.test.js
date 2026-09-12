import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlannerFileWorkflow } from "../site/src/research/planner-file-workflow.js";
import { createPackageExportController } from "../site/src/research/package-export-controller.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { parsePlannerRecipeV1 } from "../site/src/research/planner-recipe.js";

const sourceText = await readFile(new URL("./fixtures/planner-recipe-v1.canonical.json", import.meta.url), "utf8");
const parsed = await parsePlannerRecipeV1(new TextEncoder().encode(sourceText));
function receipt(document) {
  return { schema: "affect-research-planner-recipe-save-receipt", version: 1,
    recipeId: document.recipe.recipeId, definitionSha256: document.recipe.integrity.definitionSha256,
    canonicalSourceByteSha256: document.canonicalSourceByteSha256,
    byteLength: new TextEncoder().encode(document.canonicalSourceText).byteLength };
}
async function fixture({ restore = async () => true, write = async document => receipt(document) } = {}) {
  let document = null, restores = 0, writes = 0;
  const exporter = createPackageExportController();
  const registry = createPlannerContributionRegistry();
  for (const [segment, value] of Object.entries(parsed.recipe.segments)) {
    registry.register(segment, () => ({ revision: 1, enabled: segment !== "P6", pending: false,
      contribution: segment === "P6" ? null : value, dependencyRevisions: [] }), { validateContribution: async () => true });
  }
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) await registry.accept(segment);
  const owners = { begin() { document = null; } };
  for (const key of ["P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"]) owners[key] = async (...args) => { restores++; return restore(key, ...args); };
  const workflow = createPlannerFileWorkflow({ registry, exporter, getDocument: () => document,
    adoptDocument: value => { document = value; }, getRecipeOptions: () => ({ recipeId: parsed.recipe.recipeId,
      policy: parsed.recipe.policy, presentationTarget: parsed.recipe.presentationTarget }), restoreOwners: owners,
    write: async (...args) => { writes++; return write(...args); }, canOperate: () => true });
  return { workflow, registry, exporter, get document() { return document; }, get restores() { return restores; }, get writes() { return writes; } };
}
const selected = () => ({ kind: "planner-recipe-v1", document: parsed });

test("final capture accepts P5 then compiles all sections; acknowledged save never restores owners", async () => {
  const f = await fixture();
  assert.equal(f.registry.readAccepted().entries.find(x => x.segment === "P5").status, "missing");
  assert.equal((await f.workflow.save()).status, "saved");
  assert.equal(f.document.canonicalSourceText, sourceText);
  assert.equal(f.restores, 0);
  assert.equal(f.workflow.canCopy(), true);
  assert.equal(f.exporter.snapshot().phase, "saved");
});

test("complete Open restores all owners, clears acceptance and permits exact unchanged copy without media readiness", async () => {
  const f = await fixture();
  assert.equal(await f.workflow.open(selected), true);
  assert.equal(f.restores, 8);
  assert.equal(f.registry.readAccepted().entries[0].status, "missing");
  f.registry.changed("P1");
  assert.equal(f.workflow.canCopy(), true);
  assert.equal((await f.workflow.save()).status, "saved");
  assert.equal(f.document.canonicalSourceText, sourceText);
  assert.equal(f.restores, 8);
});

test("cancelled Open preserves prior source; invalid file never begins restoration", async () => {
  const f = await fixture(); await f.workflow.open(selected);
  const before = f.document;
  assert.equal(await f.workflow.open(() => null), null);
  assert.equal(f.document, before); assert.equal(f.workflow.canCopy(), true);
  await assert.rejects(f.workflow.open(() => ({ kind: "planner-recipe-v1", document: { canonicalSourceText: "{}\n" } })));
  assert.equal(f.document, before); assert.equal(f.restores, 8);
});

test("partial restoration revokes old source eligibility and never adopts the incomplete file", async () => {
  let fail = false;
  const f = await fixture({ restore: key => { if (fail && key === "P4") throw Error("owner failed"); return true; } });
  await f.workflow.open(selected); fail = true;
  await assert.rejects(f.workflow.open(selected), /some fields/u);
  assert.equal(f.document, null); assert.equal(f.workflow.canCopy(), false);
});

test("a late edit, even reverted, or a superseding Open prevents old adoption", async () => {
  const f = await fixture(); let finish;
  const pending = f.workflow.open(() => new Promise(resolve => { finish = resolve; }));
  f.workflow.edited(); f.workflow.edited(); finish(selected());
  await assert.rejects(pending, /changed/u); assert.equal(f.document, null);
  const older = f.workflow.open(() => new Promise(resolve => { finish = resolve; }));
  await f.workflow.open(selected); finish(selected());
  await assert.rejects(older, /changed/u); assert.equal(f.workflow.canCopy(), true);
});

test("cancel/retry, bad acknowledgement, and an edit during writing never mark unsaved edits complete", async () => {
  let outcome = "cancel", f;
  f = await fixture({ write: document => {
    if (outcome === "cancel") return null;
    if (outcome === "bad") return { ...receipt(document), byteLength: 0 };
    if (outcome === "edit") f.workflow.edited();
    return receipt(document);
  } });
  assert.equal((await f.workflow.save()).status, "cancelled"); assert.equal(f.document, null);
  outcome = "bad"; await assert.rejects(f.workflow.save(), /exact/u); assert.equal(f.document, null);
  outcome = "edit"; assert.equal((await f.workflow.save()).status, "saved-older-revision");
  assert.equal(f.document, null); assert.notEqual(f.exporter.snapshot().phase, "saved");
  outcome = "success"; assert.equal((await f.workflow.save()).status, "saved");
  f.workflow.edited(); assert.equal(f.workflow.canCopy(), false);
});

test("teardown during restoration prevents source adoption", async () => {
  let f;
  f = await fixture({ restore: key => { if (key === "P2") f.workflow.destroy(); return true; } });
  await assert.rejects(f.workflow.open(selected), /some fields/u);
  assert.equal(f.document, null); assert.equal(f.workflow.canCopy(), false);
});

test("capture-phase invalidation fences now without reading producers before their edit handler", async () => {
  let notifications = 0;
  const exporter = createPackageExportController({ onChange: () => { notifications++; } });
  const before = exporter.snapshot().revision;
  exporter.invalidate({ notify: false });
  assert.equal(exporter.snapshot().revision, before + 1);
  assert.equal(notifications, 0);
  exporter.invalidate(); assert.equal(notifications, 1);
});

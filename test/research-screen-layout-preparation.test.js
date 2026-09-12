import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createScreenLayoutState } from "../site/src/research/screen-layout-state.js";
import { createScreenLayoutDraft, resolveScreenLayoutDraft } from "../site/src/research/screen-layout-draft.js";
import { desktopLayoutDraftFromProfile, desktopLayoutProfileFromDraft } from "../site/src/research/desktop-layout-contribution.js";
import { validateDesktopLayoutProfileV1 } from "../site/src/research/desktop-layout.js";
const fixture = JSON.parse(await readFile(new URL("./fixtures/desktop-layout-candidates-v1.json", import.meta.url), "utf8"));
const profile = () => structuredClone(fixture.cases[0].profile);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Isolate lifecycle behavior with a shape validator. Full production P1/P5
// composition is covered by the contribution and actual UI tests.
function harness() {
  let p1 = 31, p5 = 9, pause = null;
  const changes = [];
  const state = createScreenLayoutState({
    resolve: d => ({ ...resolveScreenLayoutDraft(d), dependencyRevisions: [{ segment: "P1", revision: p1 }, { segment: "P5", revision: p5 }], dependencyIdentity: { p1, p5 } }),
    prepareDraft: async d => { if (pause) await pause; return desktopLayoutProfileFromDraft(d, fixture.media, "largest-oriented-area"); },
    validateContribution: async p => { if (pause) await pause; return validateDesktopLayoutProfileV1(p); },
    onChange: s => changes.push(s),
  });
  state.replaceDraft(desktopLayoutDraftFromProfile(profile()));
  return { state, changes, delay: promise => { pause = promise; }, changeP1() { p1 += 1; state.refreshDependencies(); }, changeP5() { p5 += 1; state.refreshDependencies(); } };
}

test("preparation yields one detached contribution, no-op refresh preserves it, edits and both owners withdraw it", async () => {
  const h = harness(); assert.equal(h.state.getSnapshot().pending, true);
  const prepared = await h.state.prepareContribution(); assert.equal(prepared.pending, false);
  assert.deepEqual(prepared.contribution, profile()); assert.equal(prepared.enabled, true);
  prepared.contribution.feedback.offset.x = 888;
  assert.equal(h.state.getSnapshot().contribution.feedback.offset.x, 0);
  const before = h.state.getSnapshot(); h.state.refreshDependencies(); assert.deepEqual(h.state.getSnapshot(), before);
  h.state.replaceDraft({ ...h.state.draft, offsetX: 8 }); assert.equal(h.state.getSnapshot().pending, true);
  await h.state.prepareContribution(); h.changeP1(); assert.equal(h.state.getSnapshot().contribution, null);
  await h.state.prepareContribution(); h.changeP5(); assert.equal(h.state.getSnapshot().contribution, null);
});

test("slow preparation is fenced by edits, dependencies, cancellation, newer requests and teardown", async () => {
  for (const action of [h => h.state.replaceDraft({ ...h.state.draft, gap: 2 }), h => h.changeP1(), h => h.changeP5(), h => h.state.destroy()]) {
    const h = harness(), wait = deferred(); h.delay(wait.promise);
    const preparing = h.state.prepareContribution(); action(h); wait.resolve(); await assert.rejects(preparing, /stale/u);
    assert.equal(h.state.getSnapshot().contribution, null);
  }
  const h = harness(), wait = deferred(); h.delay(wait.promise);
  const first = h.state.prepareContribution(), next = h.state.prepareContribution(); wait.resolve();
  await assert.rejects(first, /stale/u); assert.equal((await next).pending, false);
  await assert.rejects(h.state.prepareContribution({ isCurrent: () => false }), /stale/u);
});

test("content-only reopen renders editable fields with actual dependencies and requires preparation", async () => {
  const h = harness(), value = profile(); value.feedback.offset.x = 12;
  const restored = await h.state.restoreContribution(value, { contentOnly: true });
  assert.equal(restored.pending, true); assert.equal(restored.contribution, null);
  assert.equal(h.state.draft.offsetX, 12);
  assert.deepEqual(restored.dependencyRevisions, [{ segment: "P1", revision: 31 }, { segment: "P5", revision: 9 }]);
  h.state.replaceDraft({ ...h.state.draft, offsetX: 15 }); h.changeP1();
  assert.equal(h.state.draft.offsetX, 15);
  assert.equal((await h.state.prepareContribution()).contribution.feedback.offset.x, 15);
});

test("ready restore commits once; invalid/stale/cancelled and racing restores never replace newer authoring", async () => {
  const h = harness(); const count = h.changes.length;
  const next = profile(); next.feedback.offset.x = 4;
  const result = await h.state.restoreContribution(next);
  assert.equal(h.changes.length, count + 1); assert.equal(result.pending, false); assert.equal(result.contribution.feedback.offset.x, 4);
  const before = h.state.getSnapshot(), malformed = profile(); malformed.unknown = true;
  await assert.rejects(h.state.restoreContribution(malformed)); assert.deepEqual(h.state.getSnapshot(), before);
  await assert.rejects(h.state.restoreContribution(profile(), { isCurrent: () => false })); assert.deepEqual(h.state.getSnapshot(), before);
  const wait = deferred(); h.delay(wait.promise);
  const first = h.state.restoreContribution(profile(), { contentOnly: true });
  const secondValue = profile(); secondValue.feedback.offset.x = 7;
  const second = h.state.restoreContribution(secondValue, { contentOnly: true });
  wait.resolve(); await assert.rejects(first, /stale/u); await second; assert.equal(h.state.draft.offsetX, 7);
});

test("internal draft restore supersedes contribution restore and cannot install imported revisions", async () => {
  const h = harness(), wait = deferred(); h.delay(wait.promise);
  const first = h.state.restoreContribution(profile());
  const document = h.state.getDraftDocument(); document.draft.offsetX = 11;
  await h.state.restoreDraft(document); wait.resolve(); await assert.rejects(first, /stale/u);
  assert.equal(h.state.draft.offsetX, 11); assert.equal(h.state.getSnapshot().pending, true);
  await assert.rejects(h.state.restoreDraft({ ...document, dependencyRevisions: [{ segment: "P1", revision: 99 }] }));
});

test("production state has no accepting default or serializer for its internal draft", async () => {
  const state = createScreenLayoutState(); state.replaceDraft(createScreenLayoutDraft());
  await assert.rejects(state.prepareContribution(), /dependencies/u);
  await assert.rejects(state.restoreContribution(profile()));
  assert.equal(state.getSnapshot().pending, true); assert.equal(state.getSnapshot().contribution, null);
});

test("synchronous producer invalidation during the final getter also fences preparation", async () => {
  let state, invalidate = false, dependency = 3;
  state = createScreenLayoutState({
    resolve: d => {
      if (invalidate) { invalidate = false; dependency += 1; state.refreshDependencies(); }
      return { ...resolveScreenLayoutDraft(d), dependencyIdentity: { dependency } };
    },
    prepareDraft: async () => { invalidate = true; return profile(); },
  });
  await assert.rejects(state.prepareContribution(), /stale/u);
  assert.equal(state.getSnapshot().contribution, null);
});

test("historical internal draft reader preserves v1 and restores the new policy unselected", async () => {
  const h = harness();
  const old = h.state.getDraftDocument(); old.version = 1; delete old.draft.referencePolicy;
  await h.state.restoreDraft(old);
  assert.equal(h.state.getDraftDocument().version, 2);
  assert.equal(h.state.draft.referencePolicy, null);
  assert.equal(h.state.getSnapshot().pending, true);
  await assert.rejects(h.state.restoreDraft({ ...old, draft: { ...old.draft, referencePolicy: "largest-oriented-area" } }));
});

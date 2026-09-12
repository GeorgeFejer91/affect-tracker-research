import { canonicalJson } from "./canonical.js";
import { createScreenLayoutDraft, resolveScreenLayoutDraft } from "./screen-layout-draft.js";

export const SCREEN_LAYOUT_DRAFT_SCHEMA = "affect-research-screen-layout-draft";
const fields = Object.keys(createScreenLayoutDraft());
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Recoverable authoring state only. Never an accepted desktop layout contract. */
export function validateScreenLayoutDraftDocument(value) {
  if (!exact(value, ["schema", "version", "draft"]) || value.schema !== SCREEN_LAYOUT_DRAFT_SCHEMA || value.version !== 1
    || !exact(value.draft, fields)) throw new TypeError("Unsupported or malformed screen layout draft.");
  const draft = value.draft;
  for (const field of fields) {
    const raw = draft[field];
    const valid = field === "units" ? ["relative", "mm"].includes(raw)
      : field === "fullViewportMapping" ? typeof raw === "boolean"
        : (typeof raw === "string" && raw.length <= 128) || (typeof raw === "number" && Number.isFinite(raw));
    if (!valid) throw new TypeError(`Invalid screen layout draft field: ${field}.`);
  }
  return structuredClone(value);
}

export function validateScreenLayoutContribution() {
  throw new TypeError("Screen layout cannot be accepted until the largest-video reference rule and desktop geometry contract are confirmed.");
}

/** P4 alone owns draft revisions. Dependency receipts are derived, never restored. */
export function createScreenLayoutState({ resolve = resolveScreenLayoutDraft, onChange = () => {} } = {}) {
  let draft = createScreenLayoutDraft();
  let revision = 0;
  let alive = true;
  let projection = resolve(draft);
  let dependencyIdentity = canonicalJson(projection.dependencyIdentity ?? null);
  const snapshot = () => ({ revision, enabled: true, pending: true, contribution: null,
    dependencyRevisions: structuredClone(projection.dependencyRevisions ?? []) });
  function commit(next, nextProjection, force = false) {
    if (!alive) throw new Error("Screen layout editor has been destroyed.");
    const identity = canonicalJson(nextProjection.dependencyIdentity ?? null);
    const changed = force || canonicalJson(next) !== canonicalJson(draft) || identity !== dependencyIdentity;
    if (changed && revision === Number.MAX_SAFE_INTEGER) throw new RangeError("Screen layout revision limit reached.");
    draft = structuredClone(next);
    projection = nextProjection;
    dependencyIdentity = identity;
    if (changed) { revision += 1; onChange(snapshot()); }
    return snapshot();
  }
  return Object.freeze({
    get draft() { return structuredClone(draft); },
    get projection() { return structuredClone(projection); },
    getSnapshot: snapshot,
    getDraftDocument() { return { schema: SCREEN_LAYOUT_DRAFT_SCHEMA, version: 1, draft: structuredClone(draft) }; },
    replaceDraft(next) {
      next = validateScreenLayoutDraftDocument({ schema: SCREEN_LAYOUT_DRAFT_SCHEMA, version: 1, draft: next }).draft;
      return commit(next, resolve(next));
    },
    refreshDependencies() { return commit(draft, resolve(draft)); },
    async restoreDraft(document, { isCurrent = () => true } = {}) {
      const next = validateScreenLayoutDraftDocument(document).draft;
      const expectedRevision = revision;
      // A restoration is a transaction; interleaved edits or teardown cancel it.
      await Promise.resolve();
      const nextProjection = resolve(next);
      if (!alive || revision !== expectedRevision || isCurrent() !== true) throw new Error("Screen layout restoration became stale.");
      return commit(next, nextProjection, true);
    },
    destroy() { alive = false; },
  });
}

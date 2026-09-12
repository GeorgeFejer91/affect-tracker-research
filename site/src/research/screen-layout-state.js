import { canonicalJson } from "./canonical.js";
import { createScreenLayoutDraft, resolveScreenLayoutDraft } from "./screen-layout-draft.js";
import { validateDesktopLayoutContribution, desktopLayoutDraftFromProfile } from "./desktop-layout-contribution.js";
import { DESKTOP_REFERENCE_POLICIES } from "./desktop-layout.js";

export const SCREEN_LAYOUT_DRAFT_SCHEMA = "affect-research-screen-layout-draft";
const fields = Object.keys(createScreenLayoutDraft());
const legacyFields = fields.filter(field => field !== "referencePolicy");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Recoverable authoring state only. Never an accepted desktop layout contract. */
export function validateScreenLayoutDraftDocument(value) {
  if (!exact(value, ["schema", "version", "draft"]) || value.schema !== SCREEN_LAYOUT_DRAFT_SCHEMA || ![1, 2].includes(value.version)
    || !exact(value.draft, value.version === 1 ? legacyFields : fields)) throw new TypeError("Unsupported or malformed screen layout draft.");
  const draft = value.draft;
  for (const field of value.version === 1 ? legacyFields : fields) {
    const raw = draft[field];
    const valid = field === "units" ? ["relative", "mm"].includes(raw)
      : field === "referencePolicy" ? raw === null || DESKTOP_REFERENCE_POLICIES.includes(raw)
      : field === "fullViewportMapping" ? typeof raw === "boolean"
        : (typeof raw === "string" && raw.length <= 128) || (typeof raw === "number" && Number.isFinite(raw));
    if (!valid) throw new TypeError(`Invalid screen layout draft field: ${field}.`);
  }
  return structuredClone(value);
}

export const validateScreenLayoutContribution = validateDesktopLayoutContribution;

/** P4 alone owns draft revisions. Dependency receipts are derived, never restored. */
export function createScreenLayoutState({ resolve = resolveScreenLayoutDraft, onChange = () => {},
  prepareDraft = () => { throw new TypeError("Verified layout dependencies are required."); },
  validateContribution = validateDesktopLayoutContribution } = {}) {
  let draft = createScreenLayoutDraft();
  let revision = 0;
  let alive = true;
  let operation = 0;
  let contribution = null;
  let projection = resolve(draft);
  let dependencyIdentity = canonicalJson(projection.dependencyIdentity ?? null);
  const snapshot = () => ({ revision, enabled: true, pending: contribution === null, contribution: structuredClone(contribution),
    dependencyRevisions: structuredClone(projection.dependencyRevisions ?? []) });
  function commit(next, nextProjection, force = false, restoredContribution = null) {
    if (!alive) throw new Error("Screen layout editor has been destroyed.");
    const identity = canonicalJson(nextProjection.dependencyIdentity ?? null);
    const changed = force || canonicalJson(next) !== canonicalJson(draft) || identity !== dependencyIdentity;
    if (changed && revision === Number.MAX_SAFE_INTEGER) throw new RangeError("Screen layout revision limit reached.");
    draft = structuredClone(next);
    projection = nextProjection;
    dependencyIdentity = identity;
    if (changed) { revision += 1; operation += 1; contribution = structuredClone(restoredContribution); onChange(snapshot()); }
    return snapshot();
  }
  function current(expectedRevision, expectedOperation, isCurrent) {
    // Producer reads may synchronously publish an invalidation. Recheck the
    // revision/generation after resolving, not before invoking those getters.
    const identity = alive ? canonicalJson(resolve(draft).dependencyIdentity ?? null) : null;
    if (!alive || revision !== expectedRevision || operation !== expectedOperation || isCurrent() !== true
      || identity !== dependencyIdentity) {
      throw new Error("Screen layout operation became stale.");
    }
  }
  function prepared(value) {
    if (canonicalJson(value) !== canonicalJson(contribution)) {
      if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError("Screen layout revision limit reached.");
      contribution = structuredClone(value); revision += 1; onChange(snapshot());
    }
    return snapshot();
  }
  return Object.freeze({
    get draft() { return structuredClone(draft); },
    get projection() { return structuredClone(projection); },
    getSnapshot: snapshot,
    getDraftDocument() { return { schema: SCREEN_LAYOUT_DRAFT_SCHEMA, version: 2, draft: structuredClone(draft) }; },
    replaceDraft(next) {
      next = validateScreenLayoutDraftDocument({ schema: SCREEN_LAYOUT_DRAFT_SCHEMA, version: 2, draft: next }).draft;
      return commit(next, resolve(next));
    },
    refreshDependencies() { return commit(draft, resolve(draft)); },
    async restoreDraft(document, { isCurrent = () => true } = {}) {
      const validated = validateScreenLayoutDraftDocument(document);
      // Preserve the historical v1 reader. Explicit draft restoration upgrades
      // only editable content and leaves the new choice unselected.
      const next = validated.version === 1 ? { ...validated.draft, referencePolicy: null } : validated.draft;
      const expectedRevision = revision;
      const expectedOperation = ++operation;
      // A restoration is a transaction; interleaved edits or teardown cancel it.
      await Promise.resolve();
      const nextProjection = resolve(next);
      current(expectedRevision, expectedOperation, isCurrent);
      return commit(next, nextProjection, true);
    },
    async prepareContribution({ isCurrent = () => true } = {}) {
      const expectedRevision = revision, expectedOperation = ++operation;
      let value;
      try { value = await prepareDraft(structuredClone(draft)); }
      catch (error) { current(expectedRevision, expectedOperation, isCurrent); throw error; }
      current(expectedRevision, expectedOperation, isCurrent);
      return prepared(value);
    },
    async restoreContribution(value, { isCurrent = () => true, contentOnly = false, ...dependencies } = {}) {
      const expectedRevision = revision, expectedOperation = ++operation;
      let validated;
      try { validated = await validateContribution(structuredClone(value), dependencies); }
      catch (error) { current(expectedRevision, expectedOperation, isCurrent); throw error; }
      const next = desktopLayoutDraftFromProfile(validated);
      const nextProjection = resolve(next);
      current(expectedRevision, expectedOperation, isCurrent);
      return commit(next, nextProjection, true, contentOnly ? null : validated);
    },
    destroy() { alive = false; operation += 1; contribution = null; },
  });
}

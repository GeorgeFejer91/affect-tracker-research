import { canonicalJson } from "./canonical.js";
import { validateInputBindingV1, validateVisualSettingsV1 } from "./contracts.js";
import { FLUBBER_MAPPING_SPECS, validateFlubberMapping } from "./mappings.js";
import { resolveFeedbackEnvelopeV1 } from "./feedback-envelope.js";

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} requires exactly ${keys.join(", ")}.`);
  }
}

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Existing saved v1 meanings only. This internal contribution is not a new
 * recipe schema and cannot carry Q10 simulator fields or caller-supplied bounds. */
export function validateFeedbackContributionV1(value) {
  exactKeys(value, ["input", "visual", "mappings"], "Feedback contribution");
  const keys = Object.keys(FLUBBER_MAPPING_SPECS);
  exactKeys(value.mappings, keys, "Feedback mappings");
  return freeze({
    input: validateInputBindingV1(value.input),
    visual: validateVisualSettingsV1(value.visual),
    mappings: Object.freeze(Object.fromEntries(keys.map((key) =>
      [key, validateFlubberMapping(key, value.mappings[key])]))),
  });
}

/** One revision source for final capture and layout consumers. Reads validate
 * current controls, including invalid edits, rather than a last-valid cache.
 * Preview movement and simulator drafts are deliberately absent from the reader. */
export function createFeedbackContributionSource(readConfiguration, {
  validate = validateFeedbackContributionV1, resolveEnvelope = resolveFeedbackEnvelopeV1,
} = {}) {
  if (typeof readConfiguration !== "function") throw new TypeError("A feedback reader is required.");
  if (typeof validate !== "function" || typeof resolveEnvelope !== "function") throw new TypeError("Feedback validators are required.");
  let snapshot = null;
  let fingerprint = null;
  let destroyed = false;
  const listeners = new Set();
  function refresh() {
    if (destroyed) throw new Error("Feedback contribution source is closed.");
    let contribution = null;
    try { contribution = validate(readConfiguration()); } catch { /* pending */ }
    const next = canonicalJson(contribution);
    if (snapshot && next === fingerprint) return snapshot;
    const revision = snapshot ? snapshot.revision + 1 : 0;
    if (!Number.isSafeInteger(revision)) throw new RangeError("Feedback revision exhausted.");
    const notify = snapshot !== null;
    fingerprint = next;
    snapshot = Object.freeze({ revision, enabled: true, pending: contribution === null,
      contribution, dependencyRevisions: Object.freeze([]) });
    // Set the complete snapshot before notifying; consumers may read it again.
    if (notify) for (const listener of [...listeners]) listener(snapshot);
    return snapshot;
  }
  return Object.freeze({
    getSnapshot: refresh,
    refresh,
    getLayoutSnapshot(overlaySideCssPx) {
      if (!Number.isFinite(overlaySideCssPx) || overlaySideCssPx <= 0) {
        throw new RangeError("An explicit positive SVG viewport side in CSS pixels is required.");
      }
      const current = refresh();
      return Object.freeze({ revision: current.revision, pending: current.pending,
        envelope: current.pending ? null : resolveEnvelope(current.contribution, overlaySideCssPx) });
    },
    subscribe(listener) {
      if (destroyed || typeof listener !== "function") throw new TypeError("An active feedback listener is required.");
      refresh();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() { destroyed = true; listeners.clear(); },
  });
}

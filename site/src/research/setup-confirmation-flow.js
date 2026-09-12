/** Presentation orchestration only. P7 owns acceptance and persistence; each
 * section owns validation. Navigation and animation never create receipts. */
export const SETUP_CONFIRMATION_SEGMENTS = Object.freeze({
  workspace: "P1", questionnaires: "P2", stimuli: "P3", layout: "P4", xr: "P6",
});
export const SETUP_CONFIRMATION_ORDER = Object.freeze(Object.keys(SETUP_CONFIRMATION_SEGMENTS));
const complete = (status) => status === "accepted" || status === "excluded";

export function createSetupConfirmationFlow({ acceptContribution, readAcceptance, onChange = () => {} }) {
  let pendingSectionId = null;
  let disposed = false;
  const errors = new Map();
  function read() {
    const review = readAcceptance();
    return Object.freeze(SETUP_CONFIRMATION_ORDER.map((id) => {
      const segment = SETUP_CONFIRMATION_SEGMENTS[id];
      const entry = review.entries.find((item) => item.segment === segment);
      const status = entry?.status ?? "missing";
      return Object.freeze({ id, segment, status, confirmed: complete(status),
        busy: pendingSectionId === id,
        error: complete(status) ? null : errors.get(id) ?? null });
    }));
  }
  const notify = () => { if (!disposed) onChange(); };
  return Object.freeze({
    read,
    async confirm(sectionId) {
      if (!Object.hasOwn(SETUP_CONFIRMATION_SEGMENTS, sectionId)) {
        throw new RangeError("This section is captured by the final save, not a separate confirmation.");
      }
      if (disposed) return { status: "disposed" };
      if (pendingSectionId !== null) return { status: "busy" };
      if (read().find(({ id }) => id === sectionId).confirmed) return { status: "unchanged" };
      pendingSectionId = sectionId;
      errors.delete(sectionId);
      notify();
      try {
        await acceptContribution(SETUP_CONFIRMATION_SEGMENTS[sectionId]);
        if (disposed) return { status: "disposed" };
        if (!read().find(({ id }) => id === sectionId).confirmed) {
          throw new Error("The section changed during confirmation. Review its current values and try again.");
        }
        return { status: "confirmed", nextSectionId:
          SETUP_CONFIRMATION_ORDER[SETUP_CONFIRMATION_ORDER.indexOf(sectionId) + 1] ?? "review" };
      } catch (error) {
        if (disposed) return { status: "disposed" };
        const message = error instanceof Error ? error.message : "The section could not be confirmed.";
        errors.set(sectionId, message);
        return { status: "error", message };
      } finally {
        pendingSectionId = null;
        notify();
      }
    },
    destroy() { disposed = true; errors.clear(); },
  });
}

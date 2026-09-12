/** P7 owns export lifecycle; adapters own compilation, persistence and projection.
 * Revision/receipt state is session-local and never enters a recipe or Run. */
export function createPackageExportController({ onChange = () => {} } = {}) {
  let revision = 0;
  let phase = "editing";
  let busy = false;
  let disposed = false;
  let saved = null;
  const snapshot = () => Object.freeze({ revision, phase, busy, saved });
  const publish = () => { if (!disposed) onChange(snapshot()); };
  return Object.freeze({
    snapshot,
    invalidate() {
      revision += 1;
      if (!busy) phase = "editing";
      publish();
    },
    async save({ compile, write, adopt = async () => {}, isCurrent = () => true }) {
      if (disposed || busy) return Object.freeze({ status: "busy" });
      const startRevision = revision;
      const current = () => !disposed && revision === startRevision && isCurrent();
      busy = true;
      phase = "compiling";
      publish();
      try {
        const compiled = await compile();
        if (!current()) { phase = "changed"; return { status: "changed" }; }
        phase = "saving";
        publish();
        const receipt = await write(compiled);
        if (receipt === null) { phase = "cancelled"; return { status: "cancelled" }; }
        // The file may be saved even when newer edits now exist. Keep its receipt
        // separately; never replace those edits or call the current design saved.
        saved = Object.freeze({ sourceText: compiled.canonicalSourceText, receipt });
        if (!current()) { phase = "changed"; return { status: "saved-older-revision", saved }; }
        const adopted = await adopt(compiled, current);
        if (adopted === false || !current()) { phase = "changed"; return { status: "saved-older-revision", saved }; }
        phase = "saved";
        return Object.freeze({ status: "saved", saved });
      } catch (error) {
        phase = "error";
        throw error;
      } finally {
        busy = false;
        publish();
      }
    },
    destroy() { disposed = true; revision += 1; },
  });
}

import { capturePlannerRecipeInputV1 } from "./planner-recipe-capture.js";
import { compilePlannerRecipeV1, parsePlannerRecipeV1, serializePlannerRecipeV1 } from "./planner-recipe.js";
import { preparePlannerRecipeReopenV1 } from "./planner-recipe-restore.js";
import { validatePlannerRecipeSaveReceipt } from "./planner-recipe-file.js";

/** P7 composition only. The application retains the sole immutable document;
 * this coordinator stores operation/edit identities, never a second recipe.
 * Readiness notifications are not researcher edits or saved media permissions. */
export function createPlannerFileWorkflow({ registry, exporter, getDocument, adoptDocument,
  getRecipeOptions, restoreOwners, write, canOperate, onChange = () => {} }) {
  let edit = 0, operation = 0, openToken = 0, disposed = false, source = null, opening = false;
  const canCopy = () => !disposed && source !== null && source.edit === edit
    && getDocument()?.recipe && getDocument().canonicalSourceByteSha256 === source.hash;
  function guard(extra = () => true) {
    const capturedEdit = edit, capturedOperation = ++operation;
    let stale = false;
    return () => {
      try { if (disposed || capturedEdit !== edit || capturedOperation !== operation || !canOperate() || !extra()) stale = true; }
      catch { stale = true; }
      return !stale;
    };
  }
  const adopt = (document) => {
    adoptDocument(document);
    source = { edit, hash: document.canonicalSourceByteSha256 };
  };
  return Object.freeze({
    canCopy,
    get opening() { return opening; },
    edited({ deferNotification = false } = {}) {
      edit += 1; source = null;
      // Capture-phase intent must fence immediately without reading producers
      // before their target/bubble handlers publish the authored change.
      exporter.invalidate({ notify: !deferNotification });
      if (deferNotification) queueMicrotask(() => { if (!disposed) onChange(); });
      else onChange();
    },
    /** select is invoked synchronously to preserve the Open button gesture.
     * It returns a strictly dispatched {kind, document}, or null on cancel. */
    async open(select, { openLegacy, isCurrent = () => true } = {}) {
      if (disposed || exporter.snapshot().busy || !canOperate()) return false;
      const current = guard(isCurrent);
      const token = ++openToken;
      opening = true; onChange();
      try {
        const selected = await select({ isCurrent: current });
        if (!current()) throw new Error("The design changed while opening the recipe. Newer edits were preserved.");
        if (selected === null) return null;
        if (selected?.kind === "experiment-package-v1") {
          if (typeof openLegacy !== "function") throw new TypeError("The legacy recipe reader is not connected.");
          source = null;
          return await openLegacy(selected.document, { guard: current });
        }
        if (selected?.kind !== "planner-recipe-v1") throw new TypeError("Unsupported recipe file type.");
        const prepared = await preparePlannerRecipeReopenV1(selected.document.canonicalSourceText, { isCurrent: current });
        const document = await prepared.apply({ ...restoreOwners,
          begin() { source = null; exporter.invalidate(); registry.clearAcceptance(); restoreOwners.begin(); },
        });
        if (!current()) throw new Error("A newer edit replaced the recipe restoration.");
        adopt(document);
        onChange();
        return true;
      } finally { if (token === openToken) { opening = false; onChange(); } }
    },
    async save() {
      if (disposed || opening || exporter.snapshot().busy || !canOperate()) return { status: "busy" };
      const current = guard();
      const copy = canCopy() ? getDocument() : null;
      let capture = null;
      // Accept the current preview before the export controller captures its
      // revision: acceptance notifications must not stale our own save.
      if (!copy) {
        await registry.accept("P5");
        if (!current()) throw new Error("The design changed before final capture.");
        capture = capturePlannerRecipeInputV1(registry, { ...getRecipeOptions(), isCurrent: current });
      }
      const valid = () => current() && (copy ? canCopy() && getDocument() === copy : capture.isCurrent());
      return exporter.save({ isCurrent: valid,
        async compile() {
          if (copy) {
            await parsePlannerRecipeV1(new TextEncoder().encode(copy.canonicalSourceText));
            return copy;
          }
          const recipe = await compilePlannerRecipeV1(capture.input);
          return parsePlannerRecipeV1(new TextEncoder().encode(await serializePlannerRecipeV1(recipe)));
        },
        async write(document) {
          const receipt = await write(document, { isCurrent: valid });
          return receipt === null ? null : validatePlannerRecipeSaveReceipt(receipt, document);
        },
        async adopt(document, isCurrent) {
          if (!isCurrent()) return false;
          // Saving updates metadata only. Reapplying owner settings here would
          // invalidate acceptance and could overwrite edits made during saving.
          adopt(document); return true;
        },
      });
    },
    destroy() { disposed = true; operation += 1; source = null; },
  });
}

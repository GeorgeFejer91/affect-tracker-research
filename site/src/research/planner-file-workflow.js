import { capturePlannerRecipeInputV1 } from "./planner-recipe-capture.js";
import { compilePlannerRecipeV1, parsePlannerRecipeV1, serializePlannerRecipeV1 } from "./planner-recipe.js";
import { preparePlannerRecipeReopen, preparePlannerRecipeReopenV1 } from "./planner-recipe-restore.js";
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
    /** Read-only preparation for a native source already read by its owner.
     * A supported parser and the real owners' prepare/state/projection hooks
     * are explicit: the old GUI restore adapters are never treated as atomic.
     * Native effect evidence and final command finish remain with the caller. */
    async prepareOpen(sourceText, { isCurrent, parseDocument, prepareOwners } = {}) {
      if (disposed || exporter.snapshot().busy || !canOperate()) throw new Error("Recipe reopening is currently unavailable.");
      if (typeof isCurrent !== "function") throw new TypeError("Prepared Open requires its authoring command guard.");
      if (typeof registry.notifyAcceptanceChange !== "function") throw new TypeError("Prepared Open requires deferred acceptance notification.");
      for (const name of ["begin", "adoptDocument"]) assertSync(prepareOwners?.[name], name);
      for (const name of ["afterBegin", "afterAdoptDocument"]) if (prepareOwners[name] !== undefined) assertSync(prepareOwners[name], name);
      const current = guard(() => isCurrent() && !exporter.snapshot().busy);
      const prepared = await preparePlannerRecipeReopen(sourceText, { isCurrent: current, parseDocument });
      let applied = false;
      return Object.freeze({ document: prepared.document, isCurrent: prepared.isCurrent,
        async applyViaPublication(publication) {
          if (applied) throw new Error("Prepare a new Open before applying this recipe again.");
          if (!current()) throw new Error("A newer edit, Open or teardown replaced this recipe restoration.");
          applied = true;
          const token = ++openToken;
          opening = true;
          try {
            return await prepared.applyViaPublication({ ...prepareOwners,
              begin() {
                source = null;
                exporter.invalidate({ notify: false });
                registry.clearAcceptance({ notify: false });
                invokeSync(() => prepareOwners.begin());
              },
              afterBegin() {
                registry.notifyAcceptanceChange();
                if (prepareOwners.afterBegin) invokeSync(() => prepareOwners.afterBegin());
                onChange();
              },
              adoptDocument(document) {
                invokeSync(() => prepareOwners.adoptDocument(document));
                source = { edit, hash: document.canonicalSourceByteSha256 };
              },
              afterAdoptDocument() {
                if (prepareOwners.afterAdoptDocument) invokeSync(() => prepareOwners.afterAdoptDocument());
                onChange();
              },
            }, publication);
          } finally {
            if (token === openToken) { opening = false; onChange(); }
          }
        },
      });
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

function assertSync(hook, name) {
  if (typeof hook !== "function" || Object.prototype.toString.call(hook) === "[object AsyncFunction]") {
    throw new TypeError(`${name} must be a synchronous state or projection hook.`);
  }
}
function invokeSync(hook) {
  const result = hook();
  if (result && typeof result.then === "function") {
    Promise.resolve(result).catch(() => {});
    throw new TypeError("Recipe workflow publication returned asynchronous work; inspect the applied state.");
  }
  return result;
}

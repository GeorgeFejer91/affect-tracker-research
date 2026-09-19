import { prepareBrowserPackageSave } from "./package-file-picker.js";

/** One browser-only prepared-save dialog. No package or workspace authority. */
export function createPackageSaveDialog(root, { prepareSave = prepareBrowserPackageSave } = {}) {
  if (typeof prepareSave !== "function") throw new TypeError("Recipe dialog requires a typed save preparation adapter.");
  let pending = null;
  let disposed = false;
  let preparing = false;
  const dialog = root.querySelector("#package-save-dialog");
  const save = root.querySelector("#package-save-choose");
  const cancel = root.querySelector("#package-save-cancel");
  const status = root.querySelector("#package-save-dialog-status");
  const abort = new AbortController();
  const settle = (result, error = null) => {
    const operation = pending;
    pending = null;
    dialog.close();
    if (operation) { if (error) operation.reject(error); else operation.resolve(result); }
  };
  cancel.addEventListener("click", () => { if (!save.disabled) settle(null); }, { signal: abort.signal });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!save.disabled) settle(null); }, { signal: abort.signal });
  save.addEventListener("click", () => {
    if (!pending || save.disabled) return;
    const operation = pending;
    // Calling now preserves user activation; do not await before the picker.
    const write = operation.prepared.chooseAndSave();
    save.disabled = true; cancel.disabled = true;
    status.textContent = "Finish or cancel the file dialog. Saving is confirmed after the file is read back.";
    void write.then((receipt) => { if (pending === operation) settle(receipt); }, (error) => {
      if (pending === operation) settle(null, error);
    }).finally(() => { save.disabled = false; cancel.disabled = false; });
  }, { signal: abort.signal });
  return Object.freeze({
    async request(sourceText, { isCurrent }) {
      if (pending || disposed || preparing) throw new Error("The recipe save dialog is unavailable.");
      preparing = true;
      let prepared;
      try { prepared = await prepareSave(sourceText, { isCurrent: () => !disposed && isCurrent() }); }
      finally { preparing = false; }
      if (disposed || !isCurrent()) throw new Error("The design changed while preparing the save dialog.");
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, prepared };
        status.textContent = `${prepared.recipeId ?? prepared.packageId} · ${prepared.byteLength.toLocaleString()} bytes ready. Choose a name and destination in the file dialog.`;
        save.disabled = false; cancel.disabled = false;
        try { dialog.showModal(); save.focus(); }
        catch (error) { pending = null; reject(error); }
      });
    },
    destroy() { disposed = true; settle(null); abort.abort(); },
  });
}

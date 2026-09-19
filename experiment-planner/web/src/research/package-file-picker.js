import { MAX_EXPERIMENT_PACKAGE_BYTES, parseExperimentPackageV1 } from "./experiment-package.js";
import { validatePackageSaveReceipt } from "./package-save-request.js";

const TYPES = [{ description: "Experiment recipe JSON", accept: { "application/json": [".json"] } }];
const encoder = new TextEncoder();

async function readPackage(handle) {
  if (handle?.kind !== "file" || typeof handle.getFile !== "function") throw new TypeError("Select one recipe file.");
  const file = await handle.getFile();
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_EXPERIMENT_PACKAGE_BYTES) throw new RangeError("The recipe file must be between 1 byte and 16 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error("The selected recipe changed while it was being read.");
  return parseExperimentPackageV1(bytes);
}

/** Called from the Open button's user gesture; grants only the selected file,
 * never the workspace/asset root, and does not remember a native path. */
export function openBrowserExperimentPackage({ pickOpenFile = globalThis.showOpenFilePicker?.bind(globalThis) } = {}) {
  if (typeof pickOpenFile !== "function") return Promise.reject(new Error("This browser cannot open recipe files. Use desktop Chrome or Edge."));
  let selection;
  try { selection = pickOpenFile({ id: "affect-recipe", multiple: false, types: TYPES, excludeAcceptAllOption: true }); }
  catch (error) { return error?.name === "AbortError" ? Promise.resolve(null) : Promise.reject(error); }
  return Promise.resolve(selection).then(async (handles) => {
    if (!Array.isArray(handles) || handles.length !== 1) throw new TypeError("Select exactly one recipe file.");
    return readPackage(handles[0]);
  }, (error) => { if (error?.name === "AbortError") return null; throw error; });
}

/** Prepare immutable validated bytes before displaying the final save control.
 * chooseAndSave must run directly from its button; the picker is called before
 * any await. File persistence remains distinct from fixed-root attestation. */
export async function prepareBrowserPackageSave(sourceText, {
  isCurrent = () => true, pickSaveFile = globalThis.showSaveFilePicker?.bind(globalThis),
} = {}) {
  if (typeof sourceText !== "string" || encoder.encode(sourceText).byteLength > MAX_EXPERIMENT_PACKAGE_BYTES) throw new TypeError("Invalid recipe save source.");
  const expected = await parseExperimentPackageV1(encoder.encode(sourceText));
  let busy = false;
  return Object.freeze({
    packageId: expected.package.packageId,
    byteLength: encoder.encode(sourceText).byteLength,
    chooseAndSave() {
      if (busy) return Promise.reject(new Error("A recipe save is already in progress."));
      if (!isCurrent()) return Promise.reject(new Error("The design changed. Close this dialog and prepare it again."));
      if (typeof pickSaveFile !== "function") return Promise.reject(new Error("This browser cannot save recipe files. Use desktop Chrome or Edge."));
      busy = true;
      let selection;
      try {
        selection = pickSaveFile({ id: "affect-recipe", suggestedName: `${expected.package.packageId}.json`, types: TYPES, excludeAcceptAllOption: true });
      } catch (error) { busy = false; return error?.name === "AbortError" ? Promise.resolve(null) : Promise.reject(error); }
      // Only picker AbortError is cancellation. AbortError from an actual write
      // is a failed write and must not be reported as a harmless cancellation.
      return Promise.resolve(selection).then(async (handle) => {
        if (!isCurrent()) throw new Error("The design changed before writing. Prepare it again.");
        if (handle?.kind !== "file" || typeof handle.createWritable !== "function") throw new TypeError("Select a writable recipe file.");
        let writable;
        let closed = false;
        try {
          writable = await handle.createWritable({ keepExistingData: false });
          if (!isCurrent()) throw new Error("The design changed before writing. Prepare it again.");
          await writable.write(encoder.encode(sourceText));
          if (!isCurrent()) throw new Error("The design changed before committing the file. Prepare it again.");
          await writable.close();
          closed = true;
          const observed = await readPackage(handle);
          if (observed.canonicalSourceText !== sourceText) throw new Error("The saved recipe bytes differ from the prepared design.");
          return validatePackageSaveReceipt({
            schema: "affect-research-experiment-package-save-receipt", version: 1,
            packageId: observed.package.packageId,
            packageDefinitionSha256: observed.package.integrity.packageDefinitionSha256,
            canonicalSourceByteSha256: observed.canonicalSourceByteSha256,
            byteLength: encoder.encode(observed.canonicalSourceText).byteLength,
          }, expected);
        } catch (error) {
          if (writable && !closed) { try { await writable.abort(); } catch { /* Original write failure remains authoritative. */ } }
          throw error;
        }
      }, (error) => { if (error?.name === "AbortError") return null; throw error; }).finally(() => { busy = false; });
    },
  });
}

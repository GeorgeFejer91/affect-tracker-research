import { parsePlannerRecipeV1, parsePlannerRecipeFile } from "./planner-recipe.js";
import { MAX_PLANNER_RECIPE_BYTES, exactRecipeObject } from "./planner-recipe-wire.js";

const encoder = new TextEncoder();
const TYPES = [{ description: "Experiment recipe JSON", accept: { "application/json": [".json"] } }];
export const PLANNER_RECIPE_SAVE_RECEIPT_SCHEMA = "affect-research-planner-recipe-save-receipt";

function currentGuard(isCurrent) {
  if (typeof isCurrent !== "function") throw new TypeError("Recipe file operations require a current edit/operation/disposal guard.");
  let stale = false;
  return () => {
    try { if (isCurrent() !== true) stale = true; } catch { stale = true; }
    if (stale) throw new Error("The design or file operation changed. Prepare the current recipe again.");
  };
}

async function readFileBytes(handle) {
  if (handle?.kind !== "file" || typeof handle.getFile !== "function") throw new TypeError("Select one recipe file.");
  const file = await handle.getFile();
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PLANNER_RECIPE_BYTES) throw new RangeError("The recipe must contain between 1 byte and 16 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw new Error("The selected recipe changed while reading its bytes.");
  return bytes;
}

export function validatePlannerRecipeSaveReceipt(receipt, expected) {
  exactRecipeObject(receipt, ["schema", "version", "recipeId", "definitionSha256", "canonicalSourceByteSha256", "byteLength"], "Planner recipe save receipt");
  if (receipt.schema !== PLANNER_RECIPE_SAVE_RECEIPT_SCHEMA || receipt.version !== 1
    || receipt.recipeId !== expected.recipe.recipeId
    || receipt.definitionSha256 !== expected.recipe.integrity.definitionSha256
    || receipt.canonicalSourceByteSha256 !== expected.canonicalSourceByteSha256
    || receipt.byteLength !== encoder.encode(expected.canonicalSourceText).byteLength) {
    throw new TypeError("The writer did not acknowledge the exact prepared Planner recipe bytes.");
  }
  return Object.freeze({ ...receipt });
}

/** Invoke directly from a user action. This selects a recipe, never its media
 * root, and performs strict version dispatch before any application adoption. */
export function openBrowserPlannerRecipeFile({ isCurrent, pickOpenFile = globalThis.showOpenFilePicker?.bind(globalThis) }) {
  const requireCurrent = currentGuard(isCurrent);
  requireCurrent();
  if (typeof pickOpenFile !== "function") return Promise.reject(new Error("This browser cannot open recipe files. Use desktop Chrome or Edge."));
  let selection;
  try { selection = pickOpenFile({ id: "affect-recipe", multiple: false, types: TYPES, excludeAcceptAllOption: true }); }
  catch (error) { return error?.name === "AbortError" ? Promise.resolve(null) : Promise.reject(error); }
  return Promise.resolve(selection).then(async handles => {
    requireCurrent();
    if (!Array.isArray(handles) || handles.length !== 1) throw new TypeError("Select exactly one recipe file.");
    const bytes = await readFileBytes(handles[0]); requireCurrent();
    const result = await parsePlannerRecipeFile(bytes); requireCurrent();
    return result;
  }, error => { if (error?.name === "AbortError") return null; throw error; });
}

/** Validate immutable bytes before the final save-button gesture. Both fresh
 * compile and an explicitly unchanged loaded-file reexport use this writer;
 * the caller supplies their distinct eligibility guard. No owner restoration. */
export async function prepareBrowserPlannerRecipeSave(sourceText, {
  isCurrent, pickSaveFile = globalThis.showSaveFilePicker?.bind(globalThis),
}) {
  const requireCurrent = currentGuard(isCurrent);
  requireCurrent();
  if (typeof sourceText !== "string" || encoder.encode(sourceText).byteLength > MAX_PLANNER_RECIPE_BYTES) throw new TypeError("Invalid Planner recipe save source.");
  const expected = await parsePlannerRecipeV1(encoder.encode(sourceText)); requireCurrent();
  const sourceBytes = encoder.encode(expected.canonicalSourceText);
  let busy = false;
  return Object.freeze({ recipeId: expected.recipe.recipeId, byteLength: sourceBytes.byteLength, expected,
    chooseAndSave() {
      if (busy) return Promise.reject(new Error("A recipe save is already in progress."));
      try { requireCurrent(); } catch (error) { return Promise.reject(error); }
      if (typeof pickSaveFile !== "function") return Promise.reject(new Error("This browser cannot save recipe files. Use desktop Chrome or Edge."));
      busy = true;
      let selection;
      try { selection = pickSaveFile({ id: "affect-recipe", suggestedName: `${expected.recipe.recipeId}.json`, types: TYPES, excludeAcceptAllOption: true }); }
      catch (error) { busy = false; return error?.name === "AbortError" ? Promise.resolve(null) : Promise.reject(error); }
      return Promise.resolve(selection).then(async handle => {
        requireCurrent();
        if (handle?.kind !== "file" || typeof handle.createWritable !== "function") throw new TypeError("Select a writable recipe file.");
        let writable, closed = false;
        try {
          writable = await handle.createWritable({ keepExistingData: false }); requireCurrent();
          await writable.write(sourceBytes.slice()); requireCurrent();
          await writable.close(); closed = true; requireCurrent();
          const observed = await parsePlannerRecipeV1(await readFileBytes(handle)); requireCurrent();
          if (observed.canonicalSourceText !== expected.canonicalSourceText) throw new Error("The saved bytes differ from the prepared recipe.");
          return validatePlannerRecipeSaveReceipt({ schema: PLANNER_RECIPE_SAVE_RECEIPT_SCHEMA, version: 1,
            recipeId: observed.recipe.recipeId, definitionSha256: observed.recipe.integrity.definitionSha256,
            canonicalSourceByteSha256: observed.canonicalSourceByteSha256, byteLength: sourceBytes.byteLength }, expected);
        } catch (error) {
          if (writable && !closed) { try { await writable.abort(); } catch { /* Preserve the original write failure. */ } }
          throw error;
        }
      }, error => { if (error?.name === "AbortError") return null; throw error; }).finally(() => { busy = false; });
    },
  });
}

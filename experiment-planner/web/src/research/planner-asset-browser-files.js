import { parsePlannerRecipeV5, validatePlannerAssetManifest } from "./planner-recipe-assets.js";
import { readPlannerRecipeJsonBytes } from "./planner-recipe-wire.js";
import { plannerRecipeFilename } from "./planner-recipe-filename.js";

async function childFile(root, path, create = false) {
  let directory = root;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
  return directory.getFileHandle(parts.at(-1), { create });
}
async function snapshot(handle, limit) {
  const file = await handle.getFile();
  if (file.size < 1 || file.size > limit) throw new Error("Questionnaire asset has an unexpected size.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error("Questionnaire file changed while being read.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function readBrowserPlannerAssets(bytes, fileHandle, rootHandle, requireCurrent) {
  const manifest = await validatePlannerAssetManifest(readPlannerRecipeJsonBytes(bytes).value); requireCurrent();
  if (!rootHandle || typeof rootHandle.resolve !== "function") throw new Error("Select this experiment's work folder before opening its manifest.");
  const path = await rootHandle.resolve(fileHandle); requireCurrent();
  if (!path?.length) throw new Error("Select the work folder containing this experiment manifest.");
  let directory = rootHandle;
  for (const part of path.slice(0, -1)) { directory = await directory.getDirectoryHandle(part); requireCurrent(); }
  const assets = [];
  for (const ref of manifest.segments.P2.questionnaires.assets) {
    const handle = await childFile(directory, ref.relativePath); requireCurrent();
    assets.push({ relativePath: ref.relativePath, sourceText: await snapshot(handle, ref.byteLength) }); requireCurrent();
  }
  return parsePlannerRecipeV5(bytes, assets);
}

/** Save5 selects a directory because a single file grant cannot write sibling
 * assets. Native has atomic create-new publication; browser retains its known
 * weaker cross-client concurrency guarantee. */
export function prepareBrowserPlannerAssetSave(expected, { requireCurrent, pickDirectory = globalThis.showDirectoryPicker?.bind(globalThis), receipt }) {
  let busy = false;
  return Object.freeze({ recipeId: expected.recipe.recipeId, byteLength: new TextEncoder().encode(expected.canonicalSourceText).length, expected,
    chooseAndSave() {
      if (busy) return Promise.reject(new Error("An experiment save is already in progress."));
      requireCurrent();
      if (typeof pickDirectory !== "function") return Promise.reject(new Error("This browser cannot save an experiment folder."));
      busy = true;
      let selection;
      try { selection = pickDirectory({ id: "affect-recipe-assets", mode: "readwrite" }); }
      catch (error) { busy = false; return error?.name === "AbortError" ? Promise.resolve(null) : Promise.reject(error); }
      return Promise.resolve(selection).then(async directory => {
        requireCurrent();
        for (const asset of expected.questionnaireAssets) {
          let handle;
          try { handle = await childFile(directory, asset.relativePath); }
          catch (error) { if (error?.name !== "NotFoundError") throw error; }
          requireCurrent();
          if (handle) {
            if (await snapshot(handle, new TextEncoder().encode(asset.sourceText).length) !== asset.sourceText) throw new Error("An existing questionnaire asset changed. It was not replaced.");
          } else {
            handle = await childFile(directory, asset.relativePath, true); requireCurrent();
            await write(handle, asset.sourceText, requireCurrent);
          }
          requireCurrent();
        }
        const base = plannerRecipeFilename(expected.recipe.recipeId);
        let handle;
        for (let i = 0; i < 1000; i++) {
          const name = i ? base.replace(/\.json$/u, `_${String(i).padStart(3, "0")}.json`) : base;
          try { await directory.getFileHandle(name); }
          catch (error) {
            if (error?.name !== "NotFoundError") throw error;
            requireCurrent(); handle = await directory.getFileHandle(name, { create: true }); break;
          }
          requireCurrent();
        }
        if (!handle) throw new Error("No unused experiment filename is available.");
        requireCurrent();
        if ((await handle.getFile()).size !== 0) throw new Error("Another writer created this experiment file.");
        await write(handle, expected.canonicalSourceText, requireCurrent);
        const observed = await readBrowserPlannerAssets(new TextEncoder().encode(expected.canonicalSourceText), handle, directory, requireCurrent);
        requireCurrent(); return receipt(observed);
      }, error => { if (error?.name === "AbortError") return null; throw error; }).finally(() => { busy = false; });
    },
  });
}
async function write(handle, text, requireCurrent) {
  let writable, closed = false;
  try {
    writable = await handle.createWritable({ keepExistingData: false }); requireCurrent();
    await writable.write(new TextEncoder().encode(text)); requireCurrent();
    await writable.close(); closed = true; requireCurrent();
    if (await snapshot(handle, new TextEncoder().encode(text).length) !== text) throw new Error("Saved experiment content differs from its prepared bytes.");
    requireCurrent();
  } catch (error) { if (writable && !closed) { try { await writable.abort(); } catch { /* Retain original error. */ } } throw error; }
}

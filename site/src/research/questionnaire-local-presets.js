import { importQuestionnaireAuthoring } from "./questionnaire-authoring.js";
import { sha256Hex } from "./canonical.js";
import { prebuiltQuestionnaireAvailability } from "./questionnaire-prebuilt.js";

/** Metadata only. Source bytes are installed privately by the native owner. */
export const RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS = Object.freeze([Object.freeze({
  id: "tas-20-de-handrack-2016-local", familyId: "tas-20", questionnaireId: "tas-20-de",
  title: "TAS-20 (Handrack 2016)", language: "de", languageLabel: "Deutsch",
  logicalName: "tas-20-de-handrack-2016-local.csv", questionnaireVersion: "handrack-2016-a8-raw",
  sourceSha256: "7b32c878cf83d2b0348498355402f1a8d1db5853aeffeaf2f74863ea701eef92",
  definitionSha256: "c8a6c8c8609caa590124144ce03dd9fb12570edcd15fb556a4b4c32dbb3eb60d",
  byteLength: 124978, itemCount: 20, optionCount: 5,
  usageScope: "researcherLocal", publicReuseVerified: false,
  description: "Researcher-local preset · 20 items · 5 answers · Handrack (2016), appendix A8. Raw response codes 1–5; no inferred total score. Not a public redistribution licence.",
})]);
const RECEIPT_KEYS = ["presetId", "familyId", "languageTag", "logicalName", "sourceSha256", "byteLength", "usageScope", "publicReuseVerified"];
const exact = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new TypeError("Local preset receipt has missing or unknown fields.");
};
const assetFor = id => {
  const asset = RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS.find(entry => entry.id === id);
  if (!asset) throw new TypeError("Unknown researcher-local questionnaire preset.");
  return asset;
};

/** Pure content verifier, not a filesystem grant. The production owner below
 * always supplies its fixed metadata registry; tests can verify synthetic data. */
export async function verifyResearcherLocalQuestionnaireSource(asset, source) {
  exact(source, ["receipt", "bytes"]); exact(source.receipt, RECEIPT_KEYS);
  const receipt = structuredClone(source.receipt);
  if (receipt.presetId !== asset.id || receipt.familyId !== asset.familyId || receipt.languageTag !== asset.language
    || receipt.logicalName !== asset.logicalName || receipt.sourceSha256 !== asset.sourceSha256
    || receipt.byteLength !== asset.byteLength || receipt.usageScope !== "researcherLocal" || receipt.publicReuseVerified !== false) {
    throw new TypeError("The local preset receipt does not identify the expected researcher-installed source.");
  }
  if (!(source.bytes instanceof Uint8Array) && !Array.isArray(source.bytes)) throw new TypeError("Local preset bytes must be a bounded byte array.");
  if (source.bytes.length !== asset.byteLength || source.bytes.length > 4 * 1024 * 1024
    || !source.bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new TypeError("Local preset bytes have the wrong size or encoding.");
  const bytes = new Uint8Array(source.bytes);
  if (await sha256Hex(bytes) !== asset.sourceSha256) throw new TypeError("The installed local preset source hash does not match.");
  const authoringResult = await importQuestionnaireAuthoring(bytes, { logicalName: asset.logicalName });
  const definition = authoringResult.definition;
  if (definition.questionnaireId !== asset.questionnaireId || definition.language !== asset.language
    || definition.questionnaireVersion !== asset.questionnaireVersion || definition.definitionSha256 !== asset.definitionSha256
    || definition.items.length !== asset.itemCount || definition.items.some(item => item.options.length !== asset.optionCount)) {
    throw new TypeError("The local preset definition does not match its verified version.");
  }
  return { asset: structuredClone(asset), receipt, sourceBytes: bytes, authoringResult };
}

export function researcherLocalQuestionnaireAvailability(asset, options) {
  if (!asset.ready) return { disabled: true, label: "Local preset not installed or unavailable" };
  return prebuiltQuestionnaireAvailability(asset, options);
}

/** Keep public eligibility immutable. Replace only an unavailable placeholder
 * with a verified installed local option of the same family/language. */
export function mergeQuestionnairePresetChoices(publicChoices, localChoices) {
  return [...publicChoices.filter(asset => asset.ready || !localChoices.some(local => local.ready
    && local.familyId === asset.familyId && local.language === asset.language)), ...localChoices];
}

export function createResearcherLocalQuestionnairePresets({ surface, readSource }) {
  if (!["tauri", "browser"].includes(surface)) throw new TypeError("Unknown questionnaire preset surface.");
  if (surface === "tauri" && typeof readSource !== "function") throw new TypeError("Local presets require the native source reader.");
  let destroyed = false;
  const lifetime = new AbortController();
  function current(guard) {
    if (destroyed || lifetime.signal.aborted || guard?.signal?.aborted || typeof guard?.isCurrent !== "function" || !guard.isCurrent()) {
      const error = new Error("The local questionnaire request was cancelled or superseded.");
      error.code = destroyed || lifetime.signal.aborted || guard?.signal?.aborted ? "canceled" : "stale_revision";
      throw error;
    }
  }
  function operation(guard) {
    current(guard);
    return { signal: AbortSignal.any([lifetime.signal, guard.signal]),
      isCurrent: () => { try { current(guard); return true; } catch { return false; } } };
  }
  async function read(asset, guard) {
    if (surface !== "tauri") throw new TypeError("Researcher-local presets are available only in the native Planner.");
    const scope = operation(guard);
    const result = await readSource(Object.freeze({ presetId: asset.id }), scope);
    current(guard);
    if (result === null) return null;
    const verified = await verifyResearcherLocalQuestionnaireSource(asset, result);
    current(guard); return verified;
  }
  async function load(id, guard) {
    const result = await read(assetFor(id), guard);
    if (!result) throw new Error("This researcher-local preset is not installed. Install its authorized source in the native Planner first.");
    return result;
  }
  return Object.freeze({
    async inspect(guard) {
      if (surface === "browser") return [];
      const choices = [];
      for (const asset of RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS) {
        try {
          const installed = await read(asset, guard);
          choices.push({ ...asset, ready: Boolean(installed), state: installed ? "installed" : "notInstalled" });
        } catch (error) {
          current(guard); // cancellation is not silently presented as a missing asset.
          choices.push({ ...asset, ready: false, state: "unavailable" });
        }
      }
      return choices;
    },
    load,
    async loadIntoEditor(id, { editor, readContext }, guard) {
      const asset = assetFor(id), before = structuredClone(readContext());
      const token = editor.presetToken(asset.familyId, asset.language);
      if (before.locked || !before.languages.includes(asset.language) || token === null || !editor.canLoadPreset(asset.familyId, asset.language)) {
        throw new Error("Select the preset language and an empty questionnaire slot before loading this local asset.");
      }
      const isCurrent = () => {
        const context = readContext();
        return guard.isCurrent() && !context.locked && context.languages.includes(asset.language)
          && JSON.stringify(context) === JSON.stringify(before)
          && editor.presetToken(asset.familyId, asset.language) === token && editor.canLoadPreset(asset.familyId, asset.language);
      };
      const result = await load(id, { signal: guard.signal, isCurrent });
      current({ signal: guard.signal, isCurrent });
      const loaded = editor.loadDefinition(result.authoringResult.definition, { familyId: asset.familyId,
        sourceBytes: result.sourceBytes, authoringResult: result.authoringResult, onlyIfPristine: true, expectedPresetToken: token });
      if (!loaded) throw new Error("The questionnaire slot changed; no local preset replaced it.");
      return { loaded: true, receipt: result.receipt, questionnaireId: result.authoringResult.definition.questionnaireId,
        definitionSha256: result.authoringResult.definition.definitionSha256 };
    },
    destroy() { destroyed = true; lifetime.abort(); },
  });
}

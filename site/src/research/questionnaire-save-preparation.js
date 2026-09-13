import { canonicalJson } from "./canonical.js";
import { cloneQuestionnaireSheet, sheetFromDefinition, sheetToAuthoring } from "./form-sheet.js";

const fingerprint = entry => canonicalJson({ sheet: entry.sheet, invalid: [...entry.invalid],
  repeatLabels: entry.repeatLabels, rawOptionCount: entry.rawOptionCount, dirty: entry.dirty,
  sourceDefinitionHash: entry.sourceDefinitionHash, error: entry.error, pristine: entry.pristine });
const sameBytes = (a, b) => a === null ? b === null : b instanceof Uint8Array && a.length === b.length && a.every((value, index) => value === b[index]);

/** Read-only preparation over the real editor entry. This module never invokes
 * storage, adopts definitions/modules, renders, or reserves an entry. */
export async function prepareQuestionnaireSave({ readEntry, isLocked, afterCommit, busyExpected = false }, operation) {
  if (typeof operation?.isCurrent !== "function" || !operation.signal) throw new TypeError("Questionnaire preparation needs current-operation and cancellation guards.");
  const entry = readEntry();
  if (!entry || isLocked() || entry.busy !== busyExpected) throw new TypeError("The questionnaire is missing, locked or already saving.");
  const before = fingerprint(entry), token = entry.presetToken, source = entry.sourceBytes?.slice() ?? null;
  let committed = false, published = false, resultReceipt;
  function current() {
    try { return !committed && !operation.signal.aborted && operation.isCurrent() && !isLocked()
      && readEntry() === entry && entry.presetToken === token && entry.busy === busyExpected
      && fingerprint(entry) === before && sameBytes(source, entry.sourceBytes ?? null); }
    catch { return false; }
  }
  function check() {
    if (!current()) {
      const error = new Error("Questionnaire save preparation was cancelled or superseded; retain any completed storage receipt.");
      error.code = operation.signal.aborted ? "canceled" : "stale_revision"; throw error;
    }
  }
  check();
  if (entry.invalid.size) throw new TypeError("Correct the highlighted values before saving.");
  if (entry.rawOptionCount !== null) throw new TypeError("Finish a valid answer-option count before saving.");
  const familyId = entry.sheet.familyId, language = entry.sheet.language;
  const compiled = await sheetToAuthoring(cloneQuestionnaireSheet(entry.sheet));
  check();
  const bytes = (compiled.sourceBytes ?? source)?.slice() ?? null;
  const definition = structuredClone(compiled.definition);
  const preparedSheet = sheetFromDefinition(definition, { familyId, authoringResult: compiled });
  const receipt = compiled.authoringReceipt ?? entry.authoringResult?.authoringReceipt;
  const authoringReceipt = receipt === undefined ? undefined : structuredClone(receipt);
  check();
  return Object.freeze({
    get payload() { return { familyId, language, definition: structuredClone(definition), sourceBytes: bytes?.slice() ?? null,
      expectedPresetToken: token, authoringReceipt: authoringReceipt === undefined ? undefined : structuredClone(authoringReceipt),
      ...(compiled.sourceFormat ? { sourceFormat: compiled.sourceFormat } : {}) }; },
    isCurrent: current,
    commit(sourceReceipt) {
      if (committed) return structuredClone(resultReceipt);
      check();
      // Receipt cloning and all conversion finish before the first state write.
      resultReceipt = { questionnaireId: definition.questionnaireId, definitionSha256: definition.definitionSha256,
        sourceReceipt: sourceReceipt == null ? null : structuredClone(sourceReceipt) };
      entry.sourceDefinitionHash = definition.definitionSha256;
      entry.sheet = preparedSheet;
      entry.sourceBytes = bytes?.slice() ?? null;
      entry.dirty = false; entry.undo = null; entry.error = "";
      committed = true;
      return structuredClone(resultReceipt);
    },
    afterCommit() {
      if (!committed) throw new TypeError("Publish questionnaire projection only after state commit.");
      if (published) return;
      published = true; afterCommit?.();
    },
  });
}


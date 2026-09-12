import { canonicalJson } from "../../site/src/research/canonical.js";
import { exactFormObject, validateFormAnswers, validateFormDefinitionV1 } from "../../site/src/research/form-definition.js";

/** A v2 response record dispatches here only when its bound definition is a
 * verified typed form. Context/occurrence checks remain with the stream reader. */
export function validateTypedResponseRows(definitionValue, rows, { submitted, monotonicMs }) {
  const definition = validateFormDefinitionV1(definitionValue);
  if (typeof submitted !== "boolean" || !Number.isFinite(monotonicMs) || monotonicMs < 0 || monotonicMs > Number.MAX_SAFE_INTEGER || !Array.isArray(rows) || rows.length > definition.items.length) throw new Error("Invalid typed response envelope bounds.");
  let previous = 0;
  for (const row of rows) {
    const item = definition.items.find(item => item.itemId === row?.itemId);
    if (!item) throw new Error("Unknown typed response item.");
    const keys = ["itemId", "itemOrder", "value", "responseLatencyMs"];
    if (item.response.kind === "singleChoice") keys.push("optionOrder", "responseLabel");
    exactFormObject(row, keys, "Typed response");
    if (row.itemOrder !== item.order || row.itemOrder <= previous) throw new Error("Typed response order is duplicated or differs from its definition.");
    previous = row.itemOrder;
    if (!Number.isFinite(row.responseLatencyMs) || row.responseLatencyMs < 0 || row.responseLatencyMs > Math.min(86_400_000, monotonicMs)) throw new Error("Invalid native typed response latency.");
    if (item.response.kind === "singleChoice") {
      const option = item.response.options.find(option => option.optionId === row.value?.optionId);
      if (!option || option.order !== row.optionOrder || option.label !== row.responseLabel) throw new Error("Typed option order or label differs from its frozen definition.");
    }
  }
  const result = validateFormAnswers(definition, rows.map(row => ({ itemId: row.itemId, value: row.value })), { allowPartial: !submitted });
  // The owner must preserve typed input and authored order without coercion.
  if (canonicalJson(result.answers) !== canonicalJson(rows.map(row => ({ itemId: row.itemId, value: row.value })))) throw new Error("Typed response values changed during validation.");
  return { complete: result.complete, missingRequired: result.missingRequired, responses: structuredClone(rows) };
}

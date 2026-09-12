import { RESEARCH_UI_EVENTS } from "./ui-contracts.js";

const RECEIPT_KEYS = ["schema", "version", "packageId", "packageDefinitionSha256", "canonicalSourceByteSha256", "byteLength"];

/** A native write acknowledgement must bind the exact compiled bytes. */
export function validatePackageSaveReceipt(receipt, expected) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || Object.keys(receipt).length !== RECEIPT_KEYS.length
    || RECEIPT_KEYS.some((key) => !Object.hasOwn(receipt, key))
    || receipt.schema !== "affect-research-experiment-package-save-receipt"
    || receipt.version !== 1
    || receipt.packageId !== expected.package.packageId
    || receipt.packageDefinitionSha256 !== expected.package.integrity.packageDefinitionSha256
    || receipt.canonicalSourceByteSha256 !== expected.canonicalSourceByteSha256
    || receipt.byteLength !== new TextEncoder().encode(expected.canonicalSourceText).byteLength) {
    throw new TypeError("The package writer did not confirm the exact recipe bytes. Save completion is unverified.");
  }
  return Object.freeze({ ...receipt });
}

/** The native picker has no artificial deadline: it may wait for the researcher.
 * The export controller permits one request until the owner settles it. */
export function requestExperimentPackageSave(target, expected) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (result) => {
      if (settled) return;
      settled = true;
      try {
        if (result?.status === "cancelled") resolve(null);
        else if (result?.status === "saved") resolve(validatePackageSaveReceipt(result.receipt, expected));
        else throw new Error("The recipe could not be saved. The design remains available to retry.");
      } catch (error) { reject(error); }
    };
    const event = new CustomEvent(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, {
      bubbles: true,
      cancelable: true,
      detail: Object.freeze({ sourceText: expected.canonicalSourceText, complete }),
    });
    try {
      target.dispatchEvent(event);
      if (!event.defaultPrevented && !settled) {
        settled = true;
        reject(new Error("The native package save adapter is not connected."));
      }
    } catch (error) {
      if (!settled) { settled = true; reject(error); }
    }
  });
}

/** Settle inside the serialized bridge operation; event acceptance is not save. */
export async function completeExperimentPackageSaveRequest(detail, operation) {
  if (typeof detail?.complete !== "function" || typeof detail.sourceText !== "string") {
    throw new TypeError("Package save requires canonical text and a completion receiver.");
  }
  try {
    const receipt = await operation(detail.sourceText);
    detail.complete(receipt === null ? { status: "cancelled" } : { status: "saved", receipt });
    return receipt;
  } catch (error) {
    detail.complete({ status: "failed" });
    throw error;
  }
}

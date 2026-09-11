import { RESEARCH_UI_EVENTS } from "./ui-contracts.js";

const MAX_WAIT_MS = 30_000;

/** Await the storage owner's validated receipt, not merely event dispatch. */
export function requestQuestionnaireAssetStorage(target, payload, { timeoutMs = MAX_WAIT_MS } = {}) {
  if (!target || typeof target.dispatchEvent !== "function") {
    return Promise.reject(new TypeError("Questionnaire storage requires the application event target."));
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_MS) {
    return Promise.reject(new RangeError("Questionnaire storage timeout must be 1–30000 ms."));
  }
  const request = Object.freeze({
    ...payload,
    bytes: Array.isArray(payload?.bytes) || payload?.bytes instanceof Uint8Array
      ? Object.freeze([...payload.bytes])
      : payload?.bytes,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, receipt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(receipt);
    };
    const complete = (result) => {
      if (result?.ok === true && result.receipt && typeof result.receipt === "object") {
        finish(null, result.receipt);
      } else {
        const message = typeof result?.message === "string" && result.message.length <= 1_000
          ? result.message
          : "Questionnaire source could not be saved.";
        finish(new Error(message));
      }
    };
    timer = setTimeout(() => finish(new Error(
      "Questionnaire storage has not confirmed completion. The save outcome is unknown; retry before marking this asset ready.",
    )), timeoutMs);
    const event = new CustomEvent(RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, {
      bubbles: true,
      cancelable: true,
      detail: Object.freeze({ request, complete }),
    });
    try {
      target.dispatchEvent(event);
      if (!event.defaultPrevented) finish(new Error("The Windows questionnaire asset store is not connected."));
    } catch (error) {
      finish(error);
    }
  });
}

/** Complete the UI request inside the bridge queue, before its error handler. */
export async function completeQuestionnaireAssetStorageRequest(detail, operation) {
  const complete = typeof detail?.complete === "function" ? detail.complete : null;
  const request = complete ? detail.request : detail; // Retain older notification-only callers.
  try {
    const receipt = await operation(request);
    complete?.({ ok: true, receipt });
    return receipt;
  } catch (error) {
    complete?.({ ok: false, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

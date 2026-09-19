export const PLANNER_LOAD_REQUEST = "affect-research:load-planner-recipe-request";
export const PLANNER_SAVE_REQUEST = "affect-research:save-planner-recipe-request";

/** Native adapters settle inside their serialized, role-checked operation.
 * Event acceptance alone never acknowledges a file or its bytes. */
export function requestPlannerFile(target, type, payload = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (result) => {
      if (settled) return;
      settled = true;
      if (result?.status === "cancelled") resolve(null);
      else if (result?.status === "complete") resolve(result.value);
      else reject(new Error(result?.message || "The native recipe file operation failed."));
    };
    const event = new CustomEvent(type, { bubbles: true, cancelable: true,
      detail: Object.freeze({ ...payload, complete }) });
    try {
      target.dispatchEvent(event);
      if (!event.defaultPrevented && !settled) complete({ status: "failed", message: "The native recipe file adapter is not connected." });
    } catch (error) { if (!settled) { settled = true; reject(error); } }
  });
}

export async function completePlannerFileRequest(detail, operation) {
  if (typeof detail?.complete !== "function") throw new TypeError("Recipe file requests require a completion receiver.");
  try {
    const value = await operation();
    detail.complete(value === null ? { status: "cancelled" } : { status: "complete", value });
    return value;
  } catch (error) {
    detail.complete({ status: "failed", message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

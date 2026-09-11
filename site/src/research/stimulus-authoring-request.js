import { RESEARCH_UI_EVENTS } from "./ui-contracts.js";

/** One bounded operation; a timeout never means that storage succeeded. */
export function requestStimulusAuthoring(target, operation, payload = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (result?.ok) resolve(result.receipt);
      else reject(new Error(result?.message ?? "Video authoring did not complete."));
    };
    const timer = setTimeout(() => finish({ message: "The video authoring operation has not confirmed completion. Its outcome is unknown; retry before continuing." }), 120000);
    const event = new CustomEvent(RESEARCH_UI_EVENTS.stimulusAuthoringRequest, {
      bubbles: true, cancelable: true, detail: { operation, payload, complete: finish },
    });
    target.dispatchEvent(event);
    if (!event.defaultPrevented) finish({ message: "The video authoring adapter is not connected." });
  });
}

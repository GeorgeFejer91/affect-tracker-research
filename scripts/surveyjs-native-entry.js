import { inspectSurveyJson, checkSurveyData } from "../site/src/research/surveyjs-engine.js";
// The native validator has no event loop or rendered controls. Model disposal
// cancels SurveyJS's UI debounce handles; execution never waits for browser work.
const timers = new Map();
const microtasks = [];
let timerId = 0;
globalThis.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
globalThis.clearTimeout = id => timers.delete(id);
globalThis.queueMicrotask = callback => { if (microtasks.length >= 4096) throw new Error("SurveyJS microtask queue exceeded its bound."); microtasks.push(callback); };
globalThis.affectSurveyJS = input => {
  const request = JSON.parse(input);
  try {
    const result = request.operation === "inspect" ? inspectSurveyJson(request.surveyJson) : checkSurveyData(request.surveyJson, request);
    let count = 0;
    while (microtasks.length) { if (++count > 4096) throw new Error("SurveyJS microtasks exceeded their execution bound."); microtasks.shift()(); }
    return JSON.stringify({ ok: true, result });
  } catch (error) { return JSON.stringify({ ok: false, message: error.message }); }
  finally { timers.clear(); microtasks.length = 0; }
};

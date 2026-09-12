import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { createPlannerNativeEffects } from "./planner-authoring-native-effects.js";
import { NATIVE_MEDIA_STARTUP_BUDGET_MS } from "./native-media-readiness.js";

export function reportPlannerAuthoringStartupFailure() {
  // Fixed startup code only, never an exception, stack or document payload.
  void tauriInvoke("research_planner_authoring_startup_failed").catch(() => {});
}

/** Explicit production stdin adapter. No selectors, evaluation, simulated
 * events or native file paths enter this fixed command gateway. */
export async function bootPlannerAuthoringNative(root, invoke = tauriInvoke, ensureMediaReady = async () => {
  throw new Error("Native media readiness owner is unavailable.");
}) {
  const status = await invoke("research_planner_authoring_status");
  if (status?.enabled !== true) return Object.freeze({ destroy() {} });
  if (status.transport !== "stdio") throw new Error("Unsupported Planner authoring transport.");
  const session = root.researchUi?.plannerAuthoringSession;
  if (!session) throw new Error("Planner authoring session is unavailable.");
  let disposed = false;
  let effects = null;
  const pending = new Set();
  const startupDeadlines = new Map();
  let unsubscribe = () => {};
  const destroy = () => {
    if (disposed) return;
    disposed = true; unsubscribe(); effects?.destroy(); session.destroy();
  };
  // Subscribe before awaiting readiness so edits during the handshake are not
  // lost. Keep revision delivery ordered without waiting for active effects.
  let revisions = invoke("research_planner_authoring_ready", { sessionId: session.sessionId, revision: session.revision });
  unsubscribe = session.subscribe(revision => {
    revisions = revisions.then(() => {
      if (!disposed) return invoke("research_planner_authoring_revision", {
        request: { sessionId: session.sessionId, revision },
      });
    });
    void revisions.catch(destroy);
  });
  const flushRevision = async () => {
    let observed;
    do { observed = revisions; await observed; } while (observed !== revisions);
    if (disposed) throw new Error("Planner authoring transport is closed.");
  };
  try { await flushRevision(); } catch (error) { destroy(); throw error; }
  effects = createPlannerNativeEffects({ invoke, sessionId: session.sessionId, beforeDispatch: async guard => {
    await flushRevision();
    if (["importVideos", "importVideoFolder", "rescanVideoLibrary"].includes(guard.action.type)) {
      await ensureMediaReady({ ...guard, deadline: startupDeadlines.get(guard.context.requestId) ?? 0 });
      await flushRevision();
    }
  } });
  root.researchUi.connectPlannerNativeEffects?.(effects);
  const run = async () => {
    while (!disposed) {
      const request = await invoke("research_planner_authoring_next");
      if (request === null || disposed) break;
      // A local startup sub-budget, never an extension of the native broker's
      // authoritative command deadline. Include revision/session queue time.
      startupDeadlines.set(request.requestId, performance.now() + NATIVE_MEDIA_STARTUP_BUDGET_MS);
      const task = flushRevision().then(() => session.execute(request)).then(async response => {
        await flushRevision();
        if (!disposed) await invoke("research_planner_authoring_complete", { response });
      });
      pending.add(task);
      // A transport failure closes this owned gateway; the native deadline
      // reports the unknown outcome and tears down the owned hidden process.
      void task.catch(destroy).finally(() => { pending.delete(task); startupDeadlines.delete(request.requestId); });
    }
    await Promise.allSettled([...pending]);
  };
  void run().catch(destroy);
  return Object.freeze({ flushRevision, destroy });
}

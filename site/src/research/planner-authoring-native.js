import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export function reportPlannerAuthoringStartupFailure() {
  // Fixed startup code only, never an exception, stack or document payload.
  void tauriInvoke("research_planner_authoring_startup_failed").catch(() => {});
}

/** Explicit production stdin adapter. No selectors, evaluation, simulated
 * events or native file paths enter this fixed command gateway. */
export async function bootPlannerAuthoringNative(root, invoke = tauriInvoke) {
  const status = await invoke("research_planner_authoring_status");
  if (status?.enabled !== true) return Object.freeze({ destroy() {} });
  if (status.transport !== "stdio") throw new Error("Unsupported Planner authoring transport.");
  const session = root.researchUi?.plannerAuthoringSession;
  if (!session) throw new Error("Planner authoring session is unavailable.");
  let disposed = false;
  const pending = new Set();
  await invoke("research_planner_authoring_ready", { sessionId: session.sessionId, revision: session.revision });
  const run = async () => {
    while (!disposed) {
      const request = await invoke("research_planner_authoring_next");
      if (request === null || disposed) break;
      const task = session.execute(request).then(async response => {
        if (!disposed) await invoke("research_planner_authoring_complete", { response });
      });
      pending.add(task);
      // A transport failure closes this owned gateway; the native deadline
      // reports the unknown outcome and tears down the owned hidden process.
      void task.catch(() => { disposed = true; session.destroy(); }).finally(() => pending.delete(task));
    }
    await Promise.allSettled([...pending]);
  };
  void run().catch(() => { disposed = true; session.destroy(); });
  return Object.freeze({ destroy() { disposed = true; session.destroy(); } });
}

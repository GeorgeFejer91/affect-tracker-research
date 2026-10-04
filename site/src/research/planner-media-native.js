const COMMANDS = new Set(["research_prepare_planner_media", "research_workspace_media_url",
  "research_attest_workspace_decode"]);

/** The sole IPC adapter for P1's fixed native preparation and media grants. */
export async function sendPlannerMedia(command, args) {
  if (!COMMANDS.has(command)) throw new TypeError("Unknown P1 media command.");
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke(command, args);
}

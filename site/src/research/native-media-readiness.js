// HTML-video capability is normally immediate, but keep the startup deadline
// absolute and cancellable so stale desktop builds fail closed instead of
// blocking Planner workspace import.
export const NATIVE_MEDIA_STARTUP_BUDGET_MS = 90_000;
const PENDING = new Set(["native-runtime-verification-pending", "native-player-startup-pending"]);

/** Startup only: decode readiness does not imply playback qualification. Only
 * the read-only capability RPC is polled; callers dispatch mutations once. */
export async function waitForNativeMediaReadiness({ readCapability, isCurrent = () => true, signal,
  deadline = performance.now() + NATIVE_MEDIA_STARTUP_BUDGET_MS, now = () => performance.now() }) {
  const check = () => {
    if (signal?.aborted || !isCurrent()) throw new Error("Native media startup was canceled.");
    if (now() >= deadline) throw new Error("Native media startup timed out before import.");
  };
  // Also bound a stalled read-only RPC and notice disposal while it is pending.
  const bounded = work => new Promise((resolve, reject) => {
    let timer;
    const finish = (fn, value) => { clearInterval(timer); signal?.removeEventListener("abort", aborted); fn(value); };
    const aborted = () => finish(reject, new Error("Native media startup was canceled."));
    timer = setInterval(() => { try { check(); } catch (error) { finish(reject, error); } }, 50);
    signal?.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => { check(); return work(); }).then(value => finish(resolve, value), error => finish(reject, error));
  });
  for (;;) {
    check();
    const capability = await bounded(readCapability);
    check();
    if (capability?.backend === "html-video"
      && capability?.api === "webview-video"
      && capability?.defaultPlaybackMode === "unqualifiedWebview"
      && capability?.requiredForQualifiedRun === false) return capability;
    if (capability?.runtimeIntegrityVerified === true && capability?.playerActorReady === true) return capability;
    if (!PENDING.has(capability?.reasonCode)) throw new Error("Native media startup is unavailable; import was not dispatched.");
    // A polling interval, not an assumed startup delay: every dispatch requires
    // an observed ready capability and the original deadline is never reset.
    await bounded(() => new Promise(resolve => setTimeout(resolve, 100)));
  }
}

/**
 * Sequential native decode qualification for one freshly scanned workspace.
 *
 * This module deliberately knows nothing about UI state, experiment planning,
 * paths, or Tauri window handles. It composes the typed native-media controller
 * into one bounded catalogue operation and guarantees an attempted actor stop
 * after every stimulus.
 */
export async function attestNativeGstCatalogue({
  controller,
  workspaceId,
  stimuli,
  viewportHost,
  onProgress = () => {},
} = {}) {
  if (!controller
    || typeof controller.prepare !== "function"
    || typeof controller.awaitPrepared !== "function"
    || typeof controller.attestDecode !== "function"
    || typeof controller.stop !== "function"
    || typeof workspaceId !== "string"
    || !Array.isArray(stimuli)
    || !viewportHost?.getBoundingClientRect
    || typeof onProgress !== "function") {
    throw new TypeError("Native GstPlay catalogue qualification inputs are malformed.");
  }

  const qualified = [];
  const failures = [];
  for (let index = 0; index < stimuli.length; index += 1) {
    const scanned = stimuli[index];
    onProgress(Object.freeze({ index, total: stimuli.length, scanned }));
    let operationError = null;
    try {
      await controller.prepare({ workspaceId, summary: scanned, host: viewportHost });
      await controller.awaitPrepared({ attempts: 600, intervalMs: 25 });
      qualified.push(await controller.attestDecode({ workspaceId, summary: scanned }));
    } catch (error) {
      operationError = error;
      failures.push(Object.freeze({ scanned, error }));
    } finally {
      try {
        await controller.stop();
      } catch (stopError) {
        if (!operationError) failures.push(Object.freeze({ scanned, error: stopError }));
      }
    }
  }
  onProgress(Object.freeze({ index: stimuli.length, total: stimuli.length, scanned: null }));
  return Object.freeze({
    qualified: Object.freeze(qualified),
    failures: Object.freeze(failures),
  });
}

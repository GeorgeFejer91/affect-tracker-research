/**
 * Sequential native decode qualification for one freshly scanned workspace.
 *
 * This module deliberately knows nothing about UI state, experiment planning,
 * paths, or Tauri window handles. It composes the typed native-media controller
 * into one bounded catalogue operation and guarantees an attempted actor stop
 * after every stimulus.
 */
import { NativeCatalogueFailure } from "./media-catalogue-error.js";
export { NativeCatalogueFailure };

export async function attestNativeGstCatalogue(options) {
  return attestCatalogue(options, "attestDecode");
}

export async function attestNativeGstCatalogueV2(options) {
  return attestCatalogue(options, "attestDecodeV2");
}

async function attestCatalogue({
  controller,
  workspaceId,
  stimuli,
  viewportHost,
  onProgress = () => {},
} = {}, attestMethod) {
  if (!controller
    || typeof controller.prepare !== "function"
    || typeof controller.awaitPrepared !== "function"
    || typeof controller[attestMethod] !== "function"
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
    let phase = "prepare";
    try {
      await controller.prepare({ workspaceId, summary: scanned, host: viewportHost });
      phase = "awaitPrepared";
      await controller.awaitPrepared({ attempts: 600, intervalMs: 25 });
      phase = "attestDecode";
      qualified.push(await controller[attestMethod]({ workspaceId, summary: scanned }));
    } catch (error) {
      operationError = error;
      failures.push(Object.freeze({ scanned, error, phase }));
    } finally {
      try {
        await controller.stop();
      } catch (stopError) {
        if (!operationError) failures.push(Object.freeze({ scanned, error: stopError, phase: "stop" }));
      }
    }
  }
  onProgress(Object.freeze({ index: stimuli.length, total: stimuli.length, scanned: null }));
  return Object.freeze({
    qualified: Object.freeze(qualified),
    failures: Object.freeze(failures),
  });
}

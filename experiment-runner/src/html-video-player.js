const READY_TIMEOUT_MS = 15000;
const START_TIMEOUT_MS = 15000;

const mediaErrorMessage = (video) => {
  const code = video.error?.code;
  return code ? `HTML video decode failed (${code}).` : "HTML video decode failed.";
};

const waitForReady = (video, windowObject) => {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("canplay", ready);
      video.removeEventListener("error", failed);
      if (timer !== null) windowObject.clearTimeout(timer);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(mediaErrorMessage(video))); };
    timer = windowObject.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while loading the JSON-selected video."));
    }, READY_TIMEOUT_MS);
    video.addEventListener("loadedmetadata", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("error", failed);
  });
};

const assertReceipt = (receipt, asset) => {
  if (!receipt || typeof receipt.mediaUrl !== "string" || !receipt.mediaUrl) {
    throw new Error("Runner did not receive a playable media URL.");
  }
  if (receipt.sha256 && receipt.sha256 !== asset.sha256) {
    throw new Error("Runner media URL belongs to a different video hash.");
  }
  if (receipt.byteLength !== asset.byteLength) {
    throw new Error("Runner media URL byte length does not match the JSON video.");
  }
  if (asset.mimeType && receipt.mimeType !== asset.mimeType) {
    throw new Error("Runner media URL metadata does not match the JSON video.");
  }
};

/**
 * Plays one video occurrence at a time.
 *
 * An occurrence is a single presentation of a step: the same media file played
 * twice is two occurrences with distinct identities. Exactly one `started`
 * (the first observed `playing` transition) and at most one terminal outcome
 * (`ended` from the real `ended` event, or `failed`) are reported per
 * occurrence. Pause, buffering and resume are reported separately and never
 * repeat the start. Events belonging to a superseded occurrence are dropped.
 */
export function createRunnerHtmlVideoPlayer(host, {
  invoke,
  windowObject = window,
  onStarted = () => {},
  onEnded = () => {},
  onFailed = () => {},
  onInterrupted = () => {},
  onResumed = () => {},
  releaseMediaUrl = () => {},
} = {}) {
  if (!(host instanceof HTMLElement) || typeof invoke !== "function") {
    throw new TypeError("Runner HTML video playback needs a host and native adapter.");
  }
  let generation = 0;
  let video = null;
  let current = null;

  const currentTimeMs = () => (video ? Math.max(0, Math.round(video.currentTime * 1000)) : 0);

  const settle = (occurrence, outcome, detail) => {
    if (occurrence.settled) return;
    occurrence.settled = outcome;
    if (occurrence.startTimer !== null) {
      windowObject.clearTimeout(occurrence.startTimer);
      occurrence.startTimer = null;
    }
    (outcome === "ended" ? onEnded : onFailed)(detail);
  };

  // Each occurrence owns its own element, so an event can only ever reach the
  // occurrence it belongs to. A late `ended` from a replaced video cannot be
  // mistaken for the next trial's outcome.
  const createVideo = (occurrence) => {
    const element = document.createElement("video");
    element.id = "run-webview-video";
    element.className = "runner-html-video";
    element.preload = "auto";
    element.playsInline = true;
    element.controls = false;
    element.disablePictureInPicture = true;
    element.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback");
    const mediaTime = () => Math.max(0, Math.round(element.currentTime * 1000));
    occurrence.listeners = {
      playing: () => {
        if (occurrence.settled) return;
        if (occurrence.startTimer !== null) {
          windowObject.clearTimeout(occurrence.startTimer);
          occurrence.startTimer = null;
        }
        if (occurrence.started) {
          onResumed({ occurrenceId: occurrence.id, mediaTimeMs: mediaTime() });
          return;
        }
        occurrence.started = true;
        onStarted({ occurrenceId: occurrence.id, mediaTimeMs: mediaTime() });
      },
      ended: () => {
        if (!occurrence.started) {
          settle(occurrence, "failed", {
            occurrenceId: occurrence.id,
            error: new Error("The video reported an end without any observed playback."),
          });
          return;
        }
        settle(occurrence, "ended", { occurrenceId: occurrence.id, mediaTimeMs: mediaTime() });
      },
      error: () => settle(occurrence, "failed", {
        occurrenceId: occurrence.id,
        error: new Error(mediaErrorMessage(element)),
      }),
      waiting: () => {
        if (occurrence.started && !occurrence.settled) onInterrupted({ occurrenceId: occurrence.id, reason: "buffering", mediaTimeMs: mediaTime() });
      },
      pause: () => {
        if (occurrence.started && !occurrence.settled && !element.ended) onInterrupted({ occurrenceId: occurrence.id, reason: "paused", mediaTimeMs: mediaTime() });
      },
    };
    for (const [type, handler] of Object.entries(occurrence.listeners)) element.addEventListener(type, handler);
    occurrence.element = element;
    return element;
  };

  const armStartWatchdog = (occurrence) => {
    occurrence.startTimer = windowObject.setTimeout(() => {
      occurrence.startTimer = null;
      if (occurrence.settled || occurrence.started) return;
      settle(occurrence, "failed", {
        occurrenceId: occurrence.id,
        error: new Error("The video never reported observed playback."),
      });
    }, START_TIMEOUT_MS);
  };

  // Ends the current occurrence's ownership: its element, timers and media URL
  // are released, and no later promise or event can act on it.
  const discard = () => {
    generation += 1;
    const occurrence = current;
    current = null;
    if (!occurrence) return;
    occurrence.settled = occurrence.settled ?? "discarded";
    if (occurrence.startTimer !== null) windowObject.clearTimeout(occurrence.startTimer);
    const element = occurrence.element;
    if (element) {
      for (const [type, handler] of Object.entries(occurrence.listeners ?? {})) element.removeEventListener(type, handler);
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    if (occurrence.mediaUrl) releaseMediaUrl(occurrence.mediaUrl);
    if (video === element) video = null;
  };

  const stop = () => {
    discard();
    host.replaceChildren();
    host.hidden = true;
    host.dataset.playbackState = "idle";
  };
  const pause = () => {
    if (!video) return;
    video.pause();
    host.dataset.playbackState = "paused";
  };
  const resume = async () => {
    if (!video) return;
    host.dataset.playbackState = "playing";
    await video.play();
  };

  const playStep = async ({ workspaceId, sourceText, participantId, selector, step, occurrenceId }) => {
    if (step?.kind !== "video") throw new Error("HTML playback requires a video step.");
    const asset = step.payload?.asset;
    if (!asset?.sha256 || !asset?.byteLength) {
      throw new Error("The selected video step is missing JSON media metadata.");
    }
    discard();
    const token = generation;
    const occurrence = {
      id: occurrenceId ?? `occurrence-${token}`,
      token,
      started: false,
      settled: null,
      mediaUrl: null,
      startTimer: null,
      element: null,
      listeners: null,
    };
    current = occurrence;
    const element = createVideo(occurrence);
    video = element;
    element.hidden = false;
    host.replaceChildren(element);
    host.hidden = false;
    host.dataset.playbackState = "resolving";
    let receipt;
    try {
      receipt = await invoke("research_runner_master_html_video_url", {
        request: {
          workspaceId,
          sourceText,
          participantId,
          selector,
          protocolStepPosition: step.position,
        },
      });
    } catch (error) {
      if (current === occurrence) discard();
      throw error;
    }
    // A late resolution for a superseded occurrence must not leak its URL.
    if (token !== generation) {
      if (receipt?.mediaUrl) releaseMediaUrl(receipt.mediaUrl);
      return null;
    }
    try {
      assertReceipt(receipt, asset);
    } catch (error) {
      releaseMediaUrl(receipt?.mediaUrl);
      discard();
      throw error;
    }
    occurrence.mediaUrl = receipt.mediaUrl;
    host.dataset.playbackState = "loading";
    element.src = receipt.mediaUrl;
    element.currentTime = 0;
    element.load();
    try {
      await waitForReady(element, windowObject);
    } catch (error) {
      if (token === generation) discard();
      throw error;
    }
    if (token !== generation) return null;
    host.dataset.playbackState = "playing";
    armStartWatchdog(occurrence);
    try {
      await element.play();
    } catch (error) {
      if (token === generation) {
        host.dataset.playbackState = "blocked";
        element.controls = true;
        discard();
      }
      throw error;
    }
    if (token !== generation) return null;
    return { receipt, video: element, occurrenceId: occurrence.id };
  };

  const destroy = () => {
    stop();
    video = null;
  };

  return Object.freeze({
    playStep,
    pause,
    resume,
    stop,
    destroy,
    currentTimeMs,
    get occurrenceId() { return current?.id ?? null; },
    get video() { return video; },
  });
}

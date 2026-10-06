const READY_TIMEOUT_MS = 15000;

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
  if (receipt.sha256 !== asset.sha256) {
    throw new Error("Runner media URL belongs to a different video hash.");
  }
  if (receipt.byteLength !== asset.byteLength) {
    throw new Error("Runner media URL byte length does not match the JSON video.");
  }
  if (asset.mimeType && receipt.mimeType !== asset.mimeType) {
    throw new Error("Runner media URL metadata does not match the JSON video.");
  }
};

export function createRunnerHtmlVideoPlayer(host, { invoke, windowObject = window, onEnded = () => {} } = {}) {
  if (!(host instanceof HTMLElement) || typeof invoke !== "function") {
    throw new TypeError("Runner HTML video playback needs a host and native adapter.");
  }
  let generation = 0;
  let video = null;
  let ended = null;
  let clearObservation = () => {};
  let requireNextFrame = () => {};

  const ensureVideo = () => {
    if (video) return video;
    video = document.createElement("video");
    video.id = "run-webview-video";
    video.className = "runner-html-video";
    video.preload = "auto";
    video.playsInline = true;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback");
    ended = () => { if (observing) return; onEnded(); };
    video.addEventListener("ended", ended);
    host.replaceChildren(video);
    return video;
  };

  let observing = false;
  const stop = () => {
    generation += 1;
    clearObservation();
    clearObservation = () => {};
    requireNextFrame = () => {};
    observing = false;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.hidden = true;
    }
    host.hidden = true;
    host.dataset.playbackState = "idle";
  };

  const playStep = async ({ workspaceId, sourceText, participantId, selector, step, receipt: suppliedReceipt, onObservation }) => {
    if (step?.kind !== "video") throw new Error("HTML playback requires a video step.");
    const asset = step.payload?.asset;
    if (!asset?.sha256 || !asset?.byteLength) {
      throw new Error("The selected video step is missing JSON media metadata.");
    }
    const token = generation + 1;
    generation = token;
    const element = ensureVideo();
    element.hidden = false;
    host.hidden = false;
    host.dataset.playbackState = "resolving";
    const receipt = suppliedReceipt ?? await invoke("research_runner_master_html_video_url", {
      request: {
        workspaceId,
        sourceText,
        participantId,
        selector,
        protocolStepPosition: step.position,
      },
    });
    if (token !== generation) return null;
    assertReceipt(receipt, asset);
    if (onObservation) {
      observing = true;
      let sequence = 0, decodedFrames = 0, awaitingFrame = true;
      requireNextFrame = () => { awaitingFrame = true; };
      const emit = (state) => {
        if (token !== generation) return;
        if ((state === "playing" || state === "ended") && decodedFrames === 0) return;
        const positionMs = Math.max(0, Number(element.currentTime) * 1000 || 0);
        void Promise.resolve(onObservation({ state, sequence: ++sequence, positionMs, decodedFrames })).catch(() => {});
      };
      const frame = (_now, metadata) => {
        if (token !== generation) return;
        decodedFrames = Math.max(decodedFrames + 1, Number(metadata?.presentedFrames) || 0);
        if (awaitingFrame && !element.paused) { awaitingFrame = false; emit("playing"); }
        element.requestVideoFrameCallback(frame);
      };
      if (typeof element.requestVideoFrameCallback !== "function") {
        throw new Error("This WebView cannot report decoded video frames.");
      }
      const handlers = [
        ["waiting", () => { awaitingFrame = true; emit("buffering"); }],
        ["stalled", () => { awaitingFrame = true; emit("buffering"); }],
        ["pause", () => { awaitingFrame = true; emit("paused"); }], ["ended", () => emit("ended")],
        ["error", () => emit("failed")],
      ];
      for (const [name, handler] of handlers) element.addEventListener(name, handler);
      const heartbeat = windowObject.setInterval(() => {
        if (element.error) emit("failed");
        else if (!element.paused && !awaitingFrame && element.readyState >= 2) emit("playing");
      }, 250);
      element.requestVideoFrameCallback(frame);
      clearObservation = () => {
        windowObject.clearInterval(heartbeat);
        for (const [name, handler] of handlers) element.removeEventListener(name, handler);
      };
    }
    host.dataset.playbackState = "loading";
    element.src = receipt.mediaUrl;
    element.currentTime = 0;
    element.load();
    await waitForReady(element, windowObject);
    if (token !== generation) return null;
    host.dataset.playbackState = "playing";
    try {
      await element.play();
    } catch (error) {
      host.dataset.playbackState = "blocked";
      element.controls = true;
      throw error;
    }
    return { receipt, video: element };
  };

  const destroy = () => {
    stop();
    if (video && ended) video.removeEventListener("ended", ended);
    host.replaceChildren();
    video = null;
    ended = null;
  };

  return Object.freeze({
    playStep,
    pause: () => video?.pause(),
    resume: async () => { if (video) { requireNextFrame(); await video.play(); } },
    stop,
    destroy,
    get video() { return video; },
  });
}

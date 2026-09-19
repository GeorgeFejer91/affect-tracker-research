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

export function createRunnerHtmlVideoPlayer(host, { invoke, windowObject = window, onEnded = () => {} } = {}) {
  if (!(host instanceof HTMLElement) || typeof invoke !== "function") {
    throw new TypeError("Runner HTML video playback needs a host and native adapter.");
  }
  let generation = 0;
  let video = null;
  let ended = null;

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
    ended = () => onEnded();
    video.addEventListener("ended", ended);
    host.replaceChildren(video);
    return video;
  };

  const stop = () => {
    generation += 1;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.hidden = true;
    }
    host.hidden = true;
    host.dataset.playbackState = "idle";
  };
  const currentTimeMs = () => video ? Math.max(0, Math.round(video.currentTime * 1000)) : 0;
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

  const playStep = async ({ workspaceId, sourceText, participantId, selector, step }) => {
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
    const receipt = await invoke("research_runner_master_html_video_url", {
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
    pause,
    resume,
    stop,
    destroy,
    currentTimeMs,
    get video() { return video; },
  });
}

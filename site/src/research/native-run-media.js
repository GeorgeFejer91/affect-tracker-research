const TERMINAL_FAILURE_STATES = new Set(["failed", "idle", "shuttingDown"]);

export function nativeRunMediaEdge(previous, current, context = {}) {
  if (!current || typeof current !== "object") {
    throw new TypeError("Native run media observation is missing.");
  }
  if (previous && current.sequence <= previous.sequence) return "none";
  if (TERMINAL_FAILURE_STATES.has(current.state)) return "failed";
  if (current.state === "ended") return context.awaitingStart ? "failed" : "completed";
  if (current.state === "buffering"
    && !context.awaitingStart && !context.manualPaused && !context.bufferPaused) return "bufferingStarted";
  if (current.state === "playing" && context.bufferPaused && !context.manualPaused) return "bufferingEnded";
  return "none";
}

/**
 * Owns only the native GstPlay surface and synchronous actor handshakes.
 * Protocol steps, sampling, persistence, and questionnaire decisions remain in
 * their respective coordinators.
 */
export class NativeRunMedia {
  constructor({ controller, resolveHost, resolveFallbackVideo, resolvePlaceholder } = {}) {
    if (!controller
      || typeof controller.prepare !== "function"
      || typeof controller.awaitState !== "function"
      || typeof controller.stop !== "function"
      || typeof resolveHost !== "function"
      || typeof resolveFallbackVideo !== "function"
      || typeof resolvePlaceholder !== "function") {
      throw new TypeError("NativeRunMedia requires a typed controller and surface resolvers.");
    }
    this.controller = controller;
    this.resolveHost = resolveHost;
    this.resolveFallbackVideo = resolveFallbackVideo;
    this.resolvePlaceholder = resolvePlaceholder;
    this.lastStatus = null;
  }

  get active() {
    return this.controller.activeFence !== null;
  }

  get positionMs() {
    return Math.max(0, Number(this.lastStatus?.positionMs) || 0);
  }

  async prepare({ workspaceId, summary }) {
    const host = this.#showNativeSurface();
    try {
      await this.controller.prepare({ workspaceId, summary, host });
      this.lastStatus = await this.controller.awaitPrepared({ attempts: 600, intervalMs: 25 });
      return this.lastStatus;
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
  }

  async play() {
    await this.controller.play();
    this.lastStatus = await this.controller.awaitState({ states: ["playing"], attempts: 400, intervalMs: 25 });
    return this.lastStatus;
  }

  async pause() {
    await this.controller.pause();
    this.lastStatus = await this.controller.awaitState({ states: ["paused"], attempts: 400, intervalMs: 25 });
    return this.lastStatus;
  }

  async status() {
    this.lastStatus = await this.controller.status();
    return this.lastStatus;
  }

  async setViewport() {
    const host = this.resolveHost();
    if (!host || host.hidden === true || host.getClientRects?.().length === 0) return this.lastStatus;
    this.lastStatus = await this.controller.setViewport(host);
    return this.lastStatus;
  }

  async stop() {
    try {
      if (this.active) this.lastStatus = await this.controller.stop();
      return this.lastStatus;
    } finally {
      this.lastStatus = null;
      this.resetSurface();
    }
  }

  resetSurface() {
    const host = this.resolveHost();
    if (host) host.hidden = true;
  }

  #showNativeSurface() {
    const host = this.resolveHost();
    const fallback = this.resolveFallbackVideo();
    const placeholder = this.resolvePlaceholder();
    if (!host?.getBoundingClientRect) {
      throw new Error("The native GstPlay run surface is missing.");
    }
    host.hidden = false;
    if (fallback) fallback.hidden = true;
    if (placeholder) placeholder.hidden = true;
    const rect = host.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) {
      host.hidden = true;
      throw new Error("The native GstPlay run surface has no rendered geometry.");
    }
    return host;
  }
}

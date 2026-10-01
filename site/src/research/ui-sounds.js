const SOUND_CUES = Object.freeze({
  press: [{ frequency: 520, at: 0, duration: 0.034, gain: 0.18, type: "sine" }],
  select: [
    { frequency: 500, at: 0, duration: 0.04, gain: 0.14, type: "sine" },
    { frequency: 720, at: 0.024, duration: 0.05, gain: 0.10, type: "triangle" },
  ],
  forward: [
    { frequency: 520, at: 0, duration: 0.045, gain: 0.14, type: "sine" },
    { frequency: 780, at: 0.036, duration: 0.055, gain: 0.11, type: "sine" },
  ],
  back: [
    { frequency: 640, at: 0, duration: 0.036, gain: 0.10, type: "triangle" },
    { frequency: 440, at: 0.03, duration: 0.048, gain: 0.09, type: "sine" },
  ],
  confirm: [
    { frequency: 560, at: 0, duration: 0.045, gain: 0.14, type: "sine" },
    { frequency: 880, at: 0.04, duration: 0.064, gain: 0.11, type: "triangle" },
  ],
  invalid: [
    { frequency: 260, at: 0, duration: 0.06, gain: 0.13, type: "triangle" },
    { frequency: 220, at: 0.048, duration: 0.07, gain: 0.10, type: "triangle" },
  ],
});

const QUESTIONNAIRE_SELECT_TYPES = new Set([
  "boolean",
  "buttongroup",
  "checkbox",
  "dropdown",
  "imagepicker",
  "matrix",
  "matrixdropdown",
  "matrixdynamic",
  "radiogroup",
  "ranking",
  "rating",
  "slider",
  "tagbox",
]);
const CONFIRM_IDS = new Set(["package-generate", "runner-launch", "runner-prepare", "runner-record-start", "runner-stop-confirm"]);
const BACK_IDS = new Set(["runner-back", "runner-stop-cancel"]);

export function normalizeUiSoundCue(cue) {
  const normalized = String(cue ?? "").trim().toLowerCase();
  return Object.hasOwn(SOUND_CUES, normalized) ? normalized : null;
}

export function questionnaireSoundCueForType(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  return QUESTIONNAIRE_SELECT_TYPES.has(normalized) ? "select" : null;
}

export function buttonSoundCueForDescriptor({
  id = "",
  classes = [],
  dataset = {},
  disabled = false,
  hidden = false,
  questionnaire = false,
  text = "",
} = {}) {
  if (disabled || hidden) return null;
  if (String(dataset.uiSound ?? "").trim().toLowerCase() === "off") return null;
  const requestedCue = normalizeUiSoundCue(dataset.uiSound);
  if (requestedCue) return requestedCue;
  const classSet = new Set(classes);
  const label = `${id} ${text}`.toLowerCase();
  if (questionnaire) {
    if (/previous|back|zuruck|zurück/u.test(label)) return "back";
    if (/next|submit|complete|finish|weiter/u.test(label)) return "forward";
    return "press";
  }
  if (dataset.closeDialog || BACK_IDS.has(id)) return "back";
  if (dataset.confirmSection || dataset.sheetAction === "save" || classSet.has("primary-action") || CONFIRM_IDS.has(id)) return "confirm";
  if (id.startsWith("runner-") || dataset.sheetAction || dataset.controllerCapture || dataset.feedbackPreviewMode
    || dataset.responsePreviewMode || dataset.colorAnchor || dataset.openSection) return "press";
  return null;
}

function audioContextConstructor(windowObject) {
  return windowObject?.AudioContext ?? windowObject?.webkitAudioContext ?? null;
}

function setGain(gain, start, stop, volume) {
  gain.gain.cancelScheduledValues?.(start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume), start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, Math.max(start + 0.014, stop - 0.004));
}

function scheduleTone(context, tone, baseTime, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = baseTime + tone.at;
  const stop = start + tone.duration;
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, start);
  setGain(gain, start, stop, volume * tone.gain);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(stop);
  const disconnect = () => {
    try { oscillator.disconnect(); } catch { /* already disconnected */ }
    try { gain.disconnect(); } catch { /* already disconnected */ }
  };
  if (typeof oscillator.addEventListener === "function") oscillator.addEventListener("ended", disconnect, { once: true });
  else oscillator.onended = disconnect;
}

export function createMinimalUiSounds({
  windowObject = globalThis.window,
  enabled = true,
  volume = 0.045,
  minIntervalMs = 32,
} = {}) {
  let context = null;
  let disposed = false;
  let lastPlayedAt = -Infinity;
  const clock = () => windowObject?.performance?.now?.() ?? Date.now();
  function contextForPlayback() {
    if (context || disposed) return context;
    const AudioContext = audioContextConstructor(windowObject);
    if (typeof AudioContext !== "function") return null;
    try { context = new AudioContext(); }
    catch { context = null; }
    return context;
  }
  return {
    play(cue = "press") {
      const normalized = normalizeUiSoundCue(cue);
      if (!enabled || disposed || !normalized || !(volume > 0)) return false;
      const playedAt = clock();
      if (playedAt - lastPlayedAt < minIntervalMs) return false;
      const audio = contextForPlayback();
      if (!audio) return false;
      try {
        if (audio.state === "suspended") void audio.resume?.().catch?.(() => {});
        const baseTime = audio.currentTime + 0.004;
        for (const tone of SOUND_CUES[normalized]) scheduleTone(audio, tone, baseTime, volume);
        lastPlayedAt = playedAt;
        return true;
      } catch {
        return false;
      }
    },
    setEnabled(value) { enabled = Boolean(value); },
    destroy() {
      disposed = true;
      const closing = context;
      context = null;
      if (closing?.state && closing.state !== "closed") void closing.close?.().catch?.(() => {});
    },
  };
}

function elementClasses(element) {
  try { return [...(element.classList ?? [])]; }
  catch { return []; }
}

function isDisabledElement(element) {
  return Boolean(element.disabled || element.getAttribute?.("aria-disabled") === "true"
    || element.closest?.("fieldset[disabled], [inert]"));
}

function isHiddenElement(element) {
  return Boolean(element.hidden || element.closest?.("[hidden]"));
}

function buttonDescriptor(button) {
  return {
    id: button.id ?? "",
    classes: elementClasses(button),
    dataset: { ...(button.dataset ?? {}) },
    disabled: isDisabledElement(button),
    hidden: isHiddenElement(button),
    questionnaire: Boolean(button.closest?.("#runner-questionnaire, #questionnaire-sheet-preview-content")),
    text: button.textContent ?? "",
  };
}

export function installMinimalButtonSounds(root, sounds) {
  if (!root?.addEventListener || !sounds?.play) return () => {};
  const play = (cue) => {
    try { sounds.play(cue); } catch { /* sound is ornamental */ }
  };
  const onClick = (event) => {
    const button = event.target?.closest?.("button");
    if (!button || !root.contains?.(button) || button.closest?.(".affect-surveyjs, #runner-questionnaire-form")) return;
    const cue = buttonSoundCueForDescriptor(buttonDescriptor(button));
    if (cue) play(cue);
  };
  const onChange = (event) => {
    const target = event.target;
    if (!target?.matches?.("input[type='radio'], input[type='checkbox'], select") || !root.contains?.(target)) return;
    if (target.closest?.(".affect-surveyjs") || !target.closest?.("#runner-questionnaire-form")) return;
    if (!isDisabledElement(target) && !isHiddenElement(target)) play("select");
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  return () => {
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
  };
}

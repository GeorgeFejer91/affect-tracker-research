import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [runnerExe, destination] = process.argv.slice(2);
assert.ok(runnerExe && destination, "Usage: node scripts/qualification/runner-live-html-video-cdp.mjs <affect-runner.exe> <output-dir>");

const output = resolve(destination);
await mkdir(output, { recursive: true });
const debugPort = 9445;
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

const runner = spawn(resolve(runnerExe), [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-allow-origins=*`,
  },
  stdio: ["ignore", "ignore", "pipe"],
  windowsHide: false,
});

const fetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
};

let ws = null;
let receipt = null;
try {
  let tabs = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      tabs = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      if (tabs?.some(tab => tab.title === "Experiment Runner" && tab.webSocketDebuggerUrl)) break;
    } catch {
      await wait(100);
    }
  }
  const target = tabs?.find(tab => tab.title === "Experiment Runner" && tab.webSocketDebuggerUrl);
  assert.ok(target, "Experiment Runner did not expose a WebView2 debug target.");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", rejectOpen, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    if (message.error) slot.reject(new Error(JSON.stringify(message.error)));
    else slot.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
    const next = ++id;
    pending.set(next, { resolve: resolveSend, reject: rejectSend });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.exception?.value
        ?? result.exceptionDetails.text
        ?? "Runtime evaluation failed";
      throw new Error(detail);
    }
    return result.result.value;
  };
  const screenshot = async name => {
    const result = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, name), Buffer.from(result.data, "base64"));
  };
  const state = () => evaluate(`(() => {
    const root = document.querySelector("#experiment-runner");
    const q = id => root?.querySelector("#" + id);
    const video = q("run-webview-video");
    const overlay = root?.querySelector("[data-preview-overlay]");
    const flubber = root?.querySelector("[data-preview-flubber]");
    const grid = root?.querySelector("[data-preview-grid]");
    const feedback = root?.querySelector(".run-feedback-stage");
    const stage = root?.querySelector(".stimulus-stage");
    const session = q("runner-session")?.textContent ?? "";
    const match = /validation step (\\d+)\\/(\\d+)/u.exec(session);
    const selection = root?.runner?.selection;
    return {
      title: document.title,
      rootReady: Boolean(root?.runner),
      recipeLoaded: Boolean(root?.runner?.recipe),
      selectionReady: Boolean(selection),
      stepNumber: match ? Number(match[1]) : null,
      stepCount: match ? Number(match[2]) : null,
      currentStep: match && selection?.steps ? selection.steps[Number(match[1]) - 1]?.kind : null,
      steps: selection?.steps?.map((step, index) => ({
        index,
        kind: step.kind,
        durationMs: step.durationMs,
        position: step.position,
        title: step.kind === "interval" ? step.payload.definition.isiId : step.kind === "video" ? step.payload.entry?.referenceId ?? step.payload.asset?.annotationId : step.payload.definition?.title,
      })) ?? [],
      session,
      stimulus: q("runner-stimulus")?.textContent ?? "",
      timing: q("runner-timing")?.textContent ?? "",
      errorHidden: q("runner-error")?.hidden ?? null,
      errorText: q("runner-error")?.textContent ?? "",
      stageHidden: stage?.hidden ?? null,
      feedbackHidden: feedback?.hidden ?? null,
      placeholder: q("run-stimulus-placeholder")?.textContent ?? "",
      overlayHidden: overlay?.hidden ?? null,
      overlayLocked: overlay?.dataset.locked ?? null,
      flubberPresent: Boolean(flubber),
      flubberHidden: flubber ? flubber.hasAttribute("hidden") : null,
      gridPresent: Boolean(grid),
      gridHidden: grid ? grid.hasAttribute("hidden") : null,
      videoHostHidden: q("run-native-video-host")?.hidden ?? null,
      videoHostState: q("run-native-video-host")?.dataset.playbackState ?? null,
      videoExists: Boolean(video),
      videoHidden: video?.hidden ?? null,
      videoSrc: video?.currentSrc || video?.src || "",
      paused: video?.paused ?? null,
      ended: video?.ended ?? null,
      currentTime: video?.currentTime ?? null,
      duration: Number.isFinite(video?.duration) ? video.duration : null,
      readyState: video?.readyState ?? null,
      networkState: video?.networkState ?? null,
      videoWidth: video?.videoWidth ?? null,
      videoHeight: video?.videoHeight ?? null,
      error: video?.error ? { code: video.error.code, message: video.error.message } : null,
    };
  })()`);
  const waitFor = async (predicate, label, attempts = 120, intervalMs = 100) => {
    let latest = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      latest = await state();
      if (predicate(latest)) return latest;
      await wait(intervalMs);
    }
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(latest)}`);
  };
  const pressAltN = async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "n", code: "KeyN", windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, modifiers: 1 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "n", code: "KeyN", windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, modifiers: 1 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 0 });
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await waitFor(next => next.rootReady, "Runner boot");
  await pressAltN();
  await waitFor(next => next.selectionReady && next.stepNumber !== null, "validation traversal selection");

  let intervalBeforeVideo = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await state();
    intervalBeforeVideo ??= current.steps.find(step => step.kind === "interval" && step.durationMs > 0 && current.steps[step.index + 1]?.kind === "video");
    if (intervalBeforeVideo && current.stepNumber === intervalBeforeVideo.index + 1) break;
    await pressAltN();
    await wait(250);
  }
  const isi = await waitFor(next => {
    intervalBeforeVideo ??= next.steps.find(step => step.kind === "interval" && step.durationMs > 0 && next.steps[step.index + 1]?.kind === "video");
    return intervalBeforeVideo && next.stepNumber === intervalBeforeVideo.index + 1 && next.currentStep === "interval";
  }, "interstimulus interval before a video", 80, 100);
  await screenshot("isi.png");

  assert.equal(isi.placeholder, "", "ISI must not show stimulus text.");
  assert.equal(isi.feedbackHidden, false, "Feedback must remain visible during ISI.");
  assert.equal(isi.overlayHidden, false, "Feedback overlay must remain visible during ISI.");
  assert.equal(isi.overlayLocked, "true", "Feedback overlay must be locked during ISI.");
  assert.equal(isi.flubberPresent, true, "Flubber must be mounted during ISI.");
  assert.equal(isi.flubberHidden, false, "Flubber must be visible during ISI.");
  assert.match(isi.timing, /waiting/u, "ISI must report waiting state.");

  const afterVideoStart = await waitFor(next => next.stepNumber === intervalBeforeVideo.index + 2
    && next.currentStep === "video"
    && next.videoExists
    && next.videoHostState === "playing"
    && next.paused === false
    && next.readyState >= 2
    && next.currentTime > 0, "automatic video start after ISI", Math.ceil((intervalBeforeVideo.durationMs + 6000) / 100), 100);
  await wait(900);
  const laterVideo = await state();
  await screenshot("video.png");

  assert.equal(afterVideoStart.placeholder, "", "Video step must not show placeholder text.");
  assert.match(afterVideoStart.videoSrc, /^http:\/\/research-media\.localhost\//u, "Video source must be the Runner media URL.");
  assert.equal(laterVideo.paused, false, "Video must keep playing after automatic start.");
  assert.ok(laterVideo.currentTime > afterVideoStart.currentTime, "Video currentTime must advance.");
  assert.ok(laterVideo.videoWidth > 0 && laterVideo.videoHeight > 0, "Video dimensions must be decoded.");

  receipt = {
    schema: "affect-runner-live-html-video-cdp-proof",
    version: 1,
    runnerExe: resolve(runnerExe),
    targetUrl: target.url,
    intervalBeforeVideo,
    isi,
    afterVideoStart,
    laterVideo,
    timeAdvancedSeconds: laterVideo.currentTime - afterVideoStart.currentTime,
    screenshots: {
      isi: join(output, "isi.png"),
      video: join(output, "video.png"),
    },
  };
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({
    interval: intervalBeforeVideo,
    videoSrc: afterVideoStart.videoSrc,
    firstCurrentTime: afterVideoStart.currentTime,
    laterCurrentTime: laterVideo.currentTime,
    timeAdvancedSeconds: receipt.timeAdvancedSeconds,
    overlayLocked: isi.overlayLocked,
    feedbackVisibleDuringIsi: !isi.feedbackHidden && !isi.overlayHidden,
  }));
} finally {
  if (receipt === null) {
    await writeFile(join(output, "receipt.failed.txt"), "Live Runner HTML video verification did not complete.\n").catch(() => {});
  }
  ws?.close();
  runner.kill();
}

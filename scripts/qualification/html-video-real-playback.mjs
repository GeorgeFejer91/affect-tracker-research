import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const [browser, destination, sourceVideo] = process.argv.slice(2);
assert.ok(browser && destination && sourceVideo, "Usage: node scripts/qualification/html-video-real-playback.mjs <browser> <output-dir> <video>");

const output = resolve(destination);
const videoPath = resolve(sourceVideo);
await mkdir(output, { recursive: true });
const videoStat = await stat(videoPath);

let servedUrl = null;

const page = `<!doctype html>
<meta charset="utf-8">
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
video { width: 100vw; height: 100vh; object-fit: contain; background: #000; }
</style>
<video id="video" src="/video/${encodeURIComponent(basename(videoPath))}" playsinline preload="auto"></video>
<script>
const video = document.getElementById("video");
window.videoProof = {
  async ready() {
    if (video.readyState < 1) {
      await new Promise((resolve, reject) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("metadata failed")), { once: true });
      });
    }
    return { duration: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight, readyState: video.readyState };
  },
  async play() {
    await video.play();
    return { paused: video.paused, currentTime: video.currentTime, readyState: video.readyState };
  },
  sample() {
    return { paused: video.paused, currentTime: video.currentTime, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight };
  }
};
</script>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(page);
      return;
    }
    if (!url.pathname.startsWith("/video/")) {
      response.writeHead(404).end();
      return;
    }
    const range = request.headers.range;
    response.setHeader("Content-Type", "video/mp4");
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "no-store");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
      if (!match) {
        response.writeHead(416).end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : videoStat.size - 1;
      response.writeHead(206, {
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${videoStat.size}`,
      });
      createReadStream(videoPath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { "Content-Length": videoStat.size });
    createReadStream(videoPath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise(resolveServer => server.listen(0, "127.0.0.1", resolveServer));
servedUrl = `http://127.0.0.1:${server.address().port}/`;

const debugPort = 9334;
const chrome = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${join(output, "chrome-profile")}`,
  "--window-size=1280,720",
  "--force-device-scale-factor=1",
  servedUrl,
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
const fetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
};

let ws;
try {
  let tabs = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      tabs = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      if (tabs?.some(tab => tab.url === servedUrl && tab.webSocketDebuggerUrl)) break;
    } catch {
      await wait(100);
    }
  }
  const pageTarget = tabs?.find(tab => tab.url === servedUrl && tab.webSocketDebuggerUrl);
  const endpoint = pageTarget?.webSocketDebuggerUrl;
  assert.ok(endpoint, "Chrome did not expose a debugging target.");
  ws = new WebSocket(endpoint);
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
  const evaluate = async (expression, options = {}) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...options });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        ?? result.exceptionDetails.exception?.value
        ?? result.exceptionDetails.text
        ?? "Runtime evaluation failed";
      throw new Error(detail);
    }
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  let harnessReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    harnessReady = await evaluate("Boolean(window.videoProof && document.getElementById('video'))");
    if (harnessReady) break;
    await wait(100);
  }
  assert.ok(harnessReady, "The HTML video proof page did not initialize.");
  await evaluate("window.videoProof.ready()");
  const metadata = await evaluate("window.videoProof.ready()");
  const started = await evaluate("window.videoProof.play()", { userGesture: true });
  await wait(1200);
  const first = await evaluate("window.videoProof.sample()");
  const firstPng = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "frame-1.png"), Buffer.from(firstPng.data, "base64"));
  await wait(1200);
  const second = await evaluate("window.videoProof.sample()");
  const secondPng = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "frame-2.png"), Buffer.from(secondPng.data, "base64"));
  const receipt = {
    schema: "affect-html-video-real-playback-proof",
    version: 1,
    sourceVideo: videoPath,
    sourceByteLength: videoStat.size,
    metadata,
    started,
    first,
    second,
    timeAdvancedSeconds: second.currentTime - first.currentTime,
    scope: "Real Chromium HTMLVideoElement playback of the exact workspace MP4; no Tauri recording or LSL.",
  };
  assert.equal(metadata.videoWidth, 1920);
  assert.equal(metadata.videoHeight, 1080);
  assert.ok(Math.abs(metadata.duration - 254.405) < 0.2);
  assert.equal(started.paused, false);
  assert.equal(second.paused, false);
  assert.ok(receipt.timeAdvancedSeconds > 0.75);
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}

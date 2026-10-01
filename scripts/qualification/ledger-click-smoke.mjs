import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 18913;
const url = `http://127.0.0.1:${port}/planner-ledger/`;
const profile = await mkdtemp(join(tmpdir(), "affect-ledger-smoke-"));
const server = spawn(process.execPath, ["scripts/serve-site.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message) {
  for (let i = 0; i < 120; i += 1) {
    try { const result = await fn(); if (result) return result; } catch {}
    await pause(100);
  }
  throw new Error(message);
}

let browser;
let socket;
try {
  await until(async () => (await fetch(url)).ok, "Planner site did not start");
  browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1280,900", url], { windowsHide: true, stdio: "ignore" });
  const debugPort = await until(async () => (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Headless Chrome did not start");
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === "page" && item.url.includes("planner-ledger")), "Planner tab missing");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const pending = new Map();
  let id = 0;
  socket.onmessage = event => {
    const reply = JSON.parse(event.data);
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    reply.error ? waiter.fail(new Error(reply.error.message)) : waiter.done(reply.result);
  };
  const send = (method, params = {}) => new Promise((done, fail) => {
    const next = ++id;
    pending.set(next, { done, fail });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  await until(async () => await evaluate("!!document.querySelector('#workspace-choose') && document.querySelector('#research-app')?.getAttribute('aria-busy') === 'false'"), "Planner did not initialize");
  for (const [width, height] of [[640, 480], [1280, 900], [1920, 1080]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await pause(150);
    const button = await evaluate(`(() => { const b = document.querySelector('#workspace-choose'); const r = b.getBoundingClientRect(); const x = r.left+r.width/2, y = r.top+r.height/2; const hit = document.elementFromPoint(x,y); return { width: r.width, height: r.height, hit: hit === b || b.contains(hit), target: hit?.tagName }; })()`);
    assert.ok(button.width >= 24 && button.height >= 24 && button.hit, `${width}×${height} workspace button obstructed or too small: ${JSON.stringify(button)}`);
  }
  const tab = await evaluate(`(() => { const r = document.querySelector('#setup-trigger-questionnaires').getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: tab.x, y: tab.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: tab.x, y: tab.y, button: "left", clickCount: 1 });
  await until(async () => await evaluate("document.querySelector('#setup-trigger-questionnaires')?.getAttribute('aria-expanded') === 'true'"), "Tab did not open from pointer click");
  console.log("Ledger pointer hit test passed at 640×480, 1280×900, and 1920×1080; tab clicked.");
  await send("Browser.close").catch(() => {});
} finally {
  socket?.close();
  browser?.kill();
  server.kill();
  if (resolve(profile).startsWith(resolve(tmpdir()) + sep)) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await rm(profile, { recursive: true, force: true }); break; }
      catch (error) {
        if (error.code !== "EBUSY" || attempt === 29) throw error;
        await pause(100);
      }
    }
  }
}

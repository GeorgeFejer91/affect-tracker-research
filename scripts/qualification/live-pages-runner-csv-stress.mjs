// Live GitHub Pages Runner CSV qualification.
// Drives the deployed browser Runner through Chrome DevTools Protocol with
// test-only File System Access/media/download shims injected before app boot.
// This is browser CSV evidence only; it is not desktop LSL/XDF evidence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { sha256Hex } from "../../site/src/research/canonical.js";
import { readRunnerRecipe, resolveRunnerSelection } from "../../runner/src/recipe.js";

const [
  browser,
  destination,
  iterationsArg = "4",
  recipeVersion = "5",
  pageUrl = "https://georgefejer91.github.io/affect-tracker-research/runner/",
] = process.argv.slice(2);

assert.ok(browser && destination, "Usage: node scripts/qualification/live-pages-runner-csv-stress.mjs <browser> <output-dir> [iterations] [4|5] [runner-url]");
assert.ok(["4", "5"].includes(recipeVersion), "Live Runner CSV stress supports fixture recipe versions 4 and 5.");
const iterations = Number.parseInt(iterationsArg, 10);
assert.ok(Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= 12, "iterations must be 1..12");

const output = resolve(destination);
await mkdir(output, { recursive: true });
const encoder = new TextEncoder();
const repoRoot = resolve(import.meta.dirname, "../..");
const fixturePath = recipeVersion === "5"
  ? resolve(repoRoot, "test/fixtures/planner-recipe-v5.bundle.json")
  : resolve(repoRoot, "test/fixtures/planner-recipe-v4-surveyjs.canonical.json");
const fixtureText = await readFile(fixturePath, "utf8");

function parseCsvRows(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quote) {
      if (char === "\"" && csv[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") quote = false;
      else cell += char;
    } else if (char === "\"") quote = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  assert.equal(quote, false, "CSV quote closed");
  assert.deepEqual(row, [], "CSV has no unterminated final row");
  assert.equal(cell, "", "CSV ends on newline");
  const headers = rows.shift() ?? [];
  return rows.filter(item => item.length === headers.length && item.some(Boolean))
    .map(item => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
}

const payload = (row, label) => {
  assert.ok(row?.payload_json, `${label} row has payload_json`);
  return JSON.parse(row.payload_json);
};

async function reconstructBrowserCsv(download, index) {
  assert.ok(download.text && download.fileName.endsWith(".csv"), "download contains CSV text");
  const csvDirectory = join(output, "csv");
  await mkdir(csvDirectory, { recursive: true });
  const csvPath = join(csvDirectory, `${String(index + 1).padStart(2, "0")}-${download.fileName}`);
  await writeFile(csvPath, download.text);
  const rows = parseCsvRows(download.text);
  const events = rows.filter(row => row.row_type === "event");
  const samples = rows.filter(row => row.row_type === "sample");
  const questionnaires = rows.filter(row => row.row_type === "questionnaire");
  const startup = payload(events.find(row => row.event_type === "runStarted"), "startup");
  const terminalRow = events.find(row => row.event_type === "runComplete" || row.event_type === "runPartial");
  const outcome = payload(terminalRow, "outcome");
  const receipt = await readRunnerRecipe(encoder.encode(startup.recipeSourceText));
  const plan = await resolveRunnerSelection(
    receipt,
    startup.participantId,
    startup.selector.languageSelectionPath,
    startup.selector.variantId,
  );
  assert.equal(receipt.canonicalSourceByteSha256, startup.recipeSourceByteSha256);
  assert.equal(plan.planIdentitySha256, startup.planIdentitySha256);
  assert.equal(plan.version, startup.planVersion);
  assert.equal(plan.steps.length, startup.stepCount);
  assert.equal(outcome.recipeSourceByteSha256, startup.recipeSourceByteSha256);
  assert.equal(outcome.planIdentitySha256, startup.planIdentitySha256);
  assert.equal(outcome.participantId, startup.participantId);
  assert.deepEqual(outcome.selector, startup.selector);
  assert.equal(outcome.recordingFinalization, "browser-csv-downloaded");
  if (outcome.protocolOutcome === "completed") assert.equal(outcome.completedStepCount, plan.steps.length);

  const stepByPosition = new Map(plan.steps.map(step => [String(step.position), step]));
  for (const row of rows) {
    assert.equal(row.recipe_sha256, startup.recipeSourceByteSha256);
    assert.equal(row.plan_sha256, startup.planIdentitySha256);
    assert.equal(row.participant_id, startup.participantId);
    assert.equal(row.variant_id, startup.selector.variantId);
    if (row.protocol_step_position && row.protocol_step_position !== "0") {
      assert.ok(stepByPosition.has(row.protocol_step_position), `known step ${row.protocol_step_position}`);
    }
  }
  for (const row of samples) {
    for (const key of ["current_valence", "current_arousal", "target_valence", "target_arousal", "radius", "angle_degrees"]) {
      assert.ok(Number.isFinite(Number(row[key])), `finite sample ${key}`);
    }
    assert.ok(["true", "false"].includes(row.animation_active));
    assert.ok(["true", "false"].includes(row.input_active));
    if (row.relative_path) {
      const step = stepByPosition.get(row.protocol_step_position);
      assert.equal(row.relative_path, step?.payload?.asset?.packageRelativePath ?? "");
    }
  }
  for (const row of questionnaires) {
    const step = stepByPosition.get(row.protocol_step_position);
    assert.equal(step?.kind, "questionnaire");
    assert.equal(row.questionnaire_id, step.payload.definition.questionnaireId);
    assert.ok(row.item_id);
    assert.ok(row.answer_value);
    payload(row, "questionnaire");
  }
  assert.ok(questionnaires.some(row => /demographics/u.test(row.questionnaire_id)), "demographics rows reconstructed");
  assert.ok(samples.length > 0, "sample rows reconstructed");
  return {
    fileName: download.fileName,
    csvPath,
    sha256: await sha256Hex(encoder.encode(download.text)),
    rows: rows.length,
    samples: samples.length,
    questionnaires: questionnaires.length,
    outcome: outcome.protocolOutcome,
    planVersion: plan.version,
    questionnaireAssetCount: startup.questionnaireAssetCount,
  };
}

function hexArrayBuffer(hex) {
  const bytes = [];
  for (let index = 0; index < hex.length; index += 2) bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  return `new Uint8Array([${bytes.join(",")}]).buffer`;
}

const preloadScript = `
(() => {
  const fixtureText = ${JSON.stringify(fixtureText)};
  const fixtureName = ${JSON.stringify(basename(fixturePath))};
  const stress = { downloads: [], mediaUrls: [], errors: [], routeEvents: [] };
  Object.defineProperty(window, "__affectLiveStress", { configurable: true, value: stress });
  addEventListener("error", event => stress.errors.push(event.message));
  addEventListener("unhandledrejection", event => stress.errors.push(String(event.reason)));

  function syntheticBytes(byte, size) {
    const bytes = new Uint8Array(size);
    bytes.fill(byte);
    return bytes;
  }
  const mediaFiles = new Map([
    ["assets/stimuli/session_a/clip.mp4", new File([syntheticBytes(0xdd, 1024)], "clip.mp4", { type: "video/mp4" })],
    ["assets/stimuli/session-a/clip.mp4", new File([syntheticBytes(0xdd, 1024)], "clip.mp4", { type: "video/mp4" })],
    ["assets/stimuli/session2/portrait.mp4", new File([syntheticBytes(0xbb, 2048)], "portrait.mp4", { type: "video/mp4" })],
  ]);
  function fileHandle(file) {
    return Object.freeze({ kind: "file", name: file.name, async getFile() { return file; } });
  }
  function directoryHandle(name, prefix = "") {
    return Object.freeze({
      kind: "directory",
      name,
      async getDirectoryHandle(part) {
        const next = prefix ? prefix + "/" + part : part;
        if (![...mediaFiles.keys()].some(path => path.startsWith(next + "/"))) throw Error("Missing directory " + next);
        return directoryHandle(part, next);
      },
      async getFileHandle(part) {
        const path = prefix ? prefix + "/" + part : part;
        const file = mediaFiles.get(path);
        if (!file) throw Error("Missing file " + path);
        return fileHandle(file);
      },
    });
  }
  window.showOpenFilePicker = async () => [Object.freeze({
    kind: "file",
    name: fixtureName,
    async getFile() { return new File([fixtureText], fixtureName, { type: "application/json" }); },
  })];
  window.showDirectoryPicker = async () => directoryHandle("live-pages-synthetic-project");

  const objectUrlBlobs = new Map();
  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const id = "blob:live-stress-" + objectUrlBlobs.size;
    objectUrlBlobs.set(id, blob);
    if (!String(blob?.type ?? "").startsWith("text/csv")) stress.mediaUrls.push({ id, type: blob?.type ?? "", size: blob?.size ?? 0 });
    return id;
  };
  URL.revokeObjectURL = (id) => objectUrlBlobs.delete(id) || originalRevokeObjectURL(id);
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    const blob = objectUrlBlobs.get(this.href);
    if (blob && String(this.download ?? "").endsWith(".csv")) {
      const download = { fileName: this.download, href: this.href, text: null };
      stress.downloads.push(download);
      blob.text().then(text => { download.text = text; });
      return;
    }
    return originalAnchorClick.call(this);
  };

  const digestShim = (originalDigest, receiver) => function digest(algorithm, data) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
      if (bytes?.length === 1024 && bytes.every(byte => byte === 0xdd)) return Promise.resolve(${hexArrayBuffer("d".repeat(64))});
      if (bytes?.length === 2048 && bytes.every(byte => byte === 0xbb)) return Promise.resolve(${hexArrayBuffer("b".repeat(64))});
      return originalDigest.call(receiver ?? this, algorithm, data);
    };
  if (globalThis.CryptoSubtle?.prototype?.digest) {
    const originalDigest = CryptoSubtle.prototype.digest;
    CryptoSubtle.prototype.digest = digestShim(originalDigest);
  }
  if (globalThis.crypto?.subtle?.digest) {
    const originalDigest = globalThis.crypto.subtle.digest;
    try {
      Object.defineProperty(globalThis.crypto.subtle, "digest", {
        configurable: true,
        value: digestShim(originalDigest, globalThis.crypto.subtle),
      });
    } catch {}
  }

  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get() { return this.dataset.syntheticReady === "true" ? 2 : 0; },
  });
  HTMLMediaElement.prototype.load = function load() {
    this.dataset.syntheticReady = this.src ? "true" : "false";
    if (this.src) {
      setTimeout(() => {
        this.dispatchEvent(new Event("loadedmetadata"));
        this.dispatchEvent(new Event("canplay"));
      }, 0);
    }
  };
  HTMLMediaElement.prototype.play = function play() {
    this.dataset.syntheticPlaying = "true";
    let pulses = 0;
    this.__stressInputClock ??= setInterval(() => {
      pulses += 1;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
      const stage = document.querySelector(".run-feedback-stage");
      const bounds = stage?.getBoundingClientRect?.();
      if (stage && bounds && bounds.width > 0 && bounds.height > 0) {
        const pointer = { bubbles: true, clientX: bounds.left + bounds.width * 0.82, clientY: bounds.top + bounds.height * 0.18, pointerId: 1, pointerType: "mouse" };
        stage.dispatchEvent(new PointerEvent("pointerdown", pointer));
        stage.dispatchEvent(new PointerEvent("pointermove", pointer));
      }
      if (pulses > 80 && this.__stressInputClock) {
        clearInterval(this.__stressInputClock);
        this.__stressInputClock = null;
      }
    }, 20);
    this.__stressClock ??= setInterval(() => {
      try {
        this.currentTime = Number(this.currentTime || 0) + 0.05;
        if (this.currentTime > 5) this.dispatchEvent(new Event("ended"));
      } catch {}
    }, 16);
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function pause() {
    this.dataset.syntheticPlaying = "false";
    if (this.__stressClock) clearInterval(this.__stressClock);
    if (this.__stressInputClock) clearInterval(this.__stressInputClock);
    this.__stressClock = null;
    this.__stressInputClock = null;
  };

  let syntheticFullscreen = false;
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => syntheticFullscreen ? document.documentElement : null });
  Element.prototype.requestFullscreen = async () => { syntheticFullscreen = true; document.dispatchEvent(new Event("fullscreenchange")); };
  document.exitFullscreen = async () => { syntheticFullscreen = false; document.dispatchEvent(new Event("fullscreenchange")); };

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, ms, ...rest) => nativeSetTimeout(callback, ms > 250 ? 500 : ms, ...rest);
})();
`;

const automationScript = `(async (iterations, recipeVersion) => {
  const stress = window.__affectLiveStress;
  const checks = [];
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label, attempts = 260) => {
    let latest = null;
    for (let i = 0; i < attempts; i += 1) {
      latest = await predicate();
      if (latest) return latest;
      await tick();
    }
    throw Error("Timeout: " + label + (latest ? " " + JSON.stringify(latest) : ""));
  };
  const q = id => document.querySelector("#" + id);
  const visible = element => !!element && !element.hidden && element.offsetParent !== null;
  const text = element => (element?.textContent ?? element?.value ?? "").trim();
  const pressFill = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  const press = key => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const parseCsv = (csv) => {
    const rows = [];
    let row = [], cell = "", quote = false;
    for (let i = 0; i < csv.length; i += 1) {
      const char = csv[i];
      if (quote) {
        if (char === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
        else if (char === '"') quote = false;
        else cell += char;
      } else if (char === '"') quote = true;
      else if (char === ",") { row.push(cell); cell = ""; }
      else if (char === "\\n") { row.push(cell.endsWith("\\r") ? cell.slice(0, -1) : cell); rows.push(row); row = []; cell = ""; }
      else cell += char;
    }
    const headers = rows.shift() ?? [];
    return rows.filter(item => item.length === headers.length && item.some(Boolean)).map(item => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
  };
  const parsePayload = row => JSON.parse(row.payload_json);
  const clickSurveyNavigation = () => {
    const host = q("runner-questionnaire-items");
    if (!host) return false;
    const checkboxes = [...host.querySelectorAll('input[type="checkbox"]')].filter(input => !input.disabled && visible(input));
    if (checkboxes.length > 1) {
      const checked = checkboxes.filter(input => input.checked);
      for (const input of checkboxes) {
        if (checked.length >= 2) break;
        if (!input.checked) { input.click(); checked.push(input); }
      }
    }
    const button = [...host.querySelectorAll('button,input[type="button"],input[type="submit"]')]
      .find(item => visible(item) && !item.disabled && /^(Next|Weiter|Complete|Fertig|Submit|Absenden)$/iu.test(text(item)));
    if (button) { button.click(); return true; }
    const fallback = q("runner-questionnaire-submit");
    if (visible(fallback) && !fallback.disabled) { fallback.click(); return true; }
    return false;
  };
  await until(() => q("runner-folder") && q("runner-open"), "Runner controls");
  q("runner-folder").click();
  await until(() => q("runner-workspace-status").textContent.includes("live-pages-synthetic-project"), "workspace selection");
  q("runner-open").click();
  await until(() => q("runner-recipe-status").textContent.includes("master v" + recipeVersion), "recipe loaded");
  check(q("runner-capability").textContent.includes("CSV download replaces LSL/XDF"), "browser capability states CSV replaces LSL/XDF");
  check(q("runner-record-start").disabled && q("runner-discover").disabled && q("runner-record-own").disabled, "browser disables native LSL/XDF recording controls");

  const chooseVariant = async (variantId) => {
    const select = q("runner-variant");
    select.value = variantId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    check(select.value === variantId, "variant selected " + variantId);
  };
  const startRun = async ({ language, variantId }) => {
    await chooseVariant(variantId);
    if (!q("runner-participant").value) {
      q("runner-participant").value = "P01";
      q("runner-participant").dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
    }
    check(!q("runner-launch").disabled, "launch enabled after recipe, participant and variant selection");
    q("runner-launch").click();
    await until(() => !q("runner-preparation").hidden && visible(q("runner-language")), "participant preparation");
    for (const optionId of ["both", language]) {
      const button = await until(() => q("runner-language").querySelector('[data-language-option="' + optionId + '"]:not([disabled])'), "language option " + optionId);
      button.click();
      await tick();
    }
    await until(() => q("runner-session").textContent.includes("browser step") || !q("runner-questionnaire").hidden || !q("runner-stage").hidden, "browser run started");
  };
  const driveUntilDownload = async (startDownloadCount, { partial = false } = {}) => {
    let questionnairePages = 0, videoInputs = 0, sawVideo = false, sawQuestionnaire = false;
    for (let i = 0; i < 950; i += 1) {
      if (!q("runner-error").hidden) throw Error(q("runner-error").textContent);
      if (stress.downloads.length > startDownloadCount && stress.downloads.at(-1).text !== null) break;
      if (!q("runner-questionnaire").hidden) {
        sawQuestionnaire = true;
        pressFill();
        await tick(20);
        if (clickSurveyNavigation()) questionnairePages += 1;
        await tick(25);
      } else if (!q("runner-stage").hidden) {
        const stage = document.querySelector(".run-feedback-stage");
        if (stage && !stage.hidden) {
          sawVideo ||= text(q("runner-timing")).includes("video");
          press("ArrowRight");
          press("ArrowUp");
          const bounds = stage.getBoundingClientRect();
          const pointer = { bubbles: true, clientX: bounds.left + bounds.width * 0.82, clientY: bounds.top + bounds.height * 0.18, pointerId: 1, pointerType: "mouse" };
          stage.dispatchEvent(new PointerEvent("pointerdown", pointer));
          stage.dispatchEvent(new PointerEvent("pointermove", pointer));
          videoInputs += 1;
        }
        if (partial && sawVideo && videoInputs > 3) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", altKey: true, bubbles: true, cancelable: true }));
        }
        await tick(30);
      } else {
        await tick(30);
      }
    }
    check(stress.downloads.length > startDownloadCount, partial ? "partial browser CSV downloaded" : "complete browser CSV downloaded");
    const download = stress.downloads.at(-1);
    await until(() => download.text !== null, "CSV blob text");
    const rows = parseCsv(download.text);
    const eventRows = rows.filter(row => row.row_type === "event");
    const events = eventRows.map(row => row.event_type);
    const samples = rows.filter(row => row.row_type === "sample");
    const questionnaires = rows.filter(row => row.row_type === "questionnaire");
    const startup = parsePayload(eventRows.find(row => row.event_type === "runStarted"));
    const outcome = parsePayload(eventRows.find(row => row.event_type === (partial ? "runPartial" : "runComplete")));
    check(download.fileName.endsWith(partial ? "_partial.csv" : "_complete.csv"), "CSV filename declares terminal status");
    check(rows.length >= 10, "CSV has substantial run rows");
    check(events.includes("runStarted"), "CSV includes runStarted event");
    check(events.includes(partial ? "runPartial" : "runComplete"), "CSV includes terminal event");
    check(events.some(event => event === "videoStarted"), "CSV includes videoStarted event");
    check(samples.length > 0, "CSV includes affect samples");
    check(questionnaires.length > 0, "CSV includes questionnaire answers");
    check(questionnaires.some(row => /demographics/u.test(row.questionnaire_id)), "CSV includes demographics questionnaire rows");
    check(samples.every(row => ["current_valence", "current_arousal", "target_valence", "target_arousal", "radius", "angle_degrees", "animation_active", "input_active"].every(column => column in row)), "CSV samples include LSL-equivalent columns");
    check(startup.schema === "affect-runner-browser-startup" && startup.version === 1, "startup payload schema");
    check(startup.platform === "browser-csv" && startup.lslUnavailable === true, "startup declares browser CSV replacement");
    check(startup.planVersion === Number(recipeVersion), "startup records recipe version");
    check(recipeVersion === "5" ? startup.questionnaireAssetCount === 4 : startup.questionnaireAssetCount === 0, "startup records questionnaire asset count");
    check(outcome.schema === "affect-runner-browser-outcome" && outcome.version === 1, "outcome payload schema");
    check(outcome.protocolOutcome === (partial ? "partial" : "completed"), "outcome protocol status");
    check(outcome.recordingFinalization === "browser-csv-downloaded" && outcome.lslUnavailable === true, "outcome records browser finalization");
    stress.routeEvents.push({
      fileName: download.fileName,
      rows: rows.length,
      events: [...new Set(events)],
      samples: samples.length,
      nonNeutralSamples: samples.filter(row => Math.abs(Number(row.valence)) > 0 || Math.abs(Number(row.arousal)) > 0).length,
      questionnaires: questionnaires.length,
      startupSchema: startup.schema,
      outcomeSchema: outcome.schema,
      planVersion: startup.planVersion,
      questionnaireAssetCount: startup.questionnaireAssetCount,
      sawQuestionnaire,
      sawVideo,
      questionnairePages,
      videoInputs,
    });
  };

  const cases = [
    { language: "en", variantId: "variant-1", partial: false },
    { language: "de", variantId: "variant-1", partial: false },
    { language: "en", variantId: "variant-2", partial: false },
    { language: "en", variantId: "variant-3", partial: true },
  ];
  for (let index = 0; index < iterations; index += 1) {
    const current = cases[index % cases.length];
    const before = stress.downloads.length;
    await startRun(current);
    await driveUntilDownload(before, current);
  }
  check(stress.mediaUrls.length >= iterations, "browser adapter resolved media object URLs");
  check(stress.routeEvents.some(event => event.events.includes("runComplete")), "stress includes complete runs");
  check(stress.routeEvents.some(event => event.events.includes("runPartial")) || iterations < 4, "stress includes partial run when requested");
  const buildInfo = await fetch(new URL("../build-info.json?cacheBust=" + crypto.randomUUID(), location.href)).then(response => response.json());
  return {
    scope: "Live GitHub Pages Runner CSV stress with mocked File System Access handles; no desktop LSL/XDF evidence",
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    buildInfo,
    recipeVersion,
    iterations,
    checks,
    errors: stress.errors,
    mediaUrls: stress.mediaUrls,
    routeEvents: stress.routeEvents,
    downloads: stress.downloads.map(download => ({ fileName: download.fileName, bytes: download.text?.length ?? 0, text: download.text ?? "" })),
    finalText: document.querySelector("#experiment-runner")?.textContent?.slice(0, 2000) ?? "",
  };
})`;

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else done(message.result);
      }
    });
  }

  call(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall }));
  }

  close() {
    this.socket.close();
  }
}

async function connectCdp(port) {
  let version = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
      break;
    } catch {
      await delay(125);
    }
  }
  assert.ok(version?.webSocketDebuggerUrl, "Chrome DevTools endpoint became available");
  const browserSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    browserSocket.addEventListener("open", resolveOpen, { once: true });
    browserSocket.addEventListener("error", rejectOpen, { once: true });
  });
  const browserClient = new CdpClient(browserSocket);
  const { targetId } = await browserClient.call("Target.createTarget", { url: "about:blank" });
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
    .then(targets => targets.find(target => target.id === targetId));
  const pageSocket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    pageSocket.addEventListener("open", resolveOpen, { once: true });
    pageSocket.addEventListener("error", rejectOpen, { once: true });
  });
  return { browserClient, pageClient: new CdpClient(pageSocket) };
}

const profile = await mkdtemp(join(output, "profile-"));
const port = await freePort();
const browserProcess = spawn(browser, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--window-size=1938,1176",
  "--force-device-scale-factor=1",
  "about:blank",
], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

let clients = null;
try {
  clients = await connectCdp(port);
  const { pageClient } = clients;
  await pageClient.call("Page.enable");
  await pageClient.call("Runtime.enable");
  await pageClient.call("Page.addScriptToEvaluateOnNewDocument", { source: preloadScript });
  await pageClient.call("Page.navigate", { url: `${pageUrl}${pageUrl.includes("?") ? "&" : "?"}cacheBust=${Date.now()}-${Math.random().toString(16).slice(2)}` });
  await delay(1500);
  const inputPulse = setInterval(() => {
    pageClient.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 }).catch(() => {});
    pageClient.call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 }).catch(() => {});
  }, 50);
  let evaluation;
  try {
    evaluation = await pageClient.call("Runtime.evaluate", {
      expression: `${automationScript}(${iterations}, ${JSON.stringify(recipeVersion)})`,
      awaitPromise: true,
      returnByValue: true,
      timeout: 120000,
    });
  } finally {
    clearInterval(inputPulse);
  }
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.text ?? "Live Pages stress evaluation failed");
  }
  const receipt = evaluation.result.value;
  assert.ok(receipt, "Live Pages stress returned a receipt");
  const reconstructions = [];
  for (const [index, download] of receipt.downloads.entries()) {
    reconstructions.push(await reconstructBrowserCsv(download, index));
  }
  const compactReceipt = {
    ...receipt,
    downloads: receipt.downloads.map(({ text, ...download }) => download),
  };
  await writeFile(join(output, "receipt.json"), JSON.stringify({
    browser,
    fixturePath,
    receipt: compactReceipt,
    reconstructions,
  }, null, 2));
  await writeFile(join(output, "live-pages-runner.html"), receipt.finalText);
  console.log(JSON.stringify({
    browser,
    pageUrl: receipt.pageUrl,
    revision: receipt.buildInfo?.revision,
    checks: receipt.checks.length,
    errors: receipt.errors,
    iterations: receipt.iterations,
    downloads: compactReceipt.downloads,
    reconstructions,
    routeEvents: receipt.routeEvents.map(event => ({
      fileName: event.fileName,
      rows: event.rows,
      samples: event.samples,
      questionnaires: event.questionnaires,
      startupSchema: event.startupSchema,
      outcomeSchema: event.outcomeSchema,
      planVersion: event.planVersion,
      questionnaireAssetCount: event.questionnaireAssetCount,
      events: event.events,
    })),
  }));
  assert.deepEqual(receipt.errors, []);
} finally {
  try { clients?.pageClient?.close(); } catch {}
  try { clients?.browserClient?.close(); } catch {}
  if (!browserProcess.killed) browserProcess.kill();
  await Promise.race([
    new Promise(resolveExit => browserProcess.once("exit", resolveExit)),
    delay(3000),
  ]);
  await rm(profile, { recursive: true, force: true });
}

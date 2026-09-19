// Browser Runner CSV stress qualification with mocked Chrome/Edge file handles.
// This exercises the public browser adapter path. It is not desktop LSL/XDF evidence.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination, iterationsArg = "4", recipeVersion = "5"] = process.argv.slice(2);
assert.ok(browser && destination, "Usage: node scripts/qualification/browser-runner-csv-stress.mjs <browser> <output-dir> [iterations] [4|5]");
assert.ok(["4", "5"].includes(recipeVersion), "Browser CSV stress supports fixture recipe versions 4 and 5.");
const iterations = Number.parseInt(iterationsArg, 10);
assert.ok(Number.isSafeInteger(iterations) && iterations >= 1 && iterations <= 12, "iterations must be 1..12");

const repoRoot = resolve(import.meta.dirname, "../..");
const output = resolve(destination);
await mkdir(output, { recursive: true });

const entry = String.raw`
const checks = [], errors = [], downloads = [], mediaUrls = [], routeEvents = [], trace = [];
const mark = label => { trace.push({ label, at: performance.now(), text: document.body?.textContent?.slice(0, 240) ?? '' }); };
window.__browserCsvStressTrace = trace;
const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label, attempts = 240) => {
  let latest = null;
  for (let i = 0; i < attempts; i += 1) {
    latest = await predicate();
    if (latest) return latest;
    await tick();
  }
  throw Error('Timeout: ' + label + (latest ? ' ' + JSON.stringify(latest) : ''));
};
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));

const recipeVersion = new URL(location.href).searchParams.get('version') ?? '5';
const iterations = Number(new URL(location.href).searchParams.get('iterations') ?? '4');
document.body.innerHTML = '<div id="experiment-runner" aria-busy="true"></div>';

function syntheticBytes(byte, size) {
  const bytes = new Uint8Array(size);
  bytes.fill(byte);
  return bytes;
}
const mediaFiles = new Map([
  ['assets/stimuli/session_a/clip.mp4', new File([syntheticBytes(0xdd, 1024)], 'clip.mp4', { type: 'video/mp4' })],
  ['assets/stimuli/session-a/clip.mp4', new File([syntheticBytes(0xdd, 1024)], 'clip.mp4', { type: 'video/mp4' })],
  ['assets/stimuli/session2/portrait.mp4', new File([syntheticBytes(0xbb, 2048)], 'portrait.mp4', { type: 'video/mp4' })],
]);
function fileHandle(file) {
  return Object.freeze({ kind: 'file', name: file.name, async getFile() { return file; } });
}
function directoryHandle(name, prefix = '') {
  return Object.freeze({
    kind: 'directory',
    name,
    async getDirectoryHandle(part) {
      const next = prefix ? prefix + '/' + part : part;
      if (![...mediaFiles.keys()].some(path => path.startsWith(next + '/'))) throw Error('Missing directory ' + next);
      return directoryHandle(part, next);
    },
    async getFileHandle(part) {
      const path = prefix ? prefix + '/' + part : part;
      const file = mediaFiles.get(path);
      if (!file) throw Error('Missing file ' + path);
      return fileHandle(file);
    },
  });
}

const objectUrlBlobs = new Map();
const originalCreateObjectURL = URL.createObjectURL.bind(URL);
const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const id = 'blob:stress-' + objectUrlBlobs.size;
  objectUrlBlobs.set(id, blob);
  if (!String(blob?.type ?? '').startsWith('text/csv')) mediaUrls.push({ id, type: blob?.type ?? '', size: blob?.size ?? 0 });
  return id;
};
URL.revokeObjectURL = (id) => objectUrlBlobs.delete(id) || originalRevokeObjectURL(id);
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function click() {
  const blob = objectUrlBlobs.get(this.href);
  if (blob && String(this.download ?? '').endsWith('.csv')) {
    const download = { fileName: this.download, href: this.href, text: null };
    downloads.push(download);
    blob.text().then(text => { download.text = text; });
    return;
  }
  return originalAnchorClick.call(this);
};

// The stimulus fixtures are synthetic byte patterns, not decodable video, and
// this harness qualifies the adapter, journal and CSV path rather than decoding.
// The source and the playback clock are therefore held on the element instead of
// being handed to the real media pipeline, which would otherwise raise a genuine
// decode error for every clip. Real decoding is covered separately by
// html-video-real-playback.mjs.
Object.defineProperty(HTMLMediaElement.prototype, 'src', {
  configurable: true,
  get() { return this.__syntheticSrc ?? ''; },
  set(value) { this.__syntheticSrc = String(value); },
});
Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  get() { return this.__syntheticTime ?? 0; },
  set(value) { this.__syntheticTime = Number(value) || 0; },
});
Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
  configurable: true,
  get() { return this.__syntheticEnded === true; },
});
const originalRemoveAttribute = HTMLMediaElement.prototype.removeAttribute;
HTMLMediaElement.prototype.removeAttribute = function removeAttribute(name) {
  if (name === 'src') { this.__syntheticSrc = ''; return; }
  return originalRemoveAttribute.call(this, name);
};
Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
  configurable: true,
  get() { return this.dataset.syntheticReady === 'true' ? 2 : 0; },
});
HTMLMediaElement.prototype.load = function load() {
  this.dataset.syntheticReady = this.src ? 'true' : 'false';
  this.__syntheticEnded = false;
  if (this.src) {
    setTimeout(() => {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('canplay'));
    }, 0);
  }
};
// The synthetic element follows the real media lifecycle: play() resolves, then
// a 'playing' event announces observed playback, and 'ended' fires once the
// clip finishes. The Runner records its start and end from those events, so a
// mock that only resolved play() would not exercise the real path.
const SYNTHETIC_CLIP_SECONDS = 0.6;
HTMLMediaElement.prototype.play = function play() {
  this.dataset.syntheticPlaying = 'true';
  this.__stressClock ??= setInterval(() => {
    try {
      this.currentTime = Number(this.currentTime || 0) + 0.033;
      if (this.currentTime >= SYNTHETIC_CLIP_SECONDS) {
        clearInterval(this.__stressClock);
        this.__stressClock = null;
        this.dataset.syntheticPlaying = 'false';
        this.__syntheticEnded = true;
        this.dispatchEvent(new Event('ended'));
      }
    } catch {}
  }, 16);
  // A microtask, not a timer: the harness compresses long timeouts, and the
  // player's start watchdog must not race the observed 'playing' transition.
  queueMicrotask(() => this.dispatchEvent(new Event('playing')));
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function pause() {
  const wasPlaying = this.dataset.syntheticPlaying === 'true';
  this.dataset.syntheticPlaying = 'false';
  if (this.__stressClock) clearInterval(this.__stressClock);
  this.__stressClock = null;
  if (wasPlaying) this.dispatchEvent(new Event('pause'));
};

const fixturePath = recipeVersion === '5'
  ? '/test/fixtures/planner-recipe-v5.bundle.json'
  : '/test/fixtures/planner-recipe-v4-surveyjs.canonical.json';
const fixtureText = await (await fetch(fixturePath)).text();
window.showOpenFilePicker = async () => [Object.freeze({
  kind: 'file',
  name: recipeVersion === '5' ? 'planner-recipe-v5.bundle.json' : 'planner-recipe-v4-surveyjs.canonical.json',
  async getFile() { return new File([fixtureText], 'experiment.package.json', { type: 'application/json' }); },
})];
window.showDirectoryPicker = async () => directoryHandle('synthetic-project');
let syntheticFullscreen = false;
Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => syntheticFullscreen ? document.documentElement : null });
document.documentElement.requestFullscreen = async () => { syntheticFullscreen = true; document.dispatchEvent(new Event('fullscreenchange')); };
document.exitFullscreen = async () => { syntheticFullscreen = false; document.dispatchEvent(new Event('fullscreenchange')); };

const fastWindow = new Proxy(window, {
  get(target, key) {
    if (key === 'requestAnimationFrame') return callback => setTimeout(() => callback(performance.now()), 8);
    if (key === 'setTimeout') return (callback, ms, ...rest) => setTimeout(callback, ms > 250 ? 70 : ms, ...rest);
    if (key === 'URL') return target.URL;
    if (key === 'Blob') return target.Blob;
    if (key === 'File') return target.File;
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

const [{ bootRunner }, { createBrowserRunnerInvoke }] = await Promise.all([
  import('./experiment-runner/src/app.js'),
  import('./experiment-runner/src/browser-adapter.js'),
]);

const root = document.querySelector('#experiment-runner');
mark('before bootRunner');
const app = await bootRunner(root, {
  invoke: createBrowserRunnerInvoke({ windowObject: fastWindow }),
  windowObject: fastWindow,
  pollMs: 10_000,
});
mark('after bootRunner');
const q = id => root.querySelector('#' + id);
const visible = element => !!element && !element.hidden && element.offsetParent !== null;
const pressFill = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
// A real keyboard delivers the physical code as well as the key, and releases
// it. The authored input binding matches on the code, so both are required.
const press = (key, code = key) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
};
const text = element => (element?.textContent ?? element?.value ?? '').trim();

function parseCsv(csv) {
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quote) {
      if (char === '"' && csv[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quote = false;
      else cell += char;
    } else if (char === '"') quote = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; if (csv[i - 1] === '\r') rows.at(-1)[rows.at(-1).length - 1] = rows.at(-1).at(-1).slice(0, -1); }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows.filter(item => item.length === headers.length && item.some(Boolean)).map(item => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
}
// A participant answers by interacting with the page. The synthetic auto-fill
// shortcut is refused during acquisition, so the harness must do the same.
function answerVisibleQuestions() {
  const host = q('runner-questionnaire-items');
  if (!host) return;
  const group = element => element.closest('[data-name]') ?? element.closest('fieldset') ?? host;
  for (const radio of host.querySelectorAll('input[type="radio"]')) {
    if (radio.disabled || !visible(radio)) continue;
    if (group(radio).querySelector('input[type="radio"]:checked')) continue;
    radio.click();
  }
  // A lone checkbox is a boolean/switch question; a group of them is a
  // multi-select. Either way an unanswered question gets one real click.
  for (const box of host.querySelectorAll('input[type="checkbox"]')) {
    if (box.disabled || !visible(box)) continue;
    if (group(box).querySelector('input[type="checkbox"]:checked')) continue;
    box.click();
  }
  for (const field of host.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea')) {
    if (field.disabled || field.readOnly || !visible(field) || field.value) continue;
    field.focus();
    field.value = field.type === 'number' ? '30' : 'Synthetic participant entry';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.blur();
  }
  for (const select of host.querySelectorAll('select')) {
    if (select.disabled || !visible(select) || select.value) continue;
    const option = [...select.options].find(item => item.value);
    if (!option) continue;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
function clickSurveyNavigation() {
  const host = q('runner-questionnaire-items');
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
  const fallback = q('runner-questionnaire-submit');
  if (visible(fallback) && !fallback.disabled) { fallback.click(); return true; }
  return false;
}
async function prepareRecipe() {
  mark('prepareRecipe before folder click');
  q('runner-folder').click();
  mark('prepareRecipe after folder click');
  await until(() => q('runner-workspace-status').textContent.includes('synthetic-project'), 'workspace selection');
  mark('prepareRecipe workspace selected');
  q('runner-open').click();
  mark('prepareRecipe after open click');
  await until(() => app.recipe && q('runner-recipe-status').textContent.includes('master v' + recipeVersion), 'recipe loaded');
  mark('prepareRecipe recipe loaded');
  check(/no LSL, XDF, native input or native timing/u.test(q('runner-capability').textContent), 'browser capability claims no native authority');
  check(q('runner-record-start').disabled && q('runner-discover').disabled && q('runner-record-own').disabled, 'browser disables native LSL/XDF recording controls');
  // The synthetic auto-fill shortcut must be refused while a run is acquiring.
  check(typeof pressFill === 'function', 'auto-fill shortcut is reachable outside a run');
}
async function chooseVariant(variantId) {
  const select = q('runner-variant');
  select.value = variantId;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  check(select.value === variantId, 'variant selected ' + variantId);
}
async function startRun({ language, variantId }) {
  await chooseVariant(variantId);
  q('runner-launch').click();
  await until(() => !q('runner-preparation').hidden && visible(q('runner-language')), 'participant preparation');
  for (const optionId of ['both', language]) {
    const button = await until(() => q('runner-language').querySelector('[data-language-option="' + optionId + '"]:not([disabled])'), 'language option ' + optionId);
    button.click();
    await tick();
  }
  await until(() => q('runner-session').textContent.includes('browser step') || !q('runner-questionnaire').hidden || !q('runner-stage').hidden, 'browser run started');
}
async function driveUntilDownload(startDownloadCount, { partial = false } = {}) {
  let questionnairePages = 0, videoInputs = 0, sawVideo = false, sawQuestionnaire = false;
  for (let i = 0; i < 900; i += 1) {
    if (!q('runner-error').hidden) throw Error(q('runner-error').textContent);
    if (downloads.length > startDownloadCount && downloads.at(-1).text !== null) break;
    if (!q('runner-questionnaire').hidden) {
      sawQuestionnaire = true;
      answerVisibleQuestions();
      await tick(20);
      if (clickSurveyNavigation()) questionnairePages += 1;
      await tick(25);
    } else if (!q('runner-stage').hidden) {
      const stage = root.querySelector('.run-feedback-stage');
      if (stage && !stage.hidden) {
        sawVideo ||= text(q('runner-timing')).includes('video');
        press('ArrowRight');
        press('ArrowUp');
        const bounds = stage.getBoundingClientRect();
        stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.left + bounds.width * 0.82, clientY: bounds.top + bounds.height * 0.18 }));
        videoInputs += 1;
      }
      if (partial && sawVideo && videoInputs > 12) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', altKey: true, bubbles: true, cancelable: true }));
      }
      await tick(30);
    } else {
      await tick(30);
    }
  }
  check(downloads.length > startDownloadCount, partial ? 'partial browser CSV downloaded' : 'complete browser CSV downloaded');
  const download = downloads.at(-1);
  await until(() => download.text !== null, 'CSV blob text');
  const rows = parseCsv(download.text);
  const events = rows.filter(row => row.row_type === 'event').map(row => row.event_type);
  const samples = rows.filter(row => row.row_type === 'sample');
  const questionnaires = rows.filter(row => row.row_type === 'questionnaire');
  // Record what the run actually produced before asserting, so a failure is
  // diagnosable from the receipt instead of only naming the first broken check.
  routeEvents.push({
    fileName: download.fileName,
    rows: rows.length,
    events: [...new Set(events)],
    eventSequence: rows.filter(row => row.row_type === 'event').map(row => row.event_type),
    samples: samples.length,
    questionnaires: questionnaires.length,
    sawQuestionnaire,
    sawVideo,
    questionnairePages,
    videoInputs,
    lastError: text(q('runner-error')),
    receipt: text(q('runner-receipt')).slice(0, 400),
  });
  check(download.fileName.endsWith(partial ? '_partial.csv' : '_complete.csv'), 'CSV filename declares terminal status');
  check(rows.length >= 10, 'CSV has substantial run rows');
  check(events.includes('runStarted'), 'CSV includes runStarted event');
  check(events.includes(partial ? 'runPartial' : 'runComplete'), 'CSV includes terminal event');
  check(events.some(event => event === 'videoStarted'), 'CSV includes videoStarted event');
  check(samples.length > 0, 'CSV includes affect samples');
  check(questionnaires.length > 0, 'CSV includes questionnaire answers');

  // Observed playback: one start and one end per completed occurrence, each
  // occurrence distinct, and no sample before its occurrence started.
  const videoRows = rows.filter(row => row.row_type === 'event' && /^video(Started|Ended|Failed)$/u.test(row.event_type));
  const occurrenceOf = row => { try { return JSON.parse(row.payload_json).occurrenceId; } catch { return null; } };
  const starts = videoRows.filter(row => row.event_type === 'videoStarted');
  const ends = videoRows.filter(row => row.event_type === 'videoEnded');
  check(starts.every(row => occurrenceOf(row)), 'every videoStarted carries an occurrence identity');
  check(new Set(starts.map(occurrenceOf)).size === starts.length, 'each playback occurrence starts exactly once');
  check(new Set(ends.map(occurrenceOf)).size === ends.length, 'each playback occurrence ends at most once');
  check(ends.every(row => starts.some(start => occurrenceOf(start) === occurrenceOf(row))), 'no video end without an observed start');
  if (!partial) check(ends.length === starts.length, 'every started video reported its actual end');
  check(!events.includes('videoFailed'), 'no video reported a failure in this run');
  for (const start of starts) {
    const occurrence = occurrenceOf(start);
    const first = samples.find(row => occurrenceOf(row) === occurrence);
    if (first) check(Number(first.sequence) > Number(start.sequence), 'sampling for ' + occurrence + ' begins after its observed start');
  }

  // The authored sampling rate is recorded and never silently replaced.
  const runStarted = rows.find(row => row.event_type === 'runStarted');
  const authoredHz = JSON.parse(runStarted.payload_json).samplingFrequencyHz;
  check(Number.isInteger(authoredHz) && authoredHz >= 1, 'run records its authored sampling frequency');
  check(samples.every(row => JSON.parse(row.payload_json).nominalHz === authoredHz), 'every sample records the authored nominal rate');
  check(samples.every(row => Number.isFinite(Number(row.elapsed_ms))), 'every sample carries an actual timestamp');

  // One response record per submission; answer rows reference it.
  const responses = rows.filter(row => row.row_type === 'questionnaire-response');
  check(responses.length > 0, 'CSV includes questionnaire response records');
  check(questionnaires.every(row => Number.isInteger(JSON.parse(row.payload_json).responseSequence)),
    'answer rows reference one response record instead of repeating it');
  check(questionnaires.some(row => /demographics/u.test(row.questionnaire_id)), 'CSV includes demographics questionnaire rows');
  check(samples.some(row => Math.abs(Number(row.valence)) > 0 || Math.abs(Number(row.arousal)) > 0), 'CSV includes non-neutral affect samples from browser input');
  check(rows.every(row => row.recipe_sha256 && row.plan_sha256 && row.participant_id && row.variant_id && row.language_id), 'CSV rows carry run identities');
  check(rows.some(row => row.relative_path), 'CSV carries media relative paths');
}

try {
  await prepareRecipe();
  const cases = [
    { language: 'en', variantId: 'variant-1', partial: false },
    { language: 'de', variantId: 'variant-1', partial: false },
    { language: 'en', variantId: 'variant-2', partial: false },
    { language: 'en', variantId: 'variant-3', partial: true },
  ];
  for (let index = 0; index < iterations; index += 1) {
    const current = cases[index % cases.length];
    const before = downloads.length;
    await startRun(current);
    await driveUntilDownload(before, current);
  }
  check(mediaUrls.length >= iterations, 'browser adapter resolved media object URLs');
  check(routeEvents.some(event => event.events.includes('runComplete')), 'stress includes complete runs');
  check(routeEvents.some(event => event.events.includes('runPartial')) || iterations < 4, 'stress includes partial run when requested by case set');
  app.destroy();
} catch (error) {
  errors.push(String(error?.stack ?? error));
}
const result = document.createElement('pre');
result.id = 'receipt';
result.hidden = true;
result.textContent = JSON.stringify({
  scope: 'Browser Runner CSV stress with mocked File System Access handles; no desktop LSL/XDF evidence',
  recipeVersion,
  iterations,
  checks,
  errors,
  downloads: downloads.map(download => ({ fileName: download.fileName, bytes: download.text?.length ?? 0 })),
  mediaUrls,
  routeEvents,
  trace,
  finalText: root.textContent.slice(0, 2000),
});
document.body.append(result);
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: repoRoot, sourcefile: "browser-runner-csv-stress.js" },
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
  logLevel: "silent",
  plugins: [{
    name: "synthetic-media-sha256",
    setup(builder) {
      builder.onLoad({ filter: /[\\/]experiment-planner[\\/]web[\\/]src[\\/]research[\\/]canonical\.js$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        const needle = "export async function sha256Hex(value) {\n  const subtle = globalThis.crypto?.subtle;";
        assert.ok(source.includes(needle), "canonical sha256 helper changed shape");
        return {
          contents: source.replace(needle, `export async function sha256Hex(value) {
  if (value instanceof Uint8Array && value.length === 1024 && value.every(byte => byte === 0xdd)) return "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  if (value instanceof Uint8Array && value.length === 2048 && value.every(byte => byte === 0xbb)) return "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const subtle = globalThis.crypto?.subtle;`),
          loader: "js",
          resolveDir: resolve(path, ".."),
        };
      });
    },
  }],
});

const mime = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/runner/runner.css"><script type="module" src="/runner/src/browser-runner-csv-stress.js"></script>');
      return;
    }
    if (url.pathname === "/runner/src/browser-runner-csv-stress.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    const filePath = resolve(repoRoot, "." + decodeURIComponent(url.pathname));
    assert.ok(filePath.startsWith(repoRoot + sep));
    res.setHeader("Content-Type", mime[extname(filePath)] ?? "application/octet-stream");
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const execute = promisify(execFile);
async function connectDebugger(profile) {
  let port;
  for (let i = 0; i < 100; i += 1) {
    try {
      port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await new Promise(done => setTimeout(done, 50));
    }
  }
  assert.ok(port, "Headless debugger started");
  let target;
  for (let i = 0; i < 100; i += 1) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find(item => item.type === "page" && item.url.includes("127.0.0.1"));
    if (target) break;
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(target, "Owned CSV stress page is available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onclose = () => {
    for (const waiter of pending.values()) waiter.reject(new Error("Owned debugger closed"));
    pending.clear();
  };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  };
  const send = (method, params = {}) => new Promise((done, reject) => {
    const current = ++id;
    const timer = setTimeout(() => { pending.delete(current); reject(new Error(`Debugger deadline: ${method}`)); }, 5000);
    pending.set(current, { done(value) { clearTimeout(timer); done(value); }, reject(error) { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  return { send, close: () => socket.close() };
}
try {
  const profile = await mkdtemp(join(output, "profile-"));
  const running = execute(browser, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--window-size=1938,1176",
    "--force-device-scale-factor=1",
    `http://127.0.0.1:${server.address().port}/?iterations=${iterations}&version=${recipeVersion}`,
  ], { windowsHide: true, timeout: 150000, maxBuffer: 8_000_000 });
  running.catch(() => {});
  const debug = await connectDebugger(profile);
  let stdout;
  try {
    await debug.send("Page.enable");
    let finished = false;
    for (let i = 0; i < 1200; i += 1) {
      const state = await debug.send("Runtime.evaluate", { expression: "!!document.getElementById('receipt')" });
      if (state.result.value) { finished = true; break; }
      await new Promise(done => setTimeout(done, 100));
    }
    if (!finished) {
      const timeoutHtml = (await debug.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML" })).result.value;
      await writeFile(join(output, "browser-runner-csv-stress-timeout.html"), timeoutHtml);
      const timeoutTrace = (await debug.send("Runtime.evaluate", { expression: "JSON.stringify(window.__browserCsvStressTrace ?? [])" })).result.value;
      await writeFile(join(output, "browser-runner-csv-stress-timeout-trace.json"), timeoutTrace);
      const timeoutPicture = await debug.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(output, "browser-runner-csv-stress-timeout.png"), Buffer.from(timeoutPicture.data, "base64"));
    }
    assert.ok(finished, "Browser Runner CSV stress finished");
    stdout = (await debug.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML" })).result.value;
    const picture = await debug.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, "browser-runner-csv-stress.png"), Buffer.from(picture.data, "base64"));
    await debug.send("Browser.close", {}).catch(() => {});
    running.child.kill();
    await running.catch(error => { if (!error.killed) throw error; });
  } finally {
    debug.close();
    running.child.kill();
  }
  await writeFile(join(output, "browser-runner-csv-stress.html"), stdout);
  const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw, "Missing browser Runner CSV stress receipt");
  const receipt = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
  await writeFile(join(output, "receipt.json"), JSON.stringify({ repoRoot, receipt }, null, 2));
  console.log(JSON.stringify({
    checks: receipt.checks.length,
    errors: receipt.errors,
    iterations: receipt.iterations,
    downloads: receipt.downloads,
    routeEvents: receipt.routeEvents.map(event => ({
      fileName: event.fileName,
      rows: event.rows,
      samples: event.samples,
      questionnaires: event.questionnaires,
      events: event.events,
    })),
  }));
  assert.deepEqual(receipt.errors, []);
} finally {
  server.close();
}

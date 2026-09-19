// Hidden Runner validation traversal hotkeys with synthetic native replies.
// This is frontend qualification only: no native acquisition, playback timing, LSL or XDF evidence.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const repoRoot = resolve(import.meta.dirname, "../..");
const output = resolve(destination);
await mkdir(output);

const entry = String.raw`
import { bootRunner } from './experiment-runner/src/app.js';
import { readRunnerRecipe, resolveRunnerSelection } from './experiment-runner/src/recipe.js';

const checks = [], calls = [], errors = [];
const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
const tick = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label) => { for (let i = 0; i < 120; i++) { if (predicate()) return; await tick(); } throw Error('Timeout: ' + label); };
const press = key => window.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }));
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));

document.body.innerHTML = '<div id="experiment-runner"></div>';
const root = document.querySelector('#experiment-runner'), q = id => root.querySelector('#' + id);
let app, fixtureReceipt, fullscreen = false, syntheticPlayCount = 0, syntheticPauseCount = 0;
const syntheticTimeouts = [];
Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get() { return this.dataset.syntheticReady === 'true' ? 2 : 0; } });
HTMLMediaElement.prototype.load = function() {
  if (!this.src) { this.dataset.syntheticReady = 'false'; return; }
  this.dataset.syntheticReady = 'true';
  setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0);
};
HTMLMediaElement.prototype.play = function() {
  syntheticPlayCount += 1;
  this.dataset.syntheticPlaying = 'true';
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function() { syntheticPauseCount += 1; this.dataset.syntheticPlaying = 'false'; };
async function previousExperimentDocument() {
  if (!fixtureReceipt) {
    const canonicalSourceText = await (await fetch('/test/fixtures/planner-recipe-v4-surveyjs.canonical.json')).text();
    const parsed = await readRunnerRecipe(new TextEncoder().encode(canonicalSourceText));
    fixtureReceipt = { canonicalSourceText, canonicalSourceByteSha256: parsed.canonicalSourceByteSha256 };
  }
  return fixtureReceipt;
}
const selected = () => resolveRunnerSelection(app.recipe, app.selection?.participantId ?? 'P002', ['both', 'en'], q('runner-variant').value || 'variant-1');
const invoke = async (command, args = {}) => {
  calls.push({ command, args: structuredClone(args) });
  switch (command) {
    case 'research_desktop_identity': return { schema: 'affect-research-desktop-identity', version: 1, program: 'runner' };
    case 'research_package_protocol_capability': return { schema: 'affect-research-native-package-protocol-capability', version: 1, backend: 'html-video-package-protocol', rustOwnedProtocol: true, packageV1CompilationReady: true, protocolPlanV2Ready: true, questionnaireDraftsReady: true, recoveryJournalReady: true, manifestV4Ready: true, nativeStartReady: true, reasonCode: 'ready' };
    case 'research_native_media_capability': return { playerActorReady: true, reasonCode: 'ready' };
    case 'research_workspace_status': return { selected: true, workspaceId: 'synthetic-workspace', displayName: 'Synthetic hotkey verification' };
    case 'research_recorder_status': return { available: false, active: false, phase: 'idle' };
    case 'research_runner_recent_experiments': return args.action === 'load' ? { document: await previousExperimentDocument(), workspace: { selected: true, workspaceId: 'synthetic-workspace', displayName: 'Synthetic hotkey verification' } } : { schema: 'affect-runner-recent-experiments', version: 1, entries: [] };
    case 'research_runner_previous_experiment': return args.action === 'load' ? { document: await previousExperimentDocument(), workspace: { selected: true, workspaceId: 'synthetic-workspace', displayName: 'Synthetic hotkey verification' } } : { ok: true };
    case 'research_runner_selection': return { schema: 'affect-runner-selection', version: 1, packageSourceByteSha256: app.recipe?.canonicalSourceByteSha256 ?? fixtureReceipt?.canonicalSourceByteSha256, participantId: args.participantId ?? 'P002', outputDirectory: 'outputs/synthetic-hotkeys' };
    case 'research_runner_variant_usage': return { schema: 'affect-runner-variant-usage', version: 1, basis: 'xdf-file-names-v1', recipeSourceByteSha256: app.recipe.canonicalSourceByteSha256, ignoredXdfFiles: 0, usedParticipantIds: ['P001'], variants: app.recipe.recipe.segments.P3.variants.map((v, index) => ({ variantId: v.variantId, recordingCount: index, participantCount: index ? 1 : 0 })) };
    case 'research_runner_master_history': return { schema: 'affect-runner-master-history', version: 1, recipeSourceByteSha256: app.recipe.canonicalSourceByteSha256, participants: [] };
    case 'research_runner_master_html_video_url': {
      const plan = await selected();
      const step = plan.steps.find(item => item.position === args.request.protocolStepPosition);
      check(step?.kind === 'video', 'HTML video URL command targets a video step');
      check(args.request.workspaceId === 'synthetic-workspace', 'HTML video URL command binds workspace');
      check(args.request.participantId === plan.participantId, 'HTML video URL command binds participant');
      check(args.request.selector.variantId === plan.selector.variantId, 'HTML video URL command binds variant');
      return { mediaGrantId: 'synthetic-grant', workspaceFileId: 'wf-synthetic-video', mediaUrl: 'research-media://localhost/synthetic-video', byteLength: step.payload.asset.byteLength, mimeType: step.payload.asset.mimeType, durationMs: null, decodeStatus: 'unverified', decodeBackend: null, decodeAttestation: null, decodedPositionsMs: [] };
    }
    case 'research_input_cancel_setup': return {};
    case 'research_input_set_region': return { runReady: true };
    case 'research_runner_fullscreen': fullscreen = args.fullscreen; return;
    default: throw Error('Unexpected native command during hotkey traversal: ' + command);
  }
};
try {
  const win = new Proxy(window, { get(target, key) {
    if (key === 'requestAnimationFrame') return callback => setTimeout(() => callback(performance.now()), 16);
    if (key === 'setTimeout') return (callback, ms, ...rest) => {
      if (ms > 100) syntheticTimeouts.push(ms);
      return setTimeout(callback, ms > 2000 ? 150 : ms, ...rest);
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  app = await bootRunner(root, { invoke, windowObject: win, pollMs: 1000 });
  check(!root.textContent.includes('Alt+N') && !root.textContent.includes('Alt+B'), 'research hotkeys are not displayed');
  press('n');
  await until(() => fullscreen && app.selection && !q('runner-launcher').hidden === false, 'Alt+N enters hidden validation traversal');
  await until(() => q('runner-session').textContent.includes('validation step 1/'), 'first validation step is shown');
  check(app.selection.participantId === 'P002' && q('runner-participant').value === 'P02', 'Alt+N uses the next participant default');
  check(app.selection.selector.variantId === 'variant-3', 'Alt+N uses the selected or least-used version default');
  check(app.selection.selector.languageSelectionPath.join('/') === 'both/en', 'Alt+N uses the first complete language path');
  check(!calls.some(call => /master_start|recorder_start|master_action|preflight/u.test(call.command)), 'hotkey traversal does not start recording, preflight or native actions');
  check(q('runner-error').hidden, 'Alt+N traversal reports no participant-facing error');
  const firstSession = q('runner-session').textContent;
  for (let i = 0; i < 8 && q('runner-session').textContent === firstSession; i++) { press('n'); await tick(120); }
  check(q('runner-session').textContent !== firstSession, 'Alt+N advances beyond mandatory questionnaire pages');
  const laterSession = q('runner-session').textContent;
  for (let i = 0; i < 8 && q('runner-session').textContent !== firstSession; i++) { press('b'); await tick(120); }
  check(q('runner-session').textContent === firstSession, 'Alt+B returns to the previous validation step');
  check(laterSession.includes('validation step'), 'later traversal remains in validation preview');
  check(!calls.some(call => /master_start|recorder_start|master_action|preflight/u.test(call.command)), 'Alt+B also stays outside recorded native paths');
  const plan = app.selection;
  const intervalIndex = plan.steps.findIndex((step, index) => step.kind === 'interval' && step.durationMs > 100 && plan.steps[index + 1]?.kind === 'video' && plan.steps[index + 2]?.kind !== 'video');
  check(intervalIndex >= 0, 'fixture has an interval followed by video');
  for (let i = 0; i < 16 && !q('runner-session').textContent.includes('validation step ' + (intervalIndex + 1) + '/'); i++) { press('n'); await tick(120); }
  check(q('runner-session').textContent.includes('validation step ' + (intervalIndex + 1) + '/'), 'Alt+N reaches an authored interstimulus interval');
  check(q('runner-timing').textContent.includes('waiting'), 'validation traversal waits interstimulus interval');
  check(q('run-stimulus-placeholder').textContent === '', 'interstimulus interval has no stimulus display text');
  check(!root.querySelector('.run-feedback-stage').hidden, 'feedback stage remains visible during interstimulus interval');
  check(!q('runner-stage').hidden && !q('runner-stage').textContent.includes('ISI'), 'interstimulus stage stays black except feedback');
  check(globalThis.__runnerPreviewAuditState?.x === 0 && globalThis.__runnerPreviewAuditState?.y === 0, 'interstimulus feedback is neutral');
  check(globalThis.__runnerPreviewAuditState?.hideFeedback === false, 'interstimulus feedback is visible');
  check(globalThis.__runnerPreviewAuditState?.lockPosition === true, 'interstimulus feedback is locked');
  await until(() => q('runner-session').textContent.includes('validation step ' + (intervalIndex + 2) + '/'), 'interstimulus interval advances to the next video');
  await until(() => q('run-webview-video')?.dataset.syntheticPlaying === 'true', 'HTML video element plays after interval');
  const videoStep = plan.steps[intervalIndex + 1];
  const videoCall = calls.find(call => call.command === 'research_runner_master_html_video_url' && call.args.request.protocolStepPosition === videoStep.position);
  check(Boolean(videoCall), 'video step requests the Runner HTML media URL');
  check(!q('run-native-video-host').hidden, 'video host is visible');
  check(q('run-stimulus-placeholder').textContent === '', 'video placeholder is cleared');
  check(q('runner-timing').textContent.includes('playing'), 'validation traversal reports playing video');
  check(syntheticPlayCount > 0, 'HTML video play was invoked');
  check(syntheticTimeouts.includes(videoStep.durationMs), 'video step schedules its authored duration');
  await until(() => q('runner-session').textContent.includes('validation step ' + (intervalIndex + 3) + '/'), 'video step auto-advances after its authored duration');
  check(q('run-webview-video')?.dataset.syntheticPlaying !== 'true', 'HTML video stops when video step advances');
  check(syntheticPauseCount > 0, 'HTML video pause was invoked during automatic transition');
  press('Escape');
  await until(() => !fullscreen && app.selection === null, 'Alt+Esc exits traversal and clears selection');
  press('n');
  await until(() => fullscreen && app.selection && q('runner-session').textContent.includes('validation step 1/'), 'Alt+N starts a fresh traversal after abort');
  check(!calls.some(call => /master_start|recorder_start|master_action|preflight/u.test(call.command)), 'aborted traversal never starts a recorded attempt');

  app.destroy();
} catch (error) { errors.push(String(error)); }
const result = document.createElement('pre');
result.id = 'receipt';
result.hidden = true;
result.textContent = JSON.stringify({ checks, errors, calls, fullscreen, syntheticPlayCount, syntheticPauseCount, syntheticTimeouts, scope: 'Synthetic native replies; hidden Runner hotkey traversal only' });
document.body.append(result);
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: repoRoot, sourcefile: "runner-hotkey-traversal-audit.js" },
  bundle: true,
  format: "esm",
  write: false,
  platform: "browser",
  logLevel: "silent",
  plugins: [{
    name: "preview-state-observer",
    setup(builder) {
      builder.onLoad({ filter: /[\\/]research[\\/]preview\.js$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        const needle = "state = normalizedState({ ...state, ...nextState, ...square });";
        assert.ok(source.includes(needle));
        return {
          contents: source.replace(needle, needle + " globalThis.__runnerPreviewAuditState = structuredClone(state);"),
          loader: "js",
          resolveDir: resolve(path, ".."),
        };
      });
    },
  }],
});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/runner/runner.css"><script type="module" src="/runner/src/audit.js"></script>'); return; }
    if (url.pathname === "/runner/src/audit.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    const path = resolve(repoRoot, "." + decodeURIComponent(url.pathname)); assert.ok(path.startsWith(repoRoot + sep));
    res.setHeader("Content-Type", ({ ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" })[extname(path)] ?? "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const execute = promisify(execFile);
try {
  const profile = await mkdtemp(join(output, "profile-"));
  const { stdout } = await execute(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--virtual-time-budget=12000", `--screenshot=${join(output, "runner-hotkeys.png")}`, "--dump-dom", `--user-data-dir=${profile}`, "--window-size=1938,1176", "--force-device-scale-factor=1", `http://127.0.0.1:${server.address().port}/`], { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
  await writeFile(join(output, "runner-hotkeys.html"), stdout);
  const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw, "Missing hotkey traversal receipt");
  const receipt = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
  await writeFile(join(output, "receipt.json"), JSON.stringify({ repoRoot, receipt }, null, 2));
  console.log(JSON.stringify({ checks: receipt.checks.length, errors: receipt.errors }));
  assert.deepEqual(receipt.errors, []);
} finally { server.close(); }

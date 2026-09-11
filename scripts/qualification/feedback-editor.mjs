// Background-only presentation checks; no user browser profile, desktop input or app launch.
// Usage: node scripts/qualification/feedback-editor.mjs <browser.exe> <output-dir> [snapshots] [state,...]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { createDefaultResearchSettings } from "../../site/src/research/contracts.js";
import { parseExperimentDefinitionV1, EXTERNAL_ORDER_ALGORITHM_VERSION } from "../../site/src/research/external-experiment.js";
import { validateResearchSettingsV3, QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION } from "../../site/src/research/external-protocol.js";

const [browser, destination, purpose, selectedStates] = process.argv.slice(2);
assert.ok(browser && destination, "Provide a browser executable and isolated output directory.");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gitRead = async (...args) => (await promisify(execFile)("git", args, {
  cwd: repositoryRoot, windowsHide: true, maxBuffer: 1_000_000,
})).stdout.trim();
const provenance = {
  repositoryCommit: await gitRead("rev-parse", "HEAD"),
  applicationTreeSha1: await gitRead("rev-parse", "HEAD:site"),
  applicationHasUncommittedChanges: Boolean(await gitRead("diff", "HEAD", "--name-only", "--", "site")),
  browserExecutableSha256: createHash("sha256").update(await readFile(browser)).digest("hex"),
};
const defaults = createDefaultResearchSettings();
const parsed = await parseExperimentDefinitionV1(await readFile(new URL("../../site/experiment-template.json", import.meta.url)));
const settings = await validateResearchSettingsV3({
  schema: defaults.schema, version: 3,
  experiment: { id: parsed.definition.experimentId, title: parsed.definition.title,
    participantCount: parsed.definition.schedules.length, samplingFrequencyHz: 130 },
  stimuli: { items: parsed.definition.stimuli.map((reference) => ({
    stimulusId: reference.stimulusId, title: reference.title,
    source: { kind: "workspaceFile", relativePath: reference.relativePath, mimeType: "video/mp4",
      sha256: createHash("sha256").update(`non-shipping-fixture:${reference.relativePath}`).digest("hex"),
      byteLength: 1000, durationMs: 10000 },
  })) },
  input: defaults.input, visual: defaults.visual, advanced: defaults.advanced, output: defaults.output,
  questionnaires: { algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION, definitions: [], modules: [] },
  externalProtocol: { algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
    sourceByteSha256: parsed.sourceByteSha256, definitionSha256: parsed.definitionSha256, definition: parsed.definition },
});
const css = await readFile(new URL("../../site/research.css", import.meta.url), "utf8");
const results = [];
const cases = purpose === "snapshots"
  ? ["empty", "controls", "error", "advanced", "color", "long-label"].flatMap((state) => [["browser", 1280, 1, state], ["browser", 500, 1.5625, state]])
  : [["browser", 1280, 1], ["browser", 900, 1], ["browser", 640, 1], ["browser", 500, 1.5625], ["tauri", 1280, 1], ["tauri", 900, 1], ["browser", 1280, 2]];
for (const [surface, width, zoom, screenshotState = "default"] of cases.filter((entry) => !selectedStates || selectedStates.split(",").includes(entry[3] ?? "default"))) {
  const name = `${surface}-${width}-${zoom}${screenshotState === "default" ? "" : `-${screenshotState}`}`;
  const profile = await mkdtemp(join(output, `${name}-profile-`));
  const fixture = { settings, experimentReceipt: parsed, surface, zoom, screenshotState };
  const bundle = await build({ write: false, bundle: true, format: "esm", platform: "browser",
    stdin: { resolveDir: dirname(fileURLToPath(import.meta.url)), contents:
      `import { checkFeedbackEditor } from './feedback-editor-fixture.js';
       checkFeedbackEditor(${JSON.stringify(fixture)}).then(receipt => {
         parent.document.querySelector('#receipt').textContent = JSON.stringify(receipt);
       }).catch(error => { parent.document.querySelector('#receipt').textContent = JSON.stringify({pass:false,error:error.stack}); });` },
  });
  const html = join(output, `${name}.html`);
  const frame = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Non-shipping P5 presentation fixture</title><style>${css}</style>
    <div id="research-app"></div><script type="module">${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`;
  // The frame gives the application its actual CSS viewport, including 320px.
  // Scaling the outer frame illustrates reflow at 200%; it does not qualify browser zoom.
  await writeFile(html, `<!doctype html><meta charset="utf-8"><title>P5 offscreen check</title>
    <style>html,body{margin:0;background:#10130f}iframe{border:0;display:block}</style>
    <pre id="receipt" hidden></pre><iframe title="Non-shipping feedback fixture"
    style="width:${width / zoom}px;height:${1000 / zoom}px;zoom:${zoom}"
    srcdoc="${frame.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe>`);
  const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${profile}`, `--window-size=${width},1000`,
    "--virtual-time-budget=7000", `--screenshot=${join(output, `${name}.png`)}`, "--dump-dom", pathToFileURL(html).href,
  ], { windowsHide: true, timeout: 30000, maxBuffer: 3_000_000 });
  const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw, `No background receipt: ${name}`);
  const receipt = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&"));
  receipt.provenance = { ...provenance,
    fixtureSha256: createHash("sha256").update(await readFile(html)).digest("hex"),
    screenshotSha256: createHash("sha256").update(await readFile(join(output, `${name}.png`))).digest("hex"),
  };
  await writeFile(join(output, `${name}.json`), JSON.stringify(receipt, null, 2));
  assert.ok(receipt.pass, `${name}: ${receipt.error}`);
  results.push({ name, checks: receipt.rows.length, viewport: receipt.viewport });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(join(output, "receipt.json"), JSON.stringify({ pass: true, provenance, results }, null, 2));

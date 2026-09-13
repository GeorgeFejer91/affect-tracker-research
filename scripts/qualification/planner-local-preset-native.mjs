// Actual production stdin -> hidden Planner -> native preset read -> CSV import.
// Read-only with respect to the local preset and experiment. No GUI attachment.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runPlannerCli } from "./planner-cli-driver.mjs";
import { RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS } from "../../site/src/research/questionnaire-local-presets.js";

const [executable, outputDirectory, expectedCommit] = process.argv.slice(2);
assert.ok(executable && outputDirectory && /^[a-f0-9]{40}$/.test(expectedCommit ?? ""),
  "Usage: node planner-local-preset-native.mjs <executable> <fresh-evidence-dir> <build-commit>");
let profileReview;
const receipt = await runPlannerCli({ executable, outputDirectory, steps: [
  { action: ({ ready }) => {
    assert.equal(process.platform, "win32", "This native profile receipt is Windows-specific.");
    assert.ok(Number.isSafeInteger(ready.processId) && ready.processId > 0);
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${ready.processId}' | Where-Object Name -eq 'msedgewebview2.exe' | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress`],
    { windowsHide: true, encoding: "utf8", timeout: 10000 });
    const children = [].concat(JSON.parse(raw));
    assert.equal(children.length, 1, "The CLI must own a distinct WebView browser process.");
    const browser = children[0];
    assert.equal(browser.ParentProcessId, ready.processId);
    const profile = /--user-data-dir=(?:"([^"]+)"|(\S+))/u.exec(browser.CommandLine);
    assert.ok(profile, "The owned browser did not declare its profile.");
    const directory = resolve(profile[1] ?? profile[2]);
    // WebView2 creates its EBWebView store beneath the builder's data directory.
    assert.equal(basename(directory), "EBWebView");
    assert.equal(basename(dirname(directory)), "webview");
    assert.match(basename(dirname(dirname(directory))), /^affect-planner-cli-[a-f0-9-]{36}$/u);
    assert.equal(dirname(dirname(dirname(directory))).toLowerCase(), resolve(tmpdir()).toLowerCase());
    profileReview = { processId: ready.processId, browserProcessId: browser.ProcessId,
      browserParentProcessId: browser.ParentProcessId, directory,
      ownedFreshProfile: true, sharedGuiProfile: false };
    return { kind: "catalogue" };
  } },
  { action: { kind: "get", field: "P2.localPresets" } },
  { action: { kind: "set", field: "P2.localPresets", value: [] }, expectStatus: "rejected" },
  { action: { kind: "get", field: "P2.localPresets" } },
] });
assert.equal(receipt.passed, true, JSON.stringify(receipt));
assert.equal(receipt.ready.buildCommit, expectedCommit);
const transcript = (await readFile(join(outputDirectory, "transcript.jsonl"), "utf8"))
  .trim().split("\n").map(JSON.parse);
const responses = transcript.filter(entry => entry.direction === "response").map(entry => entry.value);
assert.equal(responses.length, 4);
const descriptor = responses[0].result.settings.find(setting => setting.id === "P2.localPresets");
assert.equal(descriptor.writable, false);
await writeFile(join(outputDirectory, "catalogue.json"), `${JSON.stringify(responses[0].result, null, 2)}\n`, { flag: "wx" });
const expected = RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS[0];
const local = responses[1].result.value.find(asset => asset.id === expected.id);
assert.ok(local, "The native fixed-source preset was not projected.");
assert.deepEqual(local, { ...expected, ready: true, state: "installed" });
assert.equal(responses[2].status, "rejected");
assert.deepEqual(responses[3].result.value, responses[1].result.value);
assert.equal(responses[3].revision, responses[1].revision);
const review = { schema: "affect-research-local-preset-native-readback", version: 1,
  passed: true, buildCommit: receipt.ready.buildCommit, executableSha256: receipt.executableSha256,
  transcriptSha256: receipt.transcriptSha256, preset: local,
  profile: profileReview,
  nativeIpcAndProductionImporter: true, readonlyRejectionPreservedState: true,
  limits: ["Native installed-source readback, not native file-picker installation, study-source saving, rendered UI, master export or Runner qualification."] };
await writeFile(join(outputDirectory, "readback-review.json"), `${JSON.stringify(review, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(review));

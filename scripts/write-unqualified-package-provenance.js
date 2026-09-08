import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import process from "node:process";

const HEX_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const TARGETS = Object.freeze({
  "windows-x64": Object.freeze({
    platform: "windows",
    architecture: "x64",
    nodePlatform: "win32",
    nodeArch: "x64",
    artifacts: Object.freeze([
      Object.freeze({ kind: "nsis", directory: "src-tauri/target/release/bundle/nsis", suffix: ".exe" }),
    ]),
  }),
  "macos-arm64": Object.freeze({
    platform: "macos",
    architecture: "arm64",
    nodePlatform: "darwin",
    nodeArch: "arm64",
    artifacts: Object.freeze([
      Object.freeze({ kind: "dmg", directory: "src-tauri/target/release/bundle/dmg", suffix: ".dmg" }),
    ]),
  }),
  "macos-x64": Object.freeze({
    platform: "macos",
    architecture: "x64",
    nodePlatform: "darwin",
    nodeArch: "x64",
    artifacts: Object.freeze([
      Object.freeze({ kind: "dmg", directory: "src-tauri/target/release/bundle/dmg", suffix: ".dmg" }),
    ]),
  }),
  "linux-x64": Object.freeze({
    platform: "linux",
    architecture: "x64",
    nodePlatform: "linux",
    nodeArch: "x64",
    artifacts: Object.freeze([
      Object.freeze({ kind: "deb", directory: "src-tauri/target/release/bundle/deb", suffix: ".deb" }),
      Object.freeze({ kind: "appimage", directory: "src-tauri/target/release/bundle/appimage", suffix: ".AppImage" }),
    ]),
  }),
});

function fail(message) {
  throw new Error(`Unqualified internal provenance boundary: ${message}`);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

function git(arguments_) {
  return execFileSync("git", arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArguments() {
  if (process.argv.length !== 5 || process.argv[3] !== "--output") {
    fail("usage: node scripts/write-unqualified-package-provenance.js <target> --output <path>.");
  }
  const targetName = process.argv[2];
  const target = TARGETS[targetName];
  if (!target) fail(`unsupported target ${JSON.stringify(targetName)}.`);
  return { targetName, target, outputPath: resolve(process.argv[4]) };
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function identifyArtifacts(target) {
  const identities = [];
  for (const expectation of target.artifacts) {
    const directory = resolve(expectation.directory);
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(expectation.suffix))
      .sort((left, right) => left.localeCompare(right, "en"));
    if (names.length !== 1) {
      fail(`expected exactly one ${expectation.kind} artifact, found ${names.length}.`);
    }
    const path = resolve(directory, names[0]);
    const details = await stat(path);
    if (!details.isFile() || details.size <= 0) fail(`${expectation.kind} artifact is not a nonempty file.`);
    identities.push({
      kind: expectation.kind,
      path: relative(process.cwd(), path).split(sep).join("/"),
      fileName: names[0],
      byteLength: details.size,
      sha256: await sha256(path),
    });
  }
  return identities;
}

const { targetName, target, outputPath } = parseArguments();
if (process.platform !== target.nodePlatform || process.arch !== target.nodeArch) {
  fail(`target ${targetName} does not match host ${process.platform}/${process.arch}.`);
}

const commit = requiredEnvironment("GITHUB_SHA");
if (!HEX_COMMIT.test(commit)) fail("GITHUB_SHA must be an exact lowercase Git object ID.");
if (git(["rev-parse", "--verify", "HEAD"]) !== commit) fail("GITHUB_SHA does not match HEAD.");
if (git(["status", "--porcelain=v1", "--untracked-files=normal"])) {
  fail("the packaged checkout is not clean.");
}

const repository = requiredEnvironment("GITHUB_REPOSITORY");
const workflow = requiredEnvironment("GITHUB_WORKFLOW");
const workflowRef = requiredEnvironment("GITHUB_WORKFLOW_REF");
const runId = requiredEnvironment("GITHUB_RUN_ID");
const runAttempt = requiredEnvironment("GITHUB_RUN_ATTEMPT");
const serverUrl = requiredEnvironment("GITHUB_SERVER_URL");
const artifacts = await identifyArtifacts(target);

const receipt = {
  schema: "AffectResearchUnqualifiedInternalPackageProvenanceV1",
  status: "unqualified-internal-alpha",
  product: "Affect Research",
  version: "0.4.0-alpha.1",
  repository,
  commit,
  workflow,
  workflowRef,
  run: {
    id: runId,
    attempt: runAttempt,
    url: `${serverUrl}/${repository}/actions/runs/${runId}`,
  },
  target: {
    platform: target.platform,
    architecture: target.architecture,
    runnerOs: requiredEnvironment("RUNNER_OS"),
    runnerArch: requiredEnvironment("RUNNER_ARCH"),
    runnerImage: process.env.ImageOS ?? null,
    runnerImageVersion: process.env.ImageVersion ?? null,
  },
  buildBoundary: {
    hostNative: true,
    unsigned: true,
    notarized: false,
    published: false,
    cargoFeatures: "no-default-features",
    bundledWindowsGStreamerRuntime: false,
  },
  qualification: {
    nativeGstPlay: false,
    lsl: false,
    nativeInput: false,
    installedWorkflow: false,
    timing: false,
    researchReady: false,
  },
  artifacts,
  notice:
    "Workflow artifact only. This unsigned package is for internal interface evaluation and is not a supported download, qualified experiment build, or research-ready release.",
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});

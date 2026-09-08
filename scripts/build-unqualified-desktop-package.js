import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const HEX_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SIGNING_ENVIRONMENT_KEYS = [
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_PATH",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];

const TARGETS = Object.freeze({
  "windows-x64": Object.freeze({
    nodePlatform: "win32",
    nodeArch: "x64",
    bundles: "nsis",
    config: "src-tauri/tauri.bundle-windows-unqualified.conf.json",
  }),
  "macos-arm64": Object.freeze({
    nodePlatform: "darwin",
    nodeArch: "arm64",
    bundles: "dmg",
    config: "src-tauri/tauri.bundle-macos-unqualified.conf.json",
  }),
  "macos-x64": Object.freeze({
    nodePlatform: "darwin",
    nodeArch: "x64",
    bundles: "dmg",
    config: "src-tauri/tauri.bundle-macos-unqualified.conf.json",
  }),
  "linux-x64": Object.freeze({
    nodePlatform: "linux",
    nodeArch: "x64",
    bundles: "deb,appimage",
    config: "src-tauri/tauri.bundle-linux-unqualified.conf.json",
  }),
});

function fail(message) {
  throw new Error(`Unqualified internal package boundary: ${message}`);
}

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail("Git identity could not be verified.");
  return result.stdout.trim();
}

function parseTarget() {
  if (process.argv.length !== 3) {
    fail("pass exactly one target: windows-x64, macos-arm64, macos-x64, or linux-x64.");
  }
  const name = process.argv[2];
  const target = TARGETS[name];
  if (!target) fail(`unsupported target ${JSON.stringify(name)}.`);
  return { name, ...target };
}

function verifyBoundary(target) {
  if (process.platform !== target.nodePlatform || process.arch !== target.nodeArch) {
    fail(
      `${target.name} must build host-natively on ${target.nodePlatform}/${target.nodeArch}; ` +
        `this host is ${process.platform}/${process.arch}.`,
    );
  }
  if (!existsSync(target.config)) fail(`missing Tauri override ${target.config}.`);
  if (process.env.AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME === "1") {
    fail("the Windows-only GStreamer runtime gate must not be active.");
  }
  const suppliedSigningKey = SIGNING_ENVIRONMENT_KEYS.find((key) => process.env[key]);
  if (suppliedSigningKey) fail(`${suppliedSigningKey} must be absent from this unsigned job.`);

  const commit = process.env.GITHUB_SHA ?? process.env.AFFECT_RESEARCH_PACKAGE_COMMIT;
  if (!commit || !HEX_COMMIT.test(commit)) fail("an exact lowercase Git commit is required.");
  if (runGit(["rev-parse", "--verify", "HEAD"]) !== commit) {
    fail("the checked-out HEAD does not equal the requested package commit.");
  }
  if (runGit(["status", "--porcelain=v1", "--untracked-files=normal"])) {
    fail("the package worktree must be clean before building.");
  }
  return commit;
}

const target = parseTarget();
const commit = verifyBoundary(target);
const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const result = spawnSync(
  process.execPath,
  [
    tauriCli,
    "build",
    "--ci",
    "--no-sign",
    "--bundles",
    target.bundles,
    "--config",
    target.config,
    "--",
    "--locked",
    "--no-default-features",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME: "0",
      AFFECT_TRACKER_BUILD_COMMIT: commit,
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

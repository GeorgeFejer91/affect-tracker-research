import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function javascriptFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `${directory}${entry.name}`)
    .sort();
}

async function filesRecursively(directory, suffix) {
  const files = [];
  async function visit(relativeDirectory) {
    const entries = await readdir(new URL(relativeDirectory, root), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}${entry.name}`;
      if (entry.isDirectory()) await visit(`${relativePath}/`);
      if (entry.isFile() && entry.name.endsWith(suffix)) files.push(relativePath);
    }
  }
  await visit(directory);
  return files.sort();
}

async function researchImportGraph() {
  const paths = await javascriptFiles("experiment-planner/web/src/research/");
  const known = new Set(paths);
  const graph = new Map();
  for (const path of paths) {
    const source = await readFile(new URL(path, root), "utf8");
    const imports = [...source.matchAll(/\bfrom\s+["'](\.\/[^"']+)["']/gu)]
      .map((match) => `experiment-planner/web/src/research/${match[1].slice(2)}`)
      .filter((candidate) => known.has(candidate));
    graph.set(path, [...new Set(imports)].sort());
  }
  return graph;
}

test("the agent entry route is short and states the honest capability boundary", async () => {
  const [agents, entry] = await Promise.all([
    readFile(new URL("AGENTS.md", root), "utf8"),
    readFile(new URL("for-ai/00-READ-FIRST.md", root), "utf8"),
  ]);

  // The mandatory reading route is these two files. Keeping it small is the
  // point of the consolidation, so a regression here is a real regression.
  const mandatoryBytes = Buffer.byteLength(agents, "utf8") + Buffer.byteLength(entry, "utf8");
  assert.ok(mandatoryBytes < 32 * 1024, `mandatory agent reading route grew to ${mandatoryBytes} bytes`);

  // Browser execution must never be described as having native authority.
  assert.match(entry, /\*\*no\*\* LSL, \*\*no\*\* XDF, \*\*no\*\* native input or timing authority/u);
  assert.match(entry, /must never present native authority/u);
  assert.match(entry, /BLOCKED\/NOT RUN, never PASS/u);
  assert.match(agents, /Planner and Runner stay separate programs/u);
  assert.match(agents, /Do not restore the[\s\S]{0,20}retired native player stack/u);

  // Every document the entry route links to must exist.
  const linked = [...entry.matchAll(/\]\((\.\.?\/[^)#]+)[^)]*\)/gu), ...agents.matchAll(/\]\(\.\/([^)#]+)[^)]*\)/gu)];
  assert.ok(linked.length > 0);
});

test("raw Tauri invocation remains confined to explicit native adapter modules", async () => {
  const allowed = new Set([
    "experiment-planner/web/src/research/native-bridge.js",
    "experiment-planner/web/src/research/native-package-protocol.js",
    "experiment-planner/web/src/research/planner-authoring-native.js",
    "experiment-planner/web/src/research/planner-authoring-native-effects.js",
  ]);
  const offenders = [];
  for (const relativePath of await javascriptFiles("experiment-planner/web/src/research/")) {
    const source = await readFile(new URL(relativePath, root), "utf8");
    if (/\b(?:invoke|this\.invoke)\s*\(/u.test(source) && !allowed.has(relativePath)) {
      offenders.push(relativePath);
    }
  }
  assert.deepEqual(offenders, []);
  const effects = await readFile(new URL("experiment-planner/web/src/research/planner-authoring-native-effects.js", root), "utf8");
  assert.deepEqual([...effects.matchAll(/\binvoke\("([^"]+)"/gu)].map(match => match[1]), ["research_planner_authoring_effect"]);
});

test("frontend feature modules form an acyclic graph below the UI composition root", async () => {
  const graph = await researchImportGraph();
  const visiting = new Set();
  const visited = new Set();

  function visit(path, chain = []) {
    if (visiting.has(path)) {
      assert.fail(`frontend module cycle: ${[...chain, path].join(" -> ")}`);
    }
    if (visited.has(path)) return;
    visiting.add(path);
    for (const dependency of graph.get(path) ?? []) visit(dependency, [...chain, path]);
    visiting.delete(path);
    visited.add(path);
  }

  for (const path of [...graph.keys()].sort()) visit(path);
});

test("native and browser bridges depend on the typed UI contract, not the UI composition module", async () => {
  const [app, nativeBridge, browserBridge, uiContracts, uiView] = await Promise.all([
    readFile(new URL("experiment-planner/web/src/research/app.js", root), "utf8"),
    readFile(new URL("experiment-planner/web/src/research/native-bridge.js", root), "utf8"),
    readFile(new URL("experiment-planner/web/src/research/runtime-bridge.js", root), "utf8"),
    readFile(new URL("experiment-planner/web/src/research/ui-contracts.js", root), "utf8"),
    readFile(new URL("experiment-planner/web/src/research/ui-view.js", root), "utf8"),
  ]);
  assert.match(app, /from "\.\/ui-contracts\.js"/u);
  assert.match(app, /from "\.\/ui-view\.js"/u);
  assert.doesNotMatch(app, /<section\s+class=|<dialog\s+id=/u);
  assert.match(uiView, /data-mode-panel="setup"/u);
  assert.match(uiView, /data-mode-panel="run"/u);
  assert.match(nativeBridge, /from "\.\/ui-contracts\.js"/u);
  assert.match(browserBridge, /from "\.\/ui-contracts\.js"/u);
  assert.doesNotMatch(nativeBridge, /from "\.\/app\.js"/u);
  assert.doesNotMatch(browserBridge, /from "\.\/app\.js"/u);
  assert.doesNotMatch(uiContracts, /window|document|invoke\s*\(/u);
  assert.doesNotMatch(uiView, /@tauri-apps|\binvoke\s*\(|showDirectoryPicker|indexedDB/u);
});

test("Tauri has one composition root and media internals stay out of commands", async () => {
  const [lib, commands] = await Promise.all([
    readFile(new URL("native/src/lib.rs", root), "utf8"),
    readFile(new URL("native/src/research_commands.rs", root), "utf8"),
  ]);
  assert.ok((lib.match(/\.manage\(/gu) ?? []).length > 0);
  assert.doesNotMatch(commands, /windows::Win32/u);
  assert.doesNotMatch(commands, /unsafe\s*\{/u);
});

test("the authoritative Rust package runtime is split by authority and has no native media actor dependency", async () => {
  const required = [
    "commands.rs",
    "compiler.rs",
    "contracts.rs",
    "input_mailbox.rs",
    "records.rs",
    "recovery.rs",
    "reducer.rs",
    "responses.rs",
    "runtime.rs",
    "storage.rs",
  ];
  const entries = await readdir(new URL("native/src/research_native_protocol/", root), { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  for (const name of required) assert.ok(files.includes(name), `missing native package module ${name}`);

  const [commands, runtime, storage] = await Promise.all([
    readFile(new URL("native/src/research_native_protocol/commands.rs", root), "utf8"),
    readFile(new URL("native/src/research_native_protocol/runtime.rs", root), "utf8"),
    readFile(new URL("native/src/research_native_protocol/storage.rs", root), "utf8"),
  ]);
  assert.doesNotMatch(commands, /std::fs|File::|OpenOptions|unsafe\s*\{/u);
  assert.doesNotMatch(storage, /windows::Win32|tauri::command/u);
  assert.doesNotMatch(runtime, /windows::Win32|tauri::command/u);
});

test("project-authored unsafe is absent after retiring the Windows native media adapters", async () => {
  const found = [];
  for (const path of await filesRecursively("native/src/", ".rs")) {
    const source = await readFile(new URL(path, root), "utf8");
    if (/\bunsafe\s*\{/u.test(source)) found.push(path);
  }
  assert.deepEqual(found, []);

  const crateRoot = await readFile(new URL("native/src/lib.rs", root), "utf8");
  assert.match(crateRoot, /#!\[deny\(unsafe_op_in_unsafe_fn\)\]/u);
  assert.match(crateRoot, /#!\[deny\(clippy::undocumented_unsafe_blocks\)\]/u);
});

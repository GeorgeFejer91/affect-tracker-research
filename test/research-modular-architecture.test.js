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
  const paths = await javascriptFiles("site/src/research/");
  const known = new Set(paths);
  const graph = new Map();
  for (const path of paths) {
    const source = await readFile(new URL(path, root), "utf8");
    const imports = [...source.matchAll(/\bfrom\s+["'](\.\/[^"']+)["']/gu)]
      .map((match) => `site/src/research/${match[1].slice(2)}`)
      .filter((candidate) => known.has(candidate));
    graph.set(path, [...new Set(imports)].sort());
  }
  return graph;
}

test("for-ai makes mirrored frontend and Rust modularity a permanent release gate", async () => {
  const [charter, architecture, release, workflow] = await Promise.all([
    readFile(new URL("for-ai/15-RESEARCH-V1-CHARTER.md", root), "utf8"),
    readFile(new URL("for-ai/20-ARCHITECTURE.md", root), "utf8"),
    readFile(new URL("for-ai/30-TESTING-AND-RELEASE.md", root), "utf8"),
    readFile(new URL("for-ai/50-AGENT-WORKFLOW.md", root), "utf8"),
  ]);

  assert.match(charter, /Modularity is a release invariant/u);
  assert.match(architecture, /The following mirror map is normative/u);
  for (const boundary of [
    "Package and contracts",
    "Workspace and assets",
    "Protocol and questionnaires",
    "Participant and attempt",
    "Input",
    "Visual feedback",
    "Native media",
    "Timing and LSL",
    "Output and recovery",
    "Platform bridge",
  ]) {
    assert.match(architecture, new RegExp(`\\| ${boundary} \\|`, "u"));
  }
  assert.match(release, /Mirrored-module architecture gate/u);
  assert.match(release, /passing functional test suite does not waive this architecture gate/iu);
  assert.match(workflow, /name its row in the normative mirror map/u);
});

test("raw Tauri invocation remains confined to explicit native adapter modules", async () => {
  const allowed = new Set([
    "site/src/research/native-bridge.js",
    "site/src/research/native-media-controller.js",
    "site/src/research/native-package-protocol.js",
  ]);
  const offenders = [];
  for (const relativePath of await javascriptFiles("site/src/research/")) {
    const source = await readFile(new URL(relativePath, root), "utf8");
    if (/\b(?:invoke|this\.invoke)\s*\(/u.test(source) && !allowed.has(relativePath)) {
      offenders.push(relativePath);
    }
  }
  assert.deepEqual(offenders, []);
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
    readFile(new URL("site/src/research/app.js", root), "utf8"),
    readFile(new URL("site/src/research/native-bridge.js", root), "utf8"),
    readFile(new URL("site/src/research/runtime-bridge.js", root), "utf8"),
    readFile(new URL("site/src/research/ui-contracts.js", root), "utf8"),
    readFile(new URL("site/src/research/ui-view.js", root), "utf8"),
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
    readFile(new URL("src-tauri/src/lib.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/research_commands.rs", root), "utf8"),
  ]);
  assert.ok((lib.match(/\.manage\(/gu) ?? []).length > 0);
  assert.doesNotMatch(commands, /gst::|gst_play::|windows::Win32/u);
  assert.doesNotMatch(commands, /unsafe\s*\{/u);
});

test("the authoritative Rust package runtime is split by authority and failure domain", async () => {
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
  const entries = await readdir(new URL("src-tauri/src/research_native_protocol/", root), { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  for (const name of required) assert.ok(files.includes(name), `missing native package module ${name}`);

  const [commands, runtime, storage, media] = await Promise.all([
    readFile(new URL("src-tauri/src/research_native_protocol/commands.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/research_native_protocol/runtime.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/research_native_protocol/storage.rs", root), "utf8"),
    readFile(new URL("src-tauri/src/research_native_media/gst_actor.rs", root), "utf8"),
  ]);
  assert.doesNotMatch(commands, /std::fs|File::|OpenOptions|gst::|gst_play::|unsafe\s*\{/u);
  assert.doesNotMatch(storage, /gst::|gst_play::|windows::Win32|tauri::command/u);
  assert.doesNotMatch(media, /ResearchRunManifest|QuestionnaireResponse|ratings\.csv/u);
  assert.doesNotMatch(runtime, /tauri::command/u);
});

test("project-authored unsafe is confined to the two approved documented Windows FFI adapters", async () => {
  const allowed = new Set([
    "src-tauri/src/research_native_media/gst_actor/runtime_environment.rs",
    "src-tauri/src/research_native_media/gst_actor/windows_renderer.rs",
  ]);
  const found = [];
  for (const path of await filesRecursively("src-tauri/src/", ".rs")) {
    const source = await readFile(new URL(path, root), "utf8");
    if (/\bunsafe\s*\{/u.test(source)) found.push(path);
    if (allowed.has(path)) {
      assert.match(source, /\/\/ SAFETY:/u, `${path} must document every contained FFI invariant`);
    }
  }
  assert.deepEqual(found, [...allowed].sort());

  const crateRoot = await readFile(new URL("src-tauri/src/lib.rs", root), "utf8");
  assert.match(crateRoot, /#!\[deny\(unsafe_op_in_unsafe_fn\)\]/u);
  assert.match(crateRoot, /#!\[deny\(clippy::undocumented_unsafe_blocks\)\]/u);
});

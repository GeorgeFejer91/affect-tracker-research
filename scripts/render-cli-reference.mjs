import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const owners = [
  ["P1", "Workspace & videos", "segments.P1"],
  ["P2", "Questionnaires & languages", "segments.P2"],
  ["P3", "Versions & intervals", "segments.P3"],
  ["P4", "Screen & layout", "segments.P4"],
  ["P5", "Feedback & controls", "segments.P5"],
  ["P6", "Optional XR layout", "segments.P6 (included profile or explicit exclusion)"],
  ["P7", "Review & export", "root policy, target, identity and integrity; no segments.P7"],
];
export const aboutFiles = Object.freeze([
  "about/index.html", "about/about.css", "about/catalogue.json",
  "about/command-api.txt", "about/consequential-commands.txt",
]);
const escape = value => String(value).replace(/[&<>"']/gu, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function catalogueSourcePaths(repositoryRoot) {
  const queue = ["app", "planner-authoring-session", "planner-authoring-contract", ...owners.map(([id]) => `planner-authoring-${id.toLowerCase()}`)]
    .map(name => `site/src/research/${name}.js`);
  const paths = new Set();
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (paths.has(path)) continue;
    if (path.startsWith("../") || isAbsolute(path)) throw new Error("Catalogue source import escapes repository.");
    paths.add(path);
    const source = await readFile(resolve(repositoryRoot, path), "utf8");
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+\.js)["']/gu)) {
      queue.push(relative(repositoryRoot, resolve(repositoryRoot, dirname(path), match[1])).replaceAll("\\", "/"));
    }
  }
  return [...paths].sort();
}

export async function readCatalogue(repositoryRoot) {
  const reference = JSON.parse(await readFile(resolve(repositoryRoot, "docs/cli/planner-authoring-catalogue.json"), "utf8"));
  if (reference.schema !== "affect-research-planner-cli-catalogue-reference" || reference.version !== 1
      || !/^[a-f0-9]{40}$/u.test(reference.sourceRevision) || !Array.isArray(reference.sourceFiles)
      || !Array.isArray(reference.catalogue?.settings) || !Array.isArray(reference.catalogue?.operations)) {
    throw new Error("CLI reference requires a versioned production catalogue with source identity.");
  }
  const tracked = new Set();
  for (const file of reference.sourceFiles) {
    const path = file.path;
    if (typeof path !== "string" || path.includes("\\") || isAbsolute(path) || path.split("/").includes("..")
        || !/^[a-f0-9]{64}$/u.test(file.sha256) || tracked.has(path)) throw new Error("Invalid or duplicate CLI source binding.");
    const target = resolve(repositoryRoot, path);
    if (relative(repositoryRoot, target).startsWith("..")) throw new Error("CLI source binding escapes the repository.");
    if (sha256(await readFile(target)) !== file.sha256) {
      throw new Error(`CLI catalogue is stale: ${path}. Recapture it from the current production CLI; do not edit descriptors by hand.`);
    }
    tracked.add(path);
  }
  for (const name of ["app", "planner-authoring-session", ...owners.map(([id]) => `planner-authoring-${id.toLowerCase()}`)]) {
    if (!tracked.has(`site/src/research/${name}.js`)) throw new Error(`CLI catalogue lacks required source binding: ${name}.js`);
  }
  for (const path of await catalogueSourcePaths(repositoryRoot)) {
    if (!tracked.has(path)) throw new Error(`CLI catalogue lacks transitive source binding: ${path}`);
  }
  const settingIds = new Set();
  for (const setting of reference.catalogue.settings) {
    if (!/^P[1-7]\.[\w.-]+$/u.test(setting.id) || settingIds.has(setting.id)
        || typeof setting.writable !== "boolean" || typeof setting.type !== "string"
        || !["authored", "derived", "compatibility", "transient"].includes(setting.classification)) {
      throw new Error("Invalid or duplicate CLI setting descriptor.");
    }
    settingIds.add(setting.id);
  }
  const operationIds = new Set();
  for (const operation of reference.catalogue.operations) {
    const key = `${operation.owner}.${operation.id}`;
    if (!/^P[1-7]$/u.test(operation.owner) || typeof operation.id !== "string" || !operation.id || operationIds.has(key)) {
      throw new Error("Invalid or duplicate CLI owner operation.");
    }
    operationIds.add(key);
  }
  for (const [id] of owners) if (![...settingIds].some(field => field.startsWith(`${id}.`))) throw new Error(`CLI catalogue is missing ${id}.`);
  const evidence = JSON.parse(await readFile(resolve(repositoryRoot, "docs/cli/planner-authoring-catalogue-evidence.json"), "utf8"));
  if (evidence.schema !== "affect-research-planner-cli-catalogue-evidence" || evidence.version !== 1
      || evidence.sourceRevision !== reference.sourceRevision
      || evidence.catalogueSha256 !== sha256(Buffer.from(JSON.stringify(reference.catalogue)))
      || evidence.exitCode !== 0 || !/^[a-f0-9]{64}$/u.test(evidence.executableSha256)
      || !/^[a-f0-9]{64}$/u.test(evidence.transcriptSha256)) {
    throw new Error("CLI catalogue differs from its production evidence. Recapture the catalogue.");
  }
  return reference;
}

function descriptor(value, operation = false) {
  const internal = operation && (value.consequential === true || value.atomic === false);
  const label = value.label || value.id;
  const status = operation
    ? internal ? "Internal consequential descriptor · not an atomic edit or public path command" : "Atomic owner operation · use inside apply.edits"
    : `${value.type} · ${value.classification} · ${value.writable ? "writable" : "read-only"}`;
  return `<details class="entry" data-descriptor="${escape(operation ? `${value.owner}.${value.id}` : value.id)}"><summary><code>${escape(value.id)}</code>${label === value.id ? "" : ` — ${escape(label)}`}<span class="meta">${escape(status)}</span></summary><pre><code>${escape(JSON.stringify(value, null, 2))}</code></pre></details>`;
}

function renderCatalogue(catalogue) {
  return owners.map(([id, label, output]) => {
    const settings = catalogue.settings.filter(field => field.id.startsWith(`${id}.`));
    const operations = catalogue.operations.filter(operation => operation.owner === id);
    return `<details class="owner" id="owner-${id.toLowerCase()}"><summary>${id} · ${escape(label)}<span class="meta">${settings.length} settings · ${operations.length} owner operations</span></summary><p>Saved contribution: <code>${escape(output)}</code>.</p><h3>Settings</h3>${settings.map(field => descriptor(field)).join("\n")}${operations.length ? `<h3>Owner operations</h3>${operations.map(operation => descriptor(operation, true)).join("\n")}` : ""}</details>`;
  }).join("\n");
}

function inlineMarkdown(value) {
  return value.split(/(`[^`]+`)/u).map(part => part.startsWith("`")
    ? `<code>${escape(part.slice(1, -1).replaceAll("\\|", "|"))}</code>` : escape(part)).join("");
}

export function renderExternalContract(source) {
  const table = source.split(/\r?\n/u).filter(line => line.startsWith("|"));
  if (table.length < 3 || !table[0].includes("Operation") || !table[0].includes("Arguments")) throw new Error("Frozen external command table is missing.");
  const rows = table.slice(2).map(line => line.slice(1, -1).split(/(?<!\\)\|/u).map(cell => cell.trim()));
  if (rows.some(row => row.length !== 3)) throw new Error("Frozen external command table shape changed; review the reference renderer.");
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="Frozen native file commands"><table><thead><tr><th>Operation</th><th>Exact arguments</th><th>User action / authority</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${inlineMarkdown(row[0])}</th><td data-label="Arguments">${inlineMarkdown(row[1])}</td><td data-label="Action">${inlineMarkdown(row[2])}</td></tr>`).join("\n")}</tbody></table></div>`;
}

function replaceSlot(template, name, content) {
  const expression = new RegExp(`<!-- CLI:${name} -->[\\s\\S]*?<!-- /CLI:${name} -->`, "gu");
  if ([...template.matchAll(expression)].length !== 1) throw new Error(`Expected one CLI ${name} slot.`);
  return template.replace(expression, () => content);
}

export async function renderReference(repositoryRoot) {
  const reference = await readCatalogue(repositoryRoot);
  const contract = await readFile(resolve(repositoryRoot, "docs/planner-cli-consequential-commands-v1.md"), "utf8");
  let html = await readFile(resolve(repositoryRoot, "site/about/index.html"), "utf8");
  html = replaceSlot(html, "identity", `<p><strong>Catalogue source:</strong> <code class="digest">${reference.sourceRevision}</code> ${reference.catalogue.settings.length} settings and ${reference.catalogue.operations.length} owner operations. Source-file hashes were checked when this page was built.</p>`);
  html = replaceSlot(html, "catalogue", renderCatalogue(reference.catalogue));
  html = replaceSlot(html, "external", renderExternalContract(contract));
  return { html, reference, contract };
}

export async function buildCliReference(repositoryRoot, outputRoot) {
  const { html, reference, contract } = await renderReference(repositoryRoot);
  const destination = resolve(outputRoot, "about");
  await mkdir(destination, { recursive: true });
  await writeFile(resolve(destination, "index.html"), html);
  await copyFile(resolve(repositoryRoot, "site/about/about.css"), resolve(destination, "about.css"));
  await writeFile(resolve(destination, "catalogue.json"), `${JSON.stringify(reference, null, 2)}\n`);
  await writeFile(resolve(destination, "consequential-commands.txt"), contract);
  await copyFile(resolve(repositoryRoot, "docs/planner-authoring-command-api-v1.md"), resolve(destination, "command-api.txt"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--check") throw new Error("Usage: node scripts/render-cli-reference.mjs --check");
  const { reference } = await renderReference(root);
  console.log(`CLI reference verified: ${reference.catalogue.settings.length} settings, ${reference.catalogue.operations.length} operations, ${reference.sourceFiles.length} source bindings.`);
}

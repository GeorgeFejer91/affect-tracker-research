// Package an actual production-driver receipt; never instantiate replacement owners.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { catalogueSourcePaths, validateCatalogueShape } from "./render-cli-reference.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceRoot = process.argv[2];
if (process.argv.length !== 3) throw new Error("Usage: node scripts/capture-cli-reference.mjs <production-driver-evidence-directory>");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = JSON.parse(await readFile(resolve(evidenceRoot, "receipt.json"), "utf8"));
assert.equal(receipt.schema, "affect-research-planner-cli-driver-receipt");
assert.equal(receipt.version, 1);
assert.equal(receipt.passed, true);
assert.equal(receipt.exit.code, 0);
assert.match(receipt.ready.buildCommit, /^[0-9a-f]{40}$/u);
assert.match(receipt.executableSha256, /^[0-9a-f]{64}$/u);
const transcript = await readFile(resolve(evidenceRoot, "transcript.jsonl"));
assert.equal(sha256(transcript), receipt.transcriptSha256, "Production transcript identity changed.");
const frames = transcript.toString("utf8").trim().split(/\r?\n/u).map(line => JSON.parse(line));
const request = frames.find(frame => frame.direction === "request" && frame.value.action.kind === "catalogue")?.value;
assert.ok(request, "No actual catalogue request in transcript.");
const response = frames.find(frame => frame.direction === "response" && frame.value.requestId === request.requestId)?.value;
assert.equal(response?.status, "ok");
assert.equal(response.sessionId, receipt.ready.sessionId);
assert.equal(request.sessionId, receipt.ready.sessionId);
const catalogue = response.result;
validateCatalogueShape(catalogue);
const sourceRevision = receipt.ready.buildCommit;
const sourceFiles = [];
for (const path of await catalogueSourcePaths(root)) {
  const bytes = await readFile(resolve(root, path));
  const committed = execFileSync("git", ["show", `${sourceRevision}:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  assert.ok(bytes.equals(committed), `Current ${path} differs from the captured executable source. Rebuild and recapture the CLI.`);
  sourceFiles.push({ path, sha256: sha256(bytes) });
}
const reference = { schema: "affect-research-planner-cli-catalogue-reference", version: 1, sourceRevision, sourceFiles, catalogue };
const target = resolve(root, "docs/cli/planner-authoring-catalogue.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(reference, null, 2)}\n`);
await writeFile(resolve(root, "docs/cli/planner-authoring-catalogue-evidence.json"), `${JSON.stringify({
  schema: "affect-research-planner-cli-catalogue-evidence", version: 1,
  sourceRevision, executableSha256: receipt.executableSha256,
  transcriptSha256: receipt.transcriptSha256,
  catalogueSha256: sha256(Buffer.from(JSON.stringify(catalogue))),
  completedSteps: receipt.completedSteps, exitCode: receipt.exit.code,
  scope: "Actual native catalogue query only. This capture helper does not verify owner edits, media import, recipe export, UI parity or Runner execution.",
}, null, 2)}\n`);
console.log(`Captured ${catalogue.settings.length} settings and ${catalogue.operations.length} operations from ${sourceRevision}; ${sourceFiles.length} source bindings. ${relative(root, target)}`);

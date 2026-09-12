import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const executable = process.argv[2], outputDirectory = process.argv[3];
if (!executable || !outputDirectory) throw new Error("Usage: node planner-cli-smoke.mjs <built-executable> <evidence-directory>");
const transcript = [], stdout = [], stderr = [];
const child = spawn(resolve(executable), ["jsonl"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
let partial = "", waiting = null, exited = false;
const queued = [];
const close = new Promise((resolveClose, reject) => {
  child.on("error", reject);
  child.on("close", (code, signal) => { exited = true; if (waiting) { waiting.reject(new Error(`CLI exited before response (${code}, ${signal}).`)); waiting = null; } resolveClose({ code, signal }); });
});
child.stdout.on("data", data => {
  partial += data.toString("utf8");
  if (partial.length > 16 * 1024 * 1024) { child.kill(); return; }
  let end;
  while ((end = partial.indexOf("\n")) >= 0) {
    const line = partial.slice(0, end); partial = partial.slice(end + 1); stdout.push(line);
    let value;
    try { value = JSON.parse(line); } catch { child.kill(); return; }
    if (waiting) { const current = waiting; waiting = null; current.resolve(value); } else queued.push(value);
  }
});
child.stderr.on("data", data => { if (stderr.join("").length < 32768) stderr.push(data.toString("utf8")); });
function next() {
  if (queued.length) return Promise.resolve(queued.shift());
  if (exited) throw new Error("CLI already exited.");
  return new Promise((resolveNext, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLI response timed out.")); }, 125000);
    waiting = { resolve(value) { clearTimeout(timer); resolveNext(value); }, reject(error) { clearTimeout(timer); reject(error); } };
  });
}

let receipt;
try {
  const ready = await next();
  assert.equal(ready.schema, "affect-research-planner-cli-ready");
  assert.equal(ready.hidden, true); assert.equal(ready.transport, "stdio");
  assert.equal(ready.processId, child.pid);
  let revision = ready.revision;
  const send = async (action, expectedRevision = null, requestId = randomUUID()) => {
    const request = { schema: "affect-research-planner-command", version: 1, sessionId: ready.sessionId, requestId, expectedRevision, action };
    child.stdin.write(`${JSON.stringify(request)}\n`);
    const response = await next(); transcript.push({ request, response });
    assert.equal(response.sessionId, ready.sessionId); assert.equal(response.requestId, requestId);
    revision = Math.max(revision, response.revision);
    return response;
  };
  const catalogue = await send({ kind: "catalogue" });
  assert.equal(catalogue.status, "ok");
  assert.equal(catalogue.result.settings.filter(setting => setting.writable).length, 9);
  const before = await send({ kind: "snapshot" });
  const base = revision, id = randomUUID();
  const changed = await send({ kind: "set", field: "P7.participantCount", value: 42 }, base, id);
  assert.equal(changed.status, "applied"); assert.equal(changed.revision, base + 1);
  assert.equal((await send({ kind: "get", field: "P7.participantCount" })).result.value, 42);
  assert.deepEqual(await send({ kind: "set", field: "P7.participantCount", value: 42 }, base, id), changed);
  const stale = await send({ kind: "set", field: "P7.participantCount", value: 90 }, base);
  assert.equal(stale.status, "rejected"); assert.equal(stale.issues[0].code, "stale_revision");
  const malformed = await send({ kind: "set", field: "P7.samplingFrequencyHz", value: "130" }, revision);
  assert.equal(malformed.status, "rejected"); assert.equal(malformed.issues[0].code, "invalid_value");
  const batch = await send({ kind: "apply", edits: [
    { kind: "set", field: "P7.samplingFrequencyHz", value: 100 },
    { kind: "set", field: "P7.lsl.sourceId", value: "cli-smoke-test" },
  ] }, revision);
  assert.equal(batch.status, "applied");
  const after = await send({ kind: "snapshot" });
  assert.equal(after.result.owners.P7.values["P7.participantCount"], 42);
  assert.equal(after.result.owners.P7.values["P7.samplingFrequencyHz"], 100);
  assert.equal(after.result.owners.P7.values["P7.lsl.sourceId"], "cli-smoke-test");
  assert.equal(after.result.owners.P7.issues.length, 0);
  child.stdin.end();
  const exit = await close; assert.equal(exit.code, 0);
  receipt = { status: "passed", ready, exit, before: before.result, after: after.result, commandCount: transcript.length,
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    limits: ["Actual hidden native/WebView policy session only; no real media, complete recipe, GUI interaction, Runner execution or installed qualification."] };
} catch (error) {
  child.kill();
  receipt = { status: "failed", message: error.message };
  process.exitCode = 1;
} finally {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(resolve(outputDirectory, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
  await writeFile(resolve(outputDirectory, "stdout.jsonl"), `${stdout.join("\n")}\n`);
  await writeFile(resolve(outputDirectory, "stderr.log"), stderr.join(""));
  console.log(JSON.stringify(receipt));
}

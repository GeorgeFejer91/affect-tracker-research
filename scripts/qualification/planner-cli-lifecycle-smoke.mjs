import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const executable = resolve(process.argv[2] ?? ""), directory = process.argv[3];
if (!process.argv[2] || !directory) throw new Error("Usage: node planner-cli-lifecycle-smoke.mjs <CLI.exe> <new-evidence-directory>");
await mkdir(directory); // Never overwrite another qualification receipt.
const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
const cases = [];

async function runCase(name, exercise, expectedExit) {
  const child = spawn(executable, ["jsonl"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const frames = [], queued = [], decoder = new TextDecoder("utf-8", { fatal: true });
  let partial = "", stderr = "", waiting = null, failure = null, ended = false;
  const fail = error => { failure ??= error; waiting?.reject(error); waiting = null; child.kill(); };
  const timer = setTimeout(() => fail(new Error("Owned CLI lifecycle deadline exceeded.")), 125000);
  const close = new Promise(resolveClose => {
    child.on("error", fail);
    child.on("close", (code, signal) => { ended = true; waiting?.reject(new Error("Owned CLI exited before a frame.")); waiting = null; resolveClose({ code, signal }); });
  });
  child.stdin.on("error", error => { if (error.code !== "EPIPE") fail(error); });
  child.stdout.on("data", chunk => {
    try {
      partial += decoder.decode(chunk, { stream: true });
      if (partial.length > 1024 * 1024 || frames.length > 32) throw new Error("Unexpected output volume.");
      let end;
      while ((end = partial.indexOf("\n")) >= 0) {
        const frame = JSON.parse(partial.slice(0, end)); partial = partial.slice(end + 1);
        frames.push(frame);
        if (waiting) { const pending = waiting; waiting = null; pending.resolve(frame); } else queued.push(frame);
      }
    } catch (error) { fail(error); }
  });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString("utf8")).slice(0, 32768); });
  const next = () => {
    if (failure) return Promise.reject(failure);
    if (queued.length) return Promise.resolve(queued.shift());
    if (ended) return Promise.reject(new Error("Owned CLI already exited."));
    return new Promise((resolveFrame, reject) => { waiting = { resolve: resolveFrame, reject }; });
  };
  const result = { name, status: "failed", frames };
  try {
    const ready = await next();
    assert.equal(ready.schema, "affect-research-planner-cli-ready");
    assert.equal(ready.processId, child.pid); assert.equal(ready.hidden, true);
    await exercise({ child, next, ready });
    const exit = await close;
    if (failure) throw failure;
    partial += decoder.decode(); assert.equal(partial, ""); assert.equal(queued.length, 0);
    assert.equal(exit.code, expectedExit); assert.equal(exit.signal, null);
    result.status = "passed"; result.exit = exit;
  } catch (error) {
    result.message = error.message; child.kill(); await close; throw error;
  } finally {
    clearTimeout(timer); result.stderr = stderr; cases.push(result);
    await writeFile(resolve(directory, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
  }
}

let status = "passed";
try {
  await runCase("empty-eof", async ({ child }) => { child.stdin.end(); }, 0);
  await runCase("strict-input-recovery", async ({ child, next, ready }) => {
    const command = { schema: "affect-research-planner-command", version: 1, sessionId: ready.sessionId,
      requestId: randomUUID(), expectedRevision: null, action: { kind: "snapshot" } };
    const text = JSON.stringify(command);
    for (const frame of [Buffer.from([0xff, 10]), Buffer.from(`${text.replace('"version":1', '"version":1,"version":1')}\n`), Buffer.from(`${text.replace('"snapshot"', '"eval"')}\n`)]) {
      child.stdin.write(frame); const result = await next();
      assert.equal(result.status, "rejected"); assert.equal(result.requestId, null);
      assert.equal(result.issues[0].code, "malformed_command");
    }
    child.stdin.write(`${text}\n`); const response = await next();
    assert.equal(response.requestId, command.requestId); assert.equal(response.status, "ok");
    assert.equal(response.revision, ready.revision); child.stdin.end();
  }, 0);
  await runCase("oversized-frame-exit", async ({ child }) => {
    child.stdin.end(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
  }, 2);
} catch { status = "failed"; process.exitCode = 1; }
const receipt = { status, executableSha256, cases: cases.map(({ frames, stderr, ...result }) => result),
  limits: ["Actual owned hidden CLI lifecycle only. No media, full recipe, UI parity or Runner execution claim."] };
await writeFile(resolve(directory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));

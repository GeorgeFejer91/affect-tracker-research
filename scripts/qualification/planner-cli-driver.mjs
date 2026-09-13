// Production-process driver; no editor imports, fixtures, DOM or recipe compiler.
// node scripts/qualification/planner-cli-driver.mjs <CLI.exe> <actions.json> <new-evidence-directory>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_FRAME = 16 * 1024 * 1024;
const MAX_STEPS = 4096;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const finiteRevision = value => Number.isSafeInteger(value) && value >= 0;

function exact(value, keys, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields differ`);
}

function validateReady(value) {
  exact(value, ["schema", "version", "sessionId", "revision", "processId", "buildCommit", "transport", "hidden"], "Ready receipt");
  assert.equal(value.schema, "affect-research-planner-cli-ready");
  assert.equal(value.version, 1);
  assert.ok(uuid(value.sessionId) && finiteRevision(value.revision));
  assert.ok(Number.isSafeInteger(value.processId) && value.processId > 0);
  assert.match(value.buildCommit, /^[a-f0-9]{40}$/u);
  assert.equal(value.transport, "stdio");
  assert.equal(value.hidden, true);
}

function validateResponse(value, request, revision) {
  exact(value, ["schema", "version", "sessionId", "requestId", "status", "revision", "result", "issues"], "Command response");
  assert.equal(value.schema, "affect-research-planner-command-result");
  assert.equal(value.version, 1);
  assert.equal(value.sessionId, request.sessionId, "Response came from another session");
  assert.equal(value.requestId, request.requestId, "Unexpected or duplicate response identity");
  assert.ok(finiteRevision(value.revision) && value.revision >= revision, "Revision moved backwards");
  assert.ok(["ok", "applied", "incomplete", "rejected", "canceled"].includes(value.status));
  assert.ok(Array.isArray(value.issues));
}

function frames(stream) {
  let buffer = Buffer.alloc(0), closed = false, failure = null, waiting = null;
  const queued = [];
  function fail(error) { failure ??= error; waiting?.reject(failure); waiting = null; }
  stream.on("data", chunk => {
    if (failure) return;
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      if (end + 1 > MAX_FRAME) { fail(new Error("CLI stdout frame exceeds 16 MiB")); return; }
      const bytes = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      try {
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (waiting) { waiting.resolve(value); waiting = null; }
        else { queued.push(value); if (queued.length > 4) throw new Error("Unexpected CLI output queue overflow"); }
      } catch (error) { fail(error); return; }
    }
    if (buffer.length > MAX_FRAME) fail(new Error("CLI stdout frame exceeds 16 MiB"));
  });
  stream.on("error", fail);
  stream.on("end", () => {
    closed = true;
    if (buffer.length) fail(new Error("CLI stdout ended with an incomplete JSONL frame"));
    waiting?.reject(failure ?? new Error("CLI closed before its expected response")); waiting = null;
  });
  return {
    next(timeoutMs) {
      if (failure) return Promise.reject(failure);
      if (queued.length) return Promise.resolve(queued.shift());
      if (closed) return Promise.reject(new Error("CLI closed before its expected response"));
      assert.equal(waiting, null, "Driver permits one sequential response wait");
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => { waiting = null; rejectWait(new Error("CLI response deadline elapsed; outcome may be unknown")); }, timeoutMs);
        waiting = { resolve(value) { clearTimeout(timer); resolveWait(value); }, reject(error) { clearTimeout(timer); rejectWait(error); } };
      });
    },
    assertDrained() { if (failure) throw failure; assert.equal(queued.length, 0, "CLI emitted unsolicited or duplicate output"); },
  };
}

function deadline(promise, timeoutMs, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]).finally(() => clearTimeout(timer));
}

function validateAction(action) {
  assert.ok(action && typeof action === "object" && !Array.isArray(action)
    && Object.getPrototypeOf(action) === Object.prototype, "Action must be a plain object");
  assert.equal(typeof action.kind, "string");
  return action;
}

/** steps: [{ action, expectStatus?, mutation?, checkResponse?, until?, maxQueries?, queryIntervalMs? }]. Action bodies pass unchanged to
 * the production CLI. mutation defaults true except documented query actions.
 * args is injectable only for driver tests; the command-line entry always uses jsonl.
 * Programmatic callers may supply a synchronous action({ready,revision,lastResponse})
 * resolver to use IDs or filenames returned by the previous command. It receives
 * detached copies, imports no application authority, and its resolved command is
 * validated and recorded exactly like a static action. JSON action files stay static.
 * checkResponse asserts on detached request/response copies. until repeats only a
 * fixed read-only query within explicit bounds. Each observation is recorded with
 * a fresh request ID; elapsed spacing is not evidence of readiness. Completed
 * steps counts the logical query step once, not each recorded query attempt.
 */
export async function runPlannerCli({ executable, steps, outputDirectory, args = ["jsonl"], timeoutMs = 150000 }) {
  assert.ok(Array.isArray(steps) && steps.length > 0 && steps.length <= MAX_STEPS, "Require 1–4096 command steps");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0);
  for (const step of steps) {
    assert.ok(step && typeof step === "object" && !Array.isArray(step));
    assert.ok(Object.keys(step).every(key => ["action", "expectStatus", "mutation", "checkResponse", "until", "maxQueries", "queryIntervalMs"].includes(key)), "Unknown driver step field");
    if (typeof step.action !== "function") validateAction(step.action);
    if (step.mutation !== undefined) assert.equal(typeof step.mutation, "boolean");
    if (step.expectStatus !== undefined) assert.ok(["ok", "applied", "incomplete", "rejected", "canceled"].includes(step.expectStatus));
    if (step.checkResponse !== undefined) assert.ok(typeof step.checkResponse === "function"
      && Object.prototype.toString.call(step.checkResponse) !== "[object AsyncFunction]", "Response check must be synchronous");
    if (step.until !== undefined) {
      assert.ok(typeof step.until === "function" && Object.prototype.toString.call(step.until) !== "[object AsyncFunction]", "Readiness predicate must be synchronous");
      assert.ok(typeof step.action !== "function" && ["catalogue", "snapshot", "get", "validate"].includes(step.action.kind)
        && step.mutation !== true, "Only a fixed read-only query may repeat");
      assert.ok(Number.isSafeInteger(step.maxQueries) && step.maxQueries >= 1 && step.maxQueries <= 100, "Bound readiness queries to 1–100");
      assert.ok(Number.isSafeInteger(step.queryIntervalMs) && step.queryIntervalMs >= 10 && step.queryIntervalMs <= 1000, "Bound query spacing to 10–1000 ms");
    } else assert.ok(step.maxQueries === undefined && step.queryIntervalMs === undefined, "Query bounds require a readiness predicate");
  }
  executable = resolve(executable);
  assert.ok((await stat(executable)).isFile(), "CLI executable must be a file");
  const executableSha256 = hash(await readFile(executable));
  outputDirectory = resolve(outputDirectory);
  await mkdir(outputDirectory); // Exclusive new directory: never replace evidence.
  const transcript = await open(join(outputDirectory, "transcript.jsonl"), "wx");
  let child, ready = null, revision = null, completed = 0, failed = null, exit = null, lastResponse = null, failureCleanup = null;
  let stderr = Buffer.alloc(0), stderrTruncated = false, exitPromise = null;
  const record = async (direction, value) => {
    await transcript.writeFile(`${JSON.stringify({ direction, value })}\n`);
    await transcript.sync();
  };
  try {
    child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    exitPromise = new Promise(resolveExit => {
      child.once("error", error => resolveExit({ code: null, signal: null, error: error.message }));
      child.once("close", (code, signal) => resolveExit({ code, signal }));
    });
    child.stdin.on("error", () => {}); // Per-write callbacks/response deadlines retain the failure.
    child.stderr.on("data", bytes => {
      const remaining = 65536 - stderr.length;
      if (bytes.length > remaining) stderrTruncated = true;
      stderr = Buffer.concat([stderr, bytes.subarray(0, Math.max(0, remaining))]);
    });
    const output = frames(child.stdout);
    ready = await output.next(timeoutMs); validateReady(ready);
    assert.equal(ready.processId, child.pid, "Ready receipt does not identify the owned child");
    revision = ready.revision; await record("ready", ready);
    for (const step of steps) {
      for (let query = 0; ; query++) {
        const action = validateAction(typeof step.action === "function"
          ? step.action({ ready: structuredClone(ready), revision, lastResponse: structuredClone(lastResponse) })
          : step.action);
        const mutation = step.mutation ?? !["catalogue", "snapshot", "get", "validate", "cancel"].includes(action.kind);
        const request = { schema: "affect-research-planner-command", version: 1, sessionId: ready.sessionId,
          requestId: randomUUID(), expectedRevision: mutation ? revision : null, action };
        const line = `${JSON.stringify(request)}\n`;
        assert.ok(Buffer.byteLength(line) <= MAX_FRAME, "Command exceeds native JSONL frame bound");
        await record("request", request);
        await deadline(new Promise((resolveWrite, rejectWrite) => child.stdin.write(line, error => error ? rejectWrite(error) : resolveWrite())), timeoutMs, "CLI input stalled; outcome may be unknown");
        const result = await output.next(timeoutMs);
        await record("response", result);
        validateResponse(result, request, revision);
        // Preserve valid observed state even if the semantic review below fails.
        revision = result.revision; lastResponse = result;
        if (step.expectStatus) assert.equal(result.status, step.expectStatus, "Unexpected CLI result status");
        else assert.ok(["ok", "applied", "incomplete"].includes(result.status), `CLI command ${action.kind} returned ${result.status}`);
        if (step.checkResponse) assert.equal(step.checkResponse({ request: structuredClone(request), response: structuredClone(result) }), undefined,
          "Response check must assert synchronously without returning a value");
        if (!step.until) break;
        const settled = step.until(structuredClone(result));
        assert.equal(typeof settled, "boolean", "Readiness predicate must return a boolean");
        if (settled) break;
        assert.ok(query + 1 < step.maxQueries, "Readiness query bound exhausted; no mutation was retried");
        await new Promise(resolveWait => setTimeout(resolveWait, step.queryIntervalMs));
      }
      completed++;
    }
    child.stdin.end();
    exit = await deadline(exitPromise, timeoutMs, "CLI did not drain and exit after EOF");
    output.assertDrained(); assert.equal(exit.code, 0, "Owned CLI did not exit successfully");
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
    if (child && exitPromise) {
      // EOF lets the production broker drain and its native coordinator join.
      // Never send another command or turn a clean exit into a successful run.
      failureCleanup = { eofRequested: child.stdin.writableEnded, gracePeriodMs: Math.min(timeoutMs, 10000),
        graceExpired: false, forcedTerminationRequested: false, terminationSignalSent: null, terminationError: null };
      const alive = () => child.pid && child.exitCode === null && child.signalCode === null;
      if (alive() && !child.stdin.destroyed && !child.stdin.writableEnded) {
        try { child.stdin.end(); failureCleanup.eofRequested = true; }
        catch { /* The exit observation below still decides whether cleanup finished. */ }
      }
      try { exit = await deadline(exitPromise, failureCleanup.gracePeriodMs, "Owned CLI EOF cleanup deadline elapsed"); }
      catch {
        failureCleanup.graceExpired = true;
        // External diagnostic cleanup of this exact owned child only. This is
        // forced termination, never evidence of orderly native shutdown.
        if (alive()) {
          failureCleanup.forcedTerminationRequested = true;
          try { failureCleanup.terminationSignalSent = child.kill(); }
          catch { failureCleanup.terminationError = "owned-child-termination-request-failed"; }
        }
        exit = await deadline(exitPromise, 10000, "Owned CLI shutdown unconfirmed")
          .catch(error => ({ code: null, signal: null, error: error.message }));
      }
    }
  } finally {
    await transcript.close();
    await writeFile(join(outputDirectory, "stderr.log"), stderr, { flag: "wx" });
  }
  const receipt = { schema: "affect-research-planner-cli-driver-receipt", version: 1,
    executable, executableSha256, args, ready, completedSteps: completed, requestedSteps: steps.length,
    finalRevision: revision, exit, passed: failed === null, failure: failed, failureCleanup, stderrTruncated,
    transcriptSha256: hash(await readFile(join(outputDirectory, "transcript.jsonl"))),
    limitation: "Driver transport receipt only. Inspect commands, exact saved artifacts, UI parity and Runner observations separately." };
  await writeFile(join(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [executable, actionPath, outputDirectory, ...extra] = process.argv.slice(2);
    assert.ok(executable && actionPath && outputDirectory && !extra.length,
      "Usage: planner-cli-driver.mjs <CLI.exe> <actions.json> <new-evidence-directory>");
    assert.ok((await stat(actionPath)).size <= MAX_FRAME, "Action script exceeds 16 MiB");
    const steps = JSON.parse(await readFile(actionPath, "utf8"));
    const receipt = await runPlannerCli({ executable, steps, outputDirectory });
    console.log(JSON.stringify(receipt));
    process.exitCode = receipt.passed ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

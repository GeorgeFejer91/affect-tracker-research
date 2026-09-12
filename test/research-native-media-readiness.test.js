import test from "node:test";
import assert from "node:assert/strict";
import { waitForNativeMediaReadiness } from "../site/src/research/native-media-readiness.js";

const ready = { runtimeIntegrityVerified: true, playerActorReady: true, qualifiedStartAvailable: false };
test("startup observes both pending phases and returns exact unqualified ready capability", async () => {
  const values = [{ reasonCode: "native-runtime-verification-pending" },
    { reasonCode: "native-gstplay-startup-pending" }, ready];
  let reads = 0;
  assert.equal(await waitForNativeMediaReadiness({ readCapability: async () => values[reads++] }), ready);
  assert.equal(reads, 3);
  assert.equal(ready.qualifiedStartAvailable, false);
});
test("terminal capability does not retry", async () => {
  let reads = 0;
  await assert.rejects(waitForNativeMediaReadiness({ readCapability: async () => {
    reads++; return { reasonCode: "native-runtime-missing", runtimeIntegrityVerified: false, playerActorReady: true };
  } }), /unavailable/u);
  assert.equal(reads, 1);
});
test("expired deadline and canceled guards never query capability", async () => {
  const readCapability = () => assert.fail("unexpected RPC");
  await assert.rejects(waitForNativeMediaReadiness({ readCapability, deadline: 0 }), /timed out/u);
  await assert.rejects(waitForNativeMediaReadiness({ readCapability, isCurrent: () => false }), /canceled/u);
});
test("stalled capability RPC is bounded and later readiness cannot be adopted", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await assert.rejects(waitForNativeMediaReadiness({ readCapability: () => pending,
    deadline: performance.now() + 20 }), /timed out/u);
  release(ready);
});
test("abort and disposal interrupt a pending capability RPC", async () => {
  const controller = new AbortController();
  const canceled = waitForNativeMediaReadiness({ readCapability: () => new Promise(() => {}), signal: controller.signal });
  controller.abort();
  await assert.rejects(canceled, /canceled/u);
  let current = true;
  const disposed = waitForNativeMediaReadiness({ readCapability: () => new Promise(() => {}), isCurrent: () => current });
  current = false;
  await assert.rejects(disposed, /canceled/u);
});
test("deadline remains absolute across pending observations", async () => {
  let clock = 0, reads = 0;
  await assert.rejects(waitForNativeMediaReadiness({ deadline: 10, now: () => clock,
    readCapability: async () => { reads++; clock = 11; return { reasonCode: "native-gstplay-startup-pending" }; },
  }), /timed out/u);
  assert.equal(reads, 1);
});

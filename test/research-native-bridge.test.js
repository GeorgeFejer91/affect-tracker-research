import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  NativeResearchRuntimeBridge,
  nativeInputBindingSupported,
  nativeInputPresetAvailability,
  nativeInputRegionRequest,
  probeAndAttestNativeVideo,
} from "../site/src/research/native-bridge.js";
import { createInputBindingPreset } from "../site/src/research/contracts.js";
import { RESEARCH_UI_EVENTS } from "../site/src/research/ui-contracts.js";
import { requestPlannerFile, PLANNER_LOAD_REQUEST, PLANNER_SAVE_REQUEST } from "../site/src/research/planner-file-request.js";

test("Planner native file requests acknowledge exact results without rescanning media or invoking Runner", async () => {
  const root = new EventTarget(), win = new EventTarget(), calls = [];
  root.dataset = { researchProgram: "planner" }; root.querySelector = () => null; root.researchUi = {};
  let response = { kind: "planner-recipe-v1", document: { canonicalSourceText: "strict adapter fixture" } }, fail = false;
  const bridge = new NativeResearchRuntimeBridge(root, { windowObject: win,
    setIntervalObject: () => 1, clearIntervalObject: () => {}, invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "research_desktop_identity") return { schema: "affect-research-desktop-identity", version: 1, program: "planner" };
      if (command === "research_input_capability") return { nativeAuthorityReady: false, supportedPresets: [] };
      if (["research_load_planner_recipe", "research_save_planner_recipe"].includes(command)) {
        if (fail) throw Error("selected file failed");
        return response;
      }
      return {};
    } });
  await bridge.initialize(); calls.length = 0;
  assert.deepEqual(await requestPlannerFile(root, PLANNER_LOAD_REQUEST), response);
  assert.deepEqual(calls.map(item => item.command), ["research_load_planner_recipe"]);
  response = { acknowledged: "transport fixture; full workflow validates its exact receipt" };
  assert.deepEqual(await requestPlannerFile(root, PLANNER_SAVE_REQUEST, { sourceText: "exact source" }), response);
  assert.deepEqual(calls.at(-1), { command: "research_save_planner_recipe", payload: { sourceText: "exact source" } });
  response = null; assert.equal(await requestPlannerFile(root, PLANNER_LOAD_REQUEST), null);
  fail = true; await assert.rejects(requestPlannerFile(root, PLANNER_SAVE_REQUEST, { sourceText: "exact source" }), /selected file failed/u);
  const count = calls.length;
  bridge.plannerOnly = false;
  await assert.rejects(requestPlannerFile(root, PLANNER_SAVE_REQUEST, { sourceText: "exact source" }), /Experiment Planner/u);
  assert.equal(calls.length, count);
  bridge.plannerOnly = true; bridge.destroy();
});

test("Planner startup adopts an existing workspace and may rescan through HTML video readiness", async () => {
  const root = new EventTarget(), win = new EventTarget(), calls = [];
  const status = { textContent: "", hidden: true, scrollIntoView() {} };
  let connector = null;
  root.dataset = { researchProgram: "planner" };
  root.querySelector = selector => {
    if (selector === "#planner-status") return status;
    if (selector === "#native-playback-mode") return { value: "unqualifiedWebview" };
    return null;
  };
  root.researchUi = {
    settings: { stimuli: { items: [] } },
    applyNativeInputStatus() {},
    connectPlannerNativeWorkspace(value) { connector = value; },
  };
  const workspace = {
    selected: true,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    displayName: "Saved Planner workspace",
    librariesReady: true,
  };
  const bridge = new NativeResearchRuntimeBridge(root, {
    windowObject: win,
    setIntervalObject: () => 1,
    clearIntervalObject: () => {},
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "research_desktop_identity") return { schema: "affect-research-desktop-identity", version: 1, program: "planner" };
      if (command === "research_workspace_status") return workspace;
      if (command === "research_source_capabilities") return {};
      if (command === "research_input_capability") return { nativeAuthorityReady: false, supportedPresets: [] };
      if (command === "research_input_status") return {};
      if (command === "research_rescan_stimuli") return { workspaceId: workspace.workspaceId, stimuli: [] };
      throw new Error(`Unexpected command ${command}`);
    },
  });
  await bridge.initialize();
  assert.equal(connector.getWorkspaceId(), workspace.workspaceId);
  assert.doesNotMatch(status.textContent, /Native media startup is unavailable/u);
  assert.equal(calls.some(({ command }) => command === "research_rescan_stimuli"), true);
  bridge.destroy();
});

test("native capture fences cancelled, rearmed, rejected and delayed results", async () => {
  const root = new EventTarget(), win = new EventTarget(), projected = [], captures = [], calls = [], polls = [];
  root.dataset = { researchProgram: "planner" };
  const binding = createInputBindingPreset("arrowKeys");
  const grid = { getBoundingClientRect: () => ({left:0,top:0,right:100,bottom:100,width:100,height:100}), getClientRects: () => [1] };
  root.ownerDocument = {activeElement:grid};
  root.querySelector = selector => selector === ".input-test-grid" || selector.includes(".dialog-content") ? grid : null;
  root.researchUi = { inputBinding:binding, applyNativeInputStatus: s => projected.push(s), applyNativeCapture: c => { captures.push(c); return c.captureId !== "rejected"; } };
  win.innerWidth = 800; win.innerHeight = 600;
  let deferredStatus = null, deferredBegin = null;
  const bridge = new NativeResearchRuntimeBridge(root, {windowObject:win,setIntervalObject:fn=>{polls.push(fn);return polls.length;},clearIntervalObject:()=>{},invoke:async(command, payload)=>{
    calls.push([command,payload]);
    if(command === "research_desktop_identity") return {schema:"affect-research-desktop-identity",version:1,program:"planner"};
    if(command === "research_workspace_status") return {selected:false};
    if(command === "research_input_capability") return {nativeAuthorityReady:true,supportsCustomKeyboard:true,supportedPresets:["arrowKeys","custom"]};
    if(command === "research_input_status") return deferredStatus ? deferredStatus.promise : {};
    if(command === "research_input_begin_capture") return deferredBegin ? deferredBegin.promise : {};
    return {};
  }});
  await bridge.initialize();
  const arm=()=>root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputCaptureRequest,{detail:{binding,direction:"left"}}));
  const cancel=()=>root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputCaptureCancel));
  const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await bridge.operation;};
  const poll=()=>polls.at(-1)();
  arm();await bridge.operation;
  assert.equal(bridge.activeInputCaptureGeneration,bridge.inputCaptureGeneration);
  deferredStatus=deferred();poll();
  cancel();arm();await bridge.operation;
  const before=projected.length;
  deferredStatus.resolve({capture:{captureId:"old",direction:"left",binding}});await flush();
  assert.equal(projected.length,before);assert.equal(captures.length,0);assert.equal(calls.filter(([c])=>c==="research_input_begin_test").length,0);
  deferredStatus=deferred();poll();deferredStatus.resolve({capture:{captureId:"current",direction:"left",binding}});await flush();
  assert.deepEqual(captures.map(c=>c.captureId),["current"]);
  assert.equal(calls.filter(([c])=>c==="research_input_begin_test").length,1);
  arm();await bridge.operation;deferredStatus=deferred();poll();deferredStatus.resolve({capture:{captureId:"rejected",direction:"left",binding}});await flush();
  assert.equal(calls.filter(([c])=>c==="research_input_begin_test").length,1,"UI rejection must not reconfigure native test");
  deferredBegin=deferred();arm();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(bridge.activeInputCaptureGeneration,null,"not active before begin acknowledgment");
  cancel();arm();const oldBegin=deferredBegin;deferredBegin=null;oldBegin.reject(new Error("stale begin failure"));await flush();
  assert.equal(bridge.activeInputCaptureGeneration,bridge.inputCaptureGeneration,"old failure cannot clear rearmed capture");
  deferredStatus=deferred();poll();cancel();await bridge.operation;const finalCount=projected.length;
  deferredStatus.resolve({capture:{captureId:"cancelled",direction:"left",binding}});await flush();
  assert.equal(projected.length,finalCount);assert.equal(captures.length,2);
  bridge.destroy();
});

test("Tauri projects each native input preset through explicit backend capabilities", () => {
  const capability = {
    nativeAuthorityReady: true,
    supportedPresets: [
      "arrowKeys", "wasd", "ijkl", "numpad", "pointerGrid", "mouseButtonsWheel",
      "gamepadDpad", "gamepadLeftStick", "gamepadRightStick", "custom",
    ],
    supportsCustomKeyboard: true,
    supportsCustomMouseButtons: true,
    supportsCustomWheel: true,
    supportsCustomGamepadButtons: true,
    supportsAbsolutePointer: true,
    supportsGamepad: true,
  };
  const availability = nativeInputPresetAvailability(capability);
  assert.equal(availability["arrow-keys"], true);
  assert.equal(availability["pointer-grid"], true);
  assert.equal(availability["gamepad-dpad"], true);

  const pointer = {
    preset: "pointerGrid", kind: "absolute",
    axes: {
      x: { kind: "pointerAxis", axis: "x", invert: false },
      y: { kind: "pointerAxis", axis: "y", invert: true },
    },
  };
  const dpad = {
    preset: "gamepadDpad", kind: "digital",
    directions: {
      up: { kind: "gamepadButton", button: 12 },
      down: { kind: "gamepadButton", button: 13 },
      left: { kind: "gamepadButton", button: 14 },
      right: { kind: "gamepadButton", button: 15 },
    },
  };
  const leftStick = {
    preset: "gamepadLeftStick", kind: "analog",
    axes: {
      x: { kind: "gamepadAxis", index: 0, invert: false },
      y: { kind: "gamepadAxis", index: 1, invert: true },
    },
  };
  const rightStick = {
    ...leftStick,
    preset: "gamepadRightStick",
    axes: {
      x: { kind: "gamepadAxis", index: 2, invert: false },
      y: { kind: "gamepadAxis", index: 3, invert: true },
    },
  };
  const mixedCustom = {
    preset: "custom", kind: "digital",
    directions: {
      up: { kind: "keyboard", code: "KeyW" },
      down: { kind: "mouseButton", button: 0 },
      left: { kind: "wheel", direction: "left" },
      right: { kind: "gamepadButton", button: 0 },
    },
  };
  for (const binding of [pointer, dpad, leftStick, rightStick, mixedCustom]) {
    assert.equal(nativeInputBindingSupported(binding, capability), true);
  }
  assert.equal(nativeInputBindingSupported(pointer, {
    ...capability, supportsAbsolutePointer: false,
  }), false);
  assert.equal(nativeInputBindingSupported(leftStick, {
    ...capability, supportsGamepad: false,
  }), false);
  assert.equal(nativeInputBindingSupported(dpad, {
    ...capability, supportsCustomGamepadButtons: false,
  }), false);
  assert.equal(nativeInputBindingSupported(mixedCustom, {
    ...capability, supportsCustomWheel: false,
  }), false);
  assert.equal(nativeInputBindingSupported({
    ...dpad, directions: { ...dpad.directions, right: undefined },
  }, capability), false);
});

test("native input regions remain bounded to visible client coordinates", () => {
  assert.deepEqual(nativeInputRegionRequest({
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 220, width: 100, height: 200 }),
  }, "runFeedback", 7, { innerWidth: 800, innerHeight: 600 }), {
    purpose: "runFeedback", layoutEpoch: 7, left: 10, top: 20, width: 100, height: 200,
    viewportWidth: 800, viewportHeight: 600,
  });
});

class ProbeVideo extends EventTarget {
  constructor() {
    super();
    this.duration = 12.5;
    this.videoWidth = 1_920;
    this.videoHeight = 1_080;
    this._currentTime = 0;
    this.paused = true;
    this.seeks = [];
    this.decodedFrames = [];
  }

  get currentTime() { return this._currentTime; }

  set currentTime(value) {
    this._currentTime = value;
    this.seeks.push(value);
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  }

  load() {
    if (!this.src) return;
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }

  async play() {
    this.paused = false;
  }

  pause() { this.paused = true; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  requestVideoFrameCallback(callback) {
    const mediaTime = this.currentTime;
    this.decodedFrames.push(mediaTime);
    queueMicrotask(() => callback(0, { mediaTime }));
    return this.decodedFrames.length;
  }
}

test("native WebView attestation requires near-start, midpoint, and near-end decoded frames", async () => {
  const calls = [];
  const verified = {
    workspaceFileId: "file-opaque-1",
    displayName: "Complete Video.mp4",
    sha256: "a".repeat(64),
    byteLength: 4_096,
    mimeType: "video/mp4",
    durationMs: 12_500,
    decodeStatus: "attestedUnqualified",
    decodeBackend: "webviewVideoFrameCallback",
    decodeAttestation: "representativeFramesV1",
    decodedPositionsMs: [250, 6_250, 12_250],
    source: {
      kind: "workspaceFile",
      relativePath: "stimuli/.workspace/file-opaque-1",
      mimeType: "video/mp4",
      sha256: "a".repeat(64),
      byteLength: 4_096,
      durationMs: 12_500,
    },
  };
  let clock = 100;
  const result = await probeAndAttestNativeVideo({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    summary: {
      ...verified,
      durationMs: null,
      decodeStatus: "unverified",
      decodeBackend: null,
      decodeAttestation: null,
      decodedPositionsMs: [],
      source: null,
    },
    videoFactory: () => new ProbeVideo(),
    performanceNow: () => { clock += 100; return clock; },
    async invoke(command, payload) {
      calls.push([command, structuredClone(payload)]);
      if (command === "research_workspace_media_url") {
        return {
          mediaGrantId: "grant-opaque-1",
          workspaceFileId: "file-opaque-1",
          mediaUrl: "http://research-media.localhost/grant-opaque-1",
          byteLength: 4_096,
          mimeType: "video/mp4",
          durationMs: null,
          decodeStatus: "unverified",
          decodeBackend: null,
          decodeAttestation: null,
          decodedPositionsMs: [],
        };
      }
      if (command === "research_attest_workspace_decode") return verified;
      throw new Error(`Unexpected command ${command}`);
    },
  });
  assert.deepEqual(result, verified);
  assert.deepEqual(calls.map(([command]) => command), [
    "research_workspace_media_url",
    "research_attest_workspace_decode",
  ]);
  const attestation = calls[1][1].attestation;
  assert.equal(attestation.attestationKind, "attestRepresentativeFramesV1");
  assert.equal(attestation.decodeBackend, "webviewVideoFrameCallback");
  assert.equal(attestation.observedDurationMs, 12_500);
  assert.equal(attestation.videoWidth, 1_920);
  assert.equal(attestation.videoHeight, 1_080);
  assert.ok(attestation.mutedPlaybackMs >= 50);
  assert.deepEqual(attestation.decodedPositionsMs, [250, 6_250, 12_250]);
  assert.equal("path" in attestation, false);
  assert.equal("relativePath" in attestation, false);
});

test("native metadata and seeking cannot pass without frame callbacks, and the grant is revoked", async () => {
  const video = new ProbeVideo();
  video.requestVideoFrameCallback = undefined;
  const calls = [];
  const summary = {
    workspaceFileId: "file-opaque-2",
    displayName: "Metadata Only.mp4",
    sha256: "b".repeat(64),
    byteLength: 2_048,
    mimeType: "video/mp4",
    durationMs: null,
    decodeStatus: "unverified",
    decodeBackend: null,
    decodeAttestation: null,
    decodedPositionsMs: [],
    source: null,
  };
  await assert.rejects(probeAndAttestNativeVideo({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    summary,
    videoFactory: () => video,
    probeTimeoutMs: 25,
    async invoke(command, payload) {
      calls.push([command, structuredClone(payload)]);
      if (command === "research_workspace_media_url") {
        return {
          mediaGrantId: "grant-opaque-2",
          workspaceFileId: summary.workspaceFileId,
          mediaUrl: "http://research-media.localhost/grant-opaque-2",
          byteLength: summary.byteLength,
          mimeType: summary.mimeType,
          durationMs: null,
          decodeStatus: "unverified",
          decodeBackend: null,
          decodeAttestation: null,
          decodedPositionsMs: [],
        };
      }
      if (command === "research_attest_workspace_decode") return summary;
      throw new Error(`Unexpected command ${command}`);
    },
  }), /Decoded-frame verification requires desktop Chrome or Edge/u);
  assert.deepEqual(calls.map(([command]) => command), [
    "research_workspace_media_url",
    "research_attest_workspace_decode",
  ]);
  assert.deepEqual(calls[1][1].attestation, {
    attestationKind: "revokeGrant",
    decodeBackend: "webviewVideoFrameCallback",
    workspaceId: "11111111-1111-4111-8111-111111111111",
    mediaGrantId: "grant-opaque-2",
    workspaceFileId: summary.workspaceFileId,
    sha256: summary.sha256,
    byteLength: summary.byteLength,
    mimeType: summary.mimeType,
  });
});

test("desktop Planner entrypoint loads only its native authoring bridge", async () => {
  const [html, entrySource, bridgeSource] = await Promise.all([
    readFile(new URL("../desktop/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/src/research/native-entry.js", import.meta.url), "utf8"),
    readFile(new URL("../site/src/research/native-bridge.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /src="\.\.\/site\/src\/research\/native-entry\.js"/u);
  assert.match(entrySource, /initializeRuntime: bootNativeBridge/u);
  for (const command of [
    "research_choose_workspace", "research_open_workspace_location",
    "research_import_stimuli", "research_rescan_stimuli",
    "research_workspace_media_url", "research_attest_workspace_decode",
    "research_store_questionnaire_asset", "research_save_planner_recipe",
    "research_input_begin_capture",
  ]) assert.match(bridgeSource, new RegExp('"' + command + '"', "u"));
  assert.match(bridgeSource, /const decodeQualification = "attestedUnqualified"/u);
});

const preparedWorkspaceId = "11111111-1111-4111-8111-111111111111";
function preparedWorkspaceReceipt(workspaceId = preparedWorkspaceId) {
  return { selected: true, workspaceId, displayName: "Synthetic workspace", namespace: "research",
    stimuliCount: 0, librariesReady: true };
}
function preparedScanSummary(name = "one") {
  return { workspaceFileId: name, displayName: `${name}.mp4`, sha256: "a".repeat(64), byteLength: 10,
    mimeType: "video/mp4", durationMs: 1000, decodeStatus: "unverified", source: null };
}
async function preparedBridgeFixture() {
  const root = new EventTarget(), win = new EventTarget(), events = [], calls = [];
  const progress = { textContent: "unchanged" };
  let connector, scan = { workspaceId: preparedWorkspaceId, stimuli: [preparedScanSummary()] };
  const verifiedSummary = (summary) => ({
    ...summary,
    durationMs: summary.durationMs ?? 1000,
    decodeStatus: "attestedUnqualified",
    decodeBackend: "webviewVideoFrameCallback",
    decodeAttestation: "representativeFramesV1",
    decodedPositionsMs: [20, 500, 980],
    source: {
      kind: "workspaceFile",
      relativePath: `stimuli/${summary.displayName}`,
      mimeType: summary.mimeType,
      sha256: summary.sha256,
      byteLength: summary.byteLength,
      durationMs: summary.durationMs ?? 1000,
    },
  });
  root.dataset = { researchProgram: "planner" };
  root.querySelector = selector => selector === "#workspace-status" ? progress : null;
  root.researchUi = { settings: { stimuli: { items: [] } }, connectPlannerNativeWorkspace: value => { connector = value; } };
  for (const name of [RESEARCH_UI_EVENTS.workspaceReady, RESEARCH_UI_EVENTS.stimuliCatalogued]) {
    root.addEventListener(name, event => events.push({ type: name, detail: structuredClone(event.detail) }));
  }
  const bridge = new NativeResearchRuntimeBridge(root, { windowObject: win,
    setIntervalObject: () => 1, clearIntervalObject: () => {}, invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === "research_desktop_identity") return { schema: "affect-research-desktop-identity", version: 1, program: "planner" };
      if (command === "research_input_capability") return { nativeAuthorityReady: false, supportedPresets: [] };
      if (command === "research_rescan_stimuli") return structuredClone(scan);
      if (command === "research_workspace_media_url") {
        return {
          mediaGrantId: `grant-${payload.workspaceFileId}`,
          workspaceFileId: payload.workspaceFileId,
          mediaUrl: `http://research-media.localhost/${payload.workspaceFileId}`,
          byteLength: payload.byteLength,
          mimeType: payload.mimeType,
          durationMs: null,
          decodeStatus: "unverified",
          decodeBackend: null,
          decodeAttestation: null,
          decodedPositionsMs: [],
        };
      }
      if (command === "research_attest_workspace_decode") {
        const summary = scan.stimuli.find(item => item.workspaceFileId === payload.attestation.workspaceFileId)
          ?? preparedScanSummary(payload.attestation.workspaceFileId);
        return verifiedSummary(summary);
      }
      return {};
    },
    videoFactory: () => new ProbeVideo(),
  });
  await bridge.initialize();
  return { root, bridge, connector, events, calls, progress, scan,
    setScan: value => { scan = value; } };
}

test("Planner connector prepares detached workspace data and commits without events or rescans", async () => {
  const f = await preparedBridgeFixture();
  assert.deepEqual(Object.keys(f.connector).sort(), ["getWorkspaceId", "prepareCatalogue", "prepareWorkspace"]);
  assert.equal(f.connector.getWorkspaceId(), null);
  const receipt = preparedWorkspaceReceipt(), count = f.calls.length;
  const prepared = f.connector.prepareWorkspace(receipt);
  receipt.displayName = "Changed caller data";
  prepared.projection.label = "Changed projection copy";
  assert.equal(prepared.projection.label, "Synthetic workspace");
  assert.equal(f.bridge.workspace, null); assert.equal(f.events.length, 0); assert.equal(f.calls.length, count);
  assert.equal(prepared.commit(), undefined);
  assert.equal(f.connector.getWorkspaceId(), preparedWorkspaceId);
  assert.equal(f.bridge.workspace.displayName, "Synthetic workspace");
  assert.equal(f.events.length, 0); assert.equal(f.calls.length, count);
  assert.throws(() => prepared.commit(), /stale|already committed/u);
  assert.throws(() => f.connector.prepareWorkspace({ ...receipt, librariesReady: false }), /libraries/u);
  assert.throws(() => f.connector.prepareWorkspace({ ...receipt, workspaceId: "not-a-uuid" }), /libraries/u);
  f.bridge.destroy(); assert.equal(f.connector.getWorkspaceId(), null);
});

test("prepared catalogue uses existing sequential authority without early state/events/progress", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  const original = f.bridge.catalog;
  const prepared = await f.connector.prepareCatalogue(f.scan, { isCurrent: () => true });
  assert.equal(f.bridge.catalog, original); assert.equal(original.size, 0);
  assert.equal(f.events.length, 0); assert.equal(f.progress.textContent, "unchanged");
  assert.deepEqual(f.calls.slice(-2).map(({ command }) => command), ["research_workspace_media_url", "research_attest_workspace_decode"]);
  const projection = prepared.projection;
  projection.items[0].stimulus.title = "Mutated copy";
  assert.equal(prepared.projection.items[0].stimulus.title, "one.mp4");
  prepared.commit();
  assert.equal(f.bridge.catalog.get("one").stimulus.title, "one.mp4");
  assert.equal(f.events.length, 0); assert.equal(f.progress.textContent, "unchanged");
  assert.throws(() => prepared.commit(), /stale|already committed/u);
  f.bridge.destroy();
});

test("prepared catalogue guards caller, workspace, settings, newer catalogue and destruction", async () => {
  for (const change of ["caller", "workspace", "settings", "catalogue", "destroy"]) {
    const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
    let current = true;
    const prepared = await f.connector.prepareCatalogue(f.scan, { isCurrent: () => current });
    if (change === "caller") current = false;
    if (change === "workspace") f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
    if (change === "settings") f.root.researchUi.settings.stimuli.items.push({ stimulusId: "new", source: { relativePath: "new.mp4" } });
    if (change === "catalogue") (await f.connector.prepareCatalogue({ workspaceId: preparedWorkspaceId, stimuli: [] })).commit();
    if (change === "destroy") f.bridge.destroy();
    const catalogue = f.bridge.catalog;
    assert.equal(prepared.isCurrent(), false, change);
    assert.throws(() => prepared.commit(), /stale/u, change);
    assert.equal(f.bridge.catalog, catalogue); assert.equal(f.events.length, 0);
    if (change !== "destroy") f.bridge.destroy();
  }
});

test("workspace prepare is canceled by a later bridge publication or caller lifetime", async () => {
  const f = await preparedBridgeFixture();
  let current = true;
  const canceled = f.connector.prepareWorkspace(preparedWorkspaceReceipt(), { isCurrent: () => current });
  current = false; assert.throws(() => canceled.commit(), /stale/u); assert.equal(f.bridge.workspace, null);
  const old = f.connector.prepareWorkspace(preparedWorkspaceReceipt());
  f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
  assert.throws(() => old.commit(), /stale/u);
  f.bridge.destroy();
});

test("a canceled pending HTML probe cannot publish or change progress", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  let entered, resume, current = true;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { resume = resolve; });
  const invoke = f.bridge.invoke;
  f.bridge.invoke = async (command, payload) => {
    if (command === "research_workspace_media_url") { entered(); await pending; }
    return invoke(command, payload);
  };
  const work = f.connector.prepareCatalogue(f.scan, { isCurrent: () => current });
  await started; current = false; resume();
  await assert.rejects(work, /stale/u);
  assert.equal(f.bridge.catalog.size, 0); assert.equal(f.events.length, 0);
  assert.equal(f.progress.textContent, "unchanged");
  f.bridge.destroy();
});

test("failed or duplicate catalogue preparation never partially accepts verified entries", async () => {
  for (const failure of ["decode", "duplicate"]) {
    const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
    const original = f.bridge.catalog;
    const invoke = f.bridge.invoke;
    if (failure === "decode") f.bridge.invoke = async (command, payload) => {
      if (command === "research_attest_workspace_decode" && payload.attestation.workspaceFileId === "two") {
        throw Error("Synthetic decode failure");
      }
      return invoke(command, payload);
    };
    await assert.rejects(f.connector.prepareCatalogue({ workspaceId: preparedWorkspaceId,
      stimuli: [preparedScanSummary(), preparedScanSummary(failure === "decode" ? "two" : "one")] }), /failed/u);
    assert.equal(f.bridge.catalog, original); assert.equal(original.size, 0); assert.equal(f.events.length, 0);
    f.bridge.destroy();
  }
});

test("Planner GUI scan reuses preparation, projects after commit and withdraws on a current failure", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  f.root.id = "native-playback-mode";
  f.root.dispatchEvent(new Event("change")); await f.bridge.operation;
  assert.equal(f.events.length, 1); assert.equal(f.events[0].detail.items.length, 1);
  assert.equal(f.bridge.catalog.size, 1); assert.equal(f.progress.textContent, "unchanged");
  const invoke = f.bridge.invoke;
  f.bridge.invoke = async (command, payload) => {
    if (command === "research_attest_workspace_decode") throw Error("Synthetic decode failure");
    return invoke(command, payload);
  };
  f.root.dispatchEvent(new Event("change")); await f.bridge.operation;
  assert.equal(f.bridge.catalog.size, 0); assert.deepEqual(f.events.at(-1).detail, { items: [], replace: true });
  f.bridge.destroy();
});

test("a late GUI scan cannot erase a newly selected workspace catalogue", async () => {
  const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
  let entered, resume;
  const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { resume = resolve; });
  const invoke = f.bridge.invoke;
  f.bridge.invoke = async (command, payload) => {
    if (command === "research_workspace_media_url") { entered(); await pending; }
    return invoke(command, payload);
  };
  f.root.id = "native-playback-mode"; f.root.dispatchEvent(new Event("change"));
  await started;
  f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
  const catalogue = f.bridge.catalog;
  resume(); await f.bridge.operation;
  assert.equal(f.bridge.catalog, catalogue); assert.equal(f.events.length, 0);
  f.bridge.destroy();
});

test("native scan receipts are fenced before awaiting I/O, including same-workspace newer publication", async () => {
  for (const changeWorkspace of [false, true]) {
    const f = await preparedBridgeFixture(); f.connector.prepareWorkspace(preparedWorkspaceReceipt()).commit();
    let entered, resume;
    const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { resume = resolve; });
    const invoke = f.bridge.invoke;
    f.bridge.invoke = async (command, payload) => {
      if (command === "research_rescan_stimuli") { entered(); return pending; }
      return invoke(command, payload);
    };
    f.root.id = "native-playback-mode"; f.root.dispatchEvent(new Event("change")); await started;
    if (changeWorkspace) f.connector.prepareWorkspace(preparedWorkspaceReceipt("22222222-2222-4222-8222-222222222222")).commit();
    const id = f.connector.getWorkspaceId();
    (await f.connector.prepareCatalogue({ workspaceId: id, stimuli: [preparedScanSummary("newer")] })).commit();
    const currentCatalogue = f.bridge.catalog;
    resume(f.scan); await f.bridge.operation;
    assert.equal(f.bridge.catalog, currentCatalogue); assert.ok(currentCatalogue.has("newer"));
    assert.equal(f.events.length, 0);
    f.bridge.destroy();
  }
});

import { sha256Hex } from "../../site/src/research/canonical.js";
import { plannerRecipeTransportText } from "../../site/src/research/planner-recipe-transport.js";
import { readRunnerRecipe, resolveRunnerSelection } from "./recipe.js";

const encoder = new TextEncoder();
const WORKSPACE_ID_KEY = "affect-runner-browser-workspace-id";
const RECENT_KEY = "affect-runner-browser-recent-recipes-v1";

function randomId(prefix = "") {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}${uuid}`;
}

function memoryFilePicker(windowObject) {
  const document = windowObject.document;
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.position = "fixed";
    input.style.inlineSize = "1px";
    input.style.blockSize = "1px";
    input.style.opacity = "0";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    document.body.append(input);
    input.click();
    windowObject.setTimeout(() => input.remove(), 0);
  });
}

function storageRead(windowObject, key, fallback) {
  try {
    return JSON.parse(windowObject.localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function storageWrite(windowObject, key, value) {
  try {
    windowObject.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Recent-file history is a convenience, not run evidence. */
  }
}

async function recipeFromFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readRunnerRecipe(bytes);
}

async function fileFromDirectory(directory, parts) {
  let handle = directory;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || part === "." || part === "..") throw new Error("The JSON media path is not portable.");
    handle = index === parts.length - 1
      ? await handle.getFileHandle(part)
      : await handle.getDirectoryHandle(part);
  }
  return handle.getFile();
}

async function workspaceFile(directory, relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\/+/u, "");
  const candidates = [normalized];
  if (normalized.startsWith("assets/")) candidates.push(normalized.slice("assets/".length));
  if (normalized.startsWith("stimuli/")) candidates.push(`assets/${normalized}`);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await fileFromDirectory(directory, candidate.split("/"));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Choose the project folder that contains ${normalized}. ${lastError?.message ?? ""}`.trim());
}

function participantIdFromRequest(args) {
  return args?.participantId ?? args?.request?.participantId ?? null;
}

function variantRows(receipt) {
  return (receipt?.recipe?.segments.P3.variants ?? []).map((variant) => ({
    variantId: variant.variantId,
    recordingCount: 0,
    participantCount: 0,
  }));
}

export function createBrowserRunnerInvoke({ windowObject = window } = {}) {
  let workspaceHandle = null;
  let workspaceId = storageRead(windowObject, WORKSPACE_ID_KEY, null) ?? randomId();
  let workspaceName = "";
  let currentDocument = null;
  const recent = storageRead(windowObject, RECENT_KEY, []);
  const objectUrls = new Set();

  const workspaceStatus = () => Object.freeze({
    schema: "affect-runner-browser-workspace",
    version: 1,
    selected: Boolean(workspaceHandle),
    workspaceId,
    displayName: workspaceHandle ? `${workspaceName || "Browser project folder"} (browser)` : "No project folder selected.",
  });

  const remember = (receipt, fileName = "experiment.json") => {
    const entryId = `recent-${receipt.canonicalSourceByteSha256}`;
    const next = [
      { id: entryId, basename: fileName, folderName: "Browser", available: false },
      ...recent.filter((item) => item.id !== entryId),
    ].slice(0, 12);
    recent.splice(0, recent.length, ...next);
    storageWrite(windowObject, RECENT_KEY, recent);
  };

  async function loadRecipeFile() {
    const [handle] = windowObject.showOpenFilePicker
      ? await windowObject.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Experiment JSON", accept: { "application/json": [".json"] } }],
      })
      : [null];
    const file = handle ? await handle.getFile() : await memoryFilePicker(windowObject);
    if (!file) return null;
    const document = await recipeFromFile(file);
    currentDocument = document;
    remember(document, file.name);
    return { document, workspace: workspaceStatus() };
  }

  async function chooseWorkspace() {
    if (!windowObject.showDirectoryPicker) {
      throw new Error("Browser Runner needs Chrome or Edge directory access to play local JSON media.");
    }
    workspaceHandle = await windowObject.showDirectoryPicker({ mode: "read" });
    workspaceName = workspaceHandle.name;
    workspaceId = randomId();
    storageWrite(windowObject, WORKSPACE_ID_KEY, workspaceId);
    return workspaceStatus();
  }

  async function mediaUrl(args) {
    if (!workspaceHandle) throw new Error("Choose the experiment project folder before running browser video playback.");
    const request = args?.request ?? args ?? {};
    const sourceText = String(request.sourceText ?? "");
    const receipt = await readRunnerRecipe(encoder.encode(sourceText));
    const plan = await resolveRunnerSelection(
      receipt,
      request.participantId,
      request.selector?.languageSelectionPath ?? [],
      request.selector?.variantId ?? "",
    );
    const step = plan.steps.find((item) => item.position === request.protocolStepPosition);
    if (!step || step.kind !== "video") throw new Error("The requested browser media step is not a video.");
    const asset = step.payload.asset;
    const file = await workspaceFile(workspaceHandle, asset.packageRelativePath ?? asset.sourceRelativePath);
    if (file.size !== asset.byteLength) throw new Error("The selected video file length differs from the JSON media identity.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    if (sha256 !== asset.sha256) throw new Error("The selected video file hash differs from the JSON media identity.");
    const url = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType || file.type || "video/mp4" }));
    objectUrls.add(url);
    return Object.freeze({
      schema: "affect-runner-browser-media-url",
      version: 1,
      mediaUrl: url,
      sha256,
      byteLength: file.size,
      mimeType: asset.mimeType || file.type || "video/mp4",
    });
  }

  return async function invokeBrowserRunner(command, args = {}) {
    switch (command) {
      case "research_desktop_identity":
        return { schema: "affect-research-desktop-identity", version: 1, program: "runner", platform: "browser" };
      case "research_runner_fullscreen":
        if (args.fullscreen && windowObject.document.fullscreenEnabled && !windowObject.document.fullscreenElement) {
          await windowObject.document.documentElement.requestFullscreen();
        } else if (!args.fullscreen && windowObject.document.fullscreenElement) {
          await windowObject.document.exitFullscreen();
        }
        return { fullscreen: Boolean(windowObject.document.fullscreenElement) };
      case "research_load_planner_recipe":
        return loadRecipeFile();
      case "research_workspace_status":
        return workspaceStatus();
      case "research_choose_workspace":
        return chooseWorkspace();
      case "research_runner_previous_experiment":
        if (args.action === "confirm") return { confirmed: true };
        return null;
      case "research_runner_recent_experiments":
        if (args.action === "list") return { schema: "affect-runner-recent-experiments", version: 1, entries: [...recent] };
        if (args.action === "load") return null;
        return { schema: "affect-runner-recent-experiments", version: 1, entries: [...recent] };
      case "research_runner_selection": {
        const participantId = participantIdFromRequest(args) ?? "P001";
        return {
          schema: "affect-runner-selection",
          version: 1,
          packageSourceByteSha256: currentDocument?.canonicalSourceByteSha256 ?? "",
          participantId,
          outputDirectory: "Browser CSV download",
        };
      }
      case "research_runner_master_history":
        return {
          schema: "affect-runner-master-history",
          version: 1,
          recipeSourceByteSha256: currentDocument?.canonicalSourceByteSha256 ?? "",
          participants: [],
        };
      case "research_runner_variant_usage":
        return {
          schema: "affect-runner-variant-usage",
          version: 1,
          basis: "xdf-file-names-v1",
          recipeSourceByteSha256: currentDocument?.canonicalSourceByteSha256 ?? "",
          variants: variantRows(currentDocument),
          usedParticipantIds: [],
          ignoredXdfFiles: 0,
        };
      case "research_package_protocol_capability":
        return {
          schema: "affect-research-native-package-protocol-capability",
          version: 1,
          backend: "html-video",
          rustOwnedProtocol: true,
          packageV1CompilationReady: false,
          protocolPlanV2Ready: false,
          questionnaireDraftsReady: false,
          recoveryJournalReady: false,
          manifestV4Ready: false,
          nativeStartReady: false,
          reasonCode: "browser-csv-runner",
        };
      case "research_native_media_capability":
        return { schema: "affect-research-native-media-capability", version: 1, playerActorReady: false, reasonCode: "browser-html-video" };
      case "research_input_cancel_setup":
        return { cancelled: true };
      case "research_input_set_region":
        return { runReady: true };
      case "research_input_begin_test":
        return { phase: "ready" };
      case "research_input_status":
        return { phase: "ready", receipt: { receiptId: "browser-input-ready" }, remainingDirections: [] };
      case "research_recorder_status":
        return { available: false, active: false, phase: "browser-csv", sampleCount: 0 };
      case "research_recorder_discover":
        return { revision: 1, streams: [] };
      case "research_runner_master_html_video_url":
        return mediaUrl(args);
      case "research_runner_reveal_video":
        throw new Error("File Explorer reveal is available only in the desktop Runner.");
      default:
        throw new Error(`Browser Runner does not implement ${command}.`);
    }
  };
}

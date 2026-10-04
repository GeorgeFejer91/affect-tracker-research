import { probeVideoElement } from "./workspace.js";
import { browserDisplayGeometry } from "./video-catalogue-contribution.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function waitForSeek(video) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("HTML video seek timed out.")), 15_000);
    const onSeeked = () => finish();
    const onError = () => finish(new Error("HTML video could not seek to the start."));
    const finish = error => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      if (error) reject(error); else resolve();
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/** Native P1 process owner prepares files; only HTML decoded frames attest them. */
export async function preparePlannerMediaForHtml({ send, workspaceId, isCurrent = () => true,
  videoFactory = () => document.createElement("video"), existingStimuli = [] } = {}) {
  if (typeof send !== "function" || !workspaceId) throw new TypeError("A native work directory is required.");
  const result = await send("research_prepare_planner_media", { workspaceId });
  if (!isCurrent() || result?.workspaceId !== workspaceId || !Array.isArray(result.stimuli)
    || result.stimuli.length < 1) throw new Error("No current prepared video catalogue is available.");
  const items = [];
  for (const summary of result.stimuli) {
    if (!isCurrent()) throw new Error("P1 media preparation was cancelled.");
    const receipt = await send("research_workspace_media_url", {
      workspaceId, workspaceFileId: summary.workspaceFileId, sha256: summary.sha256,
      byteLength: summary.byteLength, mimeType: summary.mimeType,
    });
    let video;
    try {
      video = videoFactory();
      if (!video?.addEventListener || typeof video.play !== "function") {
        throw new Error("P1 requires an HTML video decoder.");
      }
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.src = receipt.mediaUrl;
      const probe = await probeVideoElement(video);
      if (!isCurrent()) throw new Error("P1 media preparation was cancelled.");
      const seeked = waitForSeek(video);
      video.currentTime = 0;
      await seeked;
      const started = performance.now();
      await video.play();
      await sleep(80);
      video.pause?.();
      const attested = await send("research_attest_workspace_decode", { attestation: {
        attestationKind: "attestRepresentativeFramesV1", decodeBackend: "webviewVideoFrameCallback",
        workspaceId, mediaGrantId: receipt.mediaGrantId, workspaceFileId: summary.workspaceFileId,
        sha256: summary.sha256, byteLength: summary.byteLength, mimeType: summary.mimeType,
        observedDurationMs: probe.durationSeconds * 1_000,
        videoWidth: probe.videoWidth, videoHeight: probe.videoHeight,
        mutedPlaybackMs: Math.max(50, Math.min(5_000, performance.now() - started)),
        decodedPositionsMs: probe.decodedPositionsSeconds.map(position => position * 1_000),
      } });
      if (!isCurrent() || attested.decodeStatus !== "attestedUnqualified"
        || attested.decodeBackend !== "webviewVideoFrameCallback"
        || attested.decodeAttestation !== "representativeFramesV1" || !attested.source
        || !attested.source.relativePath.startsWith("stimuli/")
        || attested.sha256 !== summary.sha256 || attested.byteLength !== summary.byteLength) {
        throw new Error("The prepared video did not produce current HTML decode evidence.");
      }
      const existing = existingStimuli.find(item => item.contractSource?.relativePath === attested.source.relativePath);
      items.push({
        stimulus: { stimulusId: existing?.id ?? `workspace-${summary.workspaceFileId}`,
          title: existing?.title ?? summary.displayName, source: attested.source },
        verified: true, decodeQualification: "attestedUnqualified",
        workspaceFileId: summary.workspaceFileId,
        displayGeometry: browserDisplayGeometry(probe),
      });
    } catch (error) {
      await send("research_attest_workspace_decode", { attestation: {
        attestationKind: "revokeGrant", decodeBackend: "webviewVideoFrameCallback",
        workspaceId, mediaGrantId: receipt.mediaGrantId, workspaceFileId: summary.workspaceFileId,
        sha256: summary.sha256, byteLength: summary.byteLength, mimeType: summary.mimeType,
      } }).catch(() => {});
      throw error;
    } finally {
      video?.pause?.();
      video?.removeAttribute?.("src");
      video?.load?.();
    }
  }
  return { items, replace: true };
}

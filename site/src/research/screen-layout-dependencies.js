import { canonicalJson } from "./canonical.js";
import { validatePlannerContributionSnapshot } from "./planner-contributions.js";
import { applyScreenLayoutFit, resolveScreenLayoutDraft } from "./screen-layout-draft.js";
import { DESKTOP_LAYOUT_MAX_MEDIA, convertDesktopLayoutUnits, resolveDesktopLayoutBase, resolveDesktopLayoutGeometry } from "./desktop-layout.js";
import { desktopLayoutProfileFromDraft, desktopLayoutDraftFromProfile } from "./desktop-layout-contribution.js";

const issue = (field, code, message) => ({ field, code, message, videoId: null });
const revision = value => Number.isSafeInteger(value) && value >= 0;

/** Both reference interpretations are inspection candidates until Q08 is settled. */
export function screenLayoutReferenceCandidates(videos) {
  if (!videos.length) return null;
  const byArea = [...videos].sort((a, b) => b.width * b.height - a.width * a.height
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const largest = byArea[0];
  return { largestVideo: { assetId: largest.id, width: largest.width, height: largest.height },
    maximumDimensions: { width: Math.max(...videos.map(v => v.width)), height: Math.max(...videos.map(v => v.height)) } };
}

/** Connect owner APIs. P1 validates its catalogue asynchronously; P5 alone
 * resolves animation bounds at P4's explicit draft viewport side. No DOM reads. */
export function createScreenLayoutDependencyBinding({ getCatalogueSnapshot, projectCatalogue, projectSnapshot = value => value,
  getFeedbackLayoutSnapshot, getFeedbackSnapshot, onChange = () => {} } = {}) {
  let alive = true;
  let generation = 0;
  let catalogue = null;
  let catalogueKey = null;
  let media = [];
  let catalogueIssue = issue("media", "catalogue-unavailable", "Verified video display geometry is unavailable.");
  let previousCatalogue = null;
  let previousFeedback = null;

  function readCatalogue() {
    if (typeof getCatalogueSnapshot !== "function") return null;
    return validatePlannerContributionSnapshot(getCatalogueSnapshot());
  }
  function checkRevision(next, previous, identity) {
    if (previous && (next.revision < previous.revision
      || (next.revision === previous.revision && identity !== previous.identity))) {
      throw new TypeError("The producer changed its data without advancing its revision.");
    }
    return { revision: next.revision, identity };
  }
  async function refreshCatalogue() {
    if (!alive) return;
    // An identical producer notification is not an edit and must not withdraw
    // prepared state merely to rerun an already completed validation.
    try { if (!catalogueIssue && catalogueKey !== null && canonicalJson(readCatalogue()) === catalogueKey) return; }
    catch { /* Changed or malformed input is withdrawn below. */ }
    const operation = ++generation;
    media = [];
    catalogueKey = null;
    catalogue = null;
    catalogueIssue = issue("media", "catalogue-pending", "Video display geometry is being checked.");
    if (alive) onChange();
    try {
      const source = readCatalogue();
      if (!source?.enabled || source.pending || !source.contribution || typeof projectCatalogue !== "function") {
        catalogue = source;
        catalogueIssue = issue("media", "catalogue-unavailable", "Verify the complete video library to check layout fit.");
        return;
      }
      const identity = canonicalJson({ enabled: source.enabled, contribution: source.contribution, dependencyRevisions: source.dependencyRevisions });
      const checkedRevision = checkRevision(source, previousCatalogue, identity);
      const key = canonicalJson(source);
      const extracted = validatePlannerContributionSnapshot(await projectSnapshot(source));
      if (extracted.revision !== source.revision || !extracted.enabled || extracted.pending || !extracted.contribution
        || canonicalJson(extracted.dependencyRevisions) !== canonicalJson(source.dependencyRevisions)) {
        throw new TypeError("Catalogue extraction changed the registered owner revision or readiness.");
      }
      const projected = await projectCatalogue(extracted.contribution);
      if (!alive || operation !== generation) return;
      if (canonicalJson(readCatalogue()) !== key) throw new TypeError("The video library changed during geometry validation.");
      if (!projected || projected.catalogueRevision !== extracted.contribution.revision
        || !Array.isArray(projected.videos) || !projected.videos.length || projected.videos.length > DESKTOP_LAYOUT_MAX_MEDIA) {
        throw new TypeError("The verified display geometry projection is missing or inconsistent.");
      }
      const ids = new Set();
      const nextMedia = projected.videos.map(video => {
        if (typeof video.assetId !== "string" || !video.assetId.length || video.assetId.length > 128 || ids.has(video.assetId)
          || ![video.displayWidth, video.displayHeight].every(n => Number.isSafeInteger(n) && n > 0 && n <= 32768)) {
          throw new TypeError("A verified video has invalid display dimensions or a duplicate identity.");
        }
        ids.add(video.assetId);
        const entry = extracted.contribution.entries.find(item => item.assetId === video.assetId);
        if (!entry) throw new TypeError("Display geometry does not match its catalogue identity.");
        return { id: video.assetId, label: entry.annotationId, width: video.displayWidth, height: video.displayHeight };
      });
      const expectedIds = new Set(extracted.contribution.entries.map(entry => entry.assetId));
      if (ids.size !== expectedIds.size || [...expectedIds].some(id => !ids.has(id))) throw new TypeError("Display geometry must cover every unique asset in the complete catalogue.");
      previousCatalogue = checkedRevision;
      catalogue = source;
      catalogueKey = key;
      media = nextMedia;
      catalogueIssue = null;
    } catch (error) {
      if (operation === generation) catalogueIssue = issue("media", "catalogue-invalid", `Video geometry unavailable: ${error.message}`);
    } finally {
      if (alive && operation === generation) onChange();
    }
  }

  return Object.freeze({
    refreshCatalogue,
    getDependencySnapshots() { return { P1: readCatalogue(), P5: validatePlannerContributionSnapshot(getFeedbackSnapshot?.()) }; },
    convertUnits(draft, units) {
      const profile = desktopLayoutProfileFromDraft(draft, this.getMediaGeometry());
      return desktopLayoutDraftFromProfile(convertDesktopLayoutUnits(profile, units));
    },
    getContentDependencies() {
      const p1 = readCatalogue(), p5 = validatePlannerContributionSnapshot(getFeedbackSnapshot?.());
      if (!p1?.enabled || p1.pending || !p1.contribution || !p5.enabled || p5.pending || !p5.contribution
        || catalogueIssue || canonicalJson(p1) !== catalogueKey) throw new TypeError("Verify the complete video library and saved feedback before preparing layout.");
      return { workspace: structuredClone(p1.contribution), feedback: structuredClone(p5.contribution) };
    },
    getMediaGeometry() {
      if (catalogueIssue || canonicalJson(readCatalogue()) !== catalogueKey) throw new TypeError("Verified complete video geometry is required.");
      return media.map(v => ({ assetId: v.id, displayWidth: v.width, displayHeight: v.height }));
    },
    refreshFeedback() { if (alive) onChange(); },
    resolve(draft) {
      let result = resolveScreenLayoutDraft(draft);
      result.inputKind = "live";
      result.dependencyRevisions = [];
      result.dependencyIdentity = { catalogue: null, catalogueValidation: catalogueIssue?.code ?? "checked", feedback: null };
      let availableMedia = [];
      try {
        const current = readCatalogue();
        result.dependencyIdentity.catalogue = current;
        if (current) result.dependencyRevisions.push({ segment: "P1", revision: current.revision });
        if (!catalogueIssue && catalogueKey !== null && canonicalJson(current) === catalogueKey) {
          availableMedia = media;
        } else result.issues.push(catalogueIssue ?? issue("media", "catalogue-stale", "Video library changed; its display geometry must be checked again."));
      } catch {
        result.issues.push(issue("media", "catalogue-invalid", "Video catalogue revision or contents are invalid."));
      }
      result.referenceCandidates = screenLayoutReferenceCandidates(availableMedia);
      let profile = null;
      if (draft.referencePolicy === null || draft.referencePolicy === undefined) {
        result.geometry = null;
        result.issues.unshift(issue("referencePolicy", "reference-policy-required", "Choose how to determine the fixed reference for all videos."));
      } else if (availableMedia.length) {
        try {
          profile = desktopLayoutProfileFromDraft(draft, availableMedia.map(v => ({ assetId: v.id, displayWidth: v.width, displayHeight: v.height })));
          const base = resolveDesktopLayoutBase(profile);
          result = { ...result, geometry: base.geometry, issues: base.issues };
        } catch (error) {
          result.geometry = null;
          result.issues = [issue(error.field ?? "reference", error.code ?? "invalid-layout", error.message)];
        }
      } else result.geometry = null;
      let maximum = null;
      let ownedEnvelope = null;
      if (typeof getFeedbackLayoutSnapshot === "function") {
        try {
          // A unit-side query binds the owner revision even while P4 fields are
          // invalid. Its extent is never rendered or treated as draft geometry.
          const side = result.geometry?.feedback.width ?? 1;
          const source = getFeedbackLayoutSnapshot(side);
          if (!source || !revision(source.revision) || typeof source.pending !== "boolean") throw new TypeError("Invalid feedback revision.");
          result.dependencyIdentity.feedback = structuredClone(source);
          result.dependencyRevisions.push({ segment: "P5", revision: source.revision });
          if (source.pending || !source.envelope) throw new TypeError("Correct the saved feedback settings to calculate animation bounds.");
          const e = source.envelope;
          if (!["feedback-envelope-v1", "feedback-envelope-v2"].includes(e.algorithmVersion) || e.origin !== "design-centre" || e.overlaySideCssPx !== side
            || typeof e.configurationKey !== "string" || !e.configurationKey.length
            || !Number.isFinite(e.halfExtentCssPx * 2) || e.halfExtentCssPx < 0) throw new TypeError("Unsupported or inconsistent feedback envelope.");
          // Size belongs to P4, so a size edit may change resolved extent without revising P5.
          previousFeedback = checkRevision(source, previousFeedback, e.configurationKey);
          ownedEnvelope = e;
          if (result.geometry) {
            const { cx, cy } = result.geometry.feedback;
            maximum = { x: cx - e.halfExtentCssPx, y: cy - e.halfExtentCssPx,
              width: 2 * e.halfExtentCssPx, height: 2 * e.halfExtentCssPx };
          }
        } catch (error) {
          result.issues.push(issue("envelope", "feedback-unavailable", `Maximum animation bounds unavailable: ${error.message}`));
        }
      } else if (result.geometry) result.issues.push(issue("envelope", "feedback-unavailable", "Saved feedback animation bounds are unavailable."));
      result.dependencies = [];
      if (!draft.referencePolicy) result.dependencies.push("Reference method");
      if (!availableMedia.length) result.dependencies.push("P1 display geometry");
      if (!maximum) result.dependencies.push("P5 animation envelope");
      if (profile && ownedEnvelope) {
        const resolved = resolveDesktopLayoutGeometry(profile, availableMedia.map(v => ({ assetId: v.id, displayWidth: v.width, displayHeight: v.height })), ownedEnvelope);
        const labels = new Map(availableMedia.map(v => [v.id, v.label]));
        return { ...result, ...resolved, videos: resolved.videos.map(v => ({ ...v, label: labels.get(v.id) })),
          dependencies: [], status: "authored", exportable: false };
      }
      return applyScreenLayoutFit(result, availableMedia, maximum, maximum ? "saved-maximum" : "nominal-only");
    },
    destroy() { alive = false; generation += 1; media = []; },
  });
}

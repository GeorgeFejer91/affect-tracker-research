import { SCREEN_LAYOUT_DRAFT_FIELDS, createScreenLayoutDraft, resolveScreenLayoutDraft, convertScreenLayoutDraftUnits } from "./screen-layout-draft.js";
import { screenLayoutSceneMarkup } from "./screen-layout-view.js";
import { createScreenLayoutState, validateScreenLayoutContribution } from "./screen-layout-state.js";
import { createScreenLayoutDependencyBinding } from "./screen-layout-dependencies.js";
import { canonicalJson } from "./canonical.js";
import { validatePlannerContributionSnapshot } from "./planner-contributions.js";
import { desktopLayoutProfileFromDraft, desktopLayoutDraftFromProfile, desktopLayoutDraftField } from "./desktop-layout-contribution.js";

/** Local UI owner only. Fixture injection is used by non-shipping qualification pages. */
export function createScreenLayoutDraftEditor(root, { fixtures = {}, dependencies = null, onChange = () => {} } = {}) {
  if (!root?.matches?.("[data-screen-layout-draft]")) throw new TypeError("Screen layout draft root is missing.");
  let draft = createScreenLayoutDraft();
  let selectedVideoId = null;
  let conversionIssues = [];
  const fixtureInputs = structuredClone(fixtures);
  const controls = [...root.querySelectorAll("[data-layout-field]")];
  const query = selector => root.querySelector(selector);
  const document = root.ownerDocument;
  let projection;
  let state;
  let alive = true;
  const dependencyChanged = () => {
    if (!state) return;
    state.refreshDependencies();
    render();
  };
  let binding = dependencies ? createScreenLayoutDependencyBinding({ ...dependencies, onChange: dependencyChanged }) : null;
  function contentDependencies(options = {}) {
    if (!options.dependencies) return binding?.getContentDependencies();
    const supplied = options.dependencies;
    if (!supplied || Object.keys(supplied).sort().join(",") !== "P1,P5") throw new TypeError("Layout requires exactly Workspace and Feedback dependencies.");
    const p1 = validatePlannerContributionSnapshot(supplied.P1), p5 = validatePlannerContributionSnapshot(supplied.P5);
    if (!p1.enabled || p1.pending || !p1.contribution || !p5.enabled || p5.pending || !p5.contribution) throw new TypeError("Layout dependencies are still pending.");
    return { workspace: p1.contribution, feedback: p5.contribution };
  }
  const validateOwned = (value, options = {}) => validateScreenLayoutContribution(value, contentDependencies(options));
  state = createScreenLayoutState({
    resolve: (next, options) => binding ? binding.resolve(next, options) : resolveScreenLayoutDraft(next, fixtureInputs),
    onChange,
    prepareDraft: next => {
      if (!binding) throw new TypeError("Connect the verified video library and saved feedback before preparing layout.");
      const profile = desktopLayoutProfileFromDraft(next, binding.getMediaGeometry());
      return validateScreenLayoutContribution(profile, binding.getContentDependencies());
    },
    validateContribution: (value, options) => options.contentDependencies
      ? validateScreenLayoutContribution(value, options.contentDependencies) : validateOwned(value, options),
  });

  function syncFields() {
    for (const control of controls) {
      const field = control.dataset.layoutField;
      if (control.type === "checkbox") control.checked = draft[field];
      else control.value = typeof draft[field] === "number" ? Number(draft[field].toPrecision(12)) : draft[field] ?? "";
    }
  }

  function render() {
    projection = state.projection;
    query("[data-layout-scene]").innerHTML = screenLayoutSceneMarkup(projection, selectedVideoId);
    const geometry = projection.geometry;
    const number = value => Number(value.toFixed(2));
    query("[data-layout-readout]").textContent = geometry
      ? `Reference ${number(geometry.reference.width)} × ${number(geometry.reference.height)} CSS px · Feedback centre (${number(geometry.feedback.cx)}, ${number(geometry.feedback.cy)}) · offsets (${number(geometry.offset.x)}, ${number(geometry.offset.y)})`
      : "Geometry unavailable until all layout inputs are ready.";
    const issues = [...projection.issues, ...conversionIssues].map(item => {
      const field = desktopLayoutDraftField(item.field), label = SCREEN_LAYOUT_DRAFT_FIELDS[field];
      return { ...item, field, message: label ? item.message.replace(item.field, label) : item.message };
    });
    const errors = query("[data-layout-errors]");
    errors.replaceChildren(...issues.map(item => {
      const li = document.createElement("li");
      li.textContent = item.message;
      return li;
    }));
    errors.hidden = !issues.length;
    for (const control of controls) control.setAttribute("aria-invalid", String(issues.some(item => item.field === control.dataset.layoutField)));
    query("[data-layout-status]").textContent = issues.length
      ? `${issues.length} layout ${issues.length === 1 ? "issue" : "issues"} to resolve.`
      : "Geometry checks passed.";
    for (const unit of root.querySelectorAll("[data-layout-unit]")) {
      const field = unit.dataset.layoutUnit;
      if (field.startsWith("screen") || field.startsWith("physical")) continue;
      const basis = ["referenceWidth", "referenceX"].includes(field) ? "viewport width"
        : ["referenceHeight", "referenceY"].includes(field) ? "viewport height"
          : field === "offsetX" ? "reference width" : field === "offsetY" ? "reference height" : "shorter reference side";
      unit.textContent = draft.units === "mm" ? "(mm)" : `(% ${basis})`;
    }
    const notice = query("[data-layout-dependencies]");
    if (binding) {
      const hasVideos = projection.videos.length > 0;
      const hasEnvelope = geometry?.maximumFeedback !== null && geometry !== null;
      notice.textContent = hasVideos && hasEnvelope
        ? `${projection.videos.length} verified video display ${projection.videos.length === 1 ? "geometry" : "geometries"} and saved animation bounds are shown. The selected method defines one fixed reference for every video.`
        : "Complete video geometry and saved animation bounds are required to check every video. Missing or changed inputs clear the affected bounds.";
    } else if (fixtureInputs.media?.length || fixtureInputs.envelope) notice.textContent = "Synthetic verification samples only. These video and animation bounds are illustrative; actual media fit remains unverified.";
    const select = query("[data-layout-video]");
    query("[data-layout-fixture-controls]").hidden = !projection.videos.length;
    query("[data-layout-video-label]").textContent = binding ? "Inspect video fit" : "Synthetic display-geometry fixture";
    select.replaceChildren(...projection.videos.map(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.label} · ${item.displayWidth} × ${item.displayHeight}`;
      return option;
    }));
    if (projection.videos.some(item => item.id === selectedVideoId)) select.value = selectedVideoId;
    selectedVideoId = select.value || null;
  }

  function edit(event) {
    const field = event.target?.dataset?.layoutField;
    if (!field) return;
    event.stopPropagation();
    if (["units", "referencePolicy"].includes(field) && event.type !== "change") return;
    if (field === "units") {
      let converted;
      try {
        const next = binding?.convertUnits(draft, event.target.value);
        converted = next ? { ok: true, draft: next, issues: [] } : convertScreenLayoutDraftUnits(draft, event.target.value);
      } catch (error) { converted = { ok: false, draft, issues: [{ field: error.field ?? "units", code: error.code ?? "conversion", message: error.message }] }; }
      conversionIssues = converted.issues;
      if (converted.ok) draft = converted.draft;
      syncFields();
      if (!converted.ok) query(".layout-calibration").open = true;
    } else {
      draft = { ...draft, [field]: event.target.type === "checkbox" ? event.target.checked
        : field === "referencePolicy" ? event.target.value || null : event.target.value };
      conversionIssues = [];
    }
    state.replaceDraft(draft);
    render();
  }

  function click(event) {
    if (!event.target.closest?.("[data-layout-reset]")) return;
    event.stopPropagation();
    draft = createScreenLayoutDraft();
    conversionIssues = [];
    syncFields();
    state.replaceDraft(draft);
    render();
  }

  function selectVideo(event) {
    if (!event.target.matches?.("[data-layout-video]")) return;
    event.stopPropagation();
    selectedVideoId = event.target.value;
    render();
  }

  async function prepareRestoreContent(value, { savedWorkspaceContribution, savedFeedbackContribution, isCurrent = () => true } = {}) {
    if (!savedWorkspaceContribution || !savedFeedbackContribution) throw new TypeError("Reopening layout content requires its complete saved workspace and feedback settings.");
    if (typeof isCurrent !== "function") throw new TypeError("Layout restoration requires a current-operation guard.");
    const expectedBinding = binding;
    const current = () => alive && binding === expectedBinding && isCurrent();
    const source = structuredClone(value);
    const staged = await state.prepareRestoreContent(source, { contentDependencies: { workspace: savedWorkspaceContribution,
      feedback: savedFeedbackContribution }, isCurrent: current });
    const next = desktopLayoutDraftFromProfile(source);
    let committed = false, projected = false;
    return Object.freeze({ isCurrent: staged.isCurrent,
      commit() { staged.commit(); committed = true; draft = next; conversionIssues = []; },
      afterCommit() {
        if (!committed) throw new Error("Screen layout content restoration has not committed.");
        if (projected) return;
        if (!current()) throw new Error("Screen layout content projection became stale.");
        projected = true;
        try { staged.afterCommit(); }
        finally { if (alive) { draft = state.draft; syncFields(); render(); } }
      },
    });
  }

  syncFields();
  render();
  root.addEventListener("input", edit);
  root.addEventListener("change", edit);
  root.addEventListener("change", selectVideo);
  root.addEventListener("click", click);
  return Object.freeze({
    get projection() { return structuredClone(projection); },
    get draft() { return { ...draft }; },
    getSnapshot: state.getSnapshot,
    getDraftDocument: state.getDraftDocument,
    async stageAuthoringDraft(transform, options) {
      let nextDraft;
      const staged = await state.stageDraft(next => {
        const result = transform(next, (candidate, units) => {
          if (!binding) throw new TypeError("Verified live video geometry is required to convert CLI layout units.");
          return binding.convertUnits(candidate, units);
        });
        nextDraft = structuredClone(result);
        return result;
      }, options);
      return Object.freeze({ isCurrent: staged.isCurrent,
        commit() { staged.commit(); draft = nextDraft; conversionIssues = []; },
        afterCommit() {
          try { staged.afterCommit(); }
          finally { draft = state.draft; syncFields(); render(); }
        },
      });
    },
    validateContribution: validateOwned,
    async prepareContribution(options) {
      try {
        const snapshot = await state.prepareContribution(options);
        render();
        return snapshot;
      } catch (error) {
        const field = desktopLayoutDraftField(error.field);
        const control = controls.find(item => item.dataset.layoutField === field);
        if (control) {
          render();
          const disclosure = control.closest("details");
          if (disclosure) disclosure.open = true;
          control.focus(); control.scrollIntoView({ block: "nearest" });
        }
        throw error;
      }
    },
    async restoreContribution(value, options = {}) {
      const dependencies = binding?.getDependencySnapshots();
      if (!dependencies || (options.dependencies && canonicalJson(options.dependencies) !== canonicalJson(dependencies))) throw new Error("Layout restore dependencies are stale.");
      const snapshot = await state.restoreContribution(value, { dependencies, isCurrent: options.isCurrent });
      draft = state.draft; conversionIssues = []; syncFields(); render(); return snapshot;
    },
    prepareRestoreContent,
    async restoreContent(value, options) {
      const prepared = await prepareRestoreContent(value, options);
      prepared.commit(); prepared.afterCommit(); return state.getSnapshot();
    },
    connectDependencies(owners) {
      binding?.destroy();
      binding = createScreenLayoutDependencyBinding({ ...owners, onChange: dependencyChanged });
      return binding.refreshCatalogue();
    },
    async restoreDraft(document, options) {
      const snapshot = await state.restoreDraft(document, options);
      draft = state.draft;
      conversionIssues = [];
      syncFields();
      render();
      return snapshot;
    },
    refreshCatalogue() { return binding?.refreshCatalogue(); },
    refreshFeedback() { binding?.refreshFeedback(); },
    destroy() {
      alive = false;
      binding?.destroy();
      state.destroy();
      root.removeEventListener("input", edit);
      root.removeEventListener("change", edit);
      root.removeEventListener("change", selectVideo);
      root.removeEventListener("click", click);
    },
  });
}

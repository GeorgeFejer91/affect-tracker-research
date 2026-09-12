import {
  XR_LAYOUT_FILE_NAME, XR_LAYOUT_MAX_BYTES,
  canEditXrAngularSize, createDefaultXrLayoutProfile, parseXrLayoutProfileV1,
  resolveXrCatalogueV1, resolveXrLayoutProfileV1, serializeXrLayoutProfileV1, validateXrLayoutProfileV1,
  withXrAngularSize,
} from "./xr-layout.js";
import { xrLayoutSceneSvg } from "./xr-layout-view.js";
import { resolveXrFeedbackFootprintV1 } from "./xr-layout-feedback.js";

function validateRevisions(value) {
  if (!value || Object.keys(value).sort().join(",") !== "catalogue,feedback"
      || Object.values(value).some((v) => v !== null && (!Number.isSafeInteger(v) || v < 0))) throw new TypeError("P6 requires explicit catalogue/feedback revisions or null.");
  return { catalogue: value.catalogue, feedback: value.feedback };
}

function validateDependencies({ catalogueRevision, feedbackRevision, previewMedia = null,
  catalogueGeometry = null, feedbackEnvelope = null }, profile = createDefaultXrLayoutProfile()) {
  validateRevisions({ catalogue: catalogueRevision, feedback: feedbackRevision });
  if (previewMedia !== null) resolveXrLayoutProfileV1(profile, previewMedia);
  if (catalogueGeometry !== null) {
    if (catalogueRevision === null) throw new TypeError("Display geometry requires its P1 catalogue revision.");
    resolveXrCatalogueV1(profile, catalogueGeometry);
  }
  if (feedbackEnvelope !== null) {
    if (feedbackRevision === null) throw new TypeError("The feedback envelope requires its P5 revision.");
    resolveXrFeedbackFootprintV1(profile, feedbackEnvelope);
  }
  return structuredClone({ catalogueRevision, feedbackRevision, previewMedia, catalogueGeometry, feedbackEnvelope });
}

// P7 consumes this state, never DOM values or the last valid version of a dirty
// draft. Inspection-camera changes do not revise or invalidate the contribution.
export function createXrLayoutState() {
  let enabled = false, revision = 0, accepted = null;
  let draft = createDefaultXrLayoutProfile();
  let dependencies = { catalogue: null, feedback: null };
  const validate = () => validateXrLayoutProfileV1(draft);
  return {
    setEnabled(value) { if (typeof value !== "boolean") throw new TypeError("XR enabled must be Boolean."); if (enabled !== value) { enabled = value; revision += 1; } },
    setDraft(value) { draft = structuredClone(value); accepted = null; revision += 1; },
    getDraft() { return structuredClone(draft); },
    invalidate() { accepted = null; revision += 1; },
    accept() { accepted = validate(); revision += 1; return structuredClone(accepted); },
    load(source, revisions = dependencies) {
      const next = parseXrLayoutProfileV1(source), nextDependencies = validateRevisions(revisions);
      draft = next; accepted = structuredClone(next); dependencies = nextDependencies; enabled = true; revision += 1;
    },
    loadDraft(source) {
      const next = parseXrLayoutProfileV1(source);
      draft = next; accepted = null; enabled = true; revision += 1;
    },
    setDependencyRevisions(value) {
      validateRevisions(value);
      if (dependencies.catalogue !== value.catalogue || dependencies.feedback !== value.feedback) {
        dependencies = { catalogue: value.catalogue, feedback: value.feedback }; accepted = null; revision += 1;
      }
    },
    getSnapshot() {
      return { enabled, revision, pending: enabled && accepted === null,
        contribution: enabled && accepted !== null ? structuredClone(accepted) : null,
        dependencyRevisions: Object.entries(dependencies).filter(([, value]) => value !== null)
          .map(([key, value]) => ({ segment: key === "catalogue" ? "P1" : "P5", revision: value })) };
    },
    serialize() { if (!enabled || accepted === null) throw new Error("Validate the current authoring profile before downloading."); return serializeXrLayoutProfileV1(accepted); },
  };
}

export function createXrLayoutEditor(host, { onChange = () => {} } = {}) {
  const state = createXrLayoutState();
  const abort = new AbortController();
  let disposed = false, fileGeneration = 0, camera = { yaw: 30, elevation: 20 };
  let media = null, feedbackEnvelope = null, catalogueGeometry = null;
  const q = (selector) => host.querySelector(selector);
  const fields = [...host.querySelectorAll("[data-xr-field]")];
  const status = (message) => { q("[data-xr-status]").textContent = message; };
  const describeError = (problem) => {
    const field = fields.find((input) => input.dataset.xrField === problem.field);
    const label = field?.closest("label")?.querySelector("span")?.textContent;
    if (label) return problem.message.replace(problem.field, label);
    if (problem.code === "fields") return "This profile has missing or unsupported layout fields. Open a profile exported by this editor.";
    return problem.message;
  };
  const notify = () => onChange(state.getSnapshot());
  const setFields = () => {
    const draft = state.getDraft();
    for (const field of fields) {
      const [group, name] = field.dataset.xrField.split(".");
      if (field.type === "checkbox") field.checked = draft[group][name];
      else field.value = draft[group][name];
    }
    q("[data-xr-enabled]").checked = state.getSnapshot().enabled;
  };
  function render() {
    const snapshot = state.getSnapshot(), draft = state.getDraft();
    q("[data-xr-content]").hidden = !snapshot.enabled;
    host.querySelectorAll("[data-xr-content] input, [data-xr-content] button, [data-xr-content] select").forEach((control) => { control.disabled = !snapshot.enabled; });
    q("[data-xr-media]").disabled = !snapshot.enabled || !catalogueGeometry?.length;
    const error = q("[data-xr-error]");
    error.hidden = true;
    for (const field of fields) { field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby"); }
    let valid = false;
    try {
      const geometry = resolveXrLayoutProfileV1(draft, media);
      if (catalogueGeometry !== null) resolveXrCatalogueV1(draft, catalogueGeometry);
      const footprint = feedbackEnvelope === null ? null : resolveXrFeedbackFootprintV1(draft, feedbackEnvelope);
      valid = true;
      q("[data-xr-scene]").innerHTML = xrLayoutSceneSvg(draft, camera, media, footprint);
      const fixed = (value) => value.toFixed(3);
      const rows = [
        ["Screen angular width", `${fixed(geometry.screenAngles.widthDegrees)}°`],
        ["Screen angular height", `${fixed(geometry.screenAngles.heightDegrees)}°`],
        ["Centre direction", `${fixed(draft.video.azimuthDegrees)}° right / ${fixed(draft.video.elevationDegrees)}° up`],
        ["Screen centre (m)", geometry.videoCentre.map(fixed).join(", ")],
        ["Fitted video (m)", geometry.fittedSize.map(fixed).join(" × ")],
        ["Fitted video angular width / height", `${fixed(geometry.videoAngles.widthDegrees)}° / ${fixed(geometry.videoAngles.heightDegrees)}°`],
      ];
      if (footprint) rows.push(["Full feedback bound (m)", `${fixed(2 * footprint.halfExtentMetres)} × ${fixed(2 * footprint.halfExtentMetres)}`]);
      q("[data-xr-readout]").innerHTML = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
      const angularAllowed = canEditXrAngularSize(draft);
      q('[data-xr-action="angles"]').disabled = !snapshot.enabled || !angularAllowed;
      q("[data-xr-angular-help]").textContent = angularAllowed
        ? "Applying angular size replaces the metre dimensions; moving the screen later keeps its physical size."
        : "For an offset or tilted screen, edit metres. The readout shows its actual setup-view angular extents.";
    } catch (problem) {
      error.textContent = describeError(problem);
      error.hidden = !snapshot.enabled;
      q("[data-xr-scene]").replaceChildren();
      q("[data-xr-readout]").replaceChildren();
      for (const field of fields) {
        if (field.dataset.xrField.startsWith(problem.field ?? "profile")) {
          field.setAttribute("aria-invalid", "true"); field.setAttribute("aria-describedby", "xr-layout-error");
        }
      }
    }
    q('[data-xr-action="accept"]').disabled = !snapshot.enabled || !valid;
    q('[data-xr-action="export"]').disabled = !snapshot.enabled || snapshot.pending;
    const unbound = [["P1", "video library"], ["P5", "feedback settings"]]
      .filter(([id]) => !snapshot.dependencyRevisions.some(({ segment }) => id === segment)).map(([, label]) => label);
    q("[data-xr-dependencies]").textContent = unbound.length
      ? `Connect the ${unbound.join(" and ")} before exporting a complete XR experiment. Layout profiles remain available.`
      : feedbackEnvelope === null && draft.feedback.enabled
        ? "Connect the full feedback animation bounds before exporting a complete XR experiment."
        : "Video and feedback geometry is connected. Complete XR experiment export is planned.";
  }
  function edit() {
    fileGeneration += 1;
    const draft = state.getDraft();
    for (const field of fields) {
      const [group, name] = field.dataset.xrField.split(".");
      draft[group][name] = field.type === "checkbox" ? field.checked : field.value === "" ? null : Number(field.value);
    }
    state.setDraft(draft);
    status("Layout changed. Accept it again before exporting.");
    render(); notify();
  }
  host.addEventListener("input", (event) => {
    event.stopPropagation();
    if (event.target.matches("[data-xr-field]")) edit();
    if (event.target.matches("[data-xr-camera]")) {
      camera[event.target.dataset.xrCamera] = Number(event.target.value); render();
    }
  }, { signal: abort.signal });
  host.addEventListener("change", (event) => {
    event.stopPropagation();
    if (event.target.matches("[data-xr-enabled]")) {
      fileGeneration += 1; state.setEnabled(event.target.checked); render(); notify();
    }
    if (event.target.matches("[data-xr-file]")) void openFile(event.target.files?.[0]);
    if (event.target.matches("[data-xr-media]")) {
      const item = catalogueGeometry?.find(({ assetId }) => assetId === event.target.value);
      media = item ? { displayWidth: item.displayWidth, displayHeight: item.displayHeight } : null;
      render();
    }
  }, { signal: abort.signal });
  host.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    try {
      if (button.dataset.xrView) {
        const views = { front: [0, 0], side: [90, 0], top: [0, 90], orbit: [30, 20] };
        [camera.yaw, camera.elevation] = views[button.dataset.xrView];
        q('[data-xr-camera="yaw"]').value = camera.yaw;
        q('[data-xr-camera="elevation"]').value = camera.elevation;
      }
      if (button.dataset.xrAction === "angles") {
        const next = withXrAngularSize(state.getDraft(), Number(q('[data-xr-angle="width"]').value), Number(q('[data-xr-angle="height"]').value));
        fileGeneration += 1; state.setDraft(next); setFields(); notify(); status("Angular size applied to metre dimensions. Accept the layout to export.");
      }
      if (button.dataset.xrAction === "accept") acceptLayout();
      if (button.dataset.xrAction === "export") {
        const url = URL.createObjectURL(new Blob([state.serialize()], { type: "application/json;charset=utf-8" }));
        const anchor = host.ownerDocument.createElement("a");
        anchor.href = url; anchor.download = XR_LAYOUT_FILE_NAME; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("Authoring-profile download requested. Reopen the downloaded file to verify it; this is not a runnable experiment package.");
      }
      render();
    } catch (error) { status(describeError(error)); }
  }, { signal: abort.signal });
  // Let typing use native controls without feeding the parent rating simulator.
  host.addEventListener("keydown", (event) => event.stopPropagation(), { signal: abort.signal });
  host.addEventListener("keyup", (event) => event.stopPropagation(), { signal: abort.signal });
  async function openFile(file) {
    if (!file) return;
    const generation = ++fileGeneration, revision = state.getSnapshot().revision;
    try {
      if (file.size > XR_LAYOUT_MAX_BYTES) throw new Error("The XR profile exceeds 8192 bytes.");
      const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      if (disposed || generation !== fileGeneration || revision !== state.getSnapshot().revision) return;
      state.load(source); setFields(); render(); notify(); status("Authoring profile reopened. All saved geometry is editable.");
    } catch (error) {
      if (!disposed && generation === fileGeneration) status(`Profile was not opened: ${describeError(error)}`);
    } finally { if (!disposed && generation === fileGeneration) q("[data-xr-file]").value = ""; }
  }
  function acceptLayout() {
    if (disposed) throw new Error("The XR editor is closed.");
    if (!state.getSnapshot().enabled) return state.getSnapshot();
    const draft = state.getDraft();
    resolveXrLayoutProfileV1(draft, media);
    if (catalogueGeometry !== null) resolveXrCatalogueV1(draft, catalogueGeometry);
    if (feedbackEnvelope !== null) resolveXrFeedbackFootprintV1(draft, feedbackEnvelope);
    state.accept(); render(); notify(); status("Authoring profile validated. Download is available.");
    return state.getSnapshot();
  }
  function projectDependencies(next) {
    feedbackEnvelope = next.feedbackEnvelope;
    catalogueGeometry = next.catalogueGeometry;
    const select = q("[data-xr-media]"), selected = select.value;
    select.replaceChildren();
    for (const item of [{ assetId: "", label: "Authored screen" }, ...(catalogueGeometry ?? [])]) {
      const option = host.ownerDocument.createElement("option");
      option.value = item.assetId; option.textContent = item.label ?? item.assetId; select.append(option);
    }
    select.value = catalogueGeometry?.some(({ assetId }) => assetId === selected) ? selected : "";
    const item = catalogueGeometry?.find(({ assetId }) => assetId === select.value);
    media = item ? { displayWidth: item.displayWidth, displayHeight: item.displayHeight } : next.previewMedia;
  }
  setFields(); render();
  return Object.freeze({
    getSnapshot: () => state.getSnapshot(),
    getDraft: () => state.getDraft(),
    acceptLayout,
    loadProfile(source) {
      fileGeneration += 1; state.load(source); setFields(); render(); notify();
      status("Authoring profile reopened. All saved geometry is editable.");
    },
    restoreContribution(profile, dependencies) {
      if (disposed) throw new Error("The XR editor is closed.");
      const source = serializeXrLayoutProfileV1(profile), next = validateDependencies(dependencies, profile);
      // All untrusted geometry is checked before any editor state is replaced.
      fileGeneration += 1;
      projectDependencies(next);
      state.load(source, { catalogue: next.catalogueRevision, feedback: next.feedbackRevision });
      setFields(); render(); notify(); status("XR layout reopened with the current video and feedback settings.");
      return state.getSnapshot();
    },
    restoreDraft(profile) {
      if (disposed) throw new Error("The XR editor is closed.");
      const source = serializeXrLayoutProfileV1(profile);
      fileGeneration += 1; state.loadDraft(source); setFields(); render(); notify();
      status("Saved XR settings reopened. Verify the video library and feedback, then confirm the layout.");
      return state.getSnapshot();
    },
    setDependencies(dependencies) {
      if (disposed) return;
      const next = validateDependencies(dependencies);
      const { catalogueRevision, feedbackRevision } = next;
      state.setDependencyRevisions({ catalogue: catalogueRevision, feedback: feedbackRevision });
      if (JSON.stringify(feedbackEnvelope) !== JSON.stringify(next.feedbackEnvelope)) state.invalidate();
      if (JSON.stringify(catalogueGeometry) !== JSON.stringify(next.catalogueGeometry)) state.invalidate();
      projectDependencies(next); render(); notify();
    },
    destroy() { disposed = true; fileGeneration += 1; abort.abort(); },
  });
}

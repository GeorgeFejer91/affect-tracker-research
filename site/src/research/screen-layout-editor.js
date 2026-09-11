import { createScreenLayoutDraft, resolveScreenLayoutDraft, convertScreenLayoutDraftUnits } from "./screen-layout-draft.js";
import { screenLayoutSceneMarkup } from "./screen-layout-view.js";

/** Local UI owner only. Fixture injection is used by non-shipping qualification pages. */
export function createScreenLayoutDraftEditor(root, { fixtures = {} } = {}) {
  if (!root?.matches?.("[data-screen-layout-draft]")) throw new TypeError("Screen layout draft root is missing.");
  let draft = createScreenLayoutDraft();
  let selectedVideoId = null;
  let conversionIssues = [];
  const dependencies = structuredClone(fixtures);
  const controls = [...root.querySelectorAll("[data-layout-field]")];
  const query = selector => root.querySelector(selector);
  const document = root.ownerDocument;
  let projection;

  function syncFields() {
    for (const control of controls) {
      const field = control.dataset.layoutField;
      if (control.type === "checkbox") control.checked = draft[field];
      else control.value = typeof draft[field] === "number" ? Number(draft[field].toPrecision(12)) : draft[field];
    }
  }

  function render() {
    projection = resolveScreenLayoutDraft(draft, dependencies);
    query("[data-layout-scene]").innerHTML = screenLayoutSceneMarkup(projection, selectedVideoId);
    const geometry = projection.geometry;
    const number = value => Number(value.toFixed(2));
    query("[data-layout-readout]").textContent = geometry
      ? `Reference ${number(geometry.reference.width)} × ${number(geometry.reference.height)} CSS px · Flubber centre (${number(geometry.feedback.cx)}, ${number(geometry.feedback.cy)}) · offsets (${number(geometry.offset.x)}, ${number(geometry.offset.y)})`
      : "Geometry unavailable while fields are invalid.";
    const issues = [...projection.issues, ...conversionIssues];
    const errors = query("[data-layout-errors]");
    errors.replaceChildren(...issues.map(item => {
      const li = document.createElement("li");
      li.textContent = item.message;
      return li;
    }));
    errors.hidden = !issues.length;
    for (const control of controls) control.setAttribute("aria-invalid", String(issues.some(item => item.field === control.dataset.layoutField)));
    query("[data-layout-status]").textContent = issues.length
      ? `${issues.length} draft ${issues.length === 1 ? "issue" : "issues"} to resolve.`
      : "Draft geometry calculated.";
    for (const unit of root.querySelectorAll("[data-layout-unit]")) {
      const field = unit.dataset.layoutUnit;
      if (field.startsWith("screen") || field.startsWith("physical")) continue;
      const basis = ["referenceWidth", "referenceX"].includes(field) ? "viewport width"
        : ["referenceHeight", "referenceY"].includes(field) ? "viewport height"
          : field === "offsetX" ? "reference width" : field === "offsetY" ? "reference height" : "shorter reference side";
      unit.textContent = draft.units === "mm" ? "(mm)" : `(% ${basis})`;
    }
    if (dependencies.media?.length || dependencies.envelope) query("[data-layout-dependencies]").textContent = "Synthetic verification samples only. These video and animation bounds are illustrative; actual media fit remains unverified.";
  }

  function edit(event) {
    const field = event.target?.dataset?.layoutField;
    if (!field) return;
    event.stopPropagation();
    if (field === "units" && event.type !== "change") return;
    if (field === "units") {
      const converted = convertScreenLayoutDraftUnits(draft, event.target.value);
      conversionIssues = converted.issues;
      if (converted.ok) draft = converted.draft;
      syncFields();
      if (!converted.ok) query(".layout-calibration").open = true;
    } else {
      draft = { ...draft, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value };
      conversionIssues = [];
    }
    render();
  }

  function click(event) {
    if (!event.target.closest?.("[data-layout-reset]")) return;
    event.stopPropagation();
    draft = createScreenLayoutDraft();
    conversionIssues = [];
    syncFields();
    render();
  }

  function selectVideo(event) {
    if (!event.target.matches?.("[data-layout-video]")) return;
    event.stopPropagation();
    selectedVideoId = event.target.value;
    render();
  }

  if (dependencies.media?.length) {
    query("[data-layout-fixture-controls]").hidden = false;
    const select = query("[data-layout-video]");
    select.replaceChildren(...dependencies.media.map(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.id} · ${item.width} × ${item.height}`;
      return option;
    }));
    selectedVideoId = select.value;
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
    destroy() {
      root.removeEventListener("input", edit);
      root.removeEventListener("change", edit);
      root.removeEventListener("change", selectVideo);
      root.removeEventListener("click", click);
    },
  });
}

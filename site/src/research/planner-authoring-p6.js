import { commandFailure, exactCommandKeys, validateCommandJson, validatePlannerEdit,
  validateSettingValue } from "./planner-authoring-contract.js";
import { canEditXrAngularSize, resolveXrCatalogueV1, resolveXrLayoutProfileV1,
  validateXrLayoutProfileV1, withXrAngularSize } from "./xr-layout.js";
import { resolveXrFeedbackFootprintV1 } from "./xr-layout-feedback.js";

const numeric = (id, label, minimum, maximum, units) => ({ id: `P6.${id}`, label,
  type: "number", classification: "authored", writable: true, minimum, maximum, units });
const readonly = (id, label, type = "string", classification = "derived", extra = {}) =>
  ({ id: `P6.${id}`, label, type, classification, writable: false, ...extra });
const settings = [
  { id: "P6.enabled", label: "Include XR screen layout", type: "boolean", classification: "authored", writable: true },
  numeric("video.distanceMetres", "Distance from setup viewer", 0.1, 100, "metres"),
  numeric("video.azimuthDegrees", "Centre azimuth, right positive", -80, 80, "degrees"),
  numeric("video.elevationDegrees", "Centre elevation, up positive", -80, 80, "degrees"),
  numeric("video.widthMetres", "Screen width", 0.001, 100, "metres"),
  numeric("video.heightMetres", "Screen height", 0.001, 100, "metres"),
  numeric("video.yawDegrees", "Screen yaw", -80, 80, "degrees"),
  numeric("video.pitchDegrees", "Screen pitch", -80, 80, "degrees"),
  numeric("video.rollDegrees", "Screen roll", -180, 180, "degrees"),
  { id: "P6.feedback.enabled", label: "Include adjacent feedback", type: "boolean", classification: "authored", writable: true },
  numeric("feedback.offsetXMetres", "Feedback centre offset, screen-local right", -100, 100, "metres"),
  numeric("feedback.offsetYMetres", "Feedback centre offset, screen-local up", -100, 100, "metres"),
  numeric("feedback.diameterMetres", "Maximum feedback footprint diameter", 0.001, 100, "metres"),
  numeric("feedback.minimumGapMetres", "Minimum screen gap", 0, 10, "metres"),
  readonly("target", "Required XR target"),
  readonly("projection", "Screen projection"),
  readonly("coordinateSystem", "Spatial coordinates"),
  readonly("video.fit", "Video fit rule"),
  readonly("alignment.kind", "World anchor rule"),
  readonly("alignment.forwardReference", "Setup forward reference"),
  readonly("alignment.upReference", "Setup up reference"),
  readonly("alignment.recenterPolicy", "Recentring rule"),
  readonly("alignment.trackingLossPolicy", "Tracking loss rule"),
  readonly("pending", "Layout awaits preparation", "boolean"),
  readonly("dependencies", "Bound video and feedback revisions", "json", "derived",
    { description: "Array of P1/P5 owner revision bindings; never a media permission." }),
  readonly("angularSizeEditable", "Centred angular sizing available", "boolean"),
  readonly("geometry", "Resolved setup-frame geometry", "json", "derived",
    { description: "Null for invalid geometry; otherwise screen, all bound video fits, and optional P5 footprint. Unbound videos/feedback are null." }),
  readonly("inspection.camera", "Inspection camera", "json", "transient",
    { description: "Orthographic inspection yaw/elevation in degrees, never saved screen rotation." }),
  readonly("inspection.media", "Inspected video display dimensions", "json", "transient",
    { description: "Null for the authored screen or displayWidth/displayHeight for the current inspection; never a media grant." }),
];
const operations = [{ id: "setAngularSize", label: "Apply centred angular screen size",
  description: "Replaces physical width/height using the current distance. Requires a centred, untilted valid profile; creates no saved angular-size field.",
  arguments: { type: "object", additionalProperties: false, required: ["widthDegrees", "heightDegrees"],
    properties: { widthDegrees: { type: "number", minimum: 0.1, maximum: 150 },
      heightDegrees: { type: "number", minimum: 0.1, maximum: 150 } } } }];
const byId = new Map(settings.map(setting => [setting.id, setting]));
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
freeze(settings); freeze(operations);
function issue(error) {
  const path = error.field ?? "profile";
  return { owner: "P6", field: path.startsWith("P6.") ? path : `P6.${path}`,
    code: error.code ?? "invalid_layout", message: error.message };
}
function draftValue(draft, id) {
  const parts = id.slice(3).split(".");
  return parts.length === 1 ? draft[parts[0]] : draft[parts[0]]?.[parts[1]];
}

/** Typed adapter only. The injected existing XR editor retains the sole draft,
 * dependencies and inspection state; each stage owns a short-lived candidate. */
export function createPlannerAuthoringP6({ editor } = {}) {
  if (!editor || typeof editor.getAuthoringSnapshot !== "function" || typeof editor.stageAuthoringDraft !== "function") {
    throw new TypeError("P6 command authoring requires its existing XR editor.");
  }
  function read() {
    const snapshot = editor.getAuthoringSnapshot(), values = {}, issues = [];
    const draft = snapshot.draft;
    for (const setting of settings.filter(item => item.writable || ["target", "projection", "coordinateSystem", "video.fit"].includes(item.id.slice(3)) || item.id.startsWith("P6.alignment."))) {
      const value = setting.id === "P6.enabled" ? snapshot.enabled : draftValue(draft, setting.id);
      if (setting.writable) {
        try { validateSettingValue(setting, value); } catch (error) { issues.push(issue(error)); }
      }
      // Invalid numeric input remains a string with an issue, never NaN or an
      // earlier valid number. Empty GUI input is stored as its exact empty text.
      values[setting.id] = setting.type === "number" && (typeof value !== "number" || !Number.isFinite(value))
        ? value == null ? "" : String(value) : value ?? null;
    }
    values["P6.pending"] = snapshot.pending;
    values["P6.dependencies"] = snapshot.dependencyRevisions;
    values["P6.inspection.camera"] = snapshot.camera;
    values["P6.inspection.media"] = snapshot.media;
    values["P6.angularSizeEditable"] = false;
    values["P6.geometry"] = null;
    try {
      validateXrLayoutProfileV1(draft);
      values["P6.angularSizeEditable"] = canEditXrAngularSize(draft);
      values["P6.geometry"] = {
        screen: resolveXrLayoutProfileV1(draft, snapshot.media),
        videos: snapshot.catalogueGeometry === null ? null : resolveXrCatalogueV1(draft, snapshot.catalogueGeometry),
        feedback: snapshot.feedbackEnvelope === null ? null : resolveXrFeedbackFootprintV1(draft, snapshot.feedbackEnvelope),
      };
    } catch (error) {
      const problem = issue(error);
      if (!issues.some(item => item.field === problem.field)) issues.push(problem);
    }
    if (snapshot.enabled) {
      for (const segment of ["P1", "P5"]) {
        const bound = snapshot.dependencyRevisions.some(item => item.segment === segment);
        const available = segment === "P1" ? snapshot.catalogueGeometry?.length > 0 : snapshot.feedbackEnvelope !== null;
        if (!bound || !available) issues.push({ owner: "P6", field: "P6.dependencies", code: "dependency_pending",
          message: `Connect verified ${segment === "P1" ? "video geometry" : "feedback settings"} before confirming XR.` });
      }
    }
    if (snapshot.disposed) issues.push({ owner: "P6", field: "P6.enabled", code: "owner_closed", message: "The XR editor is closed." });
    return structuredClone({ values, issues });
  }
  return Object.freeze({ id: "P6", settings, operations, read,
    validate() {
      const result = read();
      return result.values["P6.enabled"] ? result.issues : result.issues.filter(item => item.code === "owner_closed");
    },
    async stage(edits, { isCurrent, signal } = {}) {
      if (typeof isCurrent !== "function") throw new TypeError("P6 staging requires a current-operation guard.");
      if (!Array.isArray(edits) || edits.length < 1 || edits.length > 256) commandFailure("limit_exceeded", "P6 accepts 1–256 ordered edits.", "P6.enabled");
      validateCommandJson(edits);
      const before = editor.getAuthoringSnapshot();
      const current = () => !signal?.aborted && isCurrent() && !editor.getAuthoringSnapshot().disposed
        && editor.getAuthoringSnapshot().revision === before.revision;
      if (!current()) commandFailure(signal?.aborted ? "canceled" : "stale_revision", "The XR authoring operation is no longer current.", "P6.enabled");
      const candidate = { enabled: before.enabled, profile: structuredClone(before.draft) };
      for (const edit of structuredClone(edits)) {
        validatePlannerEdit(edit);
        if (edit.kind === "set") {
          const setting = byId.get(edit.field);
          if (!setting) commandFailure("unknown_setting", "XR setting is not registered.", edit.field);
          validateSettingValue(setting, edit.value);
          if (edit.field === "P6.enabled") candidate.enabled = edit.value;
          else {
            const [group, key] = edit.field.slice(3).split(".");
            candidate.profile[group][key] = edit.value;
          }
        } else {
          if (edit.owner !== "P6" || edit.operation !== "setAngularSize") commandFailure("unknown_operation", "XR operation is not registered.", "P6.enabled");
          exactCommandKeys(edit.arguments, ["widthDegrees", "heightDegrees"]);
          try { candidate.profile = withXrAngularSize(candidate.profile, edit.arguments.widthDegrees, edit.arguments.heightDegrees); }
          catch (error) { commandFailure(error.code ?? "invalid_value", error.message, issue(error).field); }
        }
      }
      // Yield before staging the owner projection so queued GUI/dependency edits
      // are observed. The session also checks ALL returned guards before commit.
      await Promise.resolve();
      if (!current()) commandFailure(signal?.aborted ? "canceled" : "stale_revision", "The XR authoring operation is no longer current.", "P6.enabled");
      return editor.stageAuthoringDraft(candidate, { isCurrent, signal });
    },
  });
}

import { DESKTOP_REFERENCE_POLICIES } from "./desktop-layout.js";
import { desktopLayoutDraftField } from "./desktop-layout-contribution.js";
import { commandFailure as fail, PlannerCommandError, validateSettingValue } from "./planner-authoring-contract.js";

const number = (id, key, label, minimum, maximum, unit, type = "number") =>
  ({ id: `P4.${id}`, key, label, type, minimum, maximum, unit });
const FIELDS = [
  number("viewport.widthCssPx", "screenWidth", "Design viewport width", 1, 32768, "CSS px", "integer"),
  number("viewport.heightCssPx", "screenHeight", "Design viewport height", 1, 32768, "CSS px", "integer"),
  number("calibration.activeWidthMm", "physicalWidth", "Measured active width", 1, 100000, "mm"),
  number("calibration.activeHeightMm", "physicalHeight", "Measured active height", 1, 100000, "mm"),
  { id: "P4.calibration.fullViewportMapping", key: "fullViewportMapping", label: "Design viewport covers the measured display", type: "boolean" },
  { id: "P4.units", key: "units", label: "Geometry units (converts existing geometry)", type: "string", enum: ["relative", "mm"] },
  { id: "P4.reference.method", key: "referencePolicy", label: "Fixed reference method", type: "json",
    enum: [null, ...DESKTOP_REFERENCE_POLICIES], description: "A supported method string or null for an unselected draft; null blocks preparation." },
  number("reference.maximumWidth", "referenceWidth", "Maximum reference width", 0.001, 100000, "mm or % viewport width"),
  number("reference.maximumHeight", "referenceHeight", "Maximum reference height", 0.001, 100000, "mm or % viewport height"),
  number("reference.centreX", "referenceX", "Reference centre X", -100000, 100000, "mm or % viewport width"),
  number("reference.centreY", "referenceY", "Reference centre Y", -100000, 100000, "mm or % viewport height"),
  number("feedback.viewportSide", "diameter", "Feedback drawing viewport side", 0.001, 100000, "mm or % shorter reference side"),
  number("feedback.offsetX", "offsetX", "Feedback centre offset X", -100000, 100000, "mm or % reference width"),
  number("feedback.offsetY", "offsetY", "Feedback centre offset Y", -100000, 100000, "mm or % reference height"),
  number("feedback.minimumGap", "gap", "Minimum separation", 0, 100000, "mm or % shorter reference side"),
];
const CONVENTIONS = Object.freeze({ target: "desktop-screen", coordinateSystem: "viewport-right-down",
  compatibility: "exact", feedbackOrigin: "design-centre", fit: "contain" });
const DERIVED = [
  { id: "P4.geometry", label: "Resolved screen/reference/feedback geometry in CSS pixels" },
  { id: "P4.videoFits", label: "All verified video contain fits and separation" },
  { id: "P4.reference.candidates", label: "Automatic reference candidates from the complete catalogue" },
  { id: "P4.reference.source", label: "Selected oriented reference source" },
  { id: "P4.conventions", label: "Fixed viewport, axes, centre and fitting conventions" },
].map(field => ({ ...field, type: "json", classification: "derived", writable: false }));
const ids = new Map(FIELDS.map(field => [field.id, field]));
const keys = new Map(FIELDS.map(field => [field.key, field]));
const JSON_PATHS = Object.freeze({ screenWidth: "viewport.widthCssPx", screenHeight: "viewport.heightCssPx",
  physicalWidth: "calibration.activeWidthMm", physicalHeight: "calibration.activeHeightMm", fullViewportMapping: "calibration",
  units: "units", referencePolicy: "reference.source.policy", referenceWidth: "reference.box.width", referenceHeight: "reference.box.height",
  referenceX: "reference.centre.x", referenceY: "reference.centre.y", diameter: "feedback.overlayViewportSide",
  offsetX: "feedback.offset.x", offsetY: "feedback.offset.y", gap: "feedback.minimumGap" });
const clone = value => structuredClone(value);
const exact = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));

function accepts(field, value) {
  if (field.enum) return field.enum.includes(value);
  if (field.type === "boolean") return typeof value === "boolean";
  return typeof value === "number" && Number.isFinite(value)
    && (field.type !== "integer" || Number.isInteger(value)) && value >= field.minimum && value <= field.maximum;
}

function authoredValues(draft) {
  return Object.fromEntries(FIELDS.map(field => {
    const raw = draft[field.key];
    const parsed = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    return [field.id, ["number", "integer"].includes(field.type) && accepts(field, parsed) ? Object.is(parsed, -0) ? 0 : parsed : raw];
  }));
}

function issuesFor(draft, projection) {
  const values = authoredValues(draft);
  const issues = (projection.issues ?? []).map(item => ({ owner: "P4",
    field: keys.get(desktopLayoutDraftField(item.field))?.id ?? null,
    code: item.code, message: item.message }));
  for (const field of FIELDS) {
    const optionalBlank = field.key.startsWith("physical") && values[field.id] === ""
      && !draft.fullViewportMapping && draft.units === "relative" && draft.physicalWidth === "" && draft.physicalHeight === "";
    if (!optionalBlank && !accepts(field, values[field.id]) && !issues.some(item => item.field === field.id)) {
      issues.push({ owner: "P4", field: field.id, code: "invalid_value", message: `${field.label} is incomplete or outside its declared type/range.` });
    }
  }
  if (draft.referencePolicy === null && !issues.some(item => item.field === "P4.reference.method")) {
    issues.push({ owner: "P4", field: "P4.reference.method", code: "reference-policy-required", message: "Choose a fixed reference method." });
  }
  return issues;
}

/** Sole draft remains in the existing editor. No DOM addresses, compiler,
 * media permission, acceptance, file write or additional settings store. */
export function createPlannerAuthoringP4({ editor }) {
  if (typeof editor?.getDraftDocument !== "function" || typeof editor?.stageAuthoringDraft !== "function") {
    throw new TypeError("P4 authoring requires the existing screen layout editor.");
  }
  const settings = [
    ...FIELDS.map(({ key, ...field }) => ({ ...clone(field), classification: "authored", writable: true,
      uiControl: `layout-${key}`, jsonPath: `segments.P4.${JSON_PATHS[key]}` })),
    ...clone(DERIVED),
  ];
  const operations = [
    { id: "convertUnits", label: "Convert layout units while preserving fixed geometry",
      arguments: { type: "object", additionalProperties: false, required: ["units"], properties: { units: { type: "string", enum: ["relative", "mm"] } } } },
    { id: "clearCalibration", label: "Clear measured dimensions and full-viewport mapping",
      arguments: { type: "object", additionalProperties: false, properties: {} } },
  ];
  return Object.freeze({
    id: "P4", settings: Object.freeze(settings), operations: Object.freeze(operations),
    read() {
      const draft = editor.getDraftDocument().draft, projection = editor.projection;
      return { values: { ...authoredValues(draft), "P4.geometry": clone(projection.geometry ?? null),
        "P4.videoFits": clone(projection.videos ?? []), "P4.reference.candidates": clone(projection.referenceCandidates ?? null),
        "P4.reference.source": clone(projection.profile?.reference.source ?? null), "P4.conventions": clone(CONVENTIONS) },
      issues: issuesFor(draft, projection) };
    },
    validate() { return issuesFor(editor.getDraftDocument().draft, editor.projection); },
    async stage(edits, { isCurrent, signal } = {}) {
      if (!Array.isArray(edits) || !edits.length || edits.length > 256) fail("invalid_edits", "P4 requires 1–256 ordered edits.", "P4");
      const captured = clone(edits);
      try { return await editor.stageAuthoringDraft((draft, convertUnits) => {
        let next = draft;
        for (const edit of captured) {
          if (edit.kind === "set") {
            if (!exact(edit, ["kind", "field", "value"])) fail("malformed_command", "P4 set fields are missing or unknown.", "P4");
            const field = ids.get(edit.field);
            if (!field) fail(DERIVED.some(item => item.id === edit.field) ? "read_only" : "unknown_setting", "P4 field is unknown or read-only.", edit.field);
            validateSettingValue({ ...field, writable: true, classification: "authored" }, edit.value);
            if (!accepts(field, edit.value)) fail("invalid_value", `${field.label} requires its declared type/range.`, field.id);
            next = field.key === "units" ? convertUnits(next, edit.value) : { ...next, [field.key]: edit.value };
          } else if (edit.kind === "operation") {
            if (!exact(edit, ["kind", "owner", "operation", "arguments"]) || edit.owner !== "P4") fail("malformed_command", "P4 operation owner or fields are invalid.", "P4");
            if (edit.operation === "convertUnits") {
              if (!exact(edit.arguments, ["units"]) || !["relative", "mm"].includes(edit.arguments.units)) fail("invalid_value", "Conversion requires exactly a supported units value.", "P4.units");
              next = convertUnits(next, edit.arguments.units);
            } else if (edit.operation === "clearCalibration") {
              if (!exact(edit.arguments, [])) fail("invalid_value", "Clear calibration takes no arguments.", "P4.calibration.fullViewportMapping");
              next = { ...next, physicalWidth: "", physicalHeight: "", fullViewportMapping: false };
            } else fail("unknown_operation", "Unknown P4 authoring operation.", "P4");
          } else fail("unknown_action", "Unsupported P4 edit.", "P4");
        }
        return next;
      }, { isCurrent, signal }); } catch (error) {
        if (error instanceof PlannerCommandError) throw error;
        const field = keys.get(desktopLayoutDraftField(error.field))?.id ?? "P4";
        fail(signal?.aborted ? "canceled" : /stale/u.test(error.message) ? "stale_revision" : "invalid_value", error.message, field);
      }
    },
  });
}

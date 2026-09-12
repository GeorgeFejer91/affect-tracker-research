import { DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1 } from "./experiment-package.js";
import { PLANNER_RECIPE_POLICY_SCHEMA, validatePlannerRecipePolicyV1 } from "./planner-recipe-policy.js";
import { commandFailure, validateSettingValue } from "./planner-authoring-contract.js";

const FIELDS = Object.freeze([
  { id: "P7.participantCount", control: "participant-count", type: "integer", minimum: 1, maximum: 100000, label: "Participant count" },
  { id: "P7.samplingFrequencyHz", control: "sampling-frequency", type: "integer", minimum: 1, maximum: 240, label: "Sampling frequency", unit: "Hz" },
  { id: "P7.output.csv", control: "output-csv", type: "boolean", label: "CSV output" },
  { id: "P7.output.tsv", control: "output-tsv", type: "boolean", label: "TSV output" },
  { id: "P7.lsl.enabled", control: "lsl-enabled", type: "boolean", label: "Emit LSL" },
  { id: "P7.lsl.stateStream", control: "lsl-state-stream", type: "string", maxLength: 80, label: "LSL state stream" },
  { id: "P7.lsl.streamType", control: "lsl-stream-type", type: "string", maxLength: 80, label: "LSL stream type" },
  { id: "P7.lsl.markerStream", control: "lsl-marker-stream", type: "string", maxLength: 80, label: "LSL marker stream" },
  { id: "P7.lsl.sourceId", control: "lsl-source-id", type: "string", maxLength: 120, label: "LSL source ID" },
]);

/** Product-specific projection over the existing policy controls, not a second
 * policy store. CLI input cannot select elements, properties or event names. */
export function createPlannerPolicyCommandOwner({ root, onCommit = () => {} }) {
  const settings = FIELDS.map(({ control, ...field }) => ({ ...field, classification: "authored", writable: true }));
  settings.push({ id: "P7.playback", type: "json", classification: "derived", writable: false, label: "Fixed complete-video playback policy" });
  const controls = () => new Map(FIELDS.map(field => {
    const control = root.querySelector(`#${field.control}`);
    if (!control) commandFailure("owner_unavailable", "The policy editor is unavailable.", field.id);
    return [field.id, control];
  }));
  const valuesFrom = fields => Object.fromEntries(FIELDS.map(field => {
    const control = fields.get(field.id);
    let value = field.type === "boolean" ? control.checked : control.value;
    if (field.type === "integer" && value.trim() !== "" && Number.isFinite(Number(value))) value = Number(value);
    return [field.id, value];
  }));
  function issuesFor(values) {
    try {
      validatePlannerRecipePolicyV1({ schema: PLANNER_RECIPE_POLICY_SCHEMA, version: 1,
        participantCount: values["P7.participantCount"], samplingFrequencyHz: values["P7.samplingFrequencyHz"],
        output: { csv: values["P7.output.csv"], tsv: values["P7.output.tsv"] },
        lsl: Object.fromEntries(["enabled", "stateStream", "streamType", "markerStream", "sourceId"].map(key => [key, values[`P7.lsl.${key}`]])),
        playback: structuredClone(DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1),
      });
      return [];
    } catch (error) {
      return [{ owner: "P7", field: null, code: "invalid_policy", message: String(error.message).slice(0, 512) }];
    }
  }
  return Object.freeze({
    id: "P7", settings: Object.freeze(settings), operations: Object.freeze([]),
    read() { const values = valuesFrom(controls()); return { values: { ...values, "P7.playback": structuredClone(DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1) }, issues: issuesFor(values) }; },
    validate() { return issuesFor(valuesFrom(controls())); },
    async stage(edits, { isCurrent, signal }) {
      const fields = controls(), values = valuesFrom(fields), updated = new Set();
      for (const edit of edits) {
        if (edit.kind !== "set") commandFailure("unknown_operation", "Policy has no list-edit operation.", "P7");
        const setting = settings.find(field => field.id === edit.field);
        if (!setting) commandFailure("unknown_setting", "Unknown policy setting.", edit.field);
        validateSettingValue(setting, edit.value);
        values[edit.field] = edit.value; updated.add(edit.field);
      }
      if (!isCurrent() || signal.aborted) commandFailure("stale_revision", "Policy preparation is no longer current.", "P7");
      return { commit() {
        for (const id of updated) {
          const field = FIELDS.find(candidate => candidate.id === id), control = fields.get(id);
          if (field.type === "boolean") control.checked = values[id]; else control.value = String(values[id]);
        }
        onCommit();
      } };
    },
  });
}

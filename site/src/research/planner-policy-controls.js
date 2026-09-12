import { DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1 } from "./experiment-package.js";
import { PLANNER_RECIPE_POLICY_SCHEMA, validatePlannerRecipePolicyV1 } from "./planner-recipe-policy.js";

const CONTROL_IDS = Object.freeze([
  "participant-count", "sampling-frequency", "output-csv", "output-tsv",
  "lsl-enabled", "lsl-state-stream", "lsl-stream-type", "lsl-marker-stream", "lsl-source-id",
]);

function controls(root) {
  return Object.fromEntries(CONTROL_IDS.map(id => {
    const field = root.querySelector(`#${id}`);
    if (!field) throw new Error(`The Planner policy control ${id} is unavailable.`);
    return [id, field];
  }));
}

/** Shared UI adapter only. P7's policy reader remains the sole domain authority;
 * no imported experiment, current Runner session or last-valid cache is needed. */
export function readPlannerPolicyControls(root) {
  const fields = controls(root);
  return validatePlannerRecipePolicyV1({
    schema: PLANNER_RECIPE_POLICY_SCHEMA, version: 1,
    participantCount: Number(fields["participant-count"].value),
    samplingFrequencyHz: Number(fields["sampling-frequency"].value),
    output: { csv: fields["output-csv"].checked, tsv: fields["output-tsv"].checked },
    lsl: {
      enabled: fields["lsl-enabled"].checked,
      stateStream: fields["lsl-state-stream"].value,
      streamType: fields["lsl-stream-type"].value,
      markerStream: fields["lsl-marker-stream"].value,
      sourceId: fields["lsl-source-id"].value,
    },
    // New authoring has one fixed, explicitly declared playback policy.
    // A saved recipe is always read through the strict policy reader instead.
    playback: structuredClone(DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1),
  });
}

/** Validate and locate the entire control set before a synchronous projection.
 * No change events or acceptance receipts are manufactured by restoration. */
export function restorePlannerPolicyControls(root, policy, { isCurrent } = {}) {
  if (typeof isCurrent !== "function") throw new TypeError("Planner policy restore requires a current-request guard.");
  const normalized = validatePlannerRecipePolicyV1(policy);
  const fields = controls(root);
  if (!isCurrent()) return false;
  fields["participant-count"].value = String(normalized.participantCount);
  fields["sampling-frequency"].value = String(normalized.samplingFrequencyHz);
  fields["output-csv"].checked = normalized.output.csv;
  fields["output-tsv"].checked = normalized.output.tsv;
  fields["lsl-enabled"].checked = normalized.lsl.enabled;
  fields["lsl-state-stream"].value = normalized.lsl.stateStream;
  fields["lsl-stream-type"].value = normalized.lsl.streamType;
  fields["lsl-marker-stream"].value = normalized.lsl.markerStream;
  fields["lsl-source-id"].value = normalized.lsl.sourceId;
  return normalized;
}

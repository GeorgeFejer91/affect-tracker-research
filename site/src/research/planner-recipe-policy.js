import { canonicalJson } from "./canonical.js";
import { createDefaultResearchSettings, validateResearchSettingsV1 } from "./contracts.js";
import { DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1 } from "./experiment-package.js";

export const PLANNER_RECIPE_POLICY_SCHEMA = "affect-research-planner-recipe-policy";

function exact(value, fields, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new TypeError(`${name} contains missing or unknown fields.`);
  }
}

/** P7's closed successor policy. Existing field meanings and bounds are retained.
 * Participant count is study metadata; it does not select or allocate a variant.
 * The parser supplies no defaults. Unrelated v1 fields are used only to invoke
 * their existing owner validators and are never included in the returned policy. */
export function validatePlannerRecipePolicyV1(value) {
  exact(value, ["schema", "version", "participantCount", "samplingFrequencyHz", "output", "lsl", "playback"], "Planner recipe policy");
  if (value.schema !== PLANNER_RECIPE_POLICY_SCHEMA || value.version !== 1) throw new TypeError("Unsupported Planner recipe policy version.");
  const base = structuredClone(createDefaultResearchSettings());
  base.experiment.participantCount = value.participantCount;
  base.experiment.samplingFrequencyHz = value.samplingFrequencyHz;
  base.output = structuredClone(value.output);
  base.advanced.lsl = structuredClone(value.lsl);
  const normalized = validateResearchSettingsV1(base);
  if (canonicalJson(value.playback) !== canonicalJson(DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1)) {
    throw new TypeError("Planner playback must retain the explicit complete-video-v1 policy.");
  }
  const result = {
    schema: PLANNER_RECIPE_POLICY_SCHEMA, version: 1,
    participantCount: normalized.experiment.participantCount,
    samplingFrequencyHz: normalized.experiment.samplingFrequencyHz,
    output: normalized.output, lsl: normalized.advanced.lsl,
    playback: structuredClone(DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1),
  };
  if (canonicalJson(value) !== canonicalJson(result)) throw new TypeError("Planner recipe policy must contain canonical values.");
  return structuredClone(result);
}

/** Explicit legacy policy projection only; no conversion of old schedules into
 * new variants, no participant allocation and no restoration of run evidence. */
export function plannerRecipePolicyFromPackageV1(packageValue) {
  return validatePlannerRecipePolicyV1({
    schema: PLANNER_RECIPE_POLICY_SCHEMA, version: 1,
    participantCount: packageValue.settings.experiment.participantCount,
    samplingFrequencyHz: packageValue.settings.experiment.samplingFrequencyHz,
    output: packageValue.settings.output, lsl: packageValue.settings.advanced.lsl,
    playback: packageValue.playback,
  });
}

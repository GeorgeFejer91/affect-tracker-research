export const BROWSER_LSL_STATE_COLUMNS = Object.freeze([
  "current_valence",
  "current_arousal",
  "target_valence",
  "target_arousal",
  "radius",
  "angle_degrees",
  "animation_active",
  "input_active",
]);

export const BROWSER_RUN_CSV_COLUMNS = Object.freeze([
  "row_type", "run_id", "participant_id", "variant_id", "language_id",
  "recipe_sha256", "plan_sha256", "protocol_step_position", "step_kind",
  "step_label", "source_code", "relative_path", "event_type", "sequence",
  "iso_time", "elapsed_ms", "media_time_ms", "valence", "arousal",
  ...BROWSER_LSL_STATE_COLUMNS,
  "questionnaire_id", "module_id", "item_id", "answer_value", "payload_json",
]);

export const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function browserAffectState({
  currentValence = 0,
  currentArousal = 0,
  targetValence = currentValence,
  targetArousal = currentArousal,
  animationActive = false,
  inputActive = false,
} = {}) {
  const x = Number.isFinite(currentValence) ? currentValence : 0;
  const y = Number.isFinite(currentArousal) ? currentArousal : 0;
  const radius = Math.min(1, Math.hypot(x, y));
  const angle = radius === 0 ? 0 : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return Object.freeze({
    current_valence: x,
    current_arousal: y,
    target_valence: Number.isFinite(targetValence) ? targetValence : x,
    target_arousal: Number.isFinite(targetArousal) ? targetArousal : y,
    radius,
    angle_degrees: angle,
    animation_active: Boolean(animationActive),
    input_active: Boolean(inputActive),
  });
}

export function browserRunCsv(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return `${BROWSER_RUN_CSV_COLUMNS.join(",")}\n${safeRows.map(row => BROWSER_RUN_CSV_COLUMNS.map(header => csvCell(row[header])).join(",")).join("\n")}\n`;
}

import { FLUBBER_MAPPING_SPECS, validateFlubberMapping } from "./mappings.js";

export const VLC_FLUBBER_APPEARANCE_SCHEMA = "vlc-flubber-appearance/v1";

const COLOR_KEYS = ["up", "down", "left", "right", "idle", "outline", "halo", "cursor"];
const MAPPING_KEYS = Object.keys(FLUBBER_MAPPING_SPECS);

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} requires exactly ${keys.join(", ")}.`);
  }
}

function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a Boolean.`);
  return value;
}

/** Closed preset contract for native import. Position and size belong to the player. */
export function validateVlcFlubberAppearance(value) {
  exact(value, ["schema", "visual", "presentation", "mappings"], "VLC Flubber appearance");
  if (value.schema !== VLC_FLUBBER_APPEARANCE_SCHEMA) throw new TypeError("Unsupported VLC Flubber appearance schema.");
  exact(value.visual, ["transparency", "flubber", "colors"], "Appearance visual");
  exact(value.visual.flubber, ["showOutline", "outlineThickness", "showHalo"], "Appearance Flubber");
  exact(value.visual.colors, COLOR_KEYS, "Appearance colors");
  exact(value.presentation, ["colorAnchors", "halo"], "Appearance presentation");
  exact(value.presentation.halo, ["widthPercent", "gradient", "steepness"], "Appearance halo");
  exact(value.mappings, MAPPING_KEYS, "Appearance mappings");
  if (!["axes", "corners"].includes(value.presentation.colorAnchors)) {
    throw new TypeError("Appearance color anchors must be axes or corners.");
  }
  const colors = Object.fromEntries(COLOR_KEYS.map(key => {
    const color = value.visual.colors[key];
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/u.test(color)) {
      throw new TypeError(`Appearance color ${key} must be a six-digit hex color.`);
    }
    return [key, color.toLowerCase()];
  }));
  return Object.freeze({
    schema: VLC_FLUBBER_APPEARANCE_SCHEMA,
    visual: Object.freeze({
      transparency: number(value.visual.transparency, 0, 1, "Appearance transparency"),
      flubber: Object.freeze({
        showOutline: boolean(value.visual.flubber.showOutline, "Outline visibility"),
        outlineThickness: number(value.visual.flubber.outlineThickness, 0, 20, "Outline thickness"),
        showHalo: boolean(value.visual.flubber.showHalo, "Halo visibility"),
      }),
      colors: Object.freeze(colors),
    }),
    presentation: Object.freeze({
      colorAnchors: value.presentation.colorAnchors,
      halo: Object.freeze({
        widthPercent: number(value.presentation.halo.widthPercent, 0, 10000, "Halo width"),
        gradient: boolean(value.presentation.halo.gradient, "Halo gradient"),
        steepness: number(value.presentation.halo.steepness, 0.1, 10, "Halo steepness"),
      }),
    }),
    mappings: Object.freeze(Object.fromEntries(MAPPING_KEYS.map(key => [key, validateFlubberMapping(key, value.mappings[key])]))),
  });
}

// Accept the active preview fields without reading unrelated response or input controls.
export function createVlcFlubberAppearance(feedback) {
  if (feedback?.presentation?.renderer !== "flubber") {
    throw new TypeError("Select Classic Flubber before exporting its appearance.");
  }
  return validateVlcFlubberAppearance({
    schema: VLC_FLUBBER_APPEARANCE_SCHEMA,
    visual: {
      transparency: feedback.visual?.transparency,
      flubber: feedback.visual?.flubber,
      colors: feedback.visual?.colors,
    },
    presentation: {
      colorAnchors: feedback.presentation.colorAnchors,
      halo: feedback.presentation.halo,
    },
    mappings: feedback.mappings,
  });
}

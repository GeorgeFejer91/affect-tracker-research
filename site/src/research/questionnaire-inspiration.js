const CATALOGUE_ENTRY_KEYS = Object.freeze([
  "id",
  "name",
  "shortName",
  "domain",
  "forms",
  "languageTags",
  "reuseStatus",
  "reuseNote",
  "sourceUrl",
  "sourceLabel",
  "bundledAssetIds",
]);

const DOMAINS = new Set(["emotion", "interoception"]);
const REUSE_STATUSES = new Set([
  "bundled",
  "reusePermitted",
  "nonCommercial",
  "permissionRequired",
  "verifyTerms",
]);
const STABLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty trimmed string.`);
  }
  return value;
}

function requireUniqueStringArray(value, path, { allowEmpty = false, pattern = null } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  }
  const members = value.map((member, index) => {
    const normalized = requireNonEmptyString(member, `${path}[${index}]`);
    if (pattern && !pattern.test(normalized)) {
      throw new TypeError(`${path}[${index}] has an unsupported value.`);
    }
    return normalized;
  });
  if (new Set(members).size !== members.length) {
    throw new TypeError(`${path} must not contain duplicates.`);
  }
  return members;
}

export function validateQuestionnaireInspirationCatalogue(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Questionnaire inspiration catalogue must be a non-empty array.");
  }

  const ids = new Set();
  for (const [index, entry] of value.entries()) {
    const path = `Questionnaire inspiration catalogue[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`${path} must be an object.`);
    }
    const keys = Object.keys(entry).sort();
    const expectedKeys = [...CATALOGUE_ENTRY_KEYS].sort();
    if (keys.length !== expectedKeys.length || keys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      throw new TypeError(`${path} must contain exactly the supported fields.`);
    }

    const id = requireNonEmptyString(entry.id, `${path}.id`);
    if (!STABLE_ID.test(id)) throw new TypeError(`${path}.id must be a stable kebab-case identifier.`);
    if (ids.has(id)) throw new TypeError(`Questionnaire inspiration catalogue repeats id ${id}.`);
    ids.add(id);

    requireNonEmptyString(entry.name, `${path}.name`);
    requireNonEmptyString(entry.shortName, `${path}.shortName`);
    if (!DOMAINS.has(entry.domain)) throw new TypeError(`${path}.domain is unsupported.`);
    requireUniqueStringArray(entry.forms, `${path}.forms`, { pattern: STABLE_ID });
    requireUniqueStringArray(entry.languageTags, `${path}.languageTags`, { pattern: LANGUAGE_TAG });
    if (!REUSE_STATUSES.has(entry.reuseStatus)) throw new TypeError(`${path}.reuseStatus is unsupported.`);
    requireNonEmptyString(entry.reuseNote, `${path}.reuseNote`);
    requireNonEmptyString(entry.sourceLabel, `${path}.sourceLabel`);
    requireUniqueStringArray(entry.bundledAssetIds, `${path}.bundledAssetIds`, {
      allowEmpty: true,
      pattern: STABLE_ID,
    });

    const sourceUrl = new URL(requireNonEmptyString(entry.sourceUrl, `${path}.sourceUrl`));
    if (sourceUrl.protocol !== "https:") throw new TypeError(`${path}.sourceUrl must use HTTPS.`);
  }

  return value;
}

const catalogue = [
  {
    id: "maia-2",
    name: "Multidimensional Assessment of Interoceptive Awareness, Version 2",
    shortName: "MAIA-2",
    domain: "interoception",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "reusePermitted",
    reuseNote: "Official UCSF materials describe MAIA-2 as public domain; retain source and translation attribution.",
    sourceUrl: "https://osher.ucsf.edu/research/maia",
    sourceLabel: "UCSF Osher Center MAIA resources",
    bundledAssetIds: ["maia-2-en", "maia-2-de"],
  },
  {
    id: "tas-20",
    name: "Twenty-item Toronto Alexithymia Scale",
    shortName: "TAS-20",
    domain: "emotion",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "permissionRequired",
    reuseNote: "Obtain the applicable permission or licence from the rights holders or their distributor through ePROVIDE, then upload an authorized asset for every selected language. Source-tree presence is not evidence of authorization.",
    sourceUrl: "https://eprovide.mapi-trust.org/instruments/twenty-item-toronto-alexithymia-scale",
    sourceLabel: "Mapi Research Trust ePROVIDE",
    bundledAssetIds: [],
  },
  {
    id: "phenomenological-control-scale-10",
    name: "Phenomenological Control Scale, full 10-item form",
    shortName: "PCS-10",
    domain: "interoception",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "verifyTerms",
    reuseNote: "Public OSF materials are available, but no explicit project reuse license has been verified.",
    sourceUrl: "https://osf.io/4x25a/",
    sourceLabel: "OSF Phenomenological Control Scale materials",
    bundledAssetIds: [],
  },
  {
    id: "phencon-short-adaptation",
    name: "Custom Phenomenological Control short adaptation — not standardized",
    shortName: "Custom PhenCon short adaptation — not standardized",
    domain: "interoception",
    forms: ["short"],
    languageTags: ["en", "de"],
    reuseStatus: "verifyTerms",
    reuseNote: "No standardized short form or explicit reuse grant has been verified. This custom adaptation remains rights-gated; verify permission and upload an authorized asset for every selected language.",
    sourceUrl: "https://osf.io/b7yfx/",
    sourceLabel: "OSF German Phenomenological Control Scale materials",
    bundledAssetIds: [],
  },
  {
    id: "perth-alexithymia-questionnaire",
    name: "Perth Alexithymia Questionnaire",
    shortName: "PAQ",
    domain: "emotion",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "reusePermitted",
    reuseNote: "Research materials and translations are published for reuse; retain attribution and verify the current source terms.",
    sourceUrl: "https://psychologywa.com/questionnaires/",
    sourceLabel: "Psychology WA questionnaire resources",
    bundledAssetIds: [],
  },
  {
    id: "affective-slider",
    name: "Affective Slider",
    shortName: "AS",
    domain: "emotion",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "reusePermitted",
    reuseNote: "The language-light instrument is published from a Creative Commons source; retain attribution and verify the repository license.",
    sourceUrl: "https://github.com/albertobeta/AffectiveSlider",
    sourceLabel: "Affective Slider GitHub repository",
    bundledAssetIds: [],
  },
  {
    id: "body-perception-questionnaire-20",
    name: "Body Perception Questionnaire, short 20-item form",
    shortName: "BPQ-20",
    domain: "interoception",
    forms: ["short", "20-item"],
    languageTags: ["en", "de"],
    reuseStatus: "reusePermitted",
    reuseNote: "The assessment is available for research use subject to the author's instructions and attribution requirements.",
    sourceUrl: "https://www.stephenporges.com/assessments",
    sourceLabel: "Stephen Porges assessment resources",
    bundledAssetIds: [],
  },
  {
    id: "geneva-emotion-wheel",
    name: "Geneva Emotion Wheel",
    shortName: "GEW",
    domain: "emotion",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "nonCommercial",
    reuseNote: "Use is limited to the source's non-commercial conditions; commercial use requires separate permission.",
    sourceUrl: "https://www.unige.ch/cisa/gew",
    sourceLabel: "University of Geneva CISA GEW resources",
    bundledAssetIds: [],
  },
  {
    id: "emotional-expressivity-scale",
    name: "Emotional Expressivity Scale",
    shortName: "EES",
    domain: "emotion",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "reusePermitted",
    reuseNote: "Academic research materials are provided for reuse; preserve attribution and verify the current laboratory terms.",
    sourceUrl: "https://esilab.berkeley.edu/resources/",
    sourceLabel: "UC Berkeley Emotion and Social Interaction Laboratory",
    bundledAssetIds: [],
  },
  {
    id: "emotion-regulation-questionnaire",
    name: "Emotion Regulation Questionnaire",
    shortName: "ERQ",
    domain: "emotion",
    forms: ["full"],
    languageTags: ["en", "de"],
    reuseStatus: "nonCommercial",
    reuseNote: "The German academic-use source is CC BY-NC-ND; use it unmodified, non-commercially, and with attribution.",
    sourceUrl: "https://www.psycharchives.org/en/item/6a50eb4e-2d72-462e-9c83-dc633d5ec0ad",
    sourceLabel: "PsychArchives German ERQ record",
    bundledAssetIds: [],
  },
];

validateQuestionnaireInspirationCatalogue(catalogue);

export const QUESTIONNAIRE_INSPIRATION_CATALOGUE = deepFreeze(catalogue);

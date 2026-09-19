export const STUDY_IDENTITY_SCHEMA = "affect-research-study-identity";
export const STUDY_IDENTITY_VERSION = 1;

const encoder = new TextEncoder();
const STUDY_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new TypeError("Study identity has unexpected or missing fields.");
  }
}

function title(value) {
  if (typeof value !== "string" || value !== value.trim() || value !== value.normalize("NFC")
    || !value || encoder.encode(value).length > 200 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new TypeError("Study title must be bounded, trimmed NFC text without control characters.");
  }
  return value;
}

export function createStudyIdentityV1({ id, title: requestedTitle } = {}) {
  if (typeof id !== "string" || !STUDY_ID.test(id)) {
    throw new TypeError("Study ID must start with a lowercase letter or number and contain only lowercase letters, numbers, underscores, or hyphens.");
  }
  return Object.freeze({
    schema: STUDY_IDENTITY_SCHEMA,
    version: STUDY_IDENTITY_VERSION,
    id,
    title: title(requestedTitle),
  });
}

export function validateStudyIdentityV1(value) {
  exactObject(value, ["schema", "version", "id", "title"]);
  if (value.schema !== STUDY_IDENTITY_SCHEMA || value.version !== STUDY_IDENTITY_VERSION) {
    throw new TypeError("Study identity schema/version is unsupported.");
  }
  return createStudyIdentityV1(value);
}

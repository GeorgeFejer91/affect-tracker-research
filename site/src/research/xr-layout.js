import { canonicalJson, sha256Hex } from "./canonical.js";

// P6 owns geometry only. This is an authoring contribution, never a v1 package
// or evidence that a WebXR Runner is available. No observed pose is serialized.
export const XR_LAYOUT_SCHEMA = "affect-research-xr-layout";
export const XR_LAYOUT_FILE_NAME = "xr-layout.profile.json";
export const XR_LAYOUT_MAX_BYTES = 8192;
export const XR_TARGET_REQUIREMENTS = Object.freeze({
  target: "webxr-immersive-vr",
  profileSchema: XR_LAYOUT_SCHEMA,
  profileVersion: 1,
  projection: "flat-monoscopic",
  anchor: "world-fixed-initial-head-forward",
});

export class XrLayoutError extends Error {
  constructor(field, code, message) {
    super(message);
    this.name = "XrLayoutError";
    this.segment = "P6";
    this.field = field;
    this.code = code;
  }
}

function reject(field, code, message) { throw new XrLayoutError(field, code, message); }
function object(value, keys, field) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    reject(field, "fields", `${field} must contain exactly ${keys.join(", ")}.`);
  }
}
function exact(value, expected, field) {
  if (value !== expected) reject(field, "unsupported", `${field} requires ${expected}.`);
}
function number(value, min, max, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    reject(field, "range", `${field} must be a number from ${min} to ${max}.`);
  }
}
const radians = (degrees) => degrees * Math.PI / 180;
const degrees = (radiansValue) => radiansValue * 180 / Math.PI;
const add = (a, b) => a.map((v, i) => v + b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const scale = (a, s) => a.map((v) => v * s);

export function createDefaultXrLayoutProfile() {
  // Explicit initial editor suggestions, never defaults in an imported profile.
  return {
    schema: XR_LAYOUT_SCHEMA, version: 1, target: "webxr-immersive-vr",
    projection: "flat-monoscopic", coordinateSystem: "right-up-back-metres",
    alignment: {
      kind: "world-fixed-initial-forward", forwardReference: "head-forward",
      upReference: "gravity-up", recenterPolicy: "between-attempts-only",
      trackingLossPolicy: "stop-attempt",
    },
    video: {
      distanceMetres: 2, azimuthDegrees: 0, elevationDegrees: 0,
      yawDegrees: 0, pitchDegrees: 0, rollDegrees: 0,
      widthMetres: 1.2, heightMetres: 0.675, fit: "contain",
    },
    feedback: {
      enabled: true, offsetXMetres: 0, offsetYMetres: -0.65,
      diameterMetres: 0.25, minimumGapMetres: 0.02,
    },
  };
}

// Column-vector, right-handed R = Ry(yaw) Rx(pitch) Rz(roll), applied
// roll then pitch then yaw. Local feedback depth is fixed at zero in v1.
function rotation(video) {
  const [y, p, r] = [video.yawDegrees, video.pitchDegrees, video.rollDegrees].map(radians);
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p), Math.cos(r), Math.sin(r)];
  return [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
}
const apply = (matrix, point) => matrix.map((row) => dot(row, point));
function rectangle(width, height, transform) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .map(([x, y]) => transform([x * width / 2, y * height / 2, 0]));
}

function resolveUnchecked(profile) {
  const v = profile.video;
  const a = radians(v.azimuthDegrees), e = radians(v.elevationDegrees), d = v.distanceMetres;
  const videoCentre = [d * Math.cos(e) * Math.sin(a), d * Math.sin(e), -d * Math.cos(e) * Math.cos(a)];
  const matrix = rotation(v);
  const toSetup = (point) => add(videoCentre, apply(matrix, point));
  const f = profile.feedback;
  const feedbackCentre = toSetup([f.offsetXMetres, f.offsetYMetres, 0]);
  const videoCorners = rectangle(v.widthMetres, v.heightMetres, toSetup);
  const feedbackBounds = rectangle(f.diameterMetres, f.diameterMetres,
    (point) => add(feedbackCentre, apply(matrix, point)));
  return { videoCentre, rotation: matrix, videoCorners, feedbackCentre, feedbackBounds };
}

export function validateXrLayoutProfileV1(profile) {
  object(profile, ["schema", "version", "target", "projection", "coordinateSystem", "alignment", "video", "feedback"], "profile");
  exact(profile.schema, XR_LAYOUT_SCHEMA, "schema");
  exact(profile.version, 1, "version");
  exact(profile.target, "webxr-immersive-vr", "target");
  exact(profile.projection, "flat-monoscopic", "projection");
  exact(profile.coordinateSystem, "right-up-back-metres", "coordinateSystem");
  object(profile.alignment, ["kind", "forwardReference", "upReference", "recenterPolicy", "trackingLossPolicy"], "alignment");
  const alignment = createDefaultXrLayoutProfile().alignment;
  for (const [key, value] of Object.entries(alignment)) exact(profile.alignment[key], value, `alignment.${key}`);
  const v = profile.video, f = profile.feedback;
  object(v, ["distanceMetres", "azimuthDegrees", "elevationDegrees", "yawDegrees", "pitchDegrees", "rollDegrees", "widthMetres", "heightMetres", "fit"], "video");
  number(v.distanceMetres, 0.1, 100, "video.distanceMetres");
  for (const key of ["widthMetres", "heightMetres"]) number(v[key], 0.001, 100, `video.${key}`);
  for (const key of ["azimuthDegrees", "elevationDegrees", "yawDegrees", "pitchDegrees"]) number(v[key], -80, 80, `video.${key}`);
  number(v.rollDegrees, -180, 180, "video.rollDegrees");
  exact(v.fit, "contain", "video.fit");
  object(f, ["enabled", "offsetXMetres", "offsetYMetres", "diameterMetres", "minimumGapMetres"], "feedback");
  if (typeof f.enabled !== "boolean") reject("feedback.enabled", "type", "Feedback enabled must be Boolean.");
  for (const key of ["offsetXMetres", "offsetYMetres"]) number(f[key], -100, 100, `feedback.${key}`);
  number(f.diameterMetres, 0.001, 100, "feedback.diameterMetres");
  number(f.minimumGapMetres, 0, 10, "feedback.minimumGapMetres");
  const geometry = resolveUnchecked(profile);
  const points = [...geometry.videoCorners, ...(f.enabled ? geometry.feedbackBounds : [])];
  if (points.some((point) => point[2] > -0.01)) {
    reject("video", "behind-viewer", "The complete screen and feedback footprint must stay at least 0.01 m in front of the setup viewer.");
  }
  // A front-facing plane's normal points towards the setup viewer.
  const normal = apply(geometry.rotation, [0, 0, 1]);
  if (dot(normal, scale(geometry.videoCentre, -1)) <= 0.01) {
    reject("video", "back-facing", "The screen must face the setup viewer; reduce its tilt or centre angle.");
  }
  const separation = Math.hypot(Math.max(Math.abs(f.offsetXMetres) - v.widthMetres / 2, 0),
    Math.max(Math.abs(f.offsetYMetres) - v.heightMetres / 2, 0));
  if (f.enabled && separation + 1e-12 < f.diameterMetres / 2 + f.minimumGapMetres) {
    reject("feedback", "overlap", "Move the feedback footprint outside the screen and retain the minimum gap.");
  }
  return structuredClone(profile);
}

// Actual setup-frame ray extents, including elevation extrema inside edges.
// Corner-only elevation misses the centre of a horizontal top/bottom edge.
export function angularExtents(corners) {
  const candidates = [...corners];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const delta = b.map((v, j) => v - a[j]);
    const denominator = delta[1] * dot(a, delta) - a[1] * dot(delta, delta);
    if (Math.abs(denominator) > 1e-15) {
      const t = (a[1] * dot(a, delta) - delta[1] * dot(a, a)) / denominator;
      if (t > 0 && t < 1) candidates.push(add(a, scale(delta, t)));
    }
  }
  const azimuths = candidates.map(([x, , z]) => degrees(Math.atan2(x, -z)));
  const elevations = candidates.map(([x, y, z]) => degrees(Math.atan2(y, Math.hypot(x, z))));
  const horizontal = [Math.min(...azimuths), Math.max(...azimuths)];
  const vertical = [Math.min(...elevations), Math.max(...elevations)];
  return { horizontal, vertical, widthDegrees: horizontal[1] - horizontal[0], heightDegrees: vertical[1] - vertical[0] };
}

export function resolveXrLayoutProfileV1(profile, media = null) {
  const valid = validateXrLayoutProfileV1(profile);
  const geometry = resolveUnchecked(valid);
  let fittedSize = [valid.video.widthMetres, valid.video.heightMetres];
  if (media !== null) {
    object(media, ["displayWidth", "displayHeight"], "media");
    number(media.displayWidth, 1, 100000, "media.displayWidth");
    number(media.displayHeight, 1, 100000, "media.displayHeight");
    const fit = Math.min(fittedSize[0] / media.displayWidth, fittedSize[1] / media.displayHeight);
    fittedSize = [media.displayWidth * fit, media.displayHeight * fit];
  }
  const fittedCorners = rectangle(...fittedSize, (p) => add(geometry.videoCentre, apply(geometry.rotation, p)));
  return { ...geometry, fittedSize, fittedCorners, screenAngles: angularExtents(geometry.videoCorners),
    videoAngles: angularExtents(fittedCorners) };
}

// P1 supplies this verified display-only projection. Asset identities remain
// opaque; P6 never infers them from filenames, bytes or catalogue ordering.
export function resolveXrCatalogueV1(profile, catalogueGeometry) {
  if (!Array.isArray(catalogueGeometry) || catalogueGeometry.length > 10000) {
    reject("media", "catalogue", "Bind at most 10000 verified P1 display-geometry entries.");
  }
  validateXrLayoutProfileV1(profile);
  const identities = new Set();
  return catalogueGeometry.map((entry) => {
    object(entry, ["assetId", "displayWidth", "displayHeight"], "media");
    if (typeof entry.assetId !== "string" || entry.assetId.length < 1 || entry.assetId.length > 256
        || identities.has(entry.assetId)) reject("media", "identity", "P1 display geometry requires unique, explicit asset identities.");
    identities.add(entry.assetId);
    return { assetId: entry.assetId, geometry: resolveXrLayoutProfileV1(profile,
      { displayWidth: entry.displayWidth, displayHeight: entry.displayHeight }) };
  });
}

export function canEditXrAngularSize(profile) {
  return ["azimuthDegrees", "elevationDegrees", "yawDegrees", "pitchDegrees", "rollDegrees"]
    .every((key) => profile.video[key] === 0);
}

export function withXrAngularSize(profile, widthDegrees, heightDegrees) {
  validateXrLayoutProfileV1(profile);
  if (!canEditXrAngularSize(profile)) reject("video", "angular-edit", "Angular size entry requires a centred, untilted screen. Use metres for other poses.");
  number(widthDegrees, 0.1, 150, "angularWidth");
  number(heightDegrees, 0.1, 150, "angularHeight");
  const next = structuredClone(profile);
  next.video.widthMetres = 2 * profile.video.distanceMetres * Math.tan(radians(widthDegrees) / 2);
  next.video.heightMetres = 2 * profile.video.distanceMetres * Math.tan(radians(heightDegrees) / 2);
  return validateXrLayoutProfileV1(next);
}

export function serializeXrLayoutProfileV1(profile) {
  return `${canonicalJson(validateXrLayoutProfileV1(profile))}\n`;
}
export function parseXrLayoutProfileV1(source) {
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > XR_LAYOUT_MAX_BYTES) {
    reject("profile", "size", "The XR profile must be UTF-8 JSON of at most 8192 bytes.");
  }
  let value;
  try { value = JSON.parse(source); } catch { reject("profile", "json", "The XR profile contains invalid JSON."); }
  const profile = validateXrLayoutProfileV1(value);
  // Exact reserialization rejects duplicate keys as well as BOM, CRLF,
  // noncanonical numbers, whitespace and missing final LF. No lossy conversion.
  if (serializeXrLayoutProfileV1(profile) !== source) reject("profile", "canonical", "Open an exact canonical XR profile exported by this editor.");
  return profile;
}
export async function xrLayoutReceipt(profile) {
  const canonicalSource = serializeXrLayoutProfileV1(profile);
  return { profile: parseXrLayoutProfileV1(canonicalSource), canonicalSource,
    sha256: await sha256Hex(canonicalSource), requirements: { ...XR_TARGET_REQUIREMENTS } };
}

export function assertXrTargetSupported(profile, target) {
  validateXrLayoutProfileV1(profile);
  object(target, ["target", "profileSchema", "profileVersion", "projection", "anchor"], "targetRequirements");
  for (const [key, value] of Object.entries(XR_TARGET_REQUIREMENTS)) exact(target[key], value, `targetRequirements.${key}`);
  return true; // Contract compatibility only, never runtime availability.
}

export function assertNoXrInV1Package(enabled) {
  if (enabled) reject("target", "v1-incompatible", "XR layout is enabled. Export the spatial authoring profile, or explicitly disable it to build/run a desktop v1 package. The master XR recipe requires P7 integration.");
}

// A pure alignment fixture/helper for the future consumer. It captures heading
// about gravity-up once; no sensor access or live/head-following update exists.
export function createWorldFromSetup(eye, forward) {
  for (const [name, point] of [["eye", eye], ["forward", forward]]) {
    if (!Array.isArray(point) || point.length !== 3 || point.some((v) => !Number.isFinite(v))) reject(name, "vector", `${name} requires three finite coordinates.`);
  }
  const length = Math.hypot(forward[0], forward[2]);
  if (!Number.isFinite(length) || length < 1e-6) reject("forward", "vertical", "A finite horizontal head-forward direction is required at setup.");
  const fx = forward[0] / length, fz = forward[2] / length;
  return { origin: [...eye], rotation: [[-fz, 0, -fx], [0, 1, 0], [fx, 0, -fz]] };
}
export function transformSetupPoint(anchor, point) { return add(anchor.origin, apply(anchor.rotation, point)); }

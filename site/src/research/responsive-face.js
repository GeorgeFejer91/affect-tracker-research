const VIEW_BOX = "0 0 200 200";

const FACE = Object.freeze({ cx: 100, cy: 100, rx: 78, ry: 88 });
const LEFT_EYE = Object.freeze({ cx: 68, cy: 80, rx: 10 });
const RIGHT_EYE = Object.freeze({ cx: 132, cy: 80, rx: 10 });
const MOUTH = Object.freeze({ leftX: 62, rightX: 138, centerX: 100, baselineY: 130 });

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function finiteOrNeutral(value) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  } catch {
    return 0;
  }
}

function svgNumber(value) {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function path(...parts) {
  return parts.join(" ");
}

export function createResponsiveFaceGeometry(input = {}) {
  const source = input !== null && (typeof input === "object" || typeof input === "function")
    ? input
    : {};
  const valence = clamp(finiteOrNeutral(source.valence), -1, 1);
  const arousal = clamp(finiteOrNeutral(source.arousal), -1, 1);
  const arousalProgress = (arousal + 1) / 2;

  const eyeOpenness = svgNumber(2 + arousalProgress * 12);
  const browLift = svgNumber(arousalProgress * 16);
  const browY = svgNumber(62 - browLift);
  const mouthCurvature = svgNumber(valence * 24);
  const mouthOpening = svgNumber(arousalProgress * 20);
  const mouthControlY = svgNumber(MOUTH.baselineY + mouthCurvature);
  const mouthUpperY = svgNumber(mouthControlY - mouthOpening / 2);
  const mouthLowerY = svgNumber(mouthControlY + mouthOpening / 2);

  const affect = Object.freeze({ valence, arousal });
  const face = Object.freeze({ ...FACE });
  const eyes = Object.freeze({
    openness: eyeOpenness,
    left: Object.freeze({ ...LEFT_EYE, ry: eyeOpenness }),
    right: Object.freeze({ ...RIGHT_EYE, ry: eyeOpenness }),
  });
  const brows = Object.freeze({
    lift: browLift,
    left: Object.freeze({
      d: path("M", 54, svgNumber(browY + 2), "Q", 68, svgNumber(browY - 2), 82, svgNumber(browY + 2)),
    }),
    right: Object.freeze({
      d: path("M", 118, svgNumber(browY + 2), "Q", 132, svgNumber(browY - 2), 146, svgNumber(browY + 2)),
    }),
  });
  const mouth = Object.freeze({
    curvature: mouthCurvature,
    opening: mouthOpening,
    controlY: mouthControlY,
    center: Object.freeze({
      d: path("M", MOUTH.leftX, MOUTH.baselineY, "Q", MOUTH.centerX, mouthControlY, MOUTH.rightX, MOUTH.baselineY),
    }),
    shape: Object.freeze({
      d: path(
        "M", MOUTH.leftX, MOUTH.baselineY,
        "Q", MOUTH.centerX, mouthUpperY, MOUTH.rightX, MOUTH.baselineY,
        "Q", MOUTH.centerX, mouthLowerY, MOUTH.leftX, MOUTH.baselineY,
        "Z",
      ),
    }),
  });

  return Object.freeze({ viewBox: VIEW_BOX, affect, face, eyes, brows, mouth });
}

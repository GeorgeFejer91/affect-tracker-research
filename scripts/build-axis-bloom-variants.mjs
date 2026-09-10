import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFlubberPath,
  createProfiles,
  createProjectionOffsets,
} from "../site/src/math.js";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const outputDirectory = path.join(
  repositoryRoot,
  "desktop",
  "icons",
  "concepts",
  "axis-bloom-variants",
);
const profiles = createProfiles();

export const AXIS_BLOOM_VARIANTS = Object.freeze([
  Object.freeze({
    id: "axis-01-bloom-bold",
    name: "Axis Bloom Bold",
    summary: "The selected concept is distilled into a stronger small-size mark.",
  }),
  Object.freeze({
    id: "axis-02-petal-compass",
    name: "Petal Compass",
    summary: "Four overlapping Flubbers turn the affect axes into a compact bloom.",
  }),
  Object.freeze({
    id: "axis-03-orbit-bloom",
    name: "Orbit Bloom",
    summary: "A four-color Flubber ring surrounds a calm measured center.",
  }),
  Object.freeze({
    id: "axis-04-prism-bloom",
    name: "Prism Bloom",
    summary: "The directional field becomes a crisp, Flubber-edged diamond.",
  }),
  Object.freeze({
    id: "axis-05-aurora-axis",
    name: "Aurora Axis",
    summary: "The four directions blend into a softer continuous affect field.",
  }),
]);

function flubberPath({
  seed,
  x,
  y,
  phase,
  amplitudeScale = 1,
  disorderScale = 1,
  baseShape = "circle",
}) {
  return buildFlubberPath({
    profiles,
    offsets: createProjectionOffsets(seed, profiles.waveCount),
    x,
    y,
    phase,
    amplitudeScale,
    disorderScale,
    baseShape,
    reducedMotion: false,
  }).path;
}

function svgDocument({ id, name, description, definitions, artwork }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title description" data-family="axis-bloom" data-concept="${id}" shape-rendering="geometricPrecision">
  <title id="title">Affect Research — Axis Bloom ${name} app logo</title>
  <desc id="description">${description}</desc>
  <defs>
${definitions}
  </defs>
${artwork}
</svg>
`;
}

function darkTile(backgroundId = "background") {
  return `  <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#${backgroundId})"/>
  <rect x="48" y="48" width="928" height="928" rx="208" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="4"/>`;
}

function buildPetalCompass() {
  const petal = flubberPath({
    seed: "affect-research-axis-petal-compass",
    x: 0.86,
    y: 0.5,
    phase: 0.66,
    amplitudeScale: 0.5,
    disorderScale: 0.28,
  });
  const echo = flubberPath({
    seed: "affect-research-axis-petal-echo",
    x: 0.82,
    y: 0.38,
    phase: 2.36,
    amplitudeScale: 0.42,
    disorderScale: 0.24,
  });

  return svgDocument({
    id: "axis-02-petal-compass",
    name: "Petal Compass",
    description: "Four overlapping gold, mint, blue, and coral Flubbers form a directional flower around a dark measured center.",
    definitions: `    <radialGradient id="background" cx="50%" cy="44%" r="74%">
      <stop offset="0" stop-color="#202631"/>
      <stop offset="0.68" stop-color="#0b0f16"/>
      <stop offset="1" stop-color="#040509"/>
    </radialGradient>
    <linearGradient id="up-petal" x1="512" y1="154" x2="512" y2="526" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe49a"/>
      <stop offset="1" stop-color="#ffd166"/>
    </linearGradient>
    <linearGradient id="right-petal" x1="870" y1="512" x2="498" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a8ffd1"/>
      <stop offset="1" stop-color="#5dffb0"/>
    </linearGradient>
    <linearGradient id="down-petal" x1="512" y1="870" x2="512" y2="498" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#90a5ff"/>
      <stop offset="1" stop-color="#5c7cfa"/>
    </linearGradient>
    <linearGradient id="left-petal" x1="154" y1="512" x2="526" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff9aa4"/>
      <stop offset="1" stop-color="#ff5b68"/>
    </linearGradient>`,
    artwork: `${darkTile()}
  <path d="${echo}" transform="translate(512 512) rotate(8) scale(350)" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="0.028" stroke-linejoin="round"/>
  <path d="${petal}" transform="translate(512 338) rotate(-90) scale(192 178)" fill="url(#up-petal)" stroke="#ffffff" stroke-opacity="0.48" stroke-width="0.035" stroke-linejoin="round"/>
  <path d="${petal}" transform="translate(686 512) scale(192 178)" fill="url(#right-petal)" stroke="#ffffff" stroke-opacity="0.48" stroke-width="0.035" stroke-linejoin="round"/>
  <path d="${petal}" transform="translate(512 686) rotate(90) scale(192 178)" fill="url(#down-petal)" stroke="#ffffff" stroke-opacity="0.48" stroke-width="0.035" stroke-linejoin="round"/>
  <path d="${petal}" transform="translate(338 512) rotate(180) scale(192 178)" fill="url(#left-petal)" stroke="#ffffff" stroke-opacity="0.48" stroke-width="0.035" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="70" fill="#090d13" stroke="#ffffff" stroke-opacity="0.86" stroke-width="12"/>
  <circle cx="512" cy="512" r="20" fill="#dce4e7"/>`,
  });
}

function buildOrbitBloom() {
  const outer = flubberPath({
    seed: "affect-research-axis-orbit-outer",
    x: 0.9,
    y: 0.58,
    phase: 0.42,
    amplitudeScale: 0.52,
    disorderScale: 0.26,
  });
  const inner = flubberPath({
    seed: "affect-research-axis-orbit-inner",
    x: 0.78,
    y: 0.22,
    phase: 2.14,
    amplitudeScale: 0.38,
    disorderScale: 0.22,
  });

  return svgDocument({
    id: "axis-03-orbit-bloom",
    name: "Orbit Bloom",
    description: "A continuous four-color Flubber orbit wraps around a quiet inner field with a centered measurement point.",
    definitions: `    <radialGradient id="background" cx="50%" cy="43%" r="74%">
      <stop offset="0" stop-color="#20252e"/>
      <stop offset="0.7" stop-color="#0a0e14"/>
      <stop offset="1" stop-color="#030408"/>
    </radialGradient>
    <radialGradient id="core" cx="43%" cy="36%" r="72%">
      <stop offset="0" stop-color="#26323b"/>
      <stop offset="1" stop-color="#090d13"/>
    </radialGradient>
    <clipPath id="orbit-field" clipPathUnits="userSpaceOnUse">
      <path d="${outer}" transform="translate(512 512) rotate(-3) scale(350)"/>
    </clipPath>`,
    artwork: `${darkTile()}
  <g clip-path="url(#orbit-field)">
    <rect x="140" y="140" width="744" height="744" fill="#b7b7b7"/>
    <path d="M512 512 122 122H902Z" fill="#ffd166"/>
    <path d="M512 512 902 122V902Z" fill="#5dffb0"/>
    <path d="M512 512 902 902H122Z" fill="#5c7cfa"/>
    <path d="M512 512 122 902V122Z" fill="#ff5b68"/>
  </g>
  <path d="${inner}" transform="translate(512 512) rotate(7) scale(238)" fill="url(#core)" stroke="#ffffff" stroke-opacity="0.7" stroke-width="0.045" stroke-linejoin="round"/>
  <path d="M512 300V406M618 512H724M512 618V724M300 512H406" fill="none" stroke="#06090e" stroke-opacity="0.58" stroke-width="26" stroke-linecap="round"/>
  <path d="${outer}" transform="translate(512 512) rotate(-3) scale(350)" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="0.03" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="54" fill="#edf4ef"/>
  <circle cx="512" cy="512" r="28" fill="#111820"/>`,
  });
}

function buildPrismBloom() {
  const prism = flubberPath({
    seed: "affect-research-axis-prism-field",
    x: 0.78,
    y: 0.66,
    phase: 0.82,
    amplitudeScale: 0.42,
    disorderScale: 0.22,
    baseShape: "square",
  });
  const echo = flubberPath({
    seed: "affect-research-axis-prism-echo",
    x: 0.88,
    y: 0.36,
    phase: 2.62,
    amplitudeScale: 0.34,
    disorderScale: 0.2,
    baseShape: "square",
  });
  const core = flubberPath({
    seed: "affect-research-axis-prism-core",
    x: 0.74,
    y: 0.12,
    phase: 1.72,
    amplitudeScale: 0.3,
    disorderScale: 0.18,
  });

  return svgDocument({
    id: "axis-04-prism-bloom",
    name: "Prism Bloom",
    description: "The four affect directions meet in a Flubber-edged diamond with a compact living core.",
    definitions: `    <radialGradient id="background" cx="50%" cy="44%" r="73%">
      <stop offset="0" stop-color="#222631"/>
      <stop offset="0.7" stop-color="#0a0e15"/>
      <stop offset="1" stop-color="#030408"/>
    </radialGradient>
    <clipPath id="prism-field" clipPathUnits="userSpaceOnUse">
      <path d="${prism}" transform="translate(512 512) rotate(45) scale(342)"/>
    </clipPath>
    <radialGradient id="prism-core" cx="38%" cy="30%" r="74%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.34" stop-color="#dce7dc"/>
      <stop offset="1" stop-color="#727f8c"/>
    </radialGradient>`,
    artwork: `${darkTile()}
  <path d="${echo}" transform="translate(512 512) rotate(40) scale(358)" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="0.024" stroke-linejoin="round"/>
  <g clip-path="url(#prism-field)">
    <rect x="120" y="120" width="784" height="784" fill="#b7b7b7"/>
    <path d="M512 512 190 512 512 158 834 512Z" fill="#ffd166"/>
    <path d="M512 512 512 158 866 512 512 866Z" fill="#5dffb0"/>
    <path d="M512 512 866 512 512 866 158 512Z" fill="#5c7cfa"/>
    <path d="M512 512 512 866 158 512 512 158Z" fill="#ff5b68"/>
    <path d="M512 174V850M174 512H850" fill="none" stroke="#080b10" stroke-opacity="0.48" stroke-width="22" stroke-linecap="round"/>
  </g>
  <path d="${prism}" transform="translate(512 512) rotate(45) scale(342)" fill="none" stroke="#ffffff" stroke-opacity="0.86" stroke-width="0.034" stroke-linejoin="round"/>
  <path d="${core}" transform="translate(512 512) rotate(11) scale(72)" fill="url(#prism-core)" stroke="#080b10" stroke-width="0.15" stroke-linejoin="round"/>`,
  });
}

function buildAxisBloomBold() {
  const field = flubberPath({
    seed: "affect-research-axis-bloom-bold-field",
    x: 0.9,
    y: 0.56,
    phase: 0.46,
    amplitudeScale: 0.5,
    disorderScale: 0.24,
  });

  return svgDocument({
    id: "axis-01-bloom-bold",
    name: "Axis Bloom Bold",
    description: "The original four-way Axis Bloom is simplified with strong negative-space axes, a larger hub, and one decisive Flubber contour.",
    definitions: `    <radialGradient id="background" cx="50%" cy="43%" r="74%">
      <stop offset="0" stop-color="#222631"/>
      <stop offset="0.7" stop-color="#0a0e15"/>
      <stop offset="1" stop-color="#030408"/>
    </radialGradient>
    <clipPath id="bold-field" clipPathUnits="userSpaceOnUse">
      <path d="${field}" transform="translate(512 512) rotate(-4) scale(356)"/>
    </clipPath>`,
    artwork: `${darkTile()}
  <g clip-path="url(#bold-field)">
    <rect x="130" y="130" width="764" height="764" fill="#b7b7b7"/>
    <path d="M512 512 118 118H906Z" fill="#ffd166"/>
    <path d="M512 512 906 118V906Z" fill="#5dffb0"/>
    <path d="M512 512 906 906H118Z" fill="#5c7cfa"/>
    <path d="M512 512 118 906V118Z" fill="#ff5b68"/>
    <path d="M186 512H838M512 186V838" fill="none" stroke="#080b10" stroke-opacity="0.74" stroke-width="62" stroke-linecap="round"/>
  </g>
  <path d="${field}" transform="translate(512 512) rotate(-4) scale(356)" fill="none" stroke="#f6fbf8" stroke-opacity="0.9" stroke-width="0.052" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="86" fill="#080b10" stroke="#ffffff" stroke-opacity="0.88" stroke-width="14"/>
  <circle cx="512" cy="512" r="27" fill="#e5ecea"/>`,
  });
}

function buildAuroraAxis() {
  const field = flubberPath({
    seed: "affect-research-axis-aurora-field",
    x: 0.9,
    y: 0.48,
    phase: 0.34,
    amplitudeScale: 0.48,
    disorderScale: 0.24,
  });
  const echo = flubberPath({
    seed: "affect-research-axis-aurora-echo",
    x: 0.84,
    y: 0.3,
    phase: 2.52,
    amplitudeScale: 0.4,
    disorderScale: 0.22,
  });

  return svgDocument({
    id: "axis-05-aurora-axis",
    name: "Aurora Axis",
    description: "Four directional color fields blend continuously within a Flubber silhouette while bold axes preserve the measurement model.",
    definitions: `    <radialGradient id="background" cx="50%" cy="43%" r="74%">
      <stop offset="0" stop-color="#242731"/>
      <stop offset="0.7" stop-color="#0b0e15"/>
      <stop offset="1" stop-color="#030408"/>
    </radialGradient>
    <clipPath id="aurora-field" clipPathUnits="userSpaceOnUse">
      <path d="${field}" transform="translate(512 512) rotate(-4) scale(350)"/>
    </clipPath>
    <radialGradient id="up-glow" cx="512" cy="142" r="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffe39a" stop-opacity="1"/>
      <stop offset="0.58" stop-color="#ffd166" stop-opacity="0.84"/>
      <stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="right-glow" cx="882" cy="512" r="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a2ffd0" stop-opacity="1"/>
      <stop offset="0.58" stop-color="#5dffb0" stop-opacity="0.84"/>
      <stop offset="1" stop-color="#5dffb0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="down-glow" cx="512" cy="882" r="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9badff" stop-opacity="1"/>
      <stop offset="0.58" stop-color="#5c7cfa" stop-opacity="0.86"/>
      <stop offset="1" stop-color="#5c7cfa" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="left-glow" cx="142" cy="512" r="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffa0a8" stop-opacity="1"/>
      <stop offset="0.58" stop-color="#ff5b68" stop-opacity="0.84"/>
      <stop offset="1" stop-color="#ff5b68" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="aurora-core" cx="40%" cy="34%" r="72%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.42" stop-color="#dde8e6"/>
      <stop offset="1" stop-color="#98a8ac"/>
    </radialGradient>`,
    artwork: `${darkTile()}
  <g clip-path="url(#aurora-field)">
    <rect x="130" y="130" width="764" height="764" fill="#68727c"/>
    <rect x="110" y="110" width="804" height="804" fill="url(#up-glow)"/>
    <rect x="110" y="110" width="804" height="804" fill="url(#right-glow)"/>
    <rect x="110" y="110" width="804" height="804" fill="url(#down-glow)"/>
    <rect x="110" y="110" width="804" height="804" fill="url(#left-glow)"/>
    <path d="M512 194V830M194 512H830" fill="none" stroke="#080b10" stroke-opacity="0.5" stroke-width="24" stroke-linecap="round"/>
  </g>
  <path d="${field}" transform="translate(512 512) rotate(-4) scale(350)" fill="none" stroke="#ffffff" stroke-opacity="0.86" stroke-width="0.034" stroke-linejoin="round"/>
  <path d="${echo}" transform="translate(512 512) rotate(11) scale(332)" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="0.024" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="58" fill="#0a0e14" stroke="#ffffff" stroke-opacity="0.82" stroke-width="10"/>
  <circle cx="512" cy="512" r="24" fill="url(#aurora-core)"/>`,
  });
}

export function buildAxisBloomVariants() {
  return new Map([
    ["axis-01-bloom-bold.svg", buildAxisBloomBold()],
    ["axis-02-petal-compass.svg", buildPetalCompass()],
    ["axis-03-orbit-bloom.svg", buildOrbitBloom()],
    ["axis-04-prism-bloom.svg", buildPrismBloom()],
    ["axis-05-aurora-axis.svg", buildAuroraAxis()],
  ]);
}

async function checkGeneratedFiles(files) {
  const mismatches = [];
  for (const [filename, expected] of files) {
    const target = path.join(outputDirectory, filename);
    let actual;
    try {
      actual = await readFile(target, "utf8");
    } catch {
      mismatches.push(`${filename} is missing`);
      continue;
    }
    if (actual !== expected) mismatches.push(`${filename} is out of date`);
  }

  if (mismatches.length > 0) {
    throw new Error(`Generated Axis Bloom variants are not current:\n- ${mismatches.join("\n- ")}`);
  }
}

async function writeGeneratedFiles(files) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...files].map(([filename, contents]) => (
    writeFile(path.join(outputDirectory, filename), contents, "utf8")
  )));
}

async function main() {
  const files = buildAxisBloomVariants();
  if (process.argv.includes("--check")) {
    await checkGeneratedFiles(files);
    process.stdout.write(`Verified ${files.size} generated Axis Bloom SVG variants.\n`);
    return;
  }

  await writeGeneratedFiles(files);
  process.stdout.write(`Generated ${files.size} Axis Bloom SVG variants in ${outputDirectory}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  await main();
}

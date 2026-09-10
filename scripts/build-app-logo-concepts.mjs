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
const outputDirectory = path.join(repositoryRoot, "desktop", "icons", "concepts");
const profiles = createProfiles();

export const APP_LOGO_CONCEPTS = Object.freeze([
  Object.freeze({
    id: "01-interlock",
    name: "Interlock",
    summary: "Two overlapping Flubbers form a bright shared center.",
  }),
  Object.freeze({
    id: "02-nested-pulse",
    name: "Nested Pulse",
    summary: "A lively outer Flubber surrounds a calmer tracked state.",
  }),
  Object.freeze({
    id: "03-axis-bloom",
    name: "Axis Bloom",
    summary: "The four valence-arousal directions meet inside one Flubber.",
  }),
  Object.freeze({
    id: "04-echo-pair",
    name: "Echo Pair",
    summary: "Two open Flubber traces create a lightweight continuous-loop mark.",
  }),
  Object.freeze({
    id: "05-signal-cursor",
    name: "Signal Cursor",
    summary: "A small live Flubber marks a position inside a larger affect field.",
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
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-labelledby="title description" data-concept="${id}" shape-rendering="geometricPrecision">
  <title id="title">Affect Research — ${name} app logo</title>
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

function buildInterlock() {
  const left = flubberPath({
    seed: "affect-research-logo-interlock-left",
    x: 0.24,
    y: 0.42,
    phase: 0.72,
    amplitudeScale: 0.46,
    disorderScale: 0.42,
  });
  const right = flubberPath({
    seed: "affect-research-logo-interlock-right",
    x: 0.92,
    y: 0.46,
    phase: 2.18,
    amplitudeScale: 0.52,
    disorderScale: 0.34,
  });

  return svgDocument({
    id: "01-interlock",
    name: "Interlock",
    description: "A coral-and-gold Flubber overlaps a mint-and-blue Flubber, creating a luminous shared center on a deep ink rounded square.",
    definitions: `    <radialGradient id="background" cx="50%" cy="42%" r="72%">
      <stop offset="0" stop-color="#172824"/>
      <stop offset="0.7" stop-color="#08100f"/>
      <stop offset="1" stop-color="#030505"/>
    </radialGradient>
    <linearGradient id="warm" x1="170" y1="180" x2="650" y2="820" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffd166"/>
      <stop offset="1" stop-color="#ff5b68"/>
    </linearGradient>
    <linearGradient id="cool" x1="390" y1="170" x2="860" y2="850" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5dffb0"/>
      <stop offset="1" stop-color="#5c7cfa"/>
    </linearGradient>
    <clipPath id="left-flubber" clipPathUnits="userSpaceOnUse">
      <path d="${left}" transform="translate(386 536) rotate(-12) scale(244)"/>
    </clipPath>`,
    artwork: `${darkTile()}
  <circle cx="512" cy="512" r="344" fill="none" stroke="#9fffd0" stroke-opacity="0.08" stroke-width="48"/>
  <path d="${left}" transform="translate(386 536) rotate(-12) scale(244)" fill="url(#warm)" fill-opacity="0.91"/>
  <path d="${right}" transform="translate(638 488) rotate(12) scale(244)" fill="url(#cool)" fill-opacity="0.91"/>
  <path d="${right}" transform="translate(638 488) rotate(12) scale(244)" clip-path="url(#left-flubber)" fill="#efffdc" fill-opacity="0.82"/>
  <path d="${left}" transform="translate(386 536) rotate(-12) scale(244)" fill="none" stroke="#ffffff" stroke-opacity="0.66" stroke-width="0.038" stroke-linejoin="round"/>
  <path d="${right}" transform="translate(638 488) rotate(12) scale(244)" fill="none" stroke="#ffffff" stroke-opacity="0.66" stroke-width="0.038" stroke-linejoin="round"/>`,
  });
}

function buildNestedPulse() {
  const outer = flubberPath({
    seed: "affect-research-logo-nested-outer",
    x: 0.9,
    y: 0.72,
    phase: 1.08,
    amplitudeScale: 0.56,
    disorderScale: 0.32,
  });
  const inner = flubberPath({
    seed: "affect-research-logo-nested-inner",
    x: 0.9,
    y: 0.12,
    phase: 2.72,
    amplitudeScale: 0.44,
    disorderScale: 0.3,
  });

  return svgDocument({
    id: "02-nested-pulse",
    name: "Nested Pulse",
    description: "A warm-to-mint Flubber ring holds a compact mint core, expressing continuous measurement around a stable state.",
    definitions: `    <radialGradient id="background" cx="48%" cy="40%" r="75%">
      <stop offset="0" stop-color="#17241f"/>
      <stop offset="0.72" stop-color="#08100d"/>
      <stop offset="1" stop-color="#020403"/>
    </radialGradient>
    <linearGradient id="outer-pulse" x1="190" y1="174" x2="824" y2="850" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5dffb0"/>
      <stop offset="0.46" stop-color="#d9ff67"/>
      <stop offset="1" stop-color="#ff5b68"/>
    </linearGradient>
    <radialGradient id="inner-pulse" cx="38%" cy="30%" r="78%">
      <stop offset="0" stop-color="#f2ffe2"/>
      <stop offset="0.44" stop-color="#a9ff82"/>
      <stop offset="1" stop-color="#37dca0"/>
    </radialGradient>`,
    artwork: `${darkTile()}
  <circle cx="512" cy="512" r="364" fill="none" stroke="#5dffb0" stroke-opacity="0.09" stroke-width="34"/>
  <path d="${outer}" transform="translate(512 512) rotate(-7) scale(334)" fill="url(#outer-pulse)"/>
  <path d="${inner}" transform="translate(512 512) rotate(8) scale(246)" fill="url(#background)" stroke="#ffffff" stroke-opacity="0.16" stroke-width="0.026"/>
  <path d="${inner}" transform="translate(512 512) rotate(8) scale(142)" fill="url(#inner-pulse)" stroke="#ffffff" stroke-opacity="0.76" stroke-width="0.04"/>
  <circle cx="474" cy="470" r="24" fill="#ffffff" fill-opacity="0.72"/>`,
  });
}

function buildAxisBloom() {
  const field = flubberPath({
    seed: "affect-research-logo-axis-field",
    x: 0.88,
    y: 0.54,
    phase: 0.38,
    amplitudeScale: 0.54,
    disorderScale: 0.3,
  });
  const echo = flubberPath({
    seed: "affect-research-logo-axis-echo",
    x: 0.82,
    y: 0.34,
    phase: 2.42,
    amplitudeScale: 0.46,
    disorderScale: 0.28,
  });

  return svgDocument({
    id: "03-axis-bloom",
    name: "Axis Bloom",
    description: "Four directional affect colors converge inside a Flubber silhouette, with a second contour showing continuous movement.",
    definitions: `    <radialGradient id="background" cx="50%" cy="44%" r="72%">
      <stop offset="0" stop-color="#20242c"/>
      <stop offset="0.7" stop-color="#0b0e14"/>
      <stop offset="1" stop-color="#040509"/>
    </radialGradient>
    <clipPath id="axis-field" clipPathUnits="userSpaceOnUse">
      <path d="${field}" transform="translate(512 512) rotate(-4) scale(344)"/>
    </clipPath>`,
    artwork: `${darkTile()}
  <g clip-path="url(#axis-field)">
    <rect x="150" y="150" width="724" height="724" fill="#b7b7b7"/>
    <path d="M512 512 132 132H892Z" fill="#ffd166"/>
    <path d="M512 512 892 132V892Z" fill="#5dffb0"/>
    <path d="M512 512 892 892H132Z" fill="#5c7cfa"/>
    <path d="M512 512 132 892V132Z" fill="#ff5b68"/>
    <path d="M212 512H812M512 212V812" fill="none" stroke="#070a0d" stroke-opacity="0.5" stroke-width="24" stroke-linecap="round"/>
  </g>
  <path d="${field}" transform="translate(512 512) rotate(-4) scale(344)" fill="none" stroke="#ffffff" stroke-opacity="0.84" stroke-width="0.032" stroke-linejoin="round"/>
  <path d="${echo}" transform="translate(512 512) rotate(13) scale(326)" fill="none" stroke="#ffffff" stroke-opacity="0.33" stroke-width="0.024" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="52" fill="#0a0e12" stroke="#ffffff" stroke-opacity="0.74" stroke-width="10"/>`,
  });
}

function buildEchoPair() {
  const left = flubberPath({
    seed: "affect-research-logo-echo-left",
    x: 0.5,
    y: 0.48,
    phase: 1.26,
    amplitudeScale: 0.56,
    disorderScale: 0.36,
  });
  const right = flubberPath({
    seed: "affect-research-logo-echo-right",
    x: 0.74,
    y: 0.42,
    phase: 2.9,
    amplitudeScale: 0.52,
    disorderScale: 0.32,
  });

  return svgDocument({
    id: "04-echo-pair",
    name: "Echo Pair",
    description: "Two open coral and teal Flubber traces overlap like a continuous signal on a warm light tile.",
    definitions: `    <linearGradient id="background" x1="110" y1="90" x2="900" y2="930" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fafbf6"/>
      <stop offset="1" stop-color="#dfe9e4"/>
    </linearGradient>
    <linearGradient id="warm-line" x1="120" y1="250" x2="620" y2="780" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffb347"/>
      <stop offset="1" stop-color="#ef4f65"/>
    </linearGradient>
    <linearGradient id="cool-line" x1="400" y1="210" x2="890" y2="800" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#34d6a0"/>
      <stop offset="1" stop-color="#3f6ee8"/>
    </linearGradient>
    <clipPath id="echo-left" clipPathUnits="userSpaceOnUse">
      <path d="${left}" transform="translate(390 512) rotate(-9) scale(254)"/>
    </clipPath>`,
    artwork: `  <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#background)"/>
  <rect x="48" y="48" width="928" height="928" rx="208" fill="none" stroke="#10231e" stroke-opacity="0.1" stroke-width="4"/>
  <circle cx="512" cy="512" r="326" fill="#ffffff" fill-opacity="0.26"/>
  <path d="${left}" transform="translate(390 512) rotate(-9) scale(254)" fill="#ff5b68" fill-opacity="0.08" stroke="url(#warm-line)" stroke-width="0.19" stroke-linejoin="round"/>
  <path d="${right}" transform="translate(634 512) rotate(9) scale(254)" fill="#5dffb0" fill-opacity="0.08" stroke="url(#cool-line)" stroke-width="0.19" stroke-linejoin="round"/>
  <path d="${right}" transform="translate(634 512) rotate(9) scale(254)" clip-path="url(#echo-left)" fill="none" stroke="#183c35" stroke-opacity="0.76" stroke-width="0.19" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="43" fill="#16332d"/>
  <circle cx="498" cy="496" r="11" fill="#ffffff" fill-opacity="0.82"/>`,
  });
}

function buildSignalCursor() {
  const field = flubberPath({
    seed: "affect-research-logo-signal-field",
    x: 0.86,
    y: 0.58,
    phase: 0.86,
    amplitudeScale: 0.52,
    disorderScale: 0.3,
  });
  const cursor = flubberPath({
    seed: "affect-research-logo-signal-cursor",
    x: 0.82,
    y: 0.86,
    phase: 2.18,
    amplitudeScale: 1.18,
    disorderScale: 0.72,
  });

  return svgDocument({
    id: "05-signal-cursor",
    name: "Signal Cursor",
    description: "A bright small Flubber marks a measured position within a larger dark Flubber affect field and axis guide.",
    definitions: `    <radialGradient id="background" cx="48%" cy="40%" r="76%">
      <stop offset="0" stop-color="#17242b"/>
      <stop offset="0.7" stop-color="#080d12"/>
      <stop offset="1" stop-color="#030407"/>
    </radialGradient>
    <linearGradient id="field-line" x1="185" y1="785" x2="830" y2="185" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5c7cfa"/>
      <stop offset="0.48" stop-color="#ff5b68"/>
      <stop offset="1" stop-color="#5dffb0"/>
    </linearGradient>
    <radialGradient id="cursor-fill" cx="36%" cy="28%" r="78%">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.3" stop-color="#dcff83"/>
      <stop offset="1" stop-color="#48e6a2"/>
    </radialGradient>
    <clipPath id="signal-field" clipPathUnits="userSpaceOnUse">
      <path d="${field}" transform="translate(512 512) rotate(-5) scale(340)"/>
    </clipPath>`,
    artwork: `${darkTile()}
  <path d="${field}" transform="translate(512 512) rotate(-5) scale(340)" fill="#0b1619" stroke="url(#field-line)" stroke-width="0.13" stroke-linejoin="round"/>
  <g clip-path="url(#signal-field)" fill="none" stroke="#ffffff" stroke-linecap="round">
    <path d="M220 512H804" stroke-opacity="0.16" stroke-width="18"/>
    <path d="M512 220V804" stroke-opacity="0.16" stroke-width="18"/>
    <circle cx="512" cy="512" r="188" stroke-opacity="0.08" stroke-width="12"/>
  </g>
  <path d="M512 512 642 370" fill="none" stroke="#ffffff" stroke-opacity="0.48" stroke-width="18" stroke-linecap="round"/>
  <circle cx="512" cy="512" r="27" fill="#d8e5e1"/>
  <path d="${cursor}" transform="translate(642 370) rotate(8) scale(104)" fill="url(#cursor-fill)" stroke="#ffffff" stroke-opacity="0.92" stroke-width="0.07" stroke-linejoin="round"/>
  <circle cx="620" cy="346" r="13" fill="#ffffff" fill-opacity="0.75"/>`,
  });
}

export function buildAppLogoConcepts() {
  return new Map([
    ["01-interlock.svg", buildInterlock()],
    ["02-nested-pulse.svg", buildNestedPulse()],
    ["03-axis-bloom.svg", buildAxisBloom()],
    ["04-echo-pair.svg", buildEchoPair()],
    ["05-signal-cursor.svg", buildSignalCursor()],
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
    throw new Error(`Generated app-logo concepts are not current:\n- ${mismatches.join("\n- ")}`);
  }
}

async function writeGeneratedFiles(files) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...files].map(([filename, contents]) => (
    writeFile(path.join(outputDirectory, filename), contents, "utf8")
  )));
}

async function main() {
  const files = buildAppLogoConcepts();
  if (process.argv.includes("--check")) {
    await checkGeneratedFiles(files);
    process.stdout.write(`Verified ${files.size} generated app-logo SVGs.\n`);
    return;
  }

  await writeGeneratedFiles(files);
  process.stdout.write(`Generated ${files.size} app-logo SVGs in ${outputDirectory}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  await main();
}

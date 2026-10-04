import { readFile, writeFile } from "node:fs/promises";
import { canonicalJson, canonicalSha256 } from "../../site/src/research/canonical.js";
import {
  compilePlannerRecipeV3, compilePlannerRecipeV4,
  reconstructPlannerRecipeSelectionV3, reconstructPlannerRecipeSelectionV4,
  reproducePlannerRecipeV3, reproducePlannerRecipeV4,
  serializePlannerRecipeV3, serializePlannerRecipeV4,
  parseSupportedPlannerRecipe,
} from "../../site/src/research/planner-recipe.js";
import { browserDisplayGeometry } from "../../site/src/research/video-catalogue-contribution.js";
import { externalizePlannerRecipe } from "../../site/src/research/planner-recipe-assets.js";
import { plannerRecipeTransportText } from "../../site/src/research/planner-recipe-transport.js";
import { resolveRunnerSelection } from "../../runner/src/recipe.js";
import { controlledCore } from "./planner-recipe-v3-fixture.js";
import { runnerMasterV3Fixture } from "./runner-master-v3-fixture.js";

const url = name => new URL(`./${name}`, import.meta.url);
const read = async name => JSON.parse(await readFile(url(name), "utf8"));
const write = (name, value) => writeFile(url(name), `${canonicalJson(value)}\n`);

for (const name of ["locations", "xr"]) {
  const { core } = await controlledCore(name);
  const recipe = await compilePlannerRecipeV3(core);
  await writeFile(url(`planner-recipe-v3-${name}.canonical.json`), await serializePlannerRecipeV3(recipe));
  const matrix = await reproducePlannerRecipeV3(recipe);
  await write(`planner-recipe-v3-${name}-reproduction.json`, matrix);
  const hashes = [];
  for (const { selectionSha256: ignored, ...selector } of matrix.cases) {
    if (selector.presentationTarget !== recipe.presentationTarget) continue;
    const selected = await reconstructPlannerRecipeSelectionV3(recipe, selector);
    hashes.push({ selector, sha256: await canonicalSha256(selected) });
    if (name === "xr") await write("planner-recipe-v3-xr-layout.json", selected.layout);
  }
  await write(`planner-recipe-v3-${name}-selection-hashes.json`, hashes);
}

const runner = await runnerMasterV3Fixture();
await writeFile(url("runner-master-v3-owner.canonical.json"), runner.source);
await write("runner-master-v3-owner-selections.canonical.json", runner.selections);

const oldV4 = await read("planner-recipe-v4-surveyjs.canonical.json");
const { integrity: ignoredIntegrity, ...v4Core } = oldV4;
v4Core.segments.P1 = (await controlledCore()).core.segments.P1;
const v4 = await compilePlannerRecipeV4(v4Core);
await writeFile(url("planner-recipe-v4-surveyjs.canonical.json"), await serializePlannerRecipeV4(v4));
await write("planner-recipe-v4-surveyjs.reproduction.json", await reproducePlannerRecipeV4(v4));
const priorSelection = await read("planner-recipe-v4-surveyjs.selection.json");
await write("planner-recipe-v4-surveyjs.selection.json", await reconstructPlannerRecipeSelectionV4(v4, {
  variantId: priorSelection.variant.variantId,
  languageId: priorSelection.language.languageId,
  languageSelectionPath: priorSelection.language.languageSelectionPath,
  presentationTarget: priorSelection.presentationTarget,
}));

const v4Document = await parseSupportedPlannerRecipe(new TextEncoder().encode(await serializePlannerRecipeV4(v4)));
const v5Document = await externalizePlannerRecipe(v4Document);
await writeFile(url("planner-recipe-v5.canonical.json"), v5Document.canonicalSourceText);
await writeFile(url("planner-recipe-v5.bundle.json"), plannerRecipeTransportText(v5Document));
const plans = [];
for (const language of ["en", "de"]) for (const variant of v5Document.recipe.segments.P3.variants) {
  plans.push(await resolveRunnerSelection(v5Document, "P001", ["both", language], variant.variantId));
}
await write("planner-recipe-v5.plans.json", plans);

const lslCore = structuredClone(v4Core);
lslCore.policy.lsl.enabled = true;
lslCore.policy.lsl.sourceId = "affect-research-diagnostic";
const lslV4 = await compilePlannerRecipeV4(lslCore);
const lslDocument = await externalizePlannerRecipe(await parseSupportedPlannerRecipe(
  new TextEncoder().encode(await serializePlannerRecipeV4(lslV4)),
));
await writeFile(url("runner-recording-master-v5-lsl.bundle.json"), plannerRecipeTransportText(lslDocument));

const fixture = await read("controlled-video-geometry-v3.json");
for (const entry of fixture.workspace.videoCatalogue.entries) {
  entry.geometry = browserDisplayGeometry({
    videoWidth: entry.geometry.displayWidthPx,
    videoHeight: entry.geometry.displayHeightPx,
  });
}
delete fixture.vectors;
const { integritySha256: oldHash, ...catalogueCore } = fixture.workspace.videoCatalogue;
fixture.workspace.videoCatalogue.integritySha256 = await canonicalSha256(catalogueCore);
await write("controlled-video-geometry-v3.json", fixture);

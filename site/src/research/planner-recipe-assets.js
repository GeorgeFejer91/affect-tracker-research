import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import { parsePlannerRecipeV4, reproducePlannerRecipeV4, reconstructPlannerRecipeSelectionV4, compilePlannerRecipeV1, compilePlannerRecipeV2, compilePlannerRecipeV3, compilePlannerRecipeV4 } from "./planner-recipe.js";
import { createQuestionnairePresentationV3 } from "./questionnaire-recipe-v2.js";
import { readPlannerRecipeJsonBytes, exactRecipeObject, freezeRecipeValue, PLANNER_RECIPE_SEGMENTS } from "./planner-recipe-wire.js";
import { PLANNER_ASSET_BUNDLE_SCHEMA } from "./planner-recipe-transport.js";

const encoder = new TextEncoder();
const HASH = /^[a-f0-9]{64}$/u;
const CORE = ["schema", "version", "recipeId", "presentationTarget", "policy", "segments", "contentIntegrity"];
const REF = ["questionnaireId", "language", "definitionSha256", "format", "relativePath", "sha256", "byteLength", "metadata"];
export const QUESTIONNAIRE_ASSET_LIMIT = 4 * 1024 * 1024;
const fileText = value => `${canonicalJson(value)}\n`;

export function validateQuestionnaireAssetReference(ref) {
  exactRecipeObject(ref, REF, "Questionnaire asset reference");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(ref.questionnaireId)
    || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(ref.language)
    || !HASH.test(ref.sha256) || !HASH.test(ref.definitionSha256)
    || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 1 || ref.byteLength > QUESTIONNAIRE_ASSET_LIMIT
    || !["surveyjs", "questionnaire-definition"].includes(ref.format)) throw new TypeError("Invalid questionnaire asset identity, format or size.");
  const suffix = ref.format === "surveyjs" ? "survey" : "definition";
  const expected = `assets/questionnaires/${ref.questionnaireId.toLowerCase()}/${ref.language.toLowerCase()}/${ref.sha256}.${suffix}.json`;
  if (ref.relativePath !== expected) throw new TypeError("Questionnaire assets require their exact portable content-addressed path.");
  if (ref.format === "surveyjs") {
    exactRecipeObject(ref.metadata, ["schema", "version", "questionnaireId", "questionnaireVersion", "title", "language", "engineVersion", "completionPolicy", "source", "definitionSha256"], "SurveyJS asset metadata");
    if (ref.metadata.schema !== "affect-research-surveyjs-definition" || ref.metadata.version !== 1) throw new TypeError("Unsupported SurveyJS asset metadata.");
  } else if (ref.metadata !== null) throw new TypeError("Definition assets do not accept independent metadata.");
  return ref;
}

/** Manifest integrity is checked before a loader receives any path. Full
 * questionnaire semantics are checked after loading the exact byte snapshots. */
export async function validatePlannerAssetManifest(value) {
  exactRecipeObject(value, [...CORE, "integrity"], "Planner asset manifest");
  if (value.schema !== "affect-research-planner-recipe" || value.version !== 5) throw new TypeError("Expected Planner manifest version 5.");
  exactRecipeObject(value.segments, PLANNER_RECIPE_SEGMENTS, "Planner segments");
  const p2 = value.segments.P2;
  exactRecipeObject(p2, ["schema", "version", "questionnaires", "languageSelection", "presentation"], "Questionnaire asset contribution");
  exactRecipeObject(p2.questionnaires, ["algorithmVersion", "assets", "modules"], "Questionnaire asset registry");
  if (p2.schema !== "affect-research-questionnaire-recipe-contribution" || p2.version !== 4
    || p2.questionnaires.algorithmVersion !== "questionnaire-asset-hooks-v1"
    || !Array.isArray(p2.questionnaires.assets) || p2.questionnaires.assets.length > 256) throw new TypeError("Unsupported questionnaire asset contribution.");
  const paths = new Set(), ids = new Set();
  for (const ref of p2.questionnaires.assets) {
    validateQuestionnaireAssetReference(ref);
    if (paths.has(ref.relativePath) || ids.has(ref.questionnaireId)) throw new TypeError("Duplicate questionnaire asset path or ID.");
    paths.add(ref.relativePath); ids.add(ref.questionnaireId);
  }
  exactRecipeObject(value.integrity, ["algorithmVersion", "definitionSha256", "segmentSha256", "reproductionSha256"], "Manifest integrity");
  exactRecipeObject(value.integrity.segmentSha256, PLANNER_RECIPE_SEGMENTS, "Manifest segment hashes");
  if (value.integrity.algorithmVersion !== "planner-questionnaire-assets-v1"
    || value.integrity.definitionSha256 !== await canonicalSha256(value, { omitRootKeys: ["integrity"] })
    || value.integrity.reproductionSha256 !== value.contentIntegrity?.reproductionSha256) throw new TypeError("Questionnaire manifest integrity mismatch.");
  for (const segment of PLANNER_RECIPE_SEGMENTS) if (value.integrity.segmentSha256[segment] !== await canonicalSha256(value.segments[segment])) throw new TypeError("Manifest segment hash mismatch.");
  return value;
}

export async function externalizePlannerRecipe(document) {
  const checked = await parsePlannerRecipeV4(encoder.encode(document.canonicalSourceText));
  const content = checked.recipe, assets = [], refs = [];
  for (const definition of content.segments.P2.questionnaires.definitions) {
    const survey = definition.schema === "affect-research-surveyjs-definition";
    const { surveyJson, ...metadata } = definition;
    const sourceText = fileText(survey ? surveyJson : definition);
    const sha256 = await sha256Hex(encoder.encode(sourceText));
    const ref = { questionnaireId: definition.questionnaireId, language: definition.language,
      definitionSha256: definition.definitionSha256, format: survey ? "surveyjs" : "questionnaire-definition",
      relativePath: `assets/questionnaires/${definition.questionnaireId.toLowerCase()}/${definition.language.toLowerCase()}/${sha256}.${survey ? "survey" : "definition"}.json`,
      sha256, byteLength: encoder.encode(sourceText).length, metadata: survey ? metadata : null };
    validateQuestionnaireAssetReference(ref); refs.push(ref); assets.push({ relativePath: ref.relativePath, sourceText });
  }
  const { integrity: contentIntegrity, ...core } = structuredClone(content);
  core.version = 5; core.contentIntegrity = contentIntegrity;
  core.segments.P2.version = 4;
  core.segments.P2.questionnaires = { algorithmVersion: "questionnaire-asset-hooks-v1", assets: refs, modules: core.segments.P2.questionnaires.modules };
  const segmentSha256 = {};
  for (const segment of PLANNER_RECIPE_SEGMENTS) segmentSha256[segment] = await canonicalSha256(core.segments[segment]);
  const manifest = { ...core, integrity: { algorithmVersion: "planner-questionnaire-assets-v1", definitionSha256: await canonicalSha256(core),
    segmentSha256, reproductionSha256: contentIntegrity.reproductionSha256 } };
  return parsePlannerRecipeV5(encoder.encode(fileText(manifest)), assets);
}

/** Fresh authored saves use the complete current semantic contract. Unchanged
 * loaded files bypass this compiler and keep their original schema and bytes. */
export async function compilePlannerAssetDocument(input) {
  const compile = ({ 1: compilePlannerRecipeV1, 2: compilePlannerRecipeV2, 3: compilePlannerRecipeV3, 4: compilePlannerRecipeV4 })[input.version];
  if (!compile) throw new TypeError("Unsupported authored recipe version.");
  let recipe = await compile(input);
  if (recipe.version !== 4) {
    const { integrity, ...core } = structuredClone(recipe), p2 = core.segments.P2;
    core.version = 4; p2.version = 3; p2.questionnaires.algorithmVersion = "questionnaire-hooks-v4";
    p2.presentation = createQuestionnairePresentationV3(p2.questionnaires.definitions,
      p2.presentation.definitions.map(entry => entry.repeatLabelsEvery ?? 1));
    recipe = await compilePlannerRecipeV4(core);
  }
  return externalizePlannerRecipe({ canonicalSourceText: fileText(recipe) });
}

export async function parsePlannerRecipeV5(bytes, assets) {
  const source = readPlannerRecipeJsonBytes(bytes);
  const manifest = await validatePlannerAssetManifest(source.value);
  if (!Array.isArray(assets) || assets.length !== manifest.segments.P2.questionnaires.assets.length) throw new TypeError("Load every declared questionnaire asset before opening this experiment.");
  const definitions = [];
  for (let i = 0; i < assets.length; i++) {
    const snapshot = assets[i], ref = manifest.segments.P2.questionnaires.assets[i];
    exactRecipeObject(snapshot, ["relativePath", "sourceText"], "Questionnaire asset snapshot");
    if (snapshot.relativePath !== ref.relativePath || typeof snapshot.sourceText !== "string") throw new TypeError("Questionnaire asset closure or order mismatch.");
    const data = encoder.encode(snapshot.sourceText);
    if (data.length !== ref.byteLength || await sha256Hex(data) !== ref.sha256) throw new TypeError(`Questionnaire asset is missing or changed: ${ref.questionnaireId}.`);
    const json = readPlannerRecipeJsonBytes(data).value;
    const definition = ref.format === "surveyjs" ? { ...ref.metadata, surveyJson: json } : json;
    if (definition.questionnaireId !== ref.questionnaireId || definition.language !== ref.language || definition.definitionSha256 !== ref.definitionSha256) throw new TypeError("Questionnaire reference and definition identity differ.");
    definitions.push(definition);
  }
  const { integrity, contentIntegrity, ...content } = structuredClone(manifest);
  content.version = 4; content.integrity = contentIntegrity;
  content.segments.P2.version = 3;
  content.segments.P2.questionnaires = { algorithmVersion: "questionnaire-hooks-v4", definitions, modules: content.segments.P2.questionnaires.modules };
  const resolved = await parsePlannerRecipeV4(encoder.encode(fileText(content)));
  return freezeRecipeValue({ recipe: manifest, canonicalSourceText: source.canonicalSourceText,
    canonicalSourceByteSha256: await sha256Hex(bytes), questionnaireAssets: structuredClone(assets), resolvedRecipe: resolved.recipe });
}

export async function parsePlannerAssetBundle(bytes) {
  const { value } = readPlannerRecipeJsonBytes(bytes);
  exactRecipeObject(value, ["schema", "version", "recipeSourceText", "questionnaireAssets"], "Planner asset transport");
  if (value.schema !== PLANNER_ASSET_BUNDLE_SCHEMA || value.version !== 1 || typeof value.recipeSourceText !== "string") throw new TypeError("Unsupported Planner asset transport.");
  return parsePlannerRecipeV5(encoder.encode(value.recipeSourceText), value.questionnaireAssets);
}

export const reproducePlannerRecipeV5 = document => reproducePlannerRecipeV4(document.resolvedRecipe);
export const reconstructPlannerRecipeSelectionV5 = (document, selector) => reconstructPlannerRecipeSelectionV4(document.resolvedRecipe, selector);

import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import { parseExperimentPackageV1, EXPERIMENT_PACKAGE_SCHEMA } from "./experiment-package.js";
import { validateWorkspaceContribution } from "./workspace-contribution.js";
import { validateQuestionnaireRecipeContributionV1, validateQuestionnaireRecipeContribution } from "./questionnaire-recipe.js";
import { validateVariantDesign } from "./variant-design.js";
import { projectSavedVariantCatalogue } from "./variant-catalogue-adapter.js";
import { validateFeedbackContributionV2 } from "./feedback-settings.js";
import { resolveDesktopLayoutContribution } from "./desktop-layout-contribution.js";
import { validateXrLayoutSelection, resolveSavedXrLayoutContribution } from "./xr-layout-recipe.js";
import { compilePlannerQuestionnaireRoutesV1, PlannerRecipeIssue } from "./planner-recipe-questionnaires.js";
import { reproducePreparedPlannerRecipeV1, reconstructPreparedPlannerRecipeSelectionV1 } from "./planner-recipe-reproduction.js";
import { PLANNER_RECIPE_SCHEMA, PLANNER_RECIPE_VERSION, PLANNER_RECIPE_SEGMENTS, PLANNER_RECIPE_INTEGRITY_ALGORITHM,
  MAX_PLANNER_RECIPE_BYTES, readPlannerRecipeJsonBytes, validatePlannerRecipeStructureV1,
  boundPlannerRecipeMatrix, freezeRecipeValue, exactRecipeObject, assertPlannerRecipeJsonValue } from "./planner-recipe-wire.js";

const encoder = new TextEncoder();
async function owned(segment, operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof PlannerRecipeIssue) throw error;
    throw new PlannerRecipeIssue(segment, error.field ? `segments.${segment}.${error.field}` : `segments.${segment}`,
      error.code ?? "contribution-invalid", error.message);
  }
}

function captureJson(value) {
  assertPlannerRecipeJsonValue(value);
  const source = `${canonicalJson(value)}\n`;
  if (encoder.encode(source).byteLength > MAX_PLANNER_RECIPE_BYTES) throw new RangeError("Planner recipe exceeds 16 MiB.");
  return readPlannerRecipeJsonBytes(encoder.encode(source)).value;
}

/** Every owner validates complete saved content, independently of live media
 * readiness. A rejected/incomplete owner never becomes an omitted segment. */
async function prepareCore(input) {
  const core = validatePlannerRecipeStructureV1(captureJson(input), { integrity: false });
  const source = core.segments;
  boundPlannerRecipeMatrix(source.P2.languageSelection, source.P3.variants?.length,
    source.P6.status === "included" ? 2 : 1);
  const workspace = await owned("P1", () => validateWorkspaceContribution(source.P1));
  const questionnaires = await owned("P2", async () => {
    const result = await validateQuestionnaireRecipeContributionV1(source.P2);
    await validateQuestionnaireRecipeContribution(result);
    return result;
  });
  const compiledForms = await owned("P2", () => compilePlannerQuestionnaireRoutesV1({
    questionnaires: questionnaires.questionnaires, languageSelection: questionnaires.languageSelection,
  }));
  const presentationByDefinition = new Map(questionnaires.presentation.definitions.map(value => [value.questionnaireId, value]));
  const questionnaireRoutes = compiledForms.routes.map(route => ({ ...route,
    beforeSession: route.beforeSession.map(value => ({ ...value, presentation: structuredClone(presentationByDefinition.get(value.definition.questionnaireId)) })),
    afterSession: route.afterSession.map(value => ({ ...value, presentation: structuredClone(presentationByDefinition.get(value.definition.questionnaireId)) })),
  }));
  const variantCatalogue = await owned("P3", () => projectSavedVariantCatalogue(workspace));
  const variants = await owned("P3", () => validateVariantDesign(source.P3, variantCatalogue.library));
  const feedback = await owned("P5", () => validateFeedbackContributionV2(source.P5));
  const desktopLayout = await owned("P4", () => resolveDesktopLayoutContribution(source.P4, { workspace, feedback }));
  const selection = await owned("P6", () => validateXrLayoutSelection(source.P6));
  const xrLayout = selection.status === "included" ? await owned("P6", () => resolveSavedXrLayoutContribution(selection.profile, {
    workspaceContribution: workspace, feedbackContribution: feedback, selectedTarget: core.presentationTarget,
  })) : null;
  const normalized = { P1: workspace, P2: questionnaires, P3: variants, P4: desktopLayout.profile, P5: feedback, P6: selection };
  for (const segment of PLANNER_RECIPE_SEGMENTS) {
    if (canonicalJson(source[segment]) !== canonicalJson(normalized[segment])) {
      throw new PlannerRecipeIssue(segment, `segments.${segment}`, "noncanonical-content", "The complete saved contribution must already contain canonical values; no hidden repair is allowed.");
    }
  }
  return { core: freezeRecipeValue(core), questionnaireRoutes, variantCatalogue, desktopLayout, xrLayout };
}

async function compilePrepared(prepared) {
  const { core } = prepared;
  const definitionSha256 = await canonicalSha256(core), segmentSha256 = {};
  for (const segment of PLANNER_RECIPE_SEGMENTS) segmentSha256[segment] = await canonicalSha256(core.segments[segment]);
  const reproduction = await reproducePreparedPlannerRecipeV1(prepared, definitionSha256);
  const integrity = { algorithmVersion: PLANNER_RECIPE_INTEGRITY_ALGORITHM, definitionSha256, segmentSha256,
    reproductionSha256: await canonicalSha256(reproduction.matrix) };
  const recipe = freezeRecipeValue({ ...core, integrity });
  if (encoder.encode(`${canonicalJson(recipe)}\n`).byteLength > MAX_PLANNER_RECIPE_BYTES) throw new RangeError("Planner recipe exceeds 16 MiB.");
  return { recipe, prepared, reproduction };
}

/** Strict compiler input is the full authored core returned by accepted capture. */
export async function compilePlannerRecipeV1(core) {
  return (await compilePrepared(await prepareCore(core))).recipe;
}

/** Explicit construction adds schema/version only; every experiment value is
 * provided by its accepted owner, the researcher or the retained policy input. */
export async function createPlannerRecipeV1(options) {
  exactRecipeObject(options, ["recipeId", "presentationTarget", "policy", "segments"], "Planner recipe creation input");
  return compilePlannerRecipeV1({ schema: PLANNER_RECIPE_SCHEMA, version: PLANNER_RECIPE_VERSION, ...options });
}

async function verifyRecipe(value) {
  const saved = validatePlannerRecipeStructureV1(captureJson(value));
  const { integrity, ...core } = saved;
  const verified = await compilePrepared(await prepareCore(core));
  if (canonicalJson(integrity) !== canonicalJson(verified.recipe.integrity)) {
    throw new PlannerRecipeIssue("P7", "integrity", "integrity-mismatch", "Recipe content, owner hashes or independent reconstruction do not match its saved integrity.");
  }
  return verified;
}

export async function validatePlannerRecipeV1(value) {
  return (await verifyRecipe(value)).recipe;
}

export async function serializePlannerRecipeV1(value) {
  return `${canonicalJson(await validatePlannerRecipeV1(value))}\n`;
}

export async function parsePlannerRecipeV1(bytes) {
  const source = readPlannerRecipeJsonBytes(bytes);
  const recipe = await validatePlannerRecipeV1(source.value);
  return freezeRecipeValue({ recipe, canonicalSourceText: source.canonicalSourceText,
    canonicalSourceByteSha256: await sha256Hex(encoder.encode(source.canonicalSourceText)) });
}

/** Dispatch never widens the frozen v1 reader or attempts a lossy conversion. */
export async function parsePlannerRecipeFile(bytes) {
  const source = readPlannerRecipeJsonBytes(bytes);
  if (source.value?.schema === PLANNER_RECIPE_SCHEMA) {
    return Object.freeze({ kind: "planner-recipe-v1", document: await parsePlannerRecipeV1(bytes) });
  }
  if (source.value?.schema === EXPERIMENT_PACKAGE_SCHEMA) {
    return Object.freeze({ kind: "experiment-package-v1", document: await parseExperimentPackageV1(bytes) });
  }
  throw new TypeError("Unsupported recipe schema; no fields have been imported.");
}

export async function reproducePlannerRecipeV1(value) {
  return (await verifyRecipe(value)).reproduction.matrix;
}

export async function reconstructPlannerRecipeSelectionV1(value, selector) {
  const verified = await verifyRecipe(value);
  return reconstructPreparedPlannerRecipeSelectionV1(verified.prepared, verified.reproduction,
    verified.recipe.integrity.definitionSha256, selector);
}

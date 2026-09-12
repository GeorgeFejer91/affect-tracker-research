import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { compileVariantTimeline } from "./variant-design.js";
import { createPlannedMarkerProfile } from "./planned-marker-contract.js";
import { PlannerRecipeIssue } from "./planner-recipe-questionnaires.js";
import { boundPlannerRecipeMatrix, freezeRecipeValue } from "./planner-recipe-wire.js";

/** Internal compiler input: every owner payload and saved-content projection
 * has already passed its domain validator. Public readers must prepare it first.
 * No live snapshot, random selection, participant allocation or clock is used. */
export async function reproducePreparedPlannerRecipeV1(prepared, definitionSha256) {
  const { core, questionnaireRoutes, variantCatalogue, desktopLayout, xrLayout } = prepared;
  const profileValues = [{ presentationTarget: "desktop-screen", layout: desktopLayout }];
  if (xrLayout) profileValues.push({ presentationTarget: "webxr-immersive-vr", layout: xrLayout });
  const dimensions = boundPlannerRecipeMatrix(core.segments.P2.languageSelection,
    core.segments.P3.variants.length, profileValues.length);
  if (questionnaireRoutes.length !== dimensions.routeCount) throw new TypeError("Questionnaire projection omitted a saved language route.");

  const variantValues = [];
  for (const variant of core.segments.P3.variants) {
    const timeline = compileVariantTimeline(core.segments.P3, variant.variantId, variantCatalogue.videos);
    const markerProfile = await createPlannedMarkerProfile(core.segments.P3, variant.variantId, variantCatalogue.videos, definitionSha256);
    variantValues.push({ variantId: variant.variantId, versionSha256: variant.versionSha256, timeline, markerProfile });
  }
  const variants = [];
  for (const value of variantValues) variants.push({ variantId: value.variantId, versionSha256: value.versionSha256,
    timelineSha256: await canonicalSha256(value.timeline), markerProfileSha256: await canonicalSha256(value.markerProfile) });
  const languages = [];
  for (const route of questionnaireRoutes) languages.push({ languageId: route.languageId,
    languageSelectionPath: [...route.optionIds], questionnaireSha256: await canonicalSha256(route) });
  const presentations = [];
  for (const value of profileValues) presentations.push({ presentationTarget: value.presentationTarget,
    layoutSha256: await canonicalSha256(value.layout) });
  const policySha256 = await canonicalSha256(core.policy), feedbackSha256 = await canonicalSha256(core.segments.P5);
  const cases = [];
  for (const variant of variants) {
    for (const language of languages) {
      for (const presentation of presentations) {
        // Identity descriptors bind every derived projection without allocating
        // another full questionnaire/media object for every Cartesian row.
        const identity = { definitionSha256, policySha256, feedbackSha256, variant, language, presentation };
        cases.push({ variantId: variant.variantId, languageId: language.languageId,
          languageSelectionPath: [...language.languageSelectionPath], presentationTarget: presentation.presentationTarget,
          selectionSha256: await canonicalSha256(identity) });
      }
    }
  }
  const matrix = { algorithmVersion: "planner-recipe-reproduction-v1", definitionSha256,
    policySha256, feedbackSha256, ...dimensions, variants, languages, presentations, cases };
  return { matrix: freezeRecipeValue(matrix), variantValues, profileValues };
}

/** A selected-content projection for Planner inspection/export tooling. It is
 * not a Runner start request and never substitutes another presentation target. */
export function reconstructPreparedPlannerRecipeSelectionV1(prepared, reproduction, definitionSha256, selector) {
  if (!selector || Object.keys(selector).sort().join(",") !== "languageId,languageSelectionPath,presentationTarget,variantId"
    || !Array.isArray(selector.languageSelectionPath) || selector.presentationTarget !== prepared.core.presentationTarget) {
    throw new PlannerRecipeIssue("P7", "selection", "selection-invalid", "Select an explicit saved variant, language path and the recipe's presentation target.");
  }
  const variant = reproduction.variantValues.find(value => value.variantId === selector.variantId);
  if (!variant) throw new PlannerRecipeIssue("P3", "variantId", "variant-missing", "Choose a variant present in the saved recipe.");
  const route = prepared.questionnaireRoutes.find(value => value.languageId === selector.languageId
    && canonicalJson(value.optionIds) === canonicalJson(selector.languageSelectionPath));
  if (!route) throw new PlannerRecipeIssue("P2", "languageSelectionPath", "language-route-invalid", "Choose the exact terminal language path stored in the recipe.");
  const presentation = reproduction.profileValues.find(value => value.presentationTarget === selector.presentationTarget);
  if (!presentation) throw new PlannerRecipeIssue("P6", "presentationTarget", "presentation-missing", "The selected presentation profile is absent.");
  return freezeRecipeValue(structuredClone({ schema: "affect-research-planner-selection", version: 1,
    recipeId: prepared.core.recipeId, definitionSha256, presentationTarget: selector.presentationTarget,
    study: prepared.core.segments.P1.study, assets: prepared.core.segments.P1.videoCatalogue.entries,
    policy: prepared.core.policy, feedback: prepared.core.segments.P5,
    language: { languageId: route.languageId, languageTag: route.languageTag, languageSelectionPath: [...route.optionIds] },
    questionnaires: { beforeSession: route.beforeSession, afterSession: route.afterSession },
    variant: { variantId: variant.variantId, versionSha256: variant.versionSha256 },
    timeline: variant.timeline, markerProfile: variant.markerProfile, layout: presentation.layout,
  }));
}

import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { compileVariantTimeline } from "./variant-design.js";
import { createPlannedMarkerProfile } from "./planned-marker-contract.js";
import { PlannerRecipeIssue } from "./planner-recipe-questionnaires.js";
import { boundPlannerRecipeMatrix, freezeRecipeValue } from "./planner-recipe-wire.js";
import { projectVideoDisplayGeometry, projectSupportedVideoDisplayGeometry } from "./video-catalogue-contribution.js";

/** A versioned identity of every validated input to the layout algorithms.
 * Raw derived trigonometric floats cannot be hashed portably. Geometry itself
 * is still resolved/validated and independently compared at owner tolerance. */
export function plannerLayoutIdentityV1(presentationTarget, profile, media, feedback) {
  return { schema: "affect-research-planner-layout-identity", version: 1, presentationTarget,
    algorithms: { layout: presentationTarget === "desktop-screen" ? "desktop-layout-resolution-v1" : "xr-layout-resolution-v1",
      feedbackEnvelope: "feedback-envelope-v2", feedbackFootprint: presentationTarget === "desktop-screen" ? null : "xr-feedback-footprint-v1" },
    profile: structuredClone(profile), media: structuredClone(media), feedback: structuredClone(feedback) };
}

/** Internal compiler input: every owner payload and saved-content projection
 * has already passed its domain validator. Public readers must prepare it first.
 * No live snapshot, random selection, participant allocation or clock is used. */
export async function reproducePreparedPlannerRecipeV1(prepared, definitionSha256, algorithmVersion) {
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
  const media = (await (core.version >= 3 ? projectSupportedVideoDisplayGeometry : projectVideoDisplayGeometry)(core.segments.P1.videoCatalogue)).videos;
  for (const value of profileValues) presentations.push(algorithmVersion === "planner-recipe-reproduction-v1"
    ? { presentationTarget: value.presentationTarget, layoutSha256: await canonicalSha256(value.layout) }
    : { presentationTarget: value.presentationTarget, layoutIdentitySha256: await canonicalSha256(plannerLayoutIdentityV1(
      value.presentationTarget, value.layout.profile, media, core.segments.P5)) });
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
  const matrix = { algorithmVersion, definitionSha256,
    policySha256, feedbackSha256, ...dimensions, variants, languages, presentations, cases };
  return { matrix: freezeRecipeValue(matrix), variantValues, profileValues };
}

/** A selected-content projection for Planner inspection/export tooling. It is
 * not a Runner start request and never substitutes another presentation target. */
export function reconstructPreparedPlannerRecipeSelectionV1(prepared, reproduction, definitionSha256, selector) {
  if (prepared.core.version !== 1) throw new TypeError("Expected Planner recipe v1.");
  return reconstructSelection(prepared, reproduction, definitionSha256, selector, 1);
}

export function reconstructPreparedPlannerRecipeSelectionV2(prepared, reproduction, definitionSha256, selector) {
  if (prepared.core.version !== 2) throw new TypeError("Expected Planner recipe v2.");
  return reconstructSelection(prepared, reproduction, definitionSha256, selector, 2);
}

export function reconstructPreparedPlannerRecipeSelectionV3(prepared, reproduction, definitionSha256, selector) {
  if (prepared.core.version !== 3) throw new TypeError("Expected Planner recipe v3.");
  return reconstructSelection(prepared, reproduction, definitionSha256, selector, 3);
}
export function reconstructPreparedPlannerRecipeSelectionV4(prepared, reproduction, definitionSha256, selector) {
  if (prepared.core.version !== 4) throw new TypeError("Expected Planner recipe v4.");
  return reconstructSelection(prepared, reproduction, definitionSha256, selector, 4);
}

function reconstructSelection(prepared, reproduction, definitionSha256, selector, version) {
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
  return freezeRecipeValue(structuredClone({ schema: "affect-research-planner-selection", version,
    recipeId: prepared.core.recipeId, definitionSha256, presentationTarget: selector.presentationTarget,
    study: prepared.core.segments.P1.study, assets: prepared.core.segments.P1.videoCatalogue.entries,
    policy: prepared.core.policy, feedback: prepared.core.segments.P5,
    language: { languageId: route.languageId, languageTag: route.languageTag, languageSelectionPath: [...route.optionIds] },
    questionnaires: { beforeSession: route.beforeSession, afterSession: route.afterSession },
    variant: { variantId: variant.variantId, versionSha256: variant.versionSha256 },
    timeline: variant.timeline, markerProfile: variant.markerProfile, layout: presentation.layout,
  }));
}

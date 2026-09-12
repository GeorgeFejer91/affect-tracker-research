import { canonicalSha256 } from "../../site/src/research/canonical.js";
import { reconstructPlannerRecipeSelectionV1 } from "../../site/src/research/planner-recipe.js";
import { resolveLanguageSelectionTraversalStepV1 } from "../../site/src/research/experiment-package.js";
import { projectSavedVariantCatalogue } from "../../site/src/research/variant-catalogue-adapter.js";

export function masterParticipantId(value) {
  if (!/^P[0-9]{3,6}$/u.test(value)) throw new Error("Select a participant number.");
  const number = Number(value.slice(1));
  if (number < 1 || number > 100000 || value !== `P${String(number).padStart(3, "0")}`) throw new Error("Select a canonical participant number.");
  return value;
}

/** Exact owner reconstruction plus explicit Runner selection. No v1 conversion,
 * automatic allocation, host defaults, file permission or execution receipt. */
export async function resolveMasterPlan(receipt, participantId, path, variantId) {
  masterParticipantId(participantId);
  const recipe = receipt.recipe;
  const route = resolveLanguageSelectionTraversalStepV1(recipe.segments.P2.languageSelection, path);
  if (route.kind !== "terminal") throw new Error("Complete the participant's language choices first.");
  const selector = { variantId, languageId: route.languageId, languageSelectionPath: [...path], presentationTarget: recipe.presentationTarget };
  const selected = await reconstructPlannerRecipeSelectionV1(recipe, selector);
  if (selected.presentationTarget !== "desktop-screen") throw new Error("This master requires XR presentation. Desktop execution cannot substitute its desktop profile.");
  const variant = recipe.segments.P3.variants.find(v => v.variantId === variantId);
  const catalogue = await projectSavedVariantCatalogue(recipe.segments.P1);
  const sources = new Map(selected.markerProfile.entries.map(entry => [entry.entryId, entry.sourceCode]));
  const steps = [];
  function append(kind, entryId, sourceCode, durationMs, payload) {
    steps.push({ position: steps.length + 1, entryId, kind, sourceCode, durationMs, payload: structuredClone(payload) });
  }
  const forms = placement => {
    for (const row of selected.questionnaires[placement]) append("questionnaire", `form-${steps.length + 1}`, null, null, row);
  };
  forms("beforeSession");
  for (const entry of variant.entries) {
    if (entry.kind === "isi") {
      const definition = recipe.segments.P3.isiDefinitions.find(isi => isi.isiId === entry.referenceId);
      append("interval", entry.entryId, sources.get(entry.entryId), definition.durationMs, { entry, definition });
    } else {
      const binding = catalogue.videos.find(video => video.annotationId === entry.referenceId);
      const asset = selected.assets.find(asset => binding && asset.assetId === binding.assetId && asset.packageRelativePath === binding.relativePath);
      if (!asset) throw new Error("The selected video occurrence has no exact saved asset binding.");
      append("video", entry.entryId, sources.get(entry.entryId), asset.durationMs, { entry, asset });
    }
  }
  forms("afterSession");
  const identity = { schema: "affect-runner-master-plan", version: 1, algorithmVersion: "master-sequence-v1",
    recipeSourceByteSha256: receipt.canonicalSourceByteSha256, participantId, selector };
  return Object.freeze({ ...identity, planIdentitySha256: await canonicalSha256(identity), selected, steps });
}

export function masterTimeline(plan) {
  return plan.steps.map(step => ({ ...step, protocolPosition: step.position,
    title: step.kind === "questionnaire" ? step.payload.definition.title : step.kind === "interval"
      ? step.payload.definition.isiId : step.payload.asset.annotationId ?? step.payload.asset.sourceRelativePath,
    label: step.kind === "questionnaire" ? "Questionnaire" : step.kind === "interval" ? "Interval" : "Video",
    itemCount: step.kind === "questionnaire" ? step.payload.definition.items.length : null,
    moduleId: step.payload.module?.moduleId ?? null, blockId: null,
  }));
}

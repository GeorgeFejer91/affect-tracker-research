import {
  parseExperimentPackageV1, compileExperimentPackageSelectionV1,
  resolveLanguageSelectionTraversalStepV1,
} from "../../site/src/research/experiment-package.js";
import { evaluateFlubberMappings } from "../../site/src/research/mappings.js";

export { resolveLanguageSelectionTraversalStepV1 };

/** Complete readers only. Successor master dispatch belongs to the P7 handoff. */
export async function readRunnerRecipe(bytes) {
  return parseExperimentPackageV1(bytes);
}

export async function resolveRunnerSelection(receipt, participantId, languageSelectionPath) {
  const route = resolveLanguageSelectionTraversalStepV1(receipt.package.languageSelection, languageSelectionPath);
  if (route.kind !== "terminal") throw new Error("Complete the participant's language choices first.");
  const compiled = await compileExperimentPackageSelectionV1(receipt.package, {
    participantId, languageId: route.languageId, languageSelectionPath,
  });
  return Object.freeze({ compiled, detail: Object.freeze({
    participantId, selectedLanguageId: route.languageId,
    languageSelectionPath: Object.freeze([...languageSelectionPath]),
    experimentPackageSourceText: receipt.canonicalSourceText,
    experimentPackageSourceByteSha256: receipt.canonicalSourceByteSha256,
    packageSourceByteSha256: receipt.canonicalSourceByteSha256,
    researchSettingsSha256: compiled.settingsSha256,
    settingsSha256: compiled.settingsSha256,
    assignmentPlanSha256: compiled.experimentPlan.planHashSha256,
    assignmentSha256: compiled.assignmentSha256,
    packageDefinitionSha256: compiled.packageDefinitionSha256,
    assetBindingCount: compiled.assetBindings.length,
    protocolStepCount: compiled.protocolPlan.steps.length,
    stimulusStepCount: compiled.protocolPlan.steps.filter(({kind}) => kind === "stimulus").length,
    questionnaireStepCount: compiled.protocolPlan.steps.filter(({kind}) => kind === "questionnaire").length,
    protocolPlanSha256: compiled.protocolPlan.protocolPlanHashSha256,
    packageAssignmentSha256: compiled.assignmentSha256,
    resolvedPlan: compiled.experimentPlan,
    resolvedProtocolPlan: compiled.protocolPlan,
  }) });
}

/** Only a fully parsed recipe reaches this projection. No editor defaults. */
export function runnerFeedbackState(settings, x = 0, y = 0) {
  const visual = settings.visual;
  const mapped = evaluateFlubberMappings(settings.advanced.mappings, { x, y });
  return {
    x, y, gridVisible: visual.gridEnabled, flubberVisible: visual.flubberEnabled,
    hideFeedback: visual.hideFeedback, sizePercent: visual.sizePercent,
    transparencyPercent: visual.transparency * 100, position: { ...visual.overlayPosition },
    lockPosition: true, displayMode: "legacy", responseMode: "continuous",
    colors: { ...visual.colors }, flubber: { ...visual.flubber }, grid: { ...visual.grid },
    frequency: mapped.oscillationFrequency, edgeSmoothness: mapped.edgeSmoothness,
    amplitude: mapped.projectionAmplitude, pulseSynchrony: mapped.pulseSynchrony,
    waveVariation: mapped.waveSizeVariation, saturation: mapped.saturation,
  };
}

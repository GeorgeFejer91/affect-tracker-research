import { canonicalJson } from "./canonical.js";
import { enumerateLanguageRoutesV1 } from "./experiment-package.js";
import { validateQuestionnaireContribution, validateQuestionnairePlannerContribution } from "./questionnaire-contribution.js";

export class PlannerRecipeIssue extends TypeError {
  constructor(segment, field, code, message) {
    super(message); this.name = "PlannerRecipeIssue";
    this.segment = segment; this.field = field; this.code = code;
  }
}

/** Preserve existing language traversal, module order and scientific content.
 * Variant v1 has no blocks or attached-ISI relation. A historical hook requiring
 * either cannot silently acquire new meaning from adjacent named-ISI entries. */
export async function compilePlannerQuestionnaireRoutesV1(value) {
  let contribution;
  try {
    contribution = await validateQuestionnaireContribution(value);
    await validateQuestionnairePlannerContribution(contribution);
  } catch (error) {
    throw new PlannerRecipeIssue("P2", "questionnaires", "questionnaire-invalid", error.message);
  }
  const { modules, definitions } = contribution.questionnaires;
  for (const module of modules) {
    if (!["beforeSession", "afterSession"].includes(module.placement.kind)) {
      throw new PlannerRecipeIssue("P2", `modules.${module.moduleId}.placement`, "variant-placement-unsupported",
        `Questionnaire ${module.moduleId} uses ${module.placement.kind}, which needs an explicit variant placement contract. Its saved hook has been preserved; export cannot reinterpret it.`);
    }
  }
  const byModule = new Map(modules.map((module) => [module.moduleId, module]));
  const byDefinition = new Map(definitions.map((definition) => [definition.questionnaireId, definition]));
  const routes = enumerateLanguageRoutesV1(contribution.languageSelection).map((route) => {
    const selected = route.questionnaireModuleIds.map((id) => byModule.get(id));
    const place = (kind) => selected.filter((module) => module.placement.kind === kind).map((module) => ({
      module: structuredClone(module), definition: structuredClone(byDefinition.get(module.questionnaireId)),
    }));
    return { languageId: route.languageId, languageTag: route.languageTag, optionIds: [...route.optionIds],
      beforeSession: place("beforeSession"), afterSession: place("afterSession") };
  });
  return { contribution, routes };
}

export async function selectPlannerQuestionnaireRouteV1(contribution, { languageId, optionIds }) {
  const compiled = await compilePlannerQuestionnaireRoutesV1(contribution);
  const route = compiled.routes.find((entry) => entry.languageId === languageId
    && canonicalJson(entry.optionIds) === canonicalJson(optionIds));
  if (!route) throw new PlannerRecipeIssue("P2", "languageSelection", "language-route-invalid", "Choose an explicit terminal path in the saved language tree.");
  return route;
}

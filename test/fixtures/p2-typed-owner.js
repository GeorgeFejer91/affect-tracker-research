import { createQuestionnaireEditor } from "../../site/src/research/questionnaire-editor.js";
import { createPlannerAuthoringP2 } from "../../site/src/research/planner-authoring-p2.js";
import { questionnaireFamilyId } from "../../site/src/research/questionnaire-assets.js";
import { questionnaireRecipeFixture } from "./questionnaire-recipe-fixture.js";
import { createQuestionnairePresentationV2, validateQuestionnaireRecipeContributionV2 } from "../../site/src/research/questionnaire-recipe-v2.js";
import { verifyFormDefinitionV1 } from "../../site/src/research/form-definition.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
export const op = (operation, args = {}) => ({ kind: "operation", owner: "P2", operation, arguments: args });
export const guard = () => ({ signal: new AbortController().signal, isCurrent: () => true });
export async function typedOwner(root = { querySelector: () => null }) {
  const legacy = await questionnaireRecipeFixture();
  let context = { families: [{ id: "custom-study", label: "Study" }], languages: legacy.languageSelection.languages.map(({ questionnaireModuleIds, ...l }) => l),
    definitions: structuredClone(legacy.questionnaires.definitions), modules: structuredClone(legacy.questionnaires.modules), languageSelection: structuredClone(legacy.languageSelection), locked: false };
  const saved = [];
  const editor = createQuestionnaireEditor({ root, onChange: () => {}, onSave: async payload => {
    const d = await verifyFormDefinitionV1(payload.definition);
    if (payload.sourceFormat !== "formDefinitionV1" || new TextDecoder().decode(payload.sourceBytes) !== `${canonicalJson(d)}\n`) throw new Error("Typed source callback mismatch.");
    const { expectedPresetToken, ...serializable } = payload;
    saved.push(structuredClone(serializable));
    context.definitions = [...context.definitions.filter(v => v.questionnaireId !== d.questionnaireId), d];
    const existing = context.modules.filter(m => m.questionnaireId === d.questionnaireId);
    if (existing.length) context.modules = context.modules.map(m => m.questionnaireId === d.questionnaireId ? { ...m, definitionSha256: d.definitionSha256 } : m);
    else {
      const moduleId = `form-${d.language}`;
      context.modules.unshift({ schema: "affect-research-questionnaire-module", version: 2, moduleId, questionnaireId: d.questionnaireId, definitionSha256: d.definitionSha256, placement: { kind: "beforeSession", blockId: null } });
      context.languageSelection.languages.find(l => l.languageTag === d.language).questionnaireModuleIds.unshift(moduleId);
    }
    return { byteLength: payload.sourceBytes.length, definitionSha256: d.definitionSha256, synthetic: true };
  } });
  editor.sync({ ...context, familyForDefinition: questionnaireFamilyId });
  const adapter = createPlannerAuthoringP2({ editor, readContext: () => context, commitContext: next => { context = structuredClone(next); } });
  return { editor, adapter, saved, legacy, get context() { return context; },
    async apply(edits) { const staged = await adapter.stage(edits, guard()); if (!staged.isCurrent()) throw new Error("Stale"); staged.commit(); staged.afterCommit(); },
    async contribution() { return validateQuestionnaireRecipeContributionV2({ schema: "affect-research-questionnaire-recipe-contribution", version: 2,
      questionnaires: { algorithmVersion: "questionnaire-hooks-v3", definitions: context.definitions, modules: context.modules }, languageSelection: context.languageSelection,
      presentation: createQuestionnairePresentationV2(context.definitions) }); },
  };
}

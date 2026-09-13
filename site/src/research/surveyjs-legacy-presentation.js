import { questionnairePresentationGroups } from "./questionnaire-recipe.js";
import { surveyJsonFromQuestionnaire } from "./surveyjs-engine.js";

/** Presentation adapter only. Native legacy definitions, codes and scoring are
 * untouched; SurveyJS matrices implement the saved repeated-label layout. */
export function legacySurveyPresentation(definition, presentation) {
  const json = surveyJsonFromQuestionnaire(definition);
  if (definition.schema !== "affect-research-questionnaire-definition" || !presentation || presentation.repeatLabelsEvery === 1) {
    return { json, toData: data => data, fromData: data => data };
  }
  const groups = questionnairePresentationGroups(definition, presentation.repeatLabelsEvery).map(({ start, end }, index) => ({ name: `group-${index + 1}`, items: definition.items.slice(start, end) }));
  json.showQuestionNumbers = "off";
  json.elements = groups.map(group => ({ type: "matrix", name: group.name, titleLocation: "hidden", isRequired: true, isAllRowRequired: true,
    rows: group.items.map(item => ({ value: item.itemId, text: `${item.order}. ${item.prompt}` })),
    columns: group.items[0].options.map((option, index) => ({ value: String(index + 1), text: option.label })) }));
  return { json,
    toData(data) { return Object.fromEntries(groups.flatMap(group => {
      const rows = group.items.flatMap(item => {
        const index = item.options.findIndex(o => o.optionId === data[item.itemId]);
        return index < 0 ? [] : [[item.itemId, String(index + 1)]];
      });
      return rows.length ? [[group.name, Object.fromEntries(rows)]] : [];
    })); },
    fromData(data) { return Object.fromEntries(groups.flatMap(group => group.items.flatMap(item => {
      const value = data[group.name]?.[item.itemId];
      if (value === undefined) return [];
      const option = item.options[Number(value) - 1];
      if (!option || String(Number(value)) !== value) throw new Error("The response does not match a saved questionnaire option.");
      return [[item.itemId, option.optionId]];
    }))); },
  };
}

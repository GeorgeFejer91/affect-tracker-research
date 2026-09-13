import { renderSurveyQuestionnaire } from "../../site/src/research/surveyjs-view.js";

/** Compare complete native interpretation. Only derived P4/P5 geometry gets the
 * owner's documented numeric tolerance; authored content always matches exactly. */
export function assertMasterPlanParity(expected, observed) {
  function same(a, b, path = "") {
    if (a === b) return;
    if (typeof a === "number" && typeof b === "number" && /^selected\.layout\.(?:geometry|videos|envelope)(?:\.|\[)/u.test(path)
      && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-10) return;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) throw new Error(`Native master interpretation differs at ${path}.`);
    if (Object.keys(a).sort().join("\0") !== Object.keys(b).sort().join("\0")) throw new Error(`Native master interpretation has different fields at ${path}.`);
    for (const key of Object.keys(a)) same(a[key], b[key], path ? `${path}.${key}` : key);
  }
  same(expected, observed);
}

/** P4 uses exact authored viewport compatibility. Never fit or rescale a master
 * into an arbitrary window and imply that the authored geometry was preserved. */
export function applyMasterDesktopLayout(root, plan, viewport) {
  const profile = plan.selected.layout.profile;
  if (viewport.innerWidth !== profile.viewport.widthCssPx || viewport.innerHeight !== profile.viewport.heightCssPx) {
    throw new Error(`This experiment requires a ${profile.viewport.widthCssPx} × ${profile.viewport.heightCssPx} CSS-pixel fullscreen viewport; the current viewport is ${viewport.innerWidth} × ${viewport.innerHeight}.`);
  }
  const stage = root.querySelector("#runner-stage"); stage.classList.add("runner-master-layout");
  const place = (element, box) => {
    element.style.left = `${box.x}px`; element.style.top = `${box.y}px`;
    element.style.width = `${box.width}px`; element.style.height = `${box.height}px`;
  };
  place(stage.querySelector(".stimulus-stage"), plan.selected.layout.geometry.reference);
  place(stage.querySelector(".run-feedback-stage"), plan.selected.layout.geometry.feedback);
}

export function clearMasterDesktopLayout(root) {
  root.querySelector("#runner-stage").classList.remove("runner-master-layout");
  for (const el of root.querySelectorAll("#runner-stage > .stimulus-stage, #runner-stage > .run-feedback-stage")) {
    for (const name of ["left", "top", "width", "height"]) el.style.removeProperty(name);
  }
}

/** All master questionnaires render with the complete bundled SurveyJS UI.
 * Legacy definitions retain their native answer contracts at this adapter. */
export function renderMasterQuestionnaire(host, definition, presentation, answers = {}, options = {}) {
  if (presentation.questionnaireId !== definition.questionnaireId || presentation.definitionSha256 !== definition.definitionSha256) throw new Error("Questionnaire presentation does not bind this definition.");
  const surveyjs = definition.schema === "affect-research-surveyjs-definition";
  const typed = definition.schema === "affect-research-form-definition";
  if (definition.version !== 1 || (surveyjs ? presentation.kind !== "surveyjs" : typed ? presentation.kind !== "fields" : definition.schema !== "affect-research-questionnaire-definition" || presentation.kind && presentation.kind !== "likert")) throw new Error("Unsupported questionnaire presentation.");
  const data = surveyjs ? structuredClone(answers) : Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, typeof value === "string" ? value : value?.text ?? value?.integer ?? value?.optionId]));
  const controller = renderSurveyQuestionnaire(host, definition, { ...options, data, presentation });
  // The participant page already owns the instrument heading and instructions.
  // These are presentation settings only; the embedded definition stays exact.
  controller.model.showTitle = false;
  controller.model.showPrevButton = false;
  controller.model.completeText = definition.language.startsWith("de") ? "Weiter" : "Next";
  function read({ allowPartial = true } = {}) {
    if (!allowPartial && !controller.validate()) throw new Error("Complete the visible questionnaire before submitting.");
    const result = controller.read();
    if (surveyjs) return { surveyjs: true, ...result };
    return { answers: definition.items.filter(item => Object.hasOwn(result.data, item.itemId)).map(item => {
      const value = result.data[item.itemId];
      return { itemId: item.itemId, value: options.version === 1 ? value : typed && item.response.kind === "text" ? { kind: "text", text: value }
        : typed && item.response.kind === "integer" ? { kind: "integer", integer: value } : { kind: "singleChoice", optionId: value } };
    }) };
  }
  function progress() {
    const questions = controller.model.getAllQuestions(false, false, true).filter(q => q.isVisibleInSurvey && !["html", "image", "expression"].includes(q.getType()));
    const answered = surveyjs ? questions.filter(q => !q.isEmpty()).length : read().answers.length;
    const total = surveyjs ? questions.length : definition.items.length;
    return { answered, total, text: definition.language.startsWith("de") ? answered + " / " + total + " beantwortet" : answered + " / " + total + " answered" };
  }
  return { ...controller, usesSurveyJS: true, surveyjs, read, progress, instructions: definition.instructions ?? controller.model.description ?? "" };
}

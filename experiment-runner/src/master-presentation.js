import { renderSurveyQuestionnaire } from "../../experiment-planner/web/src/research/surveyjs-view.js";

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

const rect = (cx, cy, width, height) => ({ x: cx - width / 2, y: cy - height / 2, width, height, cx, cy });
const inside = (box, screen) => box.x >= -1e-7 && box.y >= -1e-7
  && box.x + box.width <= screen.width + 1e-7 && box.y + box.height <= screen.height + 1e-7;
const round = value => Number(value.toFixed(3));

function readViewport(viewport) {
  const width = viewport?.innerWidth, height = viewport?.innerHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The current presentation viewport is unavailable.");
  }
  return { width, height };
}

function intendedVerticalGap(reference, feedback, minimumGap) {
  if (feedback.cy >= reference.cy) return Math.max(0, feedback.y - (reference.y + reference.height), minimumGap ?? 0);
  return Math.max(0, reference.y - (feedback.y + feedback.height), minimumGap ?? 0);
}

export function resolveMasterDesktopLayoutProjection(plan, viewport) {
  const profile = plan.selected.layout.profile;
  const geometry = plan.selected.layout.geometry;
  const target = { width: profile.viewport.widthCssPx, height: profile.viewport.heightCssPx };
  const actual = readViewport(viewport);
  if (actual.width === target.width && actual.height === target.height) {
    return { mode: "authored", targetViewport: target, actualViewport: actual, scale: 1, warnings: [],
      reference: structuredClone(geometry.reference), feedback: structuredClone(geometry.feedback) };
  }
  const reference = geometry.reference, feedback = geometry.feedback;
  const gap = intendedVerticalGap(reference, feedback, geometry.gap);
  const basis = { width: Math.max(reference.width, feedback.width), height: reference.height + gap + feedback.height };
  const scale = Math.min(1, actual.width / target.width, actual.height / target.height, actual.width / basis.width, actual.height / basis.height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("The saved video and feedback layout cannot be projected into this viewport.");
  const x = actual.width / 2, total = basis.height * scale, top = Math.max(0, (actual.height - total) / 2);
  const projectedReference = rect(x, top + reference.height * scale / 2, reference.width * scale, reference.height * scale);
  const projectedFeedback = rect(x, projectedReference.y + projectedReference.height + gap * scale + feedback.height * scale / 2,
    feedback.width * scale, feedback.height * scale);
  const warnings = [
    `The saved target viewport is ${target.width} × ${target.height} CSS px; the current fullscreen viewport is ${round(actual.width)} × ${round(actual.height)} CSS px.`,
    `Runner is using the centered fallback layout: video and Flubber are horizontally aligned, Flubber is below the video, and both preserve the saved size ratio at ${round(scale)}× scale.`,
  ];
  if (!inside(projectedReference, actual) || !inside(projectedFeedback, actual)) {
    warnings.push("The fallback projection could not keep the complete video and Flubber boxes within the current viewport.");
  }
  return { mode: "centered-fallback", targetViewport: target, actualViewport: actual, scale,
    warnings, reference: projectedReference, feedback: projectedFeedback };
}

export function applyMasterDesktopLayout(root, plan, viewport) {
  const projection = resolveMasterDesktopLayoutProjection(plan, viewport);
  const stage = root.querySelector("#runner-stage"); stage.classList.add("runner-master-layout");
  const place = (element, box) => {
    element.style.left = `${box.x}px`; element.style.top = `${box.y}px`;
    element.style.width = `${box.width}px`; element.style.height = `${box.height}px`;
  };
  place(stage.querySelector(".stimulus-stage"), projection.reference);
  place(stage.querySelector(".run-feedback-stage"), projection.feedback);
  return projection;
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
  const controller = renderSurveyQuestionnaire(host, definition, { ...options, data, presentation, smartScroll: true });
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

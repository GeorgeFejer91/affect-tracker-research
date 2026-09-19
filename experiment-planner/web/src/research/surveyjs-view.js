import { createDOMPurify, SurveyThemes } from "./vendor/surveyjs-ui.js";
import { createSurveyModel } from "./surveyjs-engine.js";
import { legacySurveyPresentation } from "./surveyjs-legacy-presentation.js";
import { SURVEYJS_DEFINITION_SCHEMA } from "./surveyjs-definition.js";

/** Rendering only. Completion callbacks must await the experiment's authority. */
export function renderSurveyQuestionnaire(host, definition, { data = {}, pageNo = 0, randomSeed = 1, presentation, onChange, onComplete, preview = false, smartScroll = false } = {}) {
  const legacy = definition.schema === SURVEYJS_DEFINITION_SCHEMA ? null : legacySurveyPresentation(definition, presentation);
  const json = legacy?.json ?? definition.surveyJson;
  const model = createSurveyModel(json, { language: definition.language, data: legacy ? legacy.toData(data) : data, randomSeed });
  const readData = () => structuredClone(legacy ? legacy.fromData(model.data) : model.data);
  const appearance = host.ownerDocument.defaultView.getComputedStyle(host);
  const theme = appearance.colorScheme.includes("dark") ? SurveyThemes.DefaultDark : SurveyThemes.DefaultLight;
  model.applyTheme({ ...theme, cssVariables: { ...theme.cssVariables,
    "--sjs2-typography-font-family-text": "ui-sans-serif, system-ui, sans-serif",
    "--sjs2-color-project-brand-600": appearance.getPropertyValue("--accent").trim() || "#d4a94f",
  } });
  const purifier = createDOMPurify(host.ownerDocument.defaultView);
  model.onProcessHtml.add((_, options) => { options.html = purifier.sanitize(options.html, { FORBID_TAGS: ["style", "iframe", "object", "embed"], FORBID_ATTR: ["style", "srcdoc"] }); });
  // Experiment advancement and durable writes belong to the host.
  model.showCompletePage = preview;
  let scrollFrame = 0;
  function questionElement(question) {
    if (!question?.name) return null;
    const escape = host.ownerDocument.defaultView.CSS?.escape ?? (value => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"'));
    return host.querySelector(`[data-name="${escape(question.name)}"]`);
  }
  function scheduleSmartScroll(question) {
    if (!smartScroll || !question) return;
    if (["text", "comment", "multipletext", "html", "image", "expression"].includes(question.getType?.())) return;
    const view = host.ownerDocument.defaultView;
    view.cancelAnimationFrame(scrollFrame);
    scrollFrame = view.requestAnimationFrame(() => {
      const current = questionElement(question);
      const visibleQuestions = model.getAllQuestions(false, false, true).filter(item => item.isVisibleInSurvey);
      const index = visibleQuestions.indexOf(question);
      if (index < 0) return;
      const next = visibleQuestions[index + 1];
      const target = questionElement(next);
      if (!current || !target) return;
      const currentRect = current.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const viewportHeight = view.innerHeight || host.ownerDocument.documentElement.clientHeight;
      const answeredLow = currentRect.bottom > viewportHeight * 0.72;
      const nextMostlyHidden = targetRect.top > viewportHeight * 0.78 || targetRect.bottom > viewportHeight * 1.1;
      if (!answeredLow && !nextMostlyHidden) return;
      const desiredTop = Math.max(0, targetRect.top + view.scrollY - viewportHeight * 0.24);
      if (Math.abs(desiredTop - view.scrollY) < 12) return;
      const reduceMotion = view.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      view.scrollTo({ top: desiredTop, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }
  function focusFirstUnansweredQuestion() {
    const question = model.getAllQuestions(false, false, true)
      .find(item => item.isVisibleInSurvey && !["html", "image", "expression"].includes(item.getType?.()) && item.isEmpty());
    const element = questionElement(question);
    element?.querySelector("input, textarea, select, button")?.focus?.();
  }
  model.onValueChanged.add((_, options) => { onChange?.({ data: readData(), pageNo: model.currentPageNo }); scheduleSmartScroll(options.question); });
  model.onCurrentPageChanged.add(() => onChange?.({ data: readData(), pageNo: model.currentPageNo }));
  let completing = false;
  model.onCompleting.add(async (_, options) => {
    if (preview) return;
    options.allowComplete = false;
    if (!completing && model.validate(false, true)) {
      completing = true;
      try { await onComplete?.({ data: readData(), pageNo: model.currentPageNo }); }
      finally { completing = false; }
    }
  });
  if (Number.isSafeInteger(pageNo) && pageNo >= 0 && pageNo < model.visiblePages.length) model.currentPageNo = pageNo;
  host.replaceChildren(); host.classList.add("affect-surveyjs");
  const surface = host.ownerDocument.createElement("div");
  if (preview) { const notice = host.ownerDocument.createElement("p"); notice.className = "field-help"; notice.textContent = "Preview only. Answers are not recorded."; host.append(notice); }
  host.append(surface); model.render(surface);
  return { model, read() { return { data: readData(), pageNo: model.currentPageNo }; },
    validate() { return model.validate(false, true); },
    setDisabled(disabled) { host.inert = disabled; host.setAttribute("aria-busy", String(disabled)); },
    focusFirstUnanswered: focusFirstUnansweredQuestion,
    destroy() { host.ownerDocument.defaultView.cancelAnimationFrame(scrollFrame); model.dispose(); host.replaceChildren(); host.classList.remove("affect-surveyjs"); } };
}

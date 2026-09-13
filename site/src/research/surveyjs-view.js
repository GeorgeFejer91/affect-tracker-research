import { createDOMPurify, SurveyThemes } from "./vendor/surveyjs-ui.js";
import { createSurveyModel } from "./surveyjs-engine.js";
import { legacySurveyPresentation } from "./surveyjs-legacy-presentation.js";
import { SURVEYJS_DEFINITION_SCHEMA } from "./surveyjs-definition.js";

/** Rendering only. Completion callbacks must await the experiment's authority. */
export function renderSurveyQuestionnaire(host, definition, { data = {}, pageNo = 0, randomSeed = 1, presentation, onChange, onComplete, preview = false } = {}) {
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
  model.onValueChanged.add(() => onChange?.({ data: readData(), pageNo: model.currentPageNo }));
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
    focusFirstUnanswered() { model.focusFirstQuestionAutomatic(); },
    destroy() { model.dispose(); host.replaceChildren(); host.classList.remove("affect-surveyjs"); } };
}

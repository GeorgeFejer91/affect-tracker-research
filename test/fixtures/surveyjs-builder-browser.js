import { createQuestionnaireEditor } from "../../experiment-planner/web/src/research/questionnaire-editor.js";
import { questionnaireFamilyId } from "../../experiment-planner/web/src/research/questionnaire-assets.js";
import { importQuestionnaireAuthoring } from "../../experiment-planner/web/src/research/questionnaire-authoring.js";
import { prepareSurveySourceStorage } from "../../experiment-planner/web/src/research/surveyjs-sheet.js";
import { verifySurveyDefinition } from "../../experiment-planner/web/src/research/surveyjs-definition.js";
import { canonicalJson } from "../../experiment-planner/web/src/research/canonical.js";
const cases = [], check = (name, ok) => { if (!ok) throw Error(name); cases.push(name); };
const settle = async predicate => { for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error("Builder UI did not settle"); };
const root = document.querySelector("main"); root.id = "research-app";
root.innerHTML = `<h1>Questionnaires</h1><div id="questionnaire-sheet-list"></div><input hidden type="file" id="questionnaire-sheet-file"><dialog class="research-dialog questionnaire-sheet-preview" id="questionnaire-sheet-preview"><div class="dialog-heading"><h2 id="questionnaire-sheet-preview-title"></h2><button data-sheet-preview-close>Close</button></div><div id="questionnaire-sheet-preview-content"></div></dialog><dialog id="questionnaire-survey-import"><textarea id="questionnaire-survey-json"></textarea><p id="questionnaire-survey-error"></p><button id="questionnaire-survey-apply">Import</button><button data-survey-import-close>Cancel</button></dialog>`;
const query = selector => root.querySelector(selector), slot = '[data-sheet-key="custom/en"]';
const fire = (element, type) => element.dispatchEvent(new Event(type, { bubbles: true }));
(async () => {
  const saved = [], editor = createQuestionnaireEditor({ root, authorSurveyJs: true, onSave: async payload => {
    await verifySurveyDefinition(payload.definition); const storage = await prepareSurveySourceStorage(payload.sourceBytes, payload.definition);
    saved.push({ definition: payload.definition, raw: JSON.parse(new TextDecoder().decode(storage.bytes)) }); return { stored: true };
  } });
  editor.sync({ families: [{ id: "custom", label: "Custom questionnaire" }, { id: "demographics", label: "Demographics" }, { id: "maia-2", label: "MAIA-2" }], languages: [{ languageId: "en", languageTag: "en", label: "English" }], definitions: [], familyForDefinition: questionnaireFamilyId, locked: false });
  check("demographics starts directly in SurveyJS", editor.readAuthoringEntries().find(e => e.sheet.familyId === "demographics").sheet.kind === "surveyjs");
  const source = new Uint8Array(await (await fetch("/site/questionnaires/maia-2-en.csv")).arrayBuffer());
  const original = await importQuestionnaireAuthoring(source, { logicalName: "maia-2-en.csv" });
  editor.loadDefinition(original.definition, { familyId: "maia-2" });
  check("MAIA-2 catalogue contains all 37 SurveyJS items", query('[data-sheet-key="maia-2/en"]').querySelectorAll("[data-survey-address]").length === 37);
  query('[data-sheet-key="maia-2/en"]').open = false;
  const uploaded = { title: "Session questionnaire", elements: [{ type: "radiogroup", name: "feeling", title: "How are you feeling?", choices: ["Calm", "Alert"] }, { type: "comment", name: "notes", title: "Anything to add?" }] };
  query(`${slot} [data-sheet-action="survey-paste"]`).click(); await settle(() => query("#questionnaire-survey-import").open);
  query("#questionnaire-survey-json").value = JSON.stringify(uploaded); query("#questionnaire-survey-apply").click(); await settle(() => !query("#questionnaire-survey-import").open);
  check("uploaded elements appear in the arrangement box", query(slot).querySelectorAll("[data-survey-address]").length === 2);
  query(`${slot} [data-survey-arrange="down"]`).click();
  check("arrangement moves the actual SurveyJS element", editor.readAuthoringEntries()[0].sheet.definition.surveyJson.elements[0].name === "notes");
  const title = query(`${slot} [data-survey-title]`); title.value = "Describe how you feel"; fire(title, "input");
  const row = query(slot).querySelectorAll("[data-survey-row]")[1]; row.value = "beside"; fire(row, "change");
  check("basic layout is stored in the SurveyJS model", editor.readAuthoringEntries()[0].sheet.definition.surveyJson.elements[1].startWithNewLine === false);
  query(`${slot} [data-sheet-action="survey-excel"]`).click(); await settle(() => query(`${slot} [data-survey-paste-cell]`));
  const data = new DataTransfer(); data.setData("text/plain", "Body awareness\tNever\t0\tRarely\t1\tSometimes\t2\tOften\t3\tAlways\t4\ttrue\nAttention\tNever\t0\tRarely\t1\tSometimes\t2\tOften\t3\tAlways\t4\ttrue");
  query(`${slot} [data-survey-paste-cell]`).dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  check("Excel table paste fills two editable rows", query(slot).querySelectorAll(".survey-builder-paste tbody tr").length === 2);
  query(`${slot} [data-sheet-action="survey-append-items"]`).click(); await settle(() => !query(`${slot} [data-survey-paste-cell]`));
  check("pasted rows become questionnaire elements", editor.readAuthoringEntries()[0].sheet.definition.surveyJson.elements.length === 4);
  query(`${slot} [data-sheet-action="save"]`).click(); await settle(() => saved.length === 1 && !editor.isPending("custom", "en"));
  check("saved asset is raw SurveyJS", saved[0].raw.surveyJson === undefined && saved[0].raw.elements.length === 4);
  check("original upload remains unmodified", uploaded.elements[0].name === "feeling");
  const frozen = canonicalJson(saved[0]);
  query(`${slot} [data-sheet-action="preview"]`).click(); await settle(() => query("#questionnaire-sheet-preview").open && query('#questionnaire-sheet-preview-content textarea'));
  check("Participant preview opens a popup with real answer controls", Boolean(query('#questionnaire-sheet-preview-content input[type="radio"]')));
  const textarea = query('#questionnaire-sheet-preview-content textarea'); textarea.value = "Testing the questionnaire"; fire(textarea, "input"); fire(textarea, "change");
  const groups = new Map(); query('#questionnaire-sheet-preview-content').querySelectorAll('input[type="radio"]').forEach(input => { if (!groups.has(input.name)) groups.set(input.name, input); });
  for (const input of groups.values()) input.click();
  check("researcher can answer uploaded and pasted items", [...groups.values()].every(input => input.checked));
  check("preview responses do not alter saved definitions", canonicalJson(saved[0]) === frozen && saved.length === 1);
  if (new URL(location.href).searchParams.get("mode") !== "builder-preview") {
    query('[data-sheet-preview-close]').click(); await settle(() => query('#questionnaire-sheet-preview-content').children.length === 0); check("closing preview disposes the questionnaire", !query('#questionnaire-sheet-preview').open && query('#questionnaire-sheet-preview-content').children.length === 0);
  }
  const local = await fetch("/local-tas.csv");
  if (local.ok) {
    const imported = await importQuestionnaireAuthoring(new Uint8Array(await local.arrayBuffer()), { logicalName: "tas-20-de-handrack-2016-local.csv" });
    const tasRoot = document.createElement("div");
    const localEditor = createQuestionnaireEditor({ root: tasRoot, authorSurveyJs: true, onSave: async payload => {
      const storage = await prepareSurveySourceStorage(payload.sourceBytes, payload.definition);
      const raw = JSON.parse(new TextDecoder().decode(storage.bytes));
      check("installed TAS saves as raw SurveyJS with all 20 original prompts and codes", raw.elements.length === 20 && imported.definition.items.every((item, index) => raw.elements[index].title === item.prompt && item.options.every(option => raw.elements[index].affectResearchResponseCodes[option.optionId] === option.scoreValue)));
      return { stored: true };
    } });
    localEditor.sync({ families: [{ id: "tas-20", label: "TAS-20" }], languages: [{ languageId: "de", languageTag: "de", label: "Deutsch" }], definitions: [], familyForDefinition: questionnaireFamilyId, locked: false });
    localEditor.loadDefinition(imported.definition, { familyId: "tas-20" }); await localEditor.save("tas-20/de");
  }
  check("page stays within the viewport", document.documentElement.scrollWidth <= innerWidth + 1);
  document.querySelector('#receipt').textContent = JSON.stringify({ passed: true, cases, scope: "Real P2 component: SurveyJS import/presets, arrangement, Excel table paste, canonical asset preparation and interactive popup. Storage callback is synthetic; filesystem tests are separate." });
})().catch(error => { document.querySelector('#receipt').textContent = JSON.stringify({ passed: false, cases, error: error.stack }); });

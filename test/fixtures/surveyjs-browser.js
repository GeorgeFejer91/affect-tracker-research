import { createQuestionnaireEditor } from "../../site/src/research/questionnaire-editor.js";
import { questionnaireFamilyId } from "../../site/src/research/questionnaire-assets.js";
import { importQuestionnaireAuthoring } from "../../site/src/research/questionnaire-authoring.js";
import { verifySurveyDefinition } from "../../site/src/research/surveyjs-definition.js";
import { createQuestionnairePresentationV3 } from "../../site/src/research/questionnaire-recipe-v2.js";
import { renderMasterQuestionnaire } from "../../runner/src/master-presentation.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { NativeMasterProtocolAdapter } from "../../runner/src/master-protocol.js";
const cases = [], check = (label, ok) => { if (!ok) throw new Error(label); cases.push(label); };
const settle = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error("UI did not settle"); };
const root = document.querySelector("main"); root.id = "research-app";
root.innerHTML = `<div id="questionnaire-sheet-list"></div><input hidden type="file" id="questionnaire-sheet-file"><dialog id="questionnaire-sheet-preview"><h2 id="questionnaire-sheet-preview-title"></h2><button data-sheet-preview-close>Close</button><div id="questionnaire-sheet-preview-content"></div></dialog><dialog id="questionnaire-survey-import"><textarea id="questionnaire-survey-json"></textarea><p id="questionnaire-survey-error"></p><button id="questionnaire-survey-apply">Import</button><button data-survey-import-close>Cancel</button></dialog><section id="runner-survey"></section>`;
const query = s => root.querySelector(s), key = l => `[data-sheet-key="custom/${l}"]`;
const survey = { title: { default: "Custom questionnaire", de: "Eigener Fragebogen" }, pages: [
  { elements: [{ type: "boolean", name: "details", title: { default: "Details?", de: "Details?" } }] },
  { visibleIf: "{details} = true", elements: [{ type: "text", name: "answer", title: "Response" }, { type: "checkbox", name: "choices", choices: ["a","b","c"], validators: [{ type: "answercount", minCount: 2 }] }] },
] };
(async () => {
  const saved = [], context = { families: [{ id: "custom", label: "Custom" }], languages: ["en","de"].map(l => ({ languageId:l,languageTag:l,label:l })), definitions: [], modules: [], familyForDefinition: questionnaireFamilyId, locked: false };
  const editor = createQuestionnaireEditor({ root, onSave: async p => { const d = await verifySurveyDefinition(p.definition); check("source save contains the canonical wrapper", new TextDecoder().decode(p.sourceBytes) === canonicalJson(d)+"\n"); saved.push(d); return { stored:true }; } }); editor.sync(context);
  for (const language of ["en","de"]) {
    query(key(language)).open = true;
    query(`${key(language)} [data-sheet-action="survey-paste"]`).click();
    query("#questionnaire-survey-json").value = JSON.stringify(survey, null, 2); query("#questionnaire-survey-apply").click();
    await settle(() => !query("#questionnaire-survey-import").open);
    check(`${language} JSON import uses the SurveyJS sheet`, query(key(language)).textContent.includes("SurveyJS"));
    query(`${key(language)} [data-sheet-action="save"]`).click(); await settle(() => saved.some(d => d.language === language) && !editor.isPending("custom",language));
    check(`${language} imported JSON remains exact`, canonicalJson(saved.at(-1).surveyJson) === canonicalJson(survey));
    query(`${key(language)} [data-sheet-action="preview"]`).click(); await settle(() => query("#questionnaire-sheet-preview").open && query('#questionnaire-sheet-preview-content input'));
    check(`${language} preview uses real SurveyJS and labels its scope`, query("#questionnaire-sheet-preview-content").textContent.includes("not recorded"));
    query('[data-sheet-preview-close]').click();
  }
  const definitions = saved;
  const p2 = { schema: "affect-research-questionnaire-recipe-contribution", version:3, questionnaires:{ algorithmVersion:"questionnaire-hooks-v4",definitions,modules: definitions.map(d => ({schema:"affect-research-questionnaire-module",version:2,moduleId:`form-${d.language}`,questionnaireId:d.questionnaireId,definitionSha256:d.definitionSha256,placement:{kind:"beforeSession",blockId:null}}))}, languageSelection:{algorithmVersion:"language-tree-v1",rootNodeId:"language",languages: context.languages.map(l => ({...l,questionnaireModuleIds:[`form-${l.languageId}`]})),nodes:[{nodeId:"language",prompt:"Language",options:["en","de"].map(l=>({optionId:l,label:l,target:{kind:"language",languageId:l}}))}]},presentation:createQuestionnairePresentationV3(definitions)};
  const restored = await editor.prepareRestoreRecipe(p2,{signal:new AbortController().signal,isCurrent:()=>true}); restored.commit(); restored.afterCommit();
  check("reopening P2 preserves complete JSON and saved state", editor.readAuthoringEntries().every(e => !e.dirty && canonicalJson(e.sheet.definition.surveyJson) === canonicalJson(survey)));
  let completed = 0, changes = 0;
  const host = query("#runner-survey"), d = definitions.find(d => d.language === "de");
  let controller = renderMasterQuestionnaire(host,d,p2.presentation.definitions.find(p=>p.questionnaireId===d.questionnaireId),{}, {version:4,onChange:()=>changes++,onComplete:()=>{completed++;}});
  check("Runner renders the German title", host.textContent.includes("Eigener Fragebogen"));
  check("mandatory empty survey cannot complete", !controller.validate());
  controller.model.setValue("details",true); check("branch opens its second page", controller.model.visiblePages.length === 2);
  controller.model.nextPage();
  await settle(() => host.querySelector('input[type="text"]'));
  const input = host.querySelector('input[type="text"]'); input.value="Participant response"; input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true}));
  controller.model.setValue("choices",["a","b"]);
  check("actual text input updates SurveyJS data", controller.model.data.answer === "Participant response");
  controller.model.tryComplete(); await settle(()=>completed===1);
  check("completion callback retains the full answer object", controller.read().data.choices.length===2 && changes>0);
  const adapter = new NativeMasterProtocolAdapter({}); adapter.plan={version:4};
  check("custom data uses its explicit native command", adapter.answerAction("submit",{...controller.read(),protocolStepPosition:1}).type==="surveySubmit");
  controller.destroy();
  for (const language of ["en","de"]) {
    const bytes = new Uint8Array(await (await fetch(`/site/questionnaires/maia-2-${language}.csv`)).arrayBuffer());
    const {definition} = await importQuestionnaireAuthoring(bytes,{sourceKind:"bundled",logicalName:`maia-2-${language}.csv`});
    controller=renderMasterQuestionnaire(host,definition,{kind:"likert",questionnaireId:definition.questionnaireId,definitionSha256:definition.definitionSha256,repeatLabelsEvery:1},{},{version:4});
    check(`MAIA-2 ${language} keeps all 37 questions and exact first prompt`, controller.model.getAllQuestions().length===37 && controller.model.getAllQuestions()[0].title===definition.items[0].prompt);
    for(const item of definition.items) controller.model.setValue(item.itemId,item.options[0].optionId);
    check(`MAIA-2 ${language} returns frozen option IDs`, controller.read({allowPartial:false}).answers.every((a,i)=>a.value.optionId===definition.items[i].options[0].optionId));
    controller.destroy();
    controller=renderMasterQuestionnaire(host,definition,{kind:"likert",questionnaireId:definition.questionnaireId,definitionSha256:definition.definitionSha256,repeatLabelsEvery:5},{},{version:4});
    await settle(() => host.querySelector('input[type="radio"]'));
    check(`MAIA-2 ${language} respects saved groups of five`, controller.model.getAllQuestions().every(q => q.getType() === "matrix") && controller.model.getAllQuestions().length === 8);
    host.querySelector('input[type="radio"]').click();
    check(`MAIA-2 ${language} matrix UI preserves the first item code`, controller.read().answers[0].value.optionId === definition.items[0].options[0].optionId);
    controller.destroy();
  }
  const localTas = await fetch("/local-tas.csv");
  if (localTas.ok) {
    const { definition } = await importQuestionnaireAuthoring(new Uint8Array(await localTas.arrayBuffer()), { logicalName: "tas-20-de-handrack-2016-local.csv" });
    controller=renderMasterQuestionnaire(host,definition,{kind:"likert",questionnaireId:definition.questionnaireId,definitionSha256:definition.definitionSha256,repeatLabelsEvery:1},{},{version:4});
    check("installed German TAS remains a 20-item SurveyJS preset with exact wording", controller.model.locale === "de" && controller.model.getAllQuestions().length === 20 && controller.model.getAllQuestions()[0].title === definition.items[0].prompt);
    for(const item of definition.items) controller.model.setValue(item.itemId,item.options[0].optionId);
    check("German TAS retains all native response codes",controller.read({allowPartial:false}).answers.every((a,i)=>a.value.optionId===definition.items[i].options[0].optionId));
    controller.destroy();
  }
  controller=renderMasterQuestionnaire(host,d,p2.presentation.definitions.find(p=>p.questionnaireId===d.questionnaireId),{}, {version:4});
  check("page has no outer horizontal overflow", document.documentElement.scrollWidth<=innerWidth+1);
  document.querySelector("#receipt").textContent=JSON.stringify({passed:true,cases,scope:"Actual Planner import/save/reopen and full SurveyJS renderer; source-save callback is synthetic. Native validation/storage tested separately."});
})().catch(e=>{document.querySelector("#receipt").textContent=JSON.stringify({passed:false,cases,error:e.stack});});

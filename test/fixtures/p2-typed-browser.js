import { typedOwner, op, guard } from "./p2-typed-owner.js";
import { createQuestionnaireRoutingEditor } from "../../site/src/research/questionnaire-routing-editor.js";
import { createPlannerAuthoringSession } from "../../site/src/research/planner-authoring-session.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
const cases = [];
const check = (label, condition) => { if (!condition) throw new Error(label); cases.push(label); };
const settle = async predicate => { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error("UI did not settle"); };
const root = document.querySelector("main");
root.id = "research-app";
root.innerHTML = `<section class="setup-pane sheet-body" style="height:100%;overflow:auto"><h1>Questionnaires and forms</h1><div id="routes"></div><div id="questionnaire-sheet-list"></div></section><dialog id="questionnaire-sheet-preview" class="research-dialog questionnaire-sheet-preview" aria-labelledby="questionnaire-sheet-preview-title"><div class="dialog-heading"><h2 id="questionnaire-sheet-preview-title"></h2><button type="button" data-sheet-preview-close aria-label="Close questionnaire preview">Close</button></div><div id="questionnaire-sheet-preview-content"></div></dialog>`;
const query = selector => root.querySelector(selector);
const key = language => `[data-sheet-key="demographics/${language}"]`;
const change = (selector, value) => { const input = query(selector); input.value = value; input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
(async () => {
  if (location.protocol === "http:") {
    const raw = await import(new URL("/site/src/research/form-assets.js", location.href).href);
    check("static browser modules load exact public JSON assets", (await raw.loadDemographicsForm("en")).questionnaireId === "demographics-en" && (await raw.loadDemographicsForm("de")).questionnaireId === "demographics-de");
  }
  const s = await typedOwner(root), cli = await typedOwner();
  const session = createPlannerAuthoringSession({ owners: [s.adapter] });
  const routing = createQuestionnaireRoutingEditor({ root: query("#routes"), readContext: () => s.context,
    applyEdits: (edits, g) => session.execute({ schema: "affect-research-planner-command", version: 1,
      sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: session.revision, action: { kind: "apply", edits } }, g) });
  query('[data-routing-action="add-demographics"]').click();
  await settle(() => query(`${key("en")} [data-form-field="title"]`));
  await cli.apply([op("addDemographics")]);
  check("real routing button and CLI owner produce identical complete drafts", canonicalJson(s.adapter.read().values) === canonicalJson(cli.adapter.read().values));
  check("both language editors use typed fields instead of Likert codes", ["en", "de"].every(language => query(`${key(language)} [data-form-field="1:min"]`) && !query(`${key(language)} [data-sheet-option-count]`)));
  query(key("en")).open = true;
  change(`${key("en")} [data-form-field="title"]`, "Study demographics");
  change(`${key("en")} [data-form-field="questionnaireVersion"]`, "2");
  change(`${key("en")} [data-form-field="0:prompt"]`, "Your full name");
  change(`${key("en")} [data-form-field="0:maxUtf8Bytes"]`, "512");
  change(`${key("en")} [data-form-field="1:min"]`, "0");
  change(`${key("en")} [data-form-field="1:max"]`, "200");
  change(`${key("en")} [data-form-field="2:label:2"]`, "Another description");
  const uiDraft = s.adapter.read().values["P2.questionnaires"][0];
  await cli.apply([op("updateForm", { questionnaireId: "demographics-en", changes: { title: uiDraft.title, questionnaireVersion: uiDraft.questionnaireVersion } }),
    ...uiDraft.items.map(item => op("setFormItem", { questionnaireId: "demographics-en", itemId: item.itemId, item }))]);
  check("actual metadata/prompt/byte/age/choice inputs match typed CLI draft", canonicalJson(s.adapter.read().values) === canonicalJson(cli.adapter.read().values));
  const old = query(`${key("en")} [data-form-field="1:max"]`).value;
  change(`${key("en")} [data-form-field="1:max"]`, "1.5");
  check("invalid fractional age limit is visible and blocks save", query(`${key("en")} [data-form-field="1:max"]`).getAttribute("aria-invalid") === "true" && s.adapter.validate().some(i => i.code === "invalid_draft"));
  check("CLI readback preserves the invalid raw field value", s.adapter.read().values["P2.questionnaires"][0].items[1].response.max === "1.5");
  let rejected = false; try { await s.editor.saveAuthoringQuestionnaire("demographics-en", guard()); } catch { rejected = true; }
  check("invalid UI draft cannot reach source-save callback", rejected && s.saved.length === 0);
  change(`${key("en")} [data-form-field="1:max"]`, old);
  for (const language of ["en", "de"]) {
    query(`${key(language)} [data-sheet-action="save"]`).click();
    await settle(() => s.saved.some(p => p.language === language) && !s.editor.isPending("demographics", language));
    await cli.editor.saveAuthoringQuestionnaire(`demographics-${language}`, guard());
  }
  check("UI Save and CLI save create equal accepted P2 v2 contributions", canonicalJson(await s.contribution()) === canonicalJson(await cli.contribution()));
  for (const language of ["en", "de"]) {
    query(`${key(language)} [data-sheet-action="preview"]`).click();
    await settle(() => query("#questionnaire-sheet-preview").open);
    check(`${language} preview renders text, whole years and eight labelled choices`, query('#questionnaire-sheet-preview-content input[type="text"]') && query('#questionnaire-sheet-preview-content input[type="number"]') && root.querySelectorAll('#questionnaire-sheet-preview-content input[type="radio"]').length === 8);
    check(`${language} preview declares that answers are not recorded`, query("#questionnaire-sheet-preview-content").textContent.includes("not recorded"));
    query("[data-sheet-preview-close]").click();
  }
  check("editor fits viewport without outer horizontal overflow", document.documentElement.scrollWidth <= window.innerWidth + 1);
  if (window.innerWidth >= 1000) {
    query(`${key("de")} [data-sheet-action="preview"]`).click(); await settle(() => query("#questionnaire-sheet-preview").open);
    const bounds = query("#questionnaire-sheet-preview").getBoundingClientRect();
    check("German preview fits viewport", bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.height <= window.innerHeight);
  } else {
    query(key("en")).open = true;
    change(`${key("en")} [data-form-field="1:max"]`, "invalid");
    query(`${key("en")} [data-form-field="1:max"]`).scrollIntoView({ block: "center" });
    await new Promise(resolve => setTimeout(resolve, 500));
    const bounds = query(`${key("en")} [data-form-field="1:max"]`).getBoundingClientRect();
    check("invalid field is visible in the scrollable setup pane", bounds.top >= 0 && bounds.bottom <= window.innerHeight);
  }
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, cases, boundary: "Actual P2 editor/routing/shared JS session; source-save callback is synthetic, no native persistence or Runner execution." });
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, cases, error: error.stack }); });

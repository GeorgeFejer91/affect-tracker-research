import { createQuestionnaireRoutingEditor } from "../../site/src/research/questionnaire-routing-editor.js";
import { createQuestionnaireEditor } from "../../site/src/research/questionnaire-editor.js";
import { createPlannerAuthoringP2 } from "../../site/src/research/planner-authoring-p2.js";
import { questionnaireFamilyId } from "../../site/src/research/questionnaire-assets.js";
import { questionnaireRecipeFixture } from "./questionnaire-recipe-fixture.js";
import { sheetToAuthoring } from "../../site/src/research/questionnaire-sheet.js";

const cases = [], receipt = document.querySelector("#receipt");
const check = (condition, label) => { if (!condition) throw new Error(label); cases.push(label); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const main = document.querySelector("main");
main.style.cssText = "max-width:1100px;margin:0 auto;padding:16px;min-width:0";
main.innerHTML = '<h1>Questionnaire assets</h1><section id="editor"><div id="questionnaire-sheet-list" class="questionnaire-sheet-list"></div></section><section id="routing"></section>';
(async () => {
try {
  const recipe = await questionnaireRecipeFixture();
  let context = { families: [{ id: "custom-study", label: "Custom study" }], locked: false,
    languages: recipe.languageSelection.languages.map(({ questionnaireModuleIds: _ids, ...language }) => language),
    definitions: recipe.questionnaires.definitions, modules: recipe.questionnaires.modules, languageSelection: recipe.languageSelection };
  let intents = 0, nativeSaves = 0;
  const editorRoot = document.querySelector("#editor");
  const editor = createQuestionnaireEditor({ root: editorRoot, onChange: () => { intents++; }, onSave: async () => { nativeSaves++; } });
  editor.sync({ ...context, familyForDefinition: questionnaireFamilyId });
  const germanBefore = JSON.stringify(editor.readAuthoringEntries()[1].sheet.rows);
  const adapter = createPlannerAuthoringP2({ editor, readContext: () => context, commitContext: value => { context = structuredClone(value); } });
  let operation = Promise.resolve(), uiEdits = 0;
  const root = document.querySelector("#routing");
  const routing = createQuestionnaireRoutingEditor({ root, readContext: () => context, applyEdits(edits, guard) {
    operation = (async () => {
      const candidate = await adapter.stage(edits, guard);
      if (!candidate.isCurrent()) throw new Error("Fixture stage became stale.");
      candidate.commit(); candidate.afterCommit(); uiEdits++;
      return { status: adapter.validate().length ? "incomplete" : "applied" };
    })(); return operation;
  } });
  const openAll = async () => { root.querySelectorAll("details").forEach(details => { details.open = true; }); await tick(); };
  async function change(selector, value) {
    await openAll();
    const control = root.querySelector(selector); if (!control) throw new Error(`Missing ${selector}`);
    control.value = value; control.dispatchEvent(new Event("change", { bubbles: true }));
    await operation; await tick();
    if (root.querySelector(".sheet-error")?.textContent) throw new Error(root.querySelector(".sheet-error").textContent);
  }
  async function click(selector) {
    await openAll(); const control = root.querySelector(selector);
    if (!control || control.disabled) throw new Error(`Unavailable ${selector}`);
    control.click(); await operation; await tick();
  }
  await change('[data-routing-field="node-prompt"][data-node-id="group"]', "Choose the study language");
  check(context.languageSelection.nodes[0].prompt === "Choose the study language", "visible language prompt edits reach the actual owner");
  await change('[data-routing-field="module-placement"][data-module-id="en-0"]', "afterSession");
  check(context.modules[0].placement.kind === "afterSession", "visible placement selector reaches the existing typed module");
  await click('[data-routing-action="route-move"][data-language-id="en"][data-value="en-1"][data-direction="-1"]');
  check(context.languageSelection.languages[0].questionnaireModuleIds[0] === "en-1", "terminal questionnaire order is editable independently");
  check(context.modules[0].moduleId === "en-0", "terminal reordering does not silently reorder module definitions");
  await click('[data-routing-action="wrap-route"][data-node-id="language"][data-option-id="en"]');
  check(context.languageSelection.nodes.length === 3, "add-follow-up gesture creates a valid additional language question");
  await change('[data-routing-field="option-label"][data-node-id="question-1"][data-option-id="en"]', "English participants");
  check(context.languageSelection.nodes[2].options[0].label === "English participants", "participant route labels are directly editable");
  check(JSON.stringify(context.definitions) === JSON.stringify(recipe.questionnaires.definitions), "routing changes preserve all scientific content and hashes");
  check(editor.pendingKeys().length === 0 && nativeSaves === 0, "routing is not a source edit or hidden asset write");
  const currentEdits = uiEdits;
  context.locked = true; routing.sync();
  root.querySelector('[data-routing-field="node-prompt"]').dispatchEvent(new Event("change", { bubbles: true }));
  await tick(); check(uiEdits === currentEdits, "locked routing cannot issue owner edits");
  context.locked = false; routing.sync();

  const sheetSelector = '[data-sheet-key="custom-study/en"]';
  async function sheetOpen() {
    const details = editorRoot.querySelector(sheetSelector); details.open = true;
    details.querySelector(".sheet-options").open = true;
    details.querySelector("[data-sheet-metadata]").open = true;
    await tick(); return details;
  }
  async function sheetChange(selector, value, event = "change") {
    const details = await sheetOpen(), control = details.querySelector(selector);
    if (!control) throw new Error(`Missing metadata ${selector}`);
    control.value = value; control.dispatchEvent(new Event(event, { bubbles: true })); await tick();
  }
  await sheetChange('[data-sheet-meta="questionnaireVersion"]', "2", "input");
  await sheetChange('[data-sheet-item-meta="subscale"]', "Researcher subscale");
  await sheetChange('[data-sheet-item-meta="itemId"]', "study-item");
  await sheetChange('[data-sheet-option-id="0"]', "low");
  let entry = editor.readAuthoringEntries()[0];
  check(entry.sheet.questionnaireVersion === "2" && entry.sheet.rows[0].subscale === "Researcher subscale", "version and subscale controls edit actual sheet metadata");
  check(entry.sheet.rows[0].itemId === "study-item" && entry.sheet.rows[0].options[0].optionId === "low", "item and option identities edit actual sheet metadata");
  (await sheetOpen()).querySelector('[data-sheet-action="option-down"][data-option="0"]').click(); await tick();
  entry = editor.readAuthoringEntries()[0];
  check(entry.sheet.rows[0].options[1].optionId === "low" && entry.sheet.rows[0].options[1].scoreValue === 4, "option reordering keeps labels and recorded values attached to identity");
  (await sheetOpen()).querySelector('[data-sheet-action="item-down"]').click(); await tick();
  check(editor.readAuthoringEntries()[0].sheet.rows[1].itemId === "study-item", "item reordering preserves its identity and full option set");
  await sheetChange('[data-sheet-item-meta="itemId"]', "INVALID ID");
  check(editor.readAuthoringEntries()[0].sheet.rows[1].itemId === "study-item", "invalid metadata rejects without changing the scientific draft");
  check(Boolean(editorRoot.querySelector(`${sheetSelector} .sheet-error`).textContent), "invalid metadata has a visible error");
  await sheetChange('[data-sheet-item-meta="itemId"]', "study-item");
  const generated = await sheetToAuthoring(editor.readAuthoringEntries()[0].sheet);
  check(generated.definition.source.sourceDocumentSha256 === recipe.questionnaires.definitions[0].source.sha256, "metadata edits preserve original-source provenance");
  check(JSON.stringify(editor.readAuthoringEntries()[1].sheet.rows) === germanBefore, "English metadata edits leave the German table intact");
  check(intents > 0 && nativeSaves === 0, "metadata controls notify edits without manufacturing accepted source");

  await openAll(); await sheetOpen();
  check(document.documentElement.scrollWidth <= window.innerWidth, "advanced controls stay inside the viewport; wide tables scroll locally");
  check([...root.querySelectorAll("input,select")].every(control => control.closest("label")), "all routing inputs have associated visible labels");
  const savedMarkup = root.innerHTML, beforeDestroy = uiEdits;
  routing.destroy();
  root.innerHTML = savedMarkup;
  root.querySelector('[data-routing-action="wrap-root"]').click(); await tick();
  check(uiEdits === beforeDestroy, "routing teardown removes delegated handlers");
  const detached = document.createElement("section"); main.append(detached);
  let release, late;
  const gate = new Promise(resolve => { release = resolve; });
  const lateView = createQuestionnaireRoutingEditor({ root: detached, readContext: () => context, applyEdits(edits, guard) {
    late = (async () => { await gate; const candidate = await adapter.stage(edits, guard); candidate.commit(); })(); return late;
  } });
  const beforeLate = JSON.stringify(context);
  detached.querySelector('[data-routing-action="wrap-root"]').click(); lateView.destroy(); release();
  await late.catch(() => {}); await tick();
  check(JSON.stringify(context) === beforeLate, "routing teardown cancels a staged edit before owner mutation");
  detached.remove();
  // Two bounded visual targets; containment was checked with both live sections.
  const visualTarget = window.innerWidth < 1000 ? "routing" : "item-metadata";
  editorRoot.hidden = visualTarget === "routing"; root.hidden = visualTarget !== "routing";
  if (visualTarget === "routing") root.querySelectorAll("details").forEach(details => {
    details.open = ["modules", "module:en-0", "language:en"].includes(details.dataset.routingDetails);
  });
  else {
    editorRoot.querySelectorAll("[data-sheet-key]").forEach(details => { details.open = details.dataset.sheetKey === "custom-study/en"; });
    const style = document.createElement("style");
    style.textContent = '#editor .sheet-body > :not(.sheet-options), #editor .sheet-body > .sheet-options > .sheet-options-content > :not([data-sheet-metadata]) { display:none }';
    document.head.append(style);
  }
  window.scrollTo(0, 0); await tick();
  receipt.textContent = JSON.stringify({ passed: true, cases, visualTarget, contribution: { languageSelection: context.languageSelection, modules: context.modules } });
} catch (error) { receipt.textContent = JSON.stringify({ passed: false, cases, error: error.stack }); }
})();

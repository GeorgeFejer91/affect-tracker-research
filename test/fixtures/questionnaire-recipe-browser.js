import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { questionnaireRecipeFixture } from "./questionnaire-recipe-fixture.js";
import { validateQuestionnaireRecipeContributionV1 } from "../../site/src/research/questionnaire-recipe.js";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";

const cases = [];
const check = (name, value) => { if (!value) throw new Error(name); cases.push(name); };
const root = document.querySelector("main"); root.id = "research-app"; root.dataset.researchSurface = "tauri";
bootResearchUi();
const ui = root.researchUi;
const query = selector => root.querySelector(selector);
const sheet = language => `[data-sheet-key="custom-study/${language}"]`;
const cell = (language, row, column) => `${sheet(language)} [data-sheet-cell="${row}:${column}"]`;
const change = (selector, value) => {
  const target = query(selector); target.value = value;
  target.dispatchEvent(new Event(target.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Questionnaire UI did not settle.");
};
const rejection = promise => promise.then(() => false, () => true);

(async () => {
  const fixture = await questionnaireRecipeFixture();
  const original = await ui.restoreQuestionnaireRecipeContribution(fixture);
  check("successor restores the entire typed contribution exactly", canonicalJson(original.contribution) === canonicalJson(fixture) && !original.pending);
  check("English and German label repetition is independently restored", query(`${sheet("en")} [data-sheet-repeat]`).value === "5" && query(`${sheet("de")} [data-sheet-repeat]`).value === "10");
  check("legacy getter rejects repetition instead of losing it", ui.getQuestionnaireContributionSnapshot().pending);
  check("polling legacy and successor getters cannot manufacture owner revisions", ui.getQuestionnaireRecipeContributionSnapshot().revision === original.revision);
  for (const definition of fixture.questionnaires.definitions) {
    const language = definition.language;
    check(`${language} metadata fields restore without JSON editing`, query(`${sheet(language)} [data-sheet-meta="title"]`).value === definition.title
      && query(`${sheet(language)} [data-sheet-meta="instructions"]`).value === definition.instructions
      && query(`${sheet(language)} [data-sheet-meta="attribution"]`).value === definition.attribution);
    check(`${language} all item, label, code and required cells reflect their source`, definition.items.every((item, row) =>
      query(cell(language, row, 0)).value === item.prompt && query(cell(language, row, 5)).value === String(item.required)
      && item.options.every((option, index) => query(cell(language, row, 1 + index * 2)).value === option.label
        && query(cell(language, row, 2 + index * 2)).value === (option.scoreValue === null ? "" : String(option.scoreValue)))));
  }
  change(`${sheet("en")} [data-sheet-repeat]`, "10");
  const presentationOnly = ui.getQuestionnaireRecipeContributionSnapshot();
  check("presentation-only edit advances revision without dirtying scientific content", !presentationOnly.pending
    && presentationOnly.revision > original.revision
    && canonicalJson(presentationOnly.contribution.questionnaires) === canonicalJson(fixture.questionnaires));
  check("new presentation is in the contribution immediately", presentationOnly.contribution.presentation.definitions[0].repeatLabelsEvery === 10);
  query(`${sheet("en")} [data-sheet-action="undo"]`).click();
  check("presentation undo restores the value but does not reuse prior acceptance revision", query(`${sheet("en")} [data-sheet-repeat]`).value === "5"
    && ui.getQuestionnaireRecipeContributionSnapshot().revision > presentationOnly.revision);

  // Typed synthetic storage boundary only: no OS picker, native file or workspace write.
  root.addEventListener(RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, event => {
    event.preventDefault(); const request = event.detail.request;
    event.detail.complete({ ok: true, receipt: { familyId: request.familyId, languageTag: request.languageTag,
      sourceSha256: request.sourceSha256, byteLength: request.bytes.length } });
  });
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.workspaceReady, { detail: { label: "Synthetic questionnaire test", directoryPermission: true } }));
  change(cell("en", 0, 0), "Edited study item");
  change(cell("en", 0, 1), "Custom visible label");
  change(cell("en", 0, 2), "-7.25");
  change(cell("en", 0, 5), "false");
  change(`${sheet("en")} [data-sheet-meta="title"]`, "Edited title");
  change(`${sheet("en")} [data-sheet-meta="instructions"]`, "Edited instructions");
  change(`${sheet("en")} [data-sheet-meta="attribution"]`, "Edited researcher provenance");
  check("unsaved content is never offered as accepted successor data", ui.getQuestionnaireRecipeContributionSnapshot().pending);
  query(`${sheet("en")} [data-sheet-action="save"]`).click();
  await waitFor(() => !ui.getQuestionnaireRecipeContributionSnapshot().pending);
  const edited = ui.getQuestionnaireRecipeContributionSnapshot().contribution;
  const english = edited.questionnaires.definitions[0];
  check("all edited metadata, wording, labels, codes and required values reach canonical content", english.title === "Edited title"
    && english.instructions === "Edited instructions" && english.attribution === "Edited researcher provenance"
    && english.items[0].prompt === "Edited study item" && english.items[0].options[0].label === "Custom visible label"
    && english.items[0].options[0].scoreValue === -7.25 && english.items[0].required === false);
  check("editing one language preserves the entire other definition and language tree", canonicalJson(edited.questionnaires.definitions[1]) === canonicalJson(fixture.questionnaires.definitions[1])
    && canonicalJson(edited.languageSelection) === canonicalJson(fixture.languageSelection));
  check("every reference updates its hash but retains module identity and placement", edited.questionnaires.modules.every((module, index) =>
    canonicalJson({ ...module, definitionSha256: fixture.questionnaires.modules[index].definitionSha256 }) === canonicalJson(fixture.questionnaires.modules[index])
    && module.definitionSha256 === edited.questionnaires.definitions.find(d => d.questionnaireId === module.questionnaireId).definitionSha256));
  check("presentation remains bound to the changed definition hash", edited.presentation.definitions[0].definitionSha256 === english.definitionSha256
    && edited.presentation.definitions[0].repeatLabelsEvery === 5);
  await validateQuestionnaireRecipeContributionV1(edited);
  const reopened = await ui.restoreQuestionnaireRecipeContribution(edited);
  check("edited successor reopens with exact canonical bytes", canonicalJson(reopened.contribution) === canonicalJson(edited));
  const invalid = structuredClone(edited); invalid.presentation.definitions[0].extra = true;
  check("invalid companion rejects before any content mutation", await rejection(ui.restoreQuestionnaireRecipeContribution(invalid))
    && canonicalJson(ui.getQuestionnaireRecipeContributionSnapshot().contribution) === canonicalJson(edited));
  check("caller-cancelled restore leaves current content intact", await rejection(ui.restoreQuestionnaireRecipeContribution(fixture, { isCurrent: () => false }))
    && canonicalJson(ui.getQuestionnaireRecipeContributionSnapshot().contribution) === canonicalJson(edited));
  const delayed = rejection(ui.restoreQuestionnaireRecipeContribution(fixture));
  change(cell("en", 0, 0), "Newer unsaved edit");
  check("edit during asynchronous restore cannot be overwritten", await delayed && query(cell("en", 0, 0)).value === "Newer unsaved edit");
  const lateA = rejection(ui.restoreQuestionnaireRecipeContribution(fixture));
  const newest = await ui.restoreQuestionnaireRecipeContribution(edited);
  check("latest restore wins over an older concurrent request", await lateA && canonicalJson(newest.contribution) === canonicalJson(edited));
  const oldLegacyRestore = rejection(ui.restoreQuestionnaireContribution({ questionnaires: fixture.questionnaires, languageSelection: fixture.languageSelection }));
  change(`${sheet("de")} [data-sheet-repeat]`, "1");
  check("legacy restore shares the same edit fence", await oldLegacyRestore && query(`${sheet("de")} [data-sheet-repeat]`).value === "1");
  await ui.restoreQuestionnaireRecipeContribution(edited);
  ui.openSetupSection("questionnaires");
  query(sheet("en")).open = true; query(`${sheet("en")} .sheet-options`).open = true;
  await new Promise(resolve => setTimeout(resolve, 500));
  const pane = query(".setup-pane");
  pane.scrollTop += query(`${sheet("en")} .sheet-options`).getBoundingClientRect().top - pane.getBoundingClientRect().top;
  check("new presentation control is labelled and contained", query(`${sheet("en")} [data-sheet-repeat]`).closest("label").textContent.includes("Repeat answer labels")
    && pane.scrollWidth <= pane.clientWidth + 1);
  const disposedRestore = rejection(ui.restoreQuestionnaireRecipeContribution(fixture));
  ui.destroy();
  check("teardown prevents late restore mutation", await disposedRestore && query(cell("en", 0, 0)).value === "Edited study item");
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, cases, contribution: edited });
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, cases, error: error.stack }); });

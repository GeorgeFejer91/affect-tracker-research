import { questionnairePresentationGroups } from "../../site/src/research/questionnaire-recipe.js";
import { renderTypedForm } from "./typed-form.js";

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

/** Full form, with the exact P2 label repetition groups. Repetition is not
 * pagination, and researcher-supplied codes never replace visible labels.
 * Typed forms return a controller which the caller retains for the occurrence
 * and destroys before changing forms; polling must not replace active inputs. */
export function renderMasterQuestionnaire(host, definition, presentation, answers) {
  if (presentation.questionnaireId !== definition.questionnaireId || presentation.definitionSha256 !== definition.definitionSha256) throw new Error("Questionnaire presentation does not bind this definition.");
  if (definition.schema === "affect-research-form-definition" && definition.version === 1) {
    return renderTypedForm(host, definition, presentation, Object.entries(answers).map(([itemId, value]) => ({ itemId, value })));
  }
  if (definition.schema !== "affect-research-questionnaire-definition" || definition.version !== 1 || (presentation.kind !== undefined && presentation.kind !== "likert")) throw new Error("Unsupported questionnaire presentation.");
  const document = host.ownerDocument;
  host.replaceChildren();
  for (const group of questionnairePresentationGroups(definition, presentation.repeatLabelsEvery)) {
    const table = document.createElement("table"); table.className = "runner-questionnaire-table";
    const head = document.createElement("thead"), headings = document.createElement("tr"), promptHeading = document.createElement("th");
    promptHeading.scope = "col"; promptHeading.textContent = "Item"; headings.append(promptHeading);
    const options = definition.items[group.start].options;
    for (const [index, option] of options.entries()) {
      const th = document.createElement("th"); th.scope = "col"; th.id = `runner-option-${group.start}-${index}`; th.textContent = option.label; headings.append(th);
    }
    head.append(headings); table.append(head); const body = document.createElement("tbody");
    for (const item of definition.items.slice(group.start, group.end)) {
      const row = document.createElement("tr"), label = document.createElement("th"); label.scope = "row"; label.id = `runner-item-${item.order}`;
      label.textContent = `${item.order}. ${item.prompt} (required)`; row.append(label);
      for (const [index, option] of item.options.entries()) {
        const cell = document.createElement("td"), input = document.createElement("input");
        input.type = "radio"; input.name = `answer-${item.itemId}`; input.value = option.optionId; input.dataset.answerItem = item.itemId;
        input.checked = (presentation.kind === "likert" ? answers[item.itemId]?.optionId : answers[item.itemId]) === option.optionId; input.required = true;
        input.setAttribute("aria-labelledby", `${label.id} runner-option-${group.start}-${index}`);
        cell.append(input); row.append(cell);
      }
      body.append(row);
    }
    table.append(body); host.append(table);
  }
}

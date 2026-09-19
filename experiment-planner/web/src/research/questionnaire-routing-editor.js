import { createFlatLanguageSelectionV1, validateLanguageSelectionTreeV1 } from "./experiment-package.js";
import { validateQuestionnaireModuleV2 } from "./questionnaires.js";

const clone = structuredClone;
const escape = value => String(value ?? "").replace(/[&<>"']/gu, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const set = (field, value) => ({ kind: "set", field: `P2.${field}`, value });
const unique = (prefix, entries, key) => {
  let i = 1; while (entries.some(entry => entry[key] === `${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
};
function move(list, index, direction) {
  const to = index + direction;
  if (index < 0 || to < 0 || to >= list.length) throw new TypeError("That entry cannot move further.");
  [list[index], list[to]] = [list[to], list[index]];
}
function find(list, key, id) {
  const item = list.find(entry => entry[key] === id);
  if (!item) throw new TypeError("This entry changed; refresh the questionnaire controls.");
  return item;
}
export function questionnaireRoutingSnapshot(context) {
  const state = clone(context);
  state.languageSelection ??= clone(createFlatLanguageSelectionV1(state.languages.map(language => ({ ...language,
    questionnaireModuleIds: state.modules.filter(module => state.definitions.some(definition =>
      definition.questionnaireId === module.questionnaireId && definition.language === language.languageTag)).map(module => module.moduleId),
  }))));
  return state;
}

/** UI gestures produce the same closed owner edits as the CLI. No retained
 * graph/module draft, source writes, translations or acceptance live here. */
export function questionnaireRoutingEdits(context, action) {
  if (context.locked) throw new TypeError("Questionnaire settings are locked.");
  if (action.kind === "add-demographics") return [{ kind: "operation", owner: "P2", operation: "addDemographics", arguments: {} }];
  const state = questionnaireRoutingSnapshot(context), tree = state.languageSelection;
  const node = action.nodeId ? find(tree.nodes, "nodeId", action.nodeId) : null;
  const option = action.optionId ? find(node.options, "optionId", action.optionId) : null;
  const module = action.moduleId ? find(state.modules, "moduleId", action.moduleId) : null;
  const language = action.languageId ? find(tree.languages, "languageId", action.languageId) : null;
  const parentOf = id => tree.nodes.flatMap(parent => parent.options.map(route => ({ parent, route })))
    .find(({ route }) => route.target.kind === "node" && route.target.nodeId === id);
  switch (action.kind) {
    case "node-prompt": node.prompt = action.value; break;
    case "node-id":
      if (tree.rootNodeId === node.nodeId) tree.rootNodeId = action.value;
      else parentOf(node.nodeId).route.target.nodeId = action.value;
      node.nodeId = action.value; break;
    case "node-move": move(tree.nodes, tree.nodes.indexOf(node), action.direction); break;
    case "option-label": option.label = action.value; break;
    case "option-id": option.optionId = action.value; break;
    case "option-move": move(node.options, node.options.indexOf(option), action.direction); break;
    case "option-parent": {
      const destination = find(tree.nodes, "nodeId", action.value);
      if (destination === node) return [];
      if (node.options.length === 1) throw new TypeError("A question needs at least one route. Remove the question to merge its routes instead.");
      node.options.splice(node.options.indexOf(option), 1); destination.options.push(option); break;
    }
    case "wrap-route": {
      const childId = unique("question", tree.nodes, "nodeId");
      tree.nodes.push({ nodeId: childId, prompt: "Choose an option", options: [clone(option)] });
      option.target = { kind: "node", nodeId: childId }; break;
    }
    case "wrap-root": {
      const nodeId = unique("question", tree.nodes, "nodeId");
      tree.nodes.unshift({ nodeId, prompt: "Choose an option", options: [{ optionId: "continue", label: "Continue",
        target: { kind: "node", nodeId: tree.rootNodeId } }] });
      tree.rootNodeId = nodeId; break;
    }
    case "remove-node": {
      if (node.nodeId === tree.rootNodeId) {
        if (node.options.length !== 1 || node.options[0].target.kind !== "node") throw new TypeError("The first question can be removed only when its sole route leads to another question.");
        tree.rootNodeId = node.options[0].target.nodeId;
      } else {
        const { parent, route } = parentOf(node.nodeId);
        parent.options.splice(parent.options.indexOf(route), 1, ...node.options);
      }
      tree.nodes.splice(tree.nodes.indexOf(node), 1); break;
    }
    case "language-label": language.label = action.value; break;
    case "language-id":
      tree.nodes.forEach(n => n.options.forEach(o => {
        if (o.target.kind === "language" && o.target.languageId === language.languageId) o.target.languageId = action.value;
      }));
      language.languageId = action.value; break;
    case "language-tag": language.languageTag = action.value; language.questionnaireModuleIds = []; break;
    case "language-move": move(tree.languages, tree.languages.indexOf(language), action.direction); break;
    case "module-placement":
      if (!["beforeSession", "afterSession"].includes(action.value)) throw new TypeError("Choose before or after the video task.");
      module.placement = { kind: action.value, blockId: null }; break;
    case "module-id":
      tree.languages.forEach(l => { l.questionnaireModuleIds = l.questionnaireModuleIds.map(id => id === module.moduleId ? action.value : id); });
      module.moduleId = action.value; break;
    case "module-definition": {
      const definition = find(state.definitions, "questionnaireId", action.value);
      module.questionnaireId = definition.questionnaireId; module.definitionSha256 = definition.definitionSha256;
      tree.languages.forEach(l => {
        if (l.languageTag !== definition.language) l.questionnaireModuleIds = l.questionnaireModuleIds.filter(id => id !== module.moduleId);
      });
      const terminal = tree.languages.find(l => l.languageTag === definition.language);
      if (!terminal) throw new TypeError("Select this questionnaire's language first.");
      if (!terminal.questionnaireModuleIds.includes(module.moduleId)) terminal.questionnaireModuleIds.push(module.moduleId);
      break;
    }
    case "module-add": {
      const definition = find(state.definitions, "questionnaireId", action.value);
      const moduleId = unique("questionnaire", state.modules, "moduleId");
      const terminal = tree.languages.find(l => l.languageTag === definition.language);
      if (!terminal) throw new TypeError("Select this questionnaire's language first.");
      state.modules.push({ schema: "affect-research-questionnaire-module", version: 2, moduleId,
        questionnaireId: definition.questionnaireId, definitionSha256: definition.definitionSha256,
        placement: { kind: "beforeSession", blockId: null } });
      terminal.questionnaireModuleIds.push(moduleId); break;
    }
    case "module-remove":
      state.modules.splice(state.modules.indexOf(module), 1);
      tree.languages.forEach(l => { l.questionnaireModuleIds = l.questionnaireModuleIds.filter(id => id !== module.moduleId); }); break;
    case "module-move": move(state.modules, state.modules.indexOf(module), action.direction); break;
    case "route-add": {
      const chosen = find(state.modules, "moduleId", action.value);
      const definition = find(state.definitions, "questionnaireId", chosen.questionnaireId);
      if (definition.language !== language.languageTag) throw new TypeError("This module needs an asset in this route's language.");
      language.questionnaireModuleIds.push(chosen.moduleId); break;
    }
    case "route-remove": language.questionnaireModuleIds = language.questionnaireModuleIds.filter(id => id !== action.value); break;
    case "route-move": move(language.questionnaireModuleIds, language.questionnaireModuleIds.indexOf(action.value), action.direction); break;
    default: throw new TypeError("Unknown questionnaire control.");
  }
  validateLanguageSelectionTreeV1(tree);
  state.modules.forEach(validateQuestionnaireModuleV2);
  if (new Set(state.modules.map(m => m.moduleId)).size !== state.modules.length) throw new TypeError("Module identifiers must be unique.");
  const edits = [];
  if (action.kind.startsWith("language-")) edits.push(set("languages", tree.languages.map(({ questionnaireModuleIds: _ids, ...entry }) => entry)));
  if (action.kind.startsWith("module-")) edits.push(set("modules", state.modules));
  edits.push(set("languageSelection", tree));
  return edits;
}

export function createQuestionnaireRoutingEditor({ root, readContext, applyEdits }) {
  if (!root || typeof readContext !== "function" || typeof applyEdits !== "function") throw new TypeError("Routing controls need the existing P2 owner hooks.");
  let busy = false, destroyed = false, error = "";
  const lifetime = new AbortController();
  const opened = new Set();
  const attrs = values => Object.entries(values).map(([key, value]) => `data-${key}="${escape(value)}"`).join(" ");
  const input = (label, kind, value, ids, maximum = 128) => `<label class="field"><span>${escape(label)}</span><input type="text" maxlength="${maximum}" data-routing-field="${kind}" ${attrs(ids)} value="${escape(value)}"></label>`;
  const button = (label, kind, ids = {}, disabled = false) => `<button type="button" data-routing-action="${kind}" ${attrs(ids)} ${disabled ? "disabled" : ""}>${escape(label)}</button>`;
  const arrows = (kind, ids, index, count) => button("Move up", kind, { ...ids, direction: -1 }, index === 0) + button("Move down", kind, { ...ids, direction: 1 }, index === count - 1);
  const select = (label, kind, value, choices, ids = {}) => {
    const visible = choices.some(([id]) => id === value) ? choices : [[value, `Unavailable: ${value}`], ...choices];
    return `<label class="field"><span>${escape(label)}</span><select data-routing-field="${kind}" ${attrs(ids)}>${visible.map(([id, text]) => `<option value="${escape(id)}" ${id === value ? "selected" : ""}>${escape(text)}</option>`).join("")}</select></label>`;
  };
  const details = (id, label, content) => `<details class="sheet-options" data-routing-details="${escape(id)}" ${opened.has(id) ? "open" : ""}><summary>${escape(label)}</summary><div class="sheet-options-content">${content}</div></details>`;
  function render() {
    if (destroyed) return;
    let state;
    try { state = questionnaireRoutingSnapshot(readContext()); }
    catch (failure) { root.innerHTML = `<p role="status" class="sheet-error">${escape(failure.message)}</p>`; return; }
    const tree = state.languageSelection;
    const nodes = tree.nodes.map((node, index) => {
      const ids = { "node-id": node.nodeId };
      const options = node.options.map((option, optionIndex) => {
        const routeIds = { ...ids, "option-id": option.optionId };
        const target = option.target.kind === "node" ? `Question: ${option.target.nodeId}`
          : `Language: ${tree.languages.find(l => l.languageId === option.target.languageId)?.label ?? option.target.languageId}`;
        return `<div class="sheet-options-content">${input("Route label", "option-label", option.label, routeIds, 120)}
          ${input("Route ID", "option-id", option.optionId, routeIds)}<p class="field-help">Leads to ${escape(target)}</p>
          ${select("Show this route under", "option-parent", node.nodeId, tree.nodes.map(n => [n.nodeId, n.nodeId]), routeIds)}
          <div class="sheet-actions">${arrows("option-move", routeIds, optionIndex, node.options.length)}${button("Add follow-up question", "wrap-route", routeIds)}</div></div>`;
      }).join("");
      return details(`node:${node.nodeId}`, `${node.nodeId === tree.rootNodeId ? "First question: " : "Question: "}${node.prompt}`,
        input("Question ID", "node-id", node.nodeId, ids) + input("Participant prompt", "node-prompt", node.prompt, ids, 500)
        + options + `<div class="sheet-actions">${arrows("node-move", ids, index, tree.nodes.length)}${button("Remove question and merge routes", "remove-node", ids,
          node.nodeId === tree.rootNodeId && (node.options.length !== 1 || node.options[0].target.kind !== "node"))}</div>`);
    }).join("");
    const modules = state.modules.map((module, index) => {
      const ids = { "module-id": module.moduleId };
      const definition = state.definitions.find(d => d.questionnaireId === module.questionnaireId);
      const placements = [["beforeSession", "Before the video task"], ["afterSession", "After the video task"]];
      if (!placements.some(([id]) => id === module.placement.kind)) placements.unshift([module.placement.kind, `Unsupported placement: ${module.placement.kind}`]);
      return details(`module:${module.moduleId}`, `${definition?.title ?? module.questionnaireId} · ${definition?.language ?? "missing source"} · ${module.moduleId}`,
        input("Module ID", "module-id", module.moduleId, ids)
        + select("Questionnaire asset", "module-definition", module.questionnaireId, state.definitions.map(d => [d.questionnaireId, `${d.title} · ${d.language}`]), ids)
        + select("Placement", "module-placement", module.placement.kind, placements, ids)
        + `<div class="sheet-actions">${arrows("module-move", ids, index, state.modules.length)}${button("Remove module", "module-remove", ids)}</div>`);
    }).join("");
    const languages = tree.languages.map((language, index) => {
      const ids = { "language-id": language.languageId };
      const compatible = state.modules.filter(m => !language.questionnaireModuleIds.includes(m.moduleId)
        && state.definitions.some(d => d.questionnaireId === m.questionnaireId && d.language === language.languageTag));
      return details(`language:${language.languageId}`, `${language.label}: questionnaire order`,
        input("Language ID", "language-id", language.languageId, ids) + input("Language tag", "language-tag", language.languageTag, ids, 80)
        + input("Language label", "language-label", language.label, ids, 120)
        + '<p class="field-help">Changing a language tag requires questionnaire assets in the new language.</p>'
        + `<div class="sheet-actions">${arrows("language-move", ids, index, tree.languages.length)}</div>`
        + (language.questionnaireModuleIds.length ? `<ol>${language.questionnaireModuleIds.map((id, i) => `<li><p>${escape(id)}</p><div class="sheet-actions">${arrows("route-move", { ...ids, value: id }, i, language.questionnaireModuleIds.length)}${button("Remove from route", "route-remove", { ...ids, value: id })}</div></li>`).join("")}</ol>` : '<p class="field-help">No modules on this route.</p>')
        + select("Add questionnaire to this route", "route-add", "", [["", "Select a module…"], ...compatible.map(m => [m.moduleId, m.moduleId])], ids));
    }).join("");
    root.innerHTML = `<fieldset class="sheet-body" ${busy || state.locked ? "disabled" : ""}><legend>Language routing &amp; questionnaire placement</legend>
      <p class="sheet-paste-help">The language choice selects its supplied assets. Before/after-task modules run in the order listed for that language.</p>
      <p class="sheet-error" role="status" aria-live="polite">${escape(error)}</p>
      <div class="sheet-actions">${button("Add demographics", "add-demographics", {}, state.families.some(f => f.id === "demographics") || state.languages.some(l => !["en", "de"].includes(l.languageTag)))}</div>
      ${details("questions", "Language questions", nodes + `<div class="sheet-actions">${button("Add first question", "wrap-root")}</div>`)}
      ${details("modules", "Questionnaire modules", modules + select("Add saved questionnaire module", "module-add", "", [["", "Select an asset…"], ...state.definitions.map(d => [d.questionnaireId, `${d.title} · ${d.language}`])]))}
      ${languages}</fieldset>`;
    root.querySelectorAll("[data-routing-details]").forEach(element => element.addEventListener("toggle", () => {
      if (element.open) opened.add(element.dataset.routingDetails); else opened.delete(element.dataset.routingDetails);
    }));
  }
  async function handle(event) {
    const element = event.target.closest(event.type === "click" ? "[data-routing-action]" : "[data-routing-field]");
    if (!element || !root.contains(element) || busy || destroyed) return;
    event.stopPropagation();
    if (element.disabled || readContext().locked) return;
    const kind = element.dataset.routingAction ?? element.dataset.routingField;
    if (["module-add", "route-add"].includes(kind) && !element.value) return;
    const action = { kind, value: element.dataset.value ?? element.value,
      nodeId: element.dataset.nodeId, optionId: element.dataset.optionId,
      moduleId: element.dataset.moduleId, languageId: element.dataset.languageId,
      direction: Number(element.dataset.direction) };
    try {
      const edits = questionnaireRoutingEdits(readContext(), action);
      if (!edits.length) return;
      busy = true; error = ""; render();
      const result = await applyEdits(edits, { signal: lifetime.signal, isCurrent: () => !destroyed && !lifetime.signal.aborted });
      if (result && !["applied", "incomplete"].includes(result.status)) throw new Error(result.issues?.[0]?.message ?? "The settings were not applied.");
    } catch (failure) { error = failure.message; }
    finally { busy = false; render(); }
  }
  root.addEventListener("click", handle); root.addEventListener("change", handle);
  render();
  return Object.freeze({ sync: render, destroy() {
    destroyed = true; lifetime.abort(); root.removeEventListener("click", handle); root.removeEventListener("change", handle); root.replaceChildren();
  } });
}

import { resolveRunnerSelection } from "./recipe.js";

export function participantNumber(value) {
  const match = /^(?:P)?([0-9]{1,6})$/iu.exec(String(value).trim());
  const number = match ? Number(match[1]) : NaN;
  return Number.isInteger(number) && number >= 1 && number <= 100000 ? number : null;
}
export function participantLabel(value) {
  const number = participantNumber(value);
  if (number === null) throw new Error("Enter a participant number such as P01.");
  return `P${String(number).padStart(2, "0")}`;
}
export function participantCatalogue(recipe) {
  const ids = recipe.package.settings.externalProtocol.definition.schedules.map(s => s.participantId);
  const lookup = new Map();
  for (const id of ids) {
    const number = participantNumber(id);
    if (number === null || lookup.has(number)) throw new Error("The JSON contains ambiguous participant numbers.");
    lookup.set(number, id);
  }
  return { ids: [...ids].sort((a, b) => participantNumber(a) - participantNumber(b)), resolve: value => lookup.get(participantNumber(value)) ?? null };
}

/** Resolve the actual run selection; no allocation, media, recording or file writes. */
export async function participantTimeline(recipe, participantId, path) {
  const selection = await resolveRunnerSelection(recipe, participantId, path);
  const stimuli = new Map(recipe.package.assets.stimuli.map(s => [s.stimulusId, s]));
  const forms = new Map(selection.compiled.settings.questionnaires.definitions.map(q => [q.questionnaireId, q]));
  return { selection, events: selection.compiled.protocolPlan.steps.map(step => {
    if (step.kind === "stimulus") {
      const video = stimuli.get(step.stimulusId);
      if (!video) throw new Error("A scheduled video is absent from the recipe.");
      return { ...step, title: video.title, label: "Video", durationMs: video.durationMs };
    }
    if (step.kind === "questionnaire") {
      const form = forms.get(step.questionnaireId);
      if (!form) throw new Error("A scheduled questionnaire is absent from the recipe.");
      return { ...step, title: form.title, label: "Questionnaire", durationMs: null, itemCount: form.items.length };
    }
    if (step.kind !== "interval") throw new Error("Unsupported timeline event.");
    return { ...step, title: "Between videos", label: "Interval" };
  }) };
}

/** Virtual list: every declared number is scrollable, with a bounded DOM. */
export function createParticipantPicker(root, { onChange }) {
  const q = id => root.querySelector(`#${id}`), input = q("runner-participant"), arrow = q("runner-participant-arrow"), list = q("runner-participant-list"), status = q("runner-participant-status");
  let catalogue = { ids: [], resolve: () => null }, used = null, open = false, active = -1, locked = true;
  const removers = [], rowHeight = 40;
  const listen = (el, event, fn) => { el.addEventListener(event, fn); removers.push(() => el.removeEventListener(event, fn)); };
  const close = () => { open = false; list.hidden = true; input.setAttribute("aria-expanded", "false"); arrow.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  function draw() {
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    const spacer = document.createElement("div"); spacer.style.height = `${catalogue.ids.length * rowHeight}px`; spacer.setAttribute("role", "presentation"); list.append(spacer);
    list.scrollTop = scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2), end = Math.min(catalogue.ids.length, start + 14);
    for (let index = start; index < end; index++) {
      const id = catalogue.ids[index], row = document.createElement("div");
      row.id = `runner-number-${index}`; row.role = "option"; row.dataset.participantId = id;
      row.style.top = `${index * rowHeight}px`; row.className = "runner-number-option";
      row.setAttribute("aria-selected", String(id === catalogue.resolve(input.value)));
      row.setAttribute("aria-posinset", String(index + 1)); row.setAttribute("aria-setsize", String(catalogue.ids.length));
      row.classList.toggle("is-active", index === active); row.classList.toggle("is-used", used?.has(id) === true);
      row.textContent = `${participantLabel(id)}${used?.has(id) ? " · Used" : used ? "" : " · History unavailable"}`;
      list.append(row);
    }
    const activeId = `runner-number-${active}`;
    if (open && q(activeId)) input.setAttribute("aria-activedescendant", activeId); else input.removeAttribute("aria-activedescendant");
  }
  function render() {
    const id = catalogue.resolve(input.value), isUsed = used?.has(id) === true;
    input.classList.toggle("is-used", isUsed); input.setAttribute("aria-invalid", String(Boolean(input.value) && !id));
    status.classList.toggle("is-used", isUsed);
    status.textContent = !catalogue.ids.length ? "Load an experiment first." : !id && input.value ? "This JSON has no schedule for that number." : isUsed ? "Used in this experiment. A new attempt needs rerun confirmation in Session settings." : used === null ? "Participant history unavailable. Select the experiment’s project folder." : id ? "No previous attempt for this number." : "Enter a number or choose from the list.";
    if (open) draw();
  }
  function reveal(index) {
    active = Math.max(0, Math.min(catalogue.ids.length - 1, index));
    if (active * rowHeight < list.scrollTop) list.scrollTop = active * rowHeight;
    else if ((active + 1) * rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = (active + 1) * rowHeight - list.clientHeight;
    draw();
  }
  function show() {
    if (locked || !catalogue.ids.length) return;
    open = true; list.hidden = false; input.setAttribute("aria-expanded", "true"); arrow.setAttribute("aria-expanded", "true");
    input.focus(); reveal(Math.max(0, catalogue.ids.indexOf(catalogue.resolve(input.value))));
  }
  function choose(id) { input.value = participantLabel(id); close(); render(); input.focus(); onChange(true); }
  listen(arrow, "click", () => open ? close() : show());
  listen(list, "scroll", draw);
  listen(list, "pointerdown", event => event.preventDefault());
  listen(list, "click", event => { const id = event.target.closest("[data-participant-id]")?.dataset.participantId; if (id && !locked) choose(id); });
  listen(input, "input", () => { close(); render(); onChange(false); });
  listen(input, "blur", () => { close(); if (locked) return; const id = catalogue.resolve(input.value); if (id) input.value = participantLabel(id); render(); onChange(true); });
  listen(input, "keydown", event => {
    if (locked) return;
    if (event.key === "Escape" && open) { event.preventDefault(); close(); }
    else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); if (!open) show(); else reveal(active + (event.key === "ArrowDown" ? 1 : -1)); }
    else if (open && ["Home", "End", "PageDown", "PageUp"].includes(event.key)) { event.preventDefault(); reveal(event.key === "Home" ? 0 : event.key === "End" ? catalogue.ids.length - 1 : active + (event.key === "PageDown" ? 6 : -6)); }
    else if (event.key === "Enter" && open) { event.preventDefault(); if (active >= 0) choose(catalogue.ids[active]); }
  });
  return {
    get participantId() { return catalogue.resolve(input.value); },
    clear() { catalogue = { ids: [], resolve: () => null }; used = null; input.value = ""; close(); render(); },
    adopt(recipe, id = null) { catalogue = participantCatalogue(recipe); used = null; input.value = id ? participantLabel(id) : ""; close(); render(); },
    restore(id) { if (id && !catalogue.resolve(id)) throw new Error("Retained participant is absent from this JSON."); input.value = id ? participantLabel(id) : ""; render(); },
    history(participants) { used = participants === null ? null : new Set(participants.filter(p => p.state !== "available").map(p => p.participantId)); render(); },
    lock(value) { locked = value; input.disabled = value; arrow.disabled = value || !catalogue.ids.length; if (value) close(); },
    destroy() { removers.forEach(remove => remove()); },
  };
}

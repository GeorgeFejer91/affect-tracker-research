import { validateFormAnswers, validateFormDefinitionV1 } from "../../site/src/research/form-definition.js";

const messages = {
  en: { required: "Answer this item before continuing.", text: "Use a shorter answer.", integer: "Enter a whole number within the allowed range.", choice: "Choose one answer.", progress: (n, total) => `${n} of ${total} answered`, instructions: "Answer every item to continue.", submit: "Submit responses" },
  de: { required: "Beantworten Sie diese Frage, bevor Sie fortfahren.", text: "Verwenden Sie eine kürzere Antwort.", integer: "Geben Sie eine ganze Zahl im zulässigen Bereich ein.", choice: "Wählen Sie eine Antwort aus.", progress: (n, total) => `${n} von ${total} beantwortet`, instructions: "Beantworten Sie alle Fragen, um fortzufahren.", submit: "Antworten abgeben" },
};

/** Participant controls for an already hash-verified P2 definition. No DOM
 * values are converted into scores, participant codes or allocation settings. */
export function renderTypedForm(host, definitionValue, presentation, initialAnswers = []) {
  const definition = validateFormDefinitionV1(definitionValue);
  if (presentation?.kind !== "fields" || presentation.questionnaireId !== definition.questionnaireId || presentation.definitionSha256 !== definition.definitionSha256) throw new Error("Typed form presentation does not bind its frozen definition.");
  validateFormAnswers(definition, initialAnswers, { allowPartial: true });
  const initial = new Map(initialAnswers.map(answer => [answer.itemId, answer.value]));
  const text = messages[definition.language.split("-")[0].toLowerCase()] ?? messages.en;
  const document = host.ownerDocument, controls = new Map();
  host.replaceChildren(); host.classList.add("runner-typed-form");
  for (const item of definition.items) {
    const group = document.createElement("fieldset"), legend = document.createElement("legend");
    legend.textContent = item.prompt; group.append(legend); group.dataset.formField = item.itemId;
    const inputs = [], value = initial.get(item.itemId);
    if (item.response.kind === "singleChoice") {
      group.classList.add("runner-form-choices");
      for (const option of item.response.options) {
        const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span");
        input.type = "radio"; input.name = `typed-answer-${item.itemId}`; input.value = option.optionId; input.checked = value?.optionId === option.optionId;
        span.textContent = option.label; label.append(input, span); group.append(label); inputs.push(input);
      }
    } else {
      // A textarea retains exact text, including pasted newlines and Unicode.
      const input = document.createElement(item.response.kind === "text" ? "textarea" : "input");
      input.name = `typed-answer-${item.itemId}`;
      if (item.response.kind === "text") {
        input.rows = 2; input.maxLength = item.response.maxUtf8Bytes; input.value = value?.text ?? "";
        input.autocomplete = "off"; input.spellcheck = false;
      } else {
        input.type = "number"; input.inputMode = "numeric"; input.min = String(item.response.min); input.max = String(item.response.max); input.step = "1";
        input.value = value ? String(value.integer) : "";
      }
      input.setAttribute("aria-label", item.prompt); group.append(input); inputs.push(input);
    }
    for (const input of inputs) { input.required = true; input.dataset.formItem = item.itemId; }
    controls.set(item.itemId, { item, inputs }); host.append(group);
  }
  function readValue({ item, inputs }) {
    if (item.response.kind === "singleChoice") {
      const checked = inputs.find(input => input.checked); return checked ? { kind: "singleChoice", optionId: checked.value } : undefined;
    }
    const input = inputs[0];
    if (item.response.kind === "text") {
      if (!input.value.isWellFormed() || new TextEncoder().encode(input.value).length > item.response.maxUtf8Bytes) throw new Error(text.text);
      return { kind: "text", text: input.value };
    }
    if (input.validity.badInput) throw new Error(text.integer);
    if (input.value === "") return undefined;
    if (!Number.isSafeInteger(input.valueAsNumber) || input.validity.rangeUnderflow || input.validity.rangeOverflow || input.validity.stepMismatch) throw new Error(text.integer);
    return { kind: "integer", integer: input.valueAsNumber };
  }
  function inspect() {
    const answers = [], invalid = new Set();
    for (const control of controls.values()) {
      for (const input of control.inputs) input.setCustomValidity("");
      try {
        const value = readValue(control);
        if (value !== undefined) answers.push({ itemId: control.item.itemId, value });
      } catch (error) { invalid.add(control.item.itemId); control.inputs[0].setCustomValidity(error.message); }
    }
    // One owner validation per interaction, including large authored forms.
    const result = validateFormAnswers(definition, answers, { allowPartial: true });
    for (const id of result.missingRequired) if (!invalid.has(id)) controls.get(id).inputs[0].setCustomValidity(text.required);
    return { result, invalid: invalid.size > 0 };
  }
  function progress() {
    const { result } = inspect(), answered = definition.items.length - result.missingRequired.length;
    return { answered, total: definition.items.length, text: text.progress(answered, definition.items.length) };
  }
  const refresh = () => progress();
  host.addEventListener("input", refresh); host.addEventListener("change", refresh); progress();
  return {
    instructions: text.instructions, submitLabel: text.submit, progress,
    read({ allowPartial = false } = {}) {
      const { result, invalid } = inspect();
      if (invalid || (!allowPartial && !result.complete)) throw new Error(text.required);
      return result;
    },
    focusFirstUnanswered() { const id = inspect().result.missingRequired[0]; if (id) { const input = controls.get(id).inputs[0]; input.focus(); input.reportValidity(); } },
    setDisabled(disabled) { for (const { inputs } of controls.values()) for (const input of inputs) input.disabled = disabled; },
    destroy() { host.removeEventListener("input", refresh); host.removeEventListener("change", refresh); host.classList.remove("runner-typed-form"); host.replaceChildren(); },
  };
}

// Keyboard presentation only. Answers still pass through the native draft and
// submit commands; focusing a choice never supplies an answer implicitly.
export function createQuestionnaireKeyboard(form, { items, next, submit, ready, commit }) {
  let initial = false, revision = 0;
  const controls = () => [...items.querySelectorAll("input[data-answer-item],input[data-form-item],textarea[data-form-item]")];
  const id = input => input.dataset.answerItem ?? input.dataset.formItem;
  function groups() {
    const result = new Map();
    for (const input of controls()) {
      if (!result.has(id(input))) result.set(id(input), []);
      result.get(id(input)).push(input);
    }
    return [...result.values()];
  }
  function focus(input) {
    if (input?.isConnected && !input.disabled) {
      input.focus(); input.scrollIntoView({ block: "nearest" });
    }
  }
  async function keydown(event) {
    const input = event.target;
    if (!controls().includes(input) || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const radio = input.type === "radio";
    const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : 0;
    if (event.key !== "Enter" && !(radio && (direction || ["Home", "End"].includes(event.key)))) return;
    if (input.tagName === "TEXTAREA" && event.key === "Enter" && event.shiftKey) return;
    event.preventDefault();
    if (!ready() || event.repeat || input.disabled) return;
    const rows = groups(), index = rows.findIndex(row => row.includes(input)), row = rows[index];
    const currentRevision = revision;
    let answer = input, destination;
    if (radio && event.key !== "Enter") {
      const target = event.key === "Home" ? 0 : event.key === "End" ? row.length - 1 : (row.indexOf(input) + direction + row.length) % row.length;
      answer = row[target]; destination = answer;
    } else if (event.shiftKey) {
      const previous = rows[Math.max(0, index - 1)]; focus(previous.find(control => control.checked) ?? previous[0]); return;
    } else {
      const following = rows[index + 1];
      destination = following ? following.find(control => control.checked) ?? following[0] : !next.hidden ? next : submit;
    }
    if (radio) answer.checked = true;
    answer.dispatchEvent(new Event("input", { bubbles: true }));
    if (!radio && !answer.checkValidity()) { answer.reportValidity(); return; }
    const accepted = await commit(answer);
    if (currentRevision === revision && ready()) focus(accepted ? destination : answer);
  }
  form.addEventListener("keydown", keydown);
  return {
    reset() { revision++; initial = true; },
    focusInitial() { if (initial && ready()) { initial = false; const row = groups()[0]; focus(row?.find(input => input.checked) ?? row?.[0]); } },
    destroy() { revision++; form.removeEventListener("keydown", keydown); },
  };
}

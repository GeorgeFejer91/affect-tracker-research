import { INPUT_PRESETS, createInputBindingPreset, validateInputBindingV1 } from "../../site/src/research/contracts.js";

// UI draft only until a versioned native override/attempt receipt is implemented.
// Never rewrite the loaded recipe to masquerade an override as authored settings.
export function createRunnerControllerSettings(root, { onChange }) {
  const query = id => root.querySelector(`#${id}`);
  const select = query("runner-controller-preset");
  const step = query("runner-controller-step");
  let original = null, override = null;
  const description = binding => `${INPUT_PRESETS[binding.preset]?.label ?? "Custom bindings"}${binding.kind === "digital" ? ` · step ${binding.stepSize}` : ""}`;
  for (const [id, preset] of Object.entries(INPUT_PRESETS)) {
    const option = document.createElement("option"); option.value = id; option.textContent = preset.label; select.append(option);
  }
  function render() {
    query("runner-controller-status").textContent = original ? `Experiment file: ${description(original)}` : "Load an experiment to see its configured input.";
    query("runner-controller-note").textContent = override
      ? `Session override draft: ${description(override)}. Execution with overrides is not connected yet; restore the file settings before running an experiment.`
      : "Using the experiment file's settings. Changes here apply only to this Runner session.";
    select.disabled = !original; query("runner-controller-apply").disabled = !original;
    query("runner-controller-reset").disabled = !override;
    step.disabled = !original || (select.value === "custom" ? original.kind : INPUT_PRESETS[select.value]?.kind) !== "digital";
  }
  function sync() {
    const current = override ?? original;
    if (current) { select.value = current.preset; step.value = current.stepSize ?? "0.1"; }
    render();
  }
  function change() { render(); }
  function apply() {
    try {
      if (!original) return;
      const candidate = select.value === "custom"
        ? validateInputBindingV1({ ...original, stepSize: Number(step.value) })
        : createInputBindingPreset(select.value, Number(step.value));
      override = JSON.stringify(candidate) === JSON.stringify(original) ? null : candidate;
      onChange(override); render();
    } catch (error) { query("runner-controller-note").textContent = error.message; }
  }
  function reset() { override = null; onChange(null); sync(); }
  select.addEventListener("change", change);
  query("runner-controller-apply").addEventListener("click", apply);
  query("runner-controller-reset").addEventListener("click", reset);
  render();
  return Object.freeze({
    adopt(binding) {
      original = validateInputBindingV1(binding); override = null;
      select.querySelector('option[value="custom"]')?.remove();
      if (original.preset === "custom") { const option = document.createElement("option"); option.value = "custom"; option.textContent = "Custom bindings from file"; select.append(option); }
      onChange(null); sync();
    },
    get overridden() { return override !== null; },
    destroy() {
      select.removeEventListener("change", change);
      query("runner-controller-apply").removeEventListener("click", apply);
      query("runner-controller-reset").removeEventListener("click", reset);
    },
  });
}

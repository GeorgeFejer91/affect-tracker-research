import { initializeResearchUi } from "../../site/src/research/app.js";
import { renderResearchUiMarkup } from "../../site/src/research/ui-view.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { parseExperimentPackageV1 } from "../../site/src/research/experiment-package.js";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";
import packageFixture from "./experiment-package-v1.canonical.json";

// Synthetic adapter in an isolated headless process. It never opens a picker,
// writes a recipe, starts a Run, or connects to the native application.
const cases = [];
const check = (name, condition) => { if (!condition) throw new Error(name); cases.push(name); };
const root = document.querySelector("main");
root.innerHTML = renderResearchUiMarkup("tauri");
const ui = initializeResearchUi(root, { surface: "tauri" });
const query = (selector) => root.querySelector(selector);
const waitFor = async (predicate) => {
  for (let count = 0; count < 200; count += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`UI did not settle: ${query("#research-announcer")?.textContent}`);
};
const change = (selector, value) => {
  query(selector).value = value;
  query(selector).dispatchEvent(new Event("input", { bubbles: true }));
  query(selector).dispatchEvent(new Event("change", { bubbles: true }));
};

(async () => {
  const parsed = await parseExperimentPackageV1(new TextEncoder().encode(`${canonicalJson(packageFixture)}\n`));
  const acknowledge = {
    schema: "affect-research-experiment-package-save-receipt", version: 1,
    packageId: parsed.package.packageId,
    packageDefinitionSha256: parsed.package.integrity.packageDefinitionSha256,
    canonicalSourceByteSha256: parsed.canonicalSourceByteSha256,
    byteLength: new TextEncoder().encode(parsed.canonicalSourceText).byteLength,
  };
  const load = async () => {
    root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.experimentPackageLoaded, { detail: { receipt: parsed } }));
    await waitFor(() => ui.experimentPackage && !query("#package-reexport").disabled);
  };
  await load();
  check("recipe load preserves its exact canonical text", ui.experimentPackageSourceText === parsed.canonicalSourceText);
  check("recipe load does not choose a participant language", ui.experimentPackageSelection === null);
  check("sampling, formats and reproduction appear once in Review", ["sampling-frequency", "output-csv", "output-tsv", "package-reproduction-status"].every((id) =>
    root.querySelectorAll(`#${id}`).length === 1 && query(`#${id}`).closest('[data-setup-section="review"]')));
  let request;
  let writes = 0;
  root.addEventListener(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
    event.preventDefault(); request = event.detail; writes += 1;
  });
  query("#package-reexport").click();
  await waitFor(() => request);
  check("delayed native write shows waiting and retains its source", ui.packageExportStatus.phase === "saving"
    && request.sourceText === parsed.canonicalSourceText && ui.packageExportStatus.saved === null);
  check("duplicate save and recipe load are disabled during writing", query("#package-reexport").disabled && query("#package-load").disabled);
  query("#package-reexport").click();
  check("duplicate click does not invoke another writer", writes === 1);
  request.complete({ status: "cancelled" });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("cancellation leaves loaded recipe available for retry", ui.packageExportStatus.phase === "cancelled" && !query("#package-reexport").disabled);
  request = null;
  query("#package-reexport").click();
  await waitFor(() => request);
  request.complete({ status: "saved", receipt: acknowledge });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("validated acknowledgement makes exact re-export saved", ui.packageExportStatus.phase === "saved"
    && ui.packageExportStatus.saved.sourceText === parsed.canonicalSourceText);
  request = null;
  query("#package-reexport").click();
  await waitFor(() => request);
  change("#sampling-frequency", "120");
  check("sampling edit immediately invalidates the loaded receipt", query("#package-file-status").dataset.state === "warning"
    && ui.packageReproductionReceipt === null);
  request.complete({ status: "saved", receipt: acknowledge });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("acknowledged old write preserves newer sampling and requires new export", query("#sampling-frequency").value === "120"
    && ui.packageExportStatus.phase === "changed" && query("#package-reexport").disabled);
  check("stale recipe cannot start", query("#start-experiment").disabled);
  await load();
  check("intentional reopen restores the saved sampling value", Number(query("#sampling-frequency").value) === parsed.package.settings.experiment.samplingFrequencyHz);
  let contribution = { revision: 0, enabled: false, pending: false, contribution: { preview: true }, dependencyRevisions: [] };
  const unregister = ui.registerPlannerContribution("P6", () => contribution);
  check("disabled optional XR draft leaves v1 available", !query("#package-reexport").disabled);
  contribution = { ...contribution, enabled: true, revision: 1 };
  ui.plannerContributionChanged("P6");
  check("active unsupported XR blocks export and Start with a routed issue", query("#package-reexport").disabled
    && query("#start-experiment").disabled && query('[data-planner-segment="P6"]')?.textContent.includes("successor"));
  unregister();
  ui.openSetupSection("review");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const panel = query('[data-setup-section="review"]');
  const bounds = panel.getBoundingClientRect();
  check("finalization controls fit Review horizontally", [...panel.querySelectorAll(".package-finalization button")].every((button) => {
    const rect = button.getBoundingClientRect();
    return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && button.scrollWidth <= button.clientWidth + 2;
  }));
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, cases });
  ui.destroy();
})().catch((error) => {
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, cases, error: error.stack });
  ui.destroy();
});

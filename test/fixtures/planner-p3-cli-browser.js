import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";
import { createStimulusOrderEditor } from "../../site/src/research/stimulus-order-editor.js";
import { createPlannerVariantCommandOwner } from "../../site/src/research/planner-authoring-p3.js";
import { createPlannerAuthoringSession } from "../../site/src/research/planner-authoring-session.js";
import { createVariantDesign } from "../../site/src/research/variant-design.js";
import { projectSavedVariantCatalogue } from "../../site/src/research/variant-catalogue-adapter.js";
import sample from "./variant-reproduction-v2.json";

const checks = [], errors = [], trace = [], covered = new Set();
const check = (name, condition) => { if (!condition) throw Error(name); checks.push(name); };
const equal = (name, a, b) => check(name, canonicalJson(a) === canonicalJson(b));
const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
addEventListener("error", event => errors.push(event.message));
addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
let ui;
try {
  const root = document.querySelector("main"); root.id = "research-app";
  root.dataset.researchSurface = "browser"; root.dataset.researchProgram = "planner";
  bootResearchUi(); ui = root.researchUi; await wait(150);
  const q = selector => root.querySelector(selector);
  check("actual Planner has no participant controls", !q("#start-experiment") && !q('[data-mode-panel="run"]'));
  await ui.restoreStudyIdentity(sample.workspace.study, { isCurrent: () => true });
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, { detail: {
    replace: true, items: sample.workspace.videoCatalogue.entries.map((entry, index) => ({
      stimulus: { stimulusId: `p3-cli-${index}`, title: entry.annotationId, source: { kind: "workspaceFile",
        relativePath: entry.sourceRelativePath, mimeType: "video/mp4", sha256: entry.sha256, byteLength: entry.byteLength, durationMs: entry.durationMs } },
      verified: true, displayGeometry: entry.geometry,
    })),
  } }));
  for (let i = 0; i < 200 && ui.getWorkspaceContributionSnapshot().pending; i++) await wait();
  const source = ui.getWorkspaceContributionSnapshot();
  check("synthetic P1 boundary became ready", !source.pending);
  await ui.setStimulusOrderCatalogue(source);
  ui.openSetupSection("stimuli"); await wait(150);
  const editor = createStimulusOrderEditor({ root: { querySelector: () => null, querySelectorAll: () => [] }, operate: async () => { throw Error("No file side effect allowed"); } });
  await editor.setCatalogueSource(source);
  const owner = createPlannerVariantCommandOwner({ editor });
  const session = createPlannerAuthoringSession({ owners: [owner] });
  const { library } = await projectSavedVariantCatalogue(source.contribution);
  const [a, b] = library.videos.map(video => video.annotationId);
  const raw = () => owner.read().values["P3.draft"];
  const click = selector => { const control = q(selector); check(`${selector} is an enabled actual control`, control && !control.disabled); control.click(); };
  const input = (selector, value) => { const control = q(selector); check(`${selector} is an enabled actual field`, control && !control.disabled); control.value = value; control.dispatchEvent(new Event("input", { bubbles: true })); control.dispatchEvent(new Event("change", { bubbles: true })); };
  const paste = text => { const data = new DataTransfer(); data.setData("text/plain", text); q('[data-order-row="0"][data-order-column="0"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); };
  async function parity(operation, args, editUi) {
    editUi(); await wait();
    const result = await session.execute({ schema: "affect-research-planner-command", version: 1,
      sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: session.revision,
      action: { kind: "apply", edits: [{ kind: "operation", owner: "P3", operation, arguments: args }] } });
    check(`${operation} applies through the shared command session`, ["applied", "incomplete"].includes(result.status));
    const draft = raw();
    equal(`${operation} UI titles match command values`, [...root.querySelectorAll("[data-order-title]")].map(control => control.value), draft.columns.map(column => column.title));
    equal(`${operation} UI cells match command values`, [...root.querySelectorAll("[data-order-row]")].map(control => control.value), draft.rows.flat());
    equal(`${operation} UI named ISIs match command values`, [...root.querySelectorAll("[data-isi-id]")].map(control => ({ isiId: control.dataset.isiId, durationMs: Number(control.value) })), draft.isiDefinitions);
    let contributionSha256 = null;
    if (!owner.validate().length) {
      await ui.prepareStimulusVariantContribution();
      const expected = await createVariantDesign(draft, library);
      equal(`${operation} actual UI contribution equals CLI compiler output`, ui.stimulusOrder.contribution, expected);
      equal(`${operation} actual UI occurrence identities equal CLI draft`, ui.stimulusOrder.draft, draft);
      contributionSha256 = expected.integritySha256;
    }
    covered.add(operation); trace.push({ operation, arguments: args, status: result.status, contributionSha256 });
  }
  await parity("isi.add", { durationMs: 500 }, () => { input("[data-isi-list]", "500"); click("[data-isi-add]"); });
  await parity("isi.add", { durationMs: 1500 }, () => { input("[data-isi-list]", "1500"); click("[data-isi-add]"); });
  await parity("variant.add", { title: "Variant 2", beforeVariantId: null }, () => click("[data-order-add-column]"));
  await parity("variant.rename", { variantId: "variant-2", title: "Reverse" }, () => input('[data-order-title="1"]', "Reverse"));
  const text = `${a}\t${b}\nISI1\tISI2\n${b}\t${a}`;
  await parity("table.paste", { entryId: "variant-1-entry-1", text }, () => paste(text));
  await parity("cell.set", { entryId: "variant-1-entry-1", referenceId: "ISI1" }, () => input('[data-order-row="0"][data-order-column="0"]', "ISI1"));
  await parity("isi.setDuration", { isiId: "ISI1", durationMs: 1750 }, () => input('[data-isi-id="ISI1"]', "1750"));
  await parity("row.add", { beforeEntryId: null }, () => click("[data-order-add-row]"));
  await parity("row.move", { entryId: "variant-1-entry-1", beforeEntryId: "variant-1-entry-3" }, () => click('[data-order-move="row"][data-order-index="0"][data-order-direction="1"]'));
  await parity("variant.move", { variantId: "variant-2", beforeVariantId: "variant-1" }, () => click('[data-order-move="variant"][data-order-index="1"][data-order-direction="-1"]'));
  await parity("isi.move", { isiId: "ISI2", beforeIsiId: "ISI1" }, () => click('[data-order-move="isi"][data-order-index="1"][data-order-direction="-1"]'));
  await parity("row.remove", { entryId: "variant-1-entry-6" }, () => click('[data-order-remove-row="5"]'));
  await parity("variant.remove", { variantId: "variant-2" }, () => click('[data-order-remove-column="0"]'));
  await parity("isi.remove", { isiId: "ISI2" }, () => click('[data-isi-remove="ISI2"]'));
  await parity("table.reset", {}, () => click("[data-order-reset]"));
  equal("every registered operation has actual UI parity", [...covered].sort(), owner.operations.map(operation => operation.id).sort());

  // Final review state exercises repeated videos and consecutive/terminal ISIs.
  await parity("isi.add", { durationMs: 1750 }, () => { input("[data-isi-list]", "1750"); click("[data-isi-add]"); });
  await parity("isi.add", { durationMs: 3213 }, () => { input("[data-isi-list]", "3213"); click("[data-isi-add]"); });
  await parity("variant.add", { title: "Variant 2", beforeVariantId: null }, () => click("[data-order-add-column]"));
  const finalText = `ISI1\t${b}\n${a}\tISI2\nISI2\t${b}\nISI1\t\n${a}\t\nISI2\t`;
  await parity("table.paste", { entryId: "variant-1-entry-1", text: finalText }, () => paste(finalText));
  const accepted = ui.stimulusOrder;
  check("terminal ISI and unequal variants retain exact order", accepted.contribution.variants[0].entries.at(-1).kind === "isi" && accepted.contribution.variants[1].entries.length === 3);
  const versions = q("#stimulus-order-versions details"); if (versions) versions.open = true;
  const mode = new URLSearchParams(location.search).get("mode");
  if (mode === "invalid") {
    input('[data-isi-id="ISI1"]', "");
    check("invalid GUI duration withdraws current contribution", ui.stimulusOrder === null);
    check("invalid GUI duration has an actionable status", q("#stimulus-order-status").dataset.state === "error");
    check("invalid duration cannot prepare", await ui.prepareStimulusVariantContribution().then(() => false, () => true));
  }
  await wait(150);
  const pane = q(".setup-pane"), section = q('[data-setup-section="stimuli"]');
  const captureTop = q(mode === "invalid" ? "#stimulus-order-status" : "#stimulus-order-editor");
  pane.scrollTop += captureTop.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
  if (mode === "actions") q(".stimulus-order-scroll").scrollLeft = 100000;
  await wait(80);
  check("no setup pane horizontal overflow", pane.scrollWidth <= pane.clientWidth + 1);
  check("reorder controls exist with explicit accessible names", [...section.querySelectorAll("[data-order-move]")].every(control => control.getAttribute("aria-label")?.startsWith("Move ")));
  const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const bounds = rect(q("#stimulus-order-editor"));
  if (mode === "invalid") {
    const status = rect(q("#stimulus-order-status")), input = rect(q('[data-isi-id="ISI1"]')), paneRect = rect(pane);
    check("invalid duration message and focused field are both visible in capture", status.y >= paneRect.y && status.y + status.height <= paneRect.y + paneRect.height
      && input.y >= paneRect.y && input.y + input.height <= paneRect.y + paneRect.height);
  }
  for (const row of section.querySelectorAll(".isi-definition")) check("named ISI row including all actions fits editor", rect(row).x >= bounds.x - 1 && rect(row).x + rect(row).width <= bounds.x + bounds.width + 1);
  check("no browser runtime errors", errors.length === 0);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors, trace, viewport: { width: innerWidth, height: innerHeight }, editor: bounds,
    finalContribution: accepted.contribution, mode, userAgent: navigator.userAgent, limitation: "Actual Planner UI and shared command-session parity with synthetic P1 declarations; no native media, OS picker or Runner proof." });
} catch (error) {
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, checks, errors, trace, error: error.message, stack: error.stack });
}

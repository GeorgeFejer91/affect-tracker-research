import { bootResearchUi } from "../../site/src/research/app.js";
import configured from "../../test/fixtures/research-feedback-settings-v2.json";

export async function checkPreviewStage(mode) {
  const root = bootResearchUi(), ui = root.researchUi, q = selector => root.querySelector(selector);
  if (innerWidth <= 800) Object.assign(q(".preview-pane").style, {width: "280px", minWidth: "0", maxWidth: "280px"});
  const initial = structuredClone(ui.getFeedbackContributionSnapshot().contribution);
  const restored = structuredClone(configured);
  restored.presentation.renderer = "flubber";
  restored.presentation.halo = {widthPercent: 187.5, gradient: true, steepness: 2.5};
  if (mode === "restored") await ui.restoreFeedbackContribution(restored);
  const intended = mode === "restored" ? restored : initial;
  const rows = [], check = (name, pass) => { rows.push({name, pass: Boolean(pass)}); if (!pass) throw Error(name); };
  const stage = q(".preview-primary-stage");
  check("no visual mode badge covers drawing", !stage.querySelector(".preview-mode-label"));
  const hiddenMode = stage.querySelector("[data-preview-mode-label]").parentElement;
  const modeBox = hiddenMode.getBoundingClientRect();
  check("existing textual mode is retained without visible overlay", hiddenMode.classList.contains("sr-only")
    && modeBox.width <= 1 && modeBox.height <= 1 && getComputedStyle(hiddenMode).overflow === "hidden");
  for (const mode of ["face", "grid", "flubber"]) {
    q(`[data-feedback-preview-mode="${mode}"]`).click();
    const selected = [...root.querySelectorAll('[data-feedback-preview-mode][aria-pressed="true"]')];
    check(`${mode} accessible selected state is unique`, selected.length === 1 && selected[0].dataset.feedbackPreviewMode === mode);
    check(`${mode} selection still reaches saved configuration`, ui.getFeedbackContributionSnapshot().contribution.presentation.renderer
      === (mode === "face" ? "procedural-face" : mode));
  }
  await ui.restoreFeedbackContribution(intended);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const state = ui.getPreviewInspectionSnapshot().rendering;
  check("inspection size, center and halo remain configured", state.sizePercent === 42 && state.position.x === 0.5
    && state.position.y === 0.5 && state.flubber.haloSizePercent === intended.presentation.halo.widthPercent
    && state.flubber.haloGradient === intended.presentation.halo.gradient);
  const outline = stage.querySelector("[data-preview-flubber-outline]"), halo = stage.querySelector("[data-preview-flubber-halo]");
  check("animated halo still follows exact outline", Boolean(outline.getAttribute("d")) && outline.getAttribute("d") === halo.getAttribute("d"));
  check("Flubber and halo stay visible", !stage.querySelector("[data-preview-flubber]").hasAttribute("hidden") && !halo.hasAttribute("hidden"));
  return {pass: true, mode, rows, paneWidth: q(".preview-pane").getBoundingClientRect().width};
}

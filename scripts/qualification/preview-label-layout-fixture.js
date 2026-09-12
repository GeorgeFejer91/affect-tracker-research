import { bootResearchUi } from "../../site/src/research/app.js";
import configured from "../../test/fixtures/research-feedback-settings-v2.json";

export async function checkPreviewLabelLayout(mode) {
  const root = bootResearchUi(), q = selector => root.querySelector(selector);
  // Exercise the allocated 280px pane without changing the product split owner.
  if (innerWidth <= 800) Object.assign(q(".preview-pane").style, {width: "280px", minWidth: "0", maxWidth: "280px"});
  const value = structuredClone(configured);
  value.presentation.colorAnchors = mode;
  const labels = ["Upper left — maximum length custom affect label!!",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv",
    "Lower right — maximum length custom affect label!",
    "Calm corner with a deliberately long custom label"];
  for (const [index, direction] of ["up", "right", "down", "left"].entries()) {
    value.presentation.labels[mode][direction] = labels[index].slice(0, 48);
  }
  await root.researchUi.restoreFeedbackContribution(value);
  const rows = [], check = (name, pass) => rows.push({name, pass: Boolean(pass)});
  const surface = q(".preview-control-surface").getBoundingClientRect();
  const map = q(".preview-affect-map").getBoundingClientRect();
  for (const button of root.querySelectorAll("[data-color-anchor]")) {
    const label = button.querySelector("[data-color-anchor-label]"), box = button.getBoundingClientRect();
    const text = label.getBoundingClientRect();
    check(`${button.dataset.colorAnchor}: maximum label retained`, label.textContent.length === 48);
    check(`${button.dataset.colorAnchor}: readable text column`, text.width >= 32);
    check(`${button.dataset.colorAnchor}: label fits button`, label.scrollWidth <= label.clientWidth + 1
      && text.left >= box.left && text.right <= box.right + 1 && text.bottom <= box.bottom + 1);
    check(`${button.dataset.colorAnchor}: anchor fits map panel`, box.left >= map.left && box.right <= map.right + 1);
    check(`${button.dataset.colorAnchor}: anchor does not cover map`, box.right <= surface.left
      || box.left >= surface.right || box.bottom <= surface.top || box.top >= surface.bottom);
  }
  check("map stays within panel", surface.left >= map.left && surface.right <= map.right + 1);
  return {pass: rows.every(row => row.pass), mode, rows, paneWidth: q(".preview-pane").getBoundingClientRect().width};
}

/** Remove participant execution composition before the Planner controllers mount.
 * The historical combined markup remains available to frozen compatibility tests.
 * Run execution has a separate bootstrap in runner/, never a Planner mode switch.
 */
export function preparePlannerSurface(root) {
  root.dataset.researchProgram = "planner";
  for (const selector of [
    '[data-mode-button="run"]', '[data-mode-panel="run"]',
    "#review-participant-chooser", "#review-participant-details",
    ".participant-language-readiness", ".start-bar", "#preflight-list",
    "#stop-early-dialog", "#completion-dialog", "#participant-language-dialog",
  ]) root.querySelector(selector)?.remove();
  root.querySelector("#native-playback-mode")?.closest("label")?.remove();
  const reviewLabel = root.querySelector('[data-setup-toggle="review"] h2, [data-setup-section="review"] .section-title');
  if (reviewLabel) reviewLabel.textContent = "Review & Export";
  for (const title of root.querySelectorAll("h2, h3, [data-section-title]")) {
    if (title.textContent === "Review & Start") title.textContent = "Review & Export";
  }
  const heading = root.querySelector(".product-block h1");
  if (heading) heading.textContent = "Experiment Planner";
  const navigation = root.querySelector(".mode-navigation");
  if (navigation) navigation.setAttribute("aria-label", "Experiment Planner");
  const status = root.ownerDocument.createElement("p");
  status.id = "planner-status"; status.className = "status-text";
  status.setAttribute("role", "alert"); status.hidden = true;
  root.querySelector(".setup-pane")?.prepend(status);
  const note = root.ownerDocument.createElement("p");
  note.className = "field-help";
  note.textContent = "Save the recipe, then open it in Experiment Runner to prepare a participant, play videos and record streams.";
  root.querySelector(".package-finalization")?.after(note);
}

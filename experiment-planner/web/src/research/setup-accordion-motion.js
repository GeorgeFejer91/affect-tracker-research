const SETUP_ACCORDION_MOTION_MS = 240;
const SETUP_ACCORDION_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SETUP_ACCORDION_SETTLE_BUFFER_MS = 80;
const panelTransitions = new WeakMap();

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(SETUP_ACCORDION_MOTION_QUERY).matches;
}

function settlePanel(panel, expanded) {
  panel.hidden = !expanded;
  panel.inert = !expanded;
  panel.dataset.motionState = expanded ? "open" : "closed";
  if (expanded) panel.removeAttribute("aria-hidden");
  else panel.setAttribute("aria-hidden", "true");
}

function clearPanelTransition(panel) {
  const active = panelTransitions.get(panel);
  if (!active) return;
  panel.removeEventListener("transitionend", active.onTransitionEnd);
  window.clearTimeout(active.timeoutId);
  panelTransitions.delete(panel);
}

export function setSetupAccordionPanelExpanded(panel, expanded) {
  const transitionState = expanded ? "opening" : "closing";
  const settledState = expanded ? "open" : "closed";
  const active = panelTransitions.get(panel);
  if (active?.expanded === expanded) return;
  if (!active && panel.dataset.motionState === settledState) return;
  clearPanelTransition(panel);

  if (prefersReducedMotion()) {
    settlePanel(panel, expanded);
    return;
  }

  if (panel.hidden) {
    panel.dataset.motionState = "closed";
    panel.hidden = false;
    panel.getBoundingClientRect();
  }
  panel.inert = !expanded;
  if (expanded) panel.removeAttribute("aria-hidden");
  else panel.setAttribute("aria-hidden", "true");

  const finish = () => {
    const current = panelTransitions.get(panel);
    if (!current || current.finish !== finish) return;
    clearPanelTransition(panel);
    settlePanel(panel, expanded);
  };
  const onTransitionEnd = (event) => {
    if (event.target === panel && event.propertyName === "grid-template-rows") finish();
  };
  const timeoutId = window.setTimeout(finish, SETUP_ACCORDION_MOTION_MS + SETUP_ACCORDION_SETTLE_BUFFER_MS);
  panelTransitions.set(panel, { expanded, finish, onTransitionEnd, timeoutId });
  panel.addEventListener("transitionend", onTransitionEnd);
  panel.dataset.motionState = transitionState;
}

export { SETUP_ACCORDION_MOTION_MS, SETUP_ACCORDION_MOTION_QUERY };

// Presentation geometry only: prefer pinned preview, fall back to one scroll
// surface when text zoom, narrow panes or short windows would hide controls.
export const MINIMUM_PREVIEW_CONTROLS_REM = 18;

export function createPreviewLayout(pane, { ResizeObserver = globalThis.ResizeObserver } = {}) {
  const header = pane.querySelector(".preview-header");
  const stage = pane.querySelector(".preview-primary-stage");
  const map = pane.querySelector(".preview-affect-map");
  const studio = pane.querySelector(".research-preview-studio");
  function refresh() {
    const style = getComputedStyle(pane), studioStyle = getComputedStyle(studio);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const gap = parseFloat(studioStyle.rowGap) || 0;
    // Leave room for a labelled control group and its help/actions, not a thin strip.
    const minimumControls = parseFloat(getComputedStyle(document.documentElement).fontSize) * MINIMUM_PREVIEW_CONTROLS_REM;
    const needed = header.getBoundingClientRect().height + stage.getBoundingClientRect().height
      + map.getBoundingClientRect().height + 2 * gap + padding + minimumControls;
    pane.classList.toggle("preview-pane-scroll-all", pane.clientHeight < needed);
  }
  const observer = ResizeObserver ? new ResizeObserver(refresh) : null;
  for (const element of [pane, header, stage, map]) observer?.observe(element);
  refresh();
  return Object.freeze({ refresh, destroy() { observer?.disconnect(); } });
}

// Presentation geometry only: prefer pinned preview, fall back to one scroll
// surface when text zoom, narrow panes or short windows would hide controls.
export function createPreviewLayout(pane, { ResizeObserver = globalThis.ResizeObserver } = {}) {
  const header = pane.querySelector(".preview-header");
  const stage = pane.querySelector(".preview-primary-stage");
  const map = pane.querySelector(".preview-affect-map");
  const studio = pane.querySelector(".research-preview-studio");
  function refresh() {
    const style = getComputedStyle(pane), studioStyle = getComputedStyle(studio);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const gap = parseFloat(studioStyle.rowGap) || 0;
    const minimumControls = parseFloat(getComputedStyle(document.documentElement).fontSize) * 8;
    const needed = header.getBoundingClientRect().height + stage.getBoundingClientRect().height
      + map.getBoundingClientRect().height + 2 * gap + padding + minimumControls;
    pane.classList.toggle("preview-pane-scroll-all", pane.clientHeight < needed);
  }
  const observer = ResizeObserver ? new ResizeObserver(refresh) : null;
  for (const element of [pane, header, stage, map]) observer?.observe(element);
  refresh();
  return Object.freeze({ refresh, destroy() { observer?.disconnect(); } });
}

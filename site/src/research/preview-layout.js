// Presentation geometry only: prefer pinned preview, fall back to one scroll
// surface when text zoom, narrow panes or short windows would hide controls.
export const MINIMUM_PREVIEW_CONTROLS_REM = 18;

export function createPreviewLayout(pane, {
  ResizeObserver = globalThis.ResizeObserver,
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
  readStyle = element => getComputedStyle(element),
} = {}) {
  const header = pane.querySelector(".preview-header");
  const stage = pane.querySelector(".preview-primary-stage");
  const map = pane.querySelector(".preview-affect-map");
  const studio = pane.querySelector(".research-preview-studio");
  let frame = null;
  let destroyed = false;
  function refresh() {
    if (destroyed) return;
    const style = readStyle(pane), studioStyle = readStyle(studio);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const gap = parseFloat(studioStyle.rowGap) || 0;
    // Leave room for a labelled control group and its help/actions, not a thin strip.
    const minimumControls = parseFloat(readStyle(pane.ownerDocument.documentElement).fontSize) * MINIMUM_PREVIEW_CONTROLS_REM;
    const needed = header.getBoundingClientRect().height + stage.getBoundingClientRect().height
      + map.getBoundingClientRect().height + 2 * gap + padding + minimumControls;
    const scrollAll = pane.clientHeight < needed;
    if (pane.classList.contains("preview-pane-scroll-all") !== scrollAll) {
      pane.classList.toggle("preview-pane-scroll-all", scrollAll);
    }
  }
  function scheduleRefresh() {
    if (destroyed || frame !== null) return;
    // Changing scrolling changes child geometry. Do not mutate that geometry
    // during ResizeObserver delivery, which can cause undelivered notifications.
    frame = requestFrame(() => { frame = null; refresh(); });
  }
  const observer = ResizeObserver ? new ResizeObserver(scheduleRefresh) : null;
  for (const element of [pane, header, stage, map]) observer?.observe(element);
  refresh();
  return Object.freeze({ refresh, destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    if (frame !== null) cancelFrame(frame);
    frame = null;
  } });
}

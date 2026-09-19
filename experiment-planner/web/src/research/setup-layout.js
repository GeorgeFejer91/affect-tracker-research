// Session-local Setup presentation. Never feeds settings, geometry, or Run.
const DEFAULT_FRACTION = 0.625;
const MIN_SECTIONS_WIDTH = 432;
const MIN_PREVIEW_WIDTH = 320;

export function createSetupLayout(layout) {
  const separator = layout.querySelector("[data-setup-resizer]");
  const view = layout.ownerDocument.defaultView;
  let preferredFraction = DEFAULT_FRACTION;
  let enabled = true;
  let destroyed = false;
  let drag = null;

  function measure() {
    const bounds = layout.getBoundingClientRect();
    const gripWidth = separator.getBoundingClientRect().width;
    const available = bounds.width - gripWidth;
    return {
      left: bounds.left, available,
      min: MIN_SECTIONS_WIDTH,
      max: available - MIN_PREVIEW_WIDTH,
      visible: enabled && gripWidth > 0 && available >= MIN_SECTIONS_WIDTH + MIN_PREVIEW_WIDTH,
      resizable: enabled && gripWidth > 0 && available > MIN_SECTIONS_WIDTH + MIN_PREVIEW_WIDTH,
    };
  }

  function refresh() {
    if (destroyed) return;
    const size = measure();
    separator.tabIndex = size.resizable ? 0 : -1;
    separator.setAttribute("aria-disabled", String(!size.resizable));
    if (!size.resizable) finishDrag();
    if (!size.visible) return;
    const width = Math.max(size.min, Math.min(size.max, preferredFraction * size.available));
    layout.style.setProperty("--setup-sections-width", `${width}px`);
    separator.setAttribute("aria-valuemin", String(Math.round(100 * size.min / size.available)));
    separator.setAttribute("aria-valuemax", String(Math.round(100 * size.max / size.available)));
    const percent = Math.round(100 * width / size.available);
    separator.setAttribute("aria-valuenow", String(percent));
    separator.setAttribute("aria-valuetext", `Sections ${percent}%, live preview ${100 - percent}%`);
  }

  function setWidth(width, size = measure()) {
    if (!size.resizable) return;
    preferredFraction = Math.max(size.min, Math.min(size.max, width)) / size.available;
    refresh();
  }

  function finishDrag({ revert = false } = {}) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    layout.removeAttribute("data-resizing");
    if (separator.hasPointerCapture(previous.id)) separator.releasePointerCapture(previous.id);
    if (revert) {
      preferredFraction = previous.fraction;
      refresh();
    }
  }

  function pointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false || drag) return;
    const size = measure();
    if (!size.resizable) return;
    separator.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId, fraction: preferredFraction,
      // Keep the point grabbed within the grip under the pointer.
      offset: event.clientX - separator.getBoundingClientRect().left,
    };
    separator.focus({ preventScroll: true });
    layout.setAttribute("data-resizing", "true");
    event.preventDefault();
  }

  function pointerMove(event) {
    if (drag?.id !== event.pointerId) return;
    const size = measure();
    if (!size.resizable) { finishDrag(); return; }
    setWidth(event.clientX - size.left - drag.offset, size);
    event.preventDefault();
  }

  function pointerEnd(event) {
    if (drag?.id !== event.pointerId) return;
    if (event.type === "pointerup") pointerMove(event);
    finishDrag();
  }

  function reset() {
    if (!measure().resizable) return;
    finishDrag();
    preferredFraction = DEFAULT_FRACTION;
    refresh();
  }

  function keyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || !measure().resizable) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", "Escape"].includes(event.key)) return;
    if (event.key === "Escape" && !drag) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") { finishDrag({ revert: true }); return; }
    finishDrag();
    const size = measure();
    const current = separator.getBoundingClientRect().left - size.left;
    const step = event.shiftKey ? 50 : 10;
    if (event.key === "Enter") reset();
    else if (event.key === "Home") setWidth(size.min, size);
    else if (event.key === "End") setWidth(size.max, size);
    else setWidth(current + (event.key === "ArrowLeft" ? -step : step), size);
  }

  const handlers = {
    pointerdown: pointerDown, pointermove: pointerMove,
    pointerup: pointerEnd, pointercancel: pointerEnd, lostpointercapture: pointerEnd,
    keydown: keyDown, dblclick: reset,
  };
  for (const [type, handler] of Object.entries(handlers)) separator.addEventListener(type, handler);
  const blur = () => finishDrag();
  view.addEventListener("blur", blur);
  const observer = new view.ResizeObserver(refresh);
  observer.observe(layout);
  refresh();

  return Object.freeze({
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) finishDrag();
      refresh();
    },
    destroy() {
      finishDrag();
      destroyed = true;
      observer.disconnect();
      view.removeEventListener("blur", blur);
      for (const [type, handler] of Object.entries(handlers)) separator.removeEventListener(type, handler);
      layout.style.removeProperty("--setup-sections-width");
    },
  });
}

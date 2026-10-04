import { measureLineStats, measureNaturalWidth, prepareWithSegments } from "./pretext-vendor.js";

/** Pretext checks the selected native-control label; full text stays below on no-fit. */
export function measureFacePickerText(select, fullLabel, signal) {
  if (!(select instanceof HTMLSelectElement) || !(fullLabel instanceof HTMLElement)) return;
  const update = async () => {
    await document.fonts.ready;
    if (signal?.aborted) return;
    const style = getComputedStyle(select);
    const text = select.selectedOptions[0]?.textContent ?? "";
    const size = Number.parseFloat(style.fontSize);
    const lineHeight = Number.parseFloat(style.lineHeight) || size * 1.25;
    const width = select.clientWidth - Number.parseFloat(style.paddingLeft)
      - Number.parseFloat(style.paddingRight) - 28;
    const height = select.clientHeight - Number.parseFloat(style.paddingTop)
      - Number.parseFloat(style.paddingBottom);
    let fits = false;
    try {
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const prepared = prepareWithSegments(text, font, { letterSpacing: Number.parseFloat(style.letterSpacing) || 0 });
      fits = width > 0 && height >= lineHeight && measureNaturalWidth(prepared) <= width - 2
        && measureLineStats(prepared, width).lineCount === 1;
    } catch { /* Browser layout remains readable and the complete name is exposed. */ }
    select.dataset.pretextFit = fits ? "fit" : "no-fit";
    fullLabel.textContent = fits ? "" : text;
  };
  const observer = new ResizeObserver(() => { void update(); });
  observer.observe(select);
  select.addEventListener("change", update, { signal });
  signal?.addEventListener("abort", () => observer.disconnect(), { once: true });
  void update();
}

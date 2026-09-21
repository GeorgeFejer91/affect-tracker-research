import {
  measureLineStats,
  measureNaturalWidth,
  prepareWithSegments,
} from "../../../../node_modules/@chenglou/pretext/dist/layout.js";

const ROUNDING_TOLERANCE_PX = 0.5;

export function chooseLargestFittingSize({ min, preferred, fits, iterations = 12 }) {
  if (fits(preferred)) return Object.freeze({ size: preferred, state: "fit" });
  if (!fits(min)) return Object.freeze({ size: min, state: "no-fit" });
  let low = min;
  let high = preferred;
  for (let index = 0; index < iterations && high - low > 0.05; index += 1) {
    const candidate = (low + high) / 2;
    if (fits(candidate)) low = candidate;
    else high = candidate;
  }
  return Object.freeze({ size: Math.floor(low * 10) / 10, state: "fit" });
}

function displayedText(element, textTransform) {
  const text = element.textContent ?? "";
  const locale = element.lang || element.ownerDocument.documentElement.lang || undefined;
  if (textTransform === "uppercase") return text.toLocaleUpperCase(locale);
  if (textTransform === "lowercase") return text.toLocaleLowerCase(locale);
  return text;
}

function number(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fitElement(element) {
  const view = element.ownerDocument.defaultView;
  const style = view.getComputedStyle(element);
  if (style.display === "none" || element.clientWidth <= 0 || element.clientHeight <= 0) return;
  const width = element.clientWidth - number(style.paddingInlineStart) - number(style.paddingInlineEnd);
  const height = element.clientHeight - number(style.paddingBlockStart) - number(style.paddingBlockEnd);
  if (width <= 0 || height <= 0) return;

  const rootSize = number(view.getComputedStyle(element.ownerDocument.documentElement).fontSize, 16);
  const preferred = number(element.dataset.fitTextPreferred, number(style.fontSize) / rootSize) * rootSize;
  const min = number(element.dataset.fitTextMin, 0.75) * rootSize;
  const maxLines = Math.max(1, Number.parseInt(element.dataset.fitTextLines ?? "1", 10) || 1);
  const sourceSize = number(style.fontSize, preferred);
  const lineHeightRatio = style.lineHeight === "normal" ? 1.2 : number(style.lineHeight, sourceSize * 1.2) / sourceSize;
  const letterSpacing = style.letterSpacing === "normal" ? 0 : number(style.letterSpacing);
  const text = displayedText(element, style.textTransform);
  const options = {
    letterSpacing,
    whiteSpace: style.whiteSpace === "pre-wrap" ? "pre-wrap" : "normal",
    wordBreak: style.wordBreak === "keep-all" ? "keep-all" : "normal",
  };
  const fits = (size) => {
    const font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
    const prepared = prepareWithSegments(text, font, options);
    const lineHeight = lineHeightRatio * size;
    if (maxLines === 1) {
      return measureNaturalWidth(prepared) <= width + ROUNDING_TOLERANCE_PX
        && lineHeight <= height + ROUNDING_TOLERANCE_PX;
    }
    const stats = measureLineStats(prepared, width);
    return stats.maxLineWidth <= width + ROUNDING_TOLERANCE_PX
      && stats.lineCount <= maxLines
      && stats.lineCount * lineHeight <= height + ROUNDING_TOLERANCE_PX;
  };
  const result = chooseLargestFittingSize({ min, preferred: Math.max(min, preferred), fits });
  const next = `${result.size.toFixed(1)}px`;
  if (element.style.getPropertyValue("--fit-text-size") !== next) {
    element.style.setProperty("--fit-text-size", next);
  }
  element.dataset.fitTextState = result.state;
}

export function createBoundedTextFitter(root) {
  const view = root.ownerDocument.defaultView;
  const dirty = new Set();
  let frame = 0;
  let destroyed = false;
  const flush = () => {
    frame = 0;
    if (destroyed) return;
    const elements = [...dirty];
    dirty.clear();
    for (const element of elements) fitElement(element);
  };
  const schedule = (element) => {
    if (!(element instanceof view.HTMLElement)) return;
    dirty.add(element);
    if (!frame) frame = view.requestAnimationFrame(flush);
  };
  const register = (scope = root) => {
    if (scope.matches?.("[data-fit-text]")) {
      resizeObserver.observe(scope);
      schedule(scope);
    }
    for (const element of scope.querySelectorAll?.("[data-fit-text]") ?? []) {
      resizeObserver.observe(element);
      schedule(element);
    }
  };
  const resizeObserver = new view.ResizeObserver((entries) => {
    for (const { target } of entries) schedule(target);
  });
  const mutationObserver = new view.MutationObserver((records) => {
    for (const record of records) {
      const parent = record.type === "characterData" ? record.target.parentElement : record.target;
      schedule(parent?.closest?.("[data-fit-text]"));
      for (const node of record.addedNodes ?? []) if (node instanceof view.HTMLElement) register(node);
    }
  });
  mutationObserver.observe(root, { subtree: true, childList: true, characterData: true });
  register();
  const fonts = root.ownerDocument.fonts;
  const refit = () => register();
  fonts?.addEventListener?.("loadingdone", refit);
  void fonts?.ready?.then(refit);
  return Object.freeze({
    refresh: refit,
    destroy() {
      destroyed = true;
      if (frame) view.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      fonts?.removeEventListener?.("loadingdone", refit);
      for (const element of root.querySelectorAll("[data-fit-text]")) {
        element.style.removeProperty("--fit-text-size");
        delete element.dataset.fitTextState;
      }
    },
  });
}

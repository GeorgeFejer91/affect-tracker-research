export function nativeInputRegionRequest(element, purpose, layoutEpoch, windowObject = globalThis.window) {
  const bounds = element?.getBoundingClientRect?.();
  const viewportWidth = Number(windowObject?.innerWidth);
  const viewportHeight = Number(windowObject?.innerHeight);
  if (!bounds || [bounds.left, bounds.top, bounds.right, bounds.bottom, bounds.width, bounds.height]
    .some((value) => !Number.isFinite(value))
    || !Number.isInteger(layoutEpoch) || layoutEpoch < 1
    || bounds.width < 8 || bounds.height < 8
    || !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)
    || bounds.left < 0 || bounds.top < 0
    || bounds.right > viewportWidth + 0.5 || bounds.bottom > viewportHeight + 0.5) {
    throw new Error("The visible native input allow-region is unavailable.");
  }
  return Object.freeze({
    purpose,
    layoutEpoch,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    viewportWidth,
    viewportHeight,
  });
}


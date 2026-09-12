/** Presentation-only version name. The timestamp never enters recipe content. */
export function plannerRecipeFilename(recipeId, { now = new Date() } = {}) {
  if (typeof recipeId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(recipeId)) {
    throw new TypeError("Recipe ID requires 1–128 lowercase identifier characters.");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())
    || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) {
    throw new TypeError("Recipe filename requires a valid UTC date in years 0001–9999.");
  }
  const timestamp = now.toISOString().replace("T", "_").replaceAll(":", "-").replace(".", "-");
  return `${recipeId}_${timestamp}.json`;
}

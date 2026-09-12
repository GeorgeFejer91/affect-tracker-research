import { readFile } from "node:fs/promises";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { resolveSavedXrLayoutContribution } from "../../site/src/research/xr-layout-recipe.js";
import { parseXrLayoutProfileV1, serializeXrLayoutProfileV1 } from "../../site/src/research/xr-layout.js";

const fixture = JSON.parse(await readFile(new URL("xr-layout-recipe-v1.json", import.meta.url)));
Math.random = () => { throw Error("Unexpected RNG input"); };
Date.now = () => { throw Error("Unexpected clock input"); };
for (const key of ["localStorage", "indexedDB", "navigator", "document", "window"]) {
  Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error(key); } });
}
const receipts = [];
for (const profile of fixture.profiles) {
  const source = serializeXrLayoutProfileV1(profile), reopened = parseXrLayoutProfileV1(source);
  const compiled = await resolveSavedXrLayoutContribution(reopened, {
    workspaceContribution: fixture.workspace, feedbackContribution: fixture.feedback,
    selectedTarget: "webxr-immersive-vr",
  });
  receipts.push({ source, compiled });
}
process.stdout.write(canonicalJson(receipts));

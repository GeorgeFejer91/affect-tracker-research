import { readFile } from "node:fs/promises";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { resolveSavedXrLayoutContribution } from "../../site/src/research/xr-layout-recipe.js";
import { parseXrLayoutProfileV1, serializeXrLayoutProfileV1 } from "../../site/src/research/xr-layout.js";
import { validateFeedbackContribution } from "../../site/src/research/feedback-settings.js";
import { createWorkspaceContribution } from "../../site/src/research/workspace-contribution.js";

const fixture = JSON.parse(await readFile(new URL("xr-layout-recipe-v1.json", import.meta.url)));
const catalogueV2 = JSON.parse(await readFile(new URL("research-video-catalogue-contribution-v2.json", import.meta.url)));
const workspaces = [fixture.workspace, createWorkspaceContribution({ study: fixture.workspace.study, videoCatalogue: catalogueV2 })];
Math.random = () => { throw Error("Unexpected RNG input"); };
Date.now = () => { throw Error("Unexpected clock input"); };
for (const key of ["localStorage", "indexedDB", "navigator", "document", "window"]) {
  Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error(key); } });
}
const receipts = [];
for (const workspace of workspaces) for (const feedback of [fixture.feedback, fixture.feedbackV2]) for (const profile of fixture.profiles) {
  const source = serializeXrLayoutProfileV1(profile), reopened = parseXrLayoutProfileV1(source);
  const compiled = await resolveSavedXrLayoutContribution(reopened, {
    workspaceContribution: workspace, feedbackContribution: feedback,
    selectedTarget: "webxr-immersive-vr",
  });
  receipts.push({ source, compiled, workspaceSource: canonicalJson(workspace), feedbackSource: canonicalJson(validateFeedbackContribution(feedback)) });
}
process.stdout.write(canonicalJson(receipts));

import { readFile } from "node:fs/promises";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { createDefaultResearchSettings } from "../../site/src/research/contracts.js";
import { projectVideoDisplayGeometryV1 } from "../../site/src/research/video-catalogue-contribution.js";
import { resolveXrLayoutDependencies, resolveXrLayoutContribution } from "../../site/src/research/xr-layout-authoring.js";
import { parseXrLayoutProfileV1, xrLayoutReceipt } from "../../site/src/research/xr-layout.js";

const catalogue = JSON.parse(await readFile(new URL("research-video-catalogue-contribution-v1.json", import.meta.url)));
const cases = JSON.parse(await readFile(new URL("xr-feedback-envelope-v1.json", import.meta.url))).cases;
const input = createDefaultResearchSettings().input;
Math.random = () => { throw Error("Unexpected RNG input"); };
Date.now = () => { throw Error("Unexpected clock input"); };
for (const key of ["localStorage", "indexedDB", "navigator"]) Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error(key); } });
const snapshot = (contribution, revision) => ({ revision, enabled: true, pending: false, contribution, dependencyRevisions: [] });
const receipts = [];
for (const item of cases) {
  const dependencies = await resolveXrLayoutDependencies({ P1: snapshot(catalogue, 17),
    P5: snapshot({ input, ...item.configuration }, 29) }, projectVideoDisplayGeometryV1);
  const receipt = await xrLayoutReceipt(item.profile);
  const reopened = parseXrLayoutProfileV1(receipt.canonicalSource);
  receipts.push({ receipt, resolved: resolveXrLayoutContribution(reopened, dependencies, reopened.target),
    catalogueRevision: dependencies.catalogueRevision, feedbackRevision: dependencies.feedbackRevision });
}
process.stdout.write(canonicalJson(receipts));

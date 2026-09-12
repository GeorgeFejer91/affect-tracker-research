import { readFile } from "node:fs/promises";
// Guard before importing the owner. Each invocation is a fresh Node process.
const forbidden = [];
const reject = name => { forbidden.push(name); throw new Error(`Unexpected ambient ${name}`); };
const ActualDate = Date;
globalThis.Date = class extends ActualDate {
  constructor(...args) { if (!args.length) reject("clock"); super(...args); }
  static now() { return reject("clock"); }
};
Math.random = () => reject("RNG");
for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches", "navigator"]) {
  Object.defineProperty(globalThis, name, { configurable: true, get: () => reject(name) });
}
const subtle = globalThis.crypto.subtle;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
  subtle, randomUUID: () => reject("crypto RNG"), getRandomValues: () => reject("crypto RNG"),
} });
const { canonicalJson, canonicalSha256 } = await import("../../site/src/research/canonical.js");
const { createVariantDesign, variantDesignToDraft } = await import("../../site/src/research/variant-design.js");
const { projectSavedVariantCatalogue } = await import("../../site/src/research/variant-catalogue-adapter.js");
const { assertVariantReproduction } = await import("./assert-variant-reproduction.js");
const fixture = JSON.parse(await readFile(process.argv[2], "utf8"));
const recipeSha256 = await canonicalSha256({ workspace: fixture.workspace, contribution: fixture.contribution });
const projections = await assertVariantReproduction(fixture.workspace, fixture.contribution, recipeSha256, fixture.expected);
const { library } = await projectSavedVariantCatalogue(fixture.workspace);
const reopened = await createVariantDesign(variantDesignToDraft(fixture.contribution), library);
process.stdout.write(JSON.stringify({ projections, canonical: canonicalJson(reopened), forbidden }));

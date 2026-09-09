import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const packageRootPath = process.argv[2];
const emptyProfilePath = process.argv[3];
if (!packageRootPath || !emptyProfilePath) {
  throw new Error(
    "Usage: node scripts/verify-experiment-package-instance.js <read-only-package-root> <empty-instance-profile>",
  );
}

const profileMetadata = await lstat(emptyProfilePath);
if (!profileMetadata.isDirectory() || (await readdir(emptyProfilePath)).length !== 0) {
  throw new Error("Independent instance profile must be a distinct empty directory.");
}

const forbiddenAmbientReads = [];
const forbidAmbientRead = (name) => {
  forbiddenAmbientReads.push(name);
  throw new Error(`Portable package resolution attempted to read ambient ${name}.`);
};
const NativeDate = globalThis.Date;
class GuardedDate extends NativeDate {
  constructor(...args) {
    if (args.length === 0) forbidAmbientRead("clock");
    super(...args);
  }

  static now() {
    return forbidAmbientRead("clock");
  }
}
Object.defineProperty(globalThis, "Date", { configurable: true, value: GuardedDate });
Object.defineProperty(Math, "random", {
  configurable: true,
  value: () => forbidAmbientRead("RNG"),
});
for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches", "navigator"]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => forbidAmbientRead(name),
  });
}
const nativeCrypto = globalThis.crypto;
if (!nativeCrypto?.subtle) throw new Error("The independent benchmark requires Web Crypto SHA-256.");
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: Object.freeze({
    subtle: nativeCrypto.subtle,
    getRandomValues: () => forbidAmbientRead("crypto RNG"),
    randomUUID: () => forbidAmbientRead("crypto RNG"),
  }),
});

const { canonicalJson, canonicalSha256, sha256Hex } = await import(
  "../site/src/research/canonical.js"
);
const {
  compileExperimentPackageSelectionV1,
  enumerateLanguageRoutesV1,
  parseExperimentPackageV1,
  serializeExperimentPackageV1,
} = await import("../site/src/research/experiment-package.js");

const canonicalPackageRootPath = await realpath(packageRootPath);
const packagePath = resolve(canonicalPackageRootPath, "experiment.package.json");
const packageMetadata = await lstat(packagePath);
if (!packageMetadata.isFile() || packageMetadata.isSymbolicLink()
  || (packageMetadata.mode & 0o222) !== 0) {
  throw new Error("The benchmark package must be a read-only regular root experiment.package.json.");
}
if (await realpath(packagePath) !== packagePath) {
  throw new Error("The benchmark package must not resolve through a linked or aliased path.");
}

const input = await readFile(packagePath);
const parsed = await parseExperimentPackageV1(input);
const canonicalSourceText = await serializeExperimentPackageV1(parsed.package);
if (parsed.sourceText !== canonicalSourceText
  || parsed.sourceByteSha256 !== parsed.canonicalSourceByteSha256) {
  throw new Error("Independent instance requires canonical experiment.package.json bytes.");
}

const canonicalAssetTreePath = await realpath(
  resolve(canonicalPackageRootPath, ...parsed.package.assetRoot.split("/")),
);
const treeRelativePath = relative(canonicalPackageRootPath, canonicalAssetTreePath);
if (treeRelativePath !== parsed.package.assetRoot.split("/").join(sep)) {
  throw new Error("The fixed package asset tree resolves outside its declared root.");
}

async function enumerateTree(directoryPath, relativeParts = []) {
  let entries = await readdir(directoryPath, { withFileTypes: true });
  if (process.env.AFFECT_RESEARCH_BENCHMARK_DIRECTORY_ORDER === "reverse") {
    entries = entries.reverse();
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Package asset tree contains a linked entry: ${entry.name}.`);
    }
    const nextParts = [...relativeParts, entry.name];
    if (metadata.isDirectory()) {
      files.push(...await enumerateTree(entryPath, nextParts));
    } else if (metadata.isFile()) {
      files.push({ path: entryPath, metadata, parts: nextParts });
    } else {
      throw new Error(`Package asset tree contains an unsupported entry: ${entry.name}.`);
    }
  }
  return files;
}

const treeFiles = await enumerateTree(canonicalAssetTreePath);
const declaredPaths = parsed.package.assets.stimuli
  .map(({ relativePath }) => relativePath)
  .sort();
const observedPaths = treeFiles
  .map(({ parts }) => `${parsed.package.assetRoot}/${parts.join("/")}`)
  .sort();
if (canonicalJson(observedPaths) !== canonicalJson(declaredPaths)) {
  throw new Error("Package asset tree contains missing, extra, or undeclared files.");
}

const observedAssets = [];
for (const asset of parsed.package.assets.stimuli) {
  const candidate = resolve(canonicalPackageRootPath, ...asset.relativePath.split("/"));
  const candidateRelativePath = relative(canonicalPackageRootPath, candidate);
  if (!candidateRelativePath || candidateRelativePath.startsWith(`..${sep}`)
    || candidateRelativePath === ".." || isAbsolute(candidateRelativePath)) {
    throw new Error(`Package asset escapes the declared tree: ${asset.relativePath}.`);
  }
  const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Package asset is not a regular non-link file: ${asset.relativePath}.`);
  }
  if ((metadata.mode & 0o222) !== 0) {
    throw new Error(`Package benchmark asset must be read-only: ${asset.relativePath}.`);
  }
  const canonicalCandidate = await realpath(candidate);
  const canonicalRelativePath = relative(canonicalPackageRootPath, canonicalCandidate);
  if (!canonicalRelativePath || canonicalRelativePath.startsWith(`..${sep}`)
    || canonicalRelativePath === ".." || isAbsolute(canonicalRelativePath)) {
    throw new Error(`Package asset resolves outside the declared tree: ${asset.relativePath}.`);
  }
  const assetBytes = await readFile(canonicalCandidate);
  const observedSha256 = await sha256Hex(assetBytes);
  if (assetBytes.byteLength !== asset.byteLength || observedSha256 !== asset.sha256) {
    throw new Error(`Package asset bytes do not match ${asset.relativePath}.`);
  }
  observedAssets.push({
    relativePath: asset.relativePath,
    byteLength: assetBytes.byteLength,
    sha256: observedSha256,
  });
}
observedAssets.sort((left, right) => (
  left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
));

const cases = [];
for (const route of enumerateLanguageRoutesV1(parsed.package.languageSelection)) {
  for (const { participantId } of parsed.package.settings.externalProtocol.definition.schedules) {
    const compiled = await compileExperimentPackageSelectionV1(parsed.package, {
      languageId: route.languageId,
      languageSelectionPath: route.optionIds,
      participantId,
    });
    cases.push({
      participantId,
      languageId: compiled.languageId,
      languageTag: compiled.languageTag,
      languageSelectionPath: compiled.languageSelectionPath,
      canonicalSourceByteSha256: parsed.canonicalSourceByteSha256,
      settingsSha256: compiled.settingsSha256,
      assetManifestSha256: parsed.package.integrity.assetManifestSha256,
      experimentPlanSha256: compiled.experimentPlan.planHashSha256,
      assignmentSha256: compiled.assignmentSha256,
      protocolPlanSha256: compiled.protocolPlan.protocolPlanHashSha256,
      assetBindingsSha256: await canonicalSha256(compiled.assetBindings),
      protocolStepsSha256: await canonicalSha256(compiled.protocolPlan.steps),
    });
  }
}

process.stdout.write(`${canonicalJson({
  schema: "affect-research-independent-package-instance-receipt",
  version: 1,
  packageDefinitionSha256: parsed.package.integrity.packageDefinitionSha256,
  canonicalSourceByteSha256: await sha256Hex(canonicalSourceText),
  assetManifestSha256: parsed.package.integrity.assetManifestSha256,
  assetTreeSha256: await canonicalSha256(observedAssets),
  verifiedAssetCount: observedAssets.length,
  ambientGuardVersion: "package-ambient-guard-v1",
  ambientDefaultReadCount: forbiddenAmbientReads.length,
  emptyProfileVerified: true,
  caseMatrixSha256: await canonicalSha256(cases),
  cases,
})}\n`);

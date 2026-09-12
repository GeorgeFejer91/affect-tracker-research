import { access, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const target = process.argv[2];

async function filesBelow(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

async function verifyRelativeModuleClosure(root, files) {
  for (const path of files.filter((entry) => entry.endsWith(".js"))) {
    const source = await readFile(resolve(root, path), "utf8");
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/gu),
      ...source.matchAll(/\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/gu),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      const target = resolve(root, dirname(path), specifier);
      try {
        await access(target);
      } catch {
        throw new Error(`${target} is missing; imported by ${path}.`);
      }
    }
  }
}

async function verifySelectedLogo(root, files, buildTarget) {
  const selectedLogo = await readFile(resolve(repositoryRoot, "site", "assets", "app-logo.svg"));
  const expectedLogoFiles = buildTarget === "pages"
    ? ["assets/app-logo.svg"]
    : files.filter((path) => /^assets\/app-logo-[A-Za-z0-9_-]+\.svg$/u.test(path));

  if (expectedLogoFiles.length !== 1) {
    throw new Error(`${buildTarget} build must contain exactly one selected app-logo SVG.`);
  }

  const emittedLogo = await readFile(resolve(root, expectedLogoFiles[0]));
  if (!emittedLogo.equals(selectedLogo)) {
    throw new Error(`${buildTarget} build app-logo SVG differs from the selected Aurora Axis source.`);
  }

  const index = await readFile(resolve(root, "index.html"), "utf8");
  const logoFilename = expectedLogoFiles[0].split("/").at(-1);
  if (!index.includes(logoFilename)) {
    throw new Error(`${buildTarget} index.html does not reference its emitted app-logo SVG.`);
  }

  const selectedSymbol = await readFile(resolve(repositoryRoot, "site", "assets", "app-symbol.svg"));
  const expectedSymbolFiles = buildTarget === "pages"
    ? ["assets/app-symbol.svg"]
    : files.filter((path) => /^assets\/app-symbol-[A-Za-z0-9_-]+\.svg$/u.test(path));
  if (expectedSymbolFiles.length !== 1) {
    throw new Error(`${buildTarget} build must contain exactly one transparent app-symbol SVG.`);
  }
  const emittedSymbol = await readFile(resolve(root, expectedSymbolFiles[0]));
  if (!emittedSymbol.equals(selectedSymbol)) {
    throw new Error(`${buildTarget} build app-symbol SVG differs from the transparent source.`);
  }

  const symbolFilename = expectedSymbolFiles[0].split("/").at(-1);
  const stylesheets = files.filter((path) => path.endsWith(".css"));
  const styles = await Promise.all(stylesheets.map((path) => readFile(resolve(root, path), "utf8")));
  if (!styles.some((source) => source.includes(symbolFilename))
      || styles.some((source) => source.includes(logoFilename))) {
    throw new Error(`${buildTarget} stylesheet must render the transparent app-symbol SVG instead of the launcher tile.`);
  }
}

const rules = {
  pages: {
    root: resolve(repositoryRoot, "dist-pages"),
    allowed: (path) => path === "index.html"
      || path === "research.css"
      || path === "experiment-template.json"
      || path === "src/math.js"
      || path === "questionnaires/questionnaire-template.csv"
      || path === "questionnaires/questionnaire-template.txt"
      || path === "questionnaires/questionnaire-template.json"
      || path === "questionnaires/maia-2-de.csv"
      || path === "questionnaires/maia-2-en.csv"
      || path === "questionnaires/ssq-six-item-en.csv"
      || path === "questionnaires/vr-exp-en.csv"
      || path === "assets/app-logo.svg"
      || path === "assets/app-symbol.svg"
      || /^assets\/app-icons\/(?:32x32|180x180|192x192|512x512)\.png$/u.test(path)
      || path.startsWith("assets/research-stimuli/")
      || (path.startsWith("src/research/") && !/^src\/research\/native-/u.test(path)),
  },
  desktop: {
    root: resolve(repositoryRoot, "desktop", "dist"),
    allowed: (path) => path === "index.html"
      || /^assets\/research-[A-Za-z0-9_-]+\.(?:css|js)$/u.test(path)
      || /^assets\/(?:maia-2-(?:de|en)|ssq-six-item-en|vr-exp-en)-[A-Za-z0-9_-]+\.csv$/u.test(path)
      || /^assets\/questionnaire-template-[A-Za-z0-9_-]+\.(?:csv|txt|json)$/u.test(path)
      || /^assets\/experiment-template-[A-Za-z0-9_-]+\.json$/u.test(path)
      || /^assets\/app-(?:logo|symbol)-[A-Za-z0-9_-]+\.svg$/u.test(path),
  },
};

if (!Object.hasOwn(rules, target)) {
  throw new Error("Usage: node scripts/verify-research-build.js <pages|desktop>");
}

const rule = rules[target];
const files = await filesBelow(rule.root);
const unexpected = files.filter((path) => !rule.allowed(path));
if (unexpected.length > 0) {
  throw new Error(`${target} build contains non-Research files: ${unexpected.join(", ")}`);
}
if (!files.includes("index.html")) throw new Error(`${target} build is missing index.html.`);
await verifyRelativeModuleClosure(rule.root, files);
await verifySelectedLogo(rule.root, files, target);
console.log(`${target} Research-only boundary verified (${files.length} files).`);

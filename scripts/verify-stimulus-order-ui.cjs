// Background renderer only: no desktop window, input synthesis, or clipboard.
// Supply Playwright through NODE_PATH when using the bundled verification runtime.
const { chromium } = require("playwright");
const { createServer } = require("node:http");
const { readFile, mkdir, writeFile } = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const root = path.resolve(__dirname, "..");
  const sectionOnly = process.argv.includes("--section-only");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
  const output = path.join(root, "src-tauri/target/segment3-verification", `${commit.slice(0, 12)}-${Date.now()}`);
  const sources = new Map();
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  sources.set("scripts/verify-stimulus-order-ui.cjs", sha256(await readFile(__filename)));
  await mkdir(output, { recursive: true });
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><link rel="stylesheet" href="/site/research.css"></head><body><div id="research-app"></div></body></html>'); return; }
      const file = path.resolve(root, "." + decodeURIComponent(pathname));
      if (!file.startsWith(root + path.sep)) throw new Error("Outside fixture root");
      response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/json");
      const bytes = await readFile(file);
      sources.set(path.relative(root, file).replaceAll(path.sep, "/"), sha256(bytes));
      response.end(bytes);
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().url().startsWith(origin + "/") ? route.continue() : route.abort());
    await page.goto(origin);
    const receipt = await page.evaluate(async () => {
      const { renderResearchUiMarkup, initializeResearchUi } = await import("/site/src/research/app.js");
      const { createStimulusOrderEditor } = await import("/site/src/research/stimulus-order-editor.js");
      const { setSetupAccordionPanelExpanded } = await import("/site/src/research/setup-accordion-motion.js");
      const fixture = await (await fetch("/test/fixtures/variant-design-v1.json")).json();
      const root = document.querySelector("#research-app");
      root.innerHTML = renderResearchUiMarkup();
      const controller = initializeResearchUi(root);
      const initialized = controller.openSection === "workspace";
      controller.destroy();
      root.innerHTML = renderResearchUiMarkup();
      const editor = createStimulusOrderEditor({ root, operate: async () => ({ library: fixture.library, design: fixture.document }) });
      await editor.adopt({ library: fixture.library, design: fixture.document }, { loadSaved: true });
      editor.setCatalogue({revision:1,videos:fixture.videos});
      await editor.prepareContribution();
      const section = root.querySelector('[data-setup-section="stimuli"]');
      // The fixture renders only the changed section; no app interaction is simulated.
      root.replaceChildren(section);
      section.querySelector(".setup-accordion-trigger").setAttribute("aria-expanded", "true");
      setSetupAccordionPanelExpanded(section.querySelector(".setup-accordion-panel"), true);
      const inputs = [...section.querySelectorAll("[data-order-row]")];
      const result = {
        initialized, columns: section.querySelectorAll("[data-order-title]").length,
        rows: section.querySelectorAll("tbody tr").length,
        values: inputs.map(input => input.value), labelled: inputs.every(input => input.getAttribute("aria-label")),
        versions: section.querySelectorAll(".variant-versions code").length,
        isiCells: section.querySelectorAll('[data-order-kind="isi"]').length,
        videoCells: section.querySelectorAll('[data-order-kind="video"]').length,
        noAssignments: !section.querySelector("#assignment-preview"),
        saveAccepted: await editor.confirm(),
        snapshot: editor.document,
      };
      editor.destroy();
      return result;
    });
    const fixture = JSON.parse(await readFile(path.join(root, "test/fixtures/variant-design-v1.json")));
    assert.equal(receipt.initialized, true);
    assert.equal(receipt.isiCells, 2); assert.equal(receipt.videoCells, 4);
    assert.equal(receipt.columns, 2); assert.equal(receipt.rows, 5);
    assert.deepEqual(receipt.values, fixture.document.draft.rows.flat());
    assert.equal(receipt.labelled, true); assert.equal(receipt.versions, 2);
    assert.equal(receipt.noAssignments, true); assert.equal(receipt.saveAccepted, true);
    assert.deepEqual(receipt.snapshot, fixture.document);
    await page.screenshot({ path: path.join(output, "segment3-wide.png"), fullPage: true });
    await page.setViewportSize({ width: 800, height: 900 });
    const contained = await page.evaluate(() => {
      const table = document.querySelector(".stimulus-order-scroll");
      return { page: document.documentElement.scrollWidth <= innerWidth, tableScrolls: table.scrollWidth > table.clientWidth };
    });
    assert.equal(contained.page, true);
    await page.screenshot({ path: path.join(output, "segment3-narrow.png"), fullPage: true });
    assert.deepEqual(errors, []);
    // Real composition boot, with typed fixture receipts only. No event synthesis for user input.
    await page.goto(origin);
    await page.evaluate(async () => {
      const { bootResearchUi } = await import("/site/src/research/app.js");
      const root = bootResearchUi({ surface: "browser" });
      root.researchUi.openSetupSection("stimuli");
    });
    if (sectionOnly) await page.evaluate(() => {
      const root = document.querySelector("#research-app");
      root.replaceChildren(root.querySelector('[data-setup-section="stimuli"]'));
      root.style.maxWidth = "432px";
      root.style.minWidth = "0";
      root.style.width = "432px";
      root.style.display = "block";
    });
    const bootChecks = [];
    for (const state of sectionOnly ? ["empty", "location"] : ["empty", "populated", "error", "location"]) {
      if (state === "populated") await page.evaluate(async () => {
        const fixture = await (await fetch("/test/fixtures/variant-design-v1.json")).json();
        await document.querySelector("#research-app").researchUi.restoreStimulusOrder(fixture.document,
          { library: fixture.library, catalogue: { revision: 1, videos: fixture.videos } });
      });
      if (state === "error") await page.evaluate(async () => {
        const fixture = await (await fetch("/test/fixtures/variant-design-v1.json")).json();
        const { RESEARCH_UI_EVENTS } = await import("/site/src/research/ui-contracts.js");
        const { createVideoLibrary } = await import("/site/src/research/stimulus-order.js");
        const { createVariantDraft, createVariantDocument, pasteVariantTable } = await import("/site/src/research/variant-design.js");
        const root = document.querySelector("#research-app");
        const [a, b] = fixture.library.videos.map(video => video.annotationId);
        // An accepted six-column order then loses the last column's video in
        // a valid P1 rescan. This exercises real stale-reference validation.
        const draft = pasteVariantTable(createVariantDraft(), 0, 0, [a,a,a,a,a,b].join("\t"), fixture.library);
        await root.researchUi.restoreStimulusOrder(await createVariantDocument(draft, fixture.library),
          { library: fixture.library, catalogue: { revision: 2, videos: fixture.videos } });
        const library = await createVideoLibrary(fixture.library.videos.slice(0, 1).map(({ annotationId, ...entry }) => entry));
        const changed = new Promise(resolve => {
          const observer = new MutationObserver(() => {
            if (root.querySelector('[data-order-kind="invalid"]')) { observer.disconnect(); resolve(); }
          });
          observer.observe(root.querySelector("#stimulus-order-editor"), { childList: true, subtree: true });
        });
        root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.videoLibraryChanged, { detail: { library, design: null } }));
        await changed;
      });
      if (state === "location") await page.evaluate(async () => {
        const fixture = await (await fetch("/test/fixtures/variant-reproduction-v2.json")).json();
        const { createVideoCatalogueContribution, videoAnnotationIdFromRelativePathV1 } = await import("/site/src/research/video-catalogue-contribution.js");
        const { createWorkspaceContribution } = await import("/site/src/research/workspace-contribution.js");
        const { projectSavedVariantCatalogue } = await import("/site/src/research/variant-catalogue-adapter.js");
        const { createVariantDocument } = await import("/site/src/research/variant-design.js");
        const sourceRelativePath = `stimuli/${Array.from({ length: 8 }, (_, i) => `${"_".repeat(200)}${i}`).join("/")}/clip.mp4`;
        const changed = fixture.workspace.videoCatalogue.entries[0], previous = changed.annotationId;
        Object.assign(changed, { sourceRelativePath, packageRelativePath: `assets/${sourceRelativePath}`,
          annotationId: videoAnnotationIdFromRelativePathV1(sourceRelativePath) });
        const workspace = createWorkspaceContribution({ study: fixture.workspace.study,
          videoCatalogue: await createVideoCatalogueContribution({ revision: 7, entries: fixture.workspace.videoCatalogue.entries }) });
        const projection = await projectSavedVariantCatalogue(workspace);
        fixture.draft.rows = fixture.draft.rows.map(row => row.map(cell => cell === previous ? changed.annotationId : cell));
        const root = document.querySelector("#research-app");
        await root.researchUi.restoreStimulusOrder(await createVariantDocument(fixture.draft, projection.library), {
          dependencies: { P1: { revision: 44, enabled: true, pending: false, contribution: workspace, dependencyRevisions: [] } },
        });
        root.querySelector("#stimulus-order-versions details").open = true;
      });
      for (const width of [1600, 800]) {
        await page.setViewportSize({ width, height: 1200 });
        if (state === "error") assert.equal(await page.evaluate(() => document.querySelector("#research-app").researchUi.confirmStimulusOrder()), false);
        const check = await page.evaluate(() => {
          const root = document.querySelector("#research-app"), scroll = root.querySelector(".stimulus-order-scroll");
          const focused = document.activeElement, bounds = focused.getBoundingClientRect(), pane = scroll.getBoundingClientRect();
          return { open: root.researchUi.openSection, viewportContained: document.documentElement.scrollWidth <= innerWidth,
            tableWidth: scroll.clientWidth, tableScrollWidth: scroll.scrollWidth,
            tableContained: scroll.getBoundingClientRect().right <= (root.querySelector(".setup-pane") ?? root).getBoundingClientRect().right,
            snapshot: root.researchUi.getStimulusOrderSnapshot(), errorVisible: root.querySelector("#stimulus-order-status").dataset.state === "error",
            errorText: root.querySelector("#stimulus-order-status").textContent,
            longestCell: Math.max(0, ...[...root.querySelectorAll("[data-order-row]")].map(input => input.value.length)),
            longestOption: Math.max(0, ...[...root.querySelectorAll("#video-annotation-options option")].map(option => option.value.length)),
            maxCellWidth: Math.max(0, ...[...root.querySelectorAll("[data-order-row]")].map(input => input.getBoundingClientRect().width)),
            focusedCell: [focused.dataset.orderRow, focused.dataset.orderColumn],
            focusedInvalid: focused.getAttribute("aria-invalid") === "true",
            focusedCellVisible: bounds.left >= pane.left && bounds.right <= pane.right && bounds.top >= 0 && bounds.bottom <= innerHeight };
        });
        assert.equal(check.open, "stimuli"); assert.equal(check.viewportContained, true, `${state} at ${width}px`);
        assert.equal(check.tableContained, true);
        if (width === 800 && state !== "empty") assert.ok(check.tableScrollWidth > check.tableWidth);
        if (state === "populated") assert.equal(check.snapshot.pending, false);
        if (state === "location") {
          assert.ok(check.longestCell > 4000); assert.equal(check.longestCell, check.longestOption);
          assert.ok(check.maxCellWidth < 500); assert.equal(check.snapshot.pending, false);
        }
        if (state === "error") {
          assert.equal(check.errorVisible, true); assert.equal(check.snapshot.contribution, null);
          assert.match(check.errorText, /Event 1, Variant 6: Unknown annotation/);
          assert.deepEqual(check.focusedCell, ["0", "5"]);
          assert.equal(check.focusedInvalid, true); assert.equal(check.focusedCellVisible, true);
        }
        bootChecks.push({ state, width, ...check, snapshot: undefined });
        await page.screenshot({ path: path.join(output, `segment3-boot-${state}-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    const evidence = { commit, dirty, sectionOnly, sourceSha256: Object.fromEntries([...sources].sort()), ...receipt, snapshot: undefined, contained, bootChecks, errors, output };
    await writeFile(path.join(output, "segment3-ui-receipt.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify(evidence));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

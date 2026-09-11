// Background renderer only: no desktop window, input synthesis, or clipboard.
// Supply Playwright through NODE_PATH when using the bundled verification runtime.
const { chromium } = require("playwright");
const { createServer } = require("node:http");
const { readFile, mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "src-tauri/target/segment3-verification");
  await mkdir(output, { recursive: true });
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><head><link rel="stylesheet" href="/site/research.css"></head><body><div id="research-app"></div></body></html>'); return; }
      const file = path.resolve(root, "." + decodeURIComponent(pathname));
      if (!file.startsWith(root + path.sep)) throw new Error("Outside fixture root");
      response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/json");
      response.end(await readFile(file));
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
    const bootChecks = [];
    for (const state of ["empty", "populated", "error"]) {
      if (state === "populated") await page.evaluate(async () => {
        const fixture = await (await fetch("/test/fixtures/variant-design-v1.json")).json();
        await document.querySelector("#research-app").researchUi.restoreStimulusOrder(fixture.document, { library: fixture.library });
      });
      if (state === "error") await page.evaluate(async () => {
        const fixture = await (await fetch("/test/fixtures/variant-design-v1.json")).json();
        const { RESEARCH_UI_EVENTS } = await import("/site/src/research/ui-contracts.js");
        const root = document.querySelector("#research-app");
        const changed = new Promise(resolve => {
          const observer = new MutationObserver(() => {
            if (root.querySelector("#stimulus-order-status").textContent.includes("Saved design is invalid")) { observer.disconnect(); resolve(); }
          });
          observer.observe(root.querySelector("#stimulus-order-status"), { childList: true });
        });
        root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.videoLibraryChanged, { detail: { library: fixture.library, design: null, designError: "Saved design is invalid. Review and confirm the table again." } }));
        await changed;
      });
      for (const width of [1600, 800]) {
        await page.setViewportSize({ width, height: 1200 });
        const check = await page.evaluate(() => {
          const root = document.querySelector("#research-app"), scroll = root.querySelector(".stimulus-order-scroll");
          return { open: root.researchUi.openSection, viewportContained: document.documentElement.scrollWidth <= innerWidth,
            tableWidth: scroll.clientWidth, tableScrollWidth: scroll.scrollWidth,
            tableContained: scroll.getBoundingClientRect().right <= root.querySelector(".setup-pane").getBoundingClientRect().right,
            snapshot: root.researchUi.getStimulusOrderSnapshot(), errorVisible: root.querySelector("#stimulus-order-status").dataset.state === "error" };
        });
        assert.equal(check.open, "stimuli"); assert.equal(check.viewportContained, true);
        assert.equal(check.tableContained, true);
        if (width === 800 && state !== "empty") assert.ok(check.tableScrollWidth > check.tableWidth);
        if (state === "populated") assert.equal(check.snapshot.pending, false);
        if (state === "error") { assert.equal(check.errorVisible, true); assert.equal(check.snapshot.contribution, null); }
        bootChecks.push({ state, width, ...check, snapshot: undefined });
        await page.screenshot({ path: path.join(output, `segment3-boot-${state}-${width}.png`), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    const evidence = { ...receipt, snapshot: undefined, contained, bootChecks, errors, output };
    await writeFile(path.join(output, "segment3-ui-receipt.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify(evidence));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

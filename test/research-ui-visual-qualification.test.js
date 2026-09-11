import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the non-shipping visual fixture projects every protocol UI state through real UI contracts", async () => {
  const [html, source, pagesBuild, desktopBuild] = await Promise.all([
    readFile(new URL("scripts/qualification/research-ui-visual.html", root), "utf8"),
    readFile(new URL("scripts/qualification/research-ui-visual.js", root), "utf8"),
    readFile(new URL("scripts/build-research-pages.js", root), "utf8"),
    readFile(new URL("desktop/vite.config.js", root), "utf8"),
  ]);

  assert.match(html, /data-research-surface="browser"/u);
  assert.match(html, /research\.css\?v=0\.4\.0-alpha\.1/u);
  assert.match(source, /bootResearchUi/u);
  assert.match(source, /RESEARCH_UI_EVENTS/u);
  for (const state of ["setup", "workspace-empty", "workspace-populated", "stimulus", "questionnaire", "interval", "complete"]) {
    assert.match(source, new RegExp(`"${state}"`, "u"));
  }
  assert.match(source, /visual-projection-only/u);
  assert.doesNotMatch(source, /createBrowserResearchRuntime|createNativeProtocolAdapter|research_native_protocol_start/u);
  assert.doesNotMatch(pagesBuild, /scripts[\\/]qualification/u);
  assert.match(desktopBuild, /root:\s*desktopRoot/u);
  assert.match(desktopBuild, /publicDir:\s*false/u);
  assert.doesNotMatch(desktopBuild, /scripts[\\/]qualification/u);
});

import test from "node:test";
import assert from "node:assert/strict";
import { renderResearchUiMarkup } from "../experiment-planner/web/src/research/ui-view.js";

test("top preview button releases Flubber while custom bindings stay in Controls", () => {
  const markup = renderResearchUiMarkup("tauri");
  assert.equal([...markup.matchAll(/<dialog\b/gu)].length, [...markup.matchAll(/<\/dialog>/gu)].length,
    "dialog markup must have balanced element boundaries");
  const dialog = markup.match(/<dialog id="binding-capture-dialog"[\s\S]*?<\/dialog>/u)[0];
  assert.deepEqual([...dialog.matchAll(/data-binding-capture-target="(\w+)"/gu)].map(match => match[1]).sort(), ["down", "left", "right", "up"]);
  const area = dialog.match(/<div class="dialog-content binding-capture-area"[\s\S]*?<\/div>/u)[0];
  assert.doesNotMatch(area, /<button/u);
  assert.match(dialog, /class="binding-centre-pending" disabled/u);
  assert.doesNotMatch(markup, /id="preview-input-menu"/u);
  assert.match(markup, /id="preview-flubber-release"[^>]*aria-label="Release Flubber into the preview"[^>]*aria-pressed="false"/u);
  assert.doesNotMatch(markup.match(/<header class="preview-header"[\s\S]*?<\/header>/u)?.[0] ?? "", /binding-capture-dialog/u);
  for (const direction of ["up", "down", "left", "right"]) {
    assert.match(markup, new RegExp(`data-binding-direction="${direction}"[^>]*aria-controls="binding-capture-dialog"`, "u"));
  }
  assert.match(dialog, /individual axis directions cannot be assigned here/u);
});

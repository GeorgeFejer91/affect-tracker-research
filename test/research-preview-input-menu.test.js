import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderResearchUiMarkup } from "../site/src/research/ui-view.js";

test("input menu reuses four saved directions outside the native capture allow-region", () => {
  const markup = renderResearchUiMarkup("tauri");
  const dialog = markup.match(/<dialog id="binding-capture-dialog"[\s\S]*?<\/dialog>/u)[0];
  assert.deepEqual([...dialog.matchAll(/data-binding-capture-target="(\w+)"/gu)].map(match => match[1]).sort(), ["down", "left", "right", "up"]);
  const area = dialog.match(/<div class="dialog-content binding-capture-area"[\s\S]*?<\/div>/u)[0];
  assert.doesNotMatch(area, /<button/u);
  assert.match(dialog, /class="binding-centre-pending" disabled/u);
  assert.match(markup, /id="preview-input-menu"[^>]*aria-haspopup="dialog"[^>]*aria-controls="binding-capture-dialog"/u);
  assert.match(dialog, /individual axis directions cannot be assigned here/u);
});

test("approved input SVGs retain exact supplied bytes and remain self-contained", async () => {
  const hashes = { light: "3629f6cbc973aaa28dbadf6510d150c6afc761c65f46ef8c7f6492d15df843f1", dark: "0e8651e3d8e319d100429766dcae65dec31c75501f772b22b64ce2b88838dc46" };
  for (const [theme, hash] of Object.entries(hashes)) {
    const bytes = await readFile(new URL(`../site/assets/flubber-input-${theme}.svg`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    assert.doesNotMatch(bytes.toString(), /<script|<image|<foreignObject|href=/iu);
  }
});

# P5 rendered-control qualification

E2E-UI/P5, Backend Verification. This bounded harness operates the actual
production Planner controls/controller in fresh-profile headless Chromium. It
uses synthetic DOM input/change/click/key events after checking each target is
rendered, enabled and contained in its viewport and scroll ancestors. Disclosures
are opened through their summary controls. It does not operate hidden color
storage fields or disabled compatibility controls. The exact saved contribution
is read from the production P5 owner after each edit.

Run from the source checkout with a clean `site/` and a fresh output directory:

```powershell
node scripts/qualification/planner-p5-ui.mjs '<browser.exe>' '<fresh-output-dir>'
node scripts/qualification/planner-p5-ui.mjs '<browser.exe>' '<fresh-output-dir>' overview,response,advanced,mappings,color,input --require-integrated
```

The optional third argument selects comma-separated scenes from `overview`,
`response`, `advanced`, `mappings`, `color`, `input`. The overview runs all checks;
other scenes capture the indicated real UI. Both 1280×1000 and 800×1000 CSS-pixel
application viewports run. Screenshot canvas is 1280×1100, with the application
viewport explicitly sized by the iframe. No user browser profile or window is
opened, focused, reused, closed or attached to.

Every one of the 61 writable catalogue entries gets an individual receipt row
with its required renderer/response/anchor/halo mode, concrete operated controls,
labels and measured rectangles, complete expected and actual P5 configurations,
and compatibility preservation. The report records verified, mode-specific N/A
and unresolved counts; failures remain individual rows and fail the harness.
Additional cases cover all nine presets, all three renderer transitions, custom
keyboard capture through the real dialog, the seven disabled compatibility
controls, even-grid and blank-mapping pending/recovery, unapplied/canceled labels
and analog-to-digital retained-step behavior.

Fixtures seed known preconditions through the existing complete P5 restore API.
Tested edits themselves use the rendered controls. With the combined app, the
harness obtains its actual `researchUi.plannerAuthoringSession`; it registers no
fixture owners and installs no app shim. `--require-integrated` fails if that real
session is absent. It verifies all seven owners and the exact P5 catalogue, then
reads each UI result through a command, restores the same preconditions, applies
the matching command and compares the complete P5 contribution and configured
preview/control projection. Each command must publish exactly one revision.
The transcript includes actual request/result envelopes. Additional command checks
exercise invalid GUI text preservation, recovery and all seven read-only fields.
The detached typed adapter remains an additional independent editor-path oracle.
Without an actual session the receipt explicitly reports only that owner oracle.
Neither path claims native stdin transport. Main owns the complete JSON/file mock
and native media checks. Runner correspondence is active under
its own allocation. No physical device, installed accessibility or timing claim
is made by synthetic headless input.

Each receipt binds the clean Git commit/site tree, browser executable, harness,
fixture, generated bundle, parent HTML and screenshot SHA-256. Output is retained
even for failed checks. Screenshot PNGs must be manually inspected before making
a visual completion claim; `pass: true` alone proves only the automated checks.

The integrated owner evidence uses an independent checkout of Main's clean
registration freeze `23e8f3a3671f87e7e73dbfd422847479fd5e5fa7`, on isolated
`codex/segment-p5-ui-integrated`. Only this P5 harness and documentation are added;
the application tree is unchanged. The initial actual-session probe passes all
61 fields at both widths, with zero unresolved or mode-specific N/A fields.
Final source-bound browser and image receipts are recorded in the P5 board entry.

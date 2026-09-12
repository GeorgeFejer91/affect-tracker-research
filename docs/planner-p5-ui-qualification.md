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

## Completed owner receipt

All 61 settings are **verified individually** in Chrome and Edge at both widths:
zero unresolved fields and zero mode-specific N/A fields. Each of the four runs
contains 74 paired edit/transition rows, 20 additional checks and 232 actual
production-session commands. All 24 selected screenshots were inspected; controls,
mapping inputs, applied/draft labels and binding dialogs remain readable and
contained. No application defect or P5 production follow-up was found.

Application tree `0c7ed15c9a33f94562dd929df19e0e7e7538fbb8` is unchanged from Main's
`23e8f3a` registration freeze. Harness `4321e24` supplies all six scenes. The
single-line `cd1ccb1` follow-up frames only the overview at the actual preview
pane's top; the four overview receipts were rerun at that exact checkpoint.
Other scene receipts retain their original `4321e24` binding.

Evidence root:
`C:/Users/Georgeous/Documents/GitHub/affect-tracker-research-feedback-checks/cli-p5/`.
`p5-ui-final-review.md` lists every field across all four runs and links every
inspected PNG. `p5-ui-final-review.json` binds all 24 receipt/image hashes, and
`p5-ui-final-review.mjs` verifies the source tree, exact field coverage, complete
contribution/projection equality, command revision increments and output hashes.
It passes 244 field results, 24 images and 928 command exchanges.

Detailed scene directories are `ui-integrated-{chrome,edge}-4321e24`; final
overview directories are `ui-integrated-overview-chrome-cd1ccb1` and
`ui-integrated-overview-edge-retry-cd1ccb1`. The first Edge overview refresh
returned empty launcher streams and no HTTP page receipt before timeout despite
a final PNG. That failed output is retained and excluded. An unchanged sequential
fresh-profile retry passed both widths; no assertion or timeout was weakened.

The fixed-control helper was handed off as `2174311` with 50 focused software
checks; Main collected it before this real application comparison. Native stdin,
complete recipe/file/media mock and Runner correspondence retain their separate
owners and gates. P5 source writers are stopped for integration collection.

# Segment redundancy and visual compactness audit

This is the running visual cleanup checklist requested on 2026-09-11.
It supplements, rather than replaces, the capability catalogue in
[`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md), the dated functional
redundancy inventory D01–D18 in [`61-IMPLEMENTATION-AUDIT.md`](./61-IMPLEMENTATION-AUDIT.md),
and the implementation sequence in [`62-PLANNER-CLOSURE-PLAN.md`](./62-PLANNER-CLOSURE-PLAN.md).
The charter remains the product authority. A cleaner screen is not proof that
its recipe contribution or Runner implementation is complete.

## Scope and ownership

Stage: **UI Finalization**. Inspect every actual rendered Planner segment for
repeated functions, controls and explanations; unnecessary panels and spacing;
clear grouping, labels, error feedback and keyboard access. Apply the locally
installed Uncodixfy skill, retaining the established app palette and the
researcher's explicitly requested Flubber/halo and confirmation effects.

Root coordination owns this record and `scripts/qualification/segment-visual-audit.mjs`.
Existing P1–P7 tasks own their segment fixes. The integration task owns source
convergence, the old Experiment shell and shared navigation. The divider owner
may adjust narrow section headers; Preview/P5 owns preview content and its
scroll layout. Do not create another implementation owner for these seams.

Every finding below needs its own evidence. “Owner ready” is a handoff state,
not evidence of canonical integration. “Rendered” means the real bootstrapped
application was captured and a person or visual agent inspected the image;
source searches and zero-overflow assertions alone do not satisfy that term.

## Review snapshot — 2026-09-12

Continuation update at 09:34 UTC: the researcher explicitly instructed the
paused tasks to continue. S1–S7 and integration are active on their remaining
contribution/composition work, as allocated in message
`20260912-roadmap-resumed-segment-completion`. The earlier stage pause is lifted
for that requested work. Owner-level visual evidence below remains valid for
its exact source; V28 still requires the eventual combined application.

All seven owners have completed a bounded visual cleanup handoff. Actual
rendered owner versions were inspected at desktop and constrained widths;
the evidence and remaining limits are recorded below. Canonical source remains
clean `ba2110f`. Integration has advanced beyond its initial `c7ba103` UI
candidate; the exact interim capture below is `64da370`, and later owner-reported
checks name `4f505c3`. The later 30-image `b9d520d` capture is reviewed below;
its Review warning-list follow-up is resolved in the subsequent exact-source
`7946bc6` default-state review. This closes the bounded cleanup handoff, not the
new complete Planner JSON goal. The open
checkboxes retain that distinction; they do not mean the owner fixes are absent.

| Segment | Cleanup verified in the owner handoff | Ready checkpoint |
| --- | --- | --- |
| P1 Workspace | One video import/catalogue home; shorter directory copy; readable path/action rows and actual ready/error states. | `9d4b663` plus separate relocation `3df60fa` |
| P2 Questionnaires | Removed obsolete dialogs; earlier, compact table; disclosed detailed settings; visible errors and language labels. | `714b22d` (app source `9ff3d5f`) |
| P3 Versions and ISIs | One named-ISI/version table; removed inert handlers; stable video colors; invalid-cell focus and horizontal reveal. | `4a2389c` |
| P4 Screen layout | Paired geometry fields; fewer nested boxes; adjacent missing-input warning; readable miniature legend. | `466412a` |
| P5 Flubber and controls | Consolidated old sections; one anchor-color editing route; no overlapping caption; useful settings scroll area. | `597a612` (app source `8d3d256`) |
| P6 Optional XR | Independent segment; disclosed profile tools; readable spatial legend; compact fields and errors. | `e43f018` (UI handoff `5d60ef6`) |
| P7 Review and export | One export path; grouped repeated prerequisites; disclosed details; readable narrow language recovery and footer. | `6bac40f` |

The shared header reflow is ready at `82c7d6c`; removal of the old Experiment
shell is in integration candidate `c7ba103`. The required next visual step is
V28: render and inspect the final combined source after ready handoffs are
collected. Do not substitute an older installed application or aggregate test
counts from separate branches for that check.

## Complete-settings followup — 2026-09-12

The new P5 v2 restored labels exposed a real narrow-pane defect after the earlier
default-state cleanup: corner captions could break one character per line.
Preview `d711fb4` rearranges corner anchors; final `9237279` bounds only narrow
left/right editor captions to three lines while preserving the full DOM text,
accessible name, hover text, dialog editor and saved label. Root inspected the
final narrow axes image and previously reviewed the corner arrangement. This is
editor compactness, not truncation of participant labels or experiment content.

Final evidence lives under
`D:/GitHub/.affect-preview-checks/planner-feedback-labels-20260912/` in
`clean-capped-axes` and `clean-capped-corners`. Root verified all four 1280/800
HTML and PNG hashes against their JSON receipts; all bind clean application
`92372794f5fa151448abf287797b67c109337fc5`. The receipts contain 122 passing label
checks. Full restored-controller checks and the eventual combined app retain
their own source binding; these owner images do not close G09 for master Save.

The companion-boundary review also found and routed a missing retained Planner
error surface. Fix `17b2d24` creates visible/announced `#planner-status` and covers
a rejected workspace command. Root source review confirms the fix; that fixture
hides the error before its screenshot, so final combined error-layout rendering
must still include the visible failure state.

The capture helper now explicitly boots `data-research-program="planner"` and
asserts that participant Run/Start surfaces are absent. This prevents future
captures from accidentally exercising preserved compatibility markup. Exact
clean `17b2d24` was captured in Chrome and Edge, four Review PNGs per browser at
1280/800 with full scroll. Root/independent review inspected all eight images;
every PNG and harness binding matches, with zero participant controls, errors,
duplicate IDs or pane overflow. The footer is reachable. Receipt directories:
`D:/GitHub/.affect-preview-checks/planner-role-chrome-17b2d24-20260912` and
`D:/GitHub/.affect-preview-checks/planner-role-edge-17b2d24-20260912`.
The residual heading "Before starting" was routed to integration for Planner
review wording. This smoke proves the changed helper/default Planner surface,
not populated master export or a native/runtime bridge.

## Capture method and baseline

The first audited integrated application source is clean `bed461b9c65d8e518092d8c9d813e944b1f96ce6`.
It still has the historical eight sections. New P4/P6 views and consolidated
P5/P7 require another pass after integration; do not call the old eight views
the final seven-segment design.

The reusable capture script runs the actual `bootResearchUi()` in an isolated
headless browser and fresh process-local profiles. It opens each registered
section through the application controller, uses exact 1280×900 and 800×700
iframe viewports, and scrolls through long sections with overlap. It collects
the source commit, dirty-source guard, viewport, section height, visible
controls, duplicate IDs, horizontal overflow and runtime errors. It uses the
application's real reduced-motion preference for settled static captures;
this is not animation or physical-input qualification. No user window is
attached or controlled. The app's default data state is recorded explicitly.

For the next combined capture, the helper uses actual element visibility rather
than layout rectangles, which Chromium may retain inside closed disclosures.
It also records the harness SHA-256 and each PNG SHA-256. These additions apply
to new receipts only; they do not retroactively strengthen older captures.
The two-viewport smoke run at clean P6 `3bedea1` passes with stable source,
zero runtime/pane-overflow errors and matching harness/PNG hashes. Root inspected
both disabled-XR captures at
`D:/GitHub/.affect-preview-checks/capture-helper-3bedea1-20260912`.
This verifies the changed capture helper, not final combined V28 coverage.

Local evidence directories:

- `D:/GitHub/.affect-preview-checks/segment-audit-bed461b-v2`: 11 screenshots of
  Input and Review, including both viewports and all Review pages.
- `D:/GitHub/.affect-preview-checks/segment-audit-bed461b-sections`: 17 screenshots
  covering Workspace, Questionnaires, Stimuli, Experiment, Visual and Advanced.
- `D:/GitHub/.affect-preview-checks/integration-20260911`: additional inspected
  integrated preview, resize, confirmation and enlarged-text captures.

Both settled baseline manifests report stable source and no runtime errors or
horizontal pane overflow. These results do not establish aesthetic quality,
all control behavior, contrast compliance or backend correctness. The first
`segment-audit-bed461b` experiment measured during accordion motion and is
superseded; do not use its geometry or page coverage as an acceptance receipt.
Dark space outside a controlled iframe belongs to the capture wrapper, not
the application layout.

## Combined candidate inspection — 2026-09-12

Root captured a detached, clean snapshot of integration candidate
`64da3705d105fda62bb260e313f655024c51e83d` at
`D:/GitHub/affect-tracker-research-visual-review`. It contains seven registered
owners and the collected P1/P2/P4/P5/P6/P7 UI handoffs. P3's new version editor
and subsequent contribution/acceptance work are not included. Canonical source
had not yet been promoted; this is an interim combined UI receipt.

All **33 Chrome PNGs** were visually inspected, using actual default app data
at controlled 1280×900 and 800×700 viewports. Source remained unchanged; the
receipts report no runtime errors, duplicate IDs or horizontal pane overflow.
The actual Setup panes are 795px and 472px. Evidence directories:

- `D:/GitHub/.affect-preview-checks/combined-64da370-chrome-sections-20260912`:
  14 images covering full Workspace, empty Questionnaires, the retained P3
  predecessor and Layout, including every scrolled page/footer.
- `D:/GitHub/.affect-preview-checks/combined-64da370-chrome-v2-20260912`:
  19 images covering persistent Flubber controls, disabled optional XR and
  full Review at both widths.

No new material visual defect was found in the captured P1/P2/P4/P5/P6 states.
Review's rows, language controls and footer remain readable, but the newly
combined LSL disclosure starts expanded before the primary recipe controls.
It occupies roughly 300–350px of the initial Review view. This V22–V25
follow-up was routed to S7/integration: keep recipe/final-save first, make LSL
secondary and collapsed by default, and preserve values plus relevant
enabled/error disclosure. It is not a request to remove LSL configuration.

The capture harness now handles P5 as a persistent Preview surface and scrolls
its actual settings pane or whole-pane fallback. Other owners still require
settled open accordions; the harness also records the active owner and served
DOM output. The initial Chrome run stopped at the obsolete P5 accordion
assumption and is superseded by the two complete directories above. The first
Edge image showed `ERR_CONNECTION_REFUSED`, not the app, and is excluded.
No Edge visual pass is claimed from it.

These default-state captures do not cover newly populated/invalid states,
expanded Advanced, dialogs, final P3, successor JSON or accepted-contribution
semantics. Earlier owner receipts retain their narrower source-specific value.
V28 remains open until the final combined functionality and rendered states
are verified; do not close all visual items from this interim inspection.

Later P7 follow-up: owner source `f283de0` includes the recipe-first/default-
collapsed LSL fix from `62248cb`, named-file handoff `a4bd8a1`, and the shared
confirmation shell. Root visually inspected
`D:/GitHub/affect-tracker-research-p7-evidence/named-save-native-regression/review.png`.
In this 1366×1000 actual-app cancelled-save state, recipe identity and the
readable cancellation notice precede the collapsed LSL disclosure. This
resolves the specific ordering/default-disclosure finding in the owner state.
The screenshot is not a full footer or narrow-layout receipt, and does not
prove the eventual master JSON or combined app. P7 reports 32 actual Chrome
regression assertions for this fixture; these are separate from root's visual
inspection. Retain V22–V25/V28 until final integrated coverage is collected.

Later P6 follow-up: both actual Chrome captures under
`D:/GitHub/.affect-preview-checks/p6-final-app-20260912/` were independently
inspected (`chrome-wide/xr-authoring.png`, `chrome-narrow/xr-authoring.png`).
Receipts name clean application `b54e403`; all 60 source hashes in each match
owner handoff `82c8f0f`, whose subsequent delta is documentation. The captures
show the oblique Authored screen, connected geometry, accepted profile and
collapsed Profile tools. Labels, measurements and separate legend remain
readable at 1440px/820px, with no new material visual regression. Narrow footer
is fully visible; the wide footer extends below the capture. The still-visible
Accept layout plus Confirm section duplication belongs to the already-assigned
integration prepare/accept composition; one final action must replace that
prerequisite sequence. Source receipts record 28 passing assertions each but
no PNG digest, so cryptographic image-file binding is unrecorded. These two
states do not close V19–V21/V28 or final master/target wiring.

P6 follow-up `3bedea1` resolves that owner-state action duplication. Root
inspected the actual 820px capture at
`D:/GitHub/.affect-preview-checks/p6-profile-tools-20260912/app-narrow/xr-authoring.png`:
Profile tools is collapsed and Confirm section is the sole main action; diagram,
measurements, status and footer remain readable. The optional action is now
Validate for download inside the disclosure. Its receipt names base `82c8f0f`
and a then-uncommitted diff; root matched all 60 recorded source hashes against
the final clean `3bedea1` with zero mismatches. It is a source-hash-verified owner
capture, not a capture made after that commit or final combined integration.
The owner reports 28 focused Node, 20 standalone visibility/keyboard Chrome,
28 actual-app Chrome checks and both builds. Combined footer preparation and
P7 acceptance/save semantics remain separately assigned; V28 stays open.

## Full combined default-state review at b9d520d — 2026-09-12

All **30 actual Chrome PNGs** in
`D:/GitHub/.affect-preview-checks/combined-b9d520d-chrome-20260912` were inspected
at 1280×900/800×700, including full scroll coverage of all seven registered
sections. The detached visual worktree was clean at
`b9d520d4c687419b03da343cf115e1a8834ab163`. Source remained stable; all 30 image
hashes and the harness hash match the receipt. No runtime errors, duplicate IDs
or horizontal pane overflow were recorded. Setup panes are 795px/472px.

- P1–P4: 12 images. One compact catalogue/identity home; readable empty
  questionnaire state; the new P3 prerequisite and retained footer; orderly P4
  fields, legend, missing-video issue and reachable footer. No new material
  visual regression in these default states.
- P5: 10 images. Full saved-controls scroll remains readable; the removed
  separate confirmation is replaced by the Section 7 final-capture explanation.
  No new material clipping, duplicate controls or compactness regression.
- P6: two disabled-state images. One enable choice and one footer confirmation;
  no new material visual regression. Enabled profile coverage remains in the
  separately recorded owner receipts.
- P7: six images. Recipe/explicit target precede collapsed LSL, language
  recovery/footer remain readable, and final Save is reachable at both widths.
  **New V23/V25 regression:** eight separately boxed/bulleted contribution
  warnings repeat acceptance/unsupported-format reasons per segment and expose
  the internal name P1. They dominate the initial Review view and extend through
  much of a second narrow page. S7 owns a compact grouped presentation preserving
  distinct reasons, diagnostic codes and focus destinations; integration owns
  collection. This is separate from the already-fixed LSL ordering issue.

These images use actual default data: they do not show populated questionnaire/
version editors, expanded tools/Advanced, valid accepted geometry, file-picker
states or a finished master recipe. Combined controller tests remain separate.
Integration found a legacy-load announcement dereferencing a receipt cleared by
live producers; `c32f806` fixes that reference using the validated local result.
Root compared the application diff: only that load announcement/comment changes,
with no markup/style/geometry delta. The images were still captured at `b9d520d`,
not `c32f806`. Integration's follow-up `3ac7c7f` adds an explicit edit revision
to protect pending file loads, including blank/incomplete drafts and edit-revert;
the owner reports 31 actual-controller checks and 646 Node checks passing.
It changes no markup/style. The Review presentation follow-up remains open;
keep V28 and canonical promotion open.

## Final bounded cleanup review at 7946bc6 — 2026-09-12

The detached visual worktree was clean at
`7946bc6b319ddf689bdaa81c07ec8aa6a4b3869d`, application `d6acfd1`, site tree
`e84b6c91fa59ae21748847fc1ea5883287011b62`. All **29 actual Chrome images** in
`D:/GitHub/.affect-preview-checks/combined-7946bc6-chrome-20260912` were visually
inspected: P1–P4 twelve, P5 ten, P6 two, P7 five. All seven sections and supplied
scroll pages are covered at 1280×900/800×700 (795px/472px Setup panes). Source
remained stable; all 29 PNG hashes and the harness hash match. Receipt reports
zero runtime errors, duplicate-ID rows or horizontal pane overflow.

No new material clipping, overlap or redundancy was found in these default
states. The P7 warning-list defect is resolved: four compact unboxed section rows
replace eight warning boxes, with full diagnostics behind one disclosure.
Recipe/target remain first; LSL is collapsed; the final Save footer is reachable
at both widths. Narrow Review now takes three captures instead of four.
P5 retains one persistent settings owner and no duplicate confirmation. P6's
disabled state retains one explicit choice and footer action.

Separate owner repair receipts under
`D:/GitHub/affect-tracker-research-p7-evidence/review-issues-896f677` and
`review-default-896f677` were also inspected (four compact/expanded plus five
default/full-scroll images). All nine PNG hashes, both harness bindings and
the issue fixture's 71 source hashes match clean handoff `86ce56b` / application
`896f677`. The narrow expanded capture exposes only the upper diagnostics before
scrolling; lower expanded-list coverage is not inferred from that image.

The exact combined source includes later load/edit/disposal guards and the
helper-only P5 task-yield correction. Integration separately reports 648 Node,
32 actual-controller, 124 issue/focus, 31 retained-control and six footer/glow
checks, both frontend builds and 204 affected P5 modal checks. These are distinct
from visual inspection and remain bound to their own receipts in the board.

This resolves the prior bounded default-state cleanup review. It does not close
V28's complete final-application scope or G09 in the new Planner goal: populated
tables, expanded/invalid states, accepted layout, comprehensive JSON and named
save/reopen remain separate work. The visible historical Start/participant area
belongs to the newly allocated companion-app separation; its removal must be
checked in the new candidate. No canonical promotion, Edge, installed/native,
physical input, execution/recording or final Planner–Runner correspondence claim.

## Edge capture lifecycle repair — 2026-09-12

The excluded Edge connection-refused attempt was a helper lifecycle failure.
A bounded local probe found the launcher exiting at 116ms while the headless
browser requested the still-open server at 819ms. Closing the server on launcher
exit made the later browser fail. Diagnosis and a temporary verified helper are
in `D:/GitHub/.affect-preview-checks/edge-launch-diagnostic-20260912/README.md`.

Root's `segment-visual-audit.mjs` now receives the actual page receipt by local
HTTP and waits for a complete fresh PNG independently of launcher stdout. It
retains source/settled-state assertions and image/harness hashes, and refuses a
nonempty output directory before starting capture or overwriting older evidence.

The final helper passes two actual XR captures each in Chrome and Edge at clean
`7946bc6` (1280×900/800×700), under
`D:/GitHub/.affect-preview-checks/capture-http-v2-chrome-7946bc6-20260912` and
`capture-http-v2-edge-7946bc6-20260912`. All four PNG/harness hashes match their
receipts; source is stable, with zero page errors/pane overflow. Chrome's final
images were inspected; both final Edge PNGs are byte-identical to the already
inspected preceding Edge images. Reusing the destination rejects before capture
and leaves the previous receipt bytes unchanged. An intermediate duplicate local
declaration caused a syntax failure before capture; it was corrected before
these final checks and is not counted as a passing run.

This restores a working Edge capture method and one-section evidence. It is not
an all-section Edge pass, complete Planner master workflow, installed/native or
physical qualification. Use the repaired helper for the later final candidate.

## Segment checklist

### P1 — Workspace and video library

- [ ] **V01** Finish the single import/catalogue home in P1 and remove the
  “Manage videos” detour after relocation. Keep choose-workspace and open-folder
  actions distinct, and preserve historical recipe loading until the P7 path
  replaces it. Coordinate the existing P3 importer handlers; do not duplicate them.
- [ ] **V02** Retain one short directory explanation and one live status/error
  region. Remove the repeated initial “Set a work directory to begin” sentence.
  Owner handoff `9d4b663` implements this visual change; integrated reinspection
  is pending.
- [ ] **V03** Verify empty, ready, populated-library and error states through
  actual application events. The initial P1 populated-text fixture directly
  edited DOM labels; it did not prove readiness transitions and left the root
  amber. Disabled Explorer buttons are expected on the browser surface, so do
  not enable them just for a screenshot. The revised fixture uses actual
  readiness events; combined reinspection remains pending.

The final owner handoff has nine app screenshots and a source/hash manifest in
`D:/GitHub/affect-tracker-research-workspace-library/artifacts/p1-workspace-visual`.
Narrow rows may stack to preserve readable labels and target sizes. Do not
compress them by making actions difficult to hit or removing path/error text.

### P2 — Questionnaires and languages

- [ ] **V04** Remove obsolete parallel questionnaire dialogs/import chains and
  styles while retaining the active sheet editor, full-definition import,
  canonical validation, language/family identity and scientific provenance.
  Owner cleanup `a7bda6a`, followed by import-adoption repair `ae47df6`, was
  collected into canonical `ba2110f`. Inspect that actual rendered result.
- [ ] **V05** Audit the active editor's empty, populated and invalid-cell states
  at desktop and narrow pane widths. Consolidate repeated import instructions,
  toolbars and status copy. Keep language labels and option-label/score
  distinctions explicit. P2's real bootstrap captures are ready at `714b22d`;
  their coverage and source limits are recorded below.

Full questionnaire definitions and table projections are different representations,
not interchangeable redundant exports. Validated wording, provenance and
independent validators must survive layout cleanup.

### P3 — Versions, named ISIs and event markers

- [ ] **V06** Keep one version table with one column per version and chronological
  video-ID/ISI-name rows. Place its ISI dictionary and relevant validation beside
  it. Remove inert pool/stimulus-dialog handlers and stale import entry points
  through the P3 owner; retain active library rendering until P1 relocation.
- [ ] **V07** Inspect a populated named-ISI table, an invalid reference and long
  IDs at desktop/narrow widths. Contain intentional table scrolling within the
  table, keep row/column error context visible, and retain text identities as
  well as video/ISI colors. Avoid repeated marker/JSON descriptions around the
  same table.
- [ ] **V08** Reinspect P3's final handoff after its accepted edge rules land.
  The S3 task reports the user's explicit approval of repeated videos/ISIs,
  leading/consecutive/final ISIs, exact order, unequal column lengths with
  trailing padding, interior-blank rejection, stable ISI names, duplicate
  durations, referenced-ISI deletion protection and invalidation after duration
  edits. S3 owns the exact Q02/Q14 catalogue update. Allocation policy remains
  a Runner concern under the newer user decision.

The old baseline's read-only external-protocol display is not the final table.
Do not mistake a screenshot of that display for coverage of named-ISI authoring.

### P4 — Screen and layout

Independent review inspected all four owner images at clean `3094bb8` and
matched all 13 source hashes and six artifact hashes in the owner's receipt:
`D:/GitHub/.affect-preview-checks/p4-screen-layout-20260911`.

- [ ] **V09** Pair width/height and centre X/Y in two-column groups. The current
  wide 3+1 arrangement separates related fields and leaves empty cells. Keep
  the narrow single-column fallback and explicit units.
- [ ] **V10** Put missing actual-video/envelope information next to the
  miniature. Keep one persistent draft notice and a concise current status;
  move conventions into a disclosure. Remove internal “Q08” and “producer
  interfaces” terms from researcher-facing copy.
- [ ] **V11** Identify the video and maximum-animation shapes in the diagram
  legend; preserve the dashed reference when boundaries coincide, including
  forced colors. Do not let the video outline obscure its reference.
- [ ] **V12** Capture the full real application at ordinary desktop height and
  narrow pane width, including bottom status/reset, physical mode, portrait
  video and invalid geometry. The initial 1800px images omit lower controls;
  the 360px image is a standalone fixture.
- [ ] **V13** Make the transition from legacy size/position to P4 geometry
  explicit. P4 reference-relative diameter/offset and the old P5 “Size (% of
  stage)” cannot appear to be two equivalent geometry authorities.

P4 remains a non-exportable draft until its conventions and real dependency
contracts are accepted. Compact warnings must still communicate that limit.

### P5 — Flubber, input and live preview

- [ ] **V14** Remove old Input, Visual and Advanced wrappers once all retained
  settings have their tested destination beside Preview or in Review. Ready
  consolidation handoff `87c3d6d` is awaiting integration at this record's
  baseline. Preserve the real input-test receipt separately from the simulator.
- [ ] **V15** Remove the redundant absolute “Selected feedback · design preview”
  caption, which overlaps the Flubber at enlarged text and constrained width.
  Consolidate repeated renderer/draft captions and map explanations. Keep one
  clear distinction between saved settings and preview-only behavior.
- [ ] **V16** Preserve useful controls space below the pinned preview. The
  inspected 320px capture leaves only 149px for a 1,339px settings document.
  Reduce repeated copy/nesting first, then use the existing whole-pane scroll
  fallback when meaningful settings space cannot fit. Preserve pinning where
  it remains usable, as the user requested.
- [ ] **V17** Flatten extra grid-dimension boxes and repeated labels; retain the
  semantic fieldset and clear square/custom dimensions. Keep task labels legible
  rather than shrinking them to make verbose instructions fit.
- [ ] **V18** Reinspect actual Controls, Appearance, expanded Advanced, the
  color dialog and long custom anchor labels at desktop and 320px preview
  widths. P5's own later render found binding/reset and color-row collisions
  despite zero pane overflow; its separate polish pass owns those fixes.

Colors, explicit Recolor, halo and confirmation breathing are user-requested
features. They are not candidates for deletion merely because a generic style
guide discourages ornamental UI. The overlay-caption defect concerns text
placement, not the Flubber outline or halo.

### P6 — Optional XR layout

- [ ] **V19** Mount a distinct optional XR segment and remove dependence on the
  deleted Visual wrapper. Align P7 routing and contribution guards atomically.
- [ ] **V20** Inspect actual bootstrapped disabled, populated and error states
  at desktop/narrow width. Keep enablement, essential distance/size/angle inputs
  and the spatial preview together; disclose advanced conventions rather than
  repeating implementation prose around the diagram.
- [ ] **V21** Verify that inspection-camera rotation remains visually distinct
  from authored geometry, and pending envelope/fit limitations stay next to the
  preview. No screenshot can claim headset tracking, runtime or APK qualification.

P6's later user answer accepts head-forward setup without eye tracking,
world-fixed placement during the attempt, stopping on tracking loss and
recentering only between attempts. Preserve this decision; do not re-ask it
or restore an earlier pending warning. Final owner app captures were inspected;
combined verification remains pending.

### P7 — Review and recipe export

- [ ] **V22** Present one actionable recipe/export path, with retained sampling,
  output and LSL settings in their agreed home. Keep save/acceptance failures
  and stale revisions explicit. Collect P1 identity and P7 legacy destinations
  before deleting old Experiment.
- [ ] **V23** Compact the preflight presentation without merging distinct
  checks. The baseline repeats the same missing `experiment.json` explanation
  across three rows, and every row has its own border and “Blocking” label.
  Group repeated prerequisites and use a compact status list/table while
  preserving each issue and focus destination.
- [ ] **V24** Reduce default disclosure height for detailed provenance and
  legacy Runner preparation when no package exists. The default baseline is
  2,352px tall at desktop and 2,894px at 800×700. Hashes, participant selection,
  transient details and language recovery are retained capabilities, not safe
  deletions. Preserve all Start gates and visible actionable errors.
- [ ] **V25** Replace implementation prose such as “fail-closed” and
  “package-owned tree” with concise researcher-facing actions. Inspect the
  final integrated Review through its confirmation footer, plus valid, stale,
  cancelled-save and failed-save states. P7's feature handoff and independent
  visual pass remain distinct receipts.

### Shared navigation and final integration

- [ ] **V26** Reflow section titles/summaries according to the actual Setup
  pane width. At 432px inside a wide viewport, same-row summaries squeeze the
  title. Reuse the existing two-row pattern through a pane container query;
  do not hide labels or shrink typography to solve it.
- [ ] **V27** Remove the old fixed “Eight decisions” slogan. Keep the dynamic
  progress count and shorten repeated footer instructions while preserving
  reviewed/dirty/ready distinctions, descriptions, focus and confirmation motion.
- [ ] **V28** Audit the combined clean commit, not only independent branches:
  expected registry, unique retained fields, valid labels/ARIA references,
  navigation/error focus, P4/P6 mounts, saved values and invalidation behavior.
  Capture all final registered sections at both viewports and inspect their
  full content, including newly consolidated Preview settings.

## Completion rules

The later confirmation requirement is recorded in catalogue decision 11:
sequential contribution acceptance, with final Live Preview capture and named
JSON save in P7. The existing review-only buttons do not satisfy it. A new
backend acceptance/save pass is separate from the UI cleanup and has now been
explicitly resumed by the researcher. Continue both within their assigned
ownership, keeping acceptance and persisted state distinct.

Subsequent owner handoffs, still requiring combined verification:

- P1 `9d4b663`: narrowed row stacking to 479px, actual workspace-ready/error
  event projections, nine captures at 1440/720/exact432px and hash manifest.
  Separate D01 `3df60fa` relocates actual import/drop/rescan/catalogue controls
  into Workspace and removes the detour. Root captured and inspected all three
  pages at 1280×900/800×700 using the reusable harness; source stable, no runtime
  or overflow errors. Receipt: `D:/GitHub/.affect-preview-checks/p1-relocation-root-3df60fa`.
  Compose both handoffs; neither alone contains both changes.
- P2 `9ff3d5f`: empty-coverage duplication removed, table moved approximately
  282px earlier, invalid cell and error visible together. Independent review
  matched all 36 source hashes in the final receipt. Coverage-only handoff
  `714b22d` adds six settled actual-app captures of expanded settings,
  Save/Preview/footer and the German accordion at 1600px and 1000px. The app
  source remains `9ff3d5f`; the receipt's capture-helper changes are committed
  in `714b22d`. Accepted evidence directory:
  `D:/GitHub/.affect-checks/s2-visual-details-settled-20260911`.
  Independent review inspected all six images and matched all 37 source-file
  hashes against the clean handoff. German labels, expanded settings, wrapped
  actions, Save/Preview and Confirm have no material visual defect in these
  states. The receipt records image paths, not PNG digests; it is not a
  cryptographic image-file binding.
  Initial timing/scroll diagnostic captures are superseded, not acceptance
  evidence. Combined source verification remains open.
- P4 `466412a`: root inspected the revised desktop top, narrow fields/footer
  and invalid state. Paired fields, adjacent missing-input notice, full legend,
  shorter draft copy and visible error border address V09–V12 locally.
- P3 `ae5cecd`, merged with its documentation base at `bc8921d`, removes the
  inert pool/stimulus-dialog/native opener chains and implements the named-ISI
  table. Final follow-up `4a2389c` resolves the two visual findings: root inspected
  a real invalid-reference confirmation with visible Event 1/Variant 6 error
  and focused, horizontally revealed cell at 800px, plus the populated table's
  distinct sample colors. Identity-derived hue/tone no longer depends on other
  catalogue entries; an 80-video stability regression is reported. Text remains
  authoritative for perceptually similar large-library colors. The immutable
  receipt names clean `4a2389c` and hashes served source; its directory is
  `src-tauri/target/segment3-verification/4a2389c1a175-1789141158726` in the P3
  worktree. Older unbound and injected-status captures are superseded. Combined
  integration remains pending; a `dataset.state` check alone would not suffice.
- P5 source `8d3d256`, documentation handoff `597a612`: independent final
  reinspection resolves both remaining material issues. Map-to-dialog is the
  sole visible anchor editor, and the settings-space threshold is 18rem with
  whole-pane fallback. Final Controls, Advanced, error and color dialog are
  readable at desktop/320px. All 24 HTML/PNG receipt pairs match their hashes
  and source tree. Final evidence: the owner's `single-flow-states` directory;
  older `polish-states` captures are superseded. No new material issue found
  in that scoped recheck. Legacy package size/position labels distinguish
  their existing contract from P4's draft geometry. Combined integration is
  still required.
- P6 `5d60ef6`: owner reports Profile tools disclosure, external readable
  diagram legend and stabilized eight actual app captures. Earlier 760/420px
  blank captures were rejected; newer settled-pane captures supersede them.
  Root inspected the final desktop/narrow scene and narrow error screenshots:
  legend and readouts are readable, profile tools are disclosed and the footer
  is visible. Evidence: `D:/GitHub/.affect-preview-checks/p6-boot-handoff-20260911`.
  Documentation checkpoint `e43f018` records two producer interop fixtures
  re-passing against P5's final clean `597a612`, with the same producer source
  hash. Automatic live binding and combined master export remain open.
- P7 `6bac40f` includes `06d14fe` compactness and the lower-row follow-up. Root
  inspected empty/populated/error Review, then final lower, expanded details
  and legacy narrow captures. The language status/help now spans the available
  width with its button below; the footer and retained details remain readable.
  The final receipt records reduced motion, zero document scroll and 27 actual
  bootstrap checks. No remaining material P7 visual defect was established in
  these states. New sequential acceptance/name-save semantics and combined
  source verification remain distinct pending work.
- Integration candidate `c7ba103` removes old Experiment/Input/Visual/Advanced
  with retained destinations; canonical was still `ba2110f` when reported.
  Do not present the isolated candidate as the current installed application.

**Earlier integration pause, superseded on 2026-09-12:** the integration owner
had awaited the researcher's answer to its confirmation-semantics pass check.
The researcher has now directly instructed the paused tasks to continue. Root
relayed that instruction and resumed the monitor's active assignments; it is
not an invented answer to other product decisions. Integration remains the
sole merger. V28/final combined acceptance remain open until the exact combined
source is rendered and inspected after collection and implementation.

For each item, replace pending text with its exact integrated source commit,
the inspected screenshot paths/state/viewport, and relevant focused regression
receipt. Check the box only after the scoped change is integrated and verified.
An owner-only screenshot can justify a fix or review handoff, but does not
close the combined-app item. Record exceptions explicitly instead of silently
dropping unresolved work.

Keep scientific and recovery evidence, frozen schema readers, browser/Rust
independent validation, platform authority and physical-input gates. They are
intentional boundaries in D04 and D13–D18, not UI redundancy. This audit does
not approve new product contracts or qualify experiment execution.

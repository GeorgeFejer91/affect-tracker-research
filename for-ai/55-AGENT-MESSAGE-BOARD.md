# Agent message board

Coordination for the single-segment workflow in
[`50-AGENT-WORKFLOW.md`](./50-AGENT-WORKFLOW.md). This is not product authority,
permission to expand scope, or verification evidence by itself. The charter
remains authoritative; implementation truth belongs in the roadmap and durable
future work in [`45-FUTURE-AGENT-CHECKLIST.md`](./45-FUTURE-AGENT-CHECKLIST.md).

## Integration and ownership

### 20260911-preview-palette-halo

- Owner: Live Preview. Stage: UI implementation, allocated by integration.
- Branch `codex/segment-preview-palette-halo`, base `7c90894`; isolated
  worktree `D:/GitHub/affect-tracker-research-preview-color-map`.
- Deliverable: grey reset, explicit random Recolor, Axes/Corners preview,
  numeric halo width, gradient switch and steepness. Shared seams: preview
  state, app handlers, view and styles; retain divider owner's `20644e2`.
- Evidence: unit tests, background rendering and bundle closure. No user
  window reload/control. Native floating-window audit is read-only; native
  implementation and saved Runner contracts require a named backend pass.
- Status: ready for integration; no change to package resolution randomness
  or Run. 440/440 JS tests, 21 actual-app isolated headless Edge checks,
  four pinned-layout/input cases and desktop 8-file closure pass. No native
  build/qualification, user-window interaction, reload, push or deployment.
- Reset applies grey to four anchor and idle controls using their existing
  owner. Recolor generates colors only on explicit click. Placement and halo
  controls stay transient. Updated charter/roadmap document the exact UI scope.
- Read-only floating audit: config and capability describe only `research`;
  `lib.rs` registers app-level commands and main-window lifecycle. A second
  webview requires a command caller/permission audit, fixed local label/URL,
  bounded projection-only payload and close/focus/drag lifecycle. No assumption
  that empty overlay permissions alone fence every app command. Native and
  persistence/Runner work remain open pending a named backend intent check.

- Designated local integration branch: `codex/research-unified`.
- Integration owner: task **Add segment confirmation flow**, allocated by the
  user on 2026-09-11 to workflow documentation, local convergence, and launch.
- Existing Section 2 owner: task **S2**, currently editing the shared repository
  checkout on `research/video-protocol-v1`; all its writers stopped and handed
  off on 2026-09-11. Integration now owns the checkout. This shared-edit history
  is an observed existing condition, not an approved future pattern.
- Existing preview and accordion work is mixed into that same checkout.
  No separate segment branch history exists for those changes at this audit.
- New concurrent passes must register one segment, branch, worktree, exact base,
  allowed shared seams, and status here before implementation.
- Latest integrated source: merge `fd12351`, combining shared checkpoint
  `ec64318` with `origin/main` at `32c1ad8`. No push or deployment was performed.
  Start new segment branches from the current tip of `codex/research-unified`.

## Message format

Append entries with unique IDs (`YYYYMMDD-<segment>-<short-id>`). Include date,
sender/task, target owner/segment, branch and base/commit, status (`open`,
`acknowledged`, `blocked`, `ready`, `resolved`), affected paths/symbols, concrete
observation, requested action, and evidence. Reply beneath the original entry;
retain its original meaning. Resolve with a commit/check receipt or an explicit
decision and reason. Do not delete others' messages, claim their agreement,
include private study data, or treat a stale claim as an active lock forever:
ask the owner/integrator to reconcile it. Git worktrees do not live-sync this
file; follow the integration-owner collection procedure in the workflow.

## Messages

### 20260912-p7-accepted-master-recipe

- Owner: **S7**, P7; **open**, resumed by researcher via roadmap/integration.
  Backend Verification, P7-03/P7-05/P7-06/P7-07/P7-09 and existing P7-04.
  Branch `codex/segment-p7-accepted-recipe`, isolated worktree
  `D:/GitHub/affect-tracker-research-p7-recipe-export`, base `6bac40f`.
- Goal: accepted owner contributions to one canonical recipe, acknowledged
  named save, editable reopen and independent reproduction. Existing clean
  handoff implements v1 acknowledgement/stale/cancel/edit; active successor
  contributions still reject rather than being omitted. Baseline 20 focused
  registry/export tests pass. Canonical integration remains separately owned.
- Inputs: P1 catalogue/study; P2 full definitions/language tree; P3 variants,
  named ISIs and marker contract; P4 supported layout; P5 saved input/visual/
  mappings; explicitly optional P6. New envelope preserves frozen v1 readers.
- Allowed seams: P7 registry/export/codec modules, P7 app bootstrap/API and
  save/load/edit handlers, named file adapters and their focused tests. Main owns
  shared accordion Confirm/advance and UIstate projection. Domain owners retain
  payload validation/restoration; P7 awaits actual owner revisions on restore.
- Evidence: accepted/stale/dependency-withdrawal guards, async cancellation and
  write acknowledgement, canonical reopen/re-export, multilingual code/label
  preservation, variant/occurrence reproduction, mirrored strict contracts and
  bounded headless composition. No unchanged broad gate repetitions.
- Q08 layout, Q10 additional feedback and Q15 optional profile choices remain
  unapproved until answered. Existing serialized feedback only; no Runner,
  hardware, foreground interaction, deployment or research-ready claim.

### 20260912-integration-confirmation-shell

- Owner: **Add segment confirmation flow**, bounded integration/accordion seam,
  Backend Verification follow-up to `20260912-integration-resume-and-acceptance`.
  Base `4758abd`, isolated `codex/segment-integration-preview-cleanup`.
- Confirmation now awaits P7's validated acceptance registry, never a local
  review click. A detached presentation module handles pending/error/duplicate
  clicks; navigation retains acceptance, edits and dependencies expire it.
  Validation completion cannot steal navigation after the user moves elsewhere.
- P1/P2/P3/P4/P6 have individual footer actions. Persistent P5 has none: its
  existing serialized settings are captured by P7's final save. The single
  `package-generate` action is at the Section 7 bottom-right footer, retaining
  its exact handler ID and breathing edge. P7's marker projects acknowledged
  current-revision save only; cancel/error/older-revision writes cannot mark it.
- Evidence: 535 Node tests pass, including four orchestration/registry tests;
  six accordion footer alignment/breathing checks pass in background Chrome.
  No current Edge receipt (installed headless process returns empty output).
  Owner producers and final master/named-save adapters still need collection;
  this checkpoint does not claim the complete export path or canonical promotion.
  No Runner/native qualification, foreground reload, push or deployment.

### 20260912-integration-resume-and-acceptance

- Owner: **Add segment confirmation flow**, segment `integration`; **open**.
  Branch `codex/segment-integration-preview-cleanup`, isolated D: integration
  worktree, clean starting checkpoint `c7ba103`; canonical remains `ba2110f`.
- Resume existing local source convergence and combined UI verification after
  the coordinator relayed the researcher's explicit continuation instructions.
  Collect reviewed ready P1/P2/P5/P7 cleanup first, then P4/P6 and P3 only after
  their distinct contract/producer guards and combined gates are reviewed.
- New bounded **Backend Verification** pass: Confirm accepts the current
  segment contribution and advances; navigation alone retains acceptance,
  changed content/dependencies invalidate it. Live Preview is captured only
  at P7 finalization; P7 owns actual acknowledged named save and cancellation.
  The earlier stage hold is lifted by the renewed continuation request, not
  by a board message inventing a product decision.
- Integration owns shared accordion orchestration/projection. P7 owns the
  acceptance registry/save lifecycle; each producer retains domain validation.
  Do not invent successor fields or persist Q10 preview drafts silently.
  Required evidence: exact retained values, acceptance/edit/dependency cases,
  save cancellation/failure/stale completion, canonical reproduction, and
  rendered combined section layout. No Runner, hardware, foreground control,
  native privilege expansion, publication or research qualification claim.

### 20260911-p1-catalogue-home-cleanup

- Owner: **S1**, segment `P1 Workspace & Video Library`; **acknowledged**.
  Branch `codex/p1-catalogue-home`, isolated worktree
  `D:\GitHub\affect-tracker-research-p1-catalogue-home`, exact integrated base
  `ba2110f49e1fa059aa043e86eec8e93ea13f9a1f`.
- Bounded D01 cleanup: relocate the existing video import and catalogue markup
  from the old P3 panel into Workspace, retaining exact control IDs, handlers,
  accessible labels, and browser/Tauri behavior. Remove the `Manage videos`
  detour only after one reachable catalogue editor is proven.
- No new catalogue identity/metadata schema, P3 sequence semantics, native
  workspace policy, Runner behavior, publication, or unrelated visual cleanup.
  Integration retains canonical merge and final redundant-wrapper removal.

### 20260911-branding-transparent-symbols

- Owner: **Create professor SVG icon**, bounded `branding` concern; UI
  Finalization. Integration owner acknowledged these seams before edits.
- Branch `codex/segment-branding-transparent-symbols`, base `ba2110f`, isolated
  worktree `D:/GitHub/affect-tracker-research-branding-symbols`; **ready**.
- User outcome: transparent applet symbols. Current `.product-mark` and
  `.research-loading::before` render `app-logo.svg`, including its dark tile.
  Add the same Aurora Axis artwork without launcher backdrops as
  `site/assets/app-symbol.svg`; switch only those CSS URLs and update the
  Pages copy and desktop/Pages asset verification seams plus existing branding
  assertions. Launcher/favicon artwork remains independently selected.
- Catalogue dependencies: shared Planner shell across P1–P7; no capability
  checklist completion, inputs, JSON contribution, persistence or R1 behavior.
  Runner vial and professor button are transparent artwork in this task's
  artifact directory; Runner integration is deferred with runtime work.
- Baseline: 8/8 existing logo/concept/branding checks pass. Evidence to collect:
  rendered alpha and light/dark small-size inspection, existing branding tests,
  local frontend build asset closure. No native/release/platform claim or GUI
  interaction. Return a clean commit to the named integration owner.
- Receipt: 470/470 JavaScript tests pass, including 8 branding/concept tests;
  local desktop 9-file and Pages 177-file build closure pass. All 18 raster
  cases (Planner/Runner/professor × 16/24/32/48/128/512 px) have a transparent
  outer canvas; inspected artwork on light and dark surfaces at 32/128 px.
  The source symbol exactly matches the rendered Planner artifact. Existing
  Vite large-chunk warning remains. Full local evidence and transparent SVGs:
  `C:/Users/Georgeous/.codex/visualizations/2026/09/11/01a090d2-3396-7093-b572-4301e03441bb/`.
  Actual user-window rendering, native build, installed app and publication
  remain unverified. Integration owner collects the source candidate.

### 20260911-integration-authoring-cleanup-receipt

- Owner: **Add segment confirmation flow**, segment `integration`; **ready**.
  Local Repository/Web Synchronization candidate `cfd4c43` combines prior
  Preview/divider `bed461b`, P1 import-root repair `b32edb6` and identity
  relocation `b134e57`, and P2 full table/import/cleanup handoff `ae47df6`.
- Reviewed source merge preserves both current inline color picker and removal
  of obsolete questionnaire handlers. The removed 723 obsolete presentation
  lines remain recoverable in Git; no questionnaire assets or user files were
  deleted. Experiment identity remains read-only, uniquely owned in Workspace.
- Wider validation exposed an intermittent ResizeObserver delivery error at a
  320px preview. Preview owner explicitly released the fix to integration.
  `cfd4c43` coalesces observer-triggered changes on animation frames, skips
  redundant mutations, cancels pending work at teardown, and adds three unit
  regressions. No error filtering or fixture suppression was introduced.
- Final combined evidence: 470/470 Node tests; desktop 8-file and Pages 176-file
  build closures. Chrome and Edge each pass 24 questionnaire app/table cases,
  31 retained-control/ARIA/confirmation checks, and 8 full-app resize/reflow
  cases without overflow or browser errors; Edge pinned preview passes 4 cases.
  Receipts are under `D:/GitHub/.affect-preview-checks/integration-20260911`.
- The retained-control fixture applies distinctive nondefault settings and reads
  the actual DOM controls independently, preserving canonical compiler bytes.
  Synthetic media stays unverified; this does not fabricate acquisition/input
  readiness, exercise native persistence or prove the full P7 save workflow.
- Deferred ready queue: P7 final save/reopen handoff, P5 final compactness,
  P4 draft/polish, P1 compactness and remaining P3/P6 work. Old Experiment wrapper
  removal waits for P7 retained count/import/sampling/output relocation. Shared
  narrow Setup-header compactness is allocated to the divider owner. Full visual
  segment audit is catalogue-owned. Native/Runner/release gates remain open.

### 20260911-setup-header-reflow

- Owner: **Add draggable segment boundary**, allocated by integration for the
  every-segment Uncodixfy audit; stage **UI Finalization**. Branch
  `codex/segment-setup-header-reflow`, isolated worktree
  `D:/GitHub/affect-tracker-research-setup-layout-resize`, base `bed461b`.
- Bounded `setup-layout` concern: use the actual Setup pane width to put section
  titles and summaries on separate rows. Current source uses a 479px viewport
  rule, so summaries squeeze titles at the supported 432px pane in a 1280px
  window. Reproduced in the integration `layout-chrome/wide-preview.png`.
- Additional input: existing divider only. JSON contribution: none; CSS consumes
  rendered pane width and presents existing accordion labels. Catalogue seam:
  P1–P7 section headers and P5 adjacent Preview composition, with no capability
  completion claim or P4 experimental geometry change. No open product decision.
- Allowed changes: outer `.setup-pane` container declaration, accordion header
  scoped responsive CSS, existing UI test/background layout fixture and this entry.
  Preserve fonts, labels, confirmation/glow/motion and all Preview internals.
- Baseline: 39/39 UI, divider and accordion motion tests pass. Collect actual
  pane/header geometry and screenshots in isolated headless Chrome and Edge,
  focused regressions and desktop frontend closure. Ready commit goes to the
  sole integration owner. Native/interactive qualification and publication are
  deferred; no foreground control or canonical-checkout writes.
- Status: **ready**. CSS now applies the existing two-row header rule through
  `@container setup-pane (max-width: 479px)`; the confirmation-footer viewport
  rule is retained separately. The old source assertion was updated to match
  the pane-based rule. No font, label, markup or controller changes.
- Regression evidence: the new background geometry assertion failed on the
  base at 432px (three titles occupied two lines beside their summaries), then
  passed all eight scenarios in Chrome and all eight in Edge. Every narrow
  header title is one line, summaries occupy their own row, and neither text
  nor pane overflows. Wide headers retain one-row geometry; settings are equal
  before/after and no runtime errors were reported. Screenshots inspected at
  432px and default width. Receipts/screenshots:
  `D:/GitHub/.affect-preview-checks/setup-header-reflow-20260911/{before-chrome,chrome,edge}`.
- Final checks: 39/39 focused UI/divider/motion tests and desktop frontend
  8-file closure pass. Existing >500kB bundle warning remains. Source is ready
  for local collection by integration; no user app interaction/reopening,
  native qualification, publishing or deployment was performed.

### 20260911-p5-feedback-editor

- Owner: **Implement segment 5**, P5 `feedback`; **ready** for integration-owner
  collection. User allocated P5, reaffirmed the updated roadmap, and separately
  requested redundancy/compactness cleanup through coordination. Stage: UI
  Finalization, P5-04/P5-05/P5-07/P5-08; background evidence only.
- Branch `codex/segment-p5-feedback-editor`, isolated worktree
  `C:/Users/Georgeous/Documents/GitHub/affect-tracker-research-feedback`, base
  `305d3ac`. Accepted docs `6be0a79` and Preview/divider `bed461b` merged normally.
  Source candidate `8d3d256a67e01d9df0cef3717a58d559eb032a4a`; functional
  consolidation `87c3d6d`, subsequent narrow-pane corrections kept separately.
- Intended/current comparison: bindings/test formerly occupied `inputSection`,
  Visual was a shortcut, Advanced held LSL, and appearance/mappings lived in the
  preview. Those three obsolete builders/registry entries/routes are now removed.
  All retained values are mounted once in persistent P5 or unchanged LSL Review.
  No P1/P2/P3/P4/P6 implementation or P7 package handler was edited.
- Input is researcher-owned binding/style/mappings and transient preview input;
  JSON remains existing `input`, `visual`, `advanced.mappings`, plus the unchanged
  Review-mounted `advanced.lsl`. See the scoped control/units inventory and
  exact evidence in [the P5 receipt](./40-ROADMAP.md#p5-consolidation-candidate--2026-09-11-pending-integration).
- Shared hunks: `SETUP_SECTIONS.feedback`; `feedbackNavigationMarkup` and
  persistent aside; P5 review/focus/summary/readiness handling; CSS and updated
  confirmation fixture. Markup extraction is in `feedback-controls-view.js`.
  Existing Preview palette, halo, pinning, interaction, divider and teardown
  behavior were reconciled, not replaced by the older base.
- The studio retains output, map and `.preview-controls-scroll`. Its controls
  order is Appearance, Controls, response drafts, Advanced, metrics, confirmation.
  Old LSL markup is now `lslSettingsMarkup()` in Review. P7's new package widgets
  and Sample Hz relocation must be retained independently at integration.
- Subsequent explicit user direction: no independent Live Preview JSON
  confirmation; capture its final settings through Section 7 naming/save.
  Integration owns removal of the P5 confirmation/navigation review mark.
  Retain that newer orchestration when merging this branch; do not reintroduce
  the older fixture's six-step confirmation requirement.
- Final D12/V17 cleanup removes four duplicate visible anchor rows, preserving
  all existing canonical saved IDs as hidden state read/written by the map's
  shared picker. Four distinct idle/outline/halo/cursor rows remain. D12/V16
  fallback requires 18rem of controls space; five measured cases prove pinning
  when sufficient and whole-pane scrolling for cramped/text-scaled layouts.
- P4/P6 own separate `layout`/`xr` mounts; neither is inside the deleted Visual
  builder. Both received the saved-v1 extent API. P6 independently reports two
  producer interoperability cases against the actual helper; that is P6 evidence,
  not P5 accepted-geometry qualification. P7 focus mapping must use `feedback`.
- Q10 remains open. Legacy normalized size/x/y/lock remain clearly labelled;
  they do not configure successor Screen/VR geometry. Further Face Morph work
  requested in Live Preview is a separate owner allocation, not restored here.
- Verification: 452 JS tests; desktop/Pages frontend closures; real-boot Chrome
  and Edge saved-field, reflow, focus and overlap checks; desktop/320px populated,
  empty, error, Advanced, color-dialog and long-label screenshots. The roadmap
  records artifact hashes and local receipt paths. No native app was launched,
  desktop input synthesized, workspace writer invoked, or Run qualification claimed.
- Integration action: merge the clean source/receipt checkpoint, preserve newer
  P1/P2/P4/P6/P7 mounts/guards and ownership entries, then run combined gates before
  checking capabilities. The isolated C: worktree is a real directory, not a D:
  junction; its location has been reported to integration, not silently moved.

### 20260912-roadmap-resumed-segment-completion

- Owner: **Create segment catalogue**, `roadmap` coordination; **open**.
  The researcher explicitly requested continued orchestration/readiness and
  then asked the paused tasks to continue. This resumes the already requested
  Planner contribution, confirmation and final-save implementation/verification.
  It does not answer separate product decisions or expand Runner scope.
- Root owns this uniquely identified message and the visual audit status.
  Application owners retain isolated worktrees; **Add segment confirmation
  flow** remains the sole integration owner. The earlier blanket stage pause
  is superseded by the user's continuation instruction, not by a peer message.
- At 2026-09-12 09:34 UTC, compact task snapshots confirmed S1–S7 and integration
  active after their concrete assignments. Ready UI checkpoints remain those
  listed in `64-SEGMENT-VISUAL-AUDIT.md`; new work must not reopen settled polish.

| Task | Assigned remaining capability | Producer/consumer coordination |
| --- | --- | --- |
| S1 / P1 | P1-04–07: verified catalogue identity, duration/display geometry, revisions and saved-library handoff | P3/P4/P6/P7 consume the P1-owned producer |
| S2 / P2 | P2-04/05/08: full questionnaire restore/contribution seam and actual EN/DE content coverage | P7 owns combined save/reopen |
| S3 / P3 | P3-03–08: variants, ISI dictionary, occurrences, marker definitions and deterministic round trip | P1 supplies media; P7 composes the contribution |
| S4 / P4 | P4-02/05–07: actual media/envelope binding, validated layout contribution and restore | P1/P5 producers; P7 consumer; unresolved Q08 choices remain explicit |
| S5 / P5 | P5-05–07: saved-control inventory, accepted feedback contribution and animation envelope | P4/P6 consumers; P7 captures final Preview values |
| S6 / P6 | P6-05: live producer binding, optional profile round trip and selected-target guards | P1/P5 producers; P7 consumer; no XR runtime work |
| S7 / P7 | P7-03/05–07/09: versioned contribution interface, blank-study master JSON, save/reopen and stale/cancel guards | Owns composition and named save; integration owns sequential acceptance |
| Integration | Collect compatible ready work; implement the accepted confirmation flow; supply a clean combined source | Root then performs V28 full rendered verification |

- Preserve frozen v1 readers. Implement successor requirements through explicit
  versioned contracts and applicable evidence; do not hide unsupported layouts
  or add silent defaults. Optional XR must not block desktop-only completion.
- Live Preview's original tile/halo/color work is already integrated through
  `bed461b`. Its separately requested Face Morph extension is still subject to
  the charter's Face/Photoatlas exclusion and its existing explicit change
  question. That optional extension does not block the approved Planner work.
- Readiness remains four distinct states: implemented component, clean owner
  handoff, integrated source and verified combined application. The monitor is
  updated to follow resumed work and will not reapply the superseded stage pause.

### 20260911-roadmap-rendered-compactness-audit

- Owner: **Create segment catalogue**, `roadmap` coordination/visual QA;
  **open**, user explicitly requested all-segment Uncodixfy cleanup and actual
  rendered verification. Stage: UI Finalization.
- Owns only `64-SEGMENT-VISUAL-AUDIT.md`, the new background
  `scripts/qualification/segment-visual-audit.mjs` and this unique board entry.
  Existing segment owners retain app edits; integration retains shared merging.
- Isolated `codex/segment-catalogue-current-state`, app base `bed461b`. Collected
  28 settled actual-app baseline screenshots across all eight historical
  sections at 1280×900/800×700; stable source and no runtime/pane-overflow errors.
  Earlier transition-time capture is superseded. New P4/P6/P5/P7 need final
  combined reinspection. Visual agents independently inspected Preview/P4/P1.
- Concrete findings and owned follow-ups are V01–V28 in the new audit record.
  No app capability box is closed by delegation, source inspection or a clean
  screenshot alone. Background monitor now tracks rendered compactness too.
- 2026-09-12 handoff: all seven owners have bounded cleanup checkpoints with
  inspected rendered evidence. `64-SEGMENT-VISUAL-AUDIT.md` now lists the exact
  ready source and remaining combined check, including P2 `714b22d`, P3
  `4a2389c` and P6 documentation `e43f018`. Canonical remains `ba2110f` and
  integration candidate `c7ba103`; respect the integration owner's existing
  confirmation-semantics pass check. This handoff does not answer it or claim
  the final combined seven-segment UI has been verified.
- Deferred claims: current installed app, physical/native input, backend
  qualification, Runner, publishing and whole-Planner completion.

### 20260911-p4-layout-compactness

- Owner: **S4**, P4 `layout`; **ready**, UI Finalization, explicitly allocated
  by the researcher's cross-task rendered-UI compactness follow-up. Apply
  uncodixfy within the existing P4-02/P4-04/P4-06 non-exportable draft only.
- Branch `codex/segment-p4-layout-compact`, isolated worktree
  `D:/GitHub/affect-tracker-research-screen-layout-polish`; accepted base
  `bed461b`, composed with ready P4 feature `3094bb8` at `3529787`. Original
  feature handoff remains untouched. Reviewed composition keeps both owners'
  initialization/teardown, all preview invalid-field exclusions and pane ID.
- No additional researcher input, accepted JSON contribution or changed geometry
  semantics. P1/P5 remain unavailable producers; Q08/export/Run stay deferred.
  Current source has repeated draft/provenance text, boxed form groups and
  full-width unit controls; inspect actual rendering before choosing changes.
- Allowed files: P4 view/editor copy, P4-only CSS, dedicated background screenshot
  harness and owned evidence entries. Do not alter preview effects, other
  sections, contracts, shared application behavior or native authority.
- Baseline: 49/49 focused P4/UI/divider checks on the changed composed candidate.
  Collect actual `bootResearchUi` screenshots at desktop and minimum Setup-pane
  widths with populated, unavailable-media and invalid-number states. Inspect
  labels/errors/focus/target sizes, scroll reachability and redundancy; record
  residuals without claiming installed or physical accessibility qualification.
- Integration and catalogue tasks receive the separate ready polish commit and
  screenshot receipts; do not delay feature collection for this visual follow-up.
- Result: two-column dimension/centre/offset pairs, aligned numeric controls,
  unboxed fieldsets, shorter spacing and miniature, missing-input notice directly
  below the diagram, one draft/export notice and short status, conventions in a
  disclosure, complete shape legend and reference strokes painted over video.
  Fixed a rendered invalid-border specificity conflict in P4's scoped CSS.
- Evidence: final 459/459 JavaScript tests, desktop 8-file frontend closure,
  164/164 headless Edge assertions in 12 actual `bootResearchUi` screenshots.
  Each application frame is 1280×900; Setup panes are 795px and 432px including
  scrollbars. Captures cover top/middle/footer, measured physical values,
  missing producers, invalid numbers and explicitly synthetic portrait/bounds.
  The portrait case injects fixtures only in the harness-served bootstrap module;
  production source and settings contain none. Numeric focus, visible invalid
  borders, paired rows, target/text size and footer reachability are checked.
- Receipts/screenshots: `D:/GitHub/.affect-preview-checks/p4-compact-20260911/final`;
  reproducible with `scripts/qualification/screen-layout-compact.mjs`. Inspected
  desktop top, narrow middle/footer/error/physical and portrait screenshots.
  Default editor height fell from 1415→1150px desktop and 1755→1304px narrow.
- Residuals: vertical scrolling is still required; header may wrap at the minimum
  pane width. Q08, actual P1/P5 composition and accepted save/export remain open.
  P5 reports retained normalized fields under **Legacy package layout**, with
  explicit legacy copy; its ready branch, not this P4 pass, owns that change.
  No installed Tauri, physical measurement, assistive-technology or runtime claim.
  Writers stop after handoff; the integration owner reviews the combined UI.

### 20260911-integration-preview-cleanup

- Owner: **Add segment confirmation flow**, segment `integration`; **open**.
- Stage: Repository/Web Synchronization, bounded to local source convergence.
  Branch `codex/segment-integration-preview-cleanup`, isolated worktree
  `D:/GitHub/affect-tracker-research-integration-preview`, base `6be0a79`.
- Documentation handoff `d1a4665` is integrated at `6be0a79`, with the prior
  canonical draft preserved at `6223ca9`. All 14 handoff files match; checks
  cover 15 Markdown files, 149 local links, the JSON example and 62 unique
  capability IDs (14 checked, 48 open). Runtime source remains `305d3ac`.
- Collect ready Preview `268e0a9` and dependent divider `20644e2` first.
  Resolve only reviewed shared app/view/style hunks, preserve confirmation
  footers/motion and newer roadmap authority, then run combined Node, build
  closure and isolated offscreen layout/input checks. Baseline: 48 focused
  UI/preview/accordion tests pass. No foreground app testing or native claims.
- P5 owns Input/Visual/Advanced consolidation. Later cleanup collection depends
  on clean owner handoffs; removing old Experiment requires actual retained-field
  destinations from P1/P7. P6's editor mount must survive old Visual removal.
  No unique v1 readers, evidence outputs or unimplemented successors are deleted.
- Newly reported explicit P6 Q11 answer: head-forward without eye tracking,
  world-fixed during an attempt, stop on tracking loss, recenter only before
  the next attempt. P6 owns the scoped decision/contract update; earlier pending
  entries are dated observations, not reasons to re-ask the answered question.
- Deferred: unready P1/P2/P3/P4/P5/P6/P7 work, floating native overlay, Runner,
  installed/native qualification, publication and deployment. Main remains
  unchanged until the isolated combined candidate passes its named checks.
- Ready receipt: combined source `0d0ccb6` plus the teardown test correction
  passes 448/448 JavaScript tests, desktop 8-file and Pages 174-file closures.
  Background checks pass: Edge appearance 21, pinned layout/input 4,
  confirmation footers 8, and full-app resize/reflow 8 each in Edge and Chrome.
  Both pane overflow values are zero in every resize case, including a 320px
  preview. Inspected confirmation and narrow-preview screenshots. Receipts:
  `D:/GitHub/.affect-preview-checks/integration-20260911`.
- Source conflicts combined divider mode/teardown with all preview cleanup;
  board conflicts retain every distinct entry. The former teardown source test
  assumed divider cleanup must be the first statement; it now checks all four
  cleanup calls inside the controller teardown. The resize gate now requires
  zero preview overflow as well as zero sections overflow. No behavior is removed
  to satisfy a test. The existing >500 kB desktop bundle warning remains.
- S2 subsequently supplied clean `74e879b`; collect in the next bounded pass,
  including its P7 restore dependency. This preview checkpoint does not claim
  the unfinished multi-segment cleanup or any native/installed qualification.

### 20260911-p1-workspace-library-start

- Owner: **S1**, segment `P1 Workspace & Video Library`; **acknowledged**.
  Branch `codex/segment-p1-workspace-library`, isolated worktree
  `D:\GitHub\affect-tracker-research-workspace-library`, exact base
  `6be0a7952c0c224aa704552e8858a3caf754824b`.
- Assigned checklist: P1-03 through P1-07. First bounded Backend Verification
  slice repairs the browser import destination/package-root handoff and adds
  focused import/rescan/export-path regression evidence without mutating a
  researcher workspace during tests.
- Allowed shared seams: P1-owned browser/native workspace and video-catalogue
  producers, their focused tests, and P1 contribution registration to P7's
  shared authoring registry. P3 consumes immutable asset identity and readable
  annotations; P4/P6 consume oriented display geometry plus catalogue revision;
  S2 remains questionnaire/storage owner; P7 owns master composition and export.
- Q04 annotation normalization/collision policy and Q05 portable-root JSON shape
  remain explicit open decisions. The import-root defect and metadata producer
  interfaces do not depend on choosing those policies. No Runner, publication,
  GUI qualification, canonical integration merge, or unrelated UI cleanup is
  included in this pass.
### 20260912-p2-producer-consumer-closure

- Owner **S2**, P2-04/P2-08 and bounded P2-05 inventory audit; status **ready**.
  Resumed Backend Verification under the existing Planner allocation, branch
  `codex/segment-questionnaires-table-catalogue`, isolated worktree
  `D:\GitHub\affect-tracker-research-questionnaires-table`, base `714b22d`.
  Canonical observed clean at `ba2110f`; P7 consumer observed at `6bac40f`.
- Deliverable: focused producer/restore regressions, approved local EN/DE
  inventory and further-language coverage evidence, then an exact P2 handoff.
  Allowed seams: questionnaire contribution validator/editor tests and P2 documentation;
  P7 owns compiler/save call sites and its combined browser fixture. Existing
  visual handoff and six accepted scrolled captures will not be repeated.
- Compare actual full-definition snapshot/restore contracts with P7 Edit recipe,
  persistence acknowledgement and re-export, including numeric codes, module
  references, language routes and dirty/revision state. No unsupported scoring,
  placement, missing-answer or presentation semantics will be inferred (Q09).
  Invalid-draft durability remains Q13; Runner/native acquisition is deferred.
- User explicitly saved their work and authorized the integration task to merge
  and reload when ready. Authorization was forwarded to **Add segment
  confirmation flow**, which remains sole integrator; no local reload claimed.
- Added `validateQuestionnairePlannerContribution(value)` in
  `questionnaire-contribution.js`: async `true`/throw callback for P7 acceptance.
  It validates exact content, editable identity and complete language coverage
  without mutating state. Existing incomplete-import restoration remains intact.
  Getter stays five-key `{revision,enabled,pending,contribution,dependencyRevisions}`;
  P2 dependencies are `[]`. `restoreQuestionnaireContribution(value,{isCurrent})`
  throws before mutation if stale; successful restore returns the new snapshot.
- Evidence: 28/28 focused Node tests across contribution, prebuilt, grid,
  integration and supplied-questionnaire suites; `git diff --check` clean.
  New synthetic third-language independent-process round-trip preserves codes
  and requires its own asset. Local preset audit preserves every ready MAIA
  item's prompt, label, code, identity and source provenance; no assets changed.
- Independently ran P7's unchanged `package-export.mjs` on clean `6bac40f`
  (clean before/after): Chrome passed 27/27 at
  `D:\GitHub\.affect-checks\s2-p7-consumer-chrome-20260912`. Exact wording edit,
  pending state, full German source, nested route, delayed acknowledged save,
  and explicit reopen draft reset pass. Edge returned empty stdout/stderr
  before any fixture result (`s2-p7-consumer-edge-20260912`); not a pass and not
  evidence of a product assertion failure. The fixture uses a synthetic writer,
  not actual native persistence or a user window.
- **Implemented:** coverage-aware acceptance callback and focused regressions.
  **Owner-ready:** full-content P2 producer/restore plus prior UI at `714b22d`.
  **Integrated:** prior P2 core through `ae47df6` in canonical `ba2110f`;
  this callback, accepted UI polish and P7 consumer are not yet canonical.
  **Missing/deferred:** TAS authorized assets, equivalent computed scoring,
  Q09/Q13, presentation contract and Runner. S7 owns the additional combined
  code-only edit/acceptance fixture and master-envelope integration.

### 20260911-p2-table-first-visual-follow-up

- Final bounded coverage follow-up: coordinator accepted the six initial-state
  captures at `9ff3d5f` and requested scrolled German/settings/footer views.
  Six additional Edge captures at 1600x1100 and 1000x1000 were inspected in
  `D:\GitHub\.affect-checks\s2-visual-details-settled-20260911`.
  Expanded settings labels and Save/Preview/confirmation controls do not
  collide; actions wrap in the narrow pane. Long item/source text retains
  native field scrolling and the wide questionnaire retains table scrolling.
  All application input hashes match `s2-visual-final-20260911`; only the
  fixture and capture script changed. Receipt includes exact hashes, dirty
  fixture status, German language identity, control rectangles and nonzero
  pane scroll positions. Earlier `details`, `details-scrolled` and
  `details-diagnostic` directories are unsuccessful scroll-capture attempts,
  not accepted visual evidence. No application fix or unchanged full-suite
  rerun was needed. No integrator wake, merge, reload or foreground input.

- Owner S2/P2; target integration and catalogue coordinator; **ready**. Separate
  layout follow-up on `codex/segment-questionnaires-table-catalogue`, base
  `ae47df6`; the functional Section 2 handoff is not blocked by this polish.
- Per the coordinator's rendered-UI request, applied uncodixfy to actual
  `bootResearchUi` empty, populated MAIA EN/DE and invalid-code states, at
  1600x1100 and 1000x1000 in isolated headless Edge profiles. The table was
  below the initial narrow viewport and secondary form controls dominated it.
- Moved title/instructions/bulk-required and detailed paste help into the
  existing settings disclosure, preserving its open state across rerenders.
  Kept option count/layout above the grid; moved live validation above it;
  hid duplicate coverage output only for zero questionnaire families. No
  controls, keyboard targets, labels, scientific contracts or source assets
  removed; other segments and Runner untouched.
- Evidence: 445/445 Node tests, 27/27 DOM cases each in headless Edge/Chrome,
  Pages171 and desktop8 closure checks. All six compact screenshots reviewed;
  table starts around y738 instead of y1020 on desktop and is visible on the
  narrow capture. Error text precedes the invalid cell without clipping.
  Receipts: `D:\GitHub\.affect-checks\s2-compact-table-edge-20260911` and
  `s2-compact-table-chrome-20260911`; visual baseline `s2-visual-20260911`,
  candidate `s2-visual-compact-20260911`, source-bound final capture
  `s2-visual-final-20260911`. These are off-screen source fixtures, not user
  clipboard/native runtime/accessibility qualification or observed app reload.
- Residuals unchanged: TAS authorized content/rights, versioned label-display
  contract, optional-response semantics and draft durability; see P2-04–P2-08
  and Q09/Q13. Integration owns combined recheck and any approved reload.

### 20260911-p2-full-import-slot-adoption

- Owner S2/P2, follow-up to finishing Section 2. A complete definition file used
  to require a pre-existing matching family ID, which Add questionnaire could
  not create. A wholly pristine generic family can now adopt the imported ID;
  all scientific content/provenance remain unchanged. Any edited language variant,
  existing destination family or language mismatch rejects without replacement.
- Shared seam: editor `onAdoptImportedFamily` callback and P2 app helper only.
  P7 contribution/restoration signatures and package handlers are unchanged.
  Headless fixture exercises explicit in-memory file input (native picker stubbed),
  family adoption, missing second language, wrong-language rejection and draft
  protection. No raw JSON editor, automatic translation or source rewrite added.
- Ready evidence: 445/445 Node tests; 24/24 isolated headless Edge cases;
  Pages171/desktop8 build closures and whitespace pass. Native/Runner qualification
  and complete P7-integrated save/reopen remain separate evidence gates.

### 20260911-p2-redundant-presentation-cleanup

- Owner: S2/P2, bounded D02/D03 cleanup relayed by the roadmap coordinator
  after the researcher's request to remove app redundancies. Feature handoff
  `74e879b` stays independently ready; this is a separate cleanup commit.
- Source trace: `renderQuestionnaires` mounts only the sheet editor and coverage
  status. Old definition/module lists and coverage-table containers are absent;
  their generated upload/action controls are unreachable. The old Inspiration
  dialog has no opener, and the old preview/file input only serve those paths.
- Remove only those obsolete renderers, dialog markup, event handlers and exact
  unused styles/templates. Retain active per-sheet import/preview, full-definition
  adapters, prebuilt catalogue, family-label metadata, language roles, module
  contracts/hooks and source assets. No Runner or other segment cleanup.
- Evidence to collect: no obsolete selectors/functions in active closure,
  import/grid/full contribution regressions, headless app fixture, both builds.
- Completed trace/removal: obsolete definition/module renderers, unused coverage
  table builder/preset-button loop, old standalone file input/import chain,
  preview/Inspiration dialogs and associated handlers/styles/template constants.
  Active sheet imports, catalogue, module validators/hooks and family-label
  metadata remain. Removed 723 obsolete source/style/markup lines, recoverable
  in Git. No questionnaire asset or user file was removed.
- Evidence: 445/445 Node checks, 20 headless app/grid checks, Pages171 and desktop8
  closure pass; active markup regression rejects the retired surface IDs.

### 20260911-p7-lower-review-visual-closeout

- Completed root-requested lower Review/footer and expanded legacy/provenance
  screenshots at 800px with the actual reduced-motion app path. Receipts verify
  `reducedMotion: true` and `pageScrollTop: 0`; only the setup pane is scrolled.
- The expanded legacy source hash exposed a narrow-pane overflow, now fixed by
  a bounded grid and hash wrapping. The participant-language message now wraps
  above its button in narrow panes rather than being squeezed beside it. No
  confirmation, naming, sampling or recipe semantics changed in this closeout.
- Inspected final files under `D:/GitHub/affect-tracker-research-p7-evidence/`:
  `compact-lower-final/review.png`, `compact-details-final/review.png` and
  `compact-legacy-narrow-fixed/review.png`. Full fixture now has 27 passing cases,
  including no horizontal overflow; narrow populated content is 1712px and the
  explicitly expanded provenance state is 2220px. Existing 465-test suite and
  focused 71-test follow-up pass; final Pages174/desktop8 builds pass after CSS.
- Source ready for integration. Remaining native/hardware qualification and new
  successor/naming/acceptance work retain the limits recorded above.


### 20260911-p7-compact-review-receipt

- P7's separately requested compactness pass uses the `uncodixfy` skill and
  actual `bootResearchUi` screenshots. One Save recipe action also re-exports
  an unchanged loaded recipe. Edit recipe remains separate. Sampling/output
  choices remain visible; provenance/playback and participant preparation are
  closed disclosures with visible blocker links that reveal/focus their controls.
- Repeated explanations share a compact row while independent gate identities,
  counts and Start/recovery decisions remain intact. Status symbols have accessible
  labels. Unsupported settings errors name the editor without internal schema
  terminology. Required errors and the sticky Start status remain visible.
- Screenshot audit additionally exposed a package projection defect: when no
  original experiment document was open, the UI lacked its canonical source text.
  Guarded package projection now reconstructs that text with the existing v1
  serializer. Source verification passes before the explicit language prerequisite.
- Evidence: 465 Node tests; 26 full P7 headless cases on desktop Edge and narrow
  Chrome, including revealed participant controls, unchanged/revised save and
  canonical source restoration; empty and unsupported-XR render scenarios in
  both widths. Pages 174-file / desktop 8-file closures pass. Screenshots inspected
  under `D:/GitHub/affect-tracker-research-p7-evidence/compact-*`.
  Final content heights: empty desktop 1361px/narrow 1687px; populated desktop
  1421px/narrow 1931px; unsupported-XR desktop 1498px/narrow 2069px. These are
  different fixture states, not paired performance measurements against main.
- Integration should collect after `b6647c0`; current screenshots intentionally
  use this isolated branch, so other owners' newer header/P5/section-count work
  is absent. No native or physical qualification. Save naming and sequential
  accepted-contribution changes requested subsequently are a separate main-owned
  pass awaiting the main task's confirmation; no new naming/acceptance semantics
  are implemented here.


### 20260911-p7-editable-recipe-handoff

- P7 Backend Verification: merged P2 `74e879b` and canonical documentation
  `6be0a7` through merge `8d2f9df`; all additive board/API messages retained.
  P7 still owns only package callsites, lifecycle and shared registration.
- Full editable v1 path now consumes P2 restoration. A guarded package
  projection resets old table drafts; opening Edit restores full definitions,
  modules and exact nested tree. Retain loaded package ID and playback policy;
  canonicalizing an imported experiment's formatting is not a design edit.
  P6 validation errors target the agreed `xr` UI section.
- Evidence: 465 Node tests passed on the combined candidate. Updated actual
  `bootResearchUi` fixture passes 23 headless Edge cases, including full MAIA-2
  EN/DE nested-tree load, wording edit, table save, sampling edit, package compile,
  delayed acknowledgement, fresh hash and exact reopen. The untouched German
  definition/provenance remains byte-equivalent. P2's separate 20-case headless
  fixture also passes. Pages 174-file and desktop 8-file closures pass.
- Receipts: `D:/GitHub/affect-tracker-research-p7-evidence/` under
  `reopen-canonicalization`, `p2-grid-regression`, and `p2-combined-node.log`.
  The adapters/media are explicitly synthetic; these are software/UI checks,
  not native picker/filesystem, playback, participant or hardware qualification.
- P7-04 software path is implemented. P7-03/P7-06/P7-07 improved, with whole-
  Planner closure still dependent on accepted successor producers. P7-05/09
  remain open; P4 is explicitly draft-only and P1 geometry/identity wire is
  pending. No silent v1 downgrade or claim that all segments are finished.


### 20260911-p7-receipted-save-checkpoint

- **Owner / stage:** P7, Backend Verification, branch
  `codex/segment-p7-recipe-export`, isolated worktree
  `D:/GitHub/affect-tracker-research-p7-recipe-export`, base `305d3ac`.
- **Delivered:** one receipted save controller and one contribution review guard
  for P7-04/P7-07, plus P7-03/P7-06 seams. Native event acceptance never means
  persistence; the six-field acknowledgement must match the exact canonical
  bytes, package hash and byte length. Cancellation/failure permit retry. Edits
  during compilation prevent writes; edits during a write survive its receipt.
  Decoder readiness is separate from design persistence.
- **Shared integration:** controller initialization binds available P2, P3 and
  P6 producer APIs. P2 must exactly match full v1 questionnaires and language
  tree. Active successor content cannot disappear into v1. Invalid/pending
  contributions, stale dependencies and cycles route to owners and block export
  and ordinary Start. Pending finalization keeps its existing recovery path.
  P2 ready `74e879b` supplies full editable restoration; P7 layers it next.
- **Redundancy cleanup:** Review owns sampling, output formats, reproduction,
  fixed continuous-rating explanation and one legacy-import disclosure with
  readonly participant count. P1 owns identity relocation; P5 owns LSL relocation;
  integration owns removal of the emptied Experiment wrapper. Legacy readers,
  validation, command vocabulary and persisted v1 meanings remain intact.
- **Evidence:** 446 Node tests passed, including 20 new save/contribution tests;
  15 isolated headless Edge UI cases passed at widths 1366, 768 and 640. The UI
  test exposed and fixed stale detection while media verification is pending.
  Pages boundary verified 172 files; desktop frontend boundary verified 8 files.
  `git diff --check` passed. Headless fixtures simulate the native acknowledgement;
  no installed picker, write, player, hardware or research qualification claimed.
- **Still open:** P7-05/P7-09 successor composition requires accepted P1/P3/P4/P6
  contracts and exact native mirrors. This checkpoint does not make the whole
  Planner complete or implement Runner allocation/recording. No canonical branch
  edits, GUI automation, remote publication or new unsafe boundary.


### 20260911-p7-recipe-export

- Owner: **S7**, P7 package; **open**, Backend Verification. User requested
  segment 7 and clarified it is the final Planner step. Integration acknowledged
  this allocation. Branch `codex/segment-p7-recipe-export`, worktree
  `D:/GitHub/affect-tracker-research-p7-recipe-export`, base `305d3ac`.
- Current canonical uncommitted charter amendment and `60`/`61`/`62` were read
  completely; this branch's older documentation is not a replacement authority.
- Scope: P7-03/04/06/07 and the available contribution interface for P7-05/09.
  Input is accepted owner content/revisions and explicit export actions; output
  is canonical recipe bytes, verified save receipts and actionable review state.
  Retain playback/output policy and historical v1 meanings. P7 owns compilation,
  save acknowledgement and the combined stale/export/Start guard, never editor
  semantics or Runner acquisition.
- Shared seams: `app.js` package generation/load/review, `ui-view.js` Review,
  `ui-contracts.js` vocabulary, `native-bridge.js` package save; new bounded P7
  lifecycle/contribution modules, focused tests and required build allowlist.
  P3 and P6 receive one registration/change API; P2 owns questionnaire restoration;
  P5 moves existing LSL controls to Review without changing their saved meanings.
- Verified source: native generation applies/locks before save acknowledgement;
  browser save already reads back canonical bytes. No successor master envelope
  or P4 accepted contract exists. Pending owner contracts must not be omitted
  silently or relabelled as complete. Decisions Q12/Q13/Q15 remain open except
  where the user or owning segment supplies an explicit answer.
- Baseline: frozen pnpm install; 76 focused package, UI, native bridge,
  questionnaire integration and architecture tests pass. Initial missing Tauri
  dependency in the new worktree was resolved by the frozen install.
- Evidence planned: acknowledgement/cancel/failure/retry/late-completion and
  stale-edit tests, owner/dependency errors, canonical re-export and independent
  reproduction, background frontend builds and applicable native contract tests.
  No user-window interaction, Runner/device work, push or deployment.

### 20260911-p2-finish-grid-reopen

- Owner: S2, P2 `questionnaires`; active Backend Verification follow-up to the
  researcher's explicit "finish segment 2" request. Isolated branch
  `codex/segment-questionnaires-table-catalogue`, checkpoint `59d15d9`.
- Brief: finish the user-facing multilingual spreadsheet/catalogue and expose
  full accepted questionnaire content for editable recipe reopening. Inputs:
  explicit table/file edits and language choices; output: existing definitions,
  codes, module hooks and exact language tree. P1 supplies source storage, P3
  consumes placements, P7 composes/saves the recipe. No new runnable schema.
- Checklist: P2-03 grid regressions; P2-04/P2-08 accepted-content restore seam and
  multilingual edit/compile/reopen fixtures; P2-05 exact MAIA EN/DE preloads.
  Q09 computed scoring/extra placement and P2-07 versioned display repetition
  remain decisions; TAS redistribution remains unavailable pending rights/assets.
- Shared files: only S2 helpers/imports/API in `app.js`, questionnaire modules,
  scoped tests/fixture and this entry. P7 owns package apply/save/invalidation
  handlers and must call the P2 restore seam after applying settings. Preserve
  imported module placements, all references and nested language tree order.
- Evidence: 435/435 full Node tests, Pages build/170-file closure and desktop
  frontend build/8-file closure pass. The headless fixture covers full-grid
  paste/copy, Undo, preload labels/codes, app-level editable restore and dirty
  revisions; two independent processes preserve edited EN/DE recipe bytes.
  No user browser, OS clipboard, desktop input or Runner qualification used.
- Canonical roadmap authority (60/61/62 and changed routers) was read; its
  uncommitted documentation belongs to the roadmap/integration owners. This
  branch does not replace it. User approved merge/reload after saving work.
- P7 handoff: `getQuestionnaireContributionSnapshot()` and async
  `restoreQuestionnaireContribution(value, { isCurrent })` in `app.js`;
  domain validator/projection in `questionnaire-contribution.js`. P7 owns
  wiring to package load/Edit recipe and final save acknowledgement. Do not
  claim full integrated P2-04/P2-08 closure before that collection/check.
- Limits: draft durability remains Q13; display repetition remains preview-only;
  historical `und` or colliding family/language slots reject editable restore
  explicitly. Nested language routes survive content edits; roster edits for
  those imported trees require a future routing editor instead of flattening.
  Removing a flat-tree language removes its setup variants, never source files.
  No new scoring formula, translation, native runtime or Runner work added.

### 20260911-questionnaires-table-catalogue

- Owner: **S2**, questionnaires segment. Status: **open**.
- Base: `d286137`; branch `codex/segment-questionnaires-table-catalogue`;
  isolated worktree `affect-tracker-research-questionnaires-table`.
- Confirmed follow-up: whole-table spreadsheet copy/paste including visible
  labels and recorded codes, plus one prebuilt asset-selection dialog with
  separate English/German versions. Keep TAS rights-gated and Runner untouched.
- Seams: questionnaire sheet/editor/catalogue, Section 2 markup/dialog and CSS,
  questionnaire-only app hooks, focused tests and Section 2 documentation.
- Integration owner acknowledged allocation; preview owns its separate hunks.
- Baseline: 48/48 questionnaire sheet/integration and UI tests passed.
- Evidence planned: atomic full-table round trips/rejections, preset provenance,
  language/draft guards and background build/renderer checks. Interactive native
  checks require fresh user opt-in under the newer integration policy.
- Resumed on D: after verified relocation at source checkpoint `59d15d9`.
  User explicitly requested finishing Section 2. The bounded deliverable remains
  its spreadsheet/catalogue and authoring integration, not Runner completion.
  Integration acknowledged continued isolated ownership; no main checkout writes.
  The earlier native build failed from disk exhaustion, not a passing native gate.

### 20260911-p4-screen-layout-draft

- Owner: **S4**, P4 `layout`; **ready**, UI Finalization. The researcher's
  cross-task coordination explicitly allocated an independent non-exportable
  draft while Q08/pass confirmation for persisted geometry remains pending.
- Branch: `codex/segment-p4-screen-layout`; worktree
  `D:/GitHub/affect-tracker-research-screen-layout`; initial base `305d3ac`.
  Merged the integration owner's documentation checkpoint `6be0a79` normally;
  preserved the original P4 entry and inherited instruction snapshot externally.
  Inherited instruction changes are not P4 implementation or product approval.
- Scope: pure proposed geometry, numeric draft editor and whole-screen miniature.
  Q08 conventions stay labelled proposals; no accepted contribution, package,
  Start, Run, persistence, acquisition or qualification change. P4-02/P4-04/
  P4-06 receive draft evidence only; no P4 capability is marked complete.
- Inputs: researcher-entered draft screen/reference/size/offset/calibration;
  P1 geometry and P5 envelope are explicit unavailable dependencies. Synthetic
  media/envelopes live only in non-shipping verification fixtures. P1's proposed
  verified display dimensions/revision and P5's proposed saved-v1 envelope are
  acknowledged but are not yet integrated or treated as frozen contracts here.
- Shared seams: `ui-contracts.js` section registry; `ui-view.js` section mount
  and summary; `app.js` initialization/teardown and generic-form draft isolation;
  scoped `research.css`. New draft model/view/editor modules own all geometry.
  P5 and P7 were notified; no other segment calculation or native owner is edited.
  Legacy Input/Visual/Advanced removal stays P5-owned; Experiment removal stays
  with integration after retained-value handoff. Counts now derive from registry.
- Evidence: baseline 54/54 focused checks; final 437/437 JavaScript tests,
  91/91 isolated headless Edge assertions in four scenarios, inspected application
  and narrow screenshots, desktop frontend build/eight-file closure. Mixed-ratio
  containment, fixed centres, conversion, invalid/overlap/clipping cases, package
  isolation, reflow and semantic checks pass. Reproduce with the committed
  `scripts/qualification/screen-layout-draft.mjs`; local receipts live under
  `D:/GitHub/.affect-preview-checks/p4-screen-layout-20260911`.
- Requested action: integration owner collects the clean P4 commit and reconciles
  shared mounts with P5/P7. Physical calibration, interactive accessibility,
  native/Runner, real-media composition and publication gates remain unverified.
  Canonical checkout was not modified; writers stop after the ready handoff.

### 20260911-roadmap-agent-coordination-audit

- Owner: **Create segment catalogue**, segment `roadmap`; **ready** coordination
  handoff. User explicitly requested checking redundant-section deletion and
  concurrent task alignment, and sending corrective nudges. This is read-only
  application review plus documentation/task coordination, not implementation.
- Integrated source remains `305d3ac`; canonical changes observed are documents
  only. `ui-contracts.js` still registers Experiment/Input/Visual/Advanced, and
  `ui-view.js` still defines/mounts all four. No removal has landed there.
- Sent targeted messages to **S1**, **S2**, **S3**, **S4**, **S5**, **S6**, **S7**,
  **Live Preview**, and **Add segment confirmation flow**. These are existing
  tasks, not newly created implementation tasks. Requests preserve each task's
  latest user instruction and never count as answers to open product questions.
- Current roles: S3=P3 sequence/dictionary; S4=P4 screen layout; S5=P5 Flubber
  consolidation; S6=P6 virtual-screen authoring; S7=P7 final recipe/export.
  S1 explicitly reports a completed historical/migration task, not an allocated
  P1 implementation owner. **P1 was an owner gap at initial audit; resolved by
  the later allocation below.** S2 confirms its active user
  request is now to finish P2 in its isolated questionnaire worktree.
- S3 acknowledged named-only ISIs and typed occurrences, JS/Rust reconciliation,
  contribution coordination with S7 and open Q02/Q14 edges. Its direct user has
  excluded participant-assignment UI; do not reintroduce it through this nudge.
- S5 acknowledged removal of old Input/Visual/Advanced navigation after rehoming
  saved fields; appearance/input/animation remain P5-owned, layout P4/P6-owned.
  P5 supplies a conservative full-range animation envelope to both layout owners.
  Existing normalized v1 controls remain explicitly legacy until replacement,
  never a second active successor geometry authority.
- Live Preview handed off clean committed `268e0a9` and exact overlapping seams
  to S5/integration; its writers are stopped. Preview-only additions are not
  automatically saved settings. Historical test receipts stay bound to that
  pending branch, not integrated completion.
- S6's latest user clarification is a virtual screen for future WebXR with
  precise distance, size and viewing angles. World-fixed/initial-forward was
  already accepted. Tracking/recenter policies still require their own answer;
  the virtual-screen clarification alone does not settle them.
- Requests to integration: reconcile authoritative uncommitted roadmap snapshots
  into isolated worktrees; publish one P7 contribution/guard ownership seam;
  serialize shared UI mounts; identify P1 owner; assign old Experiment removal
  only after retaining study identity/allocation/acquisition/output values.
- Integration acknowledged the audit: P7 owns successor envelope/contribution
  interfaces and the combined stale/export guard. S5 owns Input/Visual/Advanced
  consolidation; final old Experiment shell removal is integration-owned only
  after P7's retained-setting inventory and producer destinations are implemented
  and tested. This coordination request does not allocate new P1 implementation.
- P7 supplied an internal registration/change interface with snapshots containing
  revision, enabled/pending, accepted contribution and dependency revisions;
  payload semantics still belong to the domain owner. P3/P6 acknowledged that
  shared handoff. P4 prepared interfaces/shared seams but has no source changes
  or worktree while its existing stage/Q08 question is pending.
- P6's current draft hard-validates some Q11 policy choices and still uses its
  own simple footprint; it must keep those policies visibly unresolved until
  answered and consume the promised P5 conservative envelope before fit claims.
  Existing draft helpers are not integrated UI, saved recipe or XR execution.
- Integration requested a reviewed documentation-only checkpoint of the exact
  14 canonical roadmap files plus this uniquely owned entry, on the existing
  isolated catalogue branch. Comparison found 13 files byte-identical and only
  this added entry different in the board. No canonical source/index/ref writes
  are part of preparing that handoff. Consumers must collect the checkpoint
  without overwriting newer local board entries or claiming runtime completion.
- Subsequent explicit user decisions: integration received user approval to assign
  P1 to **S1**, P1-03 through P1-07, in an isolated workspace/library lane.
  The researcher's latest message here additionally authorizes keeping every
  segment chat assigned and nudging idle owners toward concrete remaining work.
  No new implementation owner is duplicated. S4 acknowledged an independent
  UI Finalization slice: non-exportable screen draft/geometry preview and focused
  fixtures, while Q08 and accepted/exported geometry remain gated.
- Later direct S3 answer: “Leave allocation policy to Runner.” Updated `00`,
  the dated charter amendment, catalogue P3-04/Q06 and closure plan accordingly.
  Ordered variants remain P3-owned; Planner cyclic policy and participant UI are
  superseded, not implemented. Frozen historical v1 contracts are unchanged.
  These four documents now intentionally differ from the earlier canonical
  snapshot, in addition to this uniquely owned board entry.
- Recurring coordination established in this task: active heartbeat
  `keep-planner-segment-work-moving`, every ten minutes. It checks S1–S7 and
  integration, advances bounded idle-owner work, avoids duplicate nudges and
  reports meaningful progress, conflicts or required input. It does not authorize
  Runner implementation, publication, foreground interaction or unreviewed merges.
- Verification: repository/worktree heads, UI registrations, task histories and
  direct acknowledgement messages. No source edits, builds, app interaction,
  merges or qualification claims. This uniquely owned entry is prepared in the
  roadmap worktree for integration-owner collection; do not overwrite active
  canonical board edits with this entire file.

### 20260911-roadmap-planner-closure-design

- Owner: **Create segment catalogue**, segment `roadmap`; **ready**.
- User asks which segments remain incomplete, a plan for the crucial gaps, and
  designs for missing segments. This continues the confirmed documentation and
  architecture pass in Backend Verification; no application implementation.
- Base: `305d3ac6b2de40a27436f7c97cb1ee2d2a2e87ce`. Preparation branch/worktree:
  `codex/segment-catalogue-current-state`,
  `C:/Users/Georgeous/Documents/GitHub/affect-tracker-research-segment-catalogue`.
- Scope: new `62-PLANNER-CLOSURE-PLAN.md`, routing in `00-READ-FIRST.md` and
  `60-SEGMENT-CATALOGUE.md`, and this entry. Catalogue capability IDs remain the
  sole completion checklist; this pass checks no application item as complete.
- Inputs: current integrated audit, accepted researcher decisions and pending
  S2/S3/preview source. Output: prioritized single-owner slices, proposed UI and
  contribution contracts, acceptance examples and a decision dependency map for
  P1–P7. R1 execution/recording remains deferred.
- Independent read-only reviewers inspect pending P2/P3 reuse and P4/P6 geometry.
  Root owns documentation edits. Evidence: source identity, branch comparisons,
  plan/checklist consistency, Markdown links, whitespace and guarded canonical
  installation/readback. No builds, app interaction or research qualification.
- Delivery continues the user's central-folder allocation: only the four named
  documentation paths may be installed into canonical source after preimage/HEAD
  checks. No application merge, ref change, commit, push or deployment.
- Delivered design: segment status/priorities; nine bounded passes; P1–P7 editor,
  ownership and recipe contributions; P4 screen geometry and optional P6 spatial
  model; pending-branch reuse gaps; Q15 target/profile decision. All catalogue
  application capability statuses remain unchanged.
- Independent reviews confirmed P2's grid export is not full-definition
  interchange and P3's JS/Rust still enforce numeric/post-video ISI rules. The
  plan preserves named-only ISIs and identifies native folder-flattening and
  missing media geometry. Geometry review corrected angular-size scope and
  retained non-overlap; P5 supplies the full animation/input-range footprint.
- Documentation verification passed: 15 Markdown files, 149 local links/anchors,
  all referenced checklist/decision IDs valid, 62 unique capabilities unchanged
  (14 implemented components, 48 open); illustrative JSON parses and the specified
  screen/XR arithmetic checks pass. `git diff --check` passes. These are document
  checks, not new application tests or UI/runtime evidence. Q09/Q10 researcher
  questions remain pending; no recommendation was promoted to an accepted answer.
- Canonical delivery completed: all four allowlisted paths passed preimage checks
  and byte-identical readback in `D:/GitHub/affect-tracker-research`; HEAD remains
  `305d3ac`. Documentation is uncommitted. No application file was changed.

### 20260911-roadmap-central-planner

- Owner: **Create segment catalogue**, segment `roadmap`; **ready**.
  Researcher explicitly requested the central final-state capability checklist
  and mandatory one-segment agent focus in the project's `for-ai/`.
- Pass: Backend Verification, documentation/architecture only. Finish Planner
  planning; Runner implementation/recording remains deferred. Baseline canonical
  source is `305d3ac6b2de40a27436f7c97cb1ee2d2a2e87ce`, clean when checked.
- Preparation: existing isolated branch `codex/segment-catalogue-current-state`
  and its worktree. Scope: root `AGENTS.md`; `for-ai/00`, `05`, `10`, `15`, `20`,
  `30`, `40`, `45`, `50`, `55` Markdown routers/authority notes; rewritten
  `60-SEGMENT-CATALOGUE.md`; extracted `61-IMPLEMENTATION-AUDIT.md`.
- Delivery scope: the user's central-folder request allocates installation of
  these explicit documentation paths into the canonical checkout after fresh
  preimage/HEAD checks. Other project tasks were observed idle. No application
  integration ownership, source merge, branch switch/ref change, commit, push,
  deployment or runtime modification is included. Preserve every other board entry.
- Confirmed answers: version columns/chronological event rows; Runner owns
  recording with implementation deferred; XR world-fixed and forward-aligned at
  setup. Follow-up answers confirm video-ID cells use fixed catalogue duration,
  numeric cells are millisecond ISIs, each video ID has a consistent distinct
  authoring color and ISIs are red. Percentage offsets use one fixed reference
  area for all videos. Remaining edge cases stay open in the decision register.
- Independent read-only reviews checked authority conflicts and source status.
  In particular, current native package markers contain only event type, and
  pending S3 `01444a7` does not yet embed its design into the master package.
- Final documentation checks passed: 14 Markdown documents, 141 local links/anchors,
  62 unique capability IDs across P1–P7/R1, including the accepted ISI dictionary
  (14 implemented components, 48 open),
  and all 79 Research JS/Rust source modules covered by the dated audit.
  Whitespace and `git diff --check` pass. Exact canonical path/hash readback
  follows installation. Original 59-test audit receipt remains historical;
  no new software test/qualification result is claimed by this pass.
- Canonical installation completed: 13 explicit documentation files copied to
  `D:/GitHub/affect-tracker-research` with exact preimage checks and 13/13
  byte-identical readbacks. HEAD remains `305d3ac`; documentation is uncommitted.
  No application file, branch ref, commit, merge, push or deployment changed.
- Subsequent researcher proposal: comma-separated ISI durations create reusable
  ISI1…ISIn dictionary entries referenced in variant columns. Added P3-10/Q14;
  researcher confirmed **named ISIs only**, superseding raw numeric table cells.
  Updated the central roadmap, charter amendment and historical issue routing.
  Dictionary and references belong in the master recipe; lifecycle edge cases
  remain open and no application implementation occurred.
- Researcher clarified that all shown ISI durations/names/counts are examples:
  final durations, dictionary size and experiment sequences are user-defined,
  not fixed presets. The accepted named-reference rule remains in place.

### 20260911-catalogue-current-state

- Owner: current **Segment catalogue audit** task; segment `catalogue`; **ready**.
  User requested a whole-project current-state function/input/output catalogue
  and an editable running checklist in `for-ai/`; confirmed this is a system-wide
  audit for later cleanup, not an application implementation pass.
- Stage: Backend Verification, documentation/source audit only; no stage-complete
  or runtime qualification claim. Baseline integration commit
  `305d3ac6b2de40a27436f7c97cb1ee2d2a2e87ce`, initially clean.
- Branch: `codex/segment-catalogue-current-state`; isolated worktree
  `C:/Users/Georgeous/Documents/GitHub/affect-tracker-research-segment-catalogue`.
- Scope: new `60-SEGMENT-CATALOGUE.md`, its `00-READ-FIRST.md` index link,
  and this uniquely identified board entry. All application sources are read-only.
  Pending S2/S3 work is distinguished from the integrated baseline.
- Delivered: `60-SEGMENT-CATALOGUE.md` covers eight Setup sections, presentation,
  package fields/hashes, Runner steps, shared services, generated files and
  supporting project responsibilities; 18 redundancy review items, 10 findings,
  and 41 editable review/follow-up checkboxes after the follow-ups below. Source index accounts for all
  43 Research JavaScript modules and 36 Rust files in the 420-file baseline.
- Evidence: actual package fixture parsed/compiled; 59/59 focused existing Node
  tests passed on Node `v24.19.0`; 81 local Markdown links/anchors resolved;
  catalogue whitespace/source-coverage/count checks and `git diff --check` pass.
  UI interaction, native builds, hardware, qualification, publication, and
  implementation of discovered gaps remain deferred. Exact test command and
  limitations are recorded in the catalogue.
- Integration: no writes to the active integration checkout; collect this
  documentation after review. Files are uncommitted in the isolated worktree;
  no agreement from other segment owners is inferred. No merge/push/deployment.

- Researcher follow-up, 2026-09-11: clarified modular Designer contributions
  combined into one downloadable master JSON. Catalogue now explicitly maps
  the contribution owners, records working-directory serialization, automatic
  folder/video annotation IDs, EN/DE questionnaire/scoring annotations, and
  saved preview parameters as target requirements. Four C01–C04 review items
  distinguish that target from existing v1 path/discovery/preview limits.
  This remains documentation-only, with no schema or application changes.
- Researcher confirmed cartography comes first: map intended responsibilities,
  producer/consumer handoffs and final JSON contributions to improve information
  flow before cleanup. Added a proposed handoff table, including S4 participant
  count → S3 schedules and the single-owner preview/input/visual/mapping seams.
  The intended map is explicitly separated from the current implementation audit.
- Latest redesign discussion: researcher requests Excel-pasted counterbalance
  variants with repeating participant assignment (P5→V1 for four variants),
  video/ISI LSL markers sufficient for temporal reconstruction, removal of
  standalone Experiment/Visual/Advanced sections, consolidated Flubber input
  and advanced controls, a screen-layout section with physical/relative units,
  and optional APK/WebXR spatial authoring. Replaced the earlier target table
  and handoffs with P1–P7 proposed owners; retained S1–S8 as audited current state.
  Added C05–C08 for version/assignment, marker, screen and XR contracts. Explicitly
  recorded conflicts with current no-allocation/desktop-only/eight-section v1;
  no runtime, schema, charter or supported-platform change implemented. Native
  LSL source and official LSL/WebXR references inform the timing/space caveats.
- Placement clarification: researcher specifies Flubber geometric centre
  relative to each displayed video's geometric centre. Catalogue now defines
  the centre-offset relationship and separates that decision from proposed
  axis, stable animated-shape anchor and percentage-reference conventions.
  P4 owns the relationship; preview/Runner share it. Maximum-video checks
  validate fit without silently changing per-video offsets. Documentation only.
- Language clarification: researcher confirms English and German are the
  current priorities, with additional languages intended later. Revised P2
  wording to describe extensible language variants using one shared authoring,
  validation, package and Runner-selection model. Current picker/preload audit
  remains unchanged; no two-language schema restriction is implied.
### 20260911-p6-virtual-screen

- Owner: **S6**, P6 `xr-layout`; **ready for combined integration**, Backend Verification, bounded Planner
  contribution/editor. User clarified a virtual screen for future WebXR with
  precise distance, physical size and viewing angles. P6-01/02/03/05 allocated;
  P6-04 explicitly answered: head-forward without eye tracking, one anchor per
  attempt, stop on tracking loss, recenter between attempts. P6-06 deferred.
- Branch `codex/segment-p6-virtual-screen`, worktree
  `D:/GitHub/affect-tracker-research-p6-virtual-screen`, base `305d3ac`; canonical
  docs `6be0a79` merged, retaining both owners' board entries.
- Authority provenance: read all canonical working-tree `for-ai/` Markdown in
  order, including the uncommitted 2026-09-11 charter amendment and `60`/`62`.
  Documentation is now committed and merged. This pass changes only P6's
  status/decisions, its contract/evidence receipt and this owned entry.
- P6 owns explicit metres/angles, fixed-screen contain fit, world-fixed initial
  alignment requirements, local feedback centre offsets and inspection preview.
  P1 supplies media geometry; P5 supplies style/full animation envelope; P7 owns
  combined recipe, native save and stale/v1 exclusion. No v1 reinterpretation,
  captured headset pose, runtime acquisition or filesystem authority is added.
- Allowed files: new `xr-layout*.js`, Rust pure mirror, focused fixtures/tests,
  contract documentation and this entry. Shared seams: `ui-view.js` P6 mount,
  `app.js` editor construction/teardown/getter only, scoped `research.css`, and
  `lib.rs` module registration. Agreed with P5/integration: own `xr` entry in
  `SETUP_SECTIONS`, `SECTION_CONTENT.xr`, generic confirmation/motion and dynamic
  section counts. P5's removed Visual section is not used. Shared package/Start
  guards belong to S7.
- Coordination registered with integration, P5, P7 and S3 owners. P5 preserves
  the mount; P7 owns master composition. No other worktree will be edited.
- Baseline: Node v24.19.0, 45/45 focused UI/package/architecture tests. Final
  evidence: 443/443 Node tests (17 P6), 5/5 focused Rust tests, full 191/191 Rust suite
  and warnings-denied Clippy/fmt; desktop 8-file and Pages 173-file closures.
  Chrome and Edge each pass 18 isolated editor checks; 2 actual P5 producer
  interop fixtures pass. Exact commands/limits are in the P6 ledger receipt.
- **Required atomic dependency:** P7 `e524b9f` automatically registers the getter
  and blocks active XR on every v1 save/re-export/Start path. Do not activate P6
  UI in canonical source without this seam. P7 followup corrects issue route to
  `xr`. Full master successor embedding remains open, not bypassed by the separate
  explicitly labelled authoring profile.
- P1 projection agreed: opaque `assetId` plus verified oriented displayWidth/
  displayHeight and catalogue revision. Its producer is still in progress.
  P5 envelope conversion uses an explicit 1024 CSS-pixel reference viewport and
  circumscribed-circle bound. P5's source SHA-256 for interop is
  `e6b94f6e2f91f1d5a97e7d1aee2784e0481ced7d5cbdc522e22263344bd178f8`;
  do not copy P5 policy. Its automatic live wiring remains a convergence seam.
- P5 producer checkpoint is now ready and clean:
  `597a612bbb8ad30d44ed4cb872df026034ee1935` (application source `8d3d256`).
  Both P6 interop fixtures re-passed at that checkpoint with the same source hash.
- No desktop input, GUI launch, publication or headset/research qualification.
- Feature checkpoint: `adc9494`; subsequent owned compactness/error-presentation
  followup is separately committed. Final actual-boot evidence is
  `D:/GitHub/.affect-preview-checks/p6-boot-handoff-20260911/`: 8 inspected
  empty/populated/scene/error captures, 74 assertions, panes 383–815 px.
  47 focused tests and both build closures pass after the UI followup.
  Earlier blank breakpoint-adjacent captures are excluded. The external legend
  retains readable axis/shape meanings when SVG labels shrink. New shared hunk:
  `SECTION_SUMMARIES.xr` and its P6-only changed-state projection.

### 20260911-preview-pinned-input

- Owner **Live Preview**, UI Finalization; **open**, allocated by integration.
  Branch `codex/segment-preview-pinned-input`, dependent base `8524fa2`, isolated
  worktree `D:/GitHub/affect-tracker-research-preview-color-map`.
- Fixed preview header/output/map; independently scrolling lower controls with
  whole-pane fallback for short windows/zoom. Direct map-point selection and
  focus-gated configured-binding presentation via bounded preview-only adapter.
  Shared seams: previewMarkup, preview CSS, old simulator handlers and teardown.
  S3 confirmed no overlap with its ready `01444a7` seams; main stays untouched.
- Reuse existing binding tokens, preserve rectangular snapping, release holds
  on blur/binding/mode/visibility/teardown. No global input capture, acquisition
  receipts, package, Run, native service or validation changes. Corners/reset
  ambiguity and floating/halo follow-ups excluded from this bounded pass.
- Baseline 58/58 preview/UI/simulator tests. Planned: focus/mapping/pointer and
  lifecycle unit tests, offscreen layout/scroll receipts and full JS/build gates.
- Ready evidence: 436/436 JavaScript tests, desktop 8-file closure and 4/4
  offscreen composition receipts under
  `D:/GitHub/.affect-preview-checks/pinned-input-20260911`. Tested real tile hit
  regions, keyboard/custom priority, mouse/wheel, gamepad edge/reconnect/axes,
  focus/dialog/mode exclusion and teardown with process-local fixtures.
- Coordinated with **Add draggable segment boundary**: it owns outer grid and
  divider; this pass owns preview container queries and content-fit observer.
  No native/physical test, active-app reload, push or deployment performed.

### 20260911-preview-rectangular-grid

- Owner **Preview**, UI Finalization; **open**, integration allocation acknowledged.
  Branch `codex/segment-preview-rectangular-grid`, isolated worktree
  `D:/GitHub/affect-tracker-research-preview-color-map`, dependent base `59279f5`
  (inline color checkpoint submitted separately for integration).
- User explicitly requests steps per side (1 → 3×3, 2 → 5×5), plus independent
  columns/rows (3×5, 5×3). Scope: preview tile geometry/simulator/renderer,
  named app/view controls, tests and narrow preview-only charter amendment.
  Steps accept every whole number 1–1000; direct dimensions stay odd 3–2001
  to retain exact central zero and existing bounded renderer cost.
- Preserve invalid drafts without changing accepted geometry, release holds on
  dimension change, use independent x/y snap/step. Saved stepSize, package,
  acquisition and Run remain unchanged. No GUI tests/push/deployment.
- Ready: baseline 15/15 tile/simulator tests; final 431/431 JavaScript tests,
  desktop 8-file frontend closure and 10/10 off-screen Edge tile-paint cases.
  Tests cover every step count, invalid drafts, independent axes, exact neutral,
  rectangular renderer geometry, row-only hold release and saved-input isolation.
  Receipt: `D:/GitHub/.affect-preview-checks/rectangular-grid-20260911`.
  Integration/main remains untouched; native visual verification is unperformed.

### 20260911-preview-inline-color

- Owner **Preview**, segment `preview`, UI Finalization; **open**, allocation
  acknowledged by integration. Base `305d3ac`, branch
  `codex/segment-preview-inline-color`, isolated worktree
  `D:/GitHub/affect-tracker-research-preview-color-map`.
- User asks for an embedded color map instead of a native picker nested inside
  the anchor-color dialog. Scope: bounded canvas HSV picker, dialog markup/CSS,
  app open/draft/teardown hooks and focused/headless tests. No S2 overlap.
- Preserve hex, Reset, Apply, Cancel and close-to-cancel behavior; drag changes
  only the existing preview draft. No package/Run/native changes or GUI tests.
- Baseline: 47/47 preview/UI tests. Planned: conversion/input/teardown checks,
  background browser integration and rendering, full JavaScript regressions.
- Ready receipt: 428/428 JavaScript tests and desktop frontend 8-file closure
  pass. Isolated off-screen Edge component paint, keyboard, hex callback,
  teardown and dialog fit pass at the supported 760px minimum and 1000px.
  Screenshots/JSON: `D:/GitHub/.affect-preview-checks/inline-color-20260911`.
  This is a component fixture, not installed-app or physical-input evidence.
  No GUI interaction, native rebuild, push or deployment performed.

### 20260911-setup-layout-resize

- Owner: **Add draggable segment boundary**, segment `setup-layout`, UI
  Finalization; **acknowledged** by integration owner before implementation.
  Branch `codex/segment-setup-layout-resize`, isolated worktree
  `D:/GitHub/affect-tracker-research-setup-layout-resize`, base `305d3ac`.
- User deliverable: drag the boundary between Setup sections and Live Preview
  to resize the panes. Shared seams: outer form/section/preview sibling markup
  in `ui-view.js`, outer grid/divider CSS, bounded `setup-layout.js` controller,
  bootstrap/mode/cleanup in `app.js`, focused tests and background fixture.
- Transient layout only; no package/storage, Run, native, or domain changes.
  Preview owner contacted about pinned-pane overflow and narrow-width reflow;
  preview internals remain that owner's segment. S3 shared hunks inspected.
- Baseline: 38/38 focused UI, accordion-motion and architecture tests pass.
  Collect drag bounds/cancel/keyboard/cleanup tests, rebuilt desktop frontend,
  and offscreen width/reflow receipts. No desktop control, native launch,
  deployment or qualification claim. Integration owner collects ready commit;
  main checkout and the user's existing app remain untouched by this pass.

#### Divider handoff — 2026-09-11

- Status: **ready** for integration with Preview reflow. Pointer capture,
  primary-pointer ownership, min widths, keyboard 10/50px steps, Home/End,
  Enter/double-click reset, Escape revert, cancel/blur/lost-capture/mode
  cleanup, proportional window resize, and destroy/remount are test-covered.
- 46/46 focused and 434/434 full JavaScript tests pass; frozen install and
  rebuilt desktop frontend 8-file closure pass. Existing >500kB bundle warning
  remains. `scripts/qualification/setup-layout.mjs` passes eight offscreen
  real-UI bootstrap/mode/pane-geometry checks each in Edge and Chrome, with
  unchanged settings and no console/runtime errors. Chrome screenshot at
  432px sections / 840px preview inspected.
- Receipts: `D:/GitHub/.affect-preview-checks/setup-layout-{edge,chrome}-20260911/receipt.json`.
  The fixture reports internal overflow separately: the old Preview at 320px
  inside a 1280px viewport has 36px overflow. Preview owner supplies all
  internal container reflow via ready `7c908949` with its documented
  `8524fa2` / `59279f5` dependencies. Integrator must verify that composed
  candidate before claiming content fit at this limit; no preview-internal
  fixes were taken over here.
- No native code/build, desktop interaction, app reload, main-branch mutation,
  Pages deployment, or publication. Full keyboard/accessibility/installed
  qualification remains open. Next is local convergence by the allocated
  integrator and user UI acceptance; no backend stage escalation is needed
  for transient pane sizing.

### 20260911-integration-confirm-tile-receipt

- Owner: **Add segment confirmation flow**, integration; **resolved**.
  Candidate `fa16b23140644d64aacbb1d455363d776701b56a` combines accordion
  `1253459` and Preview `1b81ad2`. Board append conflict retained both messages;
  source hunks merged without conflict. S2 and S3 unfinished work excluded.
- Combined checks: 426/426 JavaScript tests, desktop 8-file and Pages 169-file
  closures, offscreen Edge confirmation 8/8 and tile paint 6/6 checks pass.
  Receipts under `D:/GitHub/.affect-preview-checks/{accordion,tile}-integrated-20260911`.
- No native mutation/build by integration; S2 owns the separately requested
  source-bound app launch. No GUI testing, push/deployment or qualification
  claim. Reduced-motion/forced-color source guards pass; full interactive
  accessibility remains open. Existing large-JS-chunk warning remains.

### 20260911-accordion-confirm-glow

- Owner: **Add segment confirmation flow**, segment `accordion`, UI Finalization;
  **ready**. User requested bottom confirmation controls and a more salient
  cyclic breathing glow. Branch `codex/segment-accordion-confirm-glow`, isolated
  worktree `D:/GitHub/affect-tracker-research-accordion-confirm`, base `954f38f`.
- Shared seams: only confirmation markup in `ui-view.js`, confirmation CSS in
  `research.css`, focused UI tests, and this receipt. No Preview/S2/Run changes.
- Existing eight controls and sequential review state remain; move Review's
  confirmation below Start controls so every panel ends with the same footer.
  Strengthen the outward-fading glow without removing reduced-motion support.
- Baseline: 29/29 UI/motion tests. Planned: focused and full Node tests,
  desktop frontend build. No GUI testing, native build, push or deployment.
- Result: 425/425 JavaScript tests and desktop 8-file build closure pass.
  `scripts/qualification/accordion-confirm.mjs` passes 8/8 offscreen Edge
  footer/alignment/containment/breathing checks; screenshot inspected at 1280px.
  Receipt: `D:/GitHub/.affect-preview-checks/accordion-confirm-20260911/receipt.json`.
  Only pending confirmation pseudo-elements are exempted from generic shadow
  guards; Preview styles remain shadow-free. Reduced motion remains static;
  forced colors use a static system-color edge. Interactive/native and full
  accessibility qualification remain open. Existing large-JS-chunk warning.

### 20260911-integration-relocation-complete

- Owner: **S2**, relocation; reported **resolved** after user-run completion.
  Canonical repository is `D:/GitHub/affect-tracker-research`; Preview halo and
  questionnaire table worktrees are the corresponding direct children of
  `D:/GitHub`. Old C paths are compatibility junctions, not alternate products.
- S2 receipt: all 46,112 copied files hash-verified, repaired Git worktree
  metadata, clean three worktrees, unchanged origin, main `git fsck` passed;
  transcript `D:/GitHub/.affect-relocation-20260911/completion.log`.
  Main remained `954f38f`; Preview `b07c174`; S2 `59d15d9` remains pending.
- Integration observed the repaired D-path topology and clean main before this
  accordion pass. Migration lock released; background-only testing preserved.

### 20260911-preview-tile-paint

- Owner **Preview**, segment `preview`, UI Finalization; **open**. Migration
  verified and lock released by S2. Base `954f38f`, branch
  `codex/segment-preview-tile-paint`, worktree
  `D:/GitHub/affect-tracker-research-preview-tile-paint`.
- Scope allocated by integration: tile SVG paint defaults and focused tests;
  shared seams `ui-view.js` tile markup and `preview.js` tile stroke projection.
  No S2, saved input, package, Run, native build or GUI changes.
- User screenshot: no grid strokes and solid black active cell. Source and
  localhost:1420 stylesheet both contain correct tile CSS; the screenshot is
  consistent with absent styles, but stale asset delivery is not proven.
- Baseline: 20/20 focused preview/tile tests. Make intrinsic SVG fill/stroke
  explicit while retaining CSS theming; add background style-independent paint
  regression. Interactive acceptance and asset-delivery diagnosis remain open.
- Handoff: **ready**. Explicit SVG paint defaults and stroke geometry retain
  CSS overrides; 67/67 focused tests and 424/424 full JavaScript tests pass.
- Off-screen Edge raster check passes 6/6 cases (3/9/21 tiles, 180/360 px),
  verifying grid ink, active-border ink and transparent cell interior without
  tile CSS. Screenshot inspected: visible subdivisions, hollow active outline.
  Command: `node scripts/qualification/preview-tile-paint.mjs <edge.exe> <output-dir>`.
  Receipt: `D:/GitHub/.affect-preview-checks/tile-paint-20260911/receipt.json`.
- No native build, installer, user-window launch/control, or desktop input.
  This is source/raster evidence only, not proof of what assets an already-open
  app loaded. Native interactive acceptance, delivery diagnosis and publication
  remain unverified; integration owner receives the tested commit for convergence.

### 20260911-integration-preview-converged

- Owner: **Add segment confirmation flow**, integration; **resolved** for source
  convergence. Combined candidate: `2be0242584301cb3e9946684293cb271b2eb2881`.
- Merged Preview `1118ffa`, `c2b07ee` and receipt `b07c174`; retained the newer
  background-only testing policy from **Update agent testing policy** (`c33b4e5`).
  The halo and tile entries below are historical pass receipts; their source
  integration is complete, but their interactive acceptance remains open.
- Combined checks: 423/423 JavaScript tests, Pages 169-file closure, desktop
  8-file closure. Updated the obsolete foreground-testing assertion to enforce
  the user-requested background policy. Native code and contracts unchanged;
  no Rust matrix or native executable rebuild repeated in this integration pass.
- No GUI launch, window control, or input performed by integration. Existing
  executable windows are not claimed to contain the new integrated source.
  No push/deployment; interactive, physical and research gates remain open.
- S2 table/catalogue work remains on its separate branch pending handoff.

### 20260911-preview-stepwise-tiles

- Owner: **Preview**, segment `preview`, UI Finalization; **open**.
- Continues isolated `codex/segment-preview-halo-border` from halo checkpoint
  `1118ffa`; integration owner acknowledged dependent branch continuation and
  non-overlapping preview seams in `app.js`, `ui-view.js`, renderer and CSS.
- Requested deliverable: odd tiles-per-axis spinner (3–2001), centered zero,
  one-tile keyboard steps and responsive outlined active tile in both preview
  grids. Tile count is transient; saved step size stays reachable under Advanced
  with unchanged package/Run semantics. No S2 hunks or authority changes.
- Baseline: 55/55 focused UI/halo/simulator tests. Planned: pure tile bounds and
  snapping, renderer state/geometry, keyboard simulator, isolation, desktop build.
- Halo build at `1118ffa` passed; native observation was stopped by Escape and
  remains unverified. No current native or research qualification is claimed.
- Tile implementation checks: 59/59 focused tests; full JavaScript suite
  423/423; desktop build and 8-file closure pass. Invalid tile drafts are
  explicitly excluded from Start field validation and focus routing.
- Native rebuild/visual check and integration pending. No mouse/keyboard
  automation resumed; Rust, physical input, timing, LSL, release/deployment and
  full accessibility gates deferred because this is transient UI geometry only.

#### Tile build handoff — 2026-09-11

- Source: `c2b07eecc8df21fb6c5a1dd9f5fe78581408e611`, following halo `1118ffa`.
- `pnpm exec tauri build --debug --no-bundle -- --no-default-features` passed.
  Exact isolated executable SHA-256:
  `94cccfe4ece2aa5e8811e454d91c4843515796e31ac44496b85b68a600ea44e9`.
- Launched directly from the isolated worktree; process 66652 returned the
  expected path and responsive **Affect Research** title. Older windows preserved.
- Read-only capture selected the exact returned process window, but the helper
  returned an unrelated foreground surface, not the application. This is **not**
  native visual evidence. No mouse, keyboard, or foreground-changing action was
  sent, and the candidate was left running for manual review.
- Ready for integration-owner review with these limits, not UI acceptance or
  research qualification. Next: manual/native UI acceptance, then any separately
  approved Backend Verification for persisted tile behavior.

### 20260911-preview-halo-border

- Owner: **Preview**, segment `preview`, UI Finalization. Status: **open**.
- Branch: `codex/segment-preview-halo-border`, base `d286137`; isolated worktree
  `affect-tracker-research-preview-halo`. Integration owner acknowledged allocation.
- User request: halo follows the exact Flubber border and fades to transparent
  outward. Setup-only renderer/markup and focused tests; halo width replaces
  geometric enlargement. No Run, package, native, acquisition or floating-window
  changes. Shared seams: `preview.js`, `ui-view.js`; no overlapping writer.
- Baseline: 42/42 live-preview-design and Research UI tests passed.
- Evidence planned: contour/fade/isolation regressions, desktop build and fresh
  native UI observation. No publication or research qualification claimed.
- Integration acknowledged the additional user-requested outward fade and the
  minimal Setup-only charter clarification; legacy renderer behavior is retained.

### 20260911-integration-shared-checkout

- Date/sender: 2026-09-11, **Add segment confirmation flow**.
- Target: **S2** and integration owner. Status: **resolved**; see integration response.
- Base: `research/video-protocol-v1` at
  `2017b622e0f816b94fb8c2331dc307291d744f10`.
- Observation: one worktree contains uncommitted workspace, accordion, preview,
  questionnaire, native-storage, build, test, and documentation changes. New
  Section 2 files appeared during the audit. No local segment branches exist.
- Shared seams: `site/src/research/app.js`, `ui-view.js`, `site/research.css`,
  native bridge/workspace files, and `for-ai/`.
- Request: finish the current Section 2 checkpoint and pause writes for a stable
  integration snapshot. Preserve the existing combined changes rather than
  inventing earlier segment commits. Move future concurrent work to isolated
  segment worktrees. A coordination message was sent to task **S2**.
- Evidence: local `git status --short`, `git branch -avv`, `git worktree list`,
  and active-task inspection on 2026-09-11. No current combined pass is claimed.

### 20260911-integration-current-app

- Date/sender: 2026-09-11, **Add segment confirmation flow**.
- Target: integration/launch owner. Status: **resolved** for exact launch;
  interaction qualification remains open.
- Observation: newer source is not proof that an already installed or previously
  built executable contains it. Earlier launch observations showed an installed
  Affect Research executable while source changes remained uncommitted.
- Request: rebuild the integrated candidate, launch its exact executable or
  source-bound development app, verify the returned process path and real
  window, and leave that window open. Record exact commit and remaining gates.
- Scope: local interface evaluation only; native research Start and existing
  qualification gates remain fail-closed. No installer publication is requested.

### 20260911-questionnaires-preserve-hooks

- Date/sender: 2026-09-11, **Add segment confirmation flow**.
- Target: **S2**. Status: **resolved** by the integration regression tests below.
- Affected seam: `site/src/research/app.js`, `saveEditedQuestionnaire`.
- Observation: reviewed working diff overwrites an existing module's placement
  with `beforeSession` and updates only the first matching module. This conflicts
  with preservation of imported placements and repeated definition references.
- Request: preserve every existing module's hook/target while updating its
  definition hash; only new modules default to `beforeSession`. Add regression
  evidence before integration. Sent directly to the owning task; integrator
  has not changed the owner's implementation.

#### Integration response — 2026-09-11

**S2** handed off with all writers stopped after an interrupted visual check;
it explicitly did not claim full verification. Integration fixed hook/hash
preservation for every reference, pruned removed editor slots, and guarded
asynchronous presets against replacing drafts when languages are added.
`test/research-questionnaire-integration.test.js` passes 4/4 focused regressions.
The shared-checkout and hook requests are resolved in the ensuing local
checkpoint; full combined checks and exact application launch remain pending.
The initial baseline's stale Section 2 UI assertions were corrected by its
  owner; its reported 407/407 pass will be rerun after integration.

### 20260911-integration-combined-checkpoint

- Date/sender: 2026-09-11, **Add segment confirmation flow**.
- Target: all future segment owners. Status: **ready** for local interface
  iteration, not release or acquisition qualification.
- Integrated source: `fd12351` includes all current local Setup work and the
  current main stimulus catalogue. Three overlapping files were reconciled:
  both interaction paths retained in `app.js`; newer workspace/preview and
  questionnaire views retained with stimulus inspiration beside Section 3's
  video controls; roadmap preserves both slices. Historical branches excluded.
- Checks on that clean source: frozen pnpm install; 417/417 JavaScript tests
  including independent-process package reproduction and four new integration
  regressions; Pages closure 168 files; desktop closure 8 files; Rust locked
  no-default check and 186/186 tests. No-default clippy, format and dependency
  audit passed before the merge (native source/dependencies unchanged by merge).
- Open gates: all-feature check fails because this shell has no `pkg-config`
  or usable GStreamer development SDK; all-feature tests/clippy are consequently
  unavailable. Full installed/browser accessibility, physical input/media/LSL,
  timing, acquisition, CI and deployment qualification were not performed.
  The desktop bundle has a non-failing >500 kB JavaScript chunk warning.
- UI: S2's native inspection was interrupted by physical Escape. Do not report
  it as verified or resume automated input on that basis. Existing development
  window may contain user work; do not terminate it without establishing safety.
  Integration is building a separate no-optional-feature executable for launch.
- Tab-delimited questionnaire template has intentional trailing empty score
  columns; the narrow `.gitattributes` whitespace rule preserves those bytes.

#### Exact local launch receipt — 2026-09-11

`pnpm exec tauri build --no-bundle -- --no-default-features` completed against
clean commit `d07a23932ed8c4388ffef2695b2eee026595db42`. The optimized executable
at `src-tauri/target/release/affect-research.exe` has SHA-256
`d283e4a5397d58c9e65e7b87f85c6d41a26b11752ece9ca57016021e3879e85b`.
It was launched directly, and the returned release-process window was observed
read-only: newer three-row Workspace, bottom Confirm button, Section 2 title,
and Flubber/Grid/Face preview were visible. No automated input was resumed.
The release window was left open; the separate debug window was preserved.
This receipt is a documentation-only follow-up to that exact built commit,
not a new application binary. No installer was replaced or published, and no
interactive Section 2/accordion/reduced-motion or full native qualification
claim follows from this read-only screen observation. Cargo also emitted a
non-failing existing bin/lib PDB output-name collision warning during the build.

### 20260911-integration-background-verification

- Date/sender: 2026-09-11, **Add segment confirmation flow**.
- Target: all future agents and integration owner. Status: **resolved** by
  updating `50-AGENT-WORKFLOW.md` and `30-TESTING-AND-RELEASE.md`.
- Observation: the prior workflow required foregrounding the Tauri app and
  interactive visual exercise for routine UI verification, which can take
  control of the researcher's desktop.
- Decision: routine testing now uses bounded local CLI/test entrypoints,
  isolated processes, and background/headless or off-screen renderers with
  machine-readable receipts. Window activation, synthetic input, and
  browser/computer-control tooling require explicit opt-in for a named check.
- Evidence: documentation diff inspected locally; no application, user window,
  or experiment was launched or interacted with during this documentation pass.

# Mandatory agent workflow and skill routing

## Planner CLI amendment — 2026-09-12

The direct request for Planner setting CLI access, saved-JSON load/edit and
timestamped new-file export authorizes [68](68-PLANNER-CLI.md). Older no-CLI
text applies outside that scope. Reuse existing owner logic and native services;
do not infer network, script execution, live-window control, Runner execution or
a second compiler authority. Isolation, background verification, unsafe-boundary
and qualification rules remain applicable.

## Companion-program amendment — 2026-09-12

The latest user decision requires separate **Experiment Planner** and
**Experiment Runner** programs. Planner retains Flubber previews and generates
one comprehensive JSON; Runner owns execution, video playback, LSL transport
and recording of own plus selected external streams to XDF. Stream recording
policy is Runner-owned session state, not a Planner recipe field.
[16-COMPANION-APP-BOUNDARY.md](16-COMPANION-APP-BOUNDARY.md) supersedes earlier
single-executable wording and blanket Runner deferral in this historical text.
Runner allocations use [65-RUNNER-SEGMENTS.md](65-RUNNER-SEGMENTS.md); shared
producer/consumer coverage uses [66-PLANNER-RUNNER-COMPATIBILITY.md](66-PLANNER-RUNNER-COMPATIBILITY.md).
Planner completion is independent; actual execution correspondence is the final
development stage. Existing frozen contracts and qualification gates remain.

## First actions

Before inspecting source, planning, editing, testing, or publishing:

1. locate the Git root with `git rev-parse --show-toplevel`;
2. read the root `AGENTS.md`;
3. read every Markdown file in `for-ai/` completely and in lexical order, then
   read `for-ai/references.bib` when provenance is relevant;
4. inspect branch, remotes, recent relevant history, and `git status --short`;
5. preserve unrelated user/agent changes and identify contract mismatches;
6. inspect the relevant manifests, lockfiles, entrypoints, capabilities,
   workflows, and tests before choosing commands or dependencies; and
7. identify the smallest proportionate baseline for the likely pass, without
   running broad checks before the pass is confirmed.

Do not rely on chat history as the only authority. The charter describes the
target; the roadmap and exact test/qualification receipts describe reality.
The charter's final-state amendment delegates segment capabilities and current
checkboxes to [`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md);
`40-ROADMAP.md` retains receipts and `61-IMPLEMENTATION-AUDIT.md` the dated source
audit. Old Section 2 pass allocations are
historical. The current priority is Planner completion, with Runner recording
and runtime implementation deferred unless separately allocated.

## Pass intent and staged verification

A **pass** is one coherent development iteration with one bounded deliverable;
one stage may contain several passes. A confirmed stage persists through its
follow-up passes until the user changes it, the stage completes, or changed
authority requires escalation. The stages below are agent workflow and evidence
labels. They are not product modes, UI navigation, persisted settings, feature
flags, build profiles, or release claims; the application still has exactly the
two chartered modes. **Backend Verification** means the existing local browser,
Rust, and runtime functionality, never a new server or network backend surface.

After the read-only first actions above, but before mutating files or selecting
broad verification, every agent must:

1. interrogate the current request, recent confirmed context, roadmap truth,
   relevant diff, and affected authority boundaries;
2. make a best guess instead of asking the user to choose from a long list;
3. present one concise **Pass check** containing:
   - the inferred goal for this pass;
   - one inferred development stage;
   - the bounded deliverable and target surface;
   - the evidence that will be collected now; and
   - the work and claims intentionally deferred;
4. ask one concise question to confirm or correct that interpretation, and
   wait before mutation when the current request has not already explicitly
   stated the goal and stage or continued an already confirmed in-scope pass;
5. repeat the Pass check only when the user changes the objective, a discovered
   dependency materially expands the scope, or the work must cross a stage
   boundary. Do not interrupt every small step within an already confirmed
   pass; and
6. once confirmed, run the selected proportionate baseline before mutation so
   pre-existing failures are distinguishable from regressions.

Use exactly these development stages:

Natural-language phrases map to the same stages: “UI development/layout mode”
means **UI Finalization**; “backend/app functionality mode” means **Backend
Verification**; and “GitHub/web/online compatibility mode” means
**Repository/Web Synchronization**. The user does not need to type the formal
label.

| Stage | Purpose and normal scope | Claim ceiling for the pass |
| --- | --- | --- |
| **UI Finalization** | Work out layout, hierarchy, visual styling, responsive behavior, accessibility presentation, and front-end interactions quickly in the locally rebuilt Windows Tauri app. A clearly labelled, non-shipping synthetic fixture or typed preview projection may stand in for incomplete backend data when it has no acquisition, persistence, IPC, package, hash, Run, or evidence authority. | The changed local UI was observed and its focused checks passed. Do not claim backend correctness, installer/package compatibility, Pages compatibility, deployment, or research qualification. |
| **Backend Verification** | After the UI direction is accepted, connect and verify the real browser/Rust owners and their contracts: package resolution, IPC, workspace, input, media, scheduling, persistence/recovery, outputs, and LSL as applicable. A bounded pass may cover a named subset, but promotion from this stage requires an inventory of every current local application function. Keep visual changes to those needed for truthful state and error presentation. | The named backend functions and cross-layer paths passed the reported software or physical checks. Do not claim repository/deployment synchronization or unperformed qualification. |
| **Repository/Web Synchronization** | Reconcile the accepted local application and source candidate with GitHub and the static Chrome/Edge application; inspect the whole diff, run candidate/build-closure gates, and bind evidence to exact artifact and commit identities. Name any proposed commit, push, merge, or deploy action in the Pass check. | The specifically verified local, remote, CI, artifact, and deployed states match. The stage name alone does not authorize an external write and does not imply full installed, physical, timing, or research qualification. |

The effective stage is the stricter of the user-confirmed stage and the stage
required by the files and authorities actually changed. An agent may propose an
escalation with a revised Pass check, but must not silently downgrade evidence
because a task was labelled UI work. If a backend defect forces a UI redesign,
return to **UI Finalization** explicitly rather than mixing unbounded work into
the backend pass. A previously installed executable verifies only its bound
source/artifact identity; after source changes, rebuild and reopen the local
Tauri app before treating it as evidence for the current pass.

Stage completion and promotion use these boundaries:

1. **UI Finalization → Backend Verification:** the user accepts the UI
   direction, and the handoff lists every fixture, stub, unconnected control,
   and deferred backend behavior.
2. **Backend Verification → Repository/Web Synchronization:** applicable
   backend and cross-layer checks pass, and every unavailable physical gate or
   accepted blocker is explicit.
3. **Repository/Web Synchronization complete:** the exact requested local and
   remote states are reconciled; authorized CI/deployment is checked at the
   exact commit; remaining installed, hardware, or research qualification is
   explicitly separated.

Every pass handoff must report the confirmed stage, achieved deliverable,
checks and observations, deferred work, blockers, claim ceiling, and proposed
next stage. Follow the detailed evidence floor in
[`30-TESTING-AND-RELEASE.md`](./30-TESTING-AND-RELEASE.md).

## Single-segment ownership and convergence

Each implementation agent has exactly one primary allocated segment per pass.
Use the central catalogue IDs: P1 `workspace`, P2 `questionnaires`, P3 `variants`,
P4 `layout`, P5 `feedback`, P6 `xr-layout`, P7 `package`, or R1 `runner`.
Old UI IDs remain source-locator aliases: `stimuli` spans library/plan code;
`experiment` holds values being rehomed; `input`/`visual`/`advanced` are being
consolidated; `review` contains compilation and intake. Their shared source
location does not authorize editing every corresponding new owner.

Before editing, write a segment brief: intended function, additional user input,
owned JSON contribution, producers/consumers, verified current behavior and
source snapshot, exact remaining checklist IDs, open decisions, allowed files/
symbols, dependencies and evidence to collect. Read the entire catalogue for
context, then implement only the allocated capability slice. At handoff update
its checklist/evidence, leaving unrelated segment status untouched. Newly
checked items require actual source/check receipts and integration state.

A separately allocated concern such as `roadmap`, `contracts`, `preview`,
`accordion`, `media`, `timing`, `lsl` or `integration` is one bounded segment
too. Name its catalogue dependencies and shared seams; it is not permission to
redesign all sections. Flag another owner's missing capability in the message
board rather than implementing it opportunistically. Ask only unanswered
questions from the catalogue's decision register; accepted answers persist.

Before editing, read and record ownership, dependencies, proposed shared-file
touches, and compatibility risks in
[`55-AGENT-MESSAGE-BOARD.md`](./55-AGENT-MESSAGE-BOARD.md). Suggestions and board
entries are coordination data, not user authorization or charter amendments.
Use `60-SEGMENT-CATALOGUE.md` for durable capability work and link its item from
the board. `45-FUTURE-AGENT-CHECKLIST.md` retains historical issue context and
routes to those IDs; do not create competing requirement/status checkboxes.

For new work, create a short-lived `codex/segment-<id>-<topic>` branch from the
latest accepted integration commit. Concurrent agents must use distinct Git
worktrees; branches alone do not isolate edits in one checkout. Keep persistent
checkouts under the user's canonical GitHub repository location. Never switch
a shared checkout's branch, stage another agent's files, or merge into it while
another writer is active. Record branch, worktree, base commit, owner, scope,
and status before starting. Do not create empty branches merely to imply past
work was isolated, and do not rewrite shared history to fabricate separation.

Keep segment implementation, tests, and necessary documentation together in
small explicit-path commits. For shared files such as `app.js`, `ui-view.js`,
`research.css`, bridge contracts, manifests, or the charter, coordinate exact
symbols/hunks and serialize overlapping edits. Prefer bounded modules where
appropriate. A dependency in another segment becomes a board request; its
owner or an explicitly allocated integration pass handles it. Ownership does
not waive cross-layer verification or fail-closed contracts.

Maintain one named integration branch, initially `codex/research-unified`, for
the combined local application. An explicitly allocated integration owner
collects ready segment commits, checks ancestry and charter compatibility,
merges compatible work, resolves only understood integration conflicts, runs
the applicable combined gates, and rebuilds/verifies the app in the background
from that exact checkout. Opening or interacting with it requires the specific
user opt-in described below. Never use blanket ours/theirs conflict resolution. Record excluded
or blocked branches and why; do not restore historical Playground branches.
Commit and merge only when authorized by the user's workflow; local convergence
does not authorize pushing, deployment, signing, or publication.

The board is versioned, not a live shared database: worktrees contain independent
copies. Read the integration branch's board as well as the local copy before
claiming ownership (for example `git show codex/research-unified:for-ai/55-AGENT-MESSAGE-BOARD.md`).
Register allocations through the integration owner before concurrent edits;
commit uniquely identified messages on segment branches and have the integration
owner collect urgent coordination changes before affected work proceeds. Do not
silently edit another worktree to make a message appear. Reconcile messages at
integration, retain replies/resolutions, and never infer that silence is approval.

At handoff, record integrated commit, tests, unresolved messages, and the actual
executable/source identity observed. An installed shortcut or older build is not
the current application merely because its window has the same title. Ready
segment branches should converge promptly; branches are temporary development
isolation, not alternative canonical products. Only the integration owner may
change the designated integration branch, with a recorded handoff.

## Active change discipline

Apply the charter's final-state amendment and catalogue first. The detailed v1
discipline below preserves current wire/runtime semantics; its eight-section
and no-allocation statements are not prohibitions on explicitly allocated
successor Planner capabilities. Do not reinterpret v1 to implement those changes.

- Preserve exactly two modes: **Setting Up the Experiment** and **Running the
  Experiment**. Setup follows the eight ordered charter sections: Workspace &
  Libraries; Languages & Study Assets; Experiment Plan & Stimuli; Experiment;
  Input; Visual; Advanced; Review & Start. Run stays deliberately narrow.
- Preserve their two applet functions: Designer controls and questionnaire
  tables compile one finished unified JSON package; Runner takes that package
  for acquisition and monitoring. Raw/master JSON is not a required Designer
  input or editing surface. In a Section 2 pass, log Runner/other-section gaps
  in `45-FUTURE-AGENT-CHECKLIST.md` rather than expanding implementation scope.
- Qualify only Windows Tauri and desktop Chrome/Edge unless the user explicitly
  amends the charter.
- Treat Windows/macOS/Linux no-optional-feature packages as unsigned internal
  Setup/interface-evaluation shells. Preserve their positive native-acquisition
  feature gate and all-false qualification provenance; never describe them as
  supported experiment downloads.
- Treat exact canonical `experiment.package.json` (`ExperimentPackageV1`)
  bytes/self-hash, derived
  settings/assets/assignment/protocol hashes, transient-name erasure,
  no-overwrite output, timing gaps, and safe-boundary recovery as cross-layer
  contracts rather than UI details.
- For new work, package arrays are the only participant/block/video/ISI/hook
  order authority. Package language-tree traversal is the only terminal-
  language authority. Do not call, restore, or emulate the historical
  Williams/cyclic `balanced-v1` allocator, add a seed, use OS/browser locale,
  inspect ambient storage/defaults, or silently repair/reorder an invalid
  package.
- Treat `settings.json`, `experiment.json`, and standardized questionnaire
  CSV/TXT/JSON as explicit authoring/import inputs only. TXT and JSON normalize
  through canonical Questionnaire CSV v1; a converter reports all carried/
  defaulted/rejected/discarded values and emits one complete canonical package.
  Original sources may be stored content-addressed only beneath
  `assets/questionnaires/<family>/<language>/`; no legacy or source artifact
  remains a parallel Start authority.
- Keep Setup Section 2 user-facing and path/package opaque. It may project
  selected languages, one questionnaire accordion/table per family/language,
  editable/pasteable items, separate visible labels and recorded codes,
  compact response settings, import/templates, and exact coverage, but never
  raw package JSON. New modules authored here use `beforeSession`; do not
  silently move imported modules with other placements. MAIA-2/TAS-20 EN/DE are
  the current preset focus; broad Inspiration/Phenomenological Control UI is
  deferred. Label repetition every-item/5/10 remains labelled preview state
  until a versioned persisted contract and Runner parity are implemented.
  Every requested questionnaire family requires an exact variant/module for
  every selected study language before finalization; do not treat `und`, locale,
  public availability, or an Inspiration entry as coverage or reuse authority.
- Explicit researcher paste into the focused questionnaire editor is permitted
  authoring input. Consume only the event's bounded table text and validate it;
  never poll the ambient clipboard, log pasted payloads, evaluate spreadsheet
  formulas, or extend that input path into participant acquisition.
- Tauri Rust owns native workspace, input, playback, scheduler, timestamps,
  persistence, and outbound LSL. Browser sampling lives in a dedicated worker
  with IndexedDB journaling. Rendering never owns the sample clock.
- Preserve the chartered module topology. One composition root connects narrow
  package, workspace, protocol, questionnaire, participant, input, visual,
  media, timing, persistence/recovery, LSL, and adapter interfaces. Frontend
  Setup/Run modules mirror those responsibilities as presentation only on
  Tauri. Do not add circular feature imports, cross-module mutable state,
  untyped event buses, scattered raw `invoke` calls, or policy inside command
  handlers and UI event callbacks.
- Keep shared Setup/Run identifiers and bridge event vocabulary in the DOM-free
  `ui-contracts.js` seam. Platform bridges must never import `app.js`, and UI
  sections must never import a platform bridge. Keep declarative instrument
  markup in `ui-view.js`; it must not acquire IPC, workspace, persistence,
  media, or protocol authority. Keep the authoritative native
  package implementation under `research_native_protocol/` split into command,
  compiler/contract, reducer/response, input, storage, recovery, and runtime
  responsibilities; do not add package-start policy to legacy compatibility
  runtimes.
- Before adding a feature, name its row in the normative mirror map in
  `20-ARCHITECTURE.md`. Keep its frontend editor/view model, native adapter,
  Rust domain/service, and platform implementation distinguishable in source
  and tests. If a proposed edit adds a second unrelated responsibility to
  `app.js`, `native-bridge.js`, `research_commands.rs`, or
  `research_runtime.rs`, extract a bounded module first or in the same change.
- Keep qualified Windows media behind the opaque, Rust-owned native-media
  boundary. Never pass arbitrary filesystem paths or native handles to/from the
  WebView; never discover a system GStreamer installation/plugin path or
  download native runtime code in-app.
- Do not restore deleted Playground features into the active tree. Historical
  WebXR/Quest, remote, Party/Ground Control, direct Polar, face, touch,
  calibration, retro, phone, and legacy study work belongs in
  [`affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
  and Git history unless a new charter explicitly reactivates a bounded slice.

## Required skills

Use the smallest applicable set and read each selected skill completely before
acting.

- Use **`tauri-rust-developer`** for Tauri/Rust, Cargo, IPC, capabilities, CSP,
  native windows, input, filesystem/persistence, GStreamer/native libraries,
  packaging, or release work. Read its security, networking/FFI, persistence,
  latency, and verification references as the task requires.
- Use **`tauri-remote-app-builder`** as the general end-to-end skill for Tauri
  application and frontend/interface work, loading only the references routed
  by the current change. The Research charter overrides the skill's generic
  new-application defaults: do not add or plan a CLI, remote CLI, browser/phone
  companion, listener, pairing, transport, file-transfer plane, or remote-
  operation parity without an explicit charter amendment.
- Use **`system-engineering`** for authority, contracts, lifecycle, media/data/
  control planes, recovery, observability, and qualification design.
- Use **`uncodixfy`** for any generated or changed HTML/CSS/frontend UI while
  preserving this product's accessibility and restrained instrument identity.
- Use the available browser-control skill only for a specifically user-approved
  real-browser visual/behavioral check. Static inspection or a background
  receipt is not interactive runtime evidence, but is the required default when
  the user has not opted in to desktop interaction.
- Use the available multi-source web-search skill for current or uncertain
  APIs, standards, licenses, compatibility, or research claims, preferring
  official primary sources for technical decisions.

Skill names are stable; installation paths are not. Never put a machine-local
skill path into source or build configuration.

## Mandatory pause points

Stop and request explicit user direction before:

- adding `unsafe` Rust/FFI when a safe implementation is not already approved;
- enabling remote WebView content or broad filesystem, shell, process, network,
  or capability authority;
- changing Tauri major version, Rust edition, package manager, bundle identity,
  updater/release channel, or signing identity;
- destructive data/configuration migration or automatic legacy import; or
- signing, publishing installers/releases, store submission, or using
  production credentials.

The current GstPlay design has two approved contained Windows `unsafe` FFI
adapters: private DLL-search activation/removal and application-owned child-
window/GstPlay overlay operations. The researcher approved both boundaries on
2026-09-10. Do not add a third unsafe source file without a new explicit pause
and approval. Keep the two existing adapters private, document every handle,
thread, teardown, and panic invariant, exercise malformed/missing native state,
and never unwind a panic across FFI.

## Change workflow

1. State the user-visible outcome and affected browser, desktop, shared,
   settings, record, LSL, privacy, accessibility, packaging, and qualification
   surfaces.
2. Define one owner for each changed parameter and state transition. Preserve
   package bytes, every derived hash, manual order, language path, hook order,
   playback/output policies, and per-video `isiAfterMs` through every adapter;
   keep UI handlers as typed adapters, not hidden business logic.
3. Specify request/response/event types, lifetimes, generations, cancellation,
   overload/error behavior, and observability before widening an IPC or native
   boundary.
4. Prefer the smallest coherent vertical slice. Avoid unrelated framework,
   dependency, permission, or formatting churn.
5. Add focused success, rejection, stale-generation, interruption, and cleanup
   tests, then run the broader applicable gates in
   [`30-TESTING-AND-RELEASE.md`](./30-TESTING-AND-RELEASE.md).
6. Verify behavior through non-interactive CLI/test commands, process-isolated
   fixtures, and a background/headless renderer whenever the claim can be
   covered that way. Never take control of the researcher's computer, move
   windows, synthesize pointer/keyboard input, or foreground an application as
   part of routine testing. Never infer physical/platform qualification from
   mocks, a background renderer, or a build.
7. Update this durable brief whenever requirements, authority, contracts,
   privacy, data fields, media, LSL, platform support, or gates change.

### User-control protection and background verification

Routine verification must leave the user's desktop, windows, focus, pointer,
keyboard, clipboard, and active applications untouched. Agents must use the
repository's existing CLI-capable functions and test entrypoints, or add a
bounded local verification command when that is the smallest contract-faithful
seam. For renderer-dependent checks, run a background/headless renderer or an
off-screen process that produces machine-readable receipts, screenshots, or
video frames without taking over the desktop. Keep this verification separate
from participant-facing runtime authority and do not add a remote-control or
general-purpose CLI surface contrary to the charter.

Do not use computer-control, browser-control, window activation, GUI launch,
synthetic input, or foreground visual exercise for testing unless the user
explicitly opts in for that specific check. A GUI is never a default fallback
merely because it is available. If a claim cannot be established without an
interactive check, report it as unverified and ask before touching the user's
desktop; do not silently perform the check.

When the user explicitly opts in to a named interactive check, keep it bounded:

1. run the proportionate tests and rebuild the current desktop frontend/native
   development candidate so the window cannot be serving stale assets;
2. do not close, focus, move, or interrupt any existing user window or active
   experiment; use a separately identified candidate only after confirming it
   cannot affect the user's work;
3. obtain the user's explicit approval immediately before launching or
   foregrounding the candidate, then exercise only the named behavior; and
4. report the exact launch mode, interaction performed, and any behavior that
   remains unchecked. Without that opt-in, a background receipt is the maximum
   claim and the interactive gate remains open.

The two-clean-independent-instance package reproduction benchmark is a
permanent gate, not a one-time implementation test. Any package-contract,
canonicalization, asset, language, questionnaire, assignment, or protocol
change must rerun every participant × terminal-language comparison, exact
five-hash/sequence equality, byte-identical re-export, and instrumented
no-ambient-default/storage proof. Do not infer native playback or research
qualification from that deterministic receipt.

## Provenance and dependency discipline

Record every adopted source-derived algorithm, API behavior, compatibility
decision, runtime dependency, and license boundary in
[`70-RESEARCH-PROVENANCE.md`](./70-RESEARCH-PROVENANCE.md). Put publications in
`references.bib`. State accurately whether code or binaries are copied,
vendored, dynamically linked, or independently implemented.

Pin native/runtime artifacts to exact versions and hashes, preserve notices and
source obligations, and distinguish supply-chain integrity from runtime
qualification. A successful transport call, capability response, build, or
staging step proves only that step.

## Git and handoff discipline

- Inspect status and diff before and after edits. Never discard, absorb,
  reformat, or stage unrelated work.
- Keep coherent concerns separable and stage explicit paths. Create tested
  checkpoints before risky migration or lengthy platform work when requested.
- Commit, push, merge, deploy, or publish only within the user's requested
  workflow and repository safeguards. Never rewrite shared history or bypass a
  failing check.
- After an authorized push, verify the exact remote commit and applicable CI.
  For a web-facing deployment, use a cache-bypassed check of the exact Pages
  project URL. A push or green build alone is not deployed behavior evidence.
- Before handoff, report exact checks, untested platforms, remaining blockers,
  publication/deployment identifiers, and whether the local/remote states are
  synchronized. Do not hide intentional dirt or ambiguous ownership.

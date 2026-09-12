# Product requirements

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

## Status

[`15-RESEARCH-V1-CHARTER.md`](./15-RESEARCH-V1-CHARTER.md) is the sole active
authority. This file restates its user-visible requirements. The former
feature-rich requirements remain available in Git history and the frozen
checkpoint; they are not active requirements in this branch.

Apply the charter's 2026-09-11 final-state amendment first. The central
[`segment roadmap`](./60-SEGMENT-CATALOGUE.md) owns future capability requirements
and completion. The detailed requirements below describe the existing v1
generation; old eight-section/no-allocation rules and Section 2-only pass scope
must not be mistaken for the final Planner plan or new agent allocation.
Successor contracts preserve historical v1 meanings and require their own gates.

The documentation describes the target. Current implementation status belongs
in [`40-ROADMAP.md`](./40-ROADMAP.md).

## Product and support boundary

- Desktop name: **Affect Research**.
- Exactly two modes: **Setting Up the Experiment** and **Running the
  Experiment**.
- These modes provide two applet functions: **Affect Tracker Designer** authors
  experiment settings, the video library/manual plan, and questionnaires via
  UI controls and outputs one complete unified JSON package; **Experiment
  Runner** consumes a finished package for acquisition and monitoring. JSON
  compilation belongs behind the Designer UI. A researcher need not create or
  edit JSON to design a study. This is a product-role distinction, not an
  additional mode or a separate-executable requirement.
- First qualification targets: Tauri on Windows and the static application in
  current desktop Google Chrome and Microsoft Edge.
- Manual CI may create unsigned Windows x64 NSIS, macOS ARM64/x64 DMG, and
  Linux x64 DEB/AppImage packages for internal Setup/interface evaluation.
  They use no optional Cargo features, exclude GStreamer, native-input, and LSL
  authority, must block experiment Start, and are neither supported research
  runtimes nor release-ready downloads.
- Tauri retains bundle ID `io.github.georgefejer91.affecttracker` and legacy
  app-data compatibility, but new Research data uses a separate namespace and
  is never populated by automatic legacy import.
- Qualified Windows playback of declared package assets uses the
  bundled, repository-pinned GStreamer 1.28.6 MSVC x86_64 runtime through
  GstPlay. Affect Research never downloads native media code at runtime or
  discovers ambient GStreamer installations or plugin paths.
- WebXR, native Quest, remote control, Ground Control, Party/Universe, Remote
  Flubber, direct Polar, Face/Photoatlas, Touch inference, and the other former
  Playground surfaces are absent from the active source, navigation, and
  release claims. A new project-authored procedural Face may appear only inside
  the bounded Setup feedback-design preview described below; it restores none
  of those historical sources or requirements. Their source and documentation
  remain in Playground/history.

## Setting Up the Experiment

Setup uses eight ordered, single-open accordions on the left and a persistent
live feedback preview on the right.

Every Setup accordion ends with an explicit **Confirm section** action. A
confirmation marks that section **Reviewed** with a visible check symbol and
text alternative, collapses it, and opens the next section; confirming the
eighth section collapses it without wrapping to the first. All eight begin
unreviewed on each fresh application load, including Workspace when its fixed
folders already exist. This session-local review trail is presentation state:
it is not inferred from readiness, persisted, serialized, or used as package,
hash, preflight, Start, Run, recovery, or evidence authority.

Accordion opening and closing uses one short, smooth, reversible size/fade
transition; reduced-motion preference settles it immediately. Only the open,
unreviewed section gives its confirmation control a restrained breathing glow
that is strongest at the edge and fades outward. Reviewed headers show the
check inside a green circle. Their confirmation control becomes a disabled
**Reviewed** receipt, while the header chevron may open or close the section
without clearing the mark or requiring another confirmation.

The persistent preview may include a clearly labelled **Design preview** that
compares classic Flubber, a 2D affect Grid with one point marker, and a
project-authored procedural responsive Face. All three consume the same
transient x/y preview point. This comparison is Setup-only and
non-authoritative. It may demonstrate a centered, manually sized Flubber halo
and proposed continuous-versus-stepwise control timing and hold behavior, but
those draft choices are not saved to the current package/settings/input/visual
contracts and never affect Start, Run, hashes, records, LSL, or evidence.

### Workspace & Libraries

- Choose one experiment-package root.
- Create or validate the fixed `assets/stimuli/`, `assets/questionnaires/`,
  `outputs/`, and `recovery/` descendants. The scientific video-asset closure
  consists only of files declared beneath `assets/stimuli/`; questionnaire
  source uploads are a separate authoring/provenance library and directory
  enumeration order is never protocol authority.
- Drop/import complete videos into `assets/stimuli/` recursively and provide
  **Rescan** without silently adding them to the package manifest.
- Load, strictly validate, and save/re-export one canonical package-root file,
  `experiment.package.json`, implementing `ExperimentPackageV1`. Recompute
  `integrity.packageDefinitionSha256` over the canonical root with `integrity`
  omitted and separately receipt-hash the complete canonical bytes as
  `canonicalSourceByteSha256`. A package admitted to Start is UTF-8 without
  BOM, uses canonical JSON plus one LF, and re-exports byte-for-byte
  identically. Noncanonical JSON can enter only an explicit authoring
  conversion.
- Treat historical `experiment.json`, compatible `settings.json`, and
  standardized questionnaire CSV/TXT/JSON files only as explicit
  authoring/import inputs. Conversion reports every carried, defaulted,
  rejected, and discarded field and produces a new package; Start never reads
  those files as a second authority.
- Windows uses a Rust-owned workspace boundary. Chrome/Edge uses a directly
  authorized File System Access root plus the isolated `affect-research/v1`
  IndexedDB/storage namespace.

### Languages & Study Assets

- Section 2 is a compact questionnaire editor for assets administered before
  the video/Flubber task. Its primary interaction is an Excel-like table, not
  raw package/master JSON. Finalization incorporates the validated table
  content into the internally compiled unified package.
- Select one or more study languages, then **Add questionnaire**. Every added
  family creates one accordion per selected language, named by questionnaire
  and language. The header exposes an up/down disclosure chevron, item count,
  and meaningful readiness/error state; keyboard opening/closing preserves
  edits. Adding a language creates the corresponding missing variant rather
  than translating or duplicating another language's item text.
- Each accordion contains editable item rows and supports an explicit paste
  from cells copied in Excel or another spreadsheet. Pasting a rectangular
  block starts at the focused cell, preserves row/column order, and rejects
  malformed, oversized, or invalid values with an actionable location. The
  researcher can also add/remove rows and edit individual cells.
- The whole table includes item text, per-item **Answer / Code** pairs, and a
  final **Required** (`true`/`false`) column. Answer labels are participant-visible;
  codes are recorded values. A codes-only view preserves labels. Headered
  whole-table paste at the first cell replaces all rows and sets option count;
  headerless paste updates only its rectangle. Copy supports selected ranges
  or the complete table with headers; templates use that same visible layout.
- Keep participant-visible response labels separate from numeric recorded
  values. For example, the display labels may be **Never … Always** while an
  item row records `0, 1, 2, 3, 4, 5`; a reverse-coded row can record
  `5, 4, 3, 2, 1, 0` under the same displayed labels. Changing recorded values
  never silently changes labels or creates subscales, diagnostic thresholds,
  or a scoring interpretation. Preserve explicit existing instrument scoring
  provenance when editing a preloaded definition.
- Provide compact settings for questionnaire title/instructions, number of
  answer options, displayed option labels, and required/optional items. The
  current contract permits one selected response per item; option count is
  not a multi-select response limit. Multi-select would need a separate
  versioned contract and is not part of this pass.
- Provide a labelled design preview for repeating answer labels above every
  item, every 5 items, or every 10 items. Current v1 has no persisted contract
  for this layout preference; it remains preview state until a future
  versioned package/browser/Rust/Runner change is complete. Do not imply the
  current Runner uses it or silently encode it through unrelated fields.
- For every requested questionnaire family, every selected language needs an
  exact-language definition/module before package finalization. Missing or
  invalid variants remain visible and block finalization; `und`, another
  language, OS/browser locale, and implicit translation never satisfy coverage.
- Keep strict UTF-8 CSV, tab-delimited TXT, and JSON import plus downloadable
  format templates as secondary ways to populate the same editor. All accepted
  file or table content normalizes through canonical `questionnaire-csv-v1`.
  JSON imports are optional questionnaire interchange, never required master
  package editing. Preserve original-source, canonical-CSV, and definition
  receipts and content-addressed authoring assets under
  `assets/questionnaires/<family>/<language>/`.
- Focus the preset controls on MAIA-2 and TAS-20 in English/German. MAIA-2 may
  preload the retained authorized assets with source, attribution, translation,
  and scoring provenance. TAS-20 remains an upload/paste preparation slot until
  applicable reuse rights and each language asset are supplied. The retained
  English TAS fixture is excluded from distributable builds; no German TAS
  asset is currently supplied. Broader Inspiration and Phenomenological
  Control UI are deferred from this simplified section.
- Use one **Add prebuilt questionnaire asset** button, opening a separate
  selection dialog within Setup, not individual instrument toolbar buttons.
  Present EN/DE variants separately; selecting one fills its exact item,
  answer-label and coding cells only. Require the language to be selected first;
  never auto-load another language or overwrite a draft. TAS entries remain
  visibly unavailable until authorized distributable assets are supplied.
- Keep the fixed demographics contract intact; its language/localization work
  is a future checklist item. The questionnaire editor does not collect
  participant responses or change which demographic data may be persisted.
- New Section 2 modules use `beforeSession`, in authored family order for each
  terminal language. Existing package/historical hook contracts retain their
  exact meanings, including other placements; do not rewrite imported non-
  pre-session modules to fit this editor. The finalizer owns the finite
  language tree and package embedding.

The current pass is limited to this Designer section and its authoring
integration. The Experiment Runner and other Setup sections are out of scope;
record issues there in
[`45-FUTURE-AGENT-CHECKLIST.md`](./45-FUTURE-AGENT-CHECKLIST.md).

### Experiment Plan & Stimuli

- `ExperimentPackageV1` contains one unique stimulus/asset registry, one unique
  block registry, and one complete ordered block/video schedule per
  participant.
- Every active-v1 stimulus is a complete package video named by a safe
  package-root-relative path beginning with `assets/stimuli/`. Each declaration
  includes its expected SHA-256, byte length, and duration. Missing, extra,
  altered, linked, or undeclared files fail asset-closure verification.
  Repository/network assets and Experimental YouTube are not accepted.
- The package explicitly stores the exact `complete-video-v1` policy: start at
  0 ms, decoded end, rate 1, no loop/seeking, Pause allowed, unmuted volume 1,
  adjacent feedback, and restart-from-beginning recovery. The execution backend
  is a separate frozen platform receipt. Chromium uses
  `browserMediaAdapters`; qualified Windows requires `nativeGstPlay`; explicit
  `unqualifiedWebview` stays permanently labelled unqualified. No unavailable
  mode silently falls back.
- Array order is authority. The Designer target lets a researcher define the
  video library and manual plan through UI; it does not shuffle, balance, seed,
  rotate, select from pools, or otherwise randomize the plan. The researcher
  owns study-design validity. Current read-only/import-based plan controls are
  a recorded implementation gap, not a requirement to hand-author JSON.
- Every participant schedule contains the complete block-ID set exactly once;
  block and video order may differ between participants. Every referenced
  stimulus exists, each participant sees a stimulus at most once, and every
  registered stimulus is used at least once. A study with one common order
  repeats that same block/video sequence in each participant schedule.
- Reject unknown or duplicate JSON keys/IDs, missing references, unsafe paths,
  invalid participant sequences, repeated participant stimuli, unused registry
  entries, and invalid ISIs. Never repair, sort, or default invalid order.
- Verify the declared asset closure and derive canonical package, settings,
  assets, and participant-specific assignment hashes without changing authored
  order. Show a virtualized participant preview and export the resolved
  schedule as CSV.
- Derive **Available**, **Active**, **Partial**, and **Complete** from locks,
  journals, and manifests. They are not editable flags.

### Experiment

- The Designer target authors experiment ID, title, sampling frequency, and a
  complete manual participant schedule through UI and compiles those values
  into the finished package. The Runner reads them as immutable protocol facts.
  Current import/read-only controls are tracked for a later section pass.
- Require consecutive participant IDs `P001` onward in schedule-array order,
  using at least three digits and enough zero-padding for the largest ID.
- Continuous rating is always enabled. No continuous toggle, single-summary,
  or summary-only option is present.
- Authoring may initially propose 130 Hz, but a runnable package explicitly
  stores an integer from 1 through 240 Hz. Runtime resolution has no default.
- There is no global fixed/jitter/continue selector. Each explicitly authored
  video occurrence has an integer `isiAfterMs` from 0 through 3,600,000.

### Input

- Presets: Arrow keys, WASD, IJKL, numpad, pointer/trackpad Grid, mouse
  buttons/wheel, gamepad D-pad, gamepad left stick, and gamepad right stick.
- Package authoring initially suggests Arrow keys with step `0.1`; every
  runnable package stores the complete binding explicitly.
- Digital step input responds only to physical edge presses and ignores OS key
  repeat. Pointer and analog presets are continuous/absolute and show step as
  **N/A**.
- Custom binding selects a direction, captures one keyboard/mouse/wheel/gamepad
  action, rejects any conflict, and supports an inert live test.
- The Setup design preview may expose proposed **Continuous** and **Stepwise**
  response controls. Continuous may demonstrate a full-span press duration;
  Stepwise may demonstrate separate-press versus wait-and-repeat behavior and a
  tiled Grid. These controls remain transient design exploration. Current
  `InputBindingV1` retains edge-only digital steps, ignores OS key repeat, and
  receives no new fields or meanings.

### Visual

- The preview and Run overlay are in-application feedback at one normalized
  position; a native transparent desktop overlay is not required.
- Expose independent Grid and Flubber visibility, Flubber Size as percent of
  stage, Transparency, Hide Visual Feedback, and draggable normalized position.
- **Lock position** is the sole Disable Dragging control and is forced on in
  Run. Hiding visuals never stops sampling.
- Flubber controls: outline enabled/thickness and halo enabled.
- Grid controls: line thickness, outline enabled/thickness, and cursor size.
- Color & Gradient owns four directional VA anchor colors plus idle, outline,
  halo, and cursor colors. Every color has wheel, hex, and reset. Halo color has
  no second owner.
- Within the Setup-only design preview, the Flubber presentation stays above
  its 2D affect-control Grid, directional color swatches may open a bounded
  color-wheel/hex editor, and the halo remains exactly centered on the Flubber
  while a transient size control changes only its preview footprint.
- A three-way preview selector may show **Flubber**, **2D Grid**, or
  **Responsive Face**. The Face is procedural SVG/canvas presentation driven
  only by x/y; it uses no camera, microphone, tracking, inference, Photoatlas,
  image asset, upload, or participant/personal data.
- A nested preview disclosure may present the existing Flubber aesthetic and
  mapping controls as design feedback. It must not create a second owner for
  the current Visual or Advanced settings.

### Advanced

LSL fields are Enable LSL, state stream, stream type, marker stream, and source
ID. LSL is outbound and Tauri/Windows-only. Chrome/Edge preserves imported
values but blocks Start while Enable LSL is true.

Every mapping has Min, Max, driver (`x-axis`, `y-axis`, `angle`, or `radius`),
Reverse, and live preview:

| Mapping | Allowed | Authoring Min–Max | Authoring driver | Authoring Reverse |
| --- | --- | --- | --- | --- |
| Oscillation Frequency | 0–10 Hz | 0.5–2.5 | `y-axis` | Off |
| Edge Smoothness | 0–1 | 0–1 | `x-axis` | Off |
| Projection Amplitude | 0–1 | 0.2–0.4 | `y-axis` | Off |
| Pulse Synchrony | 0–1 | 0.2–1 | `x-axis` | Off |
| Wave-size Variation | 0–1 | 0–0.8 | `x-axis` | On |
| Saturation | 0–1 | 0–1 | `radius` | Off |

Normalize x/y, radius, and angle as specified by the charter; neutral angle is
zero. Reverse applies `t = 1-t` before linear Min/Max interpolation.

### Review & Start

- Show all preflight results, package self-hash, derived settings/assets/
  participant-assignment/protocol hashes, selected language-tree path and
  terminal language, exact resolved sequence, explicit playback policy, output
  path/formats, input test, asset verification, storage estimate, timing, and
  Windows LSL status.
- The chooser shows the four derived participant states. A rerun requires a
  warning and creates a new attempt.
- Require transient first/last names, age 1–120, enumerated gender, and
  handedness. Persist no raw name or self-description: only the uppercase code
  made from the last grapheme of the first name plus first grapheme of the last
  name, age, gender code `W/M/N/S/X`, and handedness `L/R/A`.
- Package output authoring exposes independent CSV and TSV toggles and requires
  at least one; Review may display but never override the accepted policy.
- Start only after every blocking check passes. It freezes the exact canonical
  package bytes/hash, all derived hashes and resolved sequence, playback and
  output policies, terminal language, bindings, derived demographics,
  normalized geometry, output targets, participant lock, and attempt identity.

## Running the Experiment

Run shows exactly one protocol step at a time: the complete video with
configured adjacent Grid/Flubber feedback, a questionnaire form, or a neutral
timed interval. Compact session/timing/write/LSL status and **Stop Early** remain
visible. **Pause** is available only during video playback. Feedback must not
cover the video.

Questionnaire forms use semantic radio groups, visible progress,
**Previous**, **Next**, and **Submit**, managed focus, and full keyboard
operation. Rating input, video sampling, and the regular LSL state stream are
stopped during questionnaire steps. Only bounded questionnaire lifecycle
markers are allowed; prompts and answers never enter LSL.

Sampling occurs only while video playback is active. After every video it
stops, coordinates reset to neutral, and that occurrence's exact `isiAfterMs`
interval runs as an explicit protocol step. This includes a terminal interval
after the participant's final video and a zero-duration interval, whose
lifecycle/safe-boundary evidence still exists without waiting. Package bytes,
settings, bindings, demographics, assignment/protocol plans, terminal language,
playback/output policies, and geometry cannot change; position is locked.

For Windows qualified runs, Rust-owned GstPlay lifecycle state—not WebView media
events or animation frames—opens and closes sampling segments. Player pause,
buffering, end, error, teardown, or loss of the exact media grant fences the
scheduler and produces bounded semantic evidence.

Stop Early durably finalizes a partial attempt. Crash, power loss, forced
termination, or storage interruption leaves the journal authoritative.
Recovery resumes only at a safe video boundary. A partially played video starts
again at its beginning; mid-video resume and invented samples are prohibited.
Completion is durable before participant lock release and return to Setup.

## Settings and data products

Keep all historical settings, experiment, assignment, questionnaire, protocol,
sample/event, manifest, and recovery contracts readable with their exact prior
meanings. This includes `ResearchSettingsV1/V2/V3`,
`ExperimentDefinitionV1`, `ResolvedAssignmentPlanV1`,
`ResolvedExperimentPlanV1`, questionnaire module V1/V2, protocol plan V1/V2,
and manifest V2/V3. None is reinterpreted as `ExperimentPackageV1`.

Every new runnable experiment uses one strict `ExperimentPackageV1`. Its root
members are exactly `schema`, `version`, `packageId`, `assetRoot`, `assets`,
`languageSelection`, `playback`, `settings`, and `integrity`. The embedded
`ResearchSettingsV3` owns experiment/sampling, logical stimuli, manual order and
ISIs, questionnaires/hooks, input, visual, mappings/LSL, and output policy.
Its closed `output` object has only Boolean `csv` and `tsv`; at least one is
true and those selections apply to both rating and questionnaire-response
tables.

Unknown or omitted fields, an invalid self-hash, noncanonical Start bytes,
unresolved tree/reference edges, or hash mismatch reject.

The Setup design-preview selector, procedural Face, halo-size draft, and
continuous/stepwise timing or hold drafts are deliberately absent from these
contracts. A runnable use of any of them requires a future explicitly versioned
package/settings/input/visual contract with browser/Rust parity and new
qualification evidence; current readers must continue to reject such added
fields.

The self-hash is `integrity.packageDefinitionSha256`, computed over canonical
JSON with the whole derived `integrity` member omitted. That member also fixes
`settingsSha256`, `assetManifestSha256`, `experimentPlanSha256`, and
`protocolMatrixSha256`; `canonicalSourceByteSha256` binds the complete file
including the integrity block and final LF. The permanent benchmark additionally
compares a participant-specific assignment hash and a
participant-plus-terminal-language protocol-plan hash. No hash absorbs
timestamps, machine paths, directory iteration, decode timestamps, browser
storage, or platform capability observations. The unreleased ManifestV3
contract explicitly reserves `experimentPackage` plus its package recovery
binding; after that contract freezes, changed record meanings require a new
version rather than overloading historical fields.

Portable settings, `experiment.json`, and questionnaire CSV/TXT/JSON remain
explicit, one-way authoring/import inputs. All questionnaire representations
normalize through canonical Questionnaire CSV v1. Conversion reports every
carry/default/discard/rejection, stores source receipts for provenance, and
emits a complete new package. No local storage, app-data, prior package, or
platform default is silently merged.

Write each attempt to:

```text
outputs/<experiment-id>/<participant-id>/<session-stem>/
```

For example:

```text
P001_EF_A27_GW_HR_20260903T143012482Z_R01
```

Create-new directories and attempt counters prevent overwrite. Always retain
the exact canonical package bytes, all derived hash/plan snapshots, semantic
`events.jsonl`, and the applicable immutable manifest, plus rating and
questionnaire-response projections selected by the package output policy. CSV
and TSV projections of each canonical record kind have identical columns,
order, values, and count.

Every declared `assets/stimuli/` video requires its package-authored SHA-256,
byte length, duration, and decode preflight to match. The verified asset closure
and assignment bind each exact identity before Start; scanning never adds or
substitutes a source.

A future qualified Windows native runtime must be packaged from an approved
minimal closure derived from the exact checked-in pin and verified file
manifest, with complete corresponding-source evidence and upstream notices.
Current interface packages exclude it. Runtime integrity, compilation, or
staging alone does not qualify playback. The in-process raw-window GstPlay
renderer requires its separately approved and audited `unsafe` boundary, a
safe pre-`main` DLL-loading design, and installed-artifact media/lifecycle
tests.

## Independent-instance reproduction invariant

The permanent package acceptance benchmark loads the exact same canonical
package bytes in two clean, mutually isolated application instances against the
same read-only asset tree. For every declared participant and every reachable
terminal language, both instances must produce identical package, settings,
assets, participant-assignment, and protocol hashes plus the exact same ordered
step sequence. Each must re-export bytes identical to the input and to the
other instance. The instances receive no prior IndexedDB/local-storage/app-data
state, OS/browser language, filesystem enumeration order, current time, random
source, or undeclared default. Any dependency on those values fails the gate.

## Sampling and LSL

One sampling authority uses the package-declared 1–240 Hz value for rating rows
and the Windows regular LSL state outlet. New-package authoring initially
suggests 130 Hz, but runtime package resolution supplies no omitted default.
Rendering never owns the clock. Missed slots emit a timing-gap event and are
never backfilled.

Rows retain LSL-compatible and monotonic timestamps, state-anchor age, observed
jitter/gaps, current/target x/y, radius, angle, mapped values, and input state.

The Windows regular Float32 outlet preserves eight ordered channels:
`current_valence`, `current_arousal`, `target_valence`, `target_arousal`,
`radius`, `angle_degrees`, `animation_active`, and `input_active`. The irregular
marker outlet carries bounded semantic lifecycle/stimulus/questionnaire/input/
timing/write/recovery events without questionnaire prompts or answers, typed
text, raw names, paths, settings bodies, or video.

## Accessibility and privacy

- Keyboard operation, visible focus, semantic labels, non-color state, high
  contrast, reduced motion, and polite announcements are required.
- Hiding feedback cannot hide timing, write/recovery, or LSL status.
- Store no raw names, self-described gender text, captured participant input,
  ambient clipboard contents,
  unrelated app/window names, raw pointer trajectories, physiology, face/camera
  data, or remote identifiers.
- An explicit researcher paste into the questionnaire table is permitted
  authoring input. Read only the paste event supplied to that focused editor;
  validate and incorporate the questionnaire cells. Never poll the clipboard,
  capture unrelated clipboard data, or log the pasted payload.
- Research settings, plans, questionnaire definitions/responses, media
  identity, outputs, journals, and LSL remain local. No active-v1 account,
  upload, webhook, peer transport, or telemetry is permitted.

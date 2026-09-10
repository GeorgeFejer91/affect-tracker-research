# Product requirements

## Status

[`15-RESEARCH-V1-CHARTER.md`](./15-RESEARCH-V1-CHARTER.md) is the sole active
authority. This file restates its user-visible requirements. The former
feature-rich requirements remain available in Git history and the frozen
checkpoint; they are not active requirements in this branch.

The documentation describes the target. Current implementation status belongs
in [`40-ROADMAP.md`](./40-ROADMAP.md).

## Product and support boundary

- Desktop name: **Affect Research**.
- Exactly two modes: **Setting Up the Experiment** and **Running the
  Experiment**.
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
  release claims. Their source and documentation remain in Playground/history.

## Setting Up the Experiment

Setup uses eight ordered, single-open accordions on the left and a persistent
live feedback preview on the right.

### Workspace & Libraries

- Choose one experiment-package root.
- Create or validate the fixed `assets/stimuli/`, `outputs/`, and `recovery/`
  descendants. The scientific asset closure consists only of files declared
  beneath `assets/stimuli/`; directory enumeration order is never protocol
  authority.
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
  questionnaire CSV files only as explicit authoring/import inputs. Conversion
  reports every carried, defaulted, rejected, and discarded field and produces
  a new package; Start never reads those files as a second authority.
- Windows uses a Rust-owned workspace boundary. Chrome/Edge uses a directly
  authorized File System Access root plus the isolated `affect-research/v1`
  IndexedDB/storage namespace.

### Experiment

- Read experiment ID, title, continuous-rating assertion, sampling frequency,
  and complete participant schedule from the loaded package; display them as
  protocol facts rather than randomization controls.
- Require consecutive participant IDs `P001` onward in schedule-array order,
  using at least three digits and enough zero-padding for the largest ID.
- Continuous rating is always enabled. No continuous toggle, single-summary,
  or summary-only option is present.
- Authoring may initially propose 130 Hz, but a runnable package explicitly
  stores an integer from 1 through 240 Hz. Runtime resolution has no default.
- There is no global fixed/jitter/continue selector. Each externally authored
  video occurrence has an integer `isiAfterMs` from 0 through 3,600,000.

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
- Array order is authority. Affect Research does not shuffle, balance, seed,
  rotate, select from pools, or otherwise randomize it. The external authoring
  process owns study-design validity.
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

### Questionnaires & Sequence

- The package embeds every runnable questionnaire definition, scoring rule,
  attribution/source receipt, language variant, and ordered hook. A CSV is an
  authoring/import source only; its exact 14-column strict
  `questionnaire-csv-v1` validation and conversion report remain required, but
  Start never depends on that external CSV.
- The package owns a finite, acyclic language-selection tree with one explicit
  root. Ordered choice nodes lead only to declared nodes and every reachable
  leaf declares one terminal BCP 47 language. A single-language package still
  declares an explicit terminal leaf. OS/browser locale and previously selected
  language never choose a branch.
- In Review & Start, a participant must traverse that tree from its root through
  the displayed ordered choices. Start remains blocked until the traversal
  reaches a terminal language; loading a package never selects its first route.
  Changing participant or new-attempt disposition, cancelling selection, a
  rejected Start, and completion all clear the pending selection. A compatible
  recovery instead restores its hash-bound frozen route and never asks the
  participant to choose again.
- Every terminal-language record owns an explicit ordered
  `questionnaireModuleIds` list. The selected route compiles exactly that list;
  there is no definition-language filtering or fallback. Every package module
  must be mapped by at least one terminal, and a mapped definition must use the
  terminal's exact language tag or `und`. Supported placements are
  `beforeSession`, `afterSession`, `beforeBlock`, `afterBlock`, and wire kind
  `afterStimulus`, shown as **after video**; block hooks bind `blockId` and video
  hooks bind `stimulusId` plus an explicit `relativeToIsi` value of `before` or
  `after`. Modules at the same hook and side of the ISI retain the language
  record's order.
- The deterministic step order is before-session hooks; for each manually
  ordered block, before-block hooks; then for each video, the video,
  after-video hooks whose `relativeToIsi` is `before`, its exact ISI, and
  after-video hooks whose `relativeToIsi` is `after`; then after-block hooks;
  and finally after-session hooks.
- Preserve the verified German MAIA-2 definition and its official wording,
  anchors, scoring, subscales, citation, translation credit, and source
  identity as an authoring asset that is embedded into a package when selected.
- Bundle the researcher-supplied English VR Experience, MAIA-2, six-item SSQ,
  and TAS-20 authoring fixtures with their supplied wording, response labels,
  numeric response values, and Max Planck Institute for Human Brain and
  Cognitive Sciences, Department of Neurology attribution. Treat all four as
  unvalidated, unscored candidates: their numeric response values are response
  encodings, not permission to infer scoring or subscale interpretation.
- Preserve the supplied 20-item TAS-20 fixture exactly. Do not infer reverse
  scoring, subscales, totals, thresholds, or diagnostic interpretation. Because
  no rights/reuse proof was supplied, recorded approval of its reuse and
  licensing is an explicit pre-deployment gate. Bundling is neither validation
  nor licensing authorization.
- Provide legacy Import CSV, package authoring controls, definition/hash
  status, add/remove/reorder, placement and language mapping, questionnaire
  preview, and participant-by-terminal-language sequence preview. Saving emits
  one complete package, not additional runtime configuration files.

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

Portable settings, `experiment.json`, and questionnaire CSV remain explicit,
one-way authoring/import inputs. Conversion reports every carry/default/
discard/rejection, stores source receipts for provenance, and emits a complete
new package. No local storage, app-data, prior package, or platform default is
silently merged.

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
- Store no raw names, self-described gender text, composed input, clipboard,
  unrelated app/window names, raw pointer trajectories, physiology, face/camera
  data, or remote identifiers.
- Research settings, plans, questionnaire definitions/responses, media
  identity, outputs, journals, and LSL remain local. No active-v1 account,
  upload, webhook, peer transport, or telemetry is permitted.

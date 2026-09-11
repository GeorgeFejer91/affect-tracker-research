# Affect Tracker Research v1 charter

## Status and precedence

This file, including the final-state amendment below, is the product and
architecture authority for Affect Tracker Research. It supersedes the former feature-rich program, whose
complete source and documentation remain in Playground and Git history.

This is a target contract, not implementation or qualification evidence.
[`40-ROADMAP.md`](./40-ROADMAP.md) records what has actually landed, and
[`30-TESTING-AND-RELEASE.md`](./30-TESTING-AND-RELEASE.md) defines the evidence
required before a Research v1 claim.

## Final-state roadmap amendment — 2026-09-11

The researcher explicitly adopts
[`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md) as the central final-state
Planner roadmap, segment ownership map and capability checklist. Its accepted
decisions govern the intended future product: segment-owned contributions to
one master recipe; extensible questionnaire languages with EN/DE priority;
Excel columns per variant and chronological video-ID/named-ISI rows, with
comma-separated millisecond durations creating an embedded ISI dictionary,
derived boundary events and consistent video/red-ISI authoring colors; ordered
versions with participant allocation policy owned by Runner; reconstructible
event/LSL semantics; consolidated
Flubber/input/Advanced controls; centre-relative physical/percentage screen
layout using one fixed percentage reference; and optional world-fixed XR spatial
authoring aligned forward at setup.

Current priority is Planner completion. The Runner owns execution, actual event
timestamps and recording, but implementation/qualification of those downstream
responsibilities is deferred unless separately allocated. The two application
modes remain unchanged. Open decisions and assistant recommendations in the
catalogue are not silently promoted to accepted requirements.

Later on 2026-09-11, the researcher answered the S3 allocation question:
“Leave allocation policy to Runner.” This supersedes the earlier request for
Planner-defined cyclic assignment. P3 authors ordered variants and their event
profiles, with no participant-assignment UI or Planner allocation algorithm.
Runner selection must consume those explicit variant identities; its policy and
implementation are outside the current Planner pass. Historical v1 explicit
schedules remain unchanged. See catalogue Q06 for this decision's chronology.

For future capability design this amendment supersedes conflicting old
eight-section, no-allocation, normalized-layout-only and desktop-only product
direction. The detailed text below still specifies **the existing v1 generation**:
its nine-field package, complete-video policy, explicit schedules and record
semantics must not be retroactively reinterpreted. New variants/allocation,
geometry, saved feedback additions and XR require explicit successor contracts,
mirrored fixtures and applicable claim-specific gates. Optional XR authoring is
not current APK/WebXR support and does not reactivate unrelated Playground code.

Retain native authority, independent reproduction, safe persistence/recovery,
accessibility, privacy, bounded interfaces and qualification obligations.
`40-ROADMAP.md` remains the evidence ledger; the catalogue owns capability status;
`61-IMPLEMENTATION-AUDIT.md` is a dated source snapshot. Old references to a
“current Section 2 pass” are historical allocations, not a perpetual restriction
on future segments. Every new pass follows its current user allocation and the
catalogue's one-segment brief/checklist discipline.

## Product decision

The product has exactly two user-visible application modes:

1. **Setting Up the Experiment**; and
2. **Running the Experiment**.

These modes provide two applet functions. The **Affect Tracker Designer** in
Setting Up lets researchers choose experiment settings, define a video
library/manual plan, and design questionnaires through user-facing controls.
Its primary final output is one unified JSON file containing all relevant
parameters needed to run the experiment. The **Experiment Runner** in Running
accepts that finished package as its main input and provides acquisition and
monitoring, producing local questionnaire-response/rating tables and evidence
plus the existing optional outbound Windows LSL streams and markers. “Applet”
does not imply another mode or require separate executables.

Master JSON is an internal compilation and final output format. The Designer
must not depend on the researcher creating, viewing, or editing JSON. Loading
an existing finished package is optional reuse; external settings/experiment
JSON remain compatibility import paths rather than the normal design workflow.
The current 2026-09-11 pass is bounded to Designer Section 2. Runner changes
and other-section gaps are deferred to
[`45-FUTURE-AGENT-CHECKLIST.md`](./45-FUTURE-AGENT-CHECKLIST.md).

Dialogs, disclosures, recovery prompts, and the eight Setup accordions are
parts of those modes, not additional modes. Active Research removes the former
WebXR, native Quest, Party, Ground Control, remote-control, direct Polar, Face,
and other Playground surfaces from the active application. Their history is
preserved without giving it active product or release authority.

One bounded exception is authorized for Setup presentation only: a clearly
labelled, non-authoritative feedback-design preview may compare classic
Flubber, a 2D affect Grid, and a new project-authored procedural responsive
Face. This exception is not the historical Face/Photoatlas experiment and does
not add a third application mode, participant-facing Run renderer, camera or
microphone access, tracking or inference, images, uploads, personal data, or
research evidence.

The desktop product name is **Affect Research**. It retains bundle identifier
`io.github.georgefejer91.affecttracker` and existing application-data
compatibility, but all new Research data uses an explicit Research namespace.
There is no automatic import of legacy application data.

## Supported delivery surfaces

Qualify these surfaces first and only:

| Surface | Active role | Capability boundary |
| --- | --- | --- |
| Tauri on Windows | Setup and Run, workspace ownership, native input, bundled native media, durable records, sampling clock, and outbound LSL | Rust authority behind narrow typed commands; packaged Windows/WebView2/GStreamer evidence required |
| Static web in desktop Google Chrome | Setup and Run using a user-authorized workspace root and browser-local journal | Current stable desktop Chrome against the exact static/deployed build |
| Static web in desktop Microsoft Edge | Same browser contract, qualified separately | Current stable desktop Edge against the exact static/deployed build |
| Unsigned Tauri on macOS ARM64/x64 | Internal Setup/interface evaluation only | Experiment Start fails closed; no native media, input, timing, persistence, recovery, LSL, or research qualification |
| Unsigned Tauri on Linux x64 | Internal Setup/interface evaluation only | Experiment Start fails closed; DEB/AppImage packaging is not a supported run surface or qualification |

The downloadable unsigned Windows x64 alpha currently follows the same
interface-only boundary as macOS/Linux: it builds with no optional features,
contains no GStreamer runtime, and blocks Start before mutation. The first row
describes the Windows qualification target, not current package evidence.

The browser has no LSL or native/global-input authority. macOS and Linux
experiment runs, Firefox, Safari, mobile, WebXR, and native Quest are not
active-v1 support targets. The
static application may be served by GitHub Pages under the renamed project path
but must not require a backend, account, CDN, remote runtime asset, or silent
third-party API.

## Modularity and dependency direction

Modularity is a release invariant. The application is composed from bounded
modules for package/contracts, workspace/assets, experiment/protocol,
questionnaires, participants, input, visual projection, native media, timing,
persistence/output/recovery, LSL, and platform adapters. Each module owns one
cohesive policy or lifecycle and exposes a narrow typed interface. A single
application coordinator composes those interfaces; feature modules do not
reach through one another, share ambient mutable state, or communicate through
an untyped global event bus.

The desktop dependency direction is contracts and pure domain logic, then
services/actors, then Windows/Tauri adapters, then thin commands/events, then
frontend view models and controls. The frontend must not reimplement desktop
package, protocol, sampling, persistence, media, input, or LSL authority. Its
Setup accordions and Run stages are independently testable presentation
modules over typed projections. The browser surface supplies explicit browser
adapters behind the same semantic boundary and keeps its unavoidable
JavaScript authority isolated from the Tauri adapter.

Large coordinators must be split when they acquire unrelated policy, storage,
media, timing, or presentation responsibilities. Avoid both monoliths and
file-per-function fragmentation: boundaries follow the authority map,
lifecycle, failure domain, and test seam. Circular dependencies, generic
filesystem/path commands, arbitrary JSON maps where a stable contract exists,
and cross-module mutation are prohibited. Cross-runtime mirrors require shared
golden fixtures and differential tests.

Qualified Windows playback for declared package assets uses the pinned,
bundled GStreamer 1.28.6 MSVC x86_64 runtime through GstPlay. The application
never downloads native media at runtime, searches ambient plugin/installation
paths, or treats a system GStreamer install as an acceptable dependency.
Missing, modified, extra, symlinked,
wrong-architecture, or unavailable native media fails closed. The WebView video
element is available only as an explicitly selected `unqualifiedWebview`
development mode whose attempt evidence remains permanently unqualified.

## Experiment package authority

One strict `ExperimentPackageV1` JSON file is the sole authority for every new
attempt. There is no independently runnable settings, experiment, assignment,
questionnaire, language, playback, or output document. Historical
`settings.json`, `experiment.json`, standardized questionnaire CSV,
tab-delimited TXT, JSON, and related contracts remain readable as explicit
authoring/import inputs, but Start accepts only a complete validated package.

The root contract is closed-world. Its only members are `schema`, `version`,
`packageId`, `assetRoot`, `assets`, `languageSelection`, `playback`, `settings`,
and `integrity`; every nested contract is closed too. `schema` is exactly
`affect-research-experiment-package`, `version` is the JSON integer `1`, and
`assetRoot` is exactly `assets/stimuli`. `packageId` is a bounded canonical
lowercase identifier.

`assets.stimuli` is the complete fixed-root asset manifest.
`languageSelection` is `LanguageSelectionTreeV1`. `playback` is the explicit
`CompleteVideoPlaybackPolicyV1`. `settings` is one embedded, validated
`ResearchSettingsV3`: it owns experiment/acquisition, the matching logical
stimulus registry, input binding, visual/mapping/LSL configuration, output
policy, embedded questionnaire definitions/modules, and the canonical embedded
`ExperimentDefinitionV1` with complete manual participant/block/video order and
integer `isiAfterMs` on every video occurrence. The embedded historical schema
names describe the shape; the package, not another file, is runtime authority.
`settings.output` contains exactly the Boolean members `csv` and `tsv`, at
least one is true, and the selected formats govern both rating and
questionnaire-response projections.

`integrity` contains only `algorithmVersion`, `packageDefinitionSha256`,
`settingsSha256`, `assetManifestSha256`, `experimentPlanSha256`, and
`protocolMatrixSha256`. The algorithm is exactly
`experiment-package-reproduction-v1`. The
[browser contract](../site/src/research/experiment-package.js),
[Rust mirror](../src-tauri/src/research_experiment_package.rs), and
[canonical cross-runtime fixture](../test/fixtures/experiment-package-v1.canonical.json)
are the executable schema mirrors; a member or semantic change requires a new
package version and fixture.

Every member is explicit. Unknown or missing members, duplicate keys or IDs,
noncanonical identifiers/text/numbers, invalid references/tree edges, cycles,
unreachable or duplicate terminal languages, unsafe paths, and hash drift
reject. A package admitted to Start is UTF-8 without BOM and is exactly
canonical JSON followed by one LF. `integrity.packageDefinitionSha256` is the
self-hash of the canonical root with the whole derived `integrity` member
omitted. `canonicalSourceByteSha256` is the separate receipt hash over the full
canonical file bytes, including `integrity` and the final LF. Loading and
re-exporting a runnable package must reproduce the input bytes exactly;
timestamps, source paths, machine identity, and capability observations never
enter it. A noncanonical JSON file may be normalized only through an explicit
authoring conversion and is not itself Start authority.

The package asset manifest names only safe package-root-relative paths beneath
`assets/stimuli/` and declares each expected SHA-256, byte length, and duration.
Missing, extra, altered, linked/reparse-routed, or undeclared assets fail the
closed asset verification. Decode readiness is a separate candidate/runtime
receipt and cannot mutate the package or its hashes.

The package playback policy is exactly `complete-video-v1`: start at 0 ms, end
on decoded end, rate 1, no loop or seeking, Pause allowed, unmuted volume 1,
feedback adjacent, and recovery restart from the beginning. These values are
serialized rather than inferred. Execution backend is a separate frozen
platform receipt: Chromium uses `browserMediaAdapters`; a qualified Windows
attempt requires `nativeGstPlay`; `unqualifiedWebview` is an explicit
development selection. There is no automatic fallback. The unavailable native
actor blocks qualified Start, and every WebView attempt remains permanently
labelled unqualified.

Canonical projections derive distinct package-bound hashes for settings, the
asset manifest, the complete experiment plan, and the participant/language
protocol matrix. A terminal language is selected only by traversing the package
tree; OS/browser locale and prior storage have no authority. Definitions tagged
for that language or `und` may be referenced only by that terminal language's
explicit ordered `questionnaireModuleIds` list. That list, rather than language
filtering or fallback, determines the questionnaire set and order for the
route. Block hooks bind `blockId`; the user-visible after-video hook uses wire
placement `afterStimulus`, binds `stimulusId`, and explicitly declares whether
it runs before or after that occurrence's ISI. Same-hook array order is
normative. The exact sequence is before-session hooks, then for each manually
ordered block its before-block hooks and each video followed by its pre-ISI
after-video hooks, that video's ISI, and its post-ISI after-video hooks, then
after-block hooks, and finally after-session hooks.

The Section 2 authoring gate is stricter than generic historical compatibility:
once a researcher requests a questionnaire family, every selected study
language must have its own exact-language definition and module before a new
package can be finalized. `und`, another language, browser/OS locale, and
implicit translation do not satisfy family coverage. This gate does not
reinterpret already stored historical questionnaire or package schemas.

Package load leaves the participant language unset. In Review & Start, the
participant follows each package-owned prompt and ordered option from the root;
even a one-language tree requires one explicit choice. A terminal route is
scoped to one participant and attempt disposition. Participant/disposition
changes, cancel, rejected Start, successful Start dispatch, and completion
clear Setup selection state. Compatible recovery exposes only a strict,
path-free projection of package ID, canonical-byte/self hashes, participant and
attempt identity, terminal language/path, and assignment hash; after matching
those values against the loaded canonical package, Setup restores the route
without asking again. Mismatch fails closed and offers a new attempt instead.

Projection ownership is fixed. The package `integrity` block stores
`settingsSha256`, `assetManifestSha256`, `experimentPlanSha256`, and
`protocolMatrixSha256` alongside its self-hash. The permanent benchmark's
five-hash tuple is more specific: full canonical package bytes
(`canonicalSourceByteSha256`), selected-language settings, declared assets, one
participant's exact assignment, and that participant-plus-language protocol.
The latter two require participant-specific `assignmentSha256` and
`protocolPlanSha256` receipts; aggregate plan/matrix hashes do not substitute
for those per-case comparisons. A projection never omits an owned field,
absorbs a runtime observation, or reads another file.

## Setting Up the Experiment

Setup is a compact research instrument. Its layout has eight ordered,
single-open top-level accordions on the left and one persistent live feedback
preview on the right. Opening one accordion closes the other seven without
discarding valid edits.

Each accordion ends with a session-local **Confirm section** action. Confirming
marks the section **Reviewed** using a visible check and a non-color text
alternative, collapses it, and opens the next section; the eighth confirmation
collapses without cycling to the first. A fresh application load begins with
all sections unreviewed, even when the Workspace folders already exist. The
review trail is transient presentation state and is never inferred from
readiness, persisted, serialized, or admitted to package/hash, preflight,
Start, Run, recovery, record, LSL, or qualification authority.

Each accordion opens and closes with a short, smooth, reversible size/fade
transition; reduced-motion preference settles without animation. The pending
confirmation in the open section alone has a breathing, outward-fading edge
glow. A reviewed header uses a green circled check plus its text alternative,
and its confirmation control becomes a disabled **Reviewed** receipt. Header
chevrons continue to open and close reviewed sections without clearing review
state or requiring confirmation again. Editing a saved Segment 3 order, changing
its library, or selecting another workspace clears the affected review receipt;
the researcher must confirm the new content. Workspace confirmation writes
video annotations, and Segment 3 confirmation writes the validated order, before
advancing. Those authoring documents remain separate from the review trail.

### 1. Workspace & Libraries

- The researcher chooses one experiment-package root whose canonical package
  file is `experiment.package.json`.
- The application creates or validates the fixed `assets/stimuli/`,
  `assets/questionnaires/`, `outputs/`, and `recovery/` descendants. It never
  infers the scientific video manifest from directory enumeration.
- Video drop/import accepts complete videos, copies or stages them through the
  owning adapter beneath `assets/stimuli/`, and supports recursive discovery
  plus explicit **Rescan**. Discovery never silently enrolls a file.
- **Load experiment package** accepts only exact canonical
  `ExperimentPackageV1` bytes with a valid self-hash and complete reference
  graph. **Save/re-export package** emits those exact canonical bytes.
- Legacy experiment/settings JSON and questionnaire CSV/TXT/JSON import are
  explicit authoring actions. They produce a conversion report and a new
  complete package; they never remain live runtime inputs or supply silent
  defaults.
- Tauri owns the workspace through narrow root/run commands and never exposes
  arbitrary native paths to the WebView.
- Chrome and Edge use a File System Access directory handle obtained in a
  secure context through a direct user gesture, renew access when browser
  permission requires it, and keep journal/lock metadata in the isolated
  `affect-research/v1` IndexedDB/storage namespace.

For Windows qualified playback, Rust revalidates a declared package asset
against its opaque identity before issuing a bounded native media grant.
One Rust-owned actor owns the GLib context/loop, GstPlay instance, renderer,
sink, callbacks, and teardown on its required thread. It renders into an
application-owned child
window attached to the Run stage. The WebView may send only a validated viewport
rectangle and receives an opaque media-session ID plus bounded state; it never
receives or supplies a native filesystem path.

Native player state is authoritative for sampling segments. Decoded Playing
opens a segment; pause, buffering, end, error, teardown, media-grant failure, or
loss of the actor fences sampling before status is projected to the WebView.
Rendering cadence and WebView media events never authorize native samples.

The native runtime is built from the exact repository pin and deterministic
file-hash manifest, with upstream license notices retained and ambient plugin
paths disabled. Unavoidable Windows FFI is confined to exactly two small
adapters: private DLL-search activation/removal and raw-window GstPlay renderer/
child-window operations. Both document handle lifetime, thread affinity,
callback, panic, and teardown invariants; the crate denies undocumented unsafe
blocks and source guards reject unsafe code anywhere else. The researcher
approved these contained native boundaries on 2026-09-10. Their presence is not
runtime redistribution or installed playback qualification.

### 2. Languages & Study Assets

Section 2 is a compact researcher-facing questionnaire editor for forms shown
before the video/Flubber task. The researcher selects study languages, adds a
questionnaire family, and edits one accordion per family/language pair. Each
header names the questionnaire and language, shows item count/readiness, and
has an up/down disclosure chevron. Keyboard opening and closing preserve
valid edits. Raw `ExperimentPackageV1`/master JSON stays behind the UI and is
created or updated by the finalization owner after authoring checks pass.

The researcher selects one or more explicit study languages. Adding a
questionnaire family creates a coverage obligation across that complete
selection: every selected language needs one exact-language definition and a
module for the family. A missing family/language pair is visible and blocks
package finalization. An `und` definition, another language, OS/browser locale,
or an implicit translation cannot satisfy the obligation.

The main control inside each accordion is an Excel-like item table with direct
cell editing and explicit rectangular paste from a spreadsheet. Paste begins
at the focused cell, preserves row/column order, and is bounded and validated
before replacement. Invalid cells receive an actionable item/column error.
Researchers can add/remove rows and set questionnaire title/instructions,
answer-option count, visible option labels, and required/optional items.
The current model is single-choice: option count does not mean that multiple
responses may be selected for an item.

Participant-visible option labels and recorded numeric values are independent.
An item row containing prompt text and `1 | 2 | 3 | 4` records those values
under the separately authored displayed labels. A reverse-coded row can use
`4 | 3 | 2 | 1` with the same labels. Numeric coding is an explicit response
encoding; the app never infers subscales, totals, thresholds, or scientific
interpretation from it. Existing option scores and instrument provenance are
preserved unless explicitly edited through their owning authoring controls.

Compact label-display settings may preview labels above every item, every 5
items, or every 10 items. Current questionnaire/package contracts do not carry
this preference, so this pass labels it as design-preview state only. Runtime
adoption requires a versioned persisted contract with browser/Rust/Runner
parity; it is recorded for a later pass rather than silently added to v1 or
applied to Runner behavior.

The fixed demographics form keeps its existing privacy contract. It is not an
uploaded questionnaire: first/last name and self-description remain transient,
while only the derived participant code, age, and closed gender/handedness
codes may be frozen for a run. Localizing that form is a future checklist item,
not part of this questionnaire-editor pass.

Secondary file-import actions accept bounded strict UTF-8 CSV, tab-delimited
TXT, or JSON questionnaire documents and populate the same table editor.
Downloadable templates define all three
representations. CSV retains the exact 14-column `questionnaire-csv-v1`
contract; TXT uses `questionnaire-txt-v1` with the same columns and one
tab-delimited row per option; JSON uses the closed `questionnaire-json-v1` nested
representation. TXT and JSON are adapters only: each is deterministically
converted into canonical Questionnaire CSV v1, then passed through the same
strict definition importer. Unknown/duplicate fields, malformed encoding,
invalid limits, or ambiguous format identity reject. Direct edits and pasted
tables also compile through this canonical definition boundary. No master JSON
editor is needed or exposed by this flow.

The authoring receipt separately binds the original source bytes, canonical CSV
projection, and normalized definition. The workspace owner stores the original
source content-addressed beneath
`assets/questionnaires/<family>/<language>/<sha256>.<format>`. Those files form
an authoring/provenance library, not the `assets.stimuli` scientific video
closure. Start and Run never open them; the single package embeds the complete
canonical definitions, scoring rules, provenance, modules, and hooks.

The current preset focus is MAIA-2 and TAS-20 in English and German. Official
MAIA assets may preload the selected supported languages with exact wording,
source, attribution, translation, and scoring provenance retained. TAS-20
provides preparation slots requiring authorized researcher-supplied assets;
the retained English source fixture is excluded from distributable builds and
no German asset is supplied implicitly. A slot does not confer permission or
scientific validity. Public availability alone never permits a bundled
preload. Broader Inspiration and Phenomenological Control controls are deferred
from this simplified Section 2; retained provenance/history does not require
them in the active editor.

New Section 2 modules have stable IDs and use `beforeSession`, preserving
authored family order for every selected language. The existing package and
historical module contracts retain the supported placements
`beforeSession`, `afterSession`, `beforeBlock`, `afterBlock`, and
`afterStimulus` (shown as **after video**). Session hooks have no target, block
hooks bind `blockId`, and after-video hooks bind `stimulusId` plus explicit
`relativeToIsi` `before`/`after`. Existing non-pre-session modules must not be
silently moved or discarded by the simplified editor. Same-hook order is
normative. Finalization
builds one finite, acyclic package language tree with an explicit root and exact
ordered module list per terminal; Review & Start still requires explicit
participant traversal and package load never selects the first route.

### 3. Stimulus Presentation Order

The researcher defines counterbalanced experiment variants as spreadsheet
columns, with fixed Event 1, Event 2, … row labels. Cells hold a library video
annotation or an integer ISI in milliseconds. Excel/CSV rectangles are pasted
only through an explicit paste gesture; external randomization remains the
researcher's responsibility. Add/remove controls determine the number of
variants and events. This segment has no participant IDs or assignments.
Per the researcher's 2026-09-11 clarification, participant-to-variant selection
and binding the selected version to recorded participant data belong to the
Runner, not Segment 3 or Segment 4. This is a future Runner contract change;
it does not authorize hidden runtime randomization or reinterpret old records.

Confirming Segment 1 scans the owned video library and stores canonical
`assets/video-library.annotations.json`. Each annotation binds safe relative
path, complete-file SHA-256, and byte length; the readable `video-<16 hex>` ID
maps back to that identity, with collisions rejected. This hash binding is not
encryption, a digital signature, proof of authorship, or decode qualification.
Metadata stays beside `assets/stimuli/` so the exact video-only package closure
is unchanged. CSV and genuine XLSX downloads list current video annotations;
XLSX also contains an empty order template. Spreadsheet text is escaped and
never emitted as formulas.

Confirming Segment 3 validates and persists canonical
`assets/stimulus-order.design.json`. Stable variant IDs and SHA-256 version
annotations bind each variant's name, exact video order, and per-video ISIs.
Changing one variant changes its version; unrelated library additions do not.
A variant requires at least one video and permits each video once. ISIs must
follow a video and be integers from 0 to 3,600,000 ms; adjacent videos imply an
explicit authored 0 ms interval. Trailing empty rows are ignored, interior gaps
and consecutive/leading intervals are rejected, and a terminal ISI is retained.
The authoring projection is bounded to 64 variants, 1,024 rows and 32,000 cells.

These are authoring records, not `ExperimentPackageV1` or Run authority. The
Runner/finalizer must eventually freeze explicit participant schedules and
version bindings in a versioned package/output contract before Prepare.
Until that integration exists, an active variant draft or saved design blocks
package generation and new Start so stale imported schedules cannot be run as
though they represented the new table. Historical package parsing and runtime
contracts retain their exact complete-video identity/duration and ISI rules.

The current downloadable
[`site/experiment-template.json`](../site/experiment-template.json) is a
transitional legacy authoring input that demonstrates manual orders and
zero/nonzero terminal ISIs. It is not an `ExperimentPackageV1` and cannot be a
new-attempt runtime authority after the package boundary lands. A future
package template must include every mandatory package section and a valid
self-hash.

Array order is normative. Affect Research never shuffles, seeds, balances,
rotates, samples, or silently reorders a new experiment. It has no one-hat,
stratified-pool, Williams, cyclic, factorial, or `balanced-v1` authoring control
in the active workflow. The package author is responsible for the scientific
randomization design.

Every participant schedule must contain the complete registered block-ID set
exactly once, though block and video order may vary by participant. Every
referenced block and stimulus must exist; one participant may not receive the
same stimulus twice; every registered stimulus must be used by at least one
participant. Invalid order, duplicate JSON keys or IDs, a participant-ID gap,
unknown references, repeated participant stimulus, unused stimulus, unsafe
path, non-integer/out-of-range ISI, unexpected/mismatched asset, or unknown
field rejects the whole package. Validation never sorts, repairs, infers, or
defaults the experiment.

Resolution verifies the declared asset closure without modifying package
bytes, then derives a canonical assets hash and one assignment hash per
participant. It preserves every authored participant, block, video, and ISI
position and never makes an allocation decision.

Setup provides a virtualized participant preview; package/settings/assets/
assignment hashes; terminal-language-specific protocol hashes; and a CSV
schedule export. Participant state is one of **Available**, **Active**,
**Partial**, or **Complete**, reconstructed from package-root locks, recovery
journals, and manifests. These are observed states, never editable flags.

### 4. Experiment

- The Designer target authors experiment ID, title, participant count, and
  explicit manual participant IDs/schedules through UI, then compiles them
  into `ExperimentPackageV1`. The Runner consumes them as immutable protocol
  facts. Replacing current read-only/import-based controls belongs to a later
  section pass.
- Participant schedule entries are consecutive `P001` onward in array order,
  using at least three digits and enough zero-padding for the largest ID.
- Continuous rating is always enabled and has no off toggle.
- Sampling frequency is explicitly stored as an integer from 1 through 240 Hz.
  Package authoring initially suggests 130 Hz, but runtime resolution has no
  omitted default.
- There is no single-summary or summary-only rating option.
- The app exposes no global fixed/jitter/continue transition choice. Every
  authored video occurrence declares an integer `isiAfterMs` from 0 through
  3,600,000.

### 5. Input

The closed preset list contains:

- Arrow keys;
- WASD;
- IJKL;
- numpad;
- pointer/trackpad Grid;
- mouse buttons and wheel;
- gamepad D-pad;
- gamepad left stick; and
- gamepad right stick.

Package authoring initially proposes Arrow keys with step size `0.1`; the
runnable package stores the complete binding explicitly. Step applies only to
digital edge presses; operating-system key repeat is ignored. Pointer and
analog presets are continuous/absolute and display step size as **N/A**.

Custom binding asks the researcher to select a direction and then perform the
desired keyboard, mouse, wheel, or gamepad action. It rejects conflicts across
the complete binding set and provides an inert live test before Start.
The package-embedded `InputBindingV1` object is the one binding authority.

The Setup-only feedback-design preview may additionally demonstrate proposed
**Continuous** and **Stepwise** response behavior. The continuous draft may
show a bounded full-span press duration. The stepwise draft uses a custom odd
tile count per axis (3–2001), equal steps either side of a central zero tile,
and an outlined active tile instead of the continuous cursor. Arrow edges move
one tile; changing count snaps to the nearest tile and releases held input.
The saved input step size remains separately reachable under Advanced preview
settings. Stepwise may compare separate physical presses with a bounded
wait-and-repeat hold rule.
This is transient design state only: it does not serialize into
`InputBindingV1`, alter native/browser input authority, change OS-repeat
suppression, enter Start or Run, or produce samples, events, LSL, recovery, or
qualification evidence.

### 6. Visual

The persistent right-hand preview projects current settings and input without
owning research state or sampling time. Its overlay is an in-application,
normalized preview/run feedback position; active v1 does not require a native
transparent desktop overlay.

Visual controls are:

- independent **Grid** and **Flubber** visibility toggles;
- Flubber Size as a percentage of the stage;
- Transparency;
- **Hide Visual Feedback**; and
- normalized draggable overlay position.

**Lock position** is the sole Disable Dragging control. It applies to the same
normalized overlay position and is always forced locked after Run starts. Grid
and Flubber may be shown independently or together. Hiding either or all visual
feedback never stops sampling.

The nested **Flubber** group owns outline enabled, outline thickness, and halo
enabled. The nested **Grid** group owns grid-line thickness, outline enabled,
outline thickness, and cursor size.

The **Color & Gradient** group owns the four directional valence/arousal anchor
colors, idle color, outline color, halo color, and cursor color. Every color has
a color wheel, hexadecimal entry, and reset. This group is the sole halo-color
owner; the Flubber group does not duplicate that field.

The persistent Setup preview may place a bounded **Design preview** editor
around this authoritative v1 projection. Its three-way selector compares
**Flubber**, **2D Grid**, and **Responsive Face** using one shared transient x/y
point. In the Flubber comparison, Flubber remains the foreground element above
its 2D affect-control Grid. Four directional color swatches may open one
color-wheel/hex popover. The Setup preview halo follows the exact animated
Flubber outline and fades to transparent outward. Its transient width control
changes stroke thickness/spread, not geometric scale or offset. A nested
Advanced disclosure may expose the existing Flubber appearance and mapping
controls without duplicating their owner.

The responsive Face is newly and independently drawn as procedural SVG/canvas
geometry. Valence and arousal only pose that drawing from the same x/y snapshot
used by Grid and Flubber. It has no camera, microphone, face tracking,
participant imagery, Photoatlas asset or code, affect inference, upload,
personal-data, or scientific interpretation surface.

Every design-preview addition in the preceding two paragraphs is Setup-only
and non-authoritative. It is not part of `VisualSettingsV1` or
`ResearchSettingsV3`, is never serialized into `ExperimentPackageV1`, and
cannot alter Start, Run feedback, canonical bytes or hashes, sampling,
`animationActive`, records, recovery, LSL, or evidence. Current strict readers
must reject any attempt to place these draft fields in v1. Runtime adoption
requires a future explicit package/settings/input/visual version and its full
cross-runtime, persistence, timing, accessibility, and qualification gates.

### 7. Advanced

#### Outbound LSL

The fields are Enable LSL, state stream name, stream type, marker stream name,
and source ID. LSL is Tauri/Windows-only and outbound. Chrome and Edge preserve
imported values but cannot start a run while Enable LSL is true.

#### Flubber–Affect Mapping

Each mapping is independent and has Min, Max, **Driven By**, Reverse, and a live
preview. The only drivers are `x-axis`, `y-axis`, `angle`, and `radius`.

The following values are package-authoring suggestions only; a runnable package
stores every mapping member explicitly.

| Mapping | Allowed output | Authoring Min | Authoring Max | Authoring driver | Authoring Reverse |
| --- | --- | ---: | ---: | --- | --- |
| Oscillation Frequency | 0–10 Hz | 0.5 | 2.5 | `y-axis` | Off |
| Edge Smoothness | 0–1 | 0 | 1 | `x-axis` | Off |
| Projection Amplitude | 0–1 | 0.2 | 0.4 | `y-axis` | Off |
| Pulse Synchrony | 0–1 | 0.2 | 1 | `x-axis` | Off |
| Wave-size Variation | 0–1 | 0 | 0.8 | `x-axis` | On |
| Saturation | 0–1 | 0 | 1 | `radius` | Off |

Normalize `x-axis` and `y-axis` from `[-1,1]`, radius from `[0,1]`, and angle
from `[0,360)` into `t` in `[0,1]`. Neutral angle is deterministically zero.
When Reverse is enabled, replace `t` with `1-t`; then compute
`lerp(Min, Max, t)`. Min and Max remain within the mapping's allowed output.
All six outputs derive from one authoritative coordinate snapshot and never
become a second affect or timing authority.

### 8. Review & Start

Review shows the complete blocking/non-blocking preflight, resolved participant
schedule, selected language-tree path and terminal language, exact ordered
protocol, explicit playback/output policies, output path, package/settings/
assets/assignment/protocol hashes, input test, asset verification, storage
estimate, sampling/timing status, and Windows LSL status.

The participant chooser shows exactly the four reconstructed states
**Available**, **Active**, **Partial**, and **Complete**. Selecting a completed or
partial participant for another run requires a visible rerun warning and
creates a new attempt; it never overwrites or edits prior evidence.

Immediately before Start, collect these required transient values:

- first name and last name;
- age, integer 1–120;
- gender: Woman (`W`), Man (`M`), Non-binary (`N`), Self-described (`S`), or
  Prefer not to say (`X`); and
- handedness: Left (`L`), Right (`R`), or Ambidextrous (`A`).

Raw names and any self-description are never persisted. Persist only an
uppercase two-grapheme participant code formed from the last extended grapheme
of the first name followed by the first extended grapheme of the last name,
plus age and the enumerated gender/handedness codes.

CSV and TSV are independent authoring choices in the package output policy and
at least one rating format must be selected.
Start is enabled only after every blocking check passes. Start atomically locks
the participant/attempt; freezes exact package bytes/hash, all derived hashes,
terminal language, sequence, playback/output policies, definitions, hooks,
bindings, demographics, verified assets, and normalized geometry; creates
output/recovery ownership; and enters Run.

## Running the Experiment

Run displays only:

- the current complete stimulus with configured adjacent Grid/Flubber feedback,
  one questionnaire form, or one neutral timed interval as mutually exclusive
  protocol stages;
- compact session, stimulus timing, write/recovery, and Windows LSL status;
- **Pause** while a video is active; and
- **Stop Early**.

Setup controls are unavailable. Package bytes, derived hashes, terminal
language, settings, bindings, demographics, verified manual order, protocol
sequence, playback/output policies, and geometry remain frozen for the attempt.
The overlay is locked.

Questionnaire stages use semantic fieldsets/radios, item and module progress,
**Previous**, **Next**, and **Submit**, managed focus, and keyboard-only
operation. Submission validates every required response, derives scores from
the frozen definition, appends immutable response rows plus a completion event,
and advances the safe protocol boundary atomically. Drafts are checkpointed.
No rating samples or regular LSL state samples are emitted during a
questionnaire; only bounded lifecycle markers without prompt or answer content
are permitted.

Sampling runs only while a video is actively playing. On Windows qualified
runs, only Rust-owned GstPlay lifecycle state may establish that fact. After
each video, sampling stops and the affect state resets to neutral. Ordered
`afterStimulus` questionnaire hooks for that `stimulusId` whose
`relativeToIsi` is `before` run next, followed by an explicit interval step for
that occurrence's exact `isiAfterMs`, then hooks whose `relativeToIsi` is
`after`. The interval exists after the final video as well: a terminal nonzero
interval waits fully, while a zero-duration interval records its lifecycle and
advances immediately before any post-ISI hook.
Visual feedback never covers the video; it remains adjacent within the run
stage.

**Stop Early** is controlled termination and finalizes an explicitly partial
attempt. A crash, power loss, forced termination, or storage interruption leaves
the journal as authoritative recovery evidence. Recovery resumes only at a safe
protocol-step boundary. A video that was only partially played restarts from
its beginning; an interrupted interval restarts its full authored duration;
and an active questionnaire restores its last durable draft. Active v1 never
resumes mid-video, resumes partway through an ISI, or fabricates missing time.

Successful completion durably writes the completion receipt and manifest
before releasing the participant lock and returning to Setup.

## Contract family and versioning

The historical closed-world contract families remain readable without
reinterpretation:

- `ResearchSettingsV1`;
- `ResearchSettingsV2`;
- `ResearchSettingsV3` and `ExperimentDefinitionV1`;
- `ResolvedAssignmentPlanV1`;
- `ResolvedExperimentPlanV1`;
- `InputBindingV1`;
- `ResearchSampleV1`;
- `ResearchEventV1` and `ResearchEventV2`;
- questionnaire module V1/V2 and resolved protocol plan V1/V2; and
- `ResearchRunManifestV2`, `ResearchRunManifestV3`, and their matching recovery
  records.

New attempts use one `ExperimentPackageV1` and package-bound resolved receipts.
Compatible unchanged `InputBindingV1`, sample/event, questionnaire-response,
and tabular row meanings may be reused only when every existing field retains
its exact semantics. New package attempts require a strict
`ExperimentPackageRunBindingV1` in their V3 journal context and finalize only
as `ResearchRunManifestV4`, whose package receipt binds the canonical source,
self-hash, package ID, terminal language/path, and asset-binding hash. A stored
package-less transitional V3 attempt remains readable, resumable, and
finalizable only as `ResearchRunManifestV3`; it is never upgraded or presented
as package evidence.
After this candidate contract is frozen, adding or changing package, asset,
terminal-language, after-video-hook, playback-policy, or output-policy identity
requires a new version rather than reinterpretation.

The Setup feedback-design preview does not amend any member or meaning in this
contract family. In particular, its selector, procedural Face, halo-size draft,
and continuous/stepwise timing or hold drafts are not implicit defaults and
must not be encoded through existing Grid/Flubber Boolean combinations,
`stepSize`, unused values, local storage, or another ambient side channel.

Every contract rejects unknown fields, duplicate identifiers or keys,
unsupported versions/algorithms, invalid enums, non-finite or out-of-range
numbers, unsafe paths, excessive sizes/counts/depth, and hash mismatches.

Canonical JSON and SHA-256 bind the package definition with its complete
derived `integrity` member omitted, bind the full canonical file bytes
separately, and bind its settings projection, verified assets, each participant
assignment, and each participant-plus-terminal-language protocol. Every output
binds all applicable hashes and exact stimulus, ISI, language-tree path, hook,
module/item/option, playback, and output-policy identity. Each package attempt
materializes the exact canonical `experiment.package.json` bytes plus its
derived immutable receipts.

Legacy portable settings and external experiment definitions remain unchanged
authoring/import schemas. Questionnaire CSV/TXT/JSON are explicit authoring
representations whose accepted values all pass through canonical Questionnaire
CSV v1. A converter may use them only when it reports every carried/defaulted/
discarded/rejected field and emits a complete canonical package. No local
storage, app data, prior package, OS locale, directory ordering, or platform
default is silently migrated.

## Authority and timing

Tauri Rust owns native input, the configured sampling scheduler, monotonic and
wall timestamps, workspace/persistence, participant/attempt locks, and outbound
LSL.
The WebView receives narrow projections and issues typed root/run commands; it
never receives arbitrary filesystem authority.

Chrome and Edge run the scheduler in a dedicated worker, journal accepted
records in `affect-research/v1`, and use the user-authorized File System Access
root for workspace artifacts. Permission renewal is explicit and cannot silently
switch roots.

`requestAnimationFrame` owns presentation only and never sampling. The
explicit package 1–240 Hz frequency controls continuous rating rows and the
Tauri regular LSL state stream only. Authoring initially proposes 130 Hz but
runtime resolution has no omitted default. A missed deadline produces one
typed timing-gap event. No adapter emits catch-up rows or backfills a later
state under earlier timestamps.

Each row records both LSL-compatible and monotonic timing, anchor age, and
observable jitter/gap context so cadence can be audited rather than inferred.
Each uninterrupted sampling segment schedules its first row one full period
after the authoritative stimulus-start or resume boundary. Scheduler lateness
is the non-negative delay from that row's own deadline; scheduler jitter is the
signed change in lateness from the previous accepted row in the same segment,
and is exactly zero for the segment's first row. `animationActive` is true only
while Flubber is enabled and its acquisition segment is actively playing.

## Outbound LSL

Windows Tauri publishes one regular Float32 state outlet at the configured
sampling frequency and one irregular semantic marker outlet. The regular
channel order is fixed:

1. `current_valence`;
2. `current_arousal`;
3. `target_valence`;
4. `target_arousal`;
5. `radius`;
6. `angle_degrees`;
7. `animation_active`; and
8. `input_active`.

Markers cover bounded lifecycle, stimulus, input-edge, pause/resume, timing-gap,
write/recovery, and completion/partial events. They never contain composed
text, raw names, arbitrary error text, settings JSON, native paths, or video
bytes. LSL is not cloud upload, inbound control, or direct sensor acquisition.

## Workspace, output, and recovery records

Every attempt uses a create-new directory:

```text
outputs/<experiment-id>/<participant-id>/<session-stem>/
```

The session stem is deterministic in shape and includes participant ID,
two-grapheme code, age, gender, handedness, UTC timestamp, and attempt counter,
for example:

```text
P001_EF_A27_GW_HR_20260903T143012482Z_R01
```

Attempt counters and create-new semantics prevent overwrite. Historical
attempts retain the frozen settings snapshot, semantic `events.jsonl`, and
`ResearchRunManifestV2`. Questionnaire-aware attempts additionally write the
frozen protocol plan and selected questionnaire-response tables, and finalize
with `ResearchRunManifestV3`. Both generations include the selected rating
outputs. CSV and TSV serialize the same canonical rows with identical columns,
order, values, and row count; only delimiter escaping differs.

New package attempts additionally retain byte-identical canonical package
bytes and immutable package/settings/assets/assignment/protocol hash receipts,
the selected language-tree path and terminal language, and exact playback and
output policy. `ResearchRunManifestV4` must contain the exact
`experiment.package.json` as an `experimentPackage` output whose digest and
length match both the frozen recovery binding and its strict package receipt.
Workspace audit reparses that package and reproduces the frozen settings,
experiment plan, participant protocol, language route, and asset-binding hash.
A standalone historical V3 manifest is never relabelled as package-backed
evidence.

Tauri appends and flushes to app-owned recovery/output files through atomic
file operations. Chrome/Edge first commits the authoritative journal, then
materializes workspace outputs when permission is available. Full disk, quota,
revoked permission, failed download/write, close, crash, and finalization errors
must retain all accepted evidence for retry. Corrupt journals are isolated and
reported, never silently repaired or discarded.

Every package video is a complete file beneath fixed `assets/stimuli/` and must
match its declared path, SHA-256, byte length, and duration and pass decode
preflight before Start. Missing, extra, linked, or mismatched asset entries
fail closed. Repository/network assets and Experimental YouTube remain
historical or future adapters and are invalid package sources.

Questionnaire source documents are stored separately as content-addressed
authoring assets beneath `assets/questionnaires/<family>/<language>/`. They are
not members of `assets.stimuli`, are not enumerated into the package asset
manifest, and are never reopened as questionnaire authority during Start or
Run.

## Permanent independent-instance reproduction gate

Package acceptance permanently requires a reproduction benchmark, not merely a
one-process round trip. Load the exact same canonical package bytes into two
clean, independently initialized application instances against the same
read-only asset tree. Their application data, browser profile/IndexedDB/
local-storage namespace, caches, and prior selections are isolated and empty.

For every declared participant and every reachable terminal language, compare
the exact package, settings, assets, participant-assignment, and protocol
hashes and the entire ordered resolved step sequence, including language-tree
selection, session/block/after-video questionnaires, each video, and each ISI.
Both instances must re-export bytes identical to the input and to each other.
The benchmark supplies no OS/browser locale, wall clock, RNG, filesystem
enumeration order, prior settings, or ambient storage as resolution input. Any
divergence or undeclared dependency fails the candidate. This is deterministic
conformance evidence only; it does not qualify playback, timing, recovery,
input hardware, LSL, accessibility, or scientific validity.

## Historical lineage boundary

WebXR and native Quest, the mirrored-study program, remote/VDO/BRSP and
Party/Ground Control, direct Polar, Face/Photoatlas, Touch inference, Screen
Calibration, retro/phone/Picture-in-Picture presentation, and non-Windows
experiment runtimes are absent from the active Research product. Minimal
Windows/macOS/Linux no-optional-feature packaging exists only for unsigned
internal Setup/interface evaluation and blocks experiment Start.
Their source, documentation, notices, evidence, and full Git graph are
preserved in
[`GeorgeFejer91/affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
and this repository's history.

Reactivation requires an explicit charter amendment, named authority/data
boundary, schema and platform decision, source/licensing review, new tests, and
qualification on the changed build. Historical evidence cannot qualify a
changed Research runtime.

## Privacy, accessibility, and observability

Active Research stores no raw names, self-described gender text, captured
participant keystrokes, ambient clipboard contents, unrelated application/window names, raw pointer
trajectory, physiology, face/camera data, or remote identifiers. Global native
input, when selected on Windows, is disclosed and records only the bounded
physical controls required by `InputBindingV1`.

An explicit researcher paste into the focused questionnaire table is authorized
authoring input. The editor may consume the paste event's table text, validate
it, and retain the resulting questionnaire content. It must not poll/read the
ambient clipboard, capture unrelated content, or log the pasted payload. This
does not authorize clipboard capture during participant acquisition.

Setup and Run require semantic controls, keyboard operation, visible focus,
non-color-only state, high contrast, reduced-motion support, and polite status
announcements. Hiding visual feedback must not hide safety, write/recovery,
timing, or LSL status and must not create an invisible-control trap.

Visible diagnostics include package, settings, assets, assignment, and protocol
hashes; selected terminal language; participant state and attempt; playback and
output policy; input test; stimulus verification; storage estimate/status;
configured and observed sample timing; journal/write state; and outbound LSL
state. They exclude raw names, arbitrary invalid payloads, native paths,
secrets, and video bytes.

## Active-v1 release claim

The first internal target is `0.4.0-alpha.1`. It is not research-ready or stable
until the exact candidate passes all gates in `30-TESTING-AND-RELEASE.md`,
including:

- strict schema round-trip/rejection/hash/import fixtures, including
  CSV/TXT/JSON questionnaire normalization, source-asset storage, and complete
  selected-language family coverage;
- strict canonical `ExperimentPackageV1` fixtures, self-hash and derived-hash
  parity, fixed asset closure, manual-order preservation, language-tree and all
  hook placements, no participant duplicates, and explicit terminal/
  zero-duration ISIs;
- the permanent two-clean-instance reproduction benchmark for every participant
  and reachable terminal language, including byte-identical re-export and a
  proof that no ambient defaults or storage were read;
- input and mapping goldens;
- CSV/TSV equality, name erasure, no-overwrite, partial/final, quota, crash,
  corrupt-journal, and safe-boundary restart tests;
- separate 30-minute 130 Hz Windows Tauri, visible Chrome, and visible Edge
  runs with observed 129–131 Hz, p95 lateness no greater than two periods,
  input-state p95 no greater than two periods in Tauri and three periods in the
  browser, and zero silent gaps, backfill, or corrupt records;
- independent LSL receiver qualification; and
- adverse visibility, permission, IndexedDB, tab, forced-termination, full-disk,
  LSL, invalid/missing video, and interval tests plus accessibility review.

Windows acceptance additionally requires an integrity-verified packaged
GStreamer runtime, the separately approved and audited native GstPlay actor,
exact
player-to-scheduler lifecycle fencing, and installed-artifact playback, error,
resize/DPI, audio, shutdown, and recovery tests. A staged runtime or successful
build alone is not playback evidence.

Landing this documentation changes no runtime and satisfies none of those
implementation or qualification gates.

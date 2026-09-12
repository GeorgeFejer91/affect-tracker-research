# Research architecture and authority contract

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

This file refines the sole active authority in
[`15-RESEARCH-V1-CHARTER.md`](./15-RESEARCH-V1-CHARTER.md). It describes the
target architecture; it is not evidence that the current implementation
candidate conforms or is qualified. Delivery status belongs in
[`40-ROADMAP.md`](./40-ROADMAP.md).

The charter's 2026-09-11 amendment delegates final-state segment capabilities,
input/output ownership and remaining work to
[`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md). This file retains the
existing v1 contract/mirror map. Explicit schedules, eight accordions, current
geometry and desktop targets are v1 facts; the successor version must implement
the accepted variant/screen/XR direction without reinterpreting those schemas.
References to the current Section 2 pass below are historical scope. Each future
agent follows its assigned catalogue segment and names any affected mirror seam.

## Authority map

The two product functions are **Affect Tracker Designer** in Setting Up and
**Experiment Runner** in Running. Designer controls/table editors collect
researcher choices and compile one finished unified JSON package; Runner reads
that package for acquisition and monitoring. JSON is the final interchange
boundary, never a prerequisite hand-authored document or an exposed master
editor. These functions do not add modes or imply separate executables. The
Section 2 and Segment 3 authoring slices are recorded in the roadmap; Runner
version binding and remaining section work are in `45-FUTURE-AGENT-CHECKLIST.md`.

| Concern | One active authority | Adapters/consumers |
| --- | --- | --- |
| Experiment package | Exact canonical bytes plus verified self-hashed `ExperimentPackageV1` | Package load/author/re-export and explicit legacy importers |
| Settings | Canonical settings projection derived only from the package | Setup authoring form and immutable run projection; never ambient defaults |
| Playback policy | Package-owned exact `complete-video-v1` behavior | Browser/GstPlay/WebView execution backend is a separately frozen capability receipt |
| Input bindings | Explicit package-owned `InputBindingV1` projection | Windows input adapter; Chrome/Edge event and Gamepad adapters |
| Stimulus library | Closed package asset manifest beneath fixed `assets/stimuli/` | Tauri file commands; browser File System Access; no scan-based enrollment |
| Video-order authoring | Canonical hash-bound library and variant design records beside the video folder | Segment 3 editor, CSV/XLSX export, browser workspace and Rust `research_stimulus_order`; never package/Run authority |
| Participant schedule | Pure verification of package-authored manual order into participant assignment receipts | Virtualized preview, schedule CSV, run preparation; never an allocator |
| Language selection | Finite rooted package tree and selected terminal-language path | Setup selection and participant/language protocol resolver; never OS locale |
| Protocol sequence | Pure participant-plus-terminal-language resolver over package order and hooks | Sequence preview, questionnaire/video/interval run routing, recovery |
| Questionnaire definitions | Strict definitions embedded in the package with language/scoring/provenance | Spreadsheet cells/paste and CSV/TXT/JSON adapters through canonical Questionnaire CSV v1, Setup preview, runtime score derivation |
| Questionnaire source library | Content-addressed original authoring bytes beneath `assets/questionnaires/<family>/<language>/` | Workspace adapters and provenance receipts only; never Run authority or part of the stimulus manifest |
| Questionnaire language coverage | Every requested family crossed with every selected study language | Section 2 coverage projection and package-finalization gate; no `und` or locale fallback |
| Questionnaire label repetition draft | Ephemeral Section 2 presentation state | Every-item/5/10 design preview only; no current package, Runner, recovery, hash, or output authority |
| Participant/attempt state | Locks, journals, and immutable schema-compatible manifests | Four-state chooser projection; never editable flags |
| Run lifecycle | One run authority per attempt | Setup Start, Run Pause/Stop Early, recovery |
| Native media | One Windows Rust actor over a pinned bundled GStreamer/GstPlay runtime | Opaque media grants/session IDs and child-window viewport projection |
| Affect state | One bounded current/target x/y engine | Inputs, Grid/Flubber renderer, recorder, Windows LSL |
| Sampling | Run-owned monotonic scheduler | Canonical rows and Windows regular LSL outlet |
| Recording | Canonical typed sample/event/questionnaire-response model plus package-derived hashes | Package output policy, CSV, TSV, `events.jsonl`, manifest, recovery journal |
| Presentation | In-app normalized Grid/Flubber renderer | Persistent Setup preview and adjacent Run feedback; never a clock |
| Setup feedback-design preview | Transient, presentation-only projection over the same preview x/y | Classic Flubber, 2D Grid, and procedural responsive Face comparison; no package, Start, Run, record, or evidence authority |
| LSL | Windows Rust outbound adapter | Regular eight-channel state plus irregular semantic markers |

No UI handler, legacy importer, renderer, WebView, browser video fallback,
ambient storage, OS locale, or LSL adapter creates a second package, experiment
order, settings, language, affect, lifecycle, timestamp, playback, output, or
record authority.

The Setup feedback-design preview is intentionally outside the runtime
authority graph. Its proposed selector, halo size, and continuous/stepwise
timing or hold values remain ephemeral view state and are never merged into the
current canonical settings projection. Its procedural Face is a renderer over
the same transient x/y point, not another affect engine or an inference/data
plane.

## Module topology and composition rules

The desktop source follows one inward dependency direction:

```text
closed contracts and canonical codecs
  -> pure package / protocol / participant domain
  -> workspace / media / input / timing / writer / recovery / LSL services
  -> Windows and Tauri adapters
  -> narrow commands, events, and status snapshots
  -> frontend view-model and presentation modules
```

The application bootstrap is the only composition root. It constructs and
connects services through explicit handles or bounded actor messages. Services
may depend on contracts and pure domain logic, but not on frontend DOM state,
raw Tauri request objects, or another service's private storage. Tauri command
handlers deserialize, authorize, invoke one product operation, and serialize a
safe result; they do not contain protocol or persistence policy.

The frontend mirrors product responsibilities without becoming a second
backend. Workspace, package authoring, experiment summary, questionnaire
authoring, input setup, visual preview, advanced settings, Review, and Run
presentation each expose a small initializer/view-model contract. One shell
coordinates mode and accordion routing. Native and browser runtime adapters
are selected once at bootstrap and satisfy an explicit semantic interface;
components never scatter raw `invoke`, File System Access, IndexedDB, media,
or capability checks.

Module boundaries are enforced by tests and build-time import/source guards:
no circular feature imports, untyped global buses, arbitrary command names,
cross-module mutable singletons, or direct frontend access to native paths,
handles, clocks, writers, players, input services, or LSL outlets. Shared
contracts have one owner; JavaScript/Rust mirrors use canonical fixtures and
differential conformance. A coordinator may sequence modules but cannot absorb
their validation, storage, timing, or lifecycle implementation.

The following mirror map is normative for the Research product. A row may be
split into smaller cohesive files, but responsibilities from different rows may
not be merged into a catch-all controller or runtime module:

| Product boundary | Frontend responsibility | Rust/native responsibility |
|---|---|---|
| Package and contracts | Authoring projections, strict browser reader, validation messages | Canonical parser/compiler, hashes, selected-language/participant projection |
| Workspace and assets | Folder-selection affordances, catalogue projection, preview requests | Opaque workspace authority, closed-tree scan, grants, hashing and decode attestation |
| Protocol and questionnaires | Setup editors and Run-step view models | Authoritative reducer, hook/ISI progression, drafts, submissions and recovery boundary |
| Participant and attempt | Transient form state and status tiles | Code derivation verification, locks, create-new attempt allocation and reconstruction |
| Input | Binding editor and live-test presentation | Device capture, conflict/edge policy, authoritative state and sampling feed |
| Visual feedback | Preview and Run rendering only | Frozen contract validation and evidence binding; no DOM or renderer ownership |
| Desktop layout authoring (P4 successor) | `screen-layout-*` editor/lifecycle; `desktop-layout*` strict profile and full P1/P5 geometry composition | `research_desktop_layout` canonical typed reader and matching geometry; P7 owns full master composition, no Runner authority added |
| Native media | Geometry/status projection through one adapter | GstPlay actor, private file grant, lifecycle, timestamps and child-window adapter |
| Timing and LSL | Read-only health/status projection | Scheduler, monotonic clock, explicit gaps, state outlet and marker lifecycle |
| Output and recovery | Receipts and recovery choices | Journal, tables, snapshots, manifest, atomic promotion and audit |
| Platform bridge | One selected browser/native adapter | Narrow authorized commands/events; no product policy in handlers |

The Segment 3 authoring slice uses `stimulus-order.js` for the library and
historical numeric design reader, `variant-design.js` for the successor named
ISI/occurrence contract, `stimulus-order-editor.js` for DOM presentation, and
`stimulus-workbook.js` for bounded XLSX generation. The application composition
injects one operation interface. Browser storage stays in `workspace.js`;
Windows requests pass through the named native bridge and narrow commands to
`research_workspace/stimulus_authoring.rs` and the closed
`research_stimulus_order` domain. Shared canonical JSON and export hashes are
fixed in `test/fixtures/stimulus-order-v1.json`; the named successor's JS/Rust
canonical contract is fixed in `test/fixtures/variant-design-v1.json` and
`research_stimulus_order/variants.rs`. Native exports rebuild bytes
from the owner-scanned library and use the native save picker; no WebView path
or export body is trusted. Workspace identity and generation checks fence
late receipts. An authoring design never changes historical package schemas.
P7 consumes accepted revision/dependency snapshots and owns final composition.
`planned-marker-contract.js` and `docs/planner-marker-contract-v1.md` define a
bounded expected event profile and reconstruction fixtures; they read no clock,
record no samples and open no outlet. P1's verified duration and future readable
annotation/immutable asset-ID contract remain producer dependencies.

The landed package-run slice realizes that map through these explicit seams:

- `site/src/research/ui-contracts.js` owns the DOM-free Setup/Run vocabulary,
  accordion registry, event names, preset/mapping projections, and storage
  estimate used by both platform bridges. Neither bridge imports the UI
  composition module.
- `site/src/research/ui-view.js` owns declarative Setup/Run markup and contains
  no workspace, storage, IPC, or runtime authority. `app.js` is the presentation
  interaction/composition root and imports that view rather than embedding the
  instrument document;
  `native-bridge.js` and `runtime-bridge.js` are platform compositions, while
  `native-package-protocol.js`, `native-media-controller.js`,
  `native-media-catalogue.js`, and `native-run-media.js` are bounded native
  adapters rather than feature views.
- `research_experiment_package.rs` owns strict package bytes and hashes;
  `research_native_protocol/{compiler,contracts,records,reducer,responses}.rs`
  owns pure package-run domain logic; `{input_mailbox,storage,recovery}.rs`
  owns isolated service/failure domains; `runtime.rs` coordinates those
  services; and `commands.rs` is the path-free serialization boundary.
- `research_native_media/{contracts,state,gst_actor}.rs` owns playback outside
  protocol and persistence. Its Windows renderer and private runtime
  environment remain nested platform adapters with no protocol authority.

The legacy `ResearchRuntime` and browser journal remain isolated compatibility
readers/finalizers for historical manifests. They are not permitted to become
an alternate Start authority for a new package attempt. New functionality goes
into the bounded package-run modules above, not into those compatibility
coordinators.

Only the application bootstrap may select and connect platform adapters. Raw
Tauri `invoke` calls are confined to named frontend native-adapter modules;
feature views receive typed operations instead. Rust command handlers must call
one service operation after authorization. Every new end-to-end feature must
identify its row, add or extend both sides where native authority is required,
and include a boundary-focused unit test plus a cross-boundary contract test.

Files are split by cohesive authority and failure domain rather than by line
count alone. In particular, the native run implementation is factored into
package preparation, protocol reducer, scheduler/input/media coordination,
durable journal/writer, recovery/finalization, and read-only status projection.
The GstPlay actor and its raw-window adapter remain isolated from the protocol
and writer modules. Each unit has focused success, rejection, stale-generation,
failure, and shutdown tests before it is composed end to end.

## Contract family

Historical `ResearchSettingsV1/V2/V3`, `ExperimentDefinitionV1`,
`ResolvedAssignmentPlanV1`, `ResolvedExperimentPlanV1`, questionnaire module
V1/V2, protocol plan V1/V2, `InputBindingV1`, `ResearchSampleV1`,
`ResearchEventV1/V2`, `ResearchRunManifestV2/V3`, and their matching recovery
readers keep their exact meanings. New attempts add `ExperimentPackageV1`,
`ResearchRunManifestV4`, and package-bound resolved receipts. Any journal, protocol, manifest, or recovery
record that adds package, asset, terminal-language, after-video-hook, playback,
or output-policy identity after the candidate freezes receives a new version;
historical fields are never reinterpreted. A new V3 journal reservation
requires `ExperimentPackageRunBindingV1`; stored package-less V3 records remain
readable. Package-backed finalization uses ManifestV4 and its required
`experimentPackage` output and package receipt, while historical package-less
finalization remains ManifestV3.

The package file is `experiment.package.json`, canonical UTF-8 JSON plus one
LF. Its exact root members are `schema`, `version`, `packageId`, `assetRoot`,
`assets`, `languageSelection`, `playback`, `settings`, and `integrity`.
`integrity.packageDefinitionSha256` is its self-hash over the canonical root
with the complete derived `integrity` member omitted;
`canonicalSourceByteSha256` hashes the full canonical file. The integrity block
also carries `settingsSha256`, `assetManifestSha256`,
`experimentPlanSha256`, and `protocolMatrixSha256`. Pure resolution additionally
derives participant-assignment and participant-plus-terminal-language protocol
hashes. Outputs bind every applicable hash and exact stimulus, interval,
language-tree edge, hook, response, playback policy, and output-policy identity.

Readers reject unknown fields and keys, duplicate IDs, unsupported versions or
algorithm tokens, invalid enum/color/path values, non-finite or out-of-range
numbers, excessive counts/depth/bytes, and hash mismatches. A changed meaning
requires a new version or an explicit migration; it never becomes permissive
interpretation.

Old portable settings and external experiment formats remain byte/meaning
compatible with their existing readers. Questionnaire CSV, tab-delimited TXT,
and JSON are explicit authoring representations; TXT and JSON deterministically
adapt into canonical Questionnaire CSV v1 before the existing strict definition
importer. A separately selected authoring importer may contribute to a package
only after showing every carried, defaulted, rejected, and discarded field. It
preserves original-source, canonical-CSV, and definition receipts and writes
one new complete canonical package. No browser storage, Tauri app data, OS
locale, prior package, or platform default is automatically merged.

## Setup composition

One Setup shell owns only the exact eight-accordion order, single-open state,
session-local reviewed-section set, status summary, and Start orchestration.
Each accordion exposes one bottom confirmation action; its pure UI transition
adds that section to the reviewed set, collapses it, and selects the next
ordered section or no section after the eighth. Readiness projections never
write this set, and the set never enters storage, platform bridges, packages,
hashes, preflight, Start, Run, records, recovery, LSL, or evidence. Each
accordion keeps a narrow owner:

`setup-accordion-motion.js` owns only the reversible grid-track presentation
transition, immediate inert/ARIA state, transition cancellation/settlement,
and reduced-motion fallback. Header toggles do not mutate the reviewed-section
set. Once reviewed, the confirmation control is a disabled receipt rather than
a second transition into review state.

1. Workspace & Libraries — package-root authorization, fixed
   `assets/stimuli/`/`assets/questionnaires/`/output/recovery creation,
   explicit asset import/rescan, package load/re-export, and reported legacy
   authoring import;
2. Languages & Study Assets — compact study-language selection, questionnaire
   family controls, one disclosure and spreadsheet editor per family/language,
   separate visible labels and recorded values, response settings, optional
   CSV/TXT/JSON imports/templates, content-addressed source storage, and exact
   coverage. New modules use `beforeSession`; MAIA-2/TAS-20 English/German are
   the preset focus. Label-repetition preview is separate from package state;
3. Experiment Plan & Stimuli — closed asset manifest, strict manual schedule,
   exact order/ISI preview, media verification, playback policy, and asset/
   assignment hashes;
4. Experiment — package-defined identity, participant range, continuous-rating
   assertion, and explicit sample rate;
5. Input — presets, custom capture, conflict validation, live test;
6. Visual — normalized overlay, Grid/Flubber visibility and geometry, colors;
7. Advanced — outbound LSL fields and six independent affect mappings; and
8. Review & Start — aggregate preflight, language path, derived participant/
   demographic data, package-owned output policy, lock/reservation, and atomic
   mode transition.

The Visual presentation may contain one nested, clearly labelled design-preview
surface comparing Flubber, Grid, and a procedural responsive Face. It may also
preview centered halo sizing and proposed input-response controls. This nested
surface remains part of Setup rather than a ninth accordion or third mode, and
its transient model must be structurally separate from the current settings
authoring model so package creation cannot accidentally serialize it.

The persistent preview receives immutable projected settings and affect state.
It cannot mutate a run, sample from animation frames, or act as a native
transparent overlay. One normalized overlay position is shared between Setup
preview and Run feedback. Lock position is the sole drag-disable owner and is
forced true once Run starts.

## Workspace and media boundary

One selected experiment-package root contains the canonical package file,
fixed `assets/stimuli/`, `assets/questionnaires/`, `outputs/`, and `recovery/`.
All generated paths are descendants of that root and are constructed from
validated bounded identifiers; the WebView never supplies or receives an
arbitrary native path. The declared stimulus manifest—not a scan—owns the
permitted scientific video files. Original questionnaire authoring sources are
stored by source digest beneath validated
`assets/questionnaires/<family>/<language>/` descendants and never become
members of that runtime manifest.

Tauri Rust owns root selection, safe child creation, staged copy/import,
recursive rescan, streaming hashes, media probes, create-new output ownership,
locks, and atomic file finalization behind narrow typed root/run commands.
The target native package loader accepts no WebView path: it opens the native
JSON picker, applies package size/encoding/canonical-byte/self-hash/reference
limits, and returns only a path-free package receipt plus derived hashes. The
current `research_load_experiment_package` and
`research_save_experiment_package` implement the path-free picker/writer and
structural/hash validation slice. Start admission must additionally require
exact source/canonical-byte equality and complete Rust plan/protocol hash
recomputation. The older `research_load_experiment`/`LoadedExperimentReceipt`
remains transitional legacy authoring/import support. Neither current native
path authorizes a package run.

`librariesReady` is a live capability result for the selected package root and
its fixed asset/output/recovery locations, never a proxy for app-data
initialization. Initial root selection may create missing owned directories;
later scans and privileged operations revalidate the selected root plus every
exact canonical child, compare the recorded directory identity, and fail
closed rather than recreate a removed or replaced library. Storage readiness
performs durable create/write/sync/read/delete probes in both `recovery/` and a
temporary nested
`outputs/<experiment>/<participant>/<session>/` hierarchy, returning only
counts and booleans. Probe cleanup is part of readiness: an undeletable probe
or temporary hierarchy fails the capability rather than leaving a successful
readiness result.

Run creation separately walks the real `outputs/<experiment-id>/<participant-id>`
chain one component at a time. Every existing or newly created component must
be an ordinary directory and the exact canonical child of its validated parent.
The native runtime snapshots directory identity, revalidates after acquiring the
participant attempt lock, and validates the create-new session directory before
opening any scientific output. A pre-existing file, link/junction, same-path
replacement, or session collision fails closed.

This boundary uses safe standard-library path and metadata operations. Unix
uses device/inode identity. Stable safe Rust does not expose the Windows file
index, so Windows same-path replacement detection additionally uses directory
creation time; canonicalization rejects ordinary symlink/junction redirection,
but this is not a claim of race-free defense against adversarial reparse-point
replacement between validation and a later path operation.

### Windows native-media boundary

Qualified declared package-asset playback uses only the packaged GStreamer 1.28.6
MSVC x86_64 tree described by
`src-tauri/native-media/gstreamer-runtime-v1.json`. The app does not search
ambient plugin/install paths or the network.
The build/runtime verifier rejects an absent, unexpected, modified, symlinked,
Windows reparse-point/junction, or wrong-architecture tree before descending
through it. Staging preserves the applicable upstream notices and generates a
complete file-hash manifest. Safe metadata checks reject ordinary reparse
trees; they do not claim hostile swap-race elimination without handle-relative
Windows APIs.

The native media service is one serialized Rust actor. Before Prepare, the
workspace service revalidates the opaque stimulus identity, hash, byte length,
duration/decode evidence, and root generation; only then may it resolve a path
inside Rust. The actor owns one GLib context/loop, GstPlay instance, explicit
video sink, signal adapter, application child window, and deterministic
teardown.
The WebView receives no path or native handle. It exchanges a bounded media
session ID, playback commands, status, and a validated stage rectangle used to
position the child window.

The actor translates native Playing, Paused, Buffering, Ended, Error, and
teardown events into the run lifecycle before projecting UI status. Playing may
open a sampling segment only after the exact grant is prepared. Every other
non-playing state fences the sampler first; actor loss is a run failure with a
durable recovery boundary. Callback messages are bounded and generation-
fenced so stale media/player callbacks cannot affect a later attempt.

Project-authored `unsafe` is restricted to two Windows FFI adapters under
`research_native_media/gst_actor/`: `runtime_environment.rs` owns private DLL-
search activation/removal, and `windows_renderer.rs` owns raw child-window and
GstPlay overlay calls. The researcher approved these contained boundaries on
2026-09-10. Both document validated-handle lifetime, exact-once teardown,
actor-thread affinity, callback-after-teardown prevention, and
no-panic-across-FFI invariants. Crate lints and a recursive source allowlist
reject undocumented blocks or unsafe code in every other module. Landing these
adapters is software evidence only:
the capability service may report an actor ready after exact runtime
verification, while `qualifiedStartAvailable` and package Start remain false
until the installed runtime, redistribution, codec/decode, lifecycle, physical
input, timing, recovery, and workflow gates produce commit-bound receipts.

`unqualifiedWebview` is a separately chosen development path, never an
automatic fallback. Its receipt, journal, events, and manifest remain labelled
unqualified. A WebView media failure is still reported to Rust and fences the
native sampling/run authority.

The unqualified desktop preflight uses the shared complete-video probe and
requires `requestVideoFrameCallback` evidence at the deterministic near-start,
midpoint, and near-end positions. Rust records the evidence separately as
`representativeFramesV1`, backend `webviewVideoFrameCallback`, and status
`attestedUnqualified`; no generic “verified” decode state can be mistaken for
future qualified GstPlay evidence. Rust consumes the opaque probe grant before
accepting or rejecting each terminal attestation request, while the renderer
requests explicit revocation when probing fails before attestation. Final
identity is rehashed from the same Rust-held locked file handle. This remains
a lower-trust WebView attestation and is not native playback qualification.

During an explicit unqualified desktop run, every renderer lifecycle command
is bound to the native UUID run ID, participant/attempt receipt, frozen hashes,
and a fresh per-stimulus video-element generation. Replacing the video element
for each source prevents delayed events from a detached prior source from being
relabeled. Native status projection is suppressed while a lifecycle IPC is in
flight and is ordered by local revision/request sequence. Rust independently
requires a Completed timestamp within one second of the exact preflighted end.
If neither a recovery interruption nor terminal receipt can be confirmed, the
renderer labels the outcome unknown, disables further run controls, and
requires restart; it never presents an unconfirmed stop as complete or partial.

Chrome and Edge obtain one File System Access directory handle in a secure
context from an immediate user activation. They retain the handle only through
browser-managed storage, surface permission loss, renew access through another
explicit gesture, and never substitute a different root. IndexedDB/storage
uses the isolated namespace `affect-research/v1` for locks, package/asset/
assignment/protocol receipts, journals, and recovery metadata. Those receipts
may cache verified results but never supply a missing package field or prior
language choice.

Package v1 accepts complete local videos only. Before Start, match every exact
file beneath `assets/stimuli/` to the declared closed manifest, probe full
duration, and prove decode readiness. Repository assets and Experimental
YouTube remain historical/future adapters and cannot satisfy package preflight.

## Experiment package and schedule architecture

The Start-authority package reader accepts bounded UTF-8 canonical JSON without
BOM, rejects duplicate keys before ordinary parsing, validates the entire
closed-world `ExperimentPackageV1` graph, recomputes the self-hash with the
whole `integrity` member omitted, and verifies that reserialization plus one LF
is byte-identical to the input. A noncanonical or partially authored document
may enter only through a separate authoring converter.

The package contains canonical `P001…PN` schedules in array order, unique asset
and block registries, exact per-participant block/video arrays, and one integer
`isiAfterMs` on every video occurrence. It also contains every run setting,
surface playback token, language-tree node/edge/terminal, embedded
questionnaire definition/hook, and output choice. The validator rejects
unknown references, missing/repeated blocks, participant gaps,
within-participant stimulus repeats, unused/extra assets, unsafe paths,
incomplete language variants, cycles, and non-integer/out-of-range intervals.
It never sorts or defaults an authored array.

The resolver receives only validated package bytes plus the exact verified
asset closure. It substitutes no source and makes no allocation or language
choice. Pure projections retain every order/position/ISI and produce immutable
settings, assets, participant-assignment, and participant-plus-terminal-
language protocol hashes. The schedule CSV is a view of package authority, not
a randomizer.

The package playback object owns exact `complete-video-v1` behavior. The
settings projection owns experiment/acquisition, input, visual, advanced/LSL,
and output sections. The assets projection owns the complete
declared and verified path/hash/length/duration closure. Assignment owns one
participant's exact block/video/ISI arrays. Protocol owns that assignment plus
the complete selected language path, terminal language, referenced definition
hashes, hook order/targets, and typed steps. Projection membership is fixed by
the package schema and cannot be caller-selected.

Run preparation atomically reserves one participant/attempt against the exact
experiment and workspace. Locks, journals, and manifests reconstruct
Available, Active, Partial, and Complete. Reruns allocate a new attempt counter
and retain all earlier evidence.

## Language, questionnaire, and protocol architecture

The Section 2 table model is a bounded authoring adapter. It owns editable
questionnaire metadata, ordered item prompts, explicit required flags, ordered
visible option labels, and per-item numeric recorded values. Spreadsheet paste
uses only the explicit event on a focused editor; it validates one bounded
rectangular text block before changing cells, preserves row/column order, and
never reads the ambient clipboard, evaluates spreadsheet formulas, or logs
source payloads. Validation errors identify the item/cell without leaking
unrelated content. File import populates the same authoring model.

Visible labels, stable option IDs, and numeric codes remain distinct definition
fields. The editor's recorded code maps to the existing nullable `scoreValue`;
it does not introduce a second numeric response-value field. Reverse coding is
an explicit per-option `scoreValue` choice, never an inferred instrument rule
or a display-label rewrite. Existing supplied scoring,
subscale, and attribution metadata must be preserved unless the researcher
explicitly changes the owning field. The existing definition represents a
single selected option per item; a configurable option count does not widen it
to multi-select.

Each requested family/language pair has its own accordion and table model.
The view can add a missing variant, but neither importing one language nor
changing the language selection synthesizes translation content. Canonical
definition creation goes through the existing strict Questionnaire CSV v1
boundary and package finalization remains the only package owner. A new
Section 2 module uses `beforeSession`; imported modules with other placements
retain their exact contract and must not be silently rewritten.

The label-repetition control previews above-every-item/every-5/every-10 layout
from separate transient state. Current package/questionnaire contracts have no
such field. Persisting and running the preference requires a future versioned
contract, browser/Rust parity, renderer support, reproduction and recovery
evidence. Do not encode it through unrelated existing members or ambient
storage. Runner implementation is outside this pass.

The questionnaire authoring adapter accepts one bounded strict UTF-8 CSV,
tab-delimited TXT, or JSON byte stream selected by explicit extension/type; it
does not guess from content. CSV requires the exact `questionnaire-csv-v1`
14-column header. TXT requires `questionnaire-txt-v1` and the same
tab-delimited columns. JSON requires the exact closed
`questionnaire-json-v1` root/item/option shape and rejects duplicate keys. TXT
and JSON deterministically produce canonical Questionnaire CSV v1 bytes, then
all three formats pass through the same strict importer.

One canonical row is one allowed single-choice option. The importer creates a
`QuestionnaireDefinitionV1` only after checking consistent repeated metadata,
contiguous item rows, unique item and option IDs, explicit required flags,
finite-or-blank scores, safe text, and all size limits. Original-source,
canonical-CSV, and definition hashes remain distinct in authoring receipts.
The workspace service stores the original bytes by digest at
`assets/questionnaires/<family>/<language>/<sha256>.<format>`, verifies existing
content on idempotent reuse, and returns only a bounded relative receipt. The
WebView never supplies an arbitrary native path. Runtime score/label authority
comes from the embedded frozen definition; no authoring source is opened during
Start or Run.

The package language-tree owner validates one root, ordered choice edges,
acyclic reachability, unique terminal language tags, and each terminal's exact
ordered `questionnaireModuleIds`. Every module is mapped by at least one
terminal, and each mapped definition is language-compatible. Selecting a
terminal language freezes the exact path and module list. There is no
OS-locale, browser-locale, storage, definition-language filtering, or
first-definition fallback.

Before authoring may finalize a new package, the Section 2 coverage owner forms
the Cartesian product of requested questionnaire families and selected study
languages. Every pair must resolve to an exact-language definition and module;
`und` does not satisfy this authoring obligation. Missing pairs remain visible
blockers. Family identity and language selection are bounded canonical values,
and a source upload cannot silently add, remove, or translate a study language.

The Section 2 view projects language controls, family/language accordions,
editable tables, compact response settings, upload/template actions, and
coverage. MAIA-2 and TAS-20 English/German are the preset focus; only authorized
MAIA text is bundled. TAS slots require supplied assets and applicable reuse
evidence. The wider Inspiration/Phenomenological Control UI is deferred. The
view never renders or accepts raw master package JSON, and the package
finalizer owns language-tree construction and definition embedding. Fixed
demographics and their privacy contract remain unchanged; localization is
tracked outside this pass.

The Setup language controller replays only an ordered option-ID path through
the validated package tree. It has no flattened route selector and package
loading does not call a first-route default. Its context key binds package
canonical-byte/self hashes, participant, state, disposition, and recovery
attempt identity. A recoverable journal may project `__recoveryBinding` with
only those public identities plus terminal path and assignment hash; the UI
validates it against the currently loaded package before compiling the frozen
participant route. Source bytes, asset paths, workspace identity, demographics,
answers, and samples never enter that projection.

Package questionnaire modules own stable IDs, ordered hooks, targets, and
embedded language-tagged definitions. Session hooks wrap the whole manual
schedule; block hooks bind `blockId`; user-visible after-video hooks use wire
kind `afterStimulus`, bind `stimulusId`, and set `relativeToIsi` explicitly to
`before` or `after`; same-hook and same-side module order is significant.
Resolution retains exactly the selected terminal's declared module list and
its bound definitions; language tags validate compatibility but never select
or reorder modules implicitly.

For each participant and each terminal language, the pure protocol resolver
binds package/settings/assets/assignment hashes, participant ID, language path,
exact manual block order, and a flat sequence. It emits before-session hooks;
before-block hooks; each video followed by its pre-ISI after-video hooks,
explicit interval, and post-ISI after-video hooks; after-block hooks; and
after-session hooks. Each interval contains exactly that occurrence's
`isiAfterMs`, including zero and the final video's value. The resolver never
randomizes, changes order, or consults ambient state.

Questionnaire drafts are bounded recovery state, not submitted evidence. A
submit transaction validates every required item, appends immutable
`QuestionnaireResponseV1` rows and one `ResearchEventV2` completion event, and
advances `safeProtocolStepPosition` atomically. Stop Early retains submitted
rows and labels the current draft as draft evidence. Sampling/rating input and
regular LSL state are closed for every questionnaire step.

## Participant derivation boundary

Review receives transient first name, last name, age, gender choice, and
handedness choice. It validates age 1–120 and the closed gender/handedness enums.
The derivation owner uses Unicode extended grapheme clusters, takes the last
first-name grapheme plus first last-name grapheme, and uppercases the resulting
two-grapheme code consistently.

Only that code, age, gender code `W/M/N/S/X`, and handedness `L/R/A` enter run
identity/records. Raw names and self-description text are dropped before the
immutable Start input is constructed and must never reach logs, storage,
markers, crash reports, or filenames.

## Input and renderer boundaries

`InputBindingV1` normalizes the closed preset/custom action catalogue. Digital
actions are edge-triggered and ignore OS repeat. Pointer/trackpad Grid and
gamepad sticks supply continuous/absolute values and have no step-size meaning.
Custom capture observes exactly the next allowed physical action, then validates
global conflicts before replacing the binding.

Any continuous full-span duration or stepwise hold-repeat demonstration in the
Setup design preview is a non-authoritative simulator over preview input. It
does not alter `ResearchInputService`, the browser Run adapter, the worker or
native monotonic scheduler, input receipts, mailboxes, events, samples, or
recovery. A future runtime implementation must put movement integration in the
owning monotonic input/run authority rather than animation frames and must ship
as a versioned input/settings/package contract.

On Tauri, one Rust `ResearchInputService` owns Setup capture/testing and Run
input. A fresh input test exercises all four directions and yields a one-use,
15-minute receipt bound to the canonical binding hash and device epoch. Focus,
binding, device, and Setup-state changes invalidate evidence. Keyboard input is
focus-fenced; mouse-button and wheel input are additionally restricted to
native client-coordinate allow-regions for the visible test/capture/feedback
surface. The active safe backend supports digital keyboard, mouse-button, and
wheel bindings plus absolute pointer/trackpad input. A Windows-only, force-
feedback-disabled XInput adapter supplies gamepad D-pad and stick events when
its backend starts; otherwise those presets remain truthfully unavailable.
The first active gamepad is locked for the attempt, stick values use the
declared deadzone/orientation, and disconnect fails the run to its recovery
boundary. None of these presets may fall back to WebView-originated Run input.
Chrome/Edge keep their separate browser-owned pointer and Gamepad adapters.

Native callbacks pass through one dispatch barrier so Pause, Stop, focus, and
sink replacement cannot overtake already accepted input. The Run worker owns a
separate mailbox: digital edges are FIFO-bounded and overflow fails closed;
absolute/analog updates retain only the latest physical state while exposing a
safe-integer coalescing count. Authority loss has priority. The worker drains
accepted input before sampling and before any lifecycle boundary that stops
acquisition. Physical observation time anchors input-to-state latency, while
semantic records remain monotonically ordered at persistence time.
Pause, focus loss, and layout invalidation publish a semantic inactive state
that preserves the current rating coordinates through the same barrier while
retaining held-key signatures until their
physical release, so an OS repeat cannot become a new edge after resume. An
input-origin contract fault may write a recovery interruption; an event,
journal, or LSL persistence fault instead stops write-unhealthy without trying
to append a second event. Interrupt timeouts retain the worker handle and input
authority for a later cleanup attempt rather than detaching a live writer.

The affect engine clamps current and target x/y to `[-1,1]`. Radius and angle
derive from the same snapshot. Mapping drivers normalize x/y, radius, or angle;
Reverse transforms `t` before linear interpolation. The six labels and bounds
are fixed by the charter; its initial values, drivers, and Reverse choices are
authoring suggestions that must be materialized explicitly in the package.

`site/src/math.js` may remain the procedural geometry baseline, but active
mapping parameters come only from the validated package settings projection. Grid/Flubber
visibility, color, geometry, and feedback hiding are presentation state.
Rendering consumes a snapshot and never supplies research timestamps or
samples.

The Setup-only responsive Face follows the same renderer rule. It is
project-authored procedural geometry driven directly by the shared preview x/y
snapshot. It may not load Photoatlas or participant images, acquire camera or
microphone input, track or infer a face or affect, communicate remotely, or
persist personal data. It is never instantiated as Run feedback under the
current contract.

## Run and timing boundary

Start is one fail-closed transition:

1. validate exact canonical package bytes/self-hash, package root and closed
   asset tree, every derived hash/reference/tree edge, manual order, terminal
   language, input, explicit playback/output policy, storage estimate, timing
   support, and platform-specific LSL;
2. derive privacy-safe participant fields and choose a create-new attempt;
3. atomically write the lock/reservation and initial journal;
4. freeze package bytes, full-byte/self/settings/asset/assignment/protocol hashes,
   terminal language/path, settings, verified assets, sequence, bindings,
   demographics, playback/output policies, and geometry; and
5. enter Run only after durable success.

Package finalization writes the byte-identical `experiment.package.json`
snapshot and immutable derived receipts alongside event, rating,
questionnaire-response, and manifest artifacts. Recovery revalidates retained
package bytes, self-hash, assets, and derived hashes before resuming.

Tauri Rust owns its monotonic scheduler and timestamps. Chrome/Edge use a
dedicated worker rather than the window animation loop. The explicitly packaged
integer 1–240 Hz rate drives continuous rating rows and the Windows regular LSL
state stream. Authoring proposes 130 Hz initially but runtime resolution has no
default. A missed slot creates one timing-gap record in the
attempt's applicable semantic-event version. There is no catch-up row,
retrospective timestamp, or later-state backfill.

Sampling runs only during active decoded video playback. For qualified Windows
runs, Rust-owned GstPlay lifecycle is the only playback authority. Pause,
buffering, questionnaire/interval steps, recovery, error, and terminal states
close the active segment. After-video hooks run on their explicitly authored
side of the occurrence's interval. Each interval keeps state neutral and
follows its frozen `isiAfterMs`; it has no random or participant-controlled
branch. Recovery restarts an interrupted interval from its beginning.

Every sample records wall and monotonic timestamps, LSL-compatible timestamp,
state-anchor age, nominal rate, observable jitter/gap context, exact stimulus
identity/position, current and target x/y, radius, angle, six mapped values,
and input/feedback state.

## Independent-instance reproduction architecture

The permanent conformance harness treats package bytes and the declared
read-only asset tree as its complete inputs. It initializes two application
instances with distinct empty app-data/browser profiles, IndexedDB/local-
storage namespaces, caches, and process state. It must not seed a locale,
clock, RNG, prior settings, remembered package, directory order, or capability
result into resolution.

Each instance validates and re-exports the package independently, verifies the
same closed asset manifest, and enumerates the Cartesian product of every
participant and every reachable terminal language. For each pair it emits a
bounded reproduction receipt containing the full canonical package-byte hash,
selected settings hash, asset-manifest hash, participant-specific assignment
hash, participant/language protocol-plan hash, and the exact ordered typed step
sequence. The comparison owner
requires both instance receipts and exported bytes to be exactly equal to one
another and the exports to equal the original bytes. The harness fails on a
missing pair, divergent order/hash/byte, undeclared file/default/storage read,
or platform-specific normalization. It never writes a passing receipt by
copying one instance's results into the other.

This harness proves deterministic package resolution only. Native media/input/
persistence/LSL availability remains an independently observed preflight and
qualification boundary. The Rust package protocol, actor, and approved renderer
are implemented, but current Windows `nativeGstPlay` Start continues to fail
closed until the installed-runtime, redistribution, format/decode, physical,
timing, recovery, and complete-workflow gates pass.

## Recording, output, and recovery

The recorder owns one typed row sequence. CSV and TSV serialize identical
columns, order, values, and row counts; only delimiter escaping differs. The
package output policy selects them independently and requires at least one
rating format; mandatory package snapshot, events, manifest, and recovery
evidence cannot be disabled.

Output directories have this create-new shape:

```text
outputs/<experiment-id>/<participant-id>/<session-stem>/
```

The stem contains participant ID, two-grapheme code, age, gender, handedness,
UTC timestamp, and attempt counter, for example
`P001_EF_A27_GW_HR_20260903T143012482Z_R01`. No operation overwrites an existing
attempt directory.

Historical attempts retain the frozen settings snapshot, semantic
`events.jsonl`, `ResearchRunManifestV2`, and selected rating files.
Questionnaire-aware attempts additionally contain the frozen protocol plan and
selected `questionnaire-responses.csv`/`.tsv` files and finalize with
`ResearchRunManifestV3`. A package-backed V3 journal additionally requires the
`experimentPackage` artifact and recovery binding and binds
full-byte/self/settings/asset/assignment/protocol hashes; selected
terminal language/tree path; participant/attempt identity; exact stimuli,
hooks, ISIs, and playback/output policies; module status; submitted and draft
response counts/digests; timing summary; output digests; recovery lineage;
completion/partial state; and build/platform identity. Such an attempt
finalizes with strict `ResearchRunManifestV4`, never ManifestV3.

Tauri appends accepted evidence and flushes at bounded time/lifecycle boundaries
before atomic finalization. The browser commits accepted event/sample/response
batches to
its IndexedDB journal before materializing workspace files. Permission loss,
quota/full disk, write failure, forced termination, or finalization failure
retains the journal/partial record for explicit retry.

Recovery validates the journal and resumes only at a safe protocol boundary. A
partially played video restarts at its beginning; an active questionnaire
restores only its last durable draft. Corrupt journals are isolated
with actionable status; they are never silently repaired, skipped, or called
complete. Stop Early uses the same durable terminal path with partial status.
Completion receipt/manifest durability precedes lock release and return to
Setup.

Terminal finalization is a retryable transaction. Its immutable outcome,
playback provenance, complete terminal event, and durable file-prefix lengths
are recorded before create-new promotion. A retry may repair only bytes beyond
the last durable prefix and must verify already-promoted files byte-for-byte;
shorter evidence, changed provenance, or a conflicting final artifact is
quarantined. After reload, Setup exposes a dedicated pending-finalization action
that calls the Rust finalize-only command before demographics, input, timing,
media, storage, or playback gates and does not start acquisition. Ordinary
Tauri Setup initialization still performs its normal workspace rescan/WebView
attestation and input-status polling before that action is selected.
If a crash leaves `manifest.json` as any exact byte prefix of the frozen
canonical pending manifest, reload may append only the exact remaining suffix,
sync it, and verify complete identity. A divergent byte is never overwritten and
the recovery remains quarantined.

## Outbound LSL boundary

LSL is an outbound Windows adapter over the exact run sample/event streams. It
is not inbound control, sensor acquisition, browser capability, or cloud upload.
Enable/name/type/source settings are validated before Start.

The regular Float32 stream runs at the configured research rate with the fixed
ordered channels `current_valence`, `current_arousal`, `target_valence`,
`target_arousal`, `radius`, `angle_degrees`, `animation_active`, and
`input_active`. The irregular marker stream projects only bounded semantic
lifecycle, stimulus, questionnaire, input-edge, pause/resume, timing-gap,
write/recovery, and terminal events. It excludes questionnaire prompts and
answers, raw names, composed characters, arbitrary error text, settings bodies,
native paths, and video data.

## Historical source boundary

Superseded WebXR/Quest, remote/VDO/BRSP, Face/Photoatlas, direct Polar, Touch,
Ground Control/Party, calibration, retro/phone presentation, and non-Windows
experiment-runtime source is not part of the active tree or artifact closure. It remains
recoverable from Playground and Git history only. Build verification must fail
if those surfaces, assets, routes, permissions, or dependencies re-enter an
active Research artifact without an explicit charter change.

The authorized Setup design-preview Face is not a restoration of that
superseded source family. Build guards may allow only the specifically bounded
project-authored procedural preview module and must continue to reject legacy
Face/Photoatlas assets, routes, permissions, dependencies, and runtime code.

## Platform expectations

- Package and qualify Tauri on Windows first. Retain the bundle ID while using
  the new product/data namespace. A qualified package contains the exact pinned
  GStreamer runtime and approved native actor; package integrity alone does not
  prove playback behavior.
- Qualify desktop Chrome and Edge independently, including File System Access,
  permission renewal, worker timing, IndexedDB recovery, video playback, and
  offline behavior.
- Do not claim macOS, Linux, Firefox, Safari, mobile, WebXR, Quest, or direct
  physiology support.
- Host-native Windows/macOS/Linux packages are manual, unsigned, internal
  Setup/interface-evaluation artifacts only. They build with no optional
  features, exclude the GStreamer runtime, expose unavailable run capabilities,
  block experiment Start, and bind their exact artifact hash to provenance with
  every qualification field false.
- Signing, public installer/release publication, and production credentials
  remain separately authorized actions.

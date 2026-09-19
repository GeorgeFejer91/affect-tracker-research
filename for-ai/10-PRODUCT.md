# Product authority

Consolidated from the former `10-PRODUCT-REQUIREMENTS.md`,
`15-RESEARCH-V1-CHARTER.md` and `16-COMPANION-APP-BOUNDARY.md`. This is the
single current statement of what the product is; there are no dated amendments
left to reconcile. Scope, non-goals and honest capability boundaries are
summarised in [`00-READ-FIRST.md`](./00-READ-FIRST.md) §1 — this file holds the
detail.

## Supported delivery surfaces

Qualify these surfaces first and only:

| Surface | Active role | Capability boundary |
| --- | --- | --- |
| Tauri on Windows | Setup and Run, workspace ownership, native input, durable records, sampling clock, and outbound LSL | Rust authority behind narrow typed commands; packaged Windows/WebView2 evidence required |
| Static web in desktop Google Chrome | Setup and Run using a user-authorized workspace root and a browser-local journal | Current stable desktop Chrome against the exact static/deployed build |
| Static web in desktop Microsoft Edge | Same browser contract, qualified separately | Current stable desktop Edge against the exact static/deployed build |
| Unsigned Tauri on macOS ARM64/x64 | Internal Setup/interface evaluation only | Experiment Start fails closed; no native input, timing, persistence, recovery, LSL, or research qualification |
| Unsigned Tauri on Linux x64 | Internal Setup/interface evaluation only | Experiment Start fails closed; DEB/AppImage packaging is not a supported run surface |

The downloadable unsigned Windows x64 alpha currently follows the same
interface-only boundary as macOS/Linux. The first row describes the Windows
qualification target, not current package evidence.

The browser has no LSL or native/global-input authority. macOS and Linux
experiment runs, Firefox, Safari, mobile, WebXR and native Quest are not
support targets. The static application may be served by GitHub Pages but must
not require a backend, account, CDN, remote runtime asset, or silent
third-party API.

Video playback on every surface is the WebView/browser `HTMLVideoElement`
reading checked `research-media` URLs. The application never downloads media at
runtime, never searches ambient plugin or installation paths, and never accepts
an ambient system codec pack as a declared dependency. Missing, modified,
extra, symlinked or unreadable declared assets fail closed.

## Product decision

The product has exactly two user-visible application modes:

1. **Setting Up the Experiment**; and
2. **Running the Experiment**.

These modes provide two companion functions. The **Experiment Planner** in
Setting Up lets researchers choose experiment settings, define a video
library/manual plan, and design questionnaires through user-facing controls.
Its primary final output is one unified JSON file containing all relevant
parameters needed to run the experiment. The **Experiment Runner** in Running
accepts that finished package as its main input and provides acquisition and
monitoring, producing local questionnaire-response/rating tables and evidence
plus the existing optional outbound Windows LSL streams and markers. The later
companion-program amendment requires separate Planner and Runner programs; this
does not add a third experiment mode.

Master JSON is an internal compilation and final output format. The Planner
must not depend on the researcher creating, viewing, or editing JSON. Loading
an existing finished package is optional reuse; external settings/experiment
JSON remain compatibility import paths rather than the normal design workflow.
Planner feature requirements live in [`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md),
Runner requirements in [`65-RUNNER-SEGMENTS.md`](./65-RUNNER-SEGMENTS.md), and
supported saved-file generations in [`66-COMPATIBILITY.md`](./66-COMPATIBILITY.md).

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
[browser contract](../experiment-planner/web/src/research/experiment-package.js),
[Rust mirror](../native/src/research_experiment_package.rs), and
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
platform receipt: the browser path records `browserMediaAdapters`, the desktop
WebView path records `unqualifiedWebview`. `legacyNativePlayer` is a retired
value that older saved journals may still contain; it is readable but can no
longer be selected, and no run may be started with it. There is no automatic
fallback between backends. Playback evidence is display-onset agnostic: the
Runner records the observed `playing` and `ended` transitions, not a measured
physical onset.

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

## Ownership and sharing

| Concern | Planner | Runner | Shared seam |
| --- | --- | --- | --- |
| Study/media | Author identity, verified declarations | Authorize actual media root and verify all declared files | Versioned identity/path/hash/length/duration/geometry contract |
| Order | Exact variants, named ISIs, occurrences and expected events | Participant allocation and frozen selection; execute exact order | Recipe definitions and selected-version run receipt |
| Feedback/input | Saved bindings, style/mappings; transient Flubber preview | Apply saved bindings/feedback to acquired state | Pure validators, renderer mathematics, explicitly versioned settings |
| Layout | Declare screen reference, units, placement/fit, optional target | Validate actual screen capability and render exact layout | Complete typed profile; unsupported semantics reject |
| Questionnaires | Full definitions, labels/codes, routes and placements | Participant route choice, presentation, durable answers | Complete language/definition/protocol contracts |
| LSL output | Authored stream metadata and expected event contract | Emit actual samples/markers | Frozen outbound contract; never invent timestamps in Planner |
| Stream recording | No recording policy or inlet selection | Own and selected external streams, XDF, failure/recovery | Runner session recording receipt, not Planner JSON |
| Persistence | Named recipe save and editable reopen | Immutable recipe copy, attempts, journals, data and recovery | Preserve exact recipe hash/bytes in run evidence |

Sharing pure contract code and rendering math does not combine the applications.
Runner must not import Planner editors, contribution registries or mutable setup
state. Planner must not instantiate an acquisition scheduler, participant player,
outlet or recorder. Native command registration and service construction enforce
this split, not merely hidden buttons. Preview decoding/metadata inspection can
use a narrow media-inspection service; it grants no participant-run authority.

## Recipe handoff and progress claims

P7 owns the complete recipe writer/readers. Do not create a competing Runner
recipe schema or interpret standalone P1–P6 contributions as a finished recipe.
Use strict schema/version dispatch, exact full readers and native validation;
no field picking, defaults from Planner memory, silent downgrade or partial
execution. Versioned successor formats preserve the existing v1 reader.

Each saved run-affecting option needs an explicit field and consumer behavior.
Transient preview position/input, editor state and unapproved simulator drafts
remain outside execution authority. The distinction must be visible and tested;
an implementation gap must not be relabelled as preview-only to omit it.
See [66-COMPATIBILITY.md](66-COMPATIBILITY.md).

The Planner may complete its strict authoring, comprehensive JSON, save/reopen
and independent reconstruction checks while Runner execution is still being
built. Runtime correspondence is assessed later against the exact saved recipe
and capabilities. Reading a valid file is not evidence that its experiment ran.
Native playback remains blocked where its qualification evidence is incomplete.

Runner-only agents use [65-RUNNER-SEGMENTS.md](65-RUNNER-SEGMENTS.md) for
interfaces and evidence. Planner P1–P7 retain their catalogue entries. No ledger overrides the
researcher's instructions.


### User follow-up: Runner controller and browser companions — 2026-09-12

- RR-07 controller override: the researcher may override the Planner's input
  settings for a Runner session. Preserve the original JSON, show original versus
  effective bindings, validate and retest the actual device, freeze/hash the
  override and bind it to attempt/recovery evidence. A changed binding must not
  silently run under the old recipe hash. This pass supplies the override editor;
  native override execution/evidence is a pending Backend Verification item.
- RR-11 Absent-minded professor (future browser app): a QR code opens a GitHub
  Pages companion with one-to-one mirrored control of the entire Runner.
  For now implement only the popup and a clearly labelled preview QR address.
- RR-12 Remote controller (future browser app): a separate QR code opens a
  smartphone/tablet fullscreen 2D affect grid; touch coordinates control Runner
  Flubber. For now implement only its popup and preview QR address.
- Both future connections need explicit target-owned pairing, scoped authority,
  revocation/disconnection behavior, timestamp/input provenance and applicable
  remote skill/charter contracts. The two scopes must not be conflated. No
  listener, live pairing token, remote WebView or hosted page is implemented by
  displaying these static QRs. Reserved /runner/professor/ and /runner/controller/
  Pages destinations are not deployed or claimed to be live.

### Participant/session naming amendment — 2026-09-12

The user explicitly allocates Runner participant selection/retention, per-JSON
output folders and participant prefixes on both LSL stream names. Runner naming v1
and folder identity are specified in ledger 65. These are Runner session behavior;
Planner stores the authored base names and exact recipe. Do not rewrite the JSON,
change stream types/channels/timestamps, or invent undeclared v1 schedules.

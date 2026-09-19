# Affect Research

[Affect Tracker online](https://georgefejer91.github.io/affect-tracker-research/)
is the landing page for the two companion web apps:
[Experiment Planner](https://georgefejer91.github.io/affect-tracker-research/planner/)
and [Experiment Runner](https://georgefejer91.github.io/affect-tracker-research/runner/).
Their permanent routes currently show development status; the separate browser
apps are not implemented by this infrastructure change. The earlier combined
[research prototype](https://georgefejer91.github.io/affect-tracker-research/research.html)
remains accessible. See [the web delivery guide](docs/WEB-DELIVERY.md).

<p align="center">
  <img src="./experiment-planner/web/assets/app-logo.svg" width="160" height="160" alt="Aurora Axis, the Affect Research app logo">
</p>
<p align="center"><sub><strong>Aurora Axis</strong> maps valence left-to-right and arousal bottom-to-top inside the project’s Flubber silhouette.</sub></p>

Affect Research is a local-first instrument for continuous valence–arousal ratings during complete video stimuli. The active product deliberately has two modes: **Setting Up the Experiment** and **Running the Experiment**.

Those modes are served by two companion programs: **Experiment Planner** lets a
researcher choose settings, define the video library/manual plan, and build
questionnaires through UI; its main finished output is one unified experiment
JSON recipe. **Experiment Runner** takes that finished file for acquisition and
monitoring. Researchers are not expected to write or edit master JSON. Current
Planner status is tracked in [the segment catalogue](./for-ai/60-SEGMENT-CATALOGUE.md);
Runner correspondence is tracked in
[the compatibility map](./for-ai/66-COMPATIBILITY.md) and
[Runner requirements](./for-ai/65-RUNNER-SEGMENTS.md).

This repository is the focused Research lineage. The complete feature-rich application and its full Git history are preserved in [`GeorgeFejer91/affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground), with the frozen application deployed at <https://GeorgeFejer91.github.io/affect-tracker-playground/>.

## Reproducibility checkpoint

The immutable feature-rich checkpoint is commit [`34a137d9d6d0f33a8e5ebef6c04bf8bc0219fd86`](https://github.com/GeorgeFejer91/affect-tracker-playground/commit/34a137d9d6d0f33a8e5ebef6c04bf8bc0219fd86), referenced in both repositories by:

- branch [`checkpoint/feature-rich-2026-09-03`](https://github.com/GeorgeFejer91/affect-tracker-playground/tree/checkpoint/feature-rich-2026-09-03)
- annotated tag [`checkpoint-2026-09-03-feature-rich`](https://github.com/GeorgeFejer91/affect-tracker-playground/tree/checkpoint-2026-09-03-feature-rich)

It records 471 passing tests and the exact [Pages CI run](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/33746889634) and [Desktop CI run](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/33746889623). It is a reproducibility checkpoint, not a research-ready release or a physical-device qualification claim.

Playground `main` has exactly one checkpoint descendant: repository-relocation commit [`5d1f5fa3d30f93b3f2797a74b02e1f336acb7bc3`](https://github.com/GeorgeFejer91/affect-tracker-playground/commit/5d1f5fa3d30f93b3f2797a74b02e1f336acb7bc3). The complete later source lineage remains at [`history/post-checkpoint-source-main`](https://github.com/GeorgeFejer91/affect-tracker-playground/tree/history/post-checkpoint-source-main), exact commit [`5df1e5365aacd2e59cd36347d752b003f1af432d`](https://github.com/GeorgeFejer91/affect-tracker-playground/commit/5df1e5365aacd2e59cd36347d752b003f1af432d). Neither descendant changes the checkpoint branch or tag.

## Research v1

The approved target is an ordered, keyboard-accessible Setup instrument with a persistent live preview:

1. Workspace & Libraries
2. Languages & Study Assets
3. Experiment Plan & Stimuli
4. Experiment
5. Controller / Input Device
6. Visual Feedback
7. Advanced
8. Review & Start

Section 2 centers on a compact spreadsheet-like questionnaire editor. Select
study languages, add a questionnaire family, and edit one accordion/table per
language. Paste item prompts and numeric response codes from Excel, edit
participant-visible labels separately, and set option count and required/
optional responses. New questionnaires are placed before the video task. If a questionnaire
family is requested, every selected study language needs its own matching
definition/module before finalization; there is no silent translation or
language fallback.

The Designer target compiles one strict canonical, self-hashed
`experiment.package.json` (`ExperimentPackageV1`) as its final output, and the
Runner loads it as the sole run-defining authority. Existing finished packages
may be loaded for reuse; external JSON imports are compatibility paths, not
the normal design workflow. Scientific randomization decisions remain the
researcher's responsibility. The package explicitly
contains all settings, the serialized `complete-video-v1` playback policy, the
closed asset manifest under fixed `assets/stimuli/`,
complete manual participant/block/video order and each video's `isiAfterMs`, a
finite language-selection tree, embedded questionnaire definitions and
before/after-session, before/after-block, and after-video hooks, input/visual/
LSL configuration, and output policy. Affect Research never shuffles or
rebalances that order and never fills a missing package field from browser/app
storage, OS locale, directory order, time, RNG, or an ambient default.
Loading the package leaves participant language unset. In Review & Start, the
participant follows its prompts from the root to a terminal choice; even a
single-language package requires that explicit step. A compatible interrupted
attempt restores its exact hash-bound route without asking again, while a new
participant, new attempt, cancel, rejected Start, or completion clears it.

The current [`experiment.json` template](./experiment-planner/web/experiment-template.json),
portable settings files, and standardized questionnaire CSV, tab-delimited TXT,
or JSON documents are transitional authoring/import inputs. The three
questionnaire adapters normalize through the canonical 14-column
`questionnaire-csv-v1` contract, preserve source receipts, and embed the
resulting canonical definition in one complete package. The source document
never remains a parallel runtime authority, and raw package JSON stays behind
the UI even during finalization; the user receives the finished file rather
than an editor for its internals. Historical Williams/
cyclic `balanced-v1` plans and current V3 external-experiment records remain
readable in their original schema versions but are not new package contracts.

Researcher-supplied questionnaire source documents are retained as
content-addressed authoring assets beneath
`assets/questionnaires/<family>/<language>/`. That source library is separate
from the closed runtime video manifest beneath `assets/stimuli/`; Run uses the
canonical questionnaire definitions embedded in the package.

The target Run mode freezes exact package bytes/full-byte/self hashes, derived
settings/asset-manifest/participant-assignment/protocol hashes, selected terminal language,
participant code, exact sequence, playback/output policies, bindings, and
overlay geometry. Sampling is independent of rendering,
never invents catch-up rows, and records explicit timing gaps. Outputs are
create-new attempts containing byte-identical package bytes, derived receipts,
semantic events, a compatible manifest, and package-selected CSV and/or TSV
rating/questionnaire tables. The manifest binds every package-derived hash,
terminal language, playback/output policy, exact stimulus identity, hook, and
authored interval. After every video, targeted after-video questionnaires run
on their explicitly authored side of its interval; the final and zero-duration
intervals still have recorded boundaries. Interrupted runs retain authoritative recovery evidence,
restore questionnaire drafts, restart a partially viewed video from the
beginning, and restart an interrupted interval at its full duration.

Package reproducibility has a permanent acceptance benchmark: two clean,
independent application instances load the exact same canonical package bytes
against the same read-only asset tree. For every participant and every
reachable terminal language, they must independently produce identical
package/settings/assets/assignment/protocol hashes and the exact same step
sequence, then re-export bytes identical to the input and each other. The test
forbids ambient defaults, locale, RNG, time, directory order, prior settings,
and shared IndexedDB/local-storage/app-data state. This proves deterministic
resolution only, not playback, timing, recovery, hardware, LSL, accessibility,
or research qualification.

The supported qualification targets for v1 are Windows Tauri and visible
desktop Chrome/Edge. Current Windows/package-asset playback uses checked
`research-media` URLs consumed by the Runner WebView `HTMLVideoElement`; the app
does not bundle or probe native media runtimes. LSL remains a Tauri-only
capability and is not implied by browser/CSV execution.
The package contract accepts only its declared complete videos beneath
`assets/stimuli/`. Repository/network and Experimental YouTube sources are not
accepted by new package runs.

Unsigned host-native Windows x64 NSIS, macOS ARM64/x64 DMG, and Linux x64
DEB/AppImage candidates are available only for internal Setup/interface
evaluation. They build without native media runtimes or optional player
bindings, and research qualification still fails closed before mutation. They are not
research, timing, media, input, recovery, or LSL qualification claims.

The durable product contract is
[`for-ai/10-PRODUCT.md`](./for-ai/10-PRODUCT.md).
Historical architecture and source remain in Playground and Git history, not
in the active Research tree.

### Current implementation status

Branch `research/video-protocol-v1` contains the implementation candidate:
isolated Research-only Pages and desktop build boundaries, strict browser/Rust
historical contracts and canonical hashes, transitional strict external-
experiment resolution, the
two-mode UI, browser worker sampling and recovery persistence, strict
questionnaire CSV/TXT/JSON authoring adapters and protocol subsystem, narrow Tauri workspace/run modules, and a
Rust-owned native input service. On Windows the service exposes keyboard, mouse-button,
wheel, and bounded Pointer Grid input; gamepad D-pad/stick/custom-button presets
become available only when the isolated XInput backend starts successfully.
The package slice includes browser/Rust `ExperimentPackageV1` readers/writers,
canonical fixture/hash validation, a fixed-root asset manifest, language tree,
exact complete-video policy, participant/language compilation, and wire
`afterStimulus` hooks shown as after-video hooks. Its
reproduction test now launches two separate Node resolver processes in fresh
empty profiles with different locale, timezone, directory-order, clock/RNG,
and storage sentinels; guarded ambient clock, RNG, and browser-storage reads
fail the test. It compares every five-hash participant/language receipt and
exact re-export. Browser package-backed runs persist canonical package
bytes/hash, language route, and asset bindings in recovery and emit an audited
`experimentPackage` output
in `ResearchRunManifestV4`; historical package-less V3 manifests remain V3.
The two child processes verify the same closed read-only fixture asset tree as
regular non-link files with exact byte lengths and SHA-256 values, rejecting
undeclared files. This contract-resolver benchmark does not decode those
fixture bytes or launch two installed graphical application profiles. Rust now
reconstructs and verifies the external plan and complete participant/language
protocol matrix. A package-only native compiler, reducer, recovery journal,
atomic run writer, and sampling/input/LSL coordinator remain as backend modules.
The heavyweight native media actor path has been removed; current master JSON
execution uses the HTML-compatible Runner video path with CSV evidence. Public recorded Start
remains fail-closed until the physical qualification gates pass.
These are implementation slices, not playback or research qualification.
Existing standalone experiment/settings/questionnaire files are transitional
authoring/import scaffolding.
Automated tests and builds are
implementation evidence only. They do not establish scheduler performance,
crash durability, LSL interoperability, accessibility, media compatibility, or
physical workflow qualification.

The candidate remains under development. The exact open software and qualification gates are tracked in [`for-ai/00-READ-FIRST.md`](./for-ai/00-READ-FIRST.md) and [`for-ai/30-VERIFICATION.md`](./for-ai/30-VERIFICATION.md). The Pages deployment target is <https://GeorgeFejer91.github.io/affect-tracker-research/>.

### Windows video-player status

The old native SDK/player protocol has been excised from the active build.
The remaining media capability surface reports `html-video-element` /
`research-media`, and playback is handled by the same HTML-compatible video
player used by the browser path, with exact workspace media URLs and CSV output.
Planner save probes workspace videos with ffprobe and writes at most one
deterministic `_converted.mp4` sibling via ffmpeg when conversion is needed.
Existing compatible converted siblings are reused.

HTML video execution is implementation evidence only. It does not by itself
qualify installed timing, LSL/XDF recording, accessibility, recovery durability,
or physical workflow readiness.

### Questionnaire authoring status

Section 2 keeps downloadable [CSV](./experiment-planner/web/questionnaires/questionnaire-template.csv),
[tab-delimited TXT](./experiment-planner/web/questionnaires/questionnaire-template.txt), and
[JSON](./experiment-planner/web/questionnaires/questionnaire-template.json) templates for the
same closed single-choice/Likert questionnaire model as secondary ways to
populate the spreadsheet editor. Direct edits and paste compile through the
same canonical `questionnaire-csv-v1` boundary. Per-language accordions expose
prompts and recorded codes, separate response labels, option count, and
required/optional items. Numeric codes use the existing `scoreValue` field,
including researcher-chosen reverse coding. New editor modules run before the
session; existing other-placement contracts keep their meanings. Unsaved,
invalid, or missing language variants block package finalization.

The preset focus is MAIA-2 and TAS-20 in English and German. Authorized MAIA
assets can preload with exact attribution, translation, and scoring provenance
retained. TAS-20 is a preparation slot requiring supplied authorized files;
its retained English source fixture is excluded from distributions, and no
German asset is supplied. Broad Inspiration/Phenomenological Control controls
are deferred from the simplified section. Public availability or a slot never
grants redistribution rights.

Label repetition above every item, every 5 items, or every 10 items is a
clearly labelled design preview. It is not persisted by current v1 or used by
the Runner; a future versioned contract and participant-renderer pass is
tracked in the checklist. The current Section 2 pass changes no Runner behavior.

The current Chromium external-protocol execution path predates the package
authority and is transitional, not experiment-use evidence. Tauri can load and
strictly validate the same historical `ExperimentDefinitionV1` through a native
picker without receiving a WebView path; separate path-free package load/save
commands validate and re-export `ExperimentPackageV1`. The modular package-only
native runtime is implemented behind a positive capability gate. Public native
Start remains deliberately blocked before mutation until the installed runtime,
media, durability, timing, accessibility, and physical workflow gates pass.

## Local development

Requirements: Node.js 22.12 or newer, pnpm 11, and the Rust toolchain for desktop work.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm serve
```

Open <http://localhost:8000/> for the Chromium surface.

Build and verify the isolated Pages artifact with:

```powershell
pnpm build:pages
```

For the Windows desktop surface:

```powershell
pnpm desktop:dev
```

Build the unsigned internal alpha installer with:

```powershell
$env:AFFECT_RESEARCH_PACKAGE_COMMIT = (git rev-parse --verify HEAD).Trim()
pnpm desktop:bundle
Remove-Item Env:AFFECT_RESEARCH_PACKAGE_COMMIT
```

The desktop bundle no longer stages native media runtimes. Current lightweight
video playback uses checked `research-media` URLs in the WebView. Today,
`pnpm desktop:bundle` deliberately uses `--no-default-features` and produces an
internal evaluation package without research-ready timing, LSL/XDF, or physical
workflow qualification.

The displayed product version is `0.4.0-alpha.1`; it must not be described as stable or research-ready until the automated, timing, recovery, LSL, accessibility, and physical workflow gates in the charter pass.

## CI, deployment, and internal packaging

- Pull requests and pushes to `research/video-protocol-v1` validate the isolated Pages artifact and Windows Tauri candidate. They do not deploy a public site.
- A passing push to `main` deploys only the verified Research Pages artifact to the Research project URL.
- Windows CI runs the Research tests/build plus Rust format, check, test, and clippy gates without staging native media runtimes.
- One manual-only matrix builds an unsigned, interface-only Windows x64 NSIS,
  host-native macOS ARM64/x64 DMGs, and a Linux x64 DEB/AppImage pair. Every
  package excludes native media runtimes and optional player bindings; exact artifact
  provenance marks every qualification claim false, and Start fails closed.

Signing, auto-updates, store submission, stable installers, and any research-ready claim remain out of scope until separately authorized and qualified.

## Privacy and storage

Names are transient and are reduced before persistence to a two-grapheme
participant code: the last grapheme of the first name followed by the first
grapheme of the last name. The selected package root contains canonical package
bytes as `experiment.package.json`, fixed `assets/stimuli/`, `outputs/`, and
`recovery/`, plus content-addressed questionnaire source files beneath
`assets/questionnaires/<family>/<language>/`; legacy authoring
files are not runtime authority. Browser state uses the isolated
`affect-research/v1` namespace only for locks/journals/recovery and cannot fill
package fields. The desktop retains bundle ID
`io.github.georgefejer91.affecttracker` for upgrade continuity while keeping
new Research data under its dedicated namespace; legacy application data is
never imported automatically.

## License

[BSD 3-Clause](./LICENSE)

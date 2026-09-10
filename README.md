# Affect Research

Affect Research is a local-first instrument for continuous valence–arousal ratings during complete video stimuli. The active product deliberately has two modes: **Setting Up the Experiment** and **Running the Experiment**.

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
2. Experiment
3. Experiment Plan & Stimuli
4. Questionnaires & Sequence
5. Controller / Input Device
6. Visual Feedback
7. Advanced
8. Review & Start

Randomization is prepared outside the app. The target Setup workflow loads one
strict canonical, self-hashed `experiment.package.json`
(`ExperimentPackageV1`) file as the sole run-defining authority. It explicitly
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

The current [`experiment.json` template](./site/experiment-template.json),
portable settings files, and questionnaire CSVs are transitional authoring/
import inputs. They must be converted with an explicit report into one complete
package and never remain parallel runtime authorities. Historical Williams/
cyclic `balanced-v1` plans and current V3 external-experiment records remain
readable in their original schema versions but are not new package contracts.

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
desktop Chrome/Edge. Qualified Windows package-asset playback targets the
bundled, repository-pinned GStreamer 1.28.6 MSVC x64 runtime through a
Rust-owned GstPlay actor; the app never downloads native media code or discovers
ambient system plugins. LSL is a Tauri-only capability.
The package contract accepts only its declared complete videos beneath
`assets/stimuli/`. Repository/network and Experimental YouTube sources are not
accepted by new package runs.

Unsigned host-native Windows x64 NSIS, macOS ARM64/x64 DMG, and Linux x64
DEB/AppImage candidates are available only for internal Setup/interface
evaluation. They build without optional features or the unreviewed GStreamer
runtime, and Experiment Start fails closed before mutation. They are not
research, timing, media, input, recovery, or LSL qualification claims.

The durable product contract is
[`for-ai/15-RESEARCH-V1-CHARTER.md`](./for-ai/15-RESEARCH-V1-CHARTER.md).
Historical architecture and source remain in Playground and Git history, not
in the active Research tree.

### Current implementation status

Branch `research/video-protocol-v1` contains the implementation candidate:
isolated Research-only Pages and desktop build boundaries, strict browser/Rust
historical contracts and canonical hashes, transitional strict external-
experiment resolution, the
two-mode UI, browser worker sampling and recovery persistence, a strict
questionnaire CSV/protocol subsystem, narrow Tauri workspace/run modules, and a
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
atomic run writer, sampling/input/LSL coordinator, and GstPlay media actor are
implemented as separate backend modules. Public native package Start remains
fail-closed until the installed runtime and physical qualification gates pass.
These are implementation slices, not playback or research qualification.
Existing standalone experiment/settings/questionnaire files are transitional
authoring/import scaffolding.
Automated tests and builds are
implementation evidence only. They do not establish scheduler performance,
crash durability, LSL interoperability, accessibility, media compatibility, or
physical workflow qualification.

The candidate remains under development. The exact open software and qualification gates are tracked in [`for-ai/40-ROADMAP.md`](./for-ai/40-ROADMAP.md) and [`for-ai/30-TESTING-AND-RELEASE.md`](./for-ai/30-TESTING-AND-RELEASE.md). The Pages deployment target is <https://GeorgeFejer91.github.io/affect-tracker-research/>.

### Windows native-player status

The native-media source implementation is present: an exact GStreamer installer
and runtime-tree pin, deterministic local/ephemeral-CI staging and verification,
optional Rust bindings, a build-time runtime-integrity gate, path-free
capability response, serialized GstPlay actor, isolated GLib/GStreamer runtime,
and application-owned child-window renderer. Project-authored `unsafe` is
restricted to the two contained Windows FFI adapters approved by the researcher
on 2026-09-10: private DLL-search activation/removal and raw child-window/GstPlay
overlay operations.

The runtime is deliberately not included in current downloadable packages.
Until installed Windows qualification, corresponding-source evidence, and
redistribution review pass, `nativeGstPlay` and qualified Start fail closed.
Researchers may deliberately choose the WebView player for development, but the
attempt remains labelled `unqualifiedWebview` in status, events, recovery, and
its final receipt. Staging
the native runtime or completing a desktop build is not playback qualification.

### Questionnaire authoring status

The reusable [`questionnaire-csv-v1` template](./site/questionnaires/questionnaire-template.csv)
uses one row per answer option for closed single-choice/Likert instruments.
Researchers can import validated CSVs,
author modules before/after the session or a selected block and after a selected
video before or after its ISI, embed language-tagged or `und` definitions,
reorder them without drag-only controls, and preview the resolved
participant/language sequence. Each terminal language explicitly lists its
ordered questionnaire module IDs; package compilation uses that exact list and
never falls back by locale or definition language. A runnable package embeds
those definitions and hooks; CSV remains an authoring input. The bundled
[German MAIA-2 definition](./site/questionnaires/maia-2-de.csv) contains 37
items with source, attribution, and scoring metadata. The repository also
bundles four English researcher-supplied authoring candidates:
[VR Experience](./site/questionnaires/vr-exp-en.csv),
[MAIA-2](./site/questionnaires/maia-2-en.csv), the supplied
[six-item SSQ](./site/questionnaires/ssq-six-item-en.csv), and
[TAS-20](./site/questionnaires/tas-20-en.csv). Each preserves the supplied
wording, response labels, numeric response values, and attribution to the Max
Planck Institute for Human Brain and Cognitive Sciences, Department of
Neurology, Stephanstrasse 1a, 04103 Leipzig, Germany. No scoring or subscale interpretation was supplied for these four
candidates. In particular, the TAS-20 fixture does not infer reverse scoring,
subscales, totals, thresholds, or diagnostic meaning. No TAS-20 rights/reuse
proof was supplied, so approval and recording of that evidence is an explicit
pre-deployment gate. Bundling a candidate records its provenance; it is not
instrument validation or licensing authorization.

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

Native-media staging instructions and the exact runtime pin are in
[`src-tauri/native-media/README.md`](./src-tauri/native-media/README.md). A
candidate intended for native playback must be built with the required runtime
gate only after the redistribution closure, corresponding-source evidence,
pre-main DLL loader design, and unsafe renderer are approved. Today,
`pnpm desktop:bundle` deliberately uses `--no-default-features`, excludes the
GStreamer runtime, and produces an interface-only Windows package whose Start
commands fail closed.

The displayed product version is `0.4.0-alpha.1`; it must not be described as stable or research-ready until the automated, timing, recovery, LSL, accessibility, and physical workflow gates in the charter pass.

## CI, deployment, and internal packaging

- Pull requests and pushes to `research/video-protocol-v1` validate the isolated Pages artifact and Windows Tauri candidate. They do not deploy a public site.
- A passing push to `main` deploys only the verified Research Pages artifact to the Research project URL.
- Windows CI runs the Research tests/build plus Rust format, check, test, and clippy gates. Its ephemeral GStreamer tree exists only to compile and test the optional integration boundary; CI neither packages nor uploads it.
- One manual-only matrix builds an unsigned, interface-only Windows x64 NSIS,
  host-native macOS ARM64/x64 DMGs, and a Linux x64 DEB/AppImage pair. Every
  package excludes GStreamer and optional Cargo features; exact artifact
  provenance marks every qualification claim false, and Start fails closed.

Signing, auto-updates, store submission, stable installers, and any research-ready claim remain out of scope until separately authorized and qualified.

## Privacy and storage

Names are transient and are reduced before persistence to a two-grapheme
participant code: the last grapheme of the first name followed by the first
grapheme of the last name. The selected package root contains canonical package
bytes as `experiment.package.json`, fixed `assets/stimuli/`, `outputs/`, and
`recovery/`; legacy authoring
files are not runtime authority. Browser state uses the isolated
`affect-research/v1` namespace only for locks/journals/recovery and cannot fill
package fields. The desktop retains bundle ID
`io.github.georgefejer91.affecttracker` for upgrade continuity while keeping
new Research data under its dedicated namespace; legacy application data is
never imported automatically.

## License

[BSD 3-Clause](./LICENSE)

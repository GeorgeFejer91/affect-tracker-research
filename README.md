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
3. Stimuli & Counterbalancer
4. Questionnaires & Sequence
5. Controller / Input Device
6. Visual Feedback
7. Advanced
8. Review & Start

One condition column containing every video is the supported **one-hat** workflow. Multiple columns form stratified pools. The target assignment uses deterministic `balanced-v1` allocation with Williams counterbalancing by default and cyclic rotation as the alternative.

The target Run mode freezes settings, participant code, assignment, resolved
protocol, bindings, and overlay geometry. Sampling is independent of rendering,
never invents catch-up rows, and records explicit timing gaps. Outputs are
create-new attempts containing frozen settings and protocol snapshots, semantic
events, a manifest, selected CSV and/or TSV rating tables, and questionnaire
response tables when configured. The manifest binds settings, assignment,
protocol, questionnaire-definition, and exact stimulus identities. Interrupted
runs retain authoritative recovery evidence, restore questionnaire drafts, and
restart a partially viewed video from the beginning.

The supported qualification targets for v1 are Windows Tauri and visible
desktop Chrome/Edge. Qualified Windows local/repository playback targets the
bundled, repository-pinned GStreamer 1.28.6 MSVC x64 runtime through a
Rust-owned GstPlay actor; the app never downloads native media code or discovers
ambient system plugins. LSL is a Tauri-only capability.
Experimental YouTube sources remain explicitly unverified and outside research
qualification.

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
contracts and canonical hashes, deterministic assignment logic, the two-mode
UI, browser worker sampling and recovery persistence, a strict questionnaire
CSV/protocol subsystem, narrow Tauri workspace/run modules, and a Rust-owned
native input service. On Windows the service exposes keyboard, mouse-button,
wheel, and bounded Pointer Grid input; gamepad D-pad/stick/custom-button presets
become available only when the isolated XInput backend starts successfully.
Automated tests and builds are
implementation evidence only. They do not establish scheduler performance,
crash durability, LSL interoperability, accessibility, media compatibility, or
physical workflow qualification.

The candidate remains under development. The exact open software and qualification gates are tracked in [`for-ai/40-ROADMAP.md`](./for-ai/40-ROADMAP.md) and [`for-ai/30-TESTING-AND-RELEASE.md`](./for-ai/30-TESTING-AND-RELEASE.md). The Pages deployment target is <https://GeorgeFejer91.github.io/affect-tracker-research/>.

### Windows native-player status

The safe native-media groundwork is present: an exact GStreamer installer and
runtime-tree pin, deterministic local/ephemeral-CI staging and verification,
optional Rust bindings, a build-time runtime-integrity gate, path-free
capability response, and explicit qualified/unqualified receipt fields. It
deliberately does not package that runtime or construct the GstPlay raw-window
renderer. The renderer needs one contained, audited Rust `unsafe` raw-window
constructor and therefore awaits explicit approval before implementation.

Until that actor lands and passes installed Windows qualification,
`nativeGstPlay` fails closed. Researchers may deliberately choose the WebView
player for development, but the attempt remains labelled
`unqualifiedWebview` in status, events, recovery, and its final receipt. Staging
the native runtime or completing a desktop build is not playback qualification.

### Questionnaire authoring status

The reusable [`questionnaire-csv-v1` template](./site/questionnaires/questionnaire-template.csv)
uses one row per answer option for closed single-choice/Likert instruments.
Researchers can import validated CSVs,
place any number of modules before or after the session or a selected condition
block, reorder them without drag-only controls, preview participant wording,
and freeze the resulting participant protocol and hashes. The bundled
[German MAIA-2 definition](./site/questionnaires/maia-2-de.csv) contains 37
items with source, attribution, and scoring metadata. The supplied specification
names TAS-20 but does not contain
authorized item wording or scoring, so Affect Research exposes a rights-cleared
CSV import path and does not invent or redistribute that content.

The Chromium adapter executes this questionnaire protocol with durable drafts,
safe-boundary recovery, and `ResearchRunManifestV3` outputs. Tauri validates and
saves/loads the same closed contracts, but questionnaire-aware native Start is
deliberately blocked before mutation until the atomic native V3 writer and the
approved GstPlay actor are integrated.

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

Names are transient and are reduced before persistence to a two-grapheme participant code: the last grapheme of the first name followed by the first grapheme of the last name. The selected workspace contains curated `stimuli/`, `settings/`, `outputs/`, and `recovery/` directories. Browser state uses the isolated `affect-research/v1` namespace. The desktop retains bundle ID `io.github.georgefejer91.affecttracker` for upgrade continuity while keeping new Research data under its dedicated namespace; legacy application data is never imported automatically.

## License

[BSD 3-Clause](./LICENSE)

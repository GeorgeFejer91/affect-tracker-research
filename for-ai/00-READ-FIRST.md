# Read this first

This directory is the durable active brief for **Affect Tracker Research**.
Every future agent must read every Markdown file here completely and in lexical
filename order before taking project action.

## Authority map

- [`15-RESEARCH-V1-CHARTER.md`](./15-RESEARCH-V1-CHARTER.md) is the sole active
  product and architecture authority, including its dated amendment delegating
  final-state capabilities and segment ownership to `60-SEGMENT-CATALOGUE.md`.
- [`05-PROJECT-METADATA.md`](./05-PROJECT-METADATA.md) records repository,
  checkpoint, product, and source identity.
- [`10-PRODUCT-REQUIREMENTS.md`](./10-PRODUCT-REQUIREMENTS.md) restates the
  user-visible contract.
- [`20-ARCHITECTURE.md`](./20-ARCHITECTURE.md) assigns native, browser, media,
  timing, data, and presentation authority.
- [`30-TESTING-AND-RELEASE.md`](./30-TESTING-AND-RELEASE.md) defines acceptance
  and qualification evidence.
- [`40-ROADMAP.md`](./40-ROADMAP.md) retains implementation and qualification
  receipts; `60-SEGMENT-CATALOGUE.md` owns the current capability checklist.
- [`45-FUTURE-AGENT-CHECKLIST.md`](./45-FUTURE-AGENT-CHECKLIST.md) tracks
  historical deferred issues, mapped to central catalogue IDs for current work.
- [`50-AGENT-WORKFLOW.md`](./50-AGENT-WORKFLOW.md) defines the pass-intent
  check, three-stage development and verification workflow, change discipline,
  and skill routing.
- [`55-AGENT-MESSAGE-BOARD.md`](./55-AGENT-MESSAGE-BOARD.md) coordinates
  single-segment ownership, branch integration, suggestions, and compatibility
  issues. It does not grant implementation permission or amend the charter.
- [`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md) is the central final-state
  roadmap and capability checklist: purpose, user input, JSON contribution,
  consumers, existing behavior, remaining items and decisions for each segment.
  Every pass starts with assigned segment/checklist IDs and updates only that
  segment's status/evidence and explicitly allocated shared seams.
- [`61-IMPLEMENTATION-AUDIT.md`](./61-IMPLEMENTATION-AUDIT.md) preserves the dated
  current-source field/function audit and redundancy findings; it is evidence
  for comparison, not a competing final-state specification.
- [`62-PLANNER-CLOSURE-PLAN.md`](./62-PLANNER-CLOSURE-PLAN.md) prioritizes incomplete
  Planner work and proposes missing-segment designs, interfaces and bounded
  implementation passes. It does not mark capabilities complete or replace
  `60` as the decision register/checklist.
- [`70-RESEARCH-PROVENANCE.md`](./70-RESEARCH-PROVENANCE.md) and
  [`references.bib`](./references.bib) record active source decisions.

Target language is never evidence that implementation or qualification has
landed. Use the roadmap and exact candidate receipts before making a claim.

## Product boundary

The following describes the existing v1 generation. The charter's 2026-09-11
amendment adopts the central roadmap's final-state Planner direction, including
chronological variant columns with Runner-owned participant allocation, consolidated Flubber
controls, screen geometry and optional XR authoring. Their successor schemas
are not yet implemented. References below to a current Section 2 pass describe
historical scope; every new pass follows the current request and catalogue.

Affect Research is a local-first continuous valence/arousal research instrument
with exactly two user-visible modes:

1. **Setting Up the Experiment** — the **Affect Tracker Designer** applet lets
   the researcher choose settings, define the video library and manual plan,
   and author questionnaires through ordinary controls and spreadsheet-like
   tables. Its primary finished output is one unified, validated,
   self-hashed `ExperimentPackageV1` JSON file containing all run parameters.
   Researchers are never expected to supply, view, or hand-edit master JSON
   to design an experiment. Loading a finished package is an optional reuse
   path; historical JSON imports are compatibility tools.
2. **Running the Experiment** — the **Experiment Runner** applet takes that
   finished package as its main input, acquires questionnaire responses and
   continuous ratings, and exposes acquisition/monitoring controls. It writes
   local response/rating tables and evidence and can emit outbound Windows LSL
   streams/markers under the existing contract.

These are two functions within the existing two modes, not additional modes or
an assertion that they have separate executables. The current 2026-09-11 pass
is limited to Designer Section 2; Runner work and other-section gaps go in the
future-agent checklist and are not implemented in this pass.

Active v1 targets qualification only on Windows Tauri and the static
application in current desktop Chrome and Edge. It has no WebXR, Quest,
remote-control, collaboration, direct physiology, participant-face experiment,
touch-inference, account, upload, analytics, telemetry, or backend surface.
A clearly labelled Setup-only feedback-design preview may compare classic
Flubber, a 2D affect Grid, and a project-authored procedural responsive Face
driven only by the same transient x/y preview point. That draft surface is not
a Run renderer or research contract: it does not serialize into
`ExperimentPackageV1`, `ResearchSettingsV3`, `InputBindingV1`, or
`VisualSettingsV1`, and it does not affect Start, Run, hashes, LSL, records, or
qualification. Camera, microphone, face tracking or inference, Photoatlas,
participant images, uploads, and personal data remain prohibited. Host-native
unsigned Windows, macOS, and Linux packages may
be produced with no optional Cargo features for internal Setup/interface
evaluation, but native experiment Start must fail closed there and those
artifacts carry no research, timing, media, input, recovery, or LSL
qualification claim.

## Non-negotiable boundaries

- Preserve BSD-3-Clause licensing and attribution to
  [`afourcade/AffectTracker`](https://github.com/afourcade/AffectTracker).
- Keep settings, plans, stimuli identity, ratings, events, journals, and
  manifests local to the selected workspace/application namespace.
- Treat WebView/browser input, imported JSON, directory contents, and every IPC
  argument as untrusted. Validate at the owning boundary.
- One canonical, strict, self-hashed `experiment.package.json`
  (`ExperimentPackageV1`) is the sole
  run-defining authority. It explicitly contains every setting, playback
  policy, the complete `assets/stimuli/` manifest, manual participant/block/
  video order and per-occurrence ISIs, the finite language-selection tree,
  embedded questionnaire definitions and ordered session/block/after-video
  hooks, input/visual/LSL configuration, and output policy. No package field is
  supplied by ambient storage, locale, filesystem order, clock, RNG, or an
  application default.
- Section 2 accepts strict standardized questionnaire CSV, tab-delimited TXT,
  or JSON authoring documents, as well as researcher-initiated table paste and
  direct cell edits, and normalizes accepted content through the
  canonical `questionnaire-csv-v1` definition before package embedding. A
  requested questionnaire family must have an exact variant/module for every
  selected study language before package finalization; no language fallback or
  implicit translation satisfies that gate.
- Section 2 centers on one questionnaire accordion per family and language,
  editable item rows, separate participant-visible labels and recorded numeric
  values, and compact response settings. Its authored questionnaires are
  pre-session (`beforeSession`) assets. MAIA-2 and TAS-20 English/German are
  the current preset focus; only the authorized MAIA assets are bundled.
- Keep questionnaire source uploads content-addressed beneath
  `assets/questionnaires/<family>/<language>/`. This authoring/provenance
  library is not the closed scientific video manifest and is never a second
  runtime authority.
- Freeze the exact canonical package bytes and self-hash, verified asset
  closure, derived settings/assets/participant-assignment/protocol hashes,
  bindings, terminal language, participant derivation, and geometry for each
  attempt. Historical settings, experiment, assignment, module, protocol,
  event, manifest, and recovery versions retain their original meanings.
- Keep the two-clean-independent-instance reproduction benchmark permanent:
  against the same read-only asset tree, every participant × terminal-language
  pair must yield identical package/settings/assets/assignment/protocol hashes
  and exact sequence, and each instance must byte-identically re-export the
  package without ambient defaults or storage.
- Keep the research scheduler independent of video rendering and animation.
  Emit a timing-gap event for missed deadlines; never invent catch-up rows.
- Never silently discard accepted rows or overwrite a prior attempt. Recovery
  resumes only at a safe protocol-step boundary.
- Keep keyboard operation, visible focus, semantic labels/status, non-color
  meaning, contrast, and reduced-motion behavior.
- Tauri Rust owns native workspace, input, playback, scheduler, timestamps,
  persistence, and outbound LSL authority. The WebView receives only narrow
  typed projections and opaque identifiers.
- Qualified Windows declared package-asset playback targets the
  repository-pinned GStreamer 1.28.6 MSVC x86_64 runtime through one Rust-owned
  GstPlay actor.
  The application never downloads it at runtime or searches ambient GStreamer
  plugin or installation paths.
  Missing, modified, wrong-architecture, or unavailable native playback fails
  closed. The WebView player is an explicitly selected, receipt-labelled
  unqualified development fallback only.
- The checked-in runtime pin, deterministic stager, tree verifier, and
  capability report alone do not establish playback qualification. The two
  contained Windows FFI adapters were approved on 2026-09-10 and the actor and
  renderer are implemented; their focused audit and installed qualification
  remain open as recorded in `40-ROADMAP.md`. Any additional unsafe boundary
  still requires explicit user approval.
- New work uses `ExperimentPackageV1` plus package-bound resolved receipts and
  reuses only record contracts whose field meanings remain exact. Existing
  settings V1/V2/V3, `ExperimentDefinitionV1`,
  `ResolvedAssignmentPlanV1`, `ResolvedExperimentPlanV1`, questionnaire module
  V1/V2, protocol plan V1/V2, samples, events, manifests, and recovery evidence
  retain their historical meaning and remain readable without
  reinterpretation. Legacy `settings.json`, `experiment.json`, and standardized
  questionnaire CSV/TXT/JSON files are explicit authoring/import inputs only;
  they never become parallel runtime authorities.
- Update this directory whenever product scope, schema, authority, timing,
  privacy, supported platforms, persistence, media, LSL, or release gates
  change.

## Historical lineage

The former feature-rich application, its documentation, assets, tests, and
full branch/tag graph are preserved in the public
[`affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
repository and remain reachable through this repository's Git history. They
were deliberately removed from the active Research source tree. Historical
presence or evidence never qualifies the changed Research runtime.

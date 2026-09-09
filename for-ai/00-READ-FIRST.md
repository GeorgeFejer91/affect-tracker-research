# Read this first

This directory is the durable active brief for **Affect Tracker Research**.
Every future agent must read every Markdown file here completely and in lexical
filename order before taking project action.

## Authority map

- [`15-RESEARCH-V1-CHARTER.md`](./15-RESEARCH-V1-CHARTER.md) is the sole active
  product and architecture authority.
- [`05-PROJECT-METADATA.md`](./05-PROJECT-METADATA.md) records repository,
  checkpoint, product, and source identity.
- [`10-PRODUCT-REQUIREMENTS.md`](./10-PRODUCT-REQUIREMENTS.md) restates the
  user-visible contract.
- [`20-ARCHITECTURE.md`](./20-ARCHITECTURE.md) assigns native, browser, media,
  timing, data, and presentation authority.
- [`30-TESTING-AND-RELEASE.md`](./30-TESTING-AND-RELEASE.md) defines acceptance
  and qualification evidence.
- [`40-ROADMAP.md`](./40-ROADMAP.md) is the implementation-status authority.
- [`50-AGENT-WORKFLOW.md`](./50-AGENT-WORKFLOW.md) defines change discipline and
  skill routing.
- [`70-RESEARCH-PROVENANCE.md`](./70-RESEARCH-PROVENANCE.md) and
  [`references.bib`](./references.bib) record active source decisions.

Target language is never evidence that implementation or qualification has
landed. Use the roadmap and exact candidate receipts before making a claim.

## Product boundary

Affect Research is a local-first continuous valence/arousal research instrument
with exactly two user-visible modes:

1. **Setting Up the Experiment** — authorize one experiment-package root; load,
   validate, author, and byte-identically re-export one self-hashed
   `ExperimentPackageV1`; verify its fixed `assets/stimuli/` closure; preview
   its manual participant/block/video/ISI order, language tree,
   questionnaire hooks, playback policy, input, visual, mapping, LSL, and
   output policy; then pass preflight.
2. **Running the Experiment** — freeze the resolved attempt, play complete
   stimuli, acquire ratings independently of rendering, persist local evidence,
   and complete or retain an explicit partial/recoverable result.

Active v1 targets qualification only on Windows Tauri and the static
application in current desktop Chrome and Edge. It has no WebXR, Quest,
remote-control, collaboration,
direct physiology, face, touch-inference, account, upload, analytics, telemetry,
or backend surface. Host-native unsigned Windows, macOS, and Linux packages may
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
  capability report do not constitute the player actor or playback
  qualification. The contained `unsafe` raw-window GstPlay renderer
  constructor remains subject to explicit user approval and audit.
- New work uses `ExperimentPackageV1` plus package-bound resolved receipts and
  reuses only record contracts whose field meanings remain exact. Existing
  settings V1/V2/V3, `ExperimentDefinitionV1`,
  `ResolvedAssignmentPlanV1`, `ResolvedExperimentPlanV1`, questionnaire module
  V1/V2, protocol plan V1/V2, samples, events, manifests, and recovery evidence
  retain their historical meaning and remain readable without
  reinterpretation. Legacy `settings.json`, `experiment.json`, and
  questionnaire CSV files are explicit authoring/import inputs only; they
  never become parallel runtime authorities.
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

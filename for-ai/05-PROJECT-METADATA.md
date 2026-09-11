# Project metadata and source map

The final-state capability plan and current segment checklist live in
[`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md), adopted by the charter's
2026-09-11 amendment. This file retains v1/source-history facts; old no-allocation
invariants and Section 2 pass scope describe that generation. They do not reject
the approved future variant/layout/XR authoring direction or allocate new work.

## Canonical identity

- Project: **Affect Tracker Research**
- Desktop product: **Affect Research**
- Repository: <https://github.com/GeorgeFejer91/affect-tracker-research>
- Pages target: <https://GeorgeFejer91.github.io/affect-tracker-research/>
- Primary branch: `main`
- Designated local integration branch: `codex/research-unified`
- Historical v1 implementation branch: `research/video-protocol-v1`
- License: BSD-3-Clause
- Origin attribution: [`afourcade/AffectTracker`](https://github.com/afourcade/AffectTracker)
- Canonical Windows clone:
  `C:\Users\Georgeous\Documents\GitHub\affect-tracker-research`

The Git root is authoritative. Discover it with
`git rev-parse --show-toplevel`; do not put the machine-specific path into
application or build contracts.

## Feature-rich preservation

The immutable reproducibility checkpoint is exact commit
`34a137d9d6d0f33a8e5ebef6c04bf8bc0219fd86`, referenced in both Research and
Playground by:

- branch `checkpoint/feature-rich-2026-09-03`; and
- annotated tag `checkpoint-2026-09-03-feature-rich`.

The annotation records 471/471 local tests and CI runs `33746889634` and
`33746889623`; it explicitly is not a research-ready release or physical-device
qualification.

[`GeorgeFejer91/affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
preserves the complete branch/tag graph and feature-rich source. Playground
`main` has exactly one checkpoint descendant, relocation-only commit
`5d1f5fa3d30f93b3f2797a74b02e1f336acb7bc3`. Later pre-split source remains on
`history/post-checkpoint-source-main` at
`5df1e5365aacd2e59cd36347d752b003f1af432d`. Research retains that ancestry in
Git even though the superseded working-tree files have been removed.

## Active product and support

The active product has exactly two user-visible modes:

1. **Setting Up the Experiment**; and
2. **Running the Experiment**.

Their functions are the **Affect Tracker Designer** (UI-authored experiment
settings, video plan, and questionnaires → one finished unified JSON package)
and **Experiment Runner** (finished package → acquisition/monitoring and local
response/rating outputs plus optional outbound LSL). These names describe the
existing modes, not extra modes. Master JSON is an internal compilation/output
format, never a required hand-authored input to the Designer. Runner work is
outside the current Section 2 pass; see `45-FUTURE-AGENT-CHECKLIST.md`.

The active-v1 qualification target matrix is:

- Tauri v2 on Windows, with Rust-owned workspace, input, media, scheduler,
  records, recovery, and outbound LSL; and
- the static application in current desktop Chrome and Edge, with browser-owned
  workspace authorization, worker sampling, and IndexedDB recovery, but no
  native/global input or LSL claim.

Capability differences are explicit. Unsigned host-native Windows x64, macOS
ARM64/x64, and Linux x64 no-optional-feature packages are permitted only as
internal Setup/interface-evaluation artifacts; native acquisition is blocked
and their provenance marks every qualification claim false. macOS and Linux experiment runs,
Firefox, Safari, mobile, WebXR, Quest, remote/collaborative surfaces, direct
sensor acquisition, and face/touch experiments remain outside active v1.
The bounded Setup-only procedural responsive-Face design preview is not a face
experiment, participant-data surface, or runtime feedback mode. It consumes
only the existing transient x/y preview projection and has no package, Start,
Run, record, LSL, or qualification authority.

## Product invariants

- Continuous rating is always enabled. Package authoring initially suggests
  130 Hz, but every runnable package explicitly stores an integer from 1
  through 240 Hz and runtime resolution has no omitted default.
- One strict canonical `experiment.package.json` (`ExperimentPackageV1`) is
  the only new-attempt protocol authority. Its self-hashed bytes explicitly own
  settings, the exact `complete-video-v1` policy, the exact
  `assets/stimuli/` manifest, manual participant/block/video
  order and per-video ISIs, the language-selection tree, questionnaire
  definitions/hooks, and output policy.
- Setup Section 2 is **Languages & Study Assets**. It is a user-facing
  spreadsheet authoring surface with no raw package JSON: select study
  languages, add a questionnaire family, and edit one disclosure/table for
  each family/language pair. Item prompts, participant-visible option labels,
  recorded numeric values, and required/optional responses have explicit
  owners. New Section 2 modules run before the video task. Every requested questionnaire
  family requires an exact definition/module for every selected language
  before package finalization.
- One attempt freezes the exact package bytes/hash, verified asset closure,
  derived settings/assets/participant-assignment/protocol hashes, selected
  terminal language, participant derivation, binding, exact stimulus
  identities, questionnaire sequence, and overlay geometry. The app performs
  no randomization or counterbalancing for new attempts and reads no ambient
  defaults or prior storage while resolving the package.
- Package acceptance permanently requires two clean independent instances to
  load the same canonical bytes against the same asset tree and match package,
  settings, assets, participant-assignment, protocol hashes, and exact sequence
  for every participant and terminal language, with byte-identical re-export.
- The sample clock is independent of rendering and records explicit gaps
  instead of backfill.
- The selected package root contains canonical `experiment.package.json` and
  fixed `assets/stimuli/`, `assets/questionnaires/`, `outputs/`, and
  `recovery/` locations. Questionnaire uploads are content-addressed authoring
  sources under `assets/questionnaires/<family>/<language>/`; only the
  canonical definition embedded in the package is Run authority. Output and
  recovery use create-new/no-overwrite semantics there and the isolated
  `affect-research/v1` browser namespace.
- New Research data is never populated by automatic import from legacy
  application data.
- Windows qualified declared package media targets a pinned
  bundled GStreamer 1.28.6 MSVC x86_64 runtime through GstPlay. Runtime
  verification, actor, and renderer implementation are present. The two
  contained Windows FFI adapters were approved on 2026-09-10; focused audit,
  redistribution, and installed qualification remain open. Qualified Start
  remains fail-closed; consult `40-ROADMAP.md` for current evidence.
- Tauri keyboard, mouse-button/wheel, absolute pointer/trackpad, and XInput
  gamepad input is owned by one safe Rust service with focus/region fencing,
  one-use binding/device receipts, and a bounded fail-closed Run mailbox.
  Gamepad presets are advertised only when that backend starts; no preset may
  fall back to WebView-originated Run input.
- LSL is outbound, Windows-only, and shares the configured sampling rate; it
  does not imply clock synchronization with independent Polar software.
- Signing, installer publication, updater/store work, production credentials,
  and stable/research-ready claims require separate authorization and evidence.

## Active source map

- `site/index.html`, `site/experiment-template.json`,
  `site/questionnaires/questionnaire-template.{csv,txt,json}`,
  `site/research.css`, and `site/src/research/`: current static UI,
  transitional external-experiment and questionnaire authoring/import readers,
  browser adapter, shared contracts, protocol planner, renderer, and browser
  recovery. The templates and V3 reader are not the target
  `ExperimentPackageV1` runtime authority.
- `site/src/research/experiment-package.js`,
  `src-tauri/src/research_experiment_package.rs`, and
  `test/fixtures/experiment-package-v1.canonical.json`: current strict package
  candidate, native mirror, and cross-runtime fixture.
- `scripts/verify-experiment-package-instance.js`: one-instance verifier used
  by the two-clean-process deterministic reproduction test; it is not physical
  asset-tree or decode qualification.
- `site/src/math.js`: active procedural Flubber geometry baseline.
- `desktop/index.html` and `desktop/vite.config.js`: isolated Tauri WebView
  entrypoint and production frontend build.
- `src-tauri/src/research_*.rs`: Rust-owned Research contracts and services.
- `src-tauri/native-media/`: GStreamer pin, deterministic staging/tree
  verification, and current safe integration boundary.
- `src-tauri/capabilities/research.json` and `src-tauri/tauri.conf.json`:
  narrow desktop exposure and package identity.
- `scripts/build-research-pages.js` and `scripts/verify-research-build.js`:
  allowlisted active artifact construction and legacy-surface exclusion.
- `test/math.test.js` and `test/research-*.test.js`: active JavaScript tests.
- `.github/workflows/`: Research validation, Pages deployment, and manual
  unsigned internal packaging.
- `for-ai/`: this active contract, status, qualification, workflow, and
  provenance set.

If these sources disagree, resolve the inconsistency against the Research
charter and report implementation status honestly in the roadmap.

# Affect Research — agent entrypoint

This file plus [`AGENTS.md`](../AGENTS.md) are the complete mandatory reading
route. Everything else in `for-ai/` and `docs/` is routed reference material:
read it when your task touches it, not on every pass.

Direct session instructions from the user take precedence over this file.

## 1. Product scope and non-goals

**Affect Research** is a local-first continuous video affect research
instrument built from two separate companion programs:

- **Experiment Planner** (GUI + CLI) authors an experiment: workspace and video
  library, questionnaires and languages, versions/ordering/variants, intervals
  and markers, screen layout, and Flubber feedback settings. It saves one
  canonical master JSON plus separate questionnaire asset files, and it can
  reopen what it saved.
- **Experiment Runner** reads that exact JSON, selects participant/variant,
  executes the authored sequence, acquires continuous affect samples and
  questionnaire responses, emits outbound LSL, and records own/selected
  external streams to XDF.

Recording policy belongs to Runner sessions. Planner never executes an
experiment; Runner never authors one.

**Video playback is an `HTMLVideoElement` over checked `research-media` URLs.**
The Runner needs useful *observed* start and end events. It does not promise
frame-accurate or physically measured display onset. The retired native
(GStreamer) player stack, its runtime staging, its launcher shim and its
native-renderer qualification obligations are gone; do not reintroduce them.

Non-goals (do not implement, do not treat historical checklists as work items):
WebXR/Quest runtime, remote control, Party/Ground Control, direct Polar,
Face/Photoatlas, Touch, mobile, Firefox/Safari, any backend/account/CDN
requirement. Deferred intent lives in [`90-FUTURE-SCOPE.md`](./90-FUTURE-SCOPE.md).

### Honest capability boundaries

| Surface | What it may claim |
| --- | --- |
| Tauri on Windows | Native workspace ownership, native global input, native sampling clock, outbound LSL, XDF recording, durable records and recovery |
| Static web in current desktop Chrome / Edge | Browser input, browser timing, browser-local journal and CSV export — **no** LSL, **no** XDF, **no** native input or timing authority |
| Unsigned Tauri on macOS / Linux | Interface evaluation only; Start fails closed |

The browser path must never present native authority, native input-test
receipts, or native timing evidence. An unsigned manually produced package is
not a validated research release.

## 2. Architecture and where the contracts live

```
experiment-planner/web/   Planner frontend (src/research/*.js), Pages build
experiment-planner/desktop/  Planner Tauri shell (vite config, icons)
experiment-runner/        Runner frontend (src/*.js), browser + desktop entries
native/                   Rust crate `affect-research`
  src/lib.rs              single Tauri composition root, command registration
  src/bin/planner-cli.rs  Planner CLI entrypoint (source, not generated)
  src/bin/runner.rs       Runner binary entrypoint (source, not generated)
docs/                     wire contracts and per-feature reference
scripts/                  build, verification and qualification scripts
test/                     Node test suite (`pnpm test`)
```

Authority direction: contracts and pure domain logic → services → Windows/Tauri
adapters → thin commands/events → frontend view models and controls. The
frontend must not reimplement package, protocol, sampling, persistence, input
or LSL authority. Raw `invoke(` is confined to the named native adapter modules
(`native-bridge.js`, `native-package-protocol.js`, `planner-authoring-native.js`,
`planner-authoring-native-effects.js`); `test/research-modular-architecture.test.js`
enforces that, the absence of project-authored `unsafe`, and the acyclic
frontend import graph.

Key contract locations:

| Concern | Where |
| --- | --- |
| Supported master generations, readers, known gaps | [`66-COMPATIBILITY.md`](./66-COMPATIBILITY.md) |
| Product/package authority, delivery surfaces | [`10-PRODUCT.md`](./10-PRODUCT.md) |
| Module responsibilities and boundaries | [`20-ARCHITECTURE.md`](./20-ARCHITECTURE.md) |
| All UI text, responsive CSS, font-to-box fitting and SVG centering | [`25-UI-LAYOUT.md`](./25-UI-LAYOUT.md): Cheng Lou's Pretext reference, shared dynamic fitting and readability checks |
| Feature requirements per segment (P1–P7, Runner) | [`60-SEGMENT-CATALOGUE.md`](./60-SEGMENT-CATALOGUE.md), [`65-RUNNER-SEGMENTS.md`](./65-RUNNER-SEGMENTS.md) |
| Scientific provenance, licences, citations | [`70-RESEARCH-PROVENANCE.md`](./70-RESEARCH-PROVENANCE.md), [`references.bib`](./references.bib) |
| Wire/format contracts | `docs/*.md` |
| Planner CLI reference | [`../docs/planner-cli.md`](../docs/planner-cli.md), [`../docs/planner-cli-library.md`](../docs/planner-cli-library.md) |

## 3. Verification and what evidence actually proves

Run focused checks while working; run the applicable full set before handing
off. Do not run every command for a documentation edit.

```powershell
pnpm install --frozen-lockfile
pnpm surveyjs:check
pnpm test
pnpm desktop:build
pnpm runner:build
pnpm build:pages
pnpm planner:cli:build
pnpm runner:check
cargo fmt --manifest-path native/Cargo.toml --all -- --check
cargo check --locked --manifest-path native/Cargo.toml --all-features
cargo check --locked --manifest-path native/Cargo.toml --no-default-features
cargo test --locked --manifest-path native/Cargo.toml --all-features
cargo test --locked --manifest-path native/Cargo.toml --no-default-features
cargo clippy --locked --manifest-path native/Cargo.toml --all-targets --all-features -- -D warnings
cargo clippy --locked --manifest-path native/Cargo.toml --all-targets --no-default-features -- -D warnings
```

Run one cargo command at a time. Two concurrent invocations on `native/target`,
or a rustc killed by memory pressure, leave truncated artifacts that surface
later as `found invalid metadata files for crate …` or
`only metadata stub found for rlib dependency core`. Those are a corrupt target
directory, not a source error: `cargo clean -p <crate>` the named packages, or
clean the whole directory, and rebuild with fewer jobs (`-j 2`).

Record exit codes. A missing dependency or unavailable hardware is
BLOCKED/NOT RUN, never PASS. Never reach green by skipping a broken functional
test, weakening an assertion to match a bug, or excluding a new test from the
test command.

**Evidence limitations — state these explicitly whenever you make a claim:**

- A passing unit test proves logic, not that a real video decodes in the
  installed app.
- A mock media element tests event wiring, not playback.
- A synthetic LSL source verifies the recording path, not a physical device.
- A successful `cargo check`, a CI run, or a Pages deployment is not a recorded
  session.
- A receipt proves only its named source, inputs and layer.

Report an overall result as VERIFIED FOR THE TESTED SCOPE, PARTIAL or BLOCKED.

Do not use computer-control, browser-control, window activation or GUI launch
against the user's live desktop unless the user opts in for that specific
check. Never terminate unrelated processes or delete user files.

## 4. Current status and open issues

Source of truth for status is Git and the checks above; this section records
what is known open, not a ledger to be duplicated.

- Native playback qualification, actual geometry/ISI observations, real device
  testing and an independent real-session XDF verification remain **open**.
- Master4 has intake and normal Start dispatch, but local validation accepts
  only master3.
- Controller override execution and its receipts are **not implemented**;
  changed controller settings are drafts that block Start.
- SurveyJS permits remote image URLs without embedding or hash-binding the
  resource bytes; retaining the object does not guarantee identical
  presentation.
- Master recovery (resume of a master-protocol run) is **not implemented**.
- The retired direct native-player IPC commands, live-frame placeholder and
  capability probe are deleted. `research_native_media_capability` remains as
  the fail-closed compatibility report. `research_native_media.rs` still holds
  the small compatibility service used by historical package/runtime readers;
  its player methods return `native_media_unavailable`. Keep the viewport,
  playback-mode/qualification and decode-receipt types because saved contracts
  still contain them.
- The downloadable Windows alpha is an unsigned, no-optional-feature,
  interface-evaluation package. It is not a research release.

Determine branch and source identity from Git (`git rev-parse HEAD`), not from
a document.

# NM04 bounded native actor pass

Owner: Live Preview, explicitly allocated R1/RR-04 and RR11 shared native seam
by Chat Orchestrator. Backend Verification, branch
`codex/nm04-bounded-native-actor`, base `863c03476401e22ccb05a5acd9ab9b781f60ccf2`.
Main acknowledged this existing c87/RR11 lineage against Main `2fe9da8` and owns
all `lib.rs` startup, retained-parent and close/exit-veto composition.

## Contract

- Ordinary command queue: 32 entries, FIFO, nonblocking admission. Queue full
  is an explicit terminal actor overload, not silent command loss. A Stop that
  encounters saturation fails visibly and triggers the same fail-stop cleanup;
  it does not report that playback already stopped.
- Callback queue: 256 entries, FIFO. Full/live receiver loss latches an actor
  fault. No coalescing hides state, EOS or error ordering. Retired-generation
  callbacks are rejected at admission and again at consumption; retirement
  precedes player teardown. A callback already queued before Stop cannot revive
  that generation after Stop.
- Each actor turn dispatches at most 8 GLib context iterations, 32 queued
  callbacks, 32 child-window messages and one ordinary command. Every removed
  HWND message is dispatched; the OS retains the remainder for later turns.
  Root explicitly included this finite-loop-only existing-adapter edit.
- Shutdown is an independent atomic cancellation signal, serialized with
  admission but never placed behind the ordinary queue. Pending operations are
  cancelled, not acknowledged as executed. Cooperative seek waits observe it.
- Requests have a finite queue deadline and waiter-lifetime fence. Expired or
  dropped waiters cannot dispatch queued work. An already executing foreign
  call cannot be revoked; timeout is not proof it had no effect.
- Overload, live channel loss and unexpected actor exit project sticky Failed
  status, preserving media/session identity for consumer fencing. Actor readiness
  becomes false. Rust-unwind exit projection also applies during requested
  shutdown; the existing retained JoinHandle reports panic on finish.

## Evidence limits

Budgets bound invocation/queue counts, not wall time. A single GLib iteration,
GStreamer call, window dispatch, snapshot, decoder operation or destructor may
still block. Third-party internal queues/callback work and foreign panic/abort
behavior are not qualified by these changes. No detached thread, forced close,
new unsafe block/call, new IPC or qualification flag is introduced.

The test-only diagnostic now requests shutdown through the production independent
signal and still requires actual thread exit and join before parent exit. This
pass does not run its opt-in window/clip exercise. Earlier attempts06/07 remain
evidence for their exact earlier source only.

## Verification ledger

- Initial build01 exposed stale test-only Shutdown-message references while
  queued-command changes were still being completed. Retained as preliminary
  failed evidence, never a candidate pass.
- Build02 compiled the initial bounded implementation with the same three
  pre-existing test dead-code warnings (unintegrated Main async/snapshot paths).
- Final focused native build/tests and Clippy results are recorded in the
  completion append below. No physical playback/timing, loader, installed
  packaging, redistribution review or readiness claim follows from unit tests.

## Collection

Completion checks (frozen Rust candidate):

- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib --features native-gstreamer research_native_media:: --no-run -j 2`
  passed (build03). Real SDK/pkg-config, no DOCS_RS, shared D target; three
  existing unintegrated test dead-code warnings.
- Copy-only CommonControls6 manifest preparation followed by the native library
  executable `research_native_media:: --test-threads=2`: **43 passed, 0 failed,
  1 ignored**, 0.73s. This adds twelve focused NM04 regressions. The ignored
  test is the explicit window/clip diagnostic, not run in this allocation.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --lib --tests --features native-gstreamer -j 2 -- -D clippy::all`
  passed. This is a Clippy-specific gate, not `-D warnings`: 84 production and
  3 test dead-code warnings remain while Main integration is absent (the new
  private actor helpers add to that unreferenced production tree).
- Focused `rustfmt --edition 2021 --check` and `git diff --check` passed.
- Receipts/logs: `D:/GitHub/.affect-native-diagnostic-build/`, files
  `nm04-build-01.log` through `nm04-build-03.log`, `nm04-tests-01.log`,
  `nm04-clippy-01.log`, and `prepared-nm04-01/artifact-receipt.json`.
- Original test executable SHA256:
  `c1173a9b2f61fca4e94f28e28e6d1201514f122c13778442d7573880423553aa`;
  manifest-prepared copy:
  `19b575cf7c4aa1953286c9658dadcfc024d142e13246a94f5467b7be155882b6`.
- Shared Cargo hold released to Main, Runner and root. No builds or app/window
  processes remain owned by this pass. No qualified/installed readiness claimed.

Main must collect the prior lifecycle and media-only RR11 dependencies before
this delta. Existing approved lineage: `dffe166`, state-owner correction pair
`560141a` + `aa8c821` (never first alone), `5c66ce6`, `19b9f7d`, `c87bd95`,
`b34842f`; `41d21a8`/`863c034` are supporting evidence documentation.
Do not overwrite newer owner changes with historical whole-file snapshots.
For selective collection, the native service/actor/capability, diagnostic and
runtime phase hooks must agree; RR11 requires its exact `live_frame.rs` plus
base64 manifest/lock dependency. Main owns pairing these with async startup and
strong-parent retained-until-join close/exit veto. This pass does not edit `lib.rs`.

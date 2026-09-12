# Native Planner CLI composition

Backend Verification, Live Preview's explicitly allocated CLI-SHARED / P1 native
media and R1/RR-04 shared seam. New isolated `codex/native-cli-composition` from
clean Main `05b8c185e38a14d9944eb98669eaaa740c60b791`.

## Collected source

Applied contextual native deltas from baseline460f516 through reviewed
`b569bd3cbb1164d21dc8ef8e7058e2b556b2208a`, retaining Main's other changes.
This includes the corrected state-owner pair, c87 async/retained lifetime,
b348 media-only RR11 JPEG support and NM04 bounded actor work. Native source at
Main05b8 was unchanged from460f516; P1 geometry/workspace contracts were not
overwritten. Cargo adds only the already-resolved base64 root dependency.

## Close contract and Main's Runner hook

`lib.rs` now passes the actual research WebviewWindow into `start_async` and
manages one `ShutdownCoordinator`. Both CloseRequested and ExitRequested veto
destruction while a single off-UI cleanup transaction is pending. Runtime
verification/actor initialization no longer blocks setup. The native service
retains its strong parent and actual initializer/actor join handles.

Main owns future Runner collection into `shutdown_before_native(app)`:

1. Authoring shutdown (already present).
2. Master shutdown/cancellation (Main adds before Package).
3. Existing Package shutdown (blocking; now off UI).
4. Observe Master `is_stopped`, then require `join_stopped` success (Main adds).
5. Recorder and input shutdown (already present).
6. Native request_shutdown, observe is_stopped, require finish_shutdown success.

Only after cleanup succeeds is exit re-requested. Repeated requests do not run
cleanup twice; a nonzero exit request is retained. Failure or Rust-unwind panic
keeps exit vetoed rather than destroying a live actor parent. No timeout forces
thread detachment or window destruction. A stalled foreign call therefore
remains pending and requires explicit external recovery; it is not a clean exit.
The coordinator's short notification tail owns no native HWND after native join.
Its handle remains retained and is joined when observed finished, without UI waits.

Release panic=abort and foreign aborts, operating-system termination, setup
failure and installed lifecycle adversities are not qualified by synthetic tests.
This pass adds no unsafe boundary, recording policy or qualification promotion.

## Local build and resources

Use the existing `node scripts/build-planner-cli.js --native-gstreamer` helper.
It embeds desktop assets through tauri/custom-protocol and retains the default
native-acquisition/LSL features. Real pinned development SDK and pkg-config are
required; DOCS_RS must be absent. Build/temporary directories are on D:.

Existing stage-gstreamer-runtime.ps1 VerifyOnly checked the prior native
diagnostic runtime before copying and both destinations afterward:827 files,
340362958 bytes, manifestSHA256
`51c27b6a25db1d86dea20cc108e88240fc340758b34ae1e497dd91d8de1b5566`.
One copy satisfies build.rs at this worktree's src-tauri/native-media/runtime;
the other is under D:/GitHub/.affect-native-diagnostic-build/debug/native-media/runtime.
Both use gstreamer-1.28.6/msvc-x86_64. Pinned tauri-utils2.9.3 platform.rs resolves
Windows resource_dir to the executable's parent, including this Cargo target.

This is local staging, not an installer or redistribution approval. Static
imports still require the pinned runtime bin on process PATH before launch;
the actor's later loader configuration does not solve pre-main imports.
No system installation, ambient plugin fallback or global PATH edit is made.

## Verification and remaining handoff

Pre-production checks passed: native library compile (one existing unused-method
warning),45 focused media/coordinator tests with one opt-in window diagnostic
ignored, focused rustfmt/diff checks, and Clippy `--lib --tests --features
native-gstreamer -j 2 -- -D clippy::all`. Existing unused-code/import warnings in
the unintegrated snapshot path and standalone integration-test harnesses remain;
this is not a `-D warnings` claim. Test logs and prepared artifact identities are
under D:/GitHub/.affect-native-diagnostic-build/native-cli-composition-* and
prepared-cli-composition-01/artifact-receipt.json. Production build follows the
clean source checkpoint, not the dirty test-build identity.

Embedded frontend build and desktop11-file boundary pass (existing Vite chunk
size advisory). Package/lock hashes matched Main before reusing its installed
node_modules through a local junction; no dependency download or manifest drift.
Focused native/coordinator checks and the clean production artifact receipt
are supplied with the completion handoff, distinct from earlier diagnostic
attempts06/07 and NM04's pre-composition tests.

Broker readiness is not native actor readiness. The existing controller's
prepare call can reject startup-pending before its subsequent metadata wait;
Main was notified to own bounded capability-readiness orchestration for the
actual mock. This pass does not add a fixed sleep or claim an early import passed.
No CLI process/window, real mock, Runner Start, screenshot, installed or physical
playback qualification is exercised by local build/staging alone.

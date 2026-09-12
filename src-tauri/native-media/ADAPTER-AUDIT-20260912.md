# RR-04 native adapter audit and diagnostic design

Status: engineering review in progress, not adapter approval or qualification.
Source reviewed: `460f51600298db910a52b25f25e8268dd722569b`.
Committed Runner `3301440` has identical native-media/adapter source.
Allocation: E2E-RUNNER / RR-04 Backend Verification, 2026-09-12.

Reviewed adapter SHA-256 (unchanged by this pass):
`runtime_environment.rs`: `31c3bdc53db95e9b3d86ad9c0c159098b7bc706d82f3c5a2c590cc8e2248fd92`;
`windows_renderer.rs`: `f7ab639893ab45f9ffa59b5e2658d3b113ca439d7ff4699ea204b5d3019460ab`.

## Decision and scope

Keep all qualified readiness flags false. Audit the existing two approved FFI
adapters; add only a test-binary-only, explicitly opted-in offscreen diagnostic.
Use an actual hidden Tauri native parent, with its event loop running and parent
retained until actor teardown. Never borrow an existing application's HWND.
No application page, IPC command, acquisition, LSL, recipe mutation, or new
unsafe code is needed for the diagnostic. A blank `about:blank` WebView uses
the pinned public Tauri builder (bare WindowBuilder requires its unstable
feature). It has no registered application commands or shared user profile.
Existing safe GStreamer/Tauri wrappers are used.
The diagnostic can establish actual actor/decode observations, not installed
operation, visible rendering quality, physical timing, or research readiness.

## Source findings and mitigation map

Paths below are relative to `src-tauri/src/` and refer to the reviewed base.

| ID | Finding / concrete source | Required mitigation and evidence |
| --- | --- | --- |
| NM-01 | `lib.rs:74-78,256-260` obtains a raw `isize`; `gst_actor.rs:38-52` stores it, without a retained window/lifetime lease. `windows_renderer.rs:30-64` checks only nonzero. A strong Rust window reference alone would still not prevent explicit OS window destruction. | Parent lifecycle owner must prohibit destruction until confirmed child/renderer teardown; explicitly handle close, startup failure and actor loss. Verify parent validity/ownership at admission using approved boundary or safe wrapper. Never accept frontend handles. |
| NM-02 | `lib.rs` setup synchronously calls actor start; start waits up to45s while actor creates a cross-thread child. Child creation/destruction can require parent message processing. Close handlers synchronously wait for actor too. | Keep parent event loop pumping during both start and teardown. Reproduce in a separate diagnostic process, not the user's window; do not claim a deadlock was observed merely from source risk. |
| NM-03 | `gst_actor.rs:116-125,200-228` drops the join handle on timeout. Shutdown sender remains alive with the service, so the comment promising immediate disconnected-channel teardown is not guaranteed. A successful ack precedes final loop/child/runtime teardown and is followed by an unbounded `join`. | Distinguish shutdown-requested, player-stopped, child-destroyed, thread-exited. Keep parent lease until terminal completion. Bound failure with an owned process boundary or reviewed lifecycle policy, not silent detach. Test timeout and repeated close. |
| NM-04 | Actor commands and signals use unbounded `mpsc::channel`; GLib/message/signal drains have no per-tick bound (`gst_actor.rs:100,345-375`; `windows_renderer.rs:139-148`). | Bounded admission/backpressure and finite drain budgets; never block callbacks. Preserve ordered terminal events. Measure stop latency under flooding. |
| NM-05 | `actor_entry` has no panic terminal-status guard; an early `?` can leave the last shared status. A panic can leave a stale Playing snapshot. Callback code is passed through native signal trampolines. | Fail-closed terminal projection on every exit; inspect upstream callback panic policy, avoid callback panic sources, and test actor loss while Playing. `catch_unwind` alone cannot catch a panic that aborts inside an extern callback. |
| NM-06 | Normal declaration/drop order is favorable: ActivePlayer adapter/play/renderer drop before child, child before runtime. Non-Send child plus owner thread check protects local mutation. However stop/drop are not evidence all native worker callbacks/sink accesses ended. | Record actual stop/renderer/child/thread closure; test repeated sessions and abnormal paths. Do not promote source comments to lifecycle proof. |
| NM-07 | `runtime_environment.rs:18-50` changes process loader/environment state during actor startup, not before static imports. It includes application directory and every USER_DIRS directory, not an exclusive per-actor namespace. GST environment is not restored; PATH is briefly replaced process-wide. No enforced singleton. | Single process-wide owner; reviewed startup policy; exact resolved-module evidence; no concurrent actor environment mutation. Separate pre-main resolution from later plugin isolation. |
| NM-08 | `runtime_environment.rs:88-97` removes the DLL cookie after normal actor drop, but loaded GStreamer modules/global registry can remain process-lived. | Explicit process lifetime policy for loader environment; don't claim deinitialization or unloading from cookie removal. Test one fresh process per diagnostic. |
| NM-09 | Generation checks reject previous-generation callbacks, but same-generation Playing/Paused/Buffering can overwrite Failed/Ended in `state.rs:49-80`. Existing `errors_are_path_free_and_terminal` only checks the immediate Error result. | Terminal-state transition tests with late same-generation signals; route any production reducer repair to a named RR-04 seam. |
| NM-10 | `validate_grant` checks retained file metadata and hash shape, but GstPlay opens `grant.path`. Upstream `research_workspace.rs:789-824` validates workspace/scan, hashes the opened file and retains it; `:2256-2266` denies write/delete sharing. Those are real mitigations, not absent hash verification. | Test directory/path replacement guarantees end-to-end while the grant is retained. Do not label this an exploitable race from the actor helper alone. |

Microsoft documents parent/child destruction order, thread restrictions and
parent notification for child destruction. That supports the lifecycle concern,
not a claim that a particular deadlock occurred.
[DestroyWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-destroywindow).

Pinned upstream source inspection: `gstreamer-play-0.25.0/src/auto/
play_signal_adapter.rs:61-83,117-145,210-236` uses `unsafe extern "C"`
trampolines calling the supplied Rust closure directly, without a local unwind
guard. The application must not allow a panic to escape those callbacks; an
outer actor-thread catch alone is not a substitute. No dependency code changed.

## Standalone loader proposal — not implemented or approved

Authority stays Rust-owned; no environment flag can grant qualified Start.
The present Tauri resources include only the pin and notice, not the runtime
tree. An SDK-linked development build is not a self-contained artifact.

Preferred candidate for review: an application-private, hash-bound binary
directory containing the native-linked executable and its complete approved
load-time DLL closure, with the plugin/data tree kept in the pinned layout.
Use MSVC `/DEPENDENTLOADFLAG:0xA00` (application directory plus System32) for
the relevant modules, then inspect actual PE load configuration and dependent
module behavior. This needs no new Rust unsafe boundary. It is a proposal,
not proof that a top-level linker flag constrains every third-party DLL.
Microsoft documents the flag as static-import policy and limits OS support;
confirm the exact target Windows build and all recursive dependency behavior.
[MSVC dependent-load flags](https://learn.microsoft.com/en-us/cpp/build/reference/dependentloadflag?view=msvc-170).

Application-directory placement alone is insufficient: missing dependencies
must not fall through to ambient paths. DLL name collisions, transitive
dependencies, known DLLs and already-loaded modules need explicit tests and
resolved-path receipts. Avoid selecting another runtime from PATH or registry.
[Windows DLL search order](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order).

The current runtime manifest must not be silently rewritten to fit packaging.
Define a versioned package layout/provenance mapping preserving every pinned
runtime byte, plus exact app/loader artifacts, and verify both layouts. A small
safe Rust bootstrap without GStreamer imports can verify the complete immutable
candidate before spawning the exact native-linked worker in that private
directory, with a fixed executable path and sanitized process environment.
It must retain verified file handles with write/delete sharing denied until
worker exit to prevent check-to-load replacement; this design needs review and
negative tests. Bootstrap/app separation adds no research or WebView authority.
Direct worker launch must not bypass integrity admission; separate installed
access controls, revalidation and artifact identity are required. This is a
follow-up design question, not an accepted security guarantee.

Alternative: delayed imports or a late-loaded player module. That requires a
contained dynamic loading/error boundary and broader build/runtime redesign;
do not add it under this diagnostic allocation. A bootstrap's AddDllDirectory
cookie does not establish a child's pre-main policy. Runtime
SetDefaultDllDirectories only affects the calling process and persists for its
life; it cannot retroactively fix already-resolved static imports.
[SetDefaultDllDirectories](https://learn.microsoft.com/en-us/windows/win32/api/libloaderapi/nf-libloaderapi-setdefaultdlldirectories).

## Diagnostic interfaces and observability

The ignored unit test is reachable only in a native-gstreamer test binary, not
from production CLI/IPC. Explicit local paths and opt-in are test inputs, never
qualified receipts or package settings. Verify runtime manifest, expected clip
SHA-256 and length first. Retain a read-only file handle denying write/delete.
Create one hidden, unfocused, taskbar-excluded Tauri window with a blank isolated
WebView; dispatch the actor from a worker so the parent event loop stays live.
Mute only in the opted-in test build before media is prepared. Exercise actual
Prepare -> Paused -> three-position snapshots/reset -> Play -> Pause -> Resume
-> Stop -> new generation -> stale-fence rejection -> shutdown.

After the production Shutdown command handler acknowledges, explicitly observe
the retained JoinHandle's thread completion before calling repeated handle
shutdown. This avoids counting the production detach path as a successful exit.
It does not test the user-window close handler or claim that its timeout issue
is repaired.

Record exact source/build and runtime/clip hashes, observed states/metadata,
failure stage, total duration, and normal shutdown result. Do not log raw frames
or pretend command acknowledgement means observed state. A separate process
supervisor imposes a hard timeout and may terminate only its own diagnostic
child; a timeout is retained as failure, never a successful teardown. Keep the
parent alive until successful actor shutdown; on failure abort the isolated
process rather than releasing a parent while the actor may still use it.

## Validation and next slice

- Baseline: nine focused Node media checks passed at reviewed base.
- Current pinned canonical runtime independently verified:827 files,
  340362958bytes, manifestSHA
  `51c27b6a25db1d86dea20cc108e88240fc340758b34ae1e497dd91d8de1b5566`.
- Native build/diagnostic results will be appended with exact evidence paths.
- Qualified format matrix, corresponding-source/redistribution review,
  installed playback, DPI/audio/device lifecycle, physical timing, recorder and
  master-recipe correspondence remain separate gates in for-ai30/40/65/66.
- Next production slice requires a named allocation for the parent/actor
  lifecycle and terminal-state fixes, with regression tests before integration.

### First engineering observations (pre-checkpoint working tree)

The real pinned-SDK native library diagnostic compiled successfully with
`native-gstreamer`, default native acquisition, required-runtime gate1 and
`DOCS_RS` absent:6m11s with2 Cargo jobs, isolated target directory
`D:/GitHub/.affect-native-diagnostic-build`. No code compile errors.

Attempt01 exited before Rust/actor output with `0xC0000139`
(`STATUS_ENTRYPOINT_NOT_FOUND`); receipt and original binary are retained.
[Microsoft NTSTATUS reference](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55).
`dumpbin /imports` showed Common Controls `TaskDialogIndirect`; the System32
library lacks that export, and `mt -inputresource:<test>;#1` reported no resource
section. This was the newly GUI-linked library test's missing Common Controls6
manifest, not evidence that the pinned GStreamer DLLs were incompatible.

The test-only preparer copies the binary and embeds the explicit dependency
manifest through the installed Windows SDK tool, retaining before/after/tool/XML
hashes. The first manifest-validation attempt lacked a root assembly identity;
its unused prepared copy remains. Corrected `prepared-02` validates and starts,
and all20 focused native-media tests pass (the actual actor diagnostic remains
separately ignored by default). No production build or pin change was needed.
[Microsoft manifest tool](https://learn.microsoft.com/en-us/windows/win32/sbscs/mt-exe).

Local evidence: `attempt-01/process-receipt.json`, `prepared-02/artifact-receipt.json`
under the isolated target directory. Actual actor attempt02 used the prepared
copy and retained independent logs and resolved core-module observations.

Attempt02 completed in63.97s (test63.55s), process37360 exited0 without timeout.
The process observer confirmed GStreamer, GstPlay, GstVideo and GstPbutils DLLs
actually loaded from the pinned bin directory, with per-module hashes in the
receipt. The parent remained hidden. Actual clip metadata:1920x1080,
254406ms,1 audio stream; three decoded snapshots at250/127203/254156ms.
Observed Paused, Playing, Pause, Resume, Stop/Idle, generation2, rejection of
the generation1 command, actor-thread completion and repeated handle shutdown.
Snapshots report missing orientation metadata; no images were exported.

Important defect evidence: Paused/Playing statuses still carried
`gstreamer-media-info-incomplete`. Real initial partial metadata was treated as
Failed, then later state events overwrote that failure. This validates the NM09
concern and means the transition exercise is not a clean state-machine or
qualification pass. A blanket Failed latch without distinguishing initial
partial metadata would break this clip's preparation. Root/Runner/main received
the exact stdout evidence; the separately allocated state.rs owner must define
bounded preparation and terminal-error behavior. No reducer repair is included
here. The diagnostic only claims the observed primitives, not correct handling
of all transient/terminal states.

Attempt02 prepared executableSHA:
`6a6ec53bf5da70aba680bef7736fc54d0efd9cf3754d20af90a4217ec1f14904`.
It identifies pre-checkpoint code (`460f516-dirty`), not a clean release.
A clean checkpoint rebuild/rerun is required for final handoff evidence.

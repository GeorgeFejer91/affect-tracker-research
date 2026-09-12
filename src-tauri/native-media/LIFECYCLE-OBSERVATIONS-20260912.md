# CLI lifecycle observations

Root allocation: CLI-SHARED/P1 native lifecycle and named R1 close seams,
Backend Verification, isolated branch from agreed Main c93c4b2. Observation only; Main's
actual catalogue diagnosis and assembled build take priority.

CLI startup enables a process-local closed phase observer. GUI and Runner do not
enable it. Each enum phase can emit at most once (atomic bitset), including one
NativeStalled phase after the existing five-second stalled threshold. No new
watchdog, force exit, timeout extension, unsafe call or cancellation behavior.
Lines contain only fixed enum names and monotonic milliseconds since CLI launch.
No paths, identifiers, raw errors, source, stack or participant values are added.
The 20-phase vocabulary bounds the whole process to 20 additional stderr lines.
Writes are best-effort: stderr I/O failure is ignored, never promoted to a
lifecycle panic. Main identified and corrected the initial eprintln! risk.
Concurrent writes may be printed in a different order; elapsed values refer to
observation time, not event delivery or physical timing.

Observations cover EOF observed/drained, ExitRequested, coordinator entry/result,
authoring/input cleanup boundaries, runtime verification completion, initializer
completion, actor retention, native shutdown request, worker stopped/joined and
final native completion. VerificationCompleted means verification returned, not
that integrity passed. ActorRetained means a thread handle exists, not startup
success. Stopped/joined phases describe all retained workers: they also hold when
no worker was created. ActorRetained distinguishes that case. A missing phase
alone cannot prove a hang; abort, stderr failure and forced termination remain
possible. Existing error output and public command schemas are unchanged.

Evidence: standalone std-only research_shutdown Rust harness passes five tests:
default-disabled/safe line format, per-phase duplicate bound, concurrent once-only
observation, and existing successful/failing cleanup semantics (the latter share
two tests), plus a failing-writer regression. Direct rustc emits two unused-code warnings because other modules are
not part of this harness. No Cargo/production build or process/window launched.
Main must compile the assembled app and bind its immutable artifact before the
external driver repeats the original read-only assertion/EOF case. Keep the
original ten-second failure receipt and original executable unchanged.

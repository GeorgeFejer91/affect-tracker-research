# Cancellation-aware native runtime verification

Root allocated CLI-SHARED/P1 native lifecycle repair, Backend Verification, on
agreed Main0ccc7ec in isolated codex/native-verification-cancel. Exact early EOF
evidence from immutable1ccd756 showed input cleanup/native shutdown at1009ms,
NativeStalled at6028ms and no VerificationCompleted or ActorRetained before the
unchanged external ten-second cleanup grace terminated the owned process.
This localized the wait before verification completion; it did not prove an
indefinite hang. Original evidence and artifacts remain unchanged.

The shared runtime_manifest verifier now exposes a cancellation-aware entry.
The existing verify_runtime_tree wrapper supplies a never-canceled predicate,
so build.rs and ordinary complete verification retain every pin, traversal,
hash, byte-count and PE check. Runtime startup alone passes its existing atomic
shutdown flag. Checks occur before inspection, after bounded manifest reading,
during directory traversal, between files, before/after every64KiB hash read,
between tiny PE checks, and before the complete verified bundle return.

Cancellation returns only runtime-verification-canceled, not a partial bundle.
Capability publication remains atomic: NotStaged (not yet established), false
integrity/actor/qualified flags, null file/byte counts and the fixed reason.
It does not label a canceled tree corrupt. Existing shutdown prevents actor
creation, retains the initializer handle and parent, and waits for actual
initializer/actor completion and successful joins. No force exit, detach,
timeout extension, unsafe call, qualification change or orientation change.

This is cooperative cancellation, not interruption of a blocked OS filesystem
call. A single read/metadata operation can still be delayed by the OS; no hard
wall-clock cancellation guarantee is asserted.

Verification: ten actual runtime-manifest tests pass through direct rustc using
the existing built sha2 dependency, with task-local D: temp/scratch. New tests
cancel at every observed verification boundary (including final publication)
and immediately after a64KiB read. Existing complete-tree, tampering, missing,
wrong-architecture, traversal and Windows-junction checks still pass.
Added capability cancellation unit test awaits Main assembled native test run.
No Cargo target used, production executable built or hidden process launched.
Main owns assembled compile/build; root repeats exact ten-second EOF cleanup on
the newly bound immutable artifact. Orientation repair remains a separate gate.

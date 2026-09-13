# Native startup follow-up

Allocated shared native/P1 import seam follow-up to composition 70ca706;
Backend Verification only. No Runner playback, qualification, public CLI schema,
research JSON or native capability changes.

- All Result-returning setup finishes before `start_async`, including real
  preset app-data resolution and authoring broker startup. Setup failure therefore
  cannot drop a started UI-dependent actor and synchronously join it on the UI
  thread. Normal close retains the existing off-UI coordinator. This is source
  ordering evidence, not injected OS setup-failure qualification.
- GUI import/rescan and CLI video effects share read-only capability polling.
  Only runtime-verification-pending and GstPlay-startup-pending are retried.
  Readiness requires both verified runtime integrity and actor readiness;
  qualified flags remain exactly as supplied by native authority.
- CLI captures a stricter local 60-second startup sub-budget at `_next` receipt,
  including subsequent revision/session queue time. This is NOT an exact copy of
  native remaining time: native starts its authoritative 120-second command
  deadline before forwarding. That deadline is unchanged; no new field or
  handshake and no timeout reset. GUI uses the same 60-second local budget.
- Revision notices drain before and after the gate. Signal, command and bridge
  lifetime/publication guards fence readiness adoption and dispatch. Capability
  cache refresh precedes the subsequent catalogue publication guard. Terminal
  failures, invalid capability, stalled RPC, cancellation and timeout fail before
  the copy/import call. Mutating calls are never retried.
- Native-effects transport now passes detached action/context and guards to its
  internal predispatch hook. No public request shape changed. Missing injected
  readiness ownership fails closed for video effects.

Evidence: 60 focused JavaScript tests across native bridge, catalogue, readiness,
native effects and native boot; desktop Vite build and 11-file research boundary
verification pass (existing chunk-size warning). Source-order regression covers
no remaining `?` after actor startup in setup. No Rust rebuild, production
artifact replacement, actual-app import or playback claimed in this follow-up.
The immutable 70ca706 executable/receipt remain unchanged. Main owns collection
and assembled Rust/actual-app validation.

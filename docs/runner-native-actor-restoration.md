# Runner native player source restoration

2026-10-04 R1/RR-04 Backend Verification pass on `codex/r1-native-gst-restore`.

The Rust-owned GstPlay actor, pinned GStreamer 1.28.6 runtime verifier and
optional `native-gstreamer` feature have been restored from the source immediately
before removal commit `fa8552e`. The two previously approved Windows FFI files
match that historical source byte for byte. Current suite launcher, separate
Planner/Runner identity and master5/Face behavior remain in place. No new unsafe
boundary was added.

Current source checks: all 1,233 JavaScript tests, SurveyJS asset checks,
Rust formatting and suite structural checks pass. A Windows native feature
compile and test still needs the remote CI result; local C: space is below the
build guard. The suite build omits the native feature and the private runtime.
Normal research Start stays gated. No installed playback, decoder matrix,
physical input, LSL/XDF, timing or research qualification is established here.

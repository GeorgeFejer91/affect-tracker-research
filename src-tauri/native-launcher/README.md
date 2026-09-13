# Runner pre-main launcher

This independent Windows bootstrap has no Tauri/GStreamer dependency and forbids
application `unsafe` code. Build it after the exact Runner engine. It compiles
that engine's SHA-256 into the launcher, reuses the pinned runtime verifier, and
starts only the adjacent `affect-runner-engine.exe`, without a shell or forwarded
arguments. The child gets only the verified runtime `bin` in PATH and uses that
same directory as cwd. Root-level DLLs are rejected because Windows searches the
executable directory before PATH. Normal inherited user environment outside PATH
is unchanged. This is a local candidate, not redistribution approval.

Prepare a fresh application directory containing the already staged
`native-media/runtime/gstreamer-1.28.6/msvc-x86_64` tree, then run `prepare.ps1`
with absolute `EnginePath`, `ApplicationDirectory`, and `BuildDirectory`. It
refuses to overwrite a previous launcher/engine. Launch `Experiment Runner.exe`.
`--verify-only` verifies all identities without starting the GUI. Other arguments
are rejected. On a normal launch failure, a fresh bounded text report is opened
in the system text viewer. Successful startup leaves the actual GUI responsible
for its lifecycle; the bootstrap exits and neither retries nor kills it.

Tests: `cargo test --manifest-path Cargo.toml --locked --offline` with
`AFFECT_RUNNER_ENGINE_SHA256` set to the selected engine SHA-256. The independent
lockfile uses only the already used SHA-256 dependency. Import-table inspection
must show no GStreamer DLLs. Verify startup with a system-only parent PATH and an
unrelated working directory. Local same-user filesystem replacement races are
not claimed to be eliminated; protect a distributed installation appropriately.
A different engine requires rebuilding the matching launcher. No native playback
qualification flag, experiment contract, permission or IPC command is changed.

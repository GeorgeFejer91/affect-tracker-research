# RR-11 source and transport verification — 2026-09-12

Application source candidate: `f418f3e54fe4d7c2ac0e58ac859fb0b5dcb8d305`,
branch `codex/segment-runner-professor-companion`, stopped base `3301440`.
The source checkpoint was clean. This receipt is a separate documentation commit;
it does not identify a published or installed application. R1/RR-11 allocation
and authority boundaries are in [amendment 68](../for-ai/68-EXPERIMENTER-COMPANION.md).

## Environment and identity

- Windows host; Node 24.19.0, pnpm 11.19.0, Rust 1.96.0 MSVC x86_64.
- Chrome 152.0.7977.83; Edge 153.0.4234.32, both headless.
- BRSP/1 profile `affect-runner-professor-v1`; capabilities `command-ack`,
  `latest-state`, `state-snapshot`. Scopes `runner.observe`, `runner.operate`,
  optional `runner.video`. No participant input/answer/file scope.
- VDO.Ninja SDK 1.5.5, bundled locally. Exact BRSP, adapter, SDK and license hashes
  are in [PROVENANCE.md](vendor/PROVENANCE.md) and the linked SDK notice.
- Native feature build used pinned GStreamer 1.28.6 MSVC SDK and verified bundled
  runtime: 827 files, 340,362,958 bytes. Runtime presence is not player qualification.
- The build target was moved reversibly to `D:/GitHub/.affect-professor-build`
  after the C drive filled during the first Rust link. No source or research
  files were deleted. The successful checks below used the relocated target.

## Source and browser checks

| Check | Observed result | Evidence and boundary |
|---|---|---|
| Full Node suite | 779 passed, 0 failed | `pnpm test`, `professor-node-tests.log`; before the final optional CLI scopes argument. Default behavior unchanged; focused checks below and actual CLI subprocess exercised final source. |
| Focused Professor Node suite | 7 passed, 0 failed on stopped source | `node --test test/research-professor.test.js`; cross-language proof fixture, exact vendor pins, bounded/gapped timelines, invitation/projection rejection, native-proof readiness and duplicate-proof regression, command acknowledgement, rejected participant intent, bounded video reassembly. |
| Rust library tests | 255 passed, 0 failed, 2 pre-existing ignored | `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib -j2` with `CARGO_PROFILE_TEST_DEBUG=0`; `professor-rust-tests.log`. Includes final asynchronous snapshot handler. |
| Native feature build | Passed | `cargo check --manifest-path src-tauri/Cargo.toml --locked --lib --features native-gstreamer -j2`; `professor-native-check.log`. |
| Exact stopped source native Clippy | Passed | Same manifest/features with `cargo clippy ... -- -D clippy::all`; `professor-clippy-exact.log`. Three pre-existing workspace dead-code warnings remain; this is not a warning-free claim. |
| Production artifacts | Passed | `pnpm companion:build` and `pnpm runner:build`; source/licenses copied, Runner boundary 11 files / 63 dependency inputs. `professor-build-final.log`. Shared Pages assembly is not in this checkpoint. |
| Formatting | Passed | Targeted Rust formatting and `git diff HEAD^ HEAD --check`. Vendored bytes use `-text` and a vendor-only trailing-space attribute; upstream source is unchanged. |
| Browser fixture, tier 2 | Chrome and Edge passed at 390×844 and 1280×844 | `node scripts/verify-professor-browser.mjs`; production HTML/CSS/CSP with deterministic in-process transport. 140 synthetic rating points, stacked popup canvases, no horizontal overflow, Pause/Resume/Stop acknowledgements, stale control disabling/gap, disconnect. No external requests in this fixture. |

The browser fixture is not a physical phone, native WebView, screen reader,
touch/lifecycle, or real participant result. Its early development-server run
could not load Vite's inline CSS under the production CSP. Verification switched
to built HTML/CSS; the production policy was not weakened.

## Public VDO transport run

At `2026-09-12T16:45:14.556Z`, the production Edge companion connected through
public VDO signaling to a Chrome target fixture on the same Windows host. The
target fixture used real BRSP/Web Crypto and simulated the native verifier and
application authority. It did not run Tauri or GStreamer.

- Mutual proof reached ready; Pause produced a matching successful acknowledgement
  and the target fixture recorded exactly one Pause.
- A synthetic 320×180 JPEG reached the actual companion image element through
  the separate unordered video channel. The timeline popup rendered observed
  synthetic samples.
- TURN was not forced. Independent selected-candidate-pair readback reported
  **direct** at both endpoints. Latest reported RTT was 0 s at the target and
  0.001 s at the controller; this is not command-latency percentile evidence.
- The receipt's historical `frames: 3` field counts state timer ticks, not three
  JPEG captures. The script sent one JPEG test frame. There was no sustained
  throughput/backpressure or long-run measurement.
- One intermediate transport attempt failed while route instrumentation was
  being added. Its cause was not established. Later runs passed. An ordered
  duplicate-proof grant-lifecycle defect was fixed and regression-tested; this
  does not prove that defect caused the intermediate failure.

Command: `node scripts/verify-professor-webrtc.mjs`. Artifacts include
`webrtc-receipt.json`, `internet-video-fixture.png`, and
`internet-timeline-fixture.png`. This is an automated two-browser transport check,
not a complete attended tier-3 matrix or Internet/off-host support qualification.

## CLI adapter run

At `2026-09-12T16:58:59.682Z`, the actual `scripts/professor-cli.mjs` subprocess
completed two fresh public-VDO pairings against a headless Chrome target fixture:

| CLI verb | Requested scopes | Result |
|---|---|---|
| `status` | `runner.observe` | Fresh playing state, zero commands applied. |
| `pause` | `runner.observe`, `runner.operate` | Exactly one Pause, successful acknowledgement at revision 2. |

The private invitation was supplied through stdin and was absent from stdout and
stderr. The fixture checked mutual proof and least-authority requested scopes.
Native authority was simulated; native Start/Stop/Resume, packaged CLI delivery,
and route were not measured in this run. The one-off reproducible harness and
receipt are retained in the local artifact directory below.

## Artifact identity

Local artifacts are under
`C:/Users/Georgeous/Documents/GitHub/affect-tracker-research-professor/artifacts/professor/`.
Build/test logs are at the worktree root. Generated evidence is gitignored and
must be retained separately if used for a release claim.

| Artifact | SHA-256 |
|---|---|
| `browser-receipt.json` | `e8e67a6c45c19ab73e7604b1177e48da2f14c36bfdbcb0612a8bb6b8a1dbd004` |
| `webrtc-receipt.json` | `998cb61522635d0b83164aa6ad91772ecb06915b057db8f7c2ea1348c79ec9c6` |
| `cli-receipt.json` | `734026a4f4b75cea9a56739437a40e1d22670a1797276b74e6e0a814fd8ce641` |
| `verify-cli.mjs` | `a69cbabdda4af817254eeccee55829753e994ebc87dca35ed1d9be3d91dbb245` |

## Open integration and qualification gates

1. Live Preview owns the allocated two-capture native diagnostic: one Paused,
   one Playing, JPEG dimensions/bytes/identity, request latency, and subsequent
   Pause/Stop/actual actor join. That result is pending this receipt. The 100 ms
   measured snapshot limit and 300 ms response timeout cannot cancel a foreign
   GStreamer call; no timing or teardown qualification is inferred.
2. Main owns canonical integration, shared Pages route/closure, and publication.
   The intended static route is `/affect-tracker-research/runner/professor/`.
   Root independent review remains pending. This checkpoint is not live online.
3. Current control dispatch targets frozen package-v1. Experiment Runner owns
   master integration and requires the versioned demographic/Start contract to
   freeze first. The master mailbox seam is `publish_projection(MonitorSample)`
   after a successful local sample write. Master Presented/Draft/Submit remain
   local. No master remote Start correspondence is claimed.
4. Packaged Windows WebView pairing/IPC/native player capture, actual participant
   input and local recording continuity require separate evidence. Existing
   `nativeStartReady` and research/player qualification gates are unchanged.
5. Physical Android/iOS, off-host Internet, forced TURN with relay readback at
   both endpoints, cellular transitions, lock/suspension, accessibility and
   sustained command/state/video load are not qualified by these fixtures.

Result: source, focused native tests, responsive browser fixtures and the named
two-browser/CLI transport checks passed. Product integration and the native/device
support matrix remain open; future results require a separate exact-candidate
receipt rather than upgrading this record by assumption.

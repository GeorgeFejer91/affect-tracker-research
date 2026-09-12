# Absent Minded Professor

R1/RR-11 browser conductor for the Windows Runner. The local app owns the run,
participant input, timing, questions, LSL and saved data. The companion can
request Start, Pause, Resume and Stop, observe progress, display a low-resolution
current-video preview, and open a Ratings timeline popup containing valence above
arousal on the same experiment-time axis.

Enable the companion in the local Runner, scan its fresh QR code, then choose
Connect. Invitations expire after two minutes and admit one experimenter.
Disable, browser disconnect, reload or app exit ends the pairing. Pair again
with a new invitation. The running experiment continues locally after a lost
connection. For remote Start, select the local waiting option and complete the
participant preparation/input check first; the armed attempt expires in two
minutes. Existing native readiness gates still apply.

The current native adapter targets the frozen package-v1 Runner. The separate
master consumer's remote Start adapter awaits its owner's versioned Start
contract freeze. Canonical integration and Pages publication are tracked by the
repository's integration owner; this branch does not claim those steps complete.

`pnpm companion:build` produces the static route for
`/affect-tracker-research/runner/professor/`. `pnpm companion:dev` serves a local
development page. Use the built page when checking the restrictive production
CSP; Vite's inline development style injector is intentionally not allowed by it.

The Internet transport uses the bundled VDO.Ninja SDK for signaling and WebRTC
ICE/TURN. GitHub Pages distributes the UI; it does not receive research files.
Networking is inactive before local Enable and browser Connect. Camera,
microphone, raw desktop capture, arbitrary native commands, participant input,
questionnaire answers and file transfer are absent from this profile.

Native Rust verifies the BRSP transcript independently before granting scopes.
Commands have a native revision and ID; the native cache retains at most 1024
outcomes without eviction/reapplication. The session lasts at most two hours.
State arrives at up to 4 Hz through a single lossy sampler mailbox; the browser
retains at most 28,800 observed points in memory. Disconnect/time gaps break the
lines. These plots are a live monitor, not the research export.

Video has its own unordered channel. Native capture admits one snapshot at a
time, preserves display aspect within 640×360, caps JPEG data at 96 KiB, and
permits at most one capture per second. The browser holds one incomplete frame
and discards obsolete selections. Player position is explicitly an estimate,
not a decoded-frame timestamp. A slow foreign snapshot call cannot be cancelled
by its reply deadline: a measured overrun disables preview until re-enabled.
Native playback timing/stop/teardown qualification is a separate gate.

## Semantic CLI adapter

`node scripts/professor-cli.mjs status` reads a fresh invitation URL from stdin.
The other fixed verbs are `start`, `pause`, `resume`, and `stop`. It connects as
the single experimenter, waits for native acknowledgement, prints a sanitized
JSON result, and disconnects. It never accepts JavaScript, native method names,
shell commands, paths or rating inputs. A prepared remote Start is required.
Set `PLAYWRIGHT_MODULE` to an installed Playwright module and `CHROME_PATH` to
Chrome when these differ from the local developer runtime. This thin client uses
the same BRSP profile and native authority as the visual companion.

## Validation boundaries

- Node tests: `node --test test/research-professor.test.js`.
- Browser fixture: `pnpm companion:build`, then
  `node scripts/verify-professor-browser.mjs`. Runs Chrome/Edge headlessly with
  deterministic in-process lanes and production CSS/CSP; tier 2, not Internet,
  physical-phone or installed-WebView evidence.
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`.
  Native video also requires the pinned GStreamer feature/runtime.

See [the allocated amendment](../for-ai/68-EXPERIMENTER-COMPANION.md) and the
dated qualification receipt for current measured results and open gates.

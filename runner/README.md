# Experiment Runner (desktop)

Experiment Planner authors the JSON recipe and retains all authoring previews.
Experiment Runner is a separate Windows executable that reads that recipe and
composes the native package protocol, video surface, participant feedback,
questionnaires, input acquisition, LSL output and XDF recorder.

From the repository root, with Node/pnpm, Rust and Windows build tools installed:

```powershell
pnpm install --frozen-lockfile
pnpm runner:desktop:build
```

This builds `affect-runner.exe` under the Cargo target directory and embeds the
Runner frontend, icon and product identity. `pnpm runner:desktop` explicitly
launches it. `pnpm runner:dev` serves the frontend on port 1421 for development;
the native application is required for file dialogs, execution and recording.
Planner retains its own desktop build entry and application-data identity.

The default build includes LSL and Windows acquisition. Qualified video Start
remains disabled by the existing native GStreamer qualification gate. A successful
build or synthetic test does not qualify native video playback or an installed
experiment. The pinned GStreamer runtime/SDK, redistribution review, installed
player/input/timing tests and complete Planner–Runner option correspondence have
their own outstanding gates in `for-ai/30` and `for-ai/40`.

## Preparing an experiment

1. Open a supported complete Planner recipe and choose its video project folder.
2. Enter its participant ID, explicitly traverse the language choices and choose
   a new attempt, compatible recovery or pending-output finalization.
3. Check the recipe, files and native decoder. Test the recipe's configured input
   in the focused test region. Changing participant, route or test geometry
   invalidates the relevant readiness.
4. Optionally configure recording, then start when the native capability permits.
   The Rust protocol owns timing, video transitions, ISIs, neutral resets,
   questionnaire drafts/submissions, sampling, LSL timestamps and attempt files.

The current executable accepts canonical `affect-research-experiment-package`
version 1 without changing its bytes, hashes or frozen readers. It consumes the
explicit participant schedules and complete language-selected protocol. The new
comprehensive Planner master has a separate P7-owned reader handoff; unsupported
or unfinished schemas are rejected rather than run with invented defaults.
V1 questionnaire presentation preserves one item at a time, original option
labels/codes, required-answer checks and final validation.

## Stream recording

Recording policy belongs to **Runner session state**, independently of the
Planner recipe's LSL emission settings. Select own affect/marker streams and/or
up to 16 explicitly discovered external streams. Own recording requires the
recipe to enable LSL output. Choose a new `.xdf` destination; existing files are
never replaced. Start recording before the attempt to capture its first markers.
Finish the attempt before manually stopping the recorder. Normal attempt
completion stops and drains recording automatically; application shutdown stops
the native attempt before finalizing recording.

The writer preserves numeric channel types, including Int64, and explicit source
timestamps. Clock-offset chunks are separate; timestamps are not corrected twice,
resampled or dejittered. External inlets bind the cached discovery identity with
recovery disabled. Disconnection, inlet drops, own queue overflow and write errors
produce an explicit incomplete result. Own samples are copied after successful
LSL emission through a bounded queue; a recorder failure propagates to the native
acquisition error path. An external-only recorder failure is reported separately.

Alongside `name.xdf`, immutable receipts record:

- `name.xdf.recording-start.json`: recipe hash, recording policy and selected
  external identities/metadata.
- `name.xdf.recording-attempt.json`: own-stream binding to a specific run ID.
- `name.xdf.recording.json`: final phase, sample count and any error.

A start receipt without a final receipt indicates an interrupted recording.
Preserve it for inspection and choose a new file; Runner does not append to or
silently repair interrupted XDF. External strings use the pinned safe library's
UTF-8 decoding. Arbitrary invalid UTF-8 byte-string fidelity is not claimed.

The XDF writer follows the [XDF specification](https://github.com/sccn/xdf/wiki/Specifications).
`scripts/qualification/verify-runner-xdf.py` independently verifies Rust-generated
fixtures with pyxdf 1.17.0. Synthetic local LSL tests require the explicit
`AFFECT_RUNNER_SYNTHETIC_LSL=1` test environment flag; they do not qualify physiology
devices, the network, long recordings or installed playback.

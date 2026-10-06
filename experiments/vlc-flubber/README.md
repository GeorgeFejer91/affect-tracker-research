# Native VLC Flubber feasibility probe

The [Flubbercorder 0.1 runner](flubbercorder/README.md) is a historical
Python-based prototype. The requested replacement remains two separate
installers: a standalone native VLC player and a Rust/Tauri HTML recorder and
controller. This runbook covers the native player plugin and its current
feasibility evidence. The 0.1.1 update uses VLC's normal embedded video
window, adds shared standalone presets, and places Recorder transport and
volume controls above the stream display. See the side-quest status for the
exact installed evidence and remaining qualification limits.
See [standalone player instructions](PLAYER-README.md) for the new installer
and Rust launcher. The older `run.ps1` instructions below document the
development probe.

The current Rust launcher uses the source's probed average frame rate,
preserving fractional rates such as `30000/1001`, and converts to that
constant rate. The VLC filter writes one time-series CSV row and sends one
affect LSL sample per decoded frame during the original-video interval. Its
CSV times are calculated from the frame index and rational rate. A
variable-rate source is sampled at its average rate during conversion, so
source frames may be duplicated or dropped. A fresh installed test of the
Rust player and Rust/Tauri recorder produced 90 CSV rows and 90 XDF affect
samples for a 90-frame `30000/1001` clip, with exact filename Start/Stop
markers. See [side-quest status](../../for-ai/74-VLC-FLUBBER-SIDE-QUEST.md).

This is an experimental VLC 3.0.20 video-filter plugin for Windows x64. It is
separate from Experiment Planner and Experiment Runner and is not an approved
replacement for either program.

The launcher converts a source clip with FFmpeg to constant-frame-rate H.264
with a black panel below the original video. The **VLC plugin** draws a moving
Flubber into that panel on each decoded frame. The plugin handles arrow-key
input and flushes affect values to CSV in real time. Optional liblsl outlets
send affect samples and video start/end markers to an external recorder.

The native filter generates an SVG path from the circle-based 192-point,
16-wave geometry in `site/src/math.js`. A bundled Rust `resvg` library renders
that path with antialiased edges inside the VLC process. The filter composites
the resulting pixels into VLC's video output. No browser or Python process
draws the Flubber. The current native path still supports only the circle
profile and is not yet visually identical to every HTML/SVG setting.

## Requirements

- VLC **3.0.20 x64** installed at `C:\Program Files\VideoLAN\VLC` (or pass
  `-VlcDir` to both scripts). Other VLC versions need an ABI review and rebuild.
- Visual Studio 2022 Community with the x64 C/C++ toolchain (or pass
  `-VisualStudioDir` to `build.ps1`).
- Rust/Cargo for the native SVG renderer; `ffmpeg` and `ffprobe` on `PATH` for
  playback.
- Windows PowerShell. `build.ps1` downloads hash-checked official VLC 3.0.20
  source headers and liblsl 1.17.7 into the ignored `build/` directory.

## Build and run

From this directory:

```powershell
.\build.ps1
.\run.ps1 -Video 'C:\clips\example.mp4'
```

The launcher prints the converted clip and CSV paths. Its visible VLC video
window needs keyboard focus. Left/right change valence; down/up change
arousal. Each press changes the value by 0.10 by default, clamped to [-1, 1].
The current input mapping is `left/right = valence -/+`, `down/up = arousal
-/+`. Playback starts with both at 0. The Flubber also moves between presses.

To preconfigure a clip, put `example.flubber.json` beside `example.mp4`:

```json
{
  "schema": "vlc-flubber-sidequest/v1",
  "panelPercent": 25,
  "stepPercent": 10,
  "lsl": false,
  "csvPath": "example-affect.csv"
}
```

`panelPercent` is Flubber-panel height as a percentage of original video
height: 25 means a 4:1 video-to-panel height ratio. It accepts 10–100.
Command-line settings override the sidecar. A relative `csvPath` is resolved
beside the source clip. Without a sidecar, the defaults are 25%, 10% key
steps, CSV in `build/recordings/`, and LSL off. The launcher handles the
conversion cache and passes the required video geometry to VLC; opening the
source clip directly in stock VLC does not activate this probe.

For LSL, use `-Lsl` or set `"lsl": true` in the sidecar. An external LSL
recorder can subscribe to:

| Stream | Type | Channels / samples |
| --- | --- | --- |
| `VLC_Flubber_Affect` | `Affect` | float32 `[valence, arousal]`, one per rendered video frame |
| `VLC_Flubber_Markers` | `Markers` | string `video_start`, `video_end` |

VLC itself writes CSV, not XDF. CSV columns are `event,video_ms,valence,
arousal,phase_rad`; `sample` rows describe frames, arrow-key rows capture
changes, and start/end rows mark the VLC filter lifetime. `video_ms` is the
converted video frame index divided by its frame rate. LSL timestamps use
liblsl's live local clock. Record both streams externally if XDF is needed.

The native filter also creates a `-timeseries.csv` beside that event CSV
automatically. It contains exactly three variables, `time_s,valence,arousal`,
with one row per rendered video frame and no event rows. Time starts at zero
on the first video frame. Each row is flushed during playback, and the file
ends with the final frame before video stop. The standalone launcher chooses
the output path automatically when `-Csv` is omitted and prints both paths.

## Focused native validation

Generate a synthetic clip and run the standalone native player path:

```powershell
$base = (Resolve-Path .).Path
New-Item -ItemType Directory -Force -Path "$base\build\input" | Out-Null
$inputVideo = "$base\build\input\probe.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi `
  -i 'testsrc2=size=640x360:rate=60' -t 8 `
  -c:v libx264 -crf 18 -pix_fmt yuv420p -y $inputVideo
.\run.ps1 -Video $inputVideo -Headless
```

On 2026-10-05, the SVG renderer built and passed its Rust pixel test. VLC
completed a 640x360, 60-fps, three-second clip with 180 time-series CSV rows
starting at 0 seconds and ending at 2.983333 seconds. YUV output contained all
180 frames, and its frame 0 and frame 60 Flubber panel hashes differed. A
1920x1080 source with a 540-pixel Flubber panel completed with 72 of 72 frames
and matching CSV samples. The [native animation preview](evidence/svg-flubber-native-animation.gif)
and [full-resolution frames 0](evidence/svg-frame-000-1080p.png) and
[30](evidence/svg-frame-030-1080p.png) came from VLC's YUV output. They show
smooth SVG-rendered edges and a changing shape; they do not measure physical
display latency or prove every video format or machine.
An additional five-second 1920x1080/60-fps run wrote 300 of 300 expected
time-series rows and a final video-end event.

The earlier [LSL loopback receipt](evidence/lsl-loopback.json) and
[C-raster frames](evidence/frame-000.png) are historical checks of the
pre-SVG plugin. The newer installed Rust player and recorder loopback is
reported above and in [side-quest status](../../for-ai/74-VLC-FLUBBER-SIDE-QUEST.md).

## Current limits

- The SVG build has focused 640x360 and 1920x1080 source checks at 60 fps,
  with a 50% panel ratio. Other ratios, decoders, machines, long sessions,
  input-to-display latency, and LSL loopback with this exact build remain open.
- SVG is rasterized at the padded video output size. Enlarging a low-resolution
  video window beyond that size cannot preserve vector sharpness; a separate
  display-resolution overlay would need another VLC integration pass.
- FFmpeg uses H.264 CRF 18 and copies supported audio/subtitle streams. Source
  pixels are re-encoded. The video-to-panel geometry is preserved; source
  codec support and output stream compatibility are not universal.
- The CSV clock assumes linear playback of the converted constant-frame-rate
  clip. Seeking, loops, severe frame drops, and abrupt process termination are
  outside this probe's timing and end-marker guarantees.
- LSL affect samples emitted before a receiver connects are held for at most
  1024 frames. A receiver that joins much later can miss early samples; the
  start marker is replayed to the first receiver with its original clock time.
- This development probe is not a research-qualified player or an approved
  main-suite integration. Separate packaged player and recorder candidates
  are documented above; their installed results do not qualify research use.

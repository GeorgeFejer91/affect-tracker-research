# Native VLC Flubber feasibility probe

The separate [Flubbercorder experiment runner](flubbercorder/README.md)
extends this filter with an experimenter window, native XDF recorder, remote
affect channel, filename-based markers, and a Windows installer. The probe
instructions and receipts below document the earlier standalone filter check.

This is an experimental VLC 3.0.20 video-filter plugin for Windows x64. It is
separate from Experiment Planner and Experiment Runner and is not an approved
replacement for either program.

The launcher converts a source clip with FFmpeg to constant-frame-rate H.264
with a black panel below the original video. The **VLC plugin** draws a moving
Flubber into that panel on each decoded frame. The plugin handles arrow-key
input and flushes affect values to CSV in real time. Optional liblsl outlets
send affect samples and video start/end markers to an external recorder.

The shape uses a native C raster implementation of the circle-based 192-point,
16-wave geometry in `site/src/math.js`. VLC does not run the project's SVG DOM
renderer. This proves responsive native drawing, not pixel-identical SVG.

## Requirements

- VLC **3.0.20 x64** installed at `C:\Program Files\VideoLAN\VLC` (or pass
  `-VlcDir` to both scripts). Other VLC versions need an ABI review and rebuild.
- Visual Studio 2022 Community with the x64 C/C++ toolchain (or pass
  `-VisualStudioDir` to `build.ps1`).
- `ffmpeg` and `ffprobe` on `PATH` for playback; Python 3 only for the
  independent LSL validation script.
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

## Reproduce the focused loopback

The included `verify_lsl.py` runs a converted video through the plugin and
subscribes with an independent liblsl inlet. Generate a synthetic clip, let
the launcher convert it, then run the independent receiver:

```powershell
$base = (Resolve-Path .).Path
New-Item -ItemType Directory -Force -Path "$base\build\input" | Out-Null
$inputVideo = "$base\build\input\probe.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi `
  -i 'testsrc2=size=640x360:rate=60' -t 8 `
  -c:v libx264 -crf 18 -pix_fmt yuv420p -y $inputVideo
.\run.ps1 -Video $inputVideo -Headless
$hash = (Get-FileHash $inputVideo -Algorithm SHA256).Hash.Substring(0,16).ToLowerInvariant()
$converted = "$base\build\media\probe-$hash-p25-f60.mkv"
python .\verify_lsl.py `
  --vlc 'C:\Program Files\VideoLAN\VLC\vlc.exe' `
  --plugin-dir "$base\build\plugins" `
  --lsl-dll "$base\build\deps\liblsl-1.17.7-Win_amd64\bin\lsl.dll" `
  --video $converted `
  --video-height 360 --panel-percent 25 --render-fps 60 `
  --csv "$base\build\recordings\loopback.csv" `
  --receipt "$base\build\recordings\loopback.json"
```

The check requires process exit 0, equal CSV/LSL affect counts, monotonic LSL
timestamps, exactly one start and end event in each output, and marker span
within 0.3 seconds of the CSV video span. Repeated eight-second 640x360/60-fps
runs on 2026-10-04 produced 477–479 matching CSV/LSL affect samples and both
markers. The exact sample count varies because startup loses a few frames;
these runs establish feasibility, not zero-loss playback.

The [loopback receipt](evidence/lsl-loopback.json) and captured native output
frames [0](evidence/frame-000.png) and [60](evidence/frame-060.png) are checked
in. The frames show a 50% panel ratio (640x360 video + 180-pixel Flubber panel)
with VLC's title overlay disabled. A sidecar with spaces in both the input and
CSV paths completed an eight-second 50% ratio run with 480 frame samples and
both events.

## Current limits

- Validated only on the pinned Windows VLC build with WinGDI output and the
  raw YUV capture output, using 640x360, 60-fps input at 10%, 25%, and 50% panel
  ratios. Other resolutions, ratios, decoders, machines, and long sessions
  need validation.
- FFmpeg uses H.264 CRF 18 and copies supported audio/subtitle streams. Source
  pixels are re-encoded. The video-to-panel geometry is preserved; source
  codec support and output stream compatibility are not universal.
- The CSV clock assumes linear playback of the converted constant-frame-rate
  clip. Seeking, loops, severe frame drops, and abrupt process termination are
  outside this probe's timing and end-marker guarantees.
- LSL affect samples emitted before a receiver connects are held for at most
  1024 frames. A receiver that joins much later can miss early samples; the
  start marker is replayed to the first receiver with its original clock time.
- This is not a research-qualified player, an XDF recorder, a packaged VLC
  installer, or an approved main-suite integration.

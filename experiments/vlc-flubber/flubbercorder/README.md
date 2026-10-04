# Flubbercorder: VLC ExperimentRunner side project

Flubbercorder is an experimental Windows x64 experiment runner, separate from
the approved Affect Research Planner and Runner. The local browser window is
the experimenter console. It prepares media with FFmpeg, starts VLC, checks
the VLC LSL outlets and the native recorder's subscriptions, controls playback
and Flubber affect, shows live LSL values, and records XDF. VLC writes its own
CSV in parallel as an independent fallback; Flubbercorder does not read that
CSV to drive the live display.

The public Windows installer is built from `../package.ps1` and
`../installer.iss`. It bundles pinned VLC 3.0.20, FFmpeg 8.1.2 essentials,
Python 3.12.10, liblsl, the native VLC plugin, and the recorder. The installed
app opens the local control window from the Start menu. Data is written under
`%LOCALAPPDATA%\Flubbercorder\recordings` by default.

## Included trial experiment

The 0.2 installer candidate adds `demo/great-dictator.json` and the matching
`demo/dictator-3-study.mp4`. Opening the installed app without a recipe loads
this example automatically. Select **Prepare video and recorder**, wait for
the one-time media conversion and recorder readiness, then select **Start**.
VLC displays the clip with Flubber below it; the runner saves affect and
`dictator-3-study.mp4_Start`/`_Stop` markers to XDF, while VLC independently
saves a CSV. No external LSL stream is required for this example. Enter a
different JSON path and select **Load** to run another experiment.

The package build requires the exact 86,870,779-byte study clip previously
identified in the research project, with SHA-256
`B5327E7465EC92A4C93F3236A1EBAB4556CDF508E24EAFE6C593EAC1E13AFD49`.
Pass its local path to `package.ps1 -DemoVideo <path>` or place it at
`build/demo/dictator-3-study.mp4`. The build checks the hash before bundling it.
Public distribution of an installer containing this film requires the
appropriate clip redistribution rights.

## Run an experiment

Create a JSON file next to your source video:

```json
{
  "schema": "flubbercorder-experiment/v1",
  "video": "NameVideo.mp4",
  "panelPercent": 25,
  "stepPercent": 10,
  "requiredStreams": []
}
```

`video` may be an absolute path or a path relative to the JSON file.
`panelPercent` sets the Flubber panel height relative to the source video.
`stepPercent` sets the valence/arousal change per direction command.
`requiredStreams` lists names of additional LSL streams that must be present
and selected for recording. VLC's affect and marker streams are included
automatically. This is a side-project schema, not a Planner master recipe.

In the experimenter window, enter the JSON path, select **Load**, then
**Prepare video and recorder**. Preparation converts the video to a constant
frame rate H.264/MKV clip with a reserved Flubber panel. The converted clip
contains a black lead and tail, so VLC's native LSL outlets can appear and
the recorder can subscribe before the original video starts. Select **Start**
to launch VLC. Start fails closed if either Flubber outlet is undiscoverable
or the native recorder does not subscribe before the video boundary. Use the
arrow controls in the window or the optional phone view to change affect.
Pause, Resume and Stop control VLC playback. The Flubber is rendered by the
native VLC filter and the original video's filename is used for LSL markers:
`NameVideo.mp4_Start` and `NameVideo.mp4_Stop`.

The XDF contains the two Flubber streams and the selected external streams.
The runner checks XDF chunk/footer integrity and verifies the two exact marker
labels before promoting `.xdf.partial` to `.xdf`. A separate VLC CSV holds
video-relative affect rows and start/end events. The control window displays
the paths when a session completes.

## Optional phone controller

Start the installed app with
`python\pythonw.exe app\app.py --phone-host <trusted LAN IPv4>` from its
installation directory. The experimenter window shows a pairing link. Open
it on the phone, then select **Give phone control** locally. The phone can
start, pause, resume, stop, and change affect, and sees live stream/recorder
status. **Revoke phone control** disables those commands. The phone role
cannot load a JSON file or prepare media. This prototype uses HTTP on the
selected LAN; use a trusted network and do not expose the port publicly.

## Reproduce the installed validation

On Windows with VLC 3.0.20 and the MSVC toolchain, run `..\package.ps1`,
compile `..\installer.iss` with Inno Setup 6, install to an isolated directory,
then run `test_session.py` using that installation's `python.exe` and set
`FLUBBERCORDER_APP` to its `app\app.py`. The test generates a five-second
source clip and requires 300 affect samples, matching VLC CSV and XDF counts,
right/up affect changes, and exact `<filename>_Start`/`_Stop` labels in XDF.
The GitHub workflow performs the same installed check before releasing.

Current qualification covers the pinned Windows runtime, a five-second
synthetic clip, and one full naturally completed installed run of the bundled
254-second study clip. The latter produced 15,264 matching VLC CSV and XDF
affect samples with both exact filename markers in XDF. Varied source codecs,
physical keyboard timing, external device timing, and research-grade onset
latency need separate measurement. The converted video is re-encoded, although
its content and geometry are retained.

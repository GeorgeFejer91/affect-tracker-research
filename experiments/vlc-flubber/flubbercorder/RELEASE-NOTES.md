# VLC ExperimentRunner 0.2.0

This is a separate, experimental Flubbercorder side project. It is not an
approved part of the main Affect Research Experiment Planner or Runner.

The installer includes a simple Great Dictator demo JSON and its matching study
clip. Open VLC ExperimentRunner from the Start menu: the demo is already loaded.
Select **Prepare video and recorder** (the first media conversion takes some
time), then **Start** to play and record. A different JSON can still be loaded
from the experimenter window.

The Windows x64 installer bundles pinned VLC 3.0.20, FFmpeg 8.1.2 essentials,
Python 3.12.10, the native VLC Flubber filter, and a native LSL/XDF recorder.
Load a `flubbercorder-experiment/v1` JSON file in the experimenter window. The
runner prepares video with a Flubber panel, launches VLC, gates on discovery and
recorder subscription of both Flubber LSL streams before the source clip begins,
and records the affect time series and `<video filename>_Start` and
`<video filename>_Stop` markers to XDF. VLC independently writes a fallback CSV.

The optional phone view can be enabled on a trusted local network with
`--phone-host <LAN IPv4>` when launching `python/pythonw.exe app/app.py`.
The current remote transport is HTTP, so it should not be exposed to an
untrusted network. See `licenses/THIRD-PARTY.md` in the installation for
bundled component licenses and source locations.

Validation covers a full naturally completed installed run of the bundled
254-second study clip: 15,264 affect samples in both XDF and VLC's independent
CSV, with the exact filename Start/Stop markers in XDF. An installed early-Stop
run of that clip also passed. A separate installed run with a five second
source recorded 300 continuous affect samples, two exact named markers in
XDF, working affect commands, and a matching independent VLC CSV. Additional
installed checks cover a missing required stream, recording a selected external
stream, pause/resume, and an early stop with a closed XDF. Other hardware,
codecs, longer sessions, and research timing accuracy remain to be qualified.

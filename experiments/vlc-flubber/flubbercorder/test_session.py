"""One actual VLC/LSL/XDF session through the Flubbercorder HTTP authority."""
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import signal
import tempfile
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import uuid
import argparse
import ctypes as c
import threading


HERE = Path(__file__).resolve().parent
APP = Path(os.environ.get("FLUBBERCORDER_APP", HERE / "app.py"))
PACKAGED_ROOT = APP.parent.parent if (APP.parent.parent / "ffmpeg/ffmpeg.exe").is_file() else None
FFMPEG = str(PACKAGED_ROOT / "ffmpeg/ffmpeg.exe") if PACKAGED_ROOT else "ffmpeg"
FFPROBE = str(PACKAGED_ROOT / "ffmpeg/ffprobe.exe") if PACKAGED_ROOT else "ffprobe"


def main(external=False, missing=False, pause=False, stop=False):
    outlet = None
    outlet_info = None
    stop_publisher = threading.Event()
    if external:
        dll_path = (PACKAGED_ROOT / "lsl.dll" if PACKAGED_ROOT else
                    HERE.parent / "build/deps/liblsl-1.17.7-Win_amd64/bin/lsl.dll")
        dll = c.CDLL(str(dll_path))
        create_info = dll.lsl_create_streaminfo
        create_info.restype = c.c_void_p
        create_info.argtypes = [c.c_char_p, c.c_char_p, c.c_int32, c.c_double,
                                c.c_int32, c.c_char_p]
        create_outlet = dll.lsl_create_outlet
        create_outlet.restype = c.c_void_p
        create_outlet.argtypes = [c.c_void_p, c.c_int32, c.c_int32]
        push = dll.lsl_push_sample_f
        push.restype = c.c_int32
        push.argtypes = [c.c_void_p, c.POINTER(c.c_float)]
        outlet_info = create_info(b"Flubbercorder_Test_Auxiliary", b"Auxiliary", 1,
                                  20.0, 1, ("test-aux-" + uuid.uuid4().hex).encode())
        assert outlet_info
        outlet = create_outlet(outlet_info, 0, 360)
        assert outlet
        def publish():
            sample = (c.c_float * 1)(0.5)
            while not stop_publisher.is_set():
                push(outlet, sample)
                stop_publisher.wait(.05)
        threading.Thread(target=publish, daemon=True).start()
    with tempfile.TemporaryDirectory() as temp_name:
        temp = Path(temp_name)
        video = temp / "source.mp4"
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                        "-i", "testsrc2=size=320x180:rate=30", "-t", "5",
                        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
                        "-y", str(video)], check=True)
        recipe = temp / "study.json"
        recipe.write_text(json.dumps({"schema": "flubbercorder-experiment/v1",
                                      "video": "source.mp4", "panelPercent": 25,
                                      "stepPercent": 10,
                                      "requiredStreams": (["Flubbercorder_Test_Auxiliary"] if external else
                                                          ["DefinitelyMissingFlubbercorderStream"] if missing else [])}))
        command = [sys.executable, str(APP), str(recipe), "--no-open",
                   "--data-dir", str(temp / "data")]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, bufsize=1)
        state = None
        try:
            line = process.stdout.readline().strip()
            assert line.startswith("Local Flubbercorder: "), line
            url = line.split(": ", 1)[1]
            base, token = url.split("/#local:")

            def api(path, action=None):
                body = None if action is None else json.dumps({"id": str(uuid.uuid4()),
                                                               "action": action}).encode()
                request = Request(base + path, data=body, headers={
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/json"})
                try:
                    with urlopen(request, timeout=15) as response:
                        return json.load(response)
                except HTTPError as error:
                    raise AssertionError(error.read().decode()) from error

            assert api("/state")["phase"] == "loaded"
            api("/command", "prepare")
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                state = api("/state")
                if state["phase"] in ("armed", "error"):
                    break
                time.sleep(.2)
            if missing:
                assert state["phase"] == "error", state
                assert "Required LSL stream must be present once" in state["error"]
                print("Missing external stream gate passed")
                return
            assert state["phase"] == "armed", state
            prepared = next((temp / "data/media").glob("*.mkv"))
            report = subprocess.run([FFPROBE, "-v", "error", "-count_frames",
                                     "-select_streams", "v:0", "-show_entries",
                                     "stream=nb_read_frames:format=duration", "-of", "json",
                                     str(prepared)], capture_output=True, text=True, check=True)
            assert json.loads(report.stdout)["streams"][0]["nb_read_frames"] == "720"
            start_called = time.monotonic()
            api("/command", "start")
            print("Start command seconds", round(time.monotonic() - start_called, 2))
            clock_dll = c.CDLL(str(PACKAGED_ROOT / "lsl.dll" if PACKAGED_ROOT else
                                   HERE.parent / "build/deps/liblsl-1.17.7-Win_amd64/bin/lsl.dll"))
            clock_dll.lsl_local_clock.restype = c.c_double
            fresh_state = api("/state")
            marker_age = clock_dll.lsl_local_clock() - fresh_state["lsl"]["markers"][-1]["lslTime"]
            assert 0 <= marker_age < 1, marker_age
            time.sleep(.5)
            api("/command", "right")
            api("/command", "up")
            time.sleep(.4)
            if pause:
                api("/command", "pause")
                assert api("/state")["phase"] == "paused"
                time.sleep(.3)
                api("/command", "resume")
            if stop:
                api("/command", "stop")
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                state = api("/state")
                if state["phase"] in ("complete", "error"):
                    break
                time.sleep(.2)
            assert state["phase"] == "complete", state
            csv_path, xdf_path = Path(state["csvPath"]), Path(state["xdfPath"])
            assert csv_path.is_file() and xdf_path.is_file()
            with csv_path.open(newline="") as handle:
                rows = list(csv.DictReader(handle))
            events = [row["event"] for row in rows]
            assert "video_start" in events and events[-1] == "video_end", events[-10:]
            assert "right" in events and "up" in events, events[-10:]
            if stop:
                assert 1 < events.count("sample") < 300, events.count("sample")
            elif pause:
                assert 295 <= events.count("sample") <= 305, events.count("sample")
                assert 4900 <= int(rows[-1]["video_ms"]) <= 5100, rows[-1]
            else:
                assert events.count("sample") == 300, events.count("sample")
                assert rows[-1]["video_ms"] == "4983", rows[-1]
            assert {"source.mp4_Start", "source.mp4_Stop"} <= {
                m["label"] for m in state["lsl"]["markers"]}
            marker_span = state["lsl"]["markers"][-1]["lslTime"] - state["lsl"]["markers"][0]["lslTime"]
            if stop:
                assert marker_span < 2, marker_span
            elif pause:
                assert marker_span > 5.2, marker_span
            else:
                assert 4.9 < marker_span < 5.4, marker_span
            assert next(s["labels"] for s in state["summary"] if s["name"] == "VLC_Flubber_Markers") == [
                "source.mp4_Start", "source.mp4_Stop"]
            if external:
                assert next(s["samples"] for s in state["summary"]
                            if s["name"] == "Flubbercorder_Test_Auxiliary") > 0
            print("Completed:", xdf_path, state["summary"],
                  "CSV samples", events.count("sample"), "CSV end ms", rows[-1]["video_ms"],
                  "marker span", marker_span)
        finally:
            for key in ("vlcPid", "recorderPid"):
                if state and state.get(key):
                    try:
                        os.kill(state[key], signal.SIGTERM)
                    except OSError:
                        pass
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
            time.sleep(.5)
            errors = process.stderr.read()
            if errors:
                print(errors[-2000:])
            stop_publisher.set()
            if outlet:
                dll.lsl_destroy_outlet.argtypes = [c.c_void_p]
                dll.lsl_destroy_outlet(outlet)
                dll.lsl_destroy_streaminfo.argtypes = [c.c_void_p]
                dll.lsl_destroy_streaminfo(outlet_info)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--external", action="store_true")
    group.add_argument("--missing", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--pause", action="store_true")
    mode.add_argument("--stop", action="store_true")
    options = parser.parse_args()
    main(options.external, options.missing, options.pause, options.stop)

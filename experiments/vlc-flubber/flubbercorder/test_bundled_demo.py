"""Installed demo smoke test: default recipe, real study clip, VLC, CSV and XDF."""
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
import uuid


APP = Path(os.environ["FLUBBERCORDER_APP"]).resolve()
ROOT = APP.parent.parent
DEMO = ROOT / "demo/great-dictator.json"
VIDEO = ROOT / "demo/dictator-3-study.mp4"
START = "dictator-3-study.mp4_Start"
STOP = "dictator-3-study.mp4_Stop"


def main():
    assert DEMO.is_file() and VIDEO.is_file(), "The installed demo is incomplete"
    assert json.loads(DEMO.read_text(encoding="utf-8"))["video"] == VIDEO.name
    with tempfile.TemporaryDirectory() as temp:
        process = subprocess.Popen([sys.executable, str(APP), "--no-open", "--data-dir", temp],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            line = process.stdout.readline().strip()
            assert line.startswith("Local Flubbercorder: "), line
            base, token = line.split(": ", 1)[1].split("/#local:")

            def api(path, action=None):
                body = None if action is None else json.dumps({"id": str(uuid.uuid4()),
                                                               "action": action}).encode()
                request = Request(base + path, data=body, headers={
                    "Authorization": "Bearer " + token,
                    "Content-Type": "application/json"})
                with urlopen(request, timeout=20) as response:
                    return json.load(response)

            state = api("/state")
            assert state["phase"] == "loaded" and Path(state["recipePath"]) == DEMO, state
            assert state["video"] == VIDEO.name, state
            assert state["bundledDemo"] is True, state
            api("/command", "prepare")
            deadline = time.monotonic() + 900
            last_report = 0
            while time.monotonic() < deadline:
                state = api("/state")
                if state["phase"] in ("armed", "error"):
                    break
                elapsed = int(time.monotonic() - (deadline - 900))
                if elapsed - last_report >= 30:
                    print(f"Preparing bundled study clip: {elapsed}s", flush=True)
                    last_report = elapsed
                time.sleep(1)
            assert state["phase"] == "armed", state
            api("/command", "start")
            state = api("/state")
            assert state["phase"] == "running", state
            assert any(marker["label"] == START for marker in state["lsl"]["markers"]), state
            api("/command", "right")
            time.sleep(1)
            api("/command", "stop")
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                state = api("/state")
                if state["phase"] in ("complete", "error"):
                    break
                time.sleep(.2)
            assert state["phase"] == "complete", state
            assert Path(state["xdfPath"]).is_file() and Path(state["csvPath"]).is_file()
            markers = next(s["labels"] for s in state["summary"]
                           if s["name"] == "VLC_Flubber_Markers")
            assert markers == [START, STOP], markers
            with Path(state["csvPath"]).open(newline="") as handle:
                events = [row["event"] for row in csv.DictReader(handle)]
            assert "video_start" in events and "right" in events and events[-1] == "video_end"
            print("Bundled demo passed:", VIDEO.name, len(events), "CSV rows;",
                  markers, "in XDF", flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            errors = process.stderr.read()
            if process.returncode not in (0, -15, 1) and errors:
                print(errors[-2000:])


if __name__ == "__main__":
    main()

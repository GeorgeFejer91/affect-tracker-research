"""Experimental VLC experiment controller and LSL/XDF recorder for Windows."""
from __future__ import annotations

import argparse
import ctypes as c
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET


HERE = Path(__file__).resolve().parent
PROBE = HERE.parent
BUILD = PROBE / "build"
PACKAGED = (PROBE / "vlc/vlc.exe").is_file()
RUNTIME = PROBE if PACKAGED else BUILD
STREAM_NAME = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
EVENTS = {"left", "right", "up", "down"}
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def recipe_from_file(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(raw, dict) and raw.get("schema") == "flubbercorder-experiment/v1",
            "Expected a flubbercorder-experiment/v1 JSON file")
    require(set(raw) <= {"schema", "video", "panelPercent", "stepPercent", "requiredStreams"},
            "Unknown experiment setting")
    require(isinstance(raw.get("video"), str) and raw["video"], "video must be a path")
    video = (path.parent / raw["video"]).resolve()
    require(video.is_file(), f"Video does not exist: {video}")
    panel = raw.get("panelPercent", 25)
    step = raw.get("stepPercent", 10)
    require(type(panel) is int and 10 <= panel <= 100, "panelPercent must be 10–100")
    require(type(step) is int and 1 <= step <= 100, "stepPercent must be 1–100")
    names = raw.get("requiredStreams", [])
    require(isinstance(names, list) and len(names) <= 16 and
            all(isinstance(n, str) and STREAM_NAME.fullmatch(n) for n in names) and
            len(set(names)) == len(names), "requiredStreams must be unique LSL stream names")
    require(not set(names) & {"VLC_Flubber_Affect", "VLC_Flubber_Markers"},
            "Flubber streams are included automatically")
    return {"video": video, "panelPercent": panel, "stepPercent": step,
            "requiredStreams": names, "recipe": path.resolve()}


def bind(dll, name, result, *args):
    fn = getattr(dll, name)
    fn.restype, fn.argtypes = result, list(args)
    return fn


class LslMonitor:
    """Independent bounded LSL preview; the native recorder owns the XDF."""

    def __init__(self, dll_path: Path):
        self.dll = c.CDLL(str(dll_path))
        d = self.dll
        self.resolve = bind(d, "lsl_resolve_byprop", c.c_int32, c.POINTER(c.c_void_p),
                            c.c_uint32, c.c_char_p, c.c_char_p, c.c_int32, c.c_double)
        self.name = bind(d, "lsl_get_name", c.c_char_p, c.c_void_p)
        self.source = bind(d, "lsl_get_source_id", c.c_char_p, c.c_void_p)
        self.destroy_info = bind(d, "lsl_destroy_streaminfo", None, c.c_void_p)
        self.create_inlet = bind(d, "lsl_create_inlet", c.c_void_p, c.c_void_p,
                                 c.c_int32, c.c_int32, c.c_int32)
        self.open_stream = bind(d, "lsl_open_stream", None, c.c_void_p, c.c_double,
                                c.POINTER(c.c_int32))
        self.destroy_inlet = bind(d, "lsl_destroy_inlet", None, c.c_void_p)
        self.pull_float = bind(d, "lsl_pull_sample_f", c.c_double, c.c_void_p,
                               c.POINTER(c.c_float), c.c_int32, c.c_double,
                               c.POINTER(c.c_int32))
        self.pull_string = bind(d, "lsl_pull_sample_str", c.c_double, c.c_void_p,
                                c.POINTER(c.c_void_p), c.c_int32, c.c_double,
                                c.POINTER(c.c_int32))
        self.destroy_string = bind(d, "lsl_destroy_string", None, c.c_void_p)
        self.inlets = {}
        self.streams = {}
        self.value = None
        self.markers = []
        self.lock = threading.Lock()
        self.running = True
        threading.Thread(target=self._run, daemon=True, name="flubber-lsl-preview").start()

    def discover(self, name):
        buffer = (c.c_void_p * 4)()
        count = self.resolve(buffer, 4, b"name", name.encode(), 1, 0.1)
        found = []
        for i in range(count):
            info = buffer[i]
            found.append((self.source(info).decode("utf-8", "replace"), info))
        return found

    def _run(self):
        last_discovery = 0.0
        while self.running:
            now = time.monotonic()
            if now - last_discovery >= 0.8:
                last_discovery = now
                for name in ("VLC_Flubber_Affect", "VLC_Flubber_Markers"):
                    found = self.discover(name)
                    with self.lock:
                        self.streams[name] = [source for source, _ in found]
                    for source, info in found:
                        try:
                            if (name, source) not in self.inlets:
                                inlet = self.create_inlet(info, 360, 0, 1)
                                if inlet:
                                    error = c.c_int32()
                                    self.open_stream(inlet, 0.2, c.byref(error))
                                    if not error.value:
                                        self.inlets[name, source] = inlet
                                    else:
                                        self.destroy_inlet(inlet)
                        finally:
                            self.destroy_info(info)
            for (name, source), inlet in list(self.inlets.items()):
                error = c.c_int32()
                if name == "VLC_Flubber_Affect":
                    sample = (c.c_float * 2)()
                    stamp = self.pull_float(inlet, sample, 2, 0.0, c.byref(error))
                    if stamp > 0:
                        with self.lock:
                            self.value = {"valence": round(float(sample[0]), 4),
                                          "arousal": round(float(sample[1]), 4),
                                          "lslTime": stamp, "sourceId": source}
                else:
                    sample = (c.c_void_p * 1)()
                    stamp = self.pull_string(inlet, sample, 1, 0.0, c.byref(error))
                    if stamp > 0 and sample[0]:
                        label = c.string_at(sample[0]).decode("utf-8", "replace")
                        self.destroy_string(sample[0])
                        with self.lock:
                            self.markers.append({"label": label, "lslTime": stamp,
                                                 "sourceId": source})
                            self.markers = self.markers[-32:]
            time.sleep(0.03)

    def snapshot(self):
        with self.lock:
            return {"streams": dict(self.streams), "value": self.value,
                    "markers": list(self.markers)}


def inspect_xdf(path: Path, expected_source: str, expected_markers):
    """Check XDF chunk bounds, stream footers, and the two Flubber data streams."""
    streams = {}

    def number(handle):
        width = handle.read(1)
        require(width in (b"\x01", b"\x04", b"\x08"), "Invalid XDF length")
        data = handle.read(width[0])
        require(len(data) == width[0], "Truncated XDF length")
        return int.from_bytes(data, "little")

    size = path.stat().st_size
    with path.open("rb") as handle:
        require(handle.read(4) == b"XDF:", "Missing XDF header")
        while handle.tell() < size:
            length = number(handle)
            end = handle.tell() + length
            require(length >= 2 and end <= size, "Truncated XDF chunk")
            tag = int.from_bytes(handle.read(2), "little")
            if tag in (2, 3, 4, 6):
                require(length >= 6, "Invalid XDF stream chunk")
                stream_id = int.from_bytes(handle.read(4), "little")
                if tag == 2:
                    require(length < 1_000_000 and stream_id not in streams,
                            "Invalid XDF stream header")
                    info = ET.fromstring(handle.read(end - handle.tell()))
                    streams[stream_id] = {"name": info.findtext("name", ""),
                                          "sourceId": info.findtext("source_id", ""),
                                          "samples": 0, "footer": None, "labels": []}
                else:
                    require(stream_id in streams, "XDF data precedes stream header")
                    if tag == 3:
                        count = number(handle)
                        streams[stream_id]["samples"] += count
                        if streams[stream_id]["sourceId"] == f"{expected_source}-markers":
                            require(count <= 10000, "Invalid marker chunk length")
                            for _ in range(count):
                                stamp_width = handle.read(1)
                                require(stamp_width in (b"\x00", b"\x08"),
                                        "Invalid marker timestamp")
                                handle.seek(stamp_width[0], 1)
                                label_size = number(handle)
                                require(label_size <= 1024 and handle.tell() + label_size <= end,
                                        "Invalid marker label")
                                streams[stream_id]["labels"].append(
                                    handle.read(label_size).decode("utf-8"))
                    elif tag == 6:
                        info = ET.fromstring(handle.read(end - handle.tell()))
                        streams[stream_id]["footer"] = int(info.findtext("sample_count", "-1"))
            require(handle.tell() <= end, "Invalid XDF chunk contents")
            handle.seek(end)
    require(streams and all(s["footer"] == s["samples"] for s in streams.values()),
            "Missing or inconsistent XDF footer")
    for name, suffix, minimum in (("VLC_Flubber_Affect", "affect", 1),
                                  ("VLC_Flubber_Markers", "markers", 2)):
        matches = [s for s in streams.values() if s["name"] == name and
                   s["sourceId"] == f"{expected_source}-{suffix}"]
        require(len(matches) == 1 and matches[0]["samples"] >= minimum,
                f"XDF missing {name} data: {list(streams.values())}")
        if suffix == "markers":
            require(matches[0]["labels"] == list(expected_markers),
                    f"XDF marker labels differ: {matches[0]['labels']}")
    return list(streams.values())


class Recorder:
    def __init__(self, executable: Path):
        self.executable = executable
        self.process = None
        self.partial = None
        self.subscribed = {}
        self.first_data = set()
        self.error = None
        self.lock = threading.Lock()

    def start(self, partial: Path, external_names):
        require(self.executable.is_file(), f"Missing native recorder: {self.executable}")
        require(not partial.exists(), "Recording already exists")
        names = ["VLC_Flubber_Affect", "VLC_Flubber_Markers", *external_names]
        query = " or ".join(f"name='{name}'" for name in names)
        self.partial = partial
        self.process = subprocess.Popen([str(self.executable), str(partial), query],
                                        cwd=self.executable.parent, stdin=subprocess.PIPE,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                        creationflags=CREATE_NO_WINDOW)
        threading.Thread(target=self._read, daemon=True, name="flubber-recorder-receipts").start()
        time.sleep(0.15)
        require(self.process.poll() is None, "Native recorder exited during startup")

    def _read(self):
        for raw in self.process.stderr:
            line = raw.decode("utf-8", "replace").strip()
            with self.lock:
                if line.startswith("RESPYRA_RECORDER/1 "):
                    try:
                        source, name = (bytes.fromhex(value).decode("utf-8")
                                        for value in line.split()[1:3])
                        self.subscribed[source] = name
                    except (ValueError, IndexError, UnicodeError):
                        self.error = "Invalid native recorder receipt"
                elif line.startswith("RESPYRA_RECORDER_DATA/1 "):
                    try:
                        self.first_data.add(bytes.fromhex(line.split()[1]).decode("utf-8"))
                    except (ValueError, IndexError, UnicodeError):
                        self.error = "Invalid native recorder data receipt"
                elif "RESPYRA_RECORDER_ERROR" in line:
                    self.error = "Native recorder reported an error"

    def snapshot(self):
        with self.lock:
            return {"subscribed": dict(self.subscribed),
                    "firstData": sorted(self.first_data), "error": self.error,
                    "alive": self.process is not None and self.process.poll() is None}

    def finish(self, expected_source, expected_markers):
        require(self.process is not None, "Recorder never started")
        if self.process.poll() is None:
            time.sleep(0.6)  # Let the last LSL marker reach the native chunk reader.
            self.process.stdin.write(b"\n")
            self.process.stdin.flush()
            self.process.stdin.close()
        try:
            code = self.process.wait(timeout=12)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
            raise RuntimeError("Native recorder did not close; partial XDF preserved")
        require(code == 0 and not self.error, "Native recorder failed; partial XDF preserved")
        summary = inspect_xdf(self.partial, expected_source, expected_markers)
        final = self.partial.with_suffix("")
        require(not final.exists(), "XDF destination already exists")
        self.partial.replace(final)
        return final, summary


class AffectControl:
    """Single-writer command/ack channel shared with the native VLC filter."""

    class Memory(c.Structure):
        _fields_ = [("sequence", c.c_long), ("action", c.c_long),
                    ("applied", c.c_long)]

    DIRECTIONS = {"left": 1, "right": 2, "up": 3, "down": 4}

    def __init__(self, name):
        kernel = c.WinDLL("kernel32", use_last_error=True)
        self.open_mapping = bind(kernel, "OpenFileMappingW", c.c_void_p,
                                 c.c_uint32, c.c_int, c.c_wchar_p)
        self.map_view = bind(kernel, "MapViewOfFile", c.c_void_p, c.c_void_p,
                             c.c_uint32, c.c_uint32, c.c_uint32, c.c_size_t)
        self.unmap = bind(kernel, "UnmapViewOfFile", c.c_int, c.c_void_p)
        self.close_handle = bind(kernel, "CloseHandle", c.c_int, c.c_void_p)
        self.handle = self.open_mapping(0xF001F, 0, name)
        require(self.handle, "Native Flubber control channel is unavailable")
        self.address = self.map_view(self.handle, 0xF001F, 0, 0, c.sizeof(self.Memory))
        if not self.address:
            self.close_handle(self.handle)
            raise RuntimeError("Cannot map native Flubber control channel")
        self.memory = self.Memory.from_address(self.address)

    def send(self, direction):
        require(self.memory.applied == self.memory.sequence,
                "Previous Flubber command was not acknowledged")
        self.memory.action = self.DIRECTIONS[direction]
        sequence = self.memory.sequence + 1
        self.memory.sequence = sequence
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            if self.memory.applied == sequence:
                return
            time.sleep(0.005)
        raise RuntimeError("Native Flubber did not acknowledge the affect command")

    def close(self):
        if self.address:
            self.unmap(self.address)
            self.address = None
            self.close_handle(self.handle)
            self.handle = None


def prepare_media(recipe, cache: Path, ffmpeg, ffprobe):
    probe = subprocess.run([ffprobe, "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=width,height,r_frame_rate",
                            "-of", "json", str(recipe["video"])], capture_output=True,
                           text=True, check=True)
    streams = json.loads(probe.stdout).get("streams", [])
    require(len(streams) == 1, "Video must contain a video stream")
    stream = streams[0]
    width, height = int(stream["width"]), int(stream["height"])
    a, b = map(int, stream["r_frame_rate"].split("/"))
    require(b and width >= 64 and height >= 64 and 0 < a / b <= 120,
            "Unsupported source video geometry or frame rate")
    fps = max(60, (a + b - 1) // b)
    width, height = (width + 1) & ~1, (height + 1) & ~1
    panel = ((height * recipe["panelPercent"] + 199) // 200) * 2
    digest = hashlib.sha256()
    with recipe["video"].open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    name = f"{digest.hexdigest()[:20]}-p{recipe['panelPercent']}-f{fps}-lead5-tail2-v1.mkv"
    cache.mkdir(parents=True, exist_ok=True)
    output = cache / name
    if not output.exists():
        temp = cache / (name + ".partial")
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(recipe["video"]),
                   "-itsoffset", "5", "-i", str(recipe["video"]),
                   "-map", "0:v:0", "-map", "1:a?", "-map", "1:s?",
                   "-map_metadata", "-1", "-map_chapters", "-1", "-vf",
                   (f"fps={fps},pad={width}:{height + panel}:0:0:black,"
                    f"drawbox=x=0:y={height}:w=4:h=4:color=white:t=fill,"
                    "tpad=start_duration=5:start_mode=add:stop_duration=2:stop_mode=add"),
                   "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                   "-pix_fmt", "yuv420p", "-c:a", "copy", "-c:s", "copy",
                   "-fps_mode", "cfr", "-f", "matroska", "-y", str(temp)]
        try:
            subprocess.run(command, check=True, capture_output=True)
            temp.replace(output)
        finally:
            temp.unlink(missing_ok=True)
    return output, height, fps


class Session:
    def __init__(self, args):
        self.args = args
        self.lock = threading.RLock()
        self.phase = "empty"
        self.error = None
        self.revision = 0
        self.recipe = None
        self.vlc = None
        self.recorder = None
        self.csv = None
        self.vlc_command = None
        self.vlc_env = None
        self.control_name = None
        self.control = None
        self.discovery_missing_since = None
        self.xdf = None
        self.summary = None
        self.rc_port = None
        self.phone_enabled = False
        self.phone_url = None
        self.monitor = LslMonitor(args.lsl_dll)
        self.dedupe = {}
        threading.Thread(target=self._watch, daemon=True, name="flubber-session-watch").start()

    def load(self, path):
        recipe = recipe_from_file(Path(path).resolve())
        with self.lock:
            require(self.phase in {"empty", "complete", "error"},
                    "Stop the current experiment before loading another")
            self.recipe = recipe
            self.phase = "loaded"
            self.error = None
            self.revision += 1

    def prepare(self):
        with self.lock:
            require(self.phase == "loaded", "Load an experiment first")
            self.phase = "preparing"
            self.revision += 1
        threading.Thread(target=self._prepare, daemon=True, name="flubber-prepare").start()

    def _prepare(self):
        try:
            recipe = self.recipe
            for name in recipe["requiredStreams"]:
                found = self.monitor.discover(name)
                try:
                    require(len(found) == 1, f"Required LSL stream must be present once: {name}")
                finally:
                    for _, info in found:
                        self.monitor.destroy_info(info)
            video, height, fps = prepare_media(recipe, self.args.data_dir / "media",
                                               self.args.ffmpeg, self.args.ffprobe)
            stamp = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(4)
            recordings = self.args.data_dir / "recordings"
            recordings.mkdir(parents=True, exist_ok=True)
            csv_path = recordings / f"{stamp}.csv"
            partial = recordings / f"{stamp}.xdf.partial"
            recorder = Recorder(self.args.recorder)
            recorder.start(partial, recipe["requiredStreams"])
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                rc_port = reservation.getsockname()[1]
            env = os.environ.copy()
            env["VLC_PLUGIN_PATH"] = str(self.args.plugin_dir)
            env["FLUBBER_LSL_DLL"] = str(self.args.lsl_dll)
            env["PATH"] = str(self.args.vlc.parent) + os.pathsep + env.get("PATH", "")
            control_name = "Local\\FlubberControl-" + secrets.token_hex(16)
            command = [str(self.args.vlc), "-I", "dummy", "--no-one-instance",
                       "--no-plugins-cache", "--vout=wingdi", "--avcodec-hw=none",
                       "--video-filter=flubber", "--flubber-lsl",
                       "--flubber-sentinel",
                       f"--flubber-panel-percent={recipe['panelPercent']}",
                       f"--flubber-video-height={height}",
                       f"--flubber-step-percent={recipe['stepPercent']}",
                       f"--flubber-render-fps={fps}", f"--flubber-csv={csv_path}",
                       f"--flubber-marker-base={recipe['video'].name}",
                       f"--flubber-control-name={control_name}",
                       "--key-nav-up=", "--key-nav-down=", "--key-nav-left=",
                       "--key-nav-right=", "--key-jump+short=", "--key-jump-short=",
                       "--no-video-title-show", "--no-osd",
                       "--play-and-exit", "--extraintf=flubberoutlet:rc",
                       f"--rc-host=127.0.0.1:{rc_port}", str(video)]
            with self.lock:
                self.recorder, self.csv, self.rc_port = recorder, csv_path, rc_port
                self.vlc_command, self.vlc_env = command, env
                self.control_name = control_name
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                receipts = recorder.snapshot()
                if all(name in receipts["subscribed"].values()
                       for name in recipe["requiredStreams"]):
                    break
                require(receipts["alive"] and not receipts["error"],
                        "Native recorder failed before subscription")
                time.sleep(0.1)
            else:
                raise RuntimeError("Recorder did not subscribe to every required LSL stream")
            with self.lock:
                self.phase = "armed"
                self.revision += 1
        except Exception as exc:
            with self.lock:
                self.error = str(exc)
                self.phase = "error"
                self.revision += 1
            self._abort_processes()

    def _rc(self, command, quiet=False):
        if self.rc_port is None or self.vlc is None or self.vlc.poll() is not None:
            if quiet:
                return None
            raise RuntimeError("VLC is not running")
        try:
            with socket.create_connection(("127.0.0.1", self.rc_port), timeout=0.5) as peer:
                peer.sendall(command.encode("ascii") + b"\n")
            return True
        except OSError:
            if quiet:
                return None
            raise RuntimeError("VLC local command failed")

    def command(self, action):
        with self.lock:
            if action == "start":
                require(self.phase == "armed", "Experiment is not armed")
                require(self.recorder.snapshot()["alive"], "Recorder is no longer available")
                self.phase = "starting"
                self.vlc = subprocess.Popen(self.vlc_command, env=self.vlc_env,
                                            stdout=subprocess.DEVNULL,
                                            stderr=subprocess.DEVNULL)
                source = f"vlc-flubber-{self.vlc.pid}"
                try:
                    deadline = time.monotonic() + 4.5
                    expected = {f"{source}-affect", f"{source}-markers"}
                    while time.monotonic() < deadline:
                        visible = self.monitor.snapshot()["streams"]
                        receipt = self.recorder.snapshot()
                        if (f"{source}-affect" in visible.get("VLC_Flubber_Affect", []) and
                            f"{source}-markers" in visible.get("VLC_Flubber_Markers", []) and
                            expected <= set(receipt["subscribed"])):
                            break
                        require(self.vlc.poll() is None and receipt["alive"] and not receipt["error"],
                                "VLC or recorder failed before LSL subscription")
                        time.sleep(0.05)
                    else:
                        raise RuntimeError("VLC streams were not subscribed before video")
                    deadline = time.monotonic() + 7
                    while time.monotonic() < deadline:
                        markers = self.monitor.snapshot()["markers"]
                        receipt = self.recorder.snapshot()
                        if any(m["label"] == f"{self.recipe['video'].name}_Start" and
                               m["sourceId"] == f"{source}-markers" for m in markers):
                            break
                        require(self.vlc.poll() is None and receipt["alive"] and not receipt["error"],
                                "VLC or recorder stopped before first data")
                        time.sleep(0.05)
                    else:
                        raise RuntimeError("VLC start marker was not received")
                    self.control = AffectControl(self.control_name)
                except Exception as exc:
                    self.phase, self.error = "error", str(exc)
                    self._abort_processes()
                    raise
                self.phase = "running"
            elif action == "pause":
                require(self.phase == "running", "Experiment is not running")
                self._rc("pause")
                self.phase = "paused"
            elif action == "resume":
                require(self.phase == "paused", "Experiment is not paused")
                self._rc("pause")
                self.phase = "running"
            elif action == "stop":
                require(self.phase in {"running", "paused"}, "No active experiment")
                source = f"vlc-flubber-{self.vlc.pid}-markers"
                label = f"{self.recipe['video'].name}_Stop"
                self._rc("stop")
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    if any(m["label"] == label and m["sourceId"] == source
                           for m in self.monitor.snapshot()["markers"]):
                        break
                    time.sleep(0.03)
                else:
                    raise RuntimeError("VLC did not emit a Stop marker after stopping")
                self._rc("quit", quiet=True)
                self.phase = "finalizing"
                threading.Thread(target=self._finalize, daemon=True).start()
            elif action in EVENTS:
                require(self.phase == "running", "Start or resume before changing affect")
                require(self.control is not None, "Native Flubber control is unavailable")
                self.control.send(action)
            else:
                raise ValueError("Unsupported command")
            self.revision += 1

    def _finalize(self):
        try:
            vlc, recorder = self.vlc, self.recorder
            vlc.wait(timeout=15)
            require(vlc.returncode == 0, f"VLC exited with code {vlc.returncode}")
            require(self.phase != "armed", "Experiment ended before playback")
            name = self.recipe["video"].name
            final, summary = recorder.finish(f"vlc-flubber-{vlc.pid}",
                                             (f"{name}_Start", f"{name}_Stop"))
            for required in self.recipe["requiredStreams"]:
                require(sum(s["name"] == required for s in summary) == 1,
                        f"Required external stream missing from XDF: {required}")
            if self.control:
                self.control.close()
                self.control = None
            require(self.csv.is_file(), "VLC did not save fallback CSV")
            with self.lock:
                self.xdf, self.summary = final, summary
                self.phase = "complete"
                self.revision += 1
        except Exception as exc:
            with self.lock:
                self.phase, self.error = "error", str(exc)
                self.revision += 1

    def _watch(self):
        while True:
            time.sleep(0.25)
            with self.lock:
                if self.vlc is not None and self.phase in {"running", "paused"} and self.vlc.poll() is not None:
                    self.phase = "finalizing"
                    self.revision += 1
                    threading.Thread(target=self._finalize, daemon=True).start()
                if self.vlc is not None and self.phase in {"running", "paused"}:
                    source = f"vlc-flubber-{self.vlc.pid}"
                    streams = self.monitor.snapshot()["streams"]
                    visible = (f"{source}-affect" in streams.get("VLC_Flubber_Affect", []) and
                               f"{source}-markers" in streams.get("VLC_Flubber_Markers", []))
                    self.discovery_missing_since = None if visible else (
                        self.discovery_missing_since or time.monotonic())
                    if (self.discovery_missing_since is not None and
                        time.monotonic() - self.discovery_missing_since > 3):
                        self.error = "VLC Flubber LSL streams lost discovery during playback"
                        self.phase = "error"
                        self.revision += 1
                        self._abort_processes()
                if self.recorder is not None and self.phase in {"armed", "running", "paused"}:
                    receipt = self.recorder.snapshot()
                    if not receipt["alive"] or receipt["error"]:
                        self.error = receipt["error"] or "Native recorder exited"
                        self.phase = "error"
                        self.revision += 1
                        self._abort_processes()

    def _abort_processes(self):
        if self.control:
            self.control.close()
            self.control = None
        for process in (self.vlc, self.recorder.process if self.recorder else None):
            if process is not None and process.poll() is None:
                process.terminate()

    def snapshot(self, phone=False):
        with self.lock:
            recipe = self.recipe
            state = {"phase": self.phase, "revision": self.revision,
                     "error": self.error,
                     "video": recipe["video"].name if recipe else None,
                     "panelPercent": recipe["panelPercent"] if recipe else None,
                     "requiredStreams": recipe["requiredStreams"] if recipe else [],
                     "lsl": self.monitor.snapshot(),
                     "recorder": self.recorder.snapshot() if self.recorder else None,
                     "phoneEnabled": self.phone_enabled,
                     "summary": self.summary}
            if not phone:
                state.update({"recipePath": str(recipe["recipe"]) if recipe else None,
                              "bundledDemo": bool(PACKAGED and recipe and
                                                  recipe["recipe"] == RUNTIME / "demo/great-dictator.json"),
                              "csvPath": str(self.csv) if self.csv else None,
                              "xdfPath": str(self.xdf) if self.xdf else None,
                              "vlcPid": self.vlc.pid if self.vlc else None,
                              "recorderPid": self.recorder.process.pid if self.recorder and self.recorder.process else None,
                              "rcPort": self.rc_port,
                              "phoneUrl": self.phone_url})
            return state


class ControlServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, session, local_token, phone_token):
        self.session = session
        self.local_token = local_token
        self.phone_token = phone_token
        super().__init__(address, ControlHandler)


class ControlHandler(BaseHTTPRequestHandler):
    server: ControlServer

    def log_message(self, *_):
        pass  # Never log pair tokens or paths.

    def _role(self):
        token = self.headers.get("Authorization", "")
        if secrets.compare_digest(token, "Bearer " + self.server.local_token):
            return "local"
        if secrets.compare_digest(token, "Bearer " + self.server.phone_token):
            return "phone"
        return None

    def _json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/state":
            role = self._role()
            if not role:
                return self._json(401, {"error": "Pairing required"})
            return self._json(200, self.server.session.snapshot(phone=role == "phone"))
        files = {"/": ("index.html", "text/html; charset=utf-8"),
                 "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                 "/app.css": ("app.css", "text/css; charset=utf-8")}
        if path.startswith("/vendor/pretext/") and re.fullmatch(r"/vendor/pretext/[A-Za-z0-9_./-]+\.js", path):
            file, mime = path.lstrip("/"), "text/javascript; charset=utf-8"
        elif path in files:
            file, mime = files[path]
        else:
            return self.send_error(404)
        target = (HERE / file).resolve()
        if not target.is_relative_to(HERE) or not target.is_file():
            return self.send_error(404)
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; script-src 'self'; style-src 'self'; "
                         "connect-src 'self'; img-src 'self' data:; base-uri 'none'; "
                         "frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if urlsplit(self.path).path != "/command":
            return self.send_error(404)
        role = self._role()
        if not role:
            return self._json(401, {"error": "Pairing required"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            require(0 < size <= 2048, "Command too large")
            body = json.loads(self.rfile.read(size))
            require(isinstance(body, dict) and set(body) <= {"id", "action", "path"},
                    "Invalid command fields")
            command_id = body.get("id")
            require(isinstance(command_id, str) and re.fullmatch(r"[a-f0-9-]{36}", command_id),
                    "Invalid command ID")
            action = body.get("action")
            require(isinstance(action, str), "Invalid action")
            session = self.server.session
            with session.lock:
                key = role, command_id
                if key in session.dedupe:
                    previous, result = session.dedupe[key]
                    require(previous == body, "Command ID reused with different request")
                    return self._json(200, result)
                require(len(session.dedupe) < 10000, "Command cache full; restart controller")
                if role == "phone":
                    require(session.phone_enabled, "Phone control has not been handed over")
                    require(action in {"start", "pause", "resume", "stop", *EVENTS},
                            "Phone command is not allowed")
                if action == "load":
                    require(role == "local" and isinstance(body.get("path"), str)
                            and len(body["path"]) <= 1024, "Local recipe path required")
                    session.load(body["path"])
                elif action == "prepare":
                    require(role == "local", "Only the local window can prepare")
                    session.prepare()
                elif action == "give_phone":
                    require(role == "local", "Only the local window can hand over control")
                    session.phone_enabled = True
                    session.revision += 1
                elif action == "revoke_phone":
                    require(role == "local", "Only the local window can revoke control")
                    session.phone_enabled = False
                    session.revision += 1
                else:
                    session.command(action)
                result = {"applied": True, "revision": session.revision}
                session.dedupe[key] = (body, result)
            self._json(200, result)
        except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as exc:
            self._json(409, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="Experimental Flubbercorder VLC runner")
    parser.add_argument("recipe", nargs="?", type=Path)
    parser.add_argument("--vlc", type=Path, default=(RUNTIME / "vlc/vlc.exe" if PACKAGED
                                                     else Path(r"C:\Program Files\VideoLAN\VLC\vlc.exe")))
    parser.add_argument("--plugin-dir", type=Path, default=RUNTIME / "plugins")
    parser.add_argument("--lsl-dll", type=Path,
                        default=(RUNTIME / "lsl.dll" if PACKAGED
                                 else BUILD / "deps/liblsl-1.17.7-Win_amd64/bin/lsl.dll"))
    parser.add_argument("--recorder", type=Path, default=RUNTIME / "recorder/respyrecorder.exe")
    parser.add_argument("--ffmpeg", default=str(RUNTIME / "ffmpeg/ffmpeg.exe") if PACKAGED else "ffmpeg")
    parser.add_argument("--ffprobe", default=str(RUNTIME / "ffmpeg/ffprobe.exe") if PACKAGED else "ffprobe")
    parser.add_argument("--data-dir", type=Path,
                        default=Path(os.getenv("LOCALAPPDATA", str(HERE))) / "Flubbercorder")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--phone-host", help="Opt-in trusted-LAN IPv4 address; serves HTTP")
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    for path in (args.vlc, args.lsl_dll, args.recorder,
                 args.plugin_dir / "video_filter/libflubber_plugin.dll"):
        require(path.is_file(), f"Missing runtime file: {path}")
    if PACKAGED:
        for path in (args.ffmpeg, args.ffprobe):
            require(Path(path).is_file(), f"Missing media tool: {path}")
    require(0 <= args.port <= 65535, "Invalid port")
    if args.phone_host:
        socket.inet_aton(args.phone_host)
        require(not args.phone_host.startswith("127."), "Use a LAN IPv4 address for phone control")
    local_token = secrets.token_urlsafe(32)
    phone_token = secrets.token_urlsafe(32)
    session = Session(args)
    demo_recipe = RUNTIME / "demo/great-dictator.json"
    if args.recipe:
        session.load(str(args.recipe))
    elif PACKAGED and demo_recipe.is_file():
        try:
            session.load(str(demo_recipe))
        except (ValueError, OSError, json.JSONDecodeError) as exc:
            session.phase = "error"
            session.error = f"Bundled demo could not be loaded: {exc}"
    server = ControlServer(("0.0.0.0" if args.phone_host else "127.0.0.1", args.port),
                           session, local_token, phone_token)
    port = server.server_address[1]
    local_url = f"http://127.0.0.1:{port}/#local:{local_token}"
    if args.phone_host:
        session.phone_url = f"http://{args.phone_host}:{port}/#phone:{phone_token}"
    print("Local Flubbercorder:", local_url, flush=True)
    if args.phone_host:
        print("Trusted-LAN phone pairing:", session.phone_url, flush=True)
    if not args.no_open:
        import webbrowser
        webbrowser.open(local_url)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        session._abort_processes()


if __name__ == "__main__":
    main()

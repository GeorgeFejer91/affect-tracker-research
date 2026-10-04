"""Independent liblsl C-API receiver for the native VLC side quest.

This launches VLC, subscribes to its two outlets, and writes a small receipt.
It deliberately uses only Python's standard library and the pinned lsl.dll.
"""
import argparse
import ctypes as c
import csv
import json
import os
from pathlib import Path
import subprocess
import time


def bind(dll, name, result, *arguments):
    function = getattr(dll, name)
    function.restype = result
    function.argtypes = list(arguments)
    return function


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vlc", type=Path, required=True)
    parser.add_argument("--plugin-dir", type=Path, required=True)
    parser.add_argument("--lsl-dll", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--video-height", type=int, required=True)
    parser.add_argument("--panel-percent", type=int, default=25)
    parser.add_argument("--render-fps", type=int, default=60)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()

    dll = c.CDLL(str(args.lsl_dll.resolve()))
    resolve = bind(dll, "lsl_resolve_byprop", c.c_int32, c.POINTER(c.c_void_p),
                   c.c_uint32, c.c_char_p, c.c_char_p, c.c_int32, c.c_double)
    create_inlet = bind(dll, "lsl_create_inlet", c.c_void_p, c.c_void_p,
                        c.c_int32, c.c_int32, c.c_int32)
    open_stream = bind(dll, "lsl_open_stream", None, c.c_void_p, c.c_double,
                       c.POINTER(c.c_int32))
    pull_float = bind(dll, "lsl_pull_sample_f", c.c_double, c.c_void_p,
                      c.POINTER(c.c_float), c.c_int32, c.c_double,
                      c.POINTER(c.c_int32))
    pull_string = bind(dll, "lsl_pull_sample_str", c.c_double, c.c_void_p,
                       c.POINTER(c.c_void_p), c.c_int32, c.c_double,
                       c.POINTER(c.c_int32))
    destroy_string = bind(dll, "lsl_destroy_string", None, c.c_void_p)
    destroy_inlet = bind(dll, "lsl_destroy_inlet", None, c.c_void_p)
    destroy_info = bind(dll, "lsl_destroy_streaminfo", None, c.c_void_p)

    env = os.environ.copy()
    env["VLC_PLUGIN_PATH"] = str(args.plugin_dir.resolve())
    env["FLUBBER_LSL_DLL"] = str(args.lsl_dll.resolve())
    env["PATH"] = str(args.vlc.parent.resolve()) + os.pathsep + env.get("PATH", "")
    command = [str(args.vlc.resolve()), "-I", "dummy", "--no-one-instance",
               "--no-plugins-cache", "--no-audio", "--vout=wingdi",
               "--avcodec-hw=none", "--video-filter=flubber",
               f"--flubber-panel-percent={args.panel_percent}",
               f"--flubber-video-height={args.video_height}",
               f"--flubber-render-fps={args.render_fps}",
               f"--flubber-csv={args.csv.resolve()}", "--flubber-lsl",
               "--no-video-title-show", "--no-osd", "--play-and-exit",
               str(args.video.resolve())]
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    process = subprocess.Popen(command, env=env, startupinfo=startup,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    inlets = []
    info_handles = []
    try:
        for name in (b"VLC_Flubber_Affect", b"VLC_Flubber_Markers"):
            buffer = (c.c_void_p * 4)()
            count = resolve(buffer, 4, b"name", name, 1, 6.0)
            if count < 1:
                raise RuntimeError(f"No LSL outlet discovered: {name.decode()}")
            info_handles.append(buffer[0])
            inlet = create_inlet(buffer[0], 360, 0, 1)
            if not inlet:
                raise RuntimeError(f"Could not subscribe: {name.decode()}")
            inlets.append(inlet)
            error = c.c_int32()
            open_stream(inlet, 3.0, c.byref(error))
            if error.value:
                raise RuntimeError(f"Subscription failed: {name.decode()} ({error.value})")

        values = []
        markers = []
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            error = c.c_int32()
            sample = (c.c_float * 2)()
            stamp = pull_float(inlets[0], sample, 2, 0.1, c.byref(error))
            if stamp > 0:
                values.append((stamp, float(sample[0]), float(sample[1])))
            label_ptr = (c.c_void_p * 1)()
            stamp = pull_string(inlets[1], label_ptr, 1, 0.0, c.byref(error))
            if stamp > 0 and label_ptr[0]:
                label = c.string_at(label_ptr[0]).decode("utf-8")
                markers.append((stamp, label))
                destroy_string(label_ptr[0])
            if process.poll() is not None and any(m[1] == "video_end" for m in markers):
                break
        try:
            exit_code = process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.terminate()
            exit_code = process.wait(timeout=4)

        with args.csv.open(newline="", encoding="utf-8") as handle:
            csv_rows = list(csv.DictReader(handle))
        csv_samples = [row for row in csv_rows if row["event"] == "sample"]
        csv_events = [row["event"] for row in csv_rows if row["event"] != "sample"]
        marker_labels = [marker[1] for marker in markers]
        monotonic = all(b[0] >= a[0] for a, b in zip(values, values[1:]))
        marker_span = markers[-1][0] - markers[0][0] if len(markers) == 2 else None
        receipt = {
            "vlc_exit_code": exit_code,
            "affect_samples": len(values),
            "affect_first": values[0] if values else None,
            "affect_last": values[-1] if values else None,
            "affect_timestamps_monotonic": monotonic,
            "markers": markers,
            "marker_span_seconds": marker_span,
            "csv_rows": len(csv_rows),
            "csv_samples": len(csv_samples),
            "csv_end_video_ms": int(csv_rows[-1]["video_ms"]) if csv_rows else None,
        }
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt, indent=2))
        if (exit_code != 0 or len(values) < 10 or
            len(values) != len(csv_samples) or not monotonic or
            csv_events != ["video_start", "video_end"] or
            marker_labels != ["video_start", "video_end"] or
            abs(marker_span - receipt["csv_end_video_ms"] / 1000) > 0.3):
            raise SystemExit(1)
    finally:
        for inlet in inlets:
            destroy_inlet(inlet)
        for info in info_handles:
            destroy_info(info)
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=4)


if __name__ == "__main__":
    main()

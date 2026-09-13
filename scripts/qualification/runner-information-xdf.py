"""Export raw XDF evidence with independent pyxdf; no recipe input is accepted."""
import hashlib
import json
import math
import pathlib
import sys

import pyxdf


def inspect_file(path):
    if path.stat().st_size > 512 * 1024 * 1024:
        raise ValueError("This qualification reader is bounded to 512 MiB XDF files")
    streams, header = pyxdf.load_xdf(str(path), synchronize_clocks=False, dejitter_timestamps=False)
    rows, primary = [], None
    for stream in streams:
        info, footer = stream["info"], stream.get("footer", {}).get("info", {})
        times = [float(v) for v in stream["time_stamps"]]
        count = len(times)
        if len(footer.get("sample_count", [])) != 1 or int(footer["sample_count"][0]) != count:
            raise ValueError("Missing XDF footer or sample-count mismatch")
        if count and (float(footer["first_timestamp"][0]) != times[0] or float(footer["last_timestamp"][0]) != times[-1]):
            raise ValueError("XDF footer timestamps differ from unmodified raw samples")
        if any(not math.isfinite(t) for t in times):
            raise ValueError("Non-finite XDF timestamp")
        series = stream["time_series"]
        if hasattr(series, "tolist"):
            series = series.tolist()
        row = {"name": info["name"][0], "type": info["type"][0], "channelCount": int(info["channel_count"][0]),
               "channelFormat": info["channel_format"][0], "sourceId": info["source_id"][0],
               "sampleCount": count, "footerVerified": True, "timestamps": times, "samples": series}
        rows.append(row)
        if count and row["channelFormat"] == "string" and row["channelCount"] == 1:
            try:
                first = json.loads(series[0][0])
            except (ValueError, TypeError):
                continue
            if isinstance(first, dict) and first.get("schema") == "affect-runner-information":
                if primary is not None:
                    raise ValueError("Multiple primary information streams; select a single attempt recording")
                primary = len(rows) - 1
    if primary is None:
        raise ValueError("XDF contains no initial Runner information header")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return {"schema": "affect-runner-independent-xdf-export", "version": 1,
            "reader": {"name": "pyxdf", "version": pyxdf.__version__, "synchronizeClocks": False, "dejitterTimestamps": False},
            "xdfSha256": digest.hexdigest(), "primaryStreamIndex": primary, "streams": rows}


if __name__ == "__main__":
    source, destination = map(pathlib.Path, sys.argv[1:])
    result = inspect_file(source)
    with destination.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(result, output, ensure_ascii=False, allow_nan=False)
    print(f"Independent XDF export: {len(result['streams'])} streams; raw samples and footers retained")

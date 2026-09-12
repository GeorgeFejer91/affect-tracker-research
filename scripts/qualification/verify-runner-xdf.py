"""Independently read the Rust synthetic all-format fixture with pyxdf 1.17.0.

Usage: python verify-runner-xdf.py all-formats.xdf [own.xdf] [loopback.xdf]
Requires pyxdf and numpy; does not execute the app or discover real streams.
"""
import json
import sys
import pyxdf

streams, _ = pyxdf.load_xdf(sys.argv[1], synchronize_clocks=False, dejitter_timestamps=False)
assert len(streams) == 7
formats = ["float32", "double64", "int8", "int16", "int32", "int64", "string"]
values = [1.25, -2.5, -127, -30000, -2_000_000_000, 2**63 - 1, "marker:\u00e4<&>"]
for stream, fmt, value in zip(streams, formats, values):
    assert stream["info"]["channel_format"] == [fmt]
    assert stream["time_stamps"].tolist() == [100.25]
    assert stream["time_series"][0][0] == value
    assert stream["footer"]["info"]["sample_count"] == ["1"]
aligned, _ = pyxdf.load_xdf(sys.argv[1], synchronize_clocks=True, dejitter_timestamps=False)
assert all(stream["time_stamps"].tolist() == [100.375] for stream in aligned)
for path, count in zip(sys.argv[2:], [2, 3]):
    recorded, _ = pyxdf.load_xdf(path, synchronize_clocks=False, dejitter_timestamps=False)
    assert len(recorded) == count
    marker = next(stream for stream in recorded if stream["info"]["channel_format"] == ["string"])
    assert marker["time_series"] == [["session_started"], ["session_completed"]]
    assert marker["footer"]["info"]["sample_count"] == ["2"]
    affect = next(stream for stream in recorded if stream["info"]["channel_format"] == ["float32"])
    assert affect["time_series"].shape == (1, 8)
    if count == 3:
        external = next(stream for stream in recorded if stream["info"]["channel_format"] == ["int64"])
        assert external["time_series"][0][0] == 2**63 - 1
print(json.dumps({"reader": "pyxdf", "formats": formats, "timestamps": "raw and offset-corrected exact", "workerFiles": len(sys.argv) - 2, "result": "pass"}))

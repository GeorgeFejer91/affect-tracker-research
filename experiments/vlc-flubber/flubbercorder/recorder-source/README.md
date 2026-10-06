# Native XDF recorder source

`respyrecorder.exe` is the Respyra 2.0 CLI adapter around LabRecorder's MIT
recording engine. This directory carries the corresponding adapter, pinned
LabRecorder sources, patch script, source lock, and licenses. The executable
and its runtime DLLs are in `../recorder-runtime` in this repository and in
`recorder` in the installed package. The runtime `manifest.json` records the
hash of the exact build script used for the bundled executable.

To rebuild the bundled recorder on Windows x64, arrange this directory's
contents in the original Respyra layout without changing `build_recorder.py`:

```text
rebuild-root/
  scripts/build_recorder.py
  native/recorder/CMakeLists.txt
  native/recorder/main.cpp
  native/recorder/source-lock.json
  native/recorder/upstream/...
  native/recorder/LIBLSL-LICENSE
```

Use Python with PyQt6 installed, CMake, and the MSVC x64 build tools. Then run
`python scripts/build_recorder.py` from that layout. The script verifies the
pinned upstream hashes, downloads and checks the liblsl SDK archive, applies
the listed source patches in a local staging directory, and writes a runtime
bundle at `rebuild-root/.for-ai-local/recorder/runtime`. It obtains app-local
MSVC DLLs from the installed PyQt6 wheel. The original build environment is
the locked Respyra 2.0 environment; its dependency lock is available in the
[source project](https://github.com/GeorgeFejer91/respyra-2.0).

The adapter emits exact LSL subscription and first-data receipts. It accepts
one bounded stream watch predicate, handles UTF-8 Windows paths, checks XDF
writes, and closes an `.xdf.partial` file on stop. Flubbercorder independently
validates and promotes that file after the native process exits.

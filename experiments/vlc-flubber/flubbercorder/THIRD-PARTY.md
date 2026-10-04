# VLC ExperimentRunner bundled components

This experimental Windows package includes VLC 3.0.20, FFmpeg 8.1.2 essentials,
Python 3.12.10, liblsl 1.17.7 for the VLC plugin, the Respyra native recorder
with its own liblsl 1.18.0 beta 5, and Pretext 0.0.9. These components retain
their own licenses. The native recorder's corresponding source and build script
are under `source/recorder` in the installation and
`flubbercorder/recorder-source` in the repository.

| Component | Pinned source and license location |
| --- | --- |
| VLC | [VideoLAN 3.0.20 source](https://download.videolan.org/pub/videolan/vlc/3.0.20/vlc-3.0.20.tar.xz); bundled `vlc/COPYING` and other VLC license files. |
| FFmpeg | [FFmpeg 8.1.2 source](https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz); [Gyan Windows build](https://github.com/GyanD/codexffmpeg/releases/tag/8.1.2). See that build's license and configuration for enabled libraries. |
| Python | [Python 3.12.10 source](https://www.python.org/downloads/release/python-31210/); bundled `python/LICENSE.txt`. |
| liblsl | [liblsl 1.17.7 source](https://github.com/sccn/liblsl/tree/v1.17.7); recorder source has `LIBLSL-LICENSE`. |
| LabRecorder engine | MIT source and `source/recorder/upstream/LICENSE`; exact source revision and hashes in `source/recorder/source-lock.json`. |
| Respyra recorder adapter | The corresponding `source/recorder/main.cpp`, `CMakeLists.txt`, and `build_recorder.py` were taken from [Respyra 2.0](https://github.com/GeorgeFejer91/respyra-2.0), which is GPL-3.0. Its GPL-3.0 license is included as `source/recorder/RESPYRA-LICENSE`. |
| Pretext | Bundled `app/vendor/pretext/LICENSE`. |

The downloaded VLC and FFmpeg archives are SHA-256 checked by `package.ps1`.
`manifest.json` records hashes of the installed executable components.

Phone control uses an explicit trusted-LAN HTTP opt-in (`--phone-host`). Its
pairing token grants control to a browser on that network. Use a network you
trust; this prototype does not provide encrypted remote transport.

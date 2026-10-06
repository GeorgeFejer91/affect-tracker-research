# Flubber VLC Player third-party components

This package contains VLC 3.0.20, FFmpeg 8.1.2 essentials, liblsl 1.17.7,
and the Rust `resvg` renderer. Their licenses remain with their authors.

- VLC source: https://download.videolan.org/pub/videolan/vlc/3.0.20/vlc-3.0.20.tar.xz
  The bundled `vlc` directory includes its license files.
- FFmpeg source: https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz
  The bundled `ffmpeg/LICENSE` and `ffmpeg/README.txt` describe the pinned
  Windows build and its enabled libraries.
- liblsl source: https://github.com/sccn/liblsl/tree/v1.17.7
  Its license is bundled as `licenses/LIBLSL-LICENSE`.
- Native Flubber filter, Rust launcher, and SVG renderer sources and the pinned
  build recipe are in this project's `experiments/vlc-flubber` directory at the
  release commit. The launcher also uses the shared `src-tauri` Rust crate.
  Their repository license is `licenses/AFFECT-RESEARCH-LICENSE`.

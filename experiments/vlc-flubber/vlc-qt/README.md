# Stock VLC 3.0.20 Flubber Qt extension

This source modifies the official VLC 3.0.20 Qt interface. It keeps VLC's
existing Media, Playback, Audio, Video, Subtitle, Tools, View, and Help menus,
playlist, transport and video child window. The patch adds a black bottom
Flubber panel, makes the idle central background black, and adds a top-level
**Flubber → Settings…** menu. Its dialog holds appearance JSON import, size,
and position. It is separate from the standard Experiment Runner.

## Reproducible inputs and outputs

- Upstream source: official `vlc-3.0.20.tar.xz`, SHA-256
  `adc7285b4d2721cddf40eb5270cada2aaa10a334cb546fd55a06353447ba29b5`.
- Apply `apply-patch.ps1 -SourceRoot <unmodified VLC 3.0.20 tree>` once. It
  checks the unified patch, modifies five upstream Qt files plus `bin/winvlc.c`, and copies
  `flubber_panel.hpp` and `flubber_bridge.hpp` into `modules/gui/qt/`.
- Build a matching Windows x64 VLC Qt module from that tree. Do not mix a Qt
  module with a different VLC core/CRT without installed ABI verification.
- Rebuild and package `vlc.exe` from the patched `bin/winvlc.c` as well as the
  Qt module. VLC 3.0.20's module loader uses `LOAD_LIBRARY_SEARCH_SYSTEM32`;
  the patched launcher preloads four packaged Qt DLLs from the executable
  directory with `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32`
  before libVLC starts, so its Qt plugin can link to the same handles. It
  fails visibly if a required DLL is missing.
- Run `build-bridge.ps1`; its output is
  `bridge/target/release/flubber_bridge.dll`. Place that DLL beside `vlc.exe`.
  The crate-local Cargo config links the MSVC CRT statically. `labstream` 0.1.2
  and its components are MIT-licensed Rust dependencies; they are linked into
  the DLL, with no separate `lsl.dll` import.
- With MSYS2 MinGW64 GCC 16.2.0 and Qt 5.15.19 in the MinGW64 shell, the
  verified native build commands from an out-of-tree build directory are:

  ```sh
  BUILDCC=gcc ../vlc-3.0.20/configure --cache-file=../config.cache \
    --disable-lua --disable-skins2 \
    --disable-nls --disable-update-check --disable-avcodec --disable-avformat \
    --disable-swscale --disable-a52 --disable-mad
  make -j8 -C modules libqt_plugin.la \
    am__append_4=../modules/module.rc.lo LIBS_qt=-lwinmm \
    CFLAGS='-g -O2 -Wno-error=incompatible-pointer-types' \
    CXXFLAGS='-g -O2 -I/mingw64/include/QtGui/5.15.19/QtGui -I/mingw64/include/QtGui/5.15.19'
  make -j8 -C bin vlc.exe CFLAGS='-g -O2 -Wno-error=incompatible-pointer-types'
  ```

  Stage the real binaries from `modules/.libs/libqt_plugin.dll` and
  `bin/.libs/vlc.exe`. Qt must find `qt5/plugins/platforms/qwindows.dll`,
  `qt5/plugins/iconengines/qsvgicon.dll`, and
  `qt5/plugins/imageformats/qsvg.dll`; `qt.conf` points Plugins at
  `qt5/plugins`. The SVG icon engine restores VLC's stock toolbar icons.
- Run `test-panel.ps1 -QtBin <MinGW64 Qt bin> -AppearanceJson <Planner-exported JSON>`
  to compile the isolated panel check, reject duplicate keys, verify imported
  fill/transparency and manual controls, and render a black idle PNG without
  foregrounding the desktop.

The Qt source modification and its two headers are GPL-2.0-or-later, matching
the host VLC Qt module. The Rust bridge is GPL-2.0-or-later. Packaging the
modified VLC Qt binary must retain the VideoLAN license notices and provide the
corresponding source patch and dependency notices.

## Appearance and controls

The JSON reader accepts only `vlc-flubber-appearance/v1` from the Planner's
Classic Flubber preview. It rejects duplicate and unknown keys, malformed
colors, unsupported drivers, invalid mapping ranges and files over 64 KiB.
An invalid file never replaces the active preset. The painter uses the four
axis/corner colors, idle fill, outline and halo colors, transparency, halo
width/gradient/steepness, color-anchor mode, and all six mapping controls.
A small two-axis rating indicator beside Flubber uses the exported `cursor`
color. Its 192-point circle profile and seeded
wave offsets follow `site/src/math.js`; halo blur is approximated with six
antialiased strokes because Qt QPainter does not use the browser SVG filter.

Position and size are VLC-owned, independent of the Planner JSON: bottom panel
height, Flubber size, and normalized horizontal/vertical position live in VLC's
`QSettings`. The panel is black before playback and after media ends. Before
rating is active, pointer movement over the panel or VLC video surface updates
the affect coordinates. Click and release on the panel during playback to
activate relative mouse rating. The pointer is confined to the player client
area and hidden; horizontal and vertical movement map to the two normalized
axes with the previous player's 60% height travel and 150 px per-event cap.
Arrows move by the session step only during active rating. Escape releases the
pointer. Focus/capture loss releases it, emits an `Interrupt` marker and
requests pause. Stop, End, and input change also release it. VLC's stock
keyboard commands remain available outside active rating. The video child
handle and VLC's stock playback paths remain unchanged.

For Recorder sessions, optional process environment variables override only
the session parameters:

| Variable | Behavior |
| --- | --- |
| `VLC_FLUBBER_PANEL_PERCENT` | 10–100 percent of the current video surface height; invalid values are ignored. |
| `VLC_FLUBBER_STEP_PERCENT` | 1–100 percent per arrow rating step while the panel has focus; invalid values are ignored. |
| `VLC_FLUBBER_CSV_PATH` | First local media session's CSV; must be an absolute `.csv` path beside the media and is opened with `create_new`. Later sessions use unique automatic names. |

VLC 3.0.20's stock `oldrc` interface supports
`--extraintf=rc --rc-host=127.0.0.1:<port> --rc-quiet` and the `add`, `play`,
`pause`, `stop`, `volume`, `is_playing`, and `f on|off` commands. An armed Recorder
can launch idle VLC, wait for the two LSL outlets, then send `add <media>`.

The Flubber menu adds **Main feedback** shortcuts Ctrl+Shift+1/2/3 for
Flubber, 2D grid, and face morph. Ctrl+Alt+1/2/3 independently shows or hides
each element, so all three can appear together. Ctrl+Shift+A and Ctrl+Shift+M
select arrow and mouse input. **Flubber → Settings…** holds the detailed
appearance, face preset, and layout controls.

Launch VLC with `--flubber-settings=<absolute JSON path>` to load a settings
file. `--flubber-primary=flubber|grid|face`, `--flubber-input=arrows|mouse`,
and `--flubber-face=photo-reference-v3|photo-synthetic-01..08` override their
respective settings afterward. These are Qt interface options and work with
the packaged player.

For a running player, start VLC with loopback RC enabled, then use
`flubberctl.ps1 -Port <port> -Command '<command>'`. The script sends the
following stock RC extension commands to that instance:

```text
flubber primary flubber|grid|face
flubber input arrows|mouse
flubber visible flubber|grid|face on|off
flubber face photo-reference-v3|photo-synthetic-01..08
flubber load <absolute JSON path>
```

Example: `flubberctl.ps1 -Port 42123 -Command 'visible grid on'`. The existing
VLC RC interface is the command transport. The Qt callback queues state
changes to the GUI thread; malformed commands and invalid settings show an
error in the player.

## Native lifecycle audit

- Qt creates `FlubberPanel` and `FlubberBridge` on the GUI thread. The panel's
  33 ms QTimer and mouse/keyboard handlers stay on that thread. It does not
  move or replace `VideoWidget::stable`, which owns VLC's vout HWND. Qt's
  normal `VideoWidget::release()` still orphans/releases that handle. Rating
  capture starts after button release so Qt's implicit press capture cannot
  undo it. On Windows, `SetCapture`, `ClipCursor`, and balanced `ShowCursor`
  calls are confined to the foreground player and reversed on every exit path.
- Qt loads the Rust DLL from its own executable directory with `QLibrary` and
  resolves six fixed C ABI functions: `new`, `update`, `interrupt`, `status`,
  `error`, and `free`. It passes copied UTF-8 bytes and plain numeric values only; no Qt,
  VLC, or HWND pointer crosses the boundary. The bridge does not call back into
  Qt. A failed load/worker shows a one-time visible warning.
- `flubber_bridge_new()` returns an owned handle while the LSL worker starts
  asynchronously. `status` reports starting/live/failed. `update` copies
  bounded coordinates, state, media time, filename and path into Rust-owned
  memory. It never holds a caller buffer after return. The Qt timer stops
  before `free`; `free` signals and joins the worker before `QLibrary` unloads.
- The Rust worker owns a high-resolution waitable timer and balanced Windows
  timer period, and publishes 30 Hz LSL samples even while VLC is idle. Its
  separate bounded CSV writer opens a fresh file on video Start and closes on
  Stop. Disk errors and queue overload set terminal status for a visible Qt
  warning; they are not silently ignored. Worker failure closes outlets.
- Qt maps live VLC input states to the bridge and briefly latches a real
  `END_S`/`ERROR_S` state. `InputManager::delInput()` also emits a synthetic
  `END_S` for Stop/Next, so the latch requires a still-live input in the same
  core state. Natural End versus Stop/Next still needs installed runtime
  verification with an independent LSL receiver.
- The Qt boundary casts the live panel/main `winId()` to HWND for foreground,
  capture and client-rectangle checks; no HWND crosses into Rust. The bridge
  also converts six `QLibrary` symbols to fixed C ABI function pointers.
  Rust FFI pointer dereference is limited to the six
  exported functions, with a unique owner, stop-before-free order, and
  `catch_unwind` around each entry. Windows timer handle and period have RAII
  cleanup. A blocked native outlet startup can delay final worker join at
  process exit; this is an outstanding shutdown bound to test in the installed
  player.

## Current evidence and gates

`cargo test --locked` in `bridge/` exercises fresh CSV names, selected CSV
constraints, and a live independent LSL inlet at 28–32 Hz with exact
`clip.mp4_Start`/`_Interrupt`/`_Stop` markers and a 30 Hz video CSV. The isolated Qt panel
check compiles with MinGW64 Qt 5.15.19 and renders the imported Planner
appearance on black. These checks do not establish the complete VLC module's
compile, installed menu/command behavior, fullscreen layout, D3D mouse input,
or natural End/Stop/Next marker distinctions. Those must be checked against the
exact patched VLC candidate before calling the player finished.

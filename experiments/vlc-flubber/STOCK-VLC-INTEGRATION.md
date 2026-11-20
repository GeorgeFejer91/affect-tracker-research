# Stock VLC Flubber integration decision record

## Three-feedback update — 2026-10-07

The side-quest player now has three independent feedback layers in its native
black bottom panel: Classic Flubber, a 2D affect grid, and the archived
playground's 21×21 smooth photo-face transition matrix. Each layer has its own
visibility, size, and normalized X/Y position. Selecting the main feedback
swaps its placement with the previous main layer; other visible layers remain
available. The default shows Flubber in the center, with optional grid and
face positions at the left and right. The portrait selector offers the original
synthetic atlas and eight archived synthetic variants. The face mapping
bilinearly mixes the four adjacent cells while an adjustable transition rate
eases toward the current affect.

The top-level **Flubber** menu retains stock VLC menus and commands. It adds
main-feedback shortcuts Ctrl+Shift+1/2/3, independent layer visibility
shortcuts Ctrl+Alt+1/2/3, and input shortcuts Ctrl+Shift+A/M. Its Settings
dialog has Display, Flubber, Colors, Mappings, 2D grid, and Face morph pages,
covering all v1 appearance fields and the player layout. It imports Planner's
strict `vlc-flubber-appearance/v1` file, exports that appearance alone, and
imports/exports `vlc-feedback-settings/v2` for the complete player state. The
Planner's separate appearance-only button and serializer were already present;
its focused tests pass.

Startup flags set the primary layer, input mode, face preset, and settings
file. A running player accepts matching commands through its loopback VLC RC
interface with `vlc-qt/flubberctl.ps1`. This uses VLC's existing command
transport and queues changes to the Qt GUI thread. Lossless face atlas PNGs are
converted from the project's archived WebP assets to use Qt's built-in image
format support. They are listed with source and derived
SHA-256 hashes in `assets/face/vlc-face-atlases.json`; `assets/face/NOTICE.md`
preserves source attribution. The runtime package includes all nine atlases.

The isolated Qt panel check validates the three-layer render, face preset
selection, v2 JSON round trip, rejection of invalid settings, input switching,
and Planner appearance import.

The installed PNG candidate shows the stock VLC 3.0.20 menu wrapper and
transport controls, black idle video area, and all three feedback elements on
the matching black bottom panel in `build/evidence/final-installed-png-idle.png`.
`final-installed-png-playing.png` shows direct video above that panel.
`final-installed-png-settings.png`, `-face-settings.png`, and `-mappings.png`
show the native detailed controls. Startup flags selected Flubber, a synthetic
portrait, and arrow input. VLC RC commands changed the visible layers and
selected another portrait in the running player. Physical Ctrl+Shift+2
changed the persisted main feedback to grid, Ctrl+Alt+3 hid face, and
Ctrl+Shift+A selected arrow input. The isolated panel test passes with PNG
assets, including all-layer rendering and JSON validation. Each freshly
installed standalone and Flubbercorder player manifest listed 49 matching
files, including all nine PNG atlases. This verifies the side quest on this
Windows machine; it is not main Runner research qualification or exhaustive
coverage of every stock VLC command.

## Dedicated Flubber menu follow-up — 2026-10-07

The VLC menu bar now includes **Flubber** between View and Help. Its
**Settings…** action opens the existing Flubber Controls dialog with appearance
JSON import, bottom-panel height, Flubber size, and horizontal/vertical
position. The old View-menu action was moved, leaving VLC's stock menus and
commands unchanged. The Qt patch applied to a pristine pinned VLC 3.0.20
source tree and produced the same `menus.cpp` hash as the compiled source.

The rebuilt Qt module was packaged in a fresh standalone installer and the
companion Flubbercorder installer. Both per-user installations matched all 36
listed VLC file hashes and used Qt plugin SHA-256
`B50BD5A55F14903A1501CF3FF392A22966CB14889AC1690CFF0B9C332D1ACCF7`.
Installed UI Automation enumerated Media, Playback, Audio, Video, Subtitle,
Tools, View, **Flubber**, Help, and one Settings action beneath Flubber; that
action opened the dialog. Idle, playing, dialog, and Recorder captures are in
`build/evidence/top-menu-*.png`. The upgraded installed player completed a
Recorder/XDF trial with 331 affect samples, a selected CSV, and exact
Start/End/Stop markers. The Recorder's visible hint points to Flubber →
Settings and was inspected at 1296×889 and its 760×560 minimum window size.

## Installed 0.3.0 candidate — 2026-10-07

The pinned VLC 3.0.20 Qt module is patched and built. The resulting player
retains VLC's stock menu bar and command implementations, transport/seek/volume
controls, and native video playback. Its idle canvas is black; the bottom
Flubber region stays black during playback. The added **View → Flubber
Controls…** action opens the native dialog with strict
`vlc-flubber-appearance/v1` import and Flubber size, horizontal position, and
vertical position controls. The Planner exports this appearance file from the
Classic Flubber preview without experiment or response settings.

The standalone Inno installer was built from the pinned official VLC archive,
the compiled Qt module and launcher, and the Rust LSL/CSV bridge. A fresh
silent install succeeded. Every file listed in the installed manifest matched
its SHA-256, and the package omitted `plugins.dat` so installation does not
invalidate VLC's plugin cache. Installed idle, playing, and settings dialog
captures are under `build/evidence/final-installed-*.png`; the playing capture
shows video above the black Flubber surface with stock controls visible.
UI Automation enumerated the stock Media, Playback, Audio, Video, Subtitle,
Tools, View, and Help menus and the added View action. The action opened the
settings dialog. The offscreen Qt panel check imported the Planner appearance
JSON, rejected malformed/duplicate fields, and checked manual size and
position. Physical mouse rating and every individual stock VLC command were
not exhaustively exercised in this installed session.

The installed player accepted a normal video through VLC RC, wrote the
selected CSV, and completed an independent Recorder trial. Recorder subscribed
before playback and promoted XDF with 331 affect samples and the exact
`test-ui-10s.mp4_Start`, `_End`, and `_Stop` markers. A Windows canonical
`\\?\` video path had initially caused VLC RC to reject the media; the Recorder
now sends the ordinary Win32 path. This is an experimental Windows player
candidate, not a main Runner research qualification.

The companion Flubbercorder Tauri app also built in release mode with the stock
VLC package, its Inno installer completed a fresh isolated install, and the
installed app opened with the chosen test recipe. Its bundled player manifest
listed 36 files with matching SHA-256 hashes. The Recorder screen now directs
appearance changes to VLC's View menu and no longer offers the obsolete
LibVLC preset-folder action. The installed Recorder screen was captured at
`build/evidence/final-installed-recorder.png`; a complete interactive Tauri
button-driven recording session was not run in this pass.

Goal: retain the complete VLC 3.0.20 Qt menu and command set, add a persistent
Flubber surface beneath video on the same black player background, and offer
**View → Flubber Controls…** for appearance JSON import and manual size/position.
This is the separate VLC side quest; it does not change Planner recipe or R1.

## Verified boundary

- `libvlc-player/src/main.rs` is a custom Win32 shell. LibVLC decodes media,
  but that shell cannot expose VLC's complete Qt menus and commands.
- The historical `plugin.c` from `6611f78` compiles against the pinned VLC
  3.0.20 source and supplies native SVG Flubber for FFmpeg-padded media.
- A direct-media probe with that filter changed its output from 640×360 to
  640×450. VLC's vout then inserted a converter back to 640×360; the log says
  it is “compensating for format changes” and later removes the filter after
  recursive converter failures. Thus the stock **Media → Open File** command
  cannot gain a reliable bottom panel through this filter alone.
- The historical launcher no longer builds against current `PreparedMaster`:
  it calls removed `read_file` methods. Restoring it would also reinstate the
  old FFmpeg preparation path, which VLC's own Open File bypasses.

## Implementation boundary

The stock-menu requirement calls for a VLC Qt integration, rather than another
LibVLC shell or a vout-only filter. The Qt player must own a persistent black
video/Flubber split surface so media opened by any stock command uses the same
layout. VLC retains its normal menu, playlist, transport, seek, audio, subtitle,
video, and fullscreen implementations. One Qt View action opens Flubber
Controls; the dialog imports the strict `vlc-flubber-appearance/v1` JSON exported
by Planner, and edits Flubber size and normalized position separately. The
appearance JSON contains transparency, outline and halo choices, colors,
color-anchor mode, halo width/gradient, and animation mappings. It contains no
legacy Planner position/size, input binding, or response behavior. Export is
available only while Classic Flubber is the selected preview. The
existing 30 Hz affect/marker and CSV behavior needs an audited native bridge
to the integrated surface; no main Runner/XDF claim follows from visual parity.

The pinned VLC 3.0.20 source already has a stable native video child in
`modules/gui/qt/components/interface_widgets.cpp`: `VideoWidget::request()`
creates `stable`, adds it to `VideoWidget`'s layout, and gives its `winId()` to
vout. A Flubber panel can occupy a sibling region while preserving that handle;
the containing layout, `physicalSize()`/resize reports, and release path require
audit together. `main_interface.cpp` places `VideoWidget` in the central stack,
but shows `BackgroundWidget` when idle, so the idle black/Flubber surface must
be handled explicitly rather than relying on the video child alone. The stock
View menu is assembled in `menus.cpp::VLCMenuBar::ViewMenu()`; an added action
there preserves the other menus and commands. This is a source map, not a
tested patch.

The user explicitly approved the native VLC Qt integration on 2026-10-07 and
asked to finish the full project. The new boundary still requires a documented
audit of native handles, threads, teardown, errors, and lifecycle. Establish a
reproducible Windows build of the pinned VLC Qt module before claiming a player
candidate. At approval time the machine had VLC 3.0.20 and MSVC but no
MSYS2/Qt toolchain.

## Planner appearance export receipt

The Planner Appearance section now downloads `flubber-appearance.json` from the
current Classic Flubber preview fields. The file uses the standalone
`vlc-flubber-appearance/v1` schema, with no experiment recipe or response
settings. The static Pages build vendors pinned Pretext 0.0.9 locally for the
button label; the Planner page loads without a bare module import. A downloaded
file was parsed in headless Chrome and Edge with the expected schema and keys.
Chrome layout checks at 1440, 800, and 320 CSS px showed the button without
clipping or page-width overflow, and the label wrapped at 320 px. Edge was
checked at 1440 px. A fresh Chrome Pages check downloaded the file even with
an invalid response-grid draft, confirming appearance-only capture. At 320 px,
200% text size plus text spacing left the button readable without clipping or
page-width overflow. A simulated long unbroken German label also stayed within
its button; the page itself already overflowed at 200% before that simulated
label, outside this pass's P5 export seam. The full Research test suite passed
1,231 tests, and Pages/desktop build verifiers passed. Independent read-only UI
and function reviews found no remaining defect in the Planner export seam.
This verifies the authoring export UI only; VLC import and final player
appearance remain open.

Acceptance evidence: compile and package the exact modified Qt candidate;
inspect idle and playing screenshots at normal and fullscreen sizes; exercise
Media Open File, drag/drop, playlist next, pause, seek, volume, subtitles,
fullscreen, and the added View action; round-trip an exported Planner preset;
reject malformed presets; verify manual size/position survives resizing;
check native LSL/CSV markers and samples independently. No item is claimed
passed by this record.

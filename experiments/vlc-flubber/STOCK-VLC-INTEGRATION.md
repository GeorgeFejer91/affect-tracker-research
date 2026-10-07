# Stock VLC Flubber integration decision record

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

Before implementation, obtain the project-required approval for a new native
unsafe boundary and establish a reproducible Windows build of the pinned VLC Qt
module. The current machine has VLC 3.0.20 and MSVC but no MSYS2/Qt toolchain.

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

# Same-master Planner and Runner layout capture

Status: comparison/probe prepared, no production artifact or final screenshot
captured by this allocation. Root coordinates Main and Runner. This branch
changes qualification files only, following P4 restoration `e13643f`.

Root/RR11 confirmed no verified combined native-child plus WebView screenshot
path exists yet. The existing640×360 Gst JPEG is video-only; the320×180 hidden
diagnostic is not a P4 master view; CDP omits the native child. Root owns capture
option review after production Runner is available. Do not add an unsafe
PrintWindow/WGC boundary or present a synthetic composite as an actual capture.
The native qualification gate remains false pending its separately owned audit.

## Interfaces

- `scripts/qualification/planner-runner-layout-dom.js` exports
  `captureLayoutDom(root, "planner" | "runner")`. It reads actual DOM rectangles,
  visibility and Planner numeric controls; it does not load a recipe or change UI.
- `scripts/qualification/planner-runner-layout-compare.mjs` exports
  `expectedLayout(recipe, annotationId)` and
  `compareLayout(recipe, sourceSha256, observation)`. Independent arithmetic
  imports no production layout resolver, compiler or rendering code. This bounded
  oracle supports relative units, largest-oriented-area and exact viewport only.
- CLI: `node scripts/qualification/planner-runner-layout-compare.mjs <actual-master.json> <observation.json> <new-result.json>`.
  The wrapper hashes the actual master, observation and screenshot and refuses
  replacement of the result. This is a measurement comparison, not an attestor.

Complete the probe result with `schema:"affect-layout-observation-v1"`, the
actual loaded `sourceSha256`, actual `annotationId`, and
`screenshot:{path,sha256}`. Runner additionally needs actual `phase:"video"`.
Never fill those fields from the expected configuration: obtain source and
occurrence identities from the actual app/native load and current-stage receipts.
Retain those original receipts beside the observation, with process/executable/
commit identity, timestamp, devicePixelRatio and screenshot capture method.

## Expected mock geometry

All coordinates below are CSS pixels relative to the 1920×1080 design viewport.
The maximum reference box is 1152×648. The 1920×1080 reference fits it exactly.
Its centre is (960,378), so the reference and actual video's contain rectangle
are (x=384,y=54,width=1152,height=648).

The feedback drawing viewport side is 24% of the shorter fitted reference side:
155.52. Offsets are 0% of reference width and 75% of reference height, giving
centre (960,864), rectangle (882.24,786.24,155.52,155.52). Minimum required gap
is 3% of 648 = 19.44. This side is the SVG drawing viewport, not the painted
Flubber diameter or halo extent. Painted bounds depend on P5 and input/animation
state; retain that state and independently inspect visible shape/halo pixels.

One additional candidate changes reference centre X to45, feedback offset X to10
and viewport side to18, preserving other mock values. It gives video x288,
feedback centre (979.2,864), side116.64. It must first pass actual P4/P5 fit and
normal production Save; this arithmetic is not permission to bypass validation.
Export it as a separate recipe and compare each app to its own exact source hash.

## Actual source surfaces reviewed

Planner `screen-layout-view.js` renders `.layout-reference`, `.layout-video` and
`.layout-feedback` inside `[data-layout-scene] svg` with a 1920×1080 viewBox.
The probe converts rendered rectangles through its actual screen CTM back into
design coordinates; it does not compare miniature CSS dimensions to fullscreen.
Capture all P4 controls and the miniature, plus the actual P5 Live Preview at a
recorded input/animation state. P5's separate preview is not the P4 experiment
placement surface and must not be labelled the full-screen video layout.

Runner source reviewed at `b06990b4c797ce6ec62ff9912c4944ca735f5bc5`:
`runner/src/master-presentation.js::applyMasterDesktopLayout` rejects a viewport
mismatch and positions `.stimulus-stage` at the reference rectangle and
`.run-feedback-stage` at the feedback rectangle. `runner/runner.css` makes these
absolute within `#runner-stage`; `#run-native-video-host` fills the stimulus host.
`site/src/research/native-run-media.js` reads that host's bounding rectangle for
the native surface. Rebind these files to the final clean integrated build before
capture. A host rectangle proves neither decoded pixels nor native child bounds.

## Pending capture procedure

1. Main supplies the actual production CLI-exported master and native save/load
   receipts. Preserve exact bytes and verify both apps loaded that SHA-256.
2. Use dedicated isolated processes/windows and private output paths. For browser
   captures, use a fresh headless profile, reduced motion, device scale1 and
   1920×1080 *inner* viewport; verify innerWidth/innerHeight, since launch window
   size alone may include browser chrome. Do not touch existing user windows.
3. Planner: reopen through the real owner path, bind actual media, select the
   actual clip in the P4 fit inspector, capture P4 controls/miniature and P5
   preview. Run the probe in that same frame, save its JSON and screenshot.
4. Runner: load the identical file, choose the actual language/variant, reach
   the real stimulus stage through its existing protocol, verify phase and
   occurrence/asset identity, then capture DOM measurements and screenshot.
   Do not substitute a fabricated selected plan or timed test jump.
5. Capture the actual native video child pixels/rectangle through an isolated
   process-bound offscreen/native screenshot path where available. Record device
   scale and client-origin conversion. Add `nativeVideo:{x,y,width,height}` only
   from that observation in CSS coordinates. A headless DOM screenshot that
   shows an empty/black host leaves native video measurement pending.
6. Run the comparator for each observation, then visually review both screenshots
   for actual video content, visible Flubber/halo, clipping and stage origin.
   Rectangles allow0.5 CSS px for renderer rounding; exact viewport and authored
   controls allow no drift. This is not a temporal or painted-envelope tolerance.
7. Repeat using the separately validated alternate recipe. Report any native
   capture limitation explicitly; no final visual/runtime-match or desktop
   playback qualification claim follows from this preparation or synthetic tests.

Three focused tests pass with hand-computed anchors and 15 failing counterexamples;
no app was launched. Production screenshots, artifact binding, native surface
measurement, both actual app observations and independent visual review remain
pending. Root retains final acceptance and Main retains app/native integration.

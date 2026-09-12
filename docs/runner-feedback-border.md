# Runner feedback container border

The Runner presentation inherited a 1 px border from shared `.run-feedback-stage`
CSS, adding a square around Flubber and consuming 2 px of its drawing area.
The Runner-specific rule now sets `border: 0`. Authored P4 geometry and P5
wavy outline, halo, colors and mappings are unchanged. No shared renderer edit.

The focused harness `scripts/qualification/runner-flubber-ui.mjs` is retained
independently of the older master harness so Main can collect this delta directly
from app-v2 commit bc03f75. It derives explicitly labelled synthetic inputs via
the strict production Planner compiler: 1920 by 1080 viewport, reference box
60 by 60 percent centered 50/35, feedback offset 0/75, side 24, minimum gap 3,
visible Flubber. Other original fixture values, including portrait reference,
remain unchanged; the grid fixture itself is not edited.

Evidence: `D:/GitHub/.affect-runner-master-build/runner-border-01/receipt.json`.
Four cases pass 348 checks. Visible outer, inner and SVG dimensions all measure
87.46875 px, versus the prior 87.46875 / 85.46875 / 85.46875 px. P4 projects
87.48 px (CSS rounding). Hidden ISI has zero visible bounds and neutral cached
mapping before Presented. Strong input changes the SVG path and color, and the
next video returns to neutral mapping. All four screenshots were inspected:
`flubber-neutral.png`, `flubber-strong.png`, `flubber-isi.png`, `flubber-next.png`.
The square frame is absent; the authored wavy outline remains.

This is production app/rendering code with synthetic native responses and an
explicit test-only 16 ms timer scheduler for renderFrame because headless virtual
time stalls native requestAnimationFrame. It is not native playback, physical
paint/timing, the CLI-authored real-video mock, or XDF qualification. User-open
windows and binaries were untouched.

Reproduce with:

```text
node scripts/qualification/runner-flubber-ui.mjs <Chrome.exe> <new-evidence-directory>
```

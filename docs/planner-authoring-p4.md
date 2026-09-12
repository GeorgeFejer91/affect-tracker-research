# P4 CLI owner adapter

CLI-P4 extends the completed Planner under the 2026-09-12 CLI allocation.
The later CLI/UI/Runner goal adds UI parity evidence; Runner consumption and
execution remain the Runner owner's allocated work. This adapter changes no
recipe version, saved geometry meaning, media permission or native authority.

## Integration

Import `createPlannerAuthoringP4` from
`site/src/research/planner-authoring-p4.js` and register
`createPlannerAuthoringP4({editor: screenLayoutEditor})` with the shared session.
The argument is the existing `createScreenLayoutDraftEditor` instance, not its
DOM root or an alternative draft. Main owns app/bootstrap registration.

The editor adds `stageAuthoringDraft(transform, {isCurrent, signal})`.
The synchronous transform receives a detached current draft and the existing
`convertUnits(candidate, units)` owner helper. It returns the complete candidate.
State syntax validation and geometry projection happen before staging resolves;
domain issues may remain in an editable, pending candidate. Conversion itself
requires complete current video geometry and the existing explicit calibration.

The returned `isCurrent()` checks owner revision, operation, lifetime, caller
guard and current P1/P5 dependency identity without updating observation caches.
Main must preflight **all** candidates before any commit, hold the shared
publication lock and invalidate the old file workflow. `commit()` installs the
precomputed candidate synchronously without validation, conversion or async work.
Its `afterCommit()` publishes the existing notification and synchronizes controls/
preview only after every owner has committed. Main invokes these hooks safely;
an observer/render failure must report an applied-but-incomplete result, never
claim that an already committed batch was rejected without mutation.
Preparing/confirming a contribution is a separate command; a field batch never
manufactures acceptance. Main owns global authored-edit and dependency fences,
final compiler/native transport and publication-safe notification wiring.

Queries return the current draft, including incomplete numeric text with an
issue. Valid numeric input text is normalized to its number; no last-valid
contribution supplies missing values. Empty optional calibration remains empty.
Unselected reference method is JSON `null`, with an explicit blocking issue.
Current geometry, all-video fits, automatic reference candidates/source and
fixed conventions are derived read-only entries.

## Stable CLI → UI → JSON mapping

Every row is authored and writable. The registry includes `uiControl` and
`jsonPath` as descriptive metadata; callers cannot use them as DOM or JSON-patch
addresses. The saved paths below are relative to `segments.P4` in the master.

| CLI setting | Existing UI control ID | Saved path / meaning |
| --- | --- | --- |
| `P4.viewport.widthCssPx` | `layout-screenWidth` | `viewport.widthCssPx` |
| `P4.viewport.heightCssPx` | `layout-screenHeight` | `viewport.heightCssPx` |
| `P4.calibration.activeWidthMm` | `layout-physicalWidth` | `calibration.activeWidthMm` |
| `P4.calibration.activeHeightMm` | `layout-physicalHeight` | `calibration.activeHeightMm` |
| `P4.calibration.fullViewportMapping` | `layout-fullViewportMapping` | Complete `calibration` object with `mapping: full-viewport`, or `null` when absent |
| `P4.units` | `layout-units` | `units`; setting a different unit converts all geometric fields through the existing owner |
| `P4.reference.method` | `layout-referencePolicy` | `reference.source.policy`; `null` is an incomplete draft only |
| `P4.reference.maximumWidth` | `layout-referenceWidth` | `reference.box.width` |
| `P4.reference.maximumHeight` | `layout-referenceHeight` | `reference.box.height` |
| `P4.reference.centreX` | `layout-referenceX` | `reference.centre.x` |
| `P4.reference.centreY` | `layout-referenceY` | `reference.centre.y` |
| `P4.feedback.viewportSide` | `layout-diameter` | `feedback.overlayViewportSide`; square drawing viewport, not painted diameter |
| `P4.feedback.offsetX` | `layout-offsetX` | `feedback.offset.x` |
| `P4.feedback.offsetY` | `layout-offsetY` | `feedback.offset.y` |
| `P4.feedback.minimumGap` | `layout-gap` | `feedback.minimumGap` |

Viewport dimensions are integers 1–32768 CSS px. Physical measurements are
numbers 1–100000 mm. Reference box and feedback side are 0.001–100000; centres
and offsets are −100000–100000; gap is 0–100000. Relative X/Y reference dimensions
and centres use viewport width/height. Feedback offsets use the **fixed fitted
reference** width/height; drawing side and gap use its shorter side. Millimetres
require uniform full-viewport calibration. Existing full owner validation also
checks aspect, bounds, clipping, overlap, separation and complete P1/P5 data.

Ordered operations have closed arguments and existing UI counterparts:

| Operation | Arguments | UI operation and saved result |
| --- | --- | --- |
| `convertUnits` | exactly `{units: "relative"}` or `{units: "mm"}` | Select the same Geometry units option. All authored sizes/centres/offsets/gap convert together; resolved geometry is preserved. Same semantics as setting `P4.units`. |
| `clearCalibration` | exactly `{}` | Clear both measured dimension controls and uncheck full-viewport mapping. In relative mode this can prepare `calibration: null`; in mm mode it stays incomplete until repaired. No implicit unit change. |

Both operations run at their exact position in the edit list. For example,
offset → convert → offset interprets the last value in the newly chosen unit.
Neither operation writes media, a file, acceptance or an extra experiment field.

The five derived entries map to existing outputs: `P4.geometry` and
`P4.videoFits` describe the miniature/readout and video-fit inspection;
`P4.reference.candidates` and `P4.reference.source` describe automatic analysis;
`P4.conventions` records the existing contain-fit/right-down/design-centre/exact
viewport rules. The saved source is derived from the complete catalogue, and
cannot be supplied by a caller. Missing dependencies yield explicit unavailable
geometry. These queries need no new authoring controls.

## Component evidence and remaining shared work

`test/research-planner-authoring-p4.test.js` hosts the real P4 editor/controller
and actual P1/P5 pure validators in minimal DOM test doubles. It uses the real
shared session from frozen foundation `2310efc` plus the required `afterCommit`
hook in `0138516`. Every authored descriptor is
matched to actual markup, edited through both CLI staging and the existing UI
event handler, read back and compared against an identical accepted profile.
Both methods and unit representations, ordered conversion, calibration clearing,
invalid/raw/incomplete values, read-only/unknown rejection, detached staging,
dependency drift, cancellation, disposal and multi-owner preflight are covered.
The 13 owner tests also author a complete profile from a fresh editor without
importing layout JSON, and verify current-receipt publication plus truthful
applied/incomplete results when an observer throws after all owners commit.

This is component/controller evidence, not a rendered browser, production hidden
native CLI, real media import or Runner execution receipt. Main/root own the
combined transport/UI/full-recipe evidence; Runner owns actual correspondence
under the newly activated end-to-end allocation. Historical no-Runner evidence
from the original P4 authoring pass does not defer that new goal.

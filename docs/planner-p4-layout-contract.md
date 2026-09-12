# P4 desktop layout contribution

P4 owns geometry for the Planner desktop presentation. P1 owns complete workspace
and oriented media validation; P5 owns all saved feedback configuration and its
maximum painted envelope. P7 owns master serialization and acceptance. The
internal `affect-research-screen-layout-draft` document is never a master input.

## Current acceptance boundary

The Planner requires one fixed percentage basis across all videos. The 2026-09-12
scope clarification (coordinator `84300ed`) supports both reference analysis
methods as explicit per-recipe choices: largest oriented pixel area or combined
maximum width/height. Neither is preselected. Missing selection prevents that
recipe's preparation; it does not block implementation of the accepted type.
The recorded `reference.source.policy` enum is mandatory and is independently
checked against the complete catalogue. This implements configurable authoring
without treating either method as a globally chosen experiment setting.

## Closed authored shape

The exact schema is `affect-research-desktop-layout-contribution`, version 1:

```text
schema, version, target: desktop-screen, coordinateSystem: viewport-right-down,
viewport: {widthCssPx, heightCssPx, compatibility: exact},
calibration: null | {activeWidthMm, activeHeightMm, mapping: full-viewport},
units: relative | mm,
reference: {
  source: {policy, assetId, displayWidthPx, displayHeightPx},
  box: {width, height}, centre: {x, y}
},
feedback: {origin: design-centre, overlayViewportSide, offset: {x, y}, minimumGap},
fit: contain
```

Shape validation supplies no defaults. Every field, including nullable fields,
is required; unexpected fields, nonfinite/coerced numbers, unsupported meanings
and negative zero reject. Viewport and oriented media dimensions are whole
1–32768; measured millimetres are 1–100000. Authored positive sizes are
0.001–100000, offsets/centres −100000–100000, gap 0–100000. One to 10000 unique
P1 immutable asset IDs must have complete oriented geometry. The standalone
canonical representation is sorted-key JSON plus one final LF, at most 8192
UTF-8 bytes. The master embeds the validated object, without an internal hash,
owner revision, permission, file handle, draft receipt or caller-supplied bound.

P1's generic validators/projections support historical v1 and location-identity
v2 workspaces. All location declarations are retained in P1. Its owner projection
deduplicates identical content by asset ID for geometry; P4 checks complete unique
asset coverage instead of confusing a repeated location with a repeated geometry.

The reference source must equal automatic selection from the entire validated
catalogue. Area ties use ascending immutable ASCII asset identity. The combined
maximum-dimensions method has `assetId: null`; the area method identifies
the actual video. Oriented width/height are P1's decoder interpretation, not
guessed encoded resolution or rotation.

## Units and geometry

The reference source is contained without cropping inside the authored reference
box, preserving its oriented aspect ratio. This produces one fixed reference
rectangle. Every video is then contained inside that rectangle at the same
centre. No inspected-video selection changes geometry, ownership or saved data.

In relative units, box width and centre X are percentages of viewport width;
box height and centre Y are percentages of viewport height. Offset X is a
percentage of fixed reference width, offset Y of its height; feedback viewport
side and minimum gap are percentages of its shorter side. In millimetres all
these values use the entered uniform `viewport.widthCssPx / activeWidthMm`
mapping. Measured display and viewport aspect ratios must match within 1e-6.
Millimetres require explicit full-viewport mapping. Converting representation
preserves the original box limits, resolved reference, centres, gap and P5 bounds.

Axes are right-positive X/down-positive Y from the viewport top-left. Feedback
uses its fixed design centre: `Cf = Cv + (offsetX, offsetY)`. `overlayViewportSide`
is the square SVG drawing viewport side, not animated painted diameter. The old
internal draft field `diameter` is mapped explicitly to this precise meaning.

P5's `resolveFeedbackEnvelope` dispatcher computes the complete saved renderer's
maximum painted half extent at the exact P4 viewport side. P4 does not implement
halo, motion or style formulas. Reference, drawing viewport and maximum painted
bounds must remain on screen. Every fitted video is checked for painted overlap
and Euclidean rectangle separation. Fully hidden feedback has zero painted
extent and no overlap/gap requirement. No failure silently moves/resizes layout.
Observed viewport dimensions must equal the authored viewport; a mismatch has
an explicit rejection. This pure check does not attest a physical monitor.

## Public composition APIs

`site/src/research/desktop-layout-contribution.js`:

- `validateDesktopLayoutContribution(value, {workspace, feedback})` → async
  detached profile or throws. Both arguments are complete saved owner payloads.
- `resolveDesktopLayoutContribution(value, {workspace, feedback})` → async
  `{profile, geometry, videos, envelope, inputKind, issues}`. It validates P1/P5
  itself, selects the fixed reference and rejects any fit issue.
- `serializeDesktopLayoutContribution` / `parseDesktopLayoutContribution`
  use the same validation and strict standalone canonical bytes.

The lower-level profile/geometry helpers in `desktop-layout.js` support isolated
calculation testing. Shape validation alone does not establish contribution
acceptance. The internal envelope parameter must be produced by P5; the public
saved-content APIs never accept a precomputed bound.

Controller methods provided by the P4 editor:

- `prepareScreenLayoutContribution({isCurrent?})` validates the current draft
  against live P1/P5 and returns a prepared five-key owner snapshot. No file is
  written. The shared footer awaits it before asking P7 for registry acceptance.
- `validateScreenLayoutContribution(value, {dependencies?})` accepts exact P1/P5
  five-key owner snapshots; without them it reads the connected live owners.
- `restoreScreenLayoutContribution(value, {dependencies?, isCurrent?})` performs
  atomic ready-state restore against actual current dependencies.
- `restoreScreenLayoutContent(value, {savedWorkspaceContribution,
  savedFeedbackContribution, isCurrent?})` validates complete saved content then
  restores editable fields as pending, with current actual dependency revisions.
  It grants no media permission and requires later preparation and acceptance.
- `restoreScreenLayoutDraft` remains the strict internal draft restoration API.
  Its recoverable numeric strings never enter an accepted contribution. Current
  draft v2 adds nullable `referencePolicy`; the frozen v1 draft reader remains
  exact and explicit v1 restoration leaves the new choice unselected.

Edits and dependency changes withdraw prepared data. Identical notifications do
not invent a revision. All restores/preparations share an operation generation;
edits, a newer request, dependency changes, cancellation and teardown reject
stale work before mutation. A ready restore publishes one complete state change.
Failed validation also checks freshness before exposing an error. A current
field error opens its containing disclosure, focuses the corresponding control
and scrolls it into view; an old failure cannot steal focus after a newer edit.

## Native mirror and evidence

`research_desktop_layout::DesktopLayoutContributionV1` mirrors the authored
shape. `validate()` and `validate_accepted_policy()` require either explicit
supported policy and the complete closed authored shape. `resolve_base()` yields the explicit P5 viewport
side. `resolve(media, envelope)` then checks all geometry using P1's validated
projection and P5's derived envelope, returning `{geometry, videos, issues}`.
The master compiler must reject nonempty issues and validate full P1/P5 first.
This module introduces no IPC, unsafe, storage or runtime display authority.

The shared `desktop-layout-candidates-v1.json` retains its historical filename;
its cases now represent explicit per-recipe choices. Tests cover strict shape, fixed reference and centres, unit
conversion, every-media fit, painted bounds, incompatible viewports and isolated
process reproduction. State-machine tests isolate the lifecycle with a shape
validator. Separate actual-app checks prepare and accept the real P4 contribution
through P7, round-trip canonical bytes and compare them with preview geometry.
Runner correspondence/execution/recording remains the final, separately allocated
development stage. Installed/native/Edge/physical qualification is not implied.
The final component's exact source, checks, capture hashes and integration limits
are recorded in the [P4 evidence ledger](../for-ai/40-ROADMAP.md#p4-accepted-planner-layout--2026-09-12).

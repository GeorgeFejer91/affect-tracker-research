# P6 virtual-screen authoring contract

P6 implementation receipt/specification, 2026-09-11. Read the canonical charter
amendment and central catalogue first. This isolated branch began at `305d3ac`
and merged the canonical documentation checkpoint `6be0a79`; both owners' board
entries were retained. Application integration remains the integration owner's job.

## Scope and decisions

The user allocated segment 6 and clarified a virtual screen viewed inside a
headset through a future WebXR Runner, with precise distance, size and viewing
angles. This is a bounded Backend Verification pass for P6-01/02/03/05.
Headset rendering, actual tracking/alignment, playback, recording and physical
qualification remain P6-06/R1 work. No historical Playground code is restored.

The user separately answered **“Yes, use these alignment rules”** to Q11:
head-forward with no eye tracking, one world anchor throughout the attempt,
stop on tracking loss, and recentering only before the next attempt. This
explicit answer supersedes the earlier pending-policy notes. Q15's initial
profile is a flat monoscopic WebXR screen. Combining alternative desktop/XR
profiles in one master envelope remains P7's decision and implementation.

## Contract and ownership

`XrLayoutProfileV1`, schema `affect-research-xr-layout`, is a strict separate
authoring contribution. It is not an `ExperimentPackageV1`. Its canonical
representation is UTF-8 without BOM, sorted keys, one LF, maximum 8192 bytes.
JS and Rust independently reject unknown/missing fields, invalid policies,
out-of-range numbers, unsupported targets and noncanonical bytes. The parser
also rejects duplicate keys; exact byte reserialization is mandatory.

- Target `webxr-immersive-vr`; projection `flat-monoscopic`.
- Units metres; right-handed axes +x right, +y up, forward −z.
- `alignment`: `world-fixed-initial-forward`, `head-forward`, `gravity-up`,
  `between-attempts-only` recentering, `stop-attempt` tracking-loss policy.
- `video`: centre distance, azimuth/elevation, yaw/pitch/roll, physical
  width/height, fixed `contain` fit. Distance is 0.1–100 m, dimensions
  0.001–100 m, centre angles/yaw/pitch −80…80°, roll −180…180°.
- `feedback`: enabled, local x/y centre offsets (−100…100 m), reserved maximum
  footprint diameter (0.001–100 m), minimum gap (0–10 m). Local depth is zero.
  This footprint is a geometric allocation, not a copy of P5 animation policy.

These bounds constrain the authoring algorithm, not recommended experimental
settings, calibrated perceptual accuracy or a headset field-of-view claim.
Initial UI values are suggestions; every imported field must be explicit.

P1 owns oriented media geometry and catalogue identity/revision. P5 owns
appearance/input and the complete animation/halo envelope. P6 owns the fixed
spatial rectangle and local offsets. P7 owns master composition, cross-reference
validation, native storage, acknowledged save and v1 export/Start exclusion.

`createXrLayoutEditor` returns `getSnapshot`, `loadProfile(canonicalSource)`,
`setDependencies` and `destroy`. Snapshot has `enabled`, safe integer `revision`,
`pending`, accepted `contribution` or null, and `dependencyRevisions` as
`[{segment: 'P1'|'P5', revision}]`. Missing dependencies remain visibly unbound;
P7 must require them before finished experiment export. Pending or invalid edits
never return the last accepted contribution. Disabled optional XR contributes
nothing. P7 registers the getter and receives `plannerContributionChanged('P6')`.

The named composition mount is `SECTION_CONTENT.xr` with the `xr` Setup section,
labelled **VR screen layout**, immediately before Review. Its accordion, keyboard
navigation, motion and confirmation use the generic section mechanism. It is
independent of P5's removal of the old Visual section. P7's ready `e524b9f` owns
automatic getter registration and every v1 export/Start guard; **integrate that
seam with this UI**, never activate this branch's standalone UI without it.
P7's followup maps the P6 issue route to `xr`.

`setDependencies({catalogueRevision, feedbackRevision, catalogueGeometry,
feedbackEnvelope})` receives P1's verified-only projection
`[{assetId,displayWidth,displayHeight}]`, plus P5's full resolved envelope.
`previewMedia` is an optional geometry-only fixture/inspection input, not saved
asset identity. Unknown/missing dimensions and duplicate IDs reject. Selection
in **Inspect video fit** changes only the inspected asset; all assets share the
profile's fixed screen. Dependency changes invalidate acceptance; changed bound
content also invalidates if a producer mistakenly reuses its revision.

The downloadable `xr-layout.profile.json` is explicitly labelled authoring
interchange, not a finished recipe or parallel Run authority. The UI reports a
download request, not a successful native disk write. Reopening reparses exact
bytes and restores editable fields. File-read generations reject stale completions
after intervening edits or teardown. No ambient storage/locale supplies values.

## Geometry

For azimuth a, elevation e and distance d, screen centre is
`(d cos(e) sin(a), d sin(e), −d cos(e) cos(a))`. Column-vector screen rotation is
`R = Ry(yaw) Rx(pitch) Rz(roll)`, applied roll then pitch then yaw using
right-handed angles. Screen-local feedback centre offset maps as
`Cf = Cv + R × (dx,dy,0)`. The fixed design centre is independent of animation.

All videos contain-fit within the same saved width×height rectangle and share
its centre and rotation. Portrait videos therefore letterbox without changing
the feedback relationship. A missing/invalid display-geometry input rejects;
the editor's no-library state shows only the authored screen, not media proof.

Physical dimensions are the one saved size authority. Angular editing is allowed
only when the screen is centred and has zero yaw/pitch/roll; it replaces metre
dimensions with `2 d tan(angle/2)`. Moving the screen later preserves those
metres. Offset/tilted configurations show derived setup-frame angular extents;
the centred inverse formula is not used there. Extents include stationary
elevation points inside rectangle edges, not just the corner rays.

Validation requires the complete screen and enabled reserved feedback bounds
to remain at least 0.01 m in front of the setup viewer, the screen to face that
viewer, and the circular maximum feedback footprint to retain the requested gap.
No hidden clipping, per-video position changes or fit repair occurs. P5's actual
full-range envelope must be bound before combined acceptance; the provisional
outline is not proof of actual P5 rendering or calibrated size.

`xr-feedback-footprint-v1` resolves P5 `feedback-envelope-v1` at the explicit
1024 CSS-pixel square reference viewport, with P5's `design-centre` origin,
`configurationKey` and viewport provenance retained. This is a rendering
reference, never observed display pixels or CSS-to-metre device calibration.
For P5 square half-extent h and authored maximum footprint diameter D,
`metresPerCssPx = D / (2 sqrt(2) h)`. This uniformly maps the **complete** square
inside the reserved circle, including non-scaling strokes/halo. The scale is
fixed throughout all input/animation states; no frame-dependent resize occurs.
Zero visible extent or disabled feedback resolves no painted bound. JS and Rust
share exact producer fixtures and reject wrong viewport/algorithm, nonfinite
extents and impossible scales. The 3D inspection draws the resulting square
inside the reserved circle when P5 is bound. Future P7/R1 consumers must derive
P5's envelope from owned saved configuration, not trust an imported claimed bound.

The orbit/front/side/top inspection is orthographic and presentation-only. It
changes no saved field/revision. Initial forward alignment projects head heading
onto the gravity-horizontal plane; a vertical/degenerate forward vector rejects.
The pure alignment fixture captures that frame once; real poses remain Runner
attempt evidence, never portable profile contents.

## Validation and completion boundary

Shared canonical and geometry fixtures cover centred, offset/tilted, roll,
mixed-aspect and small/distant screens plus malformed profiles. Independent
Node processes forbid ambient clock/RNG/storage/navigator reads and compare exact
bytes and geometry. Dense-edge sampling checks analytic angular extrema.
Rust mirrors validate bytes/hash and transforms within explicit float tolerance.
The offscreen DOM fixture checks dirty/accepted state, reflow, focus, stale file
reads, orbit isolation and teardown without controlling the user's desktop.

Detailed test/build counts and P1/P5/P7 integration state are recorded at handoff
in the message board and evidence ledger. P6 component checks do not close the
master recipe, headset, WebXR execution, media, LSL, timing or research gates.

## Live authoring continuation — 2026-09-12

The P6-owned `xr-layout-authoring.js` now composes the actual producer snapshots
and subscriptions. It invokes the P1-owned validating geometry projector and
P5's `validateFeedbackContributionV1` / `resolveFeedbackEnvelopeV1` at the fixed
1024 CSS-pixel reference. It never trusts an imported caller-asserted bound.
P1's `projectWorkspaceVideoDisplayGeometryV1` receives the whole five-key
workspace snapshot, validates study/layout/catalogue together and preserves the
registered outer revision. P6 subscribes to that same workspace producer.
Study-only edits therefore invalidate P6 even when the nested catalogue revision
and video geometry remain unchanged. A video-only payload is not a substitute.
The full catalogue must validate; missing or unsupported media does not become
a shortened set of fitted videos. No valid video means the experiment-layout
contribution cannot be accepted. Standalone profile interchange remains available.

Changes to either owner withdraw accepted bounds before asynchronous validation.
An unchanged notification leaves the revision alone. Content changes invalidate
even if a producer mistakenly reuses its revision; later P7 checks still reject
that producer error. Generation checks discard older validation results after a
newer change or teardown. Reopen checks the current dependencies, caller's
`isCurrent` guard and the XR editor revision before replacing any editable state.
Invalid, cancelled or stale reopen cannot overwrite a newer layout.

Controller interfaces for P7/integration:

- `waitForXrLayoutDependencies()` settles the current producer projection;
  `getXrLayoutDependencyStatus()` reports pending state and a bounded issue.
- `prepareXrLayoutContribution({isCurrent})` validates the enabled current draft
  against live P1/P5 inputs and returns its five-key domain-prepared snapshot.
  Disabled XR remains absent. The footer can prepare and then call P7 acceptance
  in one action; no prior internal layout acceptance is required. Cancellation,
  edits, dependency changes and teardown fence preparation before any commit.
  `acceptXrLayoutContribution(options)` remains a compatibility alias.
- `validateXrLayoutContribution(profile, {dependencies, selectedTarget})`
  returns asynchronous true or throws without changing the editor.
- `restoreXrLayoutDraft(profile, {isCurrent})` synchronously validates and renders
  saved authored content as enabled/pending with no contribution. This is the
  content-only master reopen path while P1's media declarations are unresolved;
  it grants no media authority and requires later live preparation/confirmation.
  Invalid/cancelled calls and teardown cannot replace the draft.
- `restoreXrLayoutContribution(profile, {dependencies, selectedTarget, isCurrent})`
  validates before an atomic commit and returns the resulting five-key snapshot.
  Dependencies are exact P1/P5 owner snapshots. Their outer revisions are bound;
  embedded catalogue revisions are not substituted. A request superseded while
  dependencies are still settling rejects and can be retried with current state.

Final validation and restore require `selectedTarget: "webxr-immersive-vr"`.
Missing, desktop or unknown targets reject. P7 owns selection of the master
recipe target and calls its acceptance registry separately. Local profile
acceptance, registry acceptance and acknowledged file save retain distinct
meanings. This does not finalize Q15's alternative-profile master representation.

Independent parsers use the same pure helpers, without an editor:

```js
const dependencies = await resolveXrLayoutDependencies(
  { P1: workspaceSnapshot, P5: feedbackSnapshot },
  projectWorkspaceVideoDisplayGeometry,
);
const compiled = resolveXrLayoutContribution(profile, dependencies, selectedTarget);
```

Both P6 functions are exported from `site/src/research/xr-layout-authoring.js`;
the projector is P1's `site/src/research/workspace-contribution.js`. The compiled
result contains `{profile, requirements, videos, feedback}`. Master serialization
and target selection remain P7-owned; this helper introduces no new saved fields.

## Successor master adapter — Planner completion pass

P7's successor master stores `segments.P6` as the closed union
`{status: "excluded"}` or `{status: "included", profile: XrLayoutProfileV1}`.
Included means the entire profile is retained. Excluded intentionally contains
no XR profile; reopening it discards a previous document's profile/preparation,
disables XR and initializes only the editor's defaults. Those defaults are not
saved execution data. P4 desktop configuration remains in the master; the
explicit selected presentation target still controls compatibility and never
falls back from enabled XR to desktop.

`xr-layout-recipe.js` is the pure P6 import for a master parser:

- `validateXrLayoutSelection(selection)` validates that exact union and the
  complete included profile. It supplies no profile when excluded.
- `resolveSavedXrLayoutContribution(profile, {workspaceContribution,
  feedbackContribution, selectedTarget})` validates complete saved P1/P5 content
  through their owners, reproduces all declared videos/feedback geometry, and
  returns `{profile, requirements, videos, feedback}`. It creates no live
  snapshot, revision, media permission or readiness receipt. Caller data is
  captured before asynchronous workspace hashing.
- The controller's synchronous `restoreXrLayoutSelection(selection,{isCurrent})`
  requires a current-request guard. Included restores an editable pending draft;
  excluded clears previous profile state. Neither prepares or accepts P6.
  The existing strict live prepare/restore path handles later verified media.

Both live and saved-content adapters now invoke P5's
`feedback-settings.js::validateFeedbackContribution` and
`feedback-layout.js::resolveFeedbackEnvelope` dispatch. The strict V1 reader is
preserved; complete V2 renderer, labels, halo and response configuration cannot
be truncated to the old three-field input. The physical footprint explicitly
accepts P5's `feedback-envelope-v1` and `feedback-envelope-v2` contracts, retaining
the same uniform square-to-circle conversion and configuration key. P5 owns all
renderer/gradient/stroke bounds; P6 duplicates no animation math.

P1's generic workspace validator and display-geometry projector dispatch exact
V1 and V2 content. The V2 workspace retains separate path-derived location
identities even when video bytes match; P1 supplies one geometry per content
identity. P6 consumes that projection without dropping saved locations or
copying P1's identity policy. Live composition injects the same generic P1
workspace projector, binding its outer owner revision.

Complete P7 envelope fixtures are being composed in this pass. Actual Runner
correspondence and XR execution are downstream checks, not a prerequisite for
validating the complete Planner document.

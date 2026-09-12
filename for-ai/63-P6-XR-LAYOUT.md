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

# Planner gap-closure plan and missing-segment designs

Prepared 2026-09-11 for the researcher's request to identify incomplete segments,
prioritize their remaining work and design the missing sections.

## Status and authority

**All seven Planner segments are incomplete against the final-state objective.**
Several have substantial reusable components. P4 Screen & Layout and P6 XR have
no integrated target editor; P3 has an unintegrated editor predecessor. No
segment becomes complete merely because this design document exists.

[60-SEGMENT-CATALOGUE.md](60-SEGMENT-CATALOGUE.md) remains the single capability
checklist and decision register. This document supplies proposed designs,
dependencies and bounded implementation passes, not another completion checklist.
Accepted researcher decisions in the catalogue prevail. **Every new behavior
labelled proposed below is a reviewable recommendation, not a newly accepted
requirement.** In particular, wire names, migration, geometry conventions and
unanswered decisions must be settled in their allocated contract pass.

Source baseline: integrated `305d3ac6b2de40a27436f7c97cb1ee2d2a2e87ce`.
[61-IMPLEMENTATION-AUDIT.md](61-IMPLEMENTATION-AUDIT.md) contains source evidence;
[40-ROADMAP.md](40-ROADMAP.md) contains test and qualification receipts. Pending
branches are reuse candidates, not integrated completion evidence. The current
pass changes documentation only. Runner execution, actual LSL recording and
device qualification remain separately allocated future work.

## Which segments remain incomplete

| Segment | What can be retained | Most consequential gap | Priority |
| --- | --- | --- | --- |
| P1 Workspace & Video Library | Workspace adapters, file verification, catalogue foundations | Correct imported-file location; stable readable video IDs; saved display geometry; editable library and relocation contract | Critical: P3/P4/P6 depend on it |
| P2 Questionnaires & Languages | Item/option codes, language coverage, imports and table editing | Reopen and revise a finished recipe; complete selected-language content; decide placements and computed scoring | Critical for studies using questionnaires |
| P3 Versions, Timing & Markers | Strict old schedules; pending version-column editor | Named ISI dictionary, stable variant/occurrence identities and complete recipe/marker contribution | Critical: the experiment sequence is otherwise incomplete |
| P4 Screen & Layout | Existing normalized placement as a migration input | Whole-screen editor, fixed-reference centre geometry, physical units and mixed-video fit validation | Required for the requested desktop design |
| P5 Flubber & Controls | Saved bindings, appearance and mappings; live preview | Consolidated editor, explicit saved-control inventory and one shared layout authority | Required; much existing logic can be reused |
| P6 Optional XR Spatial Layout | Accepted world-fixed/forward-aligned requirement | Spatial contract, 3D authoring preview, validation and round trip | Optional; does not block a desktop-only recipe |
| P7 Review, Recipe & Export | Strict v1 compiler, integrity and reproduction foundations | One successor recipe from a blank study; dependency validation; reliable save acknowledgement and editable reopen | Critical: the final deliverable passes through it |
| R1 Runner | Existing v1 execution and recording components | Successor recipe execution, richer LSL events, recording/reconstruction and qualification | Deferred; not a Planner implementation allocation |

## Delivery order and bounded passes

Begin with the shared recipe contract and P1/P3 dependency chain. Do not defer
integration until every editor is finished: connect accepted contributions to
P7 incrementally, and preserve a truthful incomplete state for unfinished ones.
Read-only review of pending work can proceed alongside contract design; source
integration needs its own owner and the workflow's convergence checks.

| Pass | One owner and catalogue items | Bounded deliverable | Evidence needed to close that slice |
| --- | --- | --- | --- |
| A | `contracts`, P7-05/P7-06 and named P1–P6 interfaces | Successor recipe envelope, contribution/version ownership, bounded IDs/units, capability declarations and v1 compatibility design; one valid and several invalid conformance fixtures | Mirrored contract fixtures reject unknown fields, dangling references and unsupported versions; old v1 fixtures keep their meaning. No Runner implementation |
| B | P1, P1-03 through P1-07 | Import to the verified package asset root, catalogue annotation review, saved media geometry and stable library revisions | Import→rescan→save→reopen preserves IDs and verified bytes; duplicate names, changed bytes and relocation produce explicit outcomes |
| C | P3, P3-02/P3-03/P3-05/P3-08/P3-09/P3-10 | Adapt the pending editor to the named-ISI dictionary and typed chronological entries; produce deterministic per-variant timelines | Paste/dictionary/edit/repeat/unknown-ID fixtures; no raw numeric table cells; no silent renumbering or order repair |
| D | P3, P3-04/P3-06/P3-07 | Ordered variant identities with Runner-owned selection, plus versioned event/reconstruction specification and synthetic trace fixtures | Every declared variant resolves its exact sequence independently; no Planner allocation policy is introduced; repeated occurrences and malformed/incomplete traces remain distinguishable |
| E | P2, P2-04 through P2-08 | Collect compatible S2 work, editable language/family authoring and exact save/reopen; implement only agreed placement/scoring additions | Required language coverage, preservation of imported hooks/codes, invalid/dirty draft gates and edit→export→reopen→re-export evidence |
| F | P4, P4-02 through P4-07 | Implement the screen/layout design below against P1 geometry and a declared P5 animation envelope | Mixed-ratio geometry fixtures, unit conversion, overlap/clipping errors and preview/export/reopen agreement |
| G | P5, P5-04 through P5-08 | Consolidate Input/Visual/Advanced around the preview; persist the agreed controls and consume P4 geometry | Every saved control round-trips; temporary simulator input does not; maximum animation extent agrees with P4; keyboard/reduced-motion checks |
| H | P7, P7-03 through P7-09 | Compose the accepted contributions, actionable review, acknowledged save, editable reopen and immutable exported revisions | Complete blank-study→export→clean-reopen path, stale-edit and write-failure tests; independent-instance reproduction across variants/languages/layout profiles |
| I | P6, P6-01 through P6-05 | Optional spatial profile and 3D preview using the design below | Deterministic transforms/angles, target validation and export/reopen; no headset, WebXR or recording qualification implied |

Pass A is a contract allocation, not permission to rewrite all segments. P2 work
can proceed alongside P1/P3 once interfaces are stable. P4 geometry design and
pure fixtures can precede P5 consolidation by consuming an explicit declared
envelope; final fit acceptance needs the actual supported P5 envelope. P6 follows
the core desktop path and is not a prerequisite for Pass H's desktop completion.
Each row can be split into smaller UI Finalization and Backend Verification
passes under [50-AGENT-WORKFLOW.md](50-AGENT-WORKFLOW.md); these rows do not bypass
stage or evidence gates. No date/effort estimate is asserted before sizing them.

**Next implementation allocation proposed:** Pass A only, then P1 Pass B and
the pending S3 adaptation in Pass C. First close the browser import/root mismatch
as the smallest P1 repair; do not build a new catalogue on an incorrect file
handoff. Optional XR and cosmetic cleanup should not delay those contracts.

## Recipe composition and editing design

The final download is one master JSON recipe plus separately referenced video
files. Working authoring files may exist in the workspace, but none may remain
necessary to interpret an exported recipe. The final JSON embeds questionnaires,
the ISI dictionary, versions, all accepted controls and the chosen layouts.

| Logical contribution | Owner | Required contents and references |
| --- | --- | --- |
| Study/workspace/library | P1 | Study identity, recorded workspace binding, stable video annotation and identity, safe relative file reference, hash/length/duration, oriented display dimensions/aspect |
| Questionnaire catalogue | P2 | Languages, exact definitions, item/option IDs and scores, accepted presentation/scoring rules, named module definitions and language bindings |
| Experiment design | P3 | ISI dictionary, ordered variant IDs and typed entries, occurrence IDs, explicit Runner-selection boundary, placement references and event/marker semantics |
| Desktop layout | P4 | Screen/reference geometry, units, fitting rule, video centre, Flubber footprint and centre offsets, runtime geometry requirements |
| Feedback and controls | P5 | Input bindings/response behavior, appearance/mappings, approved animation settings and the envelope calculation identity |
| Optional spatial layout | P6 | Spatial units/axes, setup alignment, distance/angle/size, centre-relative transforms and compatible-target requirements |
| Composition metadata/policies | P7 | Successor schema identity, all contribution versions, playback/acquisition/output choices, selected target requirements and derived integrity |

These are semantic blocks, not approved root-field names. Keep v1's strict
nine-root-member contract intact. The contract pass chooses explicit successor
versions for changed nested models; a new outer version cannot disguise changed
meaning in an unchanged nested v1 type. Migration reports carried, unresolved
and unsupported settings. A v1 explicit schedule must not be guessed into a
new variant design; import it without reinterpretation or request deliberate redesign.

Proposed internal handoff: each editor supplies its accepted typed contribution,
revision and dependency revisions. Validation returns the owning segment, field
or cell, error code and a readable repair message. Other segments consume these
interfaces; they do not mutate the owner's state or pull values from DOM controls.
The composition root coordinates adapters, preserving native Rust authority.

Proposed editing lifecycle: **editing → valid draft → accepted contribution →
compiled recipe → saved recipe**. Invalid/draft changes remain recoverable and
make the current design incomplete; they must not silently export the last
accepted version as though the latest edits were included. P7 only reports
Saved after the storage adapter acknowledges the exact bytes/hash. A cancelled
or failed write leaves a retryable compiled design, not a success indicator.

Any run-defining edit invalidates the affected dependent contributions and
compiled recipe. For example, changing a referenced ISI invalidates P3 timelines
and P7; changing video dimensions invalidates P4/P6; changing animation extent
invalidates layout fit. It need not invalidate unrelated questionnaire wording.
Accepted exports are immutable snapshots. Reopening projects their content into
editable owners; editing produces a new recipe revision, preserving old evidence.
Keeping rejected drafts and source provenance solely in authoring storage is
proposed under Q13; it does not create a second Runner authority.

## P1 design: Workspace & Video Library

The section asks for a workspace and study identity, then an explicit video
folder/file import. Show a catalogue table with annotation, relative folder/file,
duration, displayed width×height, aspect and verification state. The researcher
reviews collisions and annotations before accepting the catalogue. Import and
rescan are explicit actions; directory enumeration never defines experiment order.

Proposed identity model: a persistent catalogue identity plus a readable annotation
initially derived from all relative folder components and the extensionless
filename joined with underscores. Keep the byte hash separate: changed media is
not the same verified asset merely because it retains a filename. P3 paste uses
the readable annotation and resolves it to the saved identity; rename/replacement
requires an explicit dependency update, never a silent new video in an old slot.

Q04 still owns normalization, case/Unicode, nesting and collision rules. Proposed
collision flow: display every conflict and require a unique reviewed annotation;
do not assign different suffixes according to filesystem enumeration. Keep
existing IDs during unrelated rescans. Missing files and replacement bytes block
dependent export until resolved. Reuse content-bound identities from pending S3
where compatible; a `video-<hash>` display name alone does not fulfill the requested
folder_filename annotation workflow.

For Q05, propose a recorded logical workspace/library binding with safe relative
asset paths. Selecting/rebinding a directory authorizes the platform adapter;
JSON cannot restore a browser directory permission or grant arbitrary native
filesystem access. If original absolute path provenance is required, settle its
bounded representation and native authority explicitly before adding it. Display
geometry must account for orientation and display aspect, not just encoded pixels.

Pending S3 currently preserves browser source-relative folders but flattens native
imports into `assets/stimuli/imported/` with hash-suffixed filenames. P1 must retain
reviewed source folder/name annotations separately from storage paths on both
platforms. Its pending four-field annotation records also lack duration/display
geometry; extend the contribution explicitly instead of inferring them in P3/P4.

## P2 design: Questionnaires & Languages

Retain a family catalogue with a language coverage matrix and one editable table
per family/language. English and German start the workflow; additional languages
use exactly the same definitions and coverage checks. Each item keeps wording,
required status, option IDs, visible labels and numeric/null score annotations
distinct. Saving updates every module reference without moving imported hooks.

Add an explicit administration/scoring summary: which module is required, which
language variant supplies it, where it runs and what scoring is actually defined.
P2 owns definitions and module requirements; P3 owns their resolved position in
the timeline. A placement control can be displayed in P2 while submitting to that
single scheduling owner. Preserve all existing imported placement semantics.

Q09 is unresolved: required placements, computed totals/subscales and missing
answers beyond explicit option codes. Do not manufacture scoring formulas or
instrument translations. If requested, computed scoring should use a bounded
declarative rule with named items/subscales and an explicit missing-answer rule,
not executable spreadsheet formulas. Questionnaire administration is response-
dependent, so it interrupts a fixed-duration timeline estimate. P3 must show
known planned intervals separately from unknown questionnaire response time.

Reopening a recipe must restore editable content, coverage and accepted
presentation settings. An available language name or instrument catalogue entry
does not mean its authorized full questionnaire content is present. Requests for
new instrument content remain separate from the editor's functional completion.
Pending S2's whole-grid CSV/TSV is a content projection, not complete definition
interchange: item/option identities, subscales and provenance need preservation
through the owning definition model. Row replacement/reordering must not silently
attach old scientific metadata to new item text. Existing same-table tests do not
prove arbitrary edits survive the complete master-recipe round trip.

## P3 design: Versions, ISIs and planned event profiles

Use three connected areas: **ISI definitions**, the **version table**, and a
**derived timeline preview**. The table remains one column per version
with chronological video-ID or named-ISI rows. Never transpose it into one row
per participant, generate a counterbalance order or require manual start/stop cells.

The comma-separated ISI field creates a reviewed dictionary. Each entry displays
a stable ID, duration in milliseconds and reference count. Subsequent edits act
on those entries; editing/reordering the text list must not silently rebind ISI1
to a different accepted interval. Proposed lifecycle: duration edits preserve
the ID and invalidate references; additions get unused IDs; deletion with live
references requires replacement/removal; duplicate durations are allowed as
distinct definitions without automatic deduplication. Final naming, numeric bounds,
zero duration and edit/import behavior remain Q14/Q02. All durations, names,
counts and sequences in examples are researcher-defined, not application presets.

Each cell displays the video annotation or ISI name, type and resolved duration.
Each video has a consistent distinguishing color; ISI cells are red. Unknown
IDs, collisions and bare numeric cells have a cell-specific error. Color is not
the only type/error signal. Large catalogues still need readable labels when
colors cannot be reliably distinguished. Bounded explicit paste is input;
spreadsheet formulas are never executed.

Proposed sequence edge rules for Q02: each column is an explicit finite sequence;
unequal lengths are allowed, trailing empty cells are visible padding, internal
blanks are errors, repeated videos are allowed with separate occurrence IDs,
and adjacent videos imply no inserted gap. Leading, consecutive and terminal
ISIs may be kept as explicit authored intervals rather than merged or erased.
These edge rules require confirmation before dependent implementation. No
implicit block or questionnaire syntax is inferred from a blank or an ID string.

Illustrative logical contribution (not a runnable package or frozen schema):

```json
{
  "isiDefinitions": [{ "id": "ISI1", "durationMs": 1000 }],
  "variants": [{
    "id": "V1",
    "entries": [
      { "id": "entry-a", "kind": "video", "videoId": "calm_forest" },
      { "id": "entry-b", "kind": "isi", "isiId": "ISI1" },
      { "id": "entry-c", "kind": "video", "videoId": "calm_forest" }
    ]
  }]
}
```

Latest Q06 answer in S3 on 2026-09-11: **“Leave allocation policy to Runner.”**
This supersedes the earlier Planner cyclic-allocation design. Variant array
order preserves the researcher's authored version order; it does not prescribe
which participant receives a version. P3/P7 expose stable variant identities and
an explicit Runner-owned selection boundary without a Planner participant UI or
allocation algorithm. The fragment above illustrates only the authored data;
the final versioned boundary encoding remains the contribution owners' work.
Runner retry/skip/override and selection rules are later Runner decisions.

The two forest entries are different planned occurrences although they reference
the same video. A restart is a new execution occurrence of a planned entry, not
a new video identity. Entry IDs persist across unrelated edits; changing order
changes the compiled sequence/profile hash. The recipe contains the authoritative
references and a versioned derivation rule. Any stored derived event profile is
checked against them, not independently editable timing information.

**Marker design:** define bounded event types for session, video, ISI, form,
pause/resume, interruption, restart, completion and partial completion. Each
synthetic trace identifies recipe/profile, run/attempt, variant, planned entry,
execution occurrence, video/ISI/module identity as applicable, event type and
monotonic sequence. Exact identity encoding must preserve the existing outbound
privacy boundary: no participant raw names, arbitrary filename/path strings,
questionnaire answers or whole settings JSON. Use bounded opaque stream IDs or
validated codes; do not automatically transmit readable filenames in markers.

Distinguish requested transition, media lifecycle observation and qualified
visible onset in the contract. Planned elapsed time is an estimate, never an
actual timestamp. At an immediate video→ISI transition, stop and start remain
distinct ordered events even if the measured boundary timestamp is equal. Stream
records must include enough bounded identity/mapping metadata to reconstruct
video/ISI occurrences without the source spreadsheet or local event log; a hash
of a missing external dictionary is insufficient. Specify how missing/out-of-
sequence events and unclosed intervals are reported, never fabricated.

P3's deliverable is a versioned event specification plus synthetic reconstruction
fixtures. Runner owns clock capture, LSL emission, stream metadata and recording.
Actual recorded-stream-only evidence remains R1-06. Existing event-type-only
markers are insufficient; do not change the frozen v1 stream in this pass.

## P4 design: Screen & Layout

The editor contains a **screen profile**, **video reference/fitting controls**,
**Flubber size/centre offsets**, and a miniature of the entire screen. Display
the reference frame, actual selected video's bounds, both centres and maximum
animated Flubber bounds. A video selector previews every library item; a fit
summary reports any video that clips or overlaps. Controls have numeric and
keyboard alternatives; dragging is optional, never the sole editing method.

Proposed initial fields:

| Group | User enters or reviews | Saved interpretation |
| --- | --- | --- |
| Screen | Intended aspect/viewport; relative or physical units; measured width/height when known | An explicit screen profile and compatibility/calibration requirements |
| Reference frame | Proposed reference video; frame size and centre within the screen | One fixed video fitting/reference rectangle shared by all videos |
| Video fitting | Review full-video fit and letterboxing | Proposed `contain`, preserving display aspect with no crop/stretch |
| Flubber | Diameter/footprint, horizontal and vertical centre offsets, minimum separation | P4-owned geometry using explicit units and a stable design centre |
| Fit review | Selected video and worst-case list | Derived preview/error state, not a second saved position per video |

Minimum separation is a validation constraint, not an alternative placement
authority. Centre offsets alone determine the Flubber's placement relative to video.

**Reference proposal under Q08:** suggest the largest oriented display-area video
as the initial reference aspect, with a deterministic tie-break and a visible
researcher override. Fit that reference into an explicitly chosen screen region
and save the resulting rectangle. Every other video is contained in this same
rectangle, centred at the same video centre. The reference is fixed until an
explicit user edit; rescanning the library cannot silently change it. A newly
larger video triggers review, not automatic repositioning. Validate all video
ratios and the Flubber envelope; largest pixel area alone is not a fit guarantee.

Let the fixed reference dimensions be `Rw × Rh`, its centre `Cv`, and a video's
oriented display dimensions `Wi × Hi`. Proposed full-video fitting uses
`s = min(Rw / Wi, Rh / Hi)` and displayed dimensions `(s Wi, s Hi)`.
The accepted placement rule is `Cf = Cv + (dx, dy)`. Proposed axes are right +x,
down +y; positive vertical offset therefore puts Flubber below the video.
Use a stable Flubber design centre, not the changing outline's instantaneous
centroid. P5 supplies maximum extents including any approved halo/motion.
That bound covers all allowed input values and animation states for the saved
configuration; a sampled preview frame is insufficient.

In relative mode, `dx = offsetXPercent × Rw / 100` and
`dy = offsetYPercent × Rh / 100`. A proposed circular Flubber diameter uses
one explicit scalar basis, `min(Rw, Rh)`, so resizing cannot stretch the shape.
Never change that percentage basis to an individual video's dimensions. The
screen-relative reference rectangle and reference-relative Flubber geometry
must have separately named units to avoid confusing the two percentage scales.

In physical mode store millimetres. Conversion requires the intended active
display area's physical dimensions and a known mapping to the rendering
viewport; pixel resolution or browser CSS pixels alone do not supply that
measurement. A laptop's advertised diagonal is insufficient without aspect and
active-area assumptions. Without calibration, relative mode still works;
physical conversion remains unavailable with a specific missing-field message.
When measurements exist, switching units preserves resolved geometry. Export
declares what a future Runner must verify if the actual screen differs.
The recipe stores intended geometry and calibration requirements. Actual monitor
selection, viewport/DPI observations and runtime calibration belong to the later
Runner's attempt receipt, not portable screen handles saved by the Planner.

**Concrete geometry fixture proposal:** screen 1920×1080; reference 1280×720
centred at (960,400); Flubber diameter 180 with centre offset (0,500). Flubber
centre is (960,900). A 1920×1080 video displays at 1280×720; a 1080×1920 video
displays at 405×720. Both share the same video and Flubber centres. A 10% x offset
is 128 in both cases, never 40.5 for the portrait video. Video bottom is 760;
Flubber top is 810, leaving 50 units of separation, before any extra envelope.
These are test values, not suggested study defaults.

Proposed fit checks: complete video fits its frame; reference fits the screen;
the maximum animated Flubber envelope fits the screen; the requested gap and
non-overlap hold for every video; all sizes are positive/finite; units and
aspect/calibration requirements are consistent. An impossible layout blocks
acceptance and identifies the constraint. Do not solve it through hidden
per-video shifts, resizing, clipping or changed centre offsets. Whether explicit
overlap is ever allowed requires an explicit researcher change to the retained
non-overlap requirement; this design does not relax it.

## P5 design: Flubber & Controls

Place the persistent preview beside three groups: Appearance, Controls, and an
Advanced disclosure at the bottom. Appearance contains the already saved renderer
choices, colors and mappings; Controls contains device/bindings and supported
response behavior; Advanced contains approved animation amplitude/sinusoid and
speed parameters with explicit units/ranges. Preserve existing saved Grid/Flubber
semantics even if the first new design focus is classic Flubber.

Before moving controls, produce an inventory for each control: existing saved
field, currently preview-only, proposed successor field, or explicitly deferred.
Ask Q10 for unapproved extras such as Face, tile painting, halo or hold behavior.
Never encode them into unrelated v1 fields. The temporary preview point,
simulated input, preview camera/pan and test animation playback are not recorded
participant responses or hidden experiment settings.

Size/placement fields shown beside this preview edit P4/P6's owned geometry;
there is no second `overlayPosition` competing with the centre-offset model.
P5 exposes a deterministic maximum animation envelope for P4/P6 validation.
Its bound covers the full supported input/animation range and any approved halo,
not only the present preview state. P4/P6 consume this interface without copying
animation policy into their geometry logic.
Animation speed and acquisition sampling frequency remain different settings.
Consolidation removes standalone old Input/Visual/Advanced presentation only
after each retained control has a destination and a working saved contract.

## P6 design: Optional XR Spatial Layout

Expose an optional spatial profile inside Setup. A desktop recipe can finish
without it. Enabling it reveals **setup alignment**, **video plane**, **Flubber
relationship**, and an orbitable 3D preview with forward axes, screen plane and
size/angle annotations. Include front/side/top views and numeric rotation controls
for keyboard and reduced-motion use. Preview orbit changes the inspection camera,
not the saved participant/setup pose or content transform.

Required inputs: distance from the setup eye reference, horizontal/vertical
direction to the video centre (azimuth/elevation), video angular or physical size,
plane yaw/pitch/roll, and Flubber centre offsets/size. P1 supplies aspect ratios;
P5 supplies appearance/envelope. P6 owns spatial placement; P4's desktop offsets
are not silently copied into metres or angles. The same geometric-centre
relationship is reused, with explicitly declared spatial units and axes.

Confirmed behavior: content is **world-fixed, aligned to forward at setup**.
Proposed Q11 interpretation is head-forward plus a stable up direction, not
eye tracking. Define one setup coordinate frame and world anchor when setup is
accepted. Subsequent head movement changes the view of that fixed content;
it must not cause the content transform to follow the head. A later deliberate
recenter is a new explicit alignment action with downstream event semantics.

Proposed spatial model: metres, +x right, +y up, forward along -z. Azimuth is
positive to the right, elevation positive upward. At azimuth a, elevation e and
distance d, the video centre in the setup frame is
`(d cos(e) sin(a), d sin(e), -d cos(e) cos(a))`.
Angles are converted to radians for calculations. With plane rotation R,
`Cf_setup = Cv_setup + R × (dx, dy, dz)`; initial proposed Flubber depth offset
is zero, so the two elements share a plane. The later Runner captures
`worldFromSetup` once, then applies
`worldFlubber = worldFromSetup × setupFromVideo × videoLocalFlubber`.
The recipe declares the alignment rule; it does not save today's observed
headset pose as portable authority. Here negative local y places Flubber
below video; do not copy desktop's down-positive sign without conversion.

Proposed initial size rule: one fixed reference plane/rectangle, containing every
video without changing its aspect or centre. At zero tilt, centre directly
forward and perpendicular distance d, angular width t implies
`width = 2 d tan(t / 2)`. For an offset or tilted plane, compute apparent angular
extent from its actual transformed geometry; the centred formula is not generally
valid. Proposed first implementation permits angular-size editing only for the
centred, facing plane. Elsewhere edit metres and show explicitly named derived
angles: horizontal/vertical spans between the minimum and maximum setup-frame
azimuth/elevation over the transformed corner rays, plus centre eccentricity.
These spans are not relabelled as plane-local angular dimensions. Reject geometry
crossing the defined forward-domain bounds. General tilted-plane angular editing
needs an explicit inverse definition and fixtures in a later allocated slice.
Save one authoritative size representation and derive
the alternative readout. Do not store contradictory width, distance and angle
as three independently editable authorities. Flubber centre eccentricity and
video angular width are distinct measurements.

Validation: finite positive distance/size; explicit bounded angles and rotation
convention; all required geometry visible in front of the setup viewer; no
invalid/degenerate transforms; footprint/overlap constraints; and a reproducible
setup alignment. Recenter/tracking-loss policy, allowed size/angle ranges and
forward head pose versus measured gaze remain open under Q11. Do not infer a
headset field of view or an eye-tracking capability from an authoring preview.
Initial angles refer to the setup viewpoint. World-fixed content will have
different apparent angles when the participant later turns or moves their head.

**Acceptance fixture proposals:** at d=2m, zero azimuth/elevation/rotation, centre
is (0,0,-2). A 30-degree angular width corresponds to about 1.071797m for the
centred facing plane. A local Flubber offset (0,-0.3,0) yields (0,-0.3,-2).
Rotating the inspection camera does not change these recipe values. Simulated
head rotation after setup changes the view transform only; explicit realignment
changes the anchor. Mixed-aspect videos share the saved reference/centre model.

P7 must distinguish desktop-only, XR-required, or explicitly selected multiple
presentation profiles through an agreed target contract (Q15). A flat monoscopic
video plane is the proposed first spatial scope; stereo/360 media is not inferred.
Whether free plane tilt and depth offsets are exposed initially remains a profile
decision; a rotatable inspection preview alone does not require those controls.
No automatic fallback
from an XR-only design to desktop. Unrecognized required spatial capability
blocks execution in a future consumer. This design introduces no APK, WebXR
service, headset access, LSL recording, new sensor data or Playground restoration.

## P7 design: Review, Save & Export

Use one review screen listing each segment's accepted revision and actionable
errors with links to the responsible editor. Show video/variant/language counts,
fixed-duration timeline estimates and response-dependent intervals, screen/XR
profile summary, and declared Runner requirements. This is also the proposed
home for retained acquisition/output settings under Q12. Values previously in
the redundant Experiment section must be rehomed before that section disappears.

Provide Save draft, Export finished recipe and Open recipe with distinct truthful
states. A finished export requires complete accepted contributions for its
selected target, no pending edits, resolved references and successful validation.
An unfinished optional XR draft need not block a desktop-only recipe if the
researcher explicitly excludes that profile. Never export it silently as active.

On Open, verify schema/integrity and reconstruct every owned editor contribution
from the JSON; ask the owning storage adapter to bind media separately. Editing
does not mutate the old exported bytes. Report unsupported controls/capabilities
and incomplete legacy migration rather than discarding them or substituting
application defaults. Keep full-video playback policy unless explicitly changed.

Final acceptance includes creating a study without imported master JSON, saving
it, reopening in clean independent instances, resolving the same variants and
languages, and byte-identically re-exporting an unchanged canonical recipe.
Changed content must change the appropriate identity/hash and invalidate stale
derived output. A valid Planner recipe may still require an unimplemented or
unqualified Runner; the UI must state that compatibility separately from design
validity and save success.

## Decisions and gaps that still need researcher input

The catalogue's Q01–Q15 register owns accepted answers. The following groups open
questions by the work they affect; they do not reopen named-only ISIs, column
orientation, fixed-reference percentages, world-fixed XR or Runner recording
ownership, all of which are already confirmed.

| Decision | Proposed way forward | Blocks only |
| --- | --- | --- |
| Q04/Q05: video naming/relocation | Stable identity plus reviewed folder_filename annotation; portable logical workspace binding | Final P1 identity/migration contract |
| Q02/Q14: sequence and dictionary edge cases | Explicit sequences, visible errors, stable ISI IDs; no automatic merging, renumbering or repair | P3 edge-case behavior, not the basic editor design |
| Q06: allocation ownership answered | Latest answer leaves allocation policy to Runner; Planner exports ordered variants without participant allocation | Runner selection/retry/skip work is deferred; not a Planner blocker |
| Q08: exact screen reference/calibration | Shared saved reference rectangle, contain fit, design centre, explicit physical calibration | Final P4 geometry contract |
| Q09: questionnaire placement/scoring | Preserve existing hooks and codes; implement additional requested placement and scoring explicitly | New placement/scoring features, not editable content/reopen fixes |
| Q10: saved preview controls | Inventory existing saved values first; add only specifically approved extras | New persistent feedback behavior, not control consolidation design |
| Q11: forward/recenter/tracking | Head-forward setup frame proposed; world-fixed anchor retained | Optional P6 final contract and later Runner behavior |
| Q12/Q13: retained settings and drafts | P1 identity, P7 any required count metadata/acquisition/output; accepted recipes separate from drafts | Final navigation/save semantics |
| Q15: spatial profile scope/selection | Flat monoscopic plane first; explicit desktop/XR profile requirements with no silent fallback | Optional P6 and P7's spatial-target contract |

Questions about questionnaire timings/scoring and which preview extras should be
saved were requested during this pass. Until answered, those rows remain open.
An agent must not demand answers to every row before doing independent work.

## Integration, verification and handoff

Before collection, inspect pending S2 `59d15d9`, S3 `01444a7`, preview `7c90894`
and pane-resize `20644e2` at their actual current heads. S3's authoring files are
not the master recipe; its ID scheme and dictionary contract need reconciliation.
S2's content/table work does not by itself close full-recipe reopening. Preview
changes do not prove saved behavior; a draggable Setup pane is not a screen-layout
model. Keep compatible work instead of rebuilding those features in parallel.

The pending S3 JS and Rust resolvers both accept raw numeric intervals, fold
them into the preceding video's `isiAfterMs`, default omitted gaps to zero, and
reject leading/consecutive intervals and repeated videos. Those are predecessor
rules, not accepted answers to Q02/Q14. Adapt both owners and their fixtures
together. Reuse column orientation, bounded atomic paste, receipts/invalidation
and library export infrastructure. Shared questionnaire/table-parser changes
must retain each editor's separate bounds at integration.

Each owner names exact paths/symbols and checklist IDs, records dependency changes
in [55-AGENT-MESSAGE-BOARD.md](55-AGENT-MESSAGE-BOARD.md), works in its isolated
branch/worktree, and hands off source/check receipts. Serialize shared changes
to composition/UI/bridge seams. Allocate integration separately; this plan is not
permission for one segment agent to implement missing neighbors opportunistically.

Proportional checks accompany the actual change: pure contract/geometry fixtures,
editor/persistence regressions, cross-language/variant reproduction, then
applicable background build/accessibility checks at integration. Native/browser
UI or device interaction needs the workflow's explicit opt-in. This document's
mathematical examples and synthetic trace requirements are designs for evidence,
not evidence of qualified playback or timing.

The desktop Planner milestone closes P1–P5 and applicable P7 items for one complete
recipe. The optional spatial authoring milestone additionally closes P6's
authoring items and P7's spatial round trip. Deferred P6-06 and R1 hardware,
execution and recording work retain their own qualification gates. Completion
status stays in the central catalogue; record what actually passed in the
evidence ledger, with exact source and integration state.

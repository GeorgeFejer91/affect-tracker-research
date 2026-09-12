# Complete Planner feedback settings

P5 owns `affect-research-feedback`, version **2**. P7 embeds this complete object
as `segments.P5` in the successor master recipe. This is a Planner authoring
contract, not an implemented or qualified Runner adapter. The 2026-09-12 Planner
completion allocation promotes the currently visible configured feedback choices.
The renderer identities are `flubber`, `grid`, and `procedural-face`; the last
identifies only this project's existing procedural SVG. No historical Face,
Photoatlas, camera, participant-image or inference feature is restored.

## Ownership and fields

Every field below is required, including the inactive alternative settings that
must survive selecting another renderer or response mode. Unknown fields reject.
Neither parser supplies missing defaults, clamps a value, or drops unsupported
successor fields into a legacy document.

| Current controls | Saved field | Units and allowed values |
| --- | --- | --- |
| Input device and four direction/axis bindings | `input` | Exact existing `InputBindingV1`; all nine presets and custom bindings retain their original tokens, uniqueness and N/A validation |
| Flubber / 2D Grid / Face buttons | `presentation.renderer` | `flubber`, `grid`, `procedural-face`; sole current output selection |
| Hide Visual Feedback | `visual.hideFeedback` | Boolean; suppresses all selected feedback paint |
| Transparency | `visual.transparency` | Fraction 0–1; editor displays percent |
| Show outline / outline thickness | `visual.flubber.showOutline`, `.outlineThickness` | Boolean; 0–20 CSS px, non-scaling stroke |
| Show Halo | `visual.flubber.showHalo` | Boolean |
| Halo width | `presentation.halo.widthPercent` | Finite 0–10,000%; multiplier of `max(1, 3 × outlineThickness)` CSS px. Zero hides the halo. Invalid values block capture rather than silently clamping |
| Fade halo outward / steepness | `presentation.halo.gradient`, `.steepness` | Boolean; finite gamma exponent 0.1–10. Width is independent of falloff |
| Grid line / outline / cursor | `visual.grid` | Line 0.25–20 CSS px; outline Boolean and 0–20 CSS px; cursor radius 2–100 units of the 100-unit grid viewBox. Stepwise output uses the active tile instead of a cursor |
| Four anchor colors; idle / outline / halo / cursor colors | `visual.colors` | Eight literal six-digit hex colors, normalized to lowercase by the retained reader |
| Axes / Corners | `presentation.colorAnchors` | `axes` or `corners`. Corners map up→upper-left, right→upper-right, down→lower-right, left→lower-left |
| Applied custom labels in each placement | `presentation.labels.axes`, `.corners` | Each has exactly up/right/down/left; 1–48 UTF-16 units of well-formed display text, no control characters or surrounding whitespace. Labels never rename valence/arousal coordinates |
| Continuous / Stepwise | `response.mode` | `continuous` or `stepwise` |
| Square steps or custom columns/rows | `response.grid.columns`, `.rows` | Odd integers 3–2001. Square n steps each side materializes 2n+1 columns and rows. Only effective dimensions are saved; inactive alternate input text is not configuration |
| Full-span duration | `response.fullSpanDurationMs` | Whole milliseconds 250–15,000 |
| Separate presses / repeat while held | `response.holdRule` | `separatePresses` or `repeatWhileHeld` |
| Repeat interval | `response.repeatDelayMs` | Whole milliseconds 500–5,000; interval after the initial press and between repeats |
| Six Advanced affect mappings | `mappings` | Exact existing six `FlubberMappingV1` objects; frequency 0–10 Hz, other outputs 0–1; x-axis/y-axis/angle/radius and reverse retain existing meanings |
| Legacy step, Grid/Flubber visibility and normalized layout | `input.stepSize`, `visual.gridEnabled`, `.flubberEnabled`, `.sizePercent`, `.overlayPosition`, `.lockPosition` | Preserved compatibility values, visibly inactive in V2. They are not additional response, renderer, scale or placement authorities |

P7 owns sample frequency, outputs and LSL configuration. They are not duplicated
in P5. P4 or P6 owns current viewport size, physical units and placement. The
P5 inspection stage remains centered, locked and at a fixed display scale; this
framing is not exported as experiment geometry.

## Response interpretation

The successor response describes configured behavior independently of physical
input acquisition. Digital directions in stepwise mode move by
`2 / (columns - 1)` horizontally and `2 / (rows - 1)` vertically, with neutral
at the central tile and endpoints at −1/+1. Separate presses move once per
edge; repeat mode moves immediately and then at the explicit repeat interval.
Operating-system key repeat is ignored. Opposing held directions cancel.
Continuous held directions travel at `2 / fullSpanDurationMs` per millisecond,
clamped to the same coordinate bounds. A wheel notch is a discrete directional
pulse, including in continuous inspection, and uses the configured grid step.
Absolute/analog input supplies a position through its existing input adapter;
stepwise mode snaps it to the authored grid. It does not acquire a new velocity
meaning from the continuous duration. These are downstream requirements; no
native sampling, input mailbox, scheduler or recording path changes here.

Current x/y, held controls, test receipts, captured-but-unapplied bindings,
animation phase, clocks, dialog drafts, focus, disclosure, scroll and pane size
are transient. Recolor and the existing grey Reset action change literal saved
colors; only those resulting colors persist, never the RNG state or action.
Square-versus-custom editing presentation is reconstructed from effective grid
dimensions, and choosing it without changing dimensions does not alter the recipe.

## Interfaces and restoration

`site/src/research/feedback-settings.js` exports:

- `validateFeedbackContributionV2(value)` → detached recursively frozen V2.
- `validateFeedbackContribution(value)` → strict generation dispatch.
- `createFeedbackAuthoringSettingsV2(legacy)` → explicit new-authoring initializer.

The exact old `{input, visual, mappings}` validator remains exported as
`validateFeedbackContributionV1` from `feedback-contribution.js`. It never accepts
V2 or adds missing V2 fields. New authoring explicitly starts with Flubber,
axes/default labels, 150% fading halo/exponent 1, 21×21 stepwise response,
2000 ms full span, separate presses and 500 ms repeat interval.

The existing controller API is retained:

- `getFeedbackContributionSnapshot()` returns revision/enabled/pending/contribution/
  dependencyRevisions; P5 has no dependencies. Saved changes advance the revision;
  invalid controls withdraw the contribution immediately. There is no last-valid
  export and no independent P5 confirmation. P7 owns final capture and acceptance.
- `subscribeFeedbackChanges(listener)` returns cleanup and reports complete frozen
  snapshots. Reading during notification is safe.
- `getFeedbackLayoutSnapshot(explicitViewportCssPx)` binds the same revision to
  the complete owned envelope, or null while settings are invalid.
- `restoreFeedbackContribution(value,{isCurrent})` validates all fields before
  any mutation, then writes every field before notification. Stale or disposed
  requests return false. Success returns the current snapshot and clears Preview
  holds/position/capture/unapplied dialogs using the Preview-owned reset helper.
- `initializeFeedbackAuthoringV2({isCurrent})` is explicit conversion for a legacy
  authoring session, also exposed by **Use current feedback settings**. It
  materializes and announces the new starting settings for review.

Legacy restore leaves the contribution at V1 and disables unavailable V2 choices;
it does not invent an effective successor configuration at parse/load time.
V2 restore has no defaults. Range widgets preserve valid imported precision, and
the fraction-to-percent display conversion does not change canonical transparency.
The frozen legacy settings/package writer and Start path reject active V2 settings
instead of silently discarding them. P7's new master writer consumes the full P5
getter and owns named-file acknowledgement, editable reopen and integrity.

## Complete bounds and native mirror

`feedback-layout.js` exports `resolveFeedbackEnvelope(value, explicitCssPx)` and
`resolveFeedbackEnvelopeV2`. The V2 result retains `origin: "design-centre"`,
`overlaySideCssPx`, `halfExtentCssPx` and `configurationKey`, with the explicit
algorithm `feedback-envelope-v2` and nullable Flubber/Grid/Face component bounds.
P4/P6 pass the entire saved contribution. A caller-provided footprint is never
accepted. Existing `feedback-envelope-v1` remains unchanged.

The Flubber bound reuses the proven all-phase/all-mapping path maximum. It adds
the full width-dependent non-scaling halo/outline miter allowance. With gradient
enabled, it also covers the exact finite SVG filter region (three times the
geometric half extent); no Gaussian-tail threshold is called a maximum. Grid
includes edge cursors, or contained active tiles plus CSS-pixel line/outline
padding. Procedural Face includes every feature and scaled stroke within its
200-unit viewBox. Hidden feedback contributes zero paint. These conservative
bounds can reject a tight layout; they never infer physical calibration or use
the current animation phase as the maximum.

Rust `research_feedback::FeedbackContributionV2` provides `normalize_and_validate`
and canonical `validate`; `resolve_feedback_envelope_v2` mirrors the full JS bound
and configuration key. It reuses existing component validators, with only crate-
local visibility expanded for Visual/Mapping validation. P7 owns root JSON parsing,
duplicate-key/size limits, integrity and storage; P5 adds no IPC or unsafe boundary.

Shared configuration fixture: `test/fixtures/research-feedback-settings-v2.json`.
Thirteen shared envelope cases are in `research-feedback-envelope-v2.json`.
Software conformance and Planner restore evidence are recorded in the P5 roadmap
receipt. Runner correspondence/execution and installed/physical qualification are
explicitly a later development stage, not this Planner completion gate.

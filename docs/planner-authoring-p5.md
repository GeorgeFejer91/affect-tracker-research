# P5 command adapter

CLI-P5, Backend Verification, base `460f516`. This is an adapter over the completed
Planner feedback editor. It adds no recipe schema, draft store, input acquisition,
acceptance, file writer or Runner behavior. P7 still owns acceptance and export.

`createPlannerAuthoringP5({ readDraft, readDigitalStep, prepareCommit })` from
`site/src/research/planner-authoring-p5.js` returns the frozen shared owner
interface: `id`, `settings`, `operations`, `read`, `stage`, `validate`.
The exported `P5_AUTHORING_SETTINGS` is the closed catalogue; its product IDs
are not an arbitrary JSON-pointer or DOM-selection interface.

## Required integration hooks

Main owns the following three hooks inside the existing `app.js` P5 closure.
Do not substitute the strict contribution getter or asynchronous public restore.

```js
const p5 = createPlannerAuthoringP5({
  readDraft() {
    // Detached complete V2-shaped raw owner draft, or exact legacy triple.
    // Use current controls/models, including invalid numeric text as strings.
  },
  readDigitalStep() {
    // Pure current #input-step-size value under resetBindingsToPreset semantics.
    // Retained while analog input makes the saved step null. No adapter default.
  },
  async prepareCommit(draft, { contribution, issues, isCurrent, signal }) {
    // Prelocate all controls and check owner lifetime, with no mutation.
    // contribution: canonical existing P5 contract, or null for invalid draft.
    // draft: deeply frozen complete candidate; no defaults or missing fields.
    return {
      isCurrent() { /* optional pure owner-lifetime/dependency guard */ },
      commit() {
        // Synchronous, prevalidated, nonthrowing projection of all draft fields.
        // No native work, synthetic input/change, acceptance, reset or refresh.
      },
      afterCommit() {
        // Optional synchronous notifications/render, after ALL owners commit.
      },
    };
  },
});
```

`readDraft` must not call `feedbackFromUi`, `legacyFeedbackFromUi`,
`mappingsFromUi`, `synchronizedInputBinding`, or the contribution source: those
validate, mutate or publish rather than provide a pure raw snapshot. Read every
saved field in both active and inactive alternatives. Numeric controls supply a
finite number for valid numeric text, otherwise the exact raw string; never
NaN, a fallback default or a previous valid value. Use recipe units, including
fractional transparency rather than its percent display. Preserve the existing
`restoredTransparency` precision rule. The input preset UI value must agree
with the raw binding; expose a mismatched/invalid preset in that draft so its
validation issue cannot be hidden by the last valid binding.

`readDigitalStep()` returns the existing editor-owned numeric value that
`resetBindingsToPreset()` would use for a digital preset. It is still available
in the disabled field while the selected analog binding has `stepSize: null`.
Use that existing operation's normalization, not a new CLI default. The adapter
checks it is finite and 0.001–1 when selecting digital input, binds it in the
staged freshness guard, and never stores it separately. Preset transitions
therefore preserve the UI's historical value. On nondigital projection leave
the disabled numeric field intact rather than replacing it with null.

Do not copy excluded inspection/capture/dialog fields into the draft. For
legacy generation return exactly `{ input, visual, mappings }`; V2-only
catalogue fields then read as null, with no implicit conversion. This CLI edits
V2 only; legacy read and explicit initialization are supported, but there is no
separate legacy editing mode. Legacy active-field edits reject before conversion.

`prepareCommit` receives a detached candidate after the entire ordered edit
list. Valid candidates use the unchanged owner validator's canonicalization.
Syntactically typed but incomplete combinations, such as an even grid or
minimum greater than maximum, retain their exact raw values with issues and
`contribution: null`. Existing invalid text in other fields survives an edit.
Preflight every reference and any failure condition now. Do not call
`applyFeedbackFields` as an atomic commit without separating its callbacks,
input-test reset, simulator configuration and publication effects. Never send
an invalid binding to `inputController.setBinding`.

The session calls every staged `isCurrent()` before any commit. P5's guard
includes the original raw-draft fingerprint, caller cancellation/lifetime and
the optional prepared owner guard. The session then owns the publication lock,
file invalidation and revision. Commit projects values only, with no await or
new validation. The optional prepared `afterCommit` is forwarded as a one-use
post-publication hook; the session runs it only after all owners have committed.
Its errors are applied/incomplete, never rejected-as-no-change. Input
controller/simulator updates must use valid values and preserve pending state.
All saved values must be installed before callbacks observe them. No transient
reset, grey-palette Reset, RNG action or color-dialog interaction is an edit.

## Exact field to current owner mapping

These are integration notes for the fixed P5 owner, not public selectors.
The external IDs are `P5.` followed by the saved field in the first column.

| Saved field | Existing control / model | Projection and raw-read notes |
| --- | --- | --- |
| Schema/version | `feedbackSettingsVersion` | V2 schema/version constants; legacy triple remains generation 1. Catalogue generation/contribution are read-only |
| `input` | `inputBinding`; `#input-preset`; `#input-step-size` for digital input | Clone the complete typed binding; map preset via `UI_PRESET_IDS`; step is null for absolute/analog and read-only compatibility in V2. Whole-binding edits cannot change that step |
| `visual.gridEnabled`, `.flubberEnabled` | `#visual-grid-visible`, `#visual-flubber-visible` | Boolean; retained inactive V2 compatibility values |
| `visual.sizePercent` | `#visual-size` | Legacy percentage; do not change V2's fixed inspection scale |
| `visual.overlayPosition.x`, `.y`, `.lockPosition` | `#visual-position-x`, `#visual-position-y`, `#visual-lock-position` | Legacy values; P4/P6 retain current experiment placement authority |
| `visual.transparency` | `#visual-transparency`; `restoredTransparency` | Canonical fraction = UI percent / 100. If raw display matches restored cache, keep its exact canonical value; update cache on valid projection |
| `visual.hideFeedback` | `#visual-hide-feedback` | Boolean |
| `visual.flubber.showOutline`, `.outlineThickness`, `.showHalo` | `#flubber-outline-visible`, `#flubber-outline-thickness`, `#flubber-halo-visible` | Boolean / CSS px / Boolean |
| `visual.grid.lineThickness`, `.showOutline`, `.outlineThickness`, `.cursorSize` | `#grid-line-thickness`, `#grid-outline-visible`, `#grid-outline-thickness`, `#grid-cursor-size` | CSS px / Boolean / CSS px / viewBox radius |
| `visual.colors.{up,down,left,right,idle,outline,halo,cursor}` | `#color-{name}-hex` and `#color-{name}` | Read current hex text; valid values canonicalize lowercase. Do not replace invalid raw text with the color widget's fallback |
| `presentation.renderer` | `feedbackPreviewMode` | Saved `procedural-face` maps to existing internal `face`; `flubber` and `grid` map directly |
| `presentation.colorAnchors` | checked `input[name="previewColorAnchors"]` | Exact `axes` or `corners`; unavailable selection must remain invalid |
| `presentation.labels.axes`, `.corners` | `previewAxisLabels`, `previewCornerLabels` | Replace both maps from complete saved label sets; never take unapplied `#preview-color-label` text |
| `presentation.halo.widthPercent` | `#preview-halo-size`; `previewHaloDraft.width` | Read actual input, not the last-valid preview cache. Update valid preview cache only after all-owner publication |
| `presentation.halo.gradient` | `#preview-halo-gradient` | Boolean |
| `presentation.halo.steepness` | `#preview-halo-steepness`; `previewHaloDraft.steepness` | Read actual input; same invalid/cache rule as width |
| `response.mode` | `responsePreviewMode` | `continuous` / `stepwise` |
| `response.grid.columns`, `.rows` | `previewGridSizing`; `#preview-tile-count`, `#preview-tile-columns`, `#preview-tile-rows` | Square mode derives each dimension as `2 * steps + 1` if numeric; invalid text stays raw. Custom mode reads both independently. On command projection use custom mode for invalid/even or unequal dimensions; valid equal odd dimensions may reconstruct square mode. Never hide even/invalid values through the square editor |
| `response.fullSpanDurationMs` | `#preview-full-span-duration` | Whole ms; set range step 1, preserving imported precision rules |
| `response.holdRule` | checked `input[name="previewHoldRule"]` | `separatePresses` / `repeatWhileHeld` |
| `response.repeatDelayMs` | `#preview-repeat-delay` | Whole ms; interval after initial edge and between repeats; range step 1 |
| `mappings.{mappingId}.{min,max,drivenBy,reverse}` | `MAPPING_FIELDS`; `[data-mapping="{spec.id}"]` and `[data-mapping-min/max/driver/reverse]` | Contract ID is camelCase; existing `spec.id` is kebab-case. Min/max raw values also have `#mapping-{spec.id}-min/max`. Do not validate through `mappingsFromUi` while reading incomplete values |

Mapping IDs: `oscillationFrequency`, `edgeSmoothness`, `projectionAmplitude`,
`pulseSynchrony`, `waveSizeVariation`, `saturation`. Units/ranges come from the
existing `FLUBBER_MAPPING_SPECS`; reversal and drivers retain their meanings.

## Operations and validation

`inputPreset` takes exactly **`{ preset }`**. All nine existing presets
are supported, matching the
existing preset picker. Digital step comes from `readDigitalStep`, never command
arguments; other kinds retain the contract's null. Extra `stepSize` rejects.
It calls the existing input owner initializer, not live device capture.
`initializeV2` takes exactly `{}` and is available only on a valid legacy draft.
It explicitly materializes the existing documented authoring defaults; later
edits in the same batch can replace them. Already-V2 initialization rejects.

Whole `P5.input` edits use exact InputBindingV1 validation and cannot bypass
the read-only digital step. The seven inactive compatibility entries (step,
legacy visibility, scale, centre and lock) are **read-only**, matching disabled
V2 UI. They remain readable and survive unchanged open/export; this follows the
Chat Orchestrator's explicit parity decision. It does not add another geometry
or response editor. All active saved alternatives remain writable. Other saved
leaf fields have typed closed descriptors. Malformed/type/range/enum/color/label
edits reject before preparation; cross-field incomplete combinations may commit
with issues. Readback never truncates accepted labels or invents a contribution.

Tests cover every registered writable entry, ordered batches, both label sets,
inactive renderer/grid/halo/response alternatives, all presets/custom tokens,
canonical bytes/envelope reuse, explicit legacy conversion, invalid raw reads,
stale/canceled/dependency-drift staging and one-use synchronous projection. These
are owner/software checks; real shared editor/native CLI/file verification remains
integration-owned. The new goal69 explicitly allocates actual Runner correspondence
to the Runner owner; those checks are now required for that wider goal. They are
not claimed by this adapter's software tests. No changed DOM/layout or native
implementation is claimed here.

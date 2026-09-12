# P4 rendered UI and typed command correspondence

The E2E-UI/P4 follow-up adds actual rendered browser evidence to the
[owner adapter mapping](planner-authoring-p4.md). It changes no application,
adapter, stylesheet, native service or saved schema. This rerun uses the frozen
combined source at `79e073bdcfc0b1e93ab0b7ed5d975e4a58bf95b5`
`(D:\GitHub\affect-tracker-research-planner-cli)` on
`codex/segment-planner-cli-shared` with
`--require-integrated`.

## Observed checks

The full `bootResearchUi()` Planner renders with explicit
`data-research-program="planner"` in an isolated headless browser.
The fixture supplies the existing synthetic catalogue at the explicit P1 event
boundary, then uses actual P1/P5 owners and the production P4 controller. These
media declarations are fixture data, never actual import or decoder attestations.

Every one of the 15 writable fields is labelled, focused and reached inside the
visible scrolling pane, changed using its browser input/change event, and read
back through the actual controller. The real Confirm section button prepares and
accepts the UI-authored profile. The typed P4 adapter then receives the same edits;
every intermediate normalized draft and geometry/source projection must match.
Each setting's declared JSON path is checked against the accepted UI profile.
The existing strict P4 serializer/parser produces byte-identical UI/CLI profile
exports. These files contain only P4; they are not complete master recipes.

Both reference methods, mm/relative conversion, ordered offset → conversion →
offset, calibration clearing and its null saved representation are covered.
Additional checks cover invalid visible input, mixed read-only batch rejection,
stale revision rejection, transient video inspection with exact rendered bounds,
P1 revision invalidation/revalidation, missing catalogue geometry, and P5 pending
bounds/recovery. No last-valid reference or accepted contribution fills a gap.

Each browser passes **816 checks in six scenes**, with 17 field/operation
correspondence rows per scene. The app viewports are 1440 × 900 and 820 × 900;
measured P4 panes are 880 and 417 CSS px. Overview, calibration and placement
captures together show all writable controls. All 12 PNGs were captured with labels,
controls and confirmation footer present; normal vertical scrolling is required.

Local observed browser versions: Chrome `152.0.7977.83`, Edge `153.0.4234.32`.
Both clean-source integrated receipts and their emitted profile files are under:

- `D:/GitHub/.affect-preview-checks/p4-rendered-cli-20260912/final-planner-chrome-integrated/`
- `D:/GitHub/.affect-preview-checks/p4-rendered-cli-20260912/final-planner-edge-integrated/`

Receipts bind exact source commit/status, every served source hash, harness and
fixture hashes, browser binary hash, screenshots, typed command transcript and
actual exported profile bytes. Existing 13 P4 command tests passed before this
artifact-only pass. Syntax and diff checks pass; no broad native build was run.

The earlier `ead567e` 810-check receipts remain preserved, but rendered the shared
Setup surface without declaring the separate Planner role. The integrated receipts
above supersede that framing; the underlying P4 controller was unchanged.

## Reproduce and run against combined registration

```text
node scripts/qualification/screen-layout-cli-parity.mjs <browser.exe> <new-output-dir> [source-root] [--require-integrated]
```

The runner refuses a dirty source checkout by default, requires a new evidence
directory, and rechecks commit, status and served file bytes after execution.
`--allow-dirty` labels development evidence only. Its server stays alive until
both the posted browser receipt and complete PNG arrive, including when Edge's
launcher exits before its isolated headless child. It opens no user window and
uses no existing browser profile, OS input or clipboard.

At this combined source checkpoint the app's registry includes P1–P7. The fixture
uses the **same app's** `plannerAuthoringSession` and existing P4 controller for
both paths with `--require-integrated`. The required combined rerun is complete and
records `integratedSession: true`; no app patches or alternate registration were
installed.

## Remaining actual native CLI comparisons

The renderer invokes the typed JavaScript gateway; native stdin/stdout is not
exercised here. Main/root retain these exact additional P4 comparisons:

1. In the frozen production hidden CLI, import the actual authorized media through
   P1 and use actual P5 settings. Read back all 15 authored P4 fields plus the five
   derived entries and compare them to UI editing with the same real dependencies.
2. Exercise both `P4.reference.method` choices and `P4.units` representations;
   compare `P4.reference.source`, fixed geometry/video fits and normalized values.
   Send `convertUnits` with `{units: "relative"}`/`{units: "mm"}` and
   `clearCalibration` with `{}`; compare the matching UI sequence and P4 bytes.
   Include offset → convert → offset to prove ordered units are retained.
3. Through native transport, reject a valid edit followed by a derived-field
   write (`P4.geometry`) without any mutation, reject stale expected revisions,
   and expose invalid/pending drafts without an accepted fallback. Actual P1/P5
   changes must invalidate P4 preparation until current dependencies are ready.
4. Use the existing production confirmation/master export path and compare the
   actual `segments.P4` payload with the UI-authored profile for the same inputs.
   Preserve source identities, file bytes and the previous timestamped version.
   Full recipe/native reader reproduction and Runner execution remain their
   allocated owners' evidence; fixture profiles cannot substitute for them.

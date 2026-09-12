# P3 typed authoring adapter

CLI-P3 and the allocated P3 portion of E2E-UI extend the delivered Planner.
`createPlannerVariantCommandOwner({editor})` in
`site/src/research/planner-authoring-p3.js` registers P3 with the shared
`createPlannerAuthoringSession`. The existing stimulus-order editor is the sole
draft owner. The adapter neither confirms a contribution nor invokes native
media, import, export or participant-allocation commands.

## Integration and atomicity

Register the adapter with the actual `createStimulusOrderEditor` instance. Its
`stage` applies the entire ordered command list on a detached capture through
the existing P3 structural, naming and clipboard primitives. Incomplete titles,
unknown references and interior blanks remain authored drafts with issues.
Malformed arguments, missing resource IDs, range/size violations and deletion
of a referenced ISI reject the whole batch. There is no silent input repair.

The staged `isCurrent()` binds editor generation, current catalogue operation,
restore operation, busy/disposed state and shared cancellation/revision. The
session checks every candidate before installing any owner state. `commit()`
only installs prevalidated owned state and withdraws prepared output. It has no
DOM, notification, asynchronous or native work. `afterCommit()` calls the
editor's coalesced `publishAuthoringDraft()` after all owners have installed.
This requires main's shared foundation `2310efc` plus `0138516`. The shared
publication lock must suppress duplicate GUI-intent revision increments and
prevent a reentrant Save from observing a partially published batch.

`captureAuthoringDraft()` returns a detached exact raw snapshot with the current
dependency/readiness state. `stageAuthoringDraftRestore(rawDraft,guard)` is an
internal editor recovery seam: it validates structural bounds and preserves
incomplete raw text, padding cells, occurrence IDs and the ISI naming cursor.
It never restores acceptance or media authority. It is not a public CLI setter
and is not a substitute for strict recipe Open. Public commands cannot assign
occurrence IDs, ISI IDs, allocation cursors, version hashes or master identity.

## Public field and operation mapping

All P3 settings are read-only projections; authored resources are edited with
the closed operations below. The catalogue explicitly marks these groups as
authored, derived or compatibility. No arbitrary JSON pointers or DOM selectors
are accepted as commands.

| Readback field | Meaning / saved authority |
| --- | --- |
| `P3.draft` | Exact owner raw draft; includes padding and cursor for honest readback, not public identity editing |
| `P3.isiDefinitions` | Ordered authored dictionary; `segments.P3.isiDefinitions` |
| `P3.variants` | Ordered authored IDs/titles; `segments.P3.variants` |
| `P3.rows` | Ordered authored cell projections `{entryId,variantId,referenceId}`; each variant's `entries` |
| `P3.videoAnnotations` | P1-projected references available to this draft; declaration presence alone is not current-media readiness |
| `P3.contribution` | Current prepared contribution, or null after edits; existing version/hash compiler only |
| `P3.timelines` | Current planned timelines through `compileVariantTimeline`, or null when unavailable; actual times remain Runner-owned |
| `P3.markerContract` | Current contribution's versioned planned-marker contract, or null |
| `P3.legacyConversionRequired` | Compatibility state requiring the existing explicit historical conversion |

Every operation has exact argument keys. `before*` accepts an existing ID or
null to append; no row indexes are accepted by the command interface. Row
operations accept any retained `entryId` in the row and move all cells together
with their occurrence identities. Removing that occurrence's column invalidates
that handle; use another retained occurrence from current readback. Existing IDs
are never renumbered. Added resources use the existing editor allocators.

| Operation and arguments | Actual researcher UI counterpart | Final JSON contribution |
| --- | --- | --- |
| `isi.add {durationMs}` | ISI durations field and Add ISIs; one or comma-separated values | Append named `isiDefinitions` entry |
| `isi.setDuration {isiId,durationMs}` | Named ISI numeric duration field | Edit that definition; recompute affected versions |
| `isi.remove {isiId}` | Remove button beside an unused ISI | Remove definition without renumbering survivors |
| `isi.move {isiId,beforeIsiId}` | Up/down buttons beside the dictionary definition | Preserve IDs/durations while reordering dictionary |
| `variant.add {title,beforeVariantId}` | Add variant, edit name, then move left/right to desired position | Add ordered variant with editor-generated identity |
| `variant.rename {variantId,title}` | Variant column heading input | Edit the named variant's title |
| `variant.remove {variantId}` | Remove button in that heading | Remove that variant and its entries |
| `variant.move {variantId,beforeVariantId}` | Left/right buttons in that heading | Reorder variants with all existing occurrence IDs |
| `row.add {beforeEntryId}` | Add event, then move up/down to desired row | New occurrence per variant; unused trailing padding is omitted on compile |
| `row.remove {entryId}` | Remove button in the event row | Remove that row's occurrences |
| `row.move {entryId,beforeEntryId}` | Up/down buttons in the event row | Reorder entries; preserve occurrence identities |
| `cell.set {entryId,referenceId}` | Type a video annotation/ISI name in that event cell | Change the occurrence's reference; P1 resolves exact content/location pair |
| `table.paste {entryId,text}` | Paste spreadsheet cells at the selected cell | Existing atomic clipboard parsing and generated padding/columns |
| `table.reset {}` | Reset table button | Reset only P3 draft; remains pending until a valid sequence is authored |

Public duration arguments are whole milliseconds from 0 through 3600000.
Duplicate durations, repeated videos and leading/consecutive/final ISIs remain
supported. Each confirmed variant needs a video and rejects interior blanks;
trailing padding may differ across variants. `runnerAssigned` remains the
existing allocation ownership declaration; no participant schedule is created.

Raw invalid GUI duration text is returned as a string with an issue. It never
becomes NaN, a fabricated default or the last valid value. Pending content and
errors remain visible without manufacturing a prepared contribution. Scientific
hashes and marker/timing derivation stay with the existing P3 primitives and P7
master compiler. Historical v1 and current location/content v2 keep their meaning.

## Verification

`test/research-planner-authoring-p3.test.js` checks every registered field and
operation, detached readback, internal exact raw restore, invalid/used/stale
rejection, ordered create-then-reference batches, incomplete-draft repair,
notification-free commit and actual owner-event parity. Multi-owner tests hold
a later owner in staging while GUI edit/revert, dependency withdrawal, reset,
restore, disposal or cancellation invalidates P3 before either owner commits.
Both contribution generations retain exact compiler bytes.

`scripts/qualification/planner-p3-cli.mjs <browser.exe> <new-output-dir>
[1280|800] [populated|actions|invalid]` runs the actual Planner UI and shared
command session. Its fixture compares all fourteen operations against real
controls, exact raw fields and compiled contribution/occurrence identities.
It records an operation trace, source/harness/browser/PNG hashes and resulting
contribution. Synthetic P1 declarations are explicitly labelled; these checks
are not native media, named OS-picker or Runner execution evidence. Final clean
receipts and regression counts are recorded in the P3 message-board entry.

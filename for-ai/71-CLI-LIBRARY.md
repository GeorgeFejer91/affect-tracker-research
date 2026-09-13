# Maintained Planner CLI library

## SurveyJS import extension — 2026-09-13

`importQuestionnaire` now also accepts raw SurveyJS builder/Node-generated JSON
or the saved SurveyJS definition wrapper. Operation arguments and native path
grants are unchanged. Create the pristine family/language slot first, then call
`saveQuestionnaire` to persist its canonical wrapper. `P2.questionnaires` exposes
`kind:surveyjs` drafts; title/version edits remain available and full survey
content changes use import. Final capture chooses P2 v3/master v4 when needed.
See [the public workflow and CLI examples](../docs/surveyjs-questionnaires.md).
The consolidated About/CLI library must link this page; About is absent from
this feature branch's base and remains owned by the integration task.

## User requirement — 2026-09-12

Maintain a dedicated **About → CLI library** on the GitHub Pages site and a
matching agent reference in `for-ai`. This is a continuing product requirement,
not a one-time command example. This file owns the maintenance checklist and
agent entry point; the public About reference owns the readable command library.
The actual registered command descriptors and validators remain authoritative.

This allocation extends [68](68-PLANNER-CLI.md) and the active
[CLI/UI/Runner goal](69-CLI-RUNNER-END-TO-END-GOAL.md). It adds documentation,
not another CLI, JSON schema, public network endpoint or qualification claim.

## Where to look before changing a command

| Reference | Responsibility |
| --- | --- |
| [Shared command API](../docs/planner-authoring-command-api-v1.md) | JSONL envelopes, session/revision identity, typed edits, bounded transport, errors and retry semantics |
| [Consequential commands](../docs/planner-cli-consequential-commands-v1.md) | Exact public file/import/confirmation operation names and arguments; implementation status |
| [Master JSON](../docs/planner-master-recipe-v1.md) | Complete saved sections, policy, canonical bytes and reconstruction |
| [Public About reference](../site/about/index.html) | User-facing CLI library and examples; allocated to Online Version, awaiting integration |
| `site/src/research/planner-authoring-{p1,p2,p3,p4,p5,p6,p7}.js` | Owner descriptors, validation and UI-backed setting semantics |
| [External verification driver](../scripts/qualification/planner-cli-driver.mjs) | Production-process command/transcript evidence; not a replacement authoring implementation |

At this checkpoint the shared/owner documents and adapters are collected in the
integration worktree; the About surface is being implemented. Links become part
of the same integrated tree before publication. A link to a planned surface is
not evidence of deployment. Do not retain machine-specific worktree paths as the
permanent public documentation interface.

## Segment map: settings, user inputs and JSON results

| Owner | User or CLI inputs | Saved result and boundaries |
| --- | --- | --- |
| P1 — work directory and videos | Study ID/title; explicit directory selection, file/folder import and rescan | `segments.P1`: study, portable logical workspace layout, actual verified video locations, byte identities and media geometry. Absolute native grants and current readiness are not serialized. Media facts are read-only. |
| P2 — questionnaires and languages | Languages, questionnaire families/items/options/codes, source import/save, module order, language routes and label repetition | `segments.P2`: complete definitions, provenance, scoring values, modules, participant language tree and presentation. Languages are extensible beyond EN/DE. See [P2 commands](../docs/planner-authoring-p2.md). |
| P3 — versions and intervals | Named ISI durations, version columns and ordered video/ISI cells; table paste and stable-ID list edits | `segments.P3`: complete variants, occurrences, named ISI dictionary and planned marker profiles bound to P1 identity. Actual observed LSL timestamps belong to Runner execution. Read generated IDs from the actual reply. See [P3 commands](../docs/planner-p3-cli-authoring.md). |
| P4 — desktop arrangement | Viewport, optional physical calibration, explicit fixed-reference method, units, video reference box and feedback centre offsets/size/gap | `segments.P4`: accepted desktop layout and source-bound reference geometry. All videos share the fixed reference; camera inspection is not a recipe setting. See [P4 commands](../docs/planner-authoring-p4.md). |
| P5 — Flubber/live feedback and input | Input preset/binding, renderer, response grid/timing, appearance, labels, halo and animation mappings | `segments.P5`: complete feedback v2 including retained inactive alternatives. Disabled legacy compatibility fields stay read-only. P4/P6 own experiment placement. See [P5 commands](../docs/planner-authoring-p5.md). |
| P6 — optional XR design | Explicit inclusion/exclusion, world-fixed spatial pose/dimensions, feedback offsets and supported angular-size conversion | `segments.P6`: excluded marker or complete XR profile. Design support is separate from qualified XR execution. See [P6 commands](../docs/planner-authoring-p6.md). |
| P7 — final review and export | Participant-count metadata, sampling/output/LSL policy, ordered confirmations, open and fresh save | Root `policy`, target, identity and integrity assemble all six complete sections. P7 is the assembler, not an extra `segments.P7` payload. Runner recording/session selections remain separate. |

## How to discover and call the CLI

The supported native ingress is `affect-planner-cli jsonl`. Each invocation owns
a hidden Planner process and a fresh session. It does not control an already open
GUI. GitHub Pages documents the native CLI; opening the static page does not
start a local executable or grant filesystem access.

Wait for the ready receipt, then send one JSON object per line. Use its actual
`sessionId`, a caller-generated UUID `requestId`, and the latest returned
revision for each mutation. Queries use `expectedRevision: null`.

```json
{
  "schema": "affect-research-planner-command",
  "version": 1,
  "sessionId": "<actual ready-session UUID>",
  "requestId": "<new caller UUID>",
  "expectedRevision": null,
  "action": { "kind": "catalogue" }
}
```

The placeholders above must be replaced; they are not accepted UUIDs. Send the
resulting envelope on one line. `catalogue` returns registered setting descriptors
and owner operations, including types, ranges/units, labels and writability.
`snapshot` returns current owner values/issues; `get` takes a `field`; `validate`
takes an owner ID or `null` for all owners. Inspect the catalogue of the actual
executable rather than assuming a newer source document is installed.

The following are **action bodies**, used inside that same envelope:

```json
{"kind":"get","field":"P7.participantCount"}
{"kind":"set","field":"P7.participantCount","value":1}
{"kind":"apply","edits":[{"kind":"set","field":"P7.output.csv","value":true},{"kind":"set","field":"P7.output.tsv","value":false}]}
{"kind":"validate","owner":null}
```

`set` and `apply` require the current revision. Owner list operations are edits
inside `apply`, shaped `{kind:"operation",owner,operation,arguments}`. They use
registered stable IDs, not DOM selectors or arbitrary JSON paths. Values may
remain an incomplete draft with reported issues; successful editing alone does
not confirm a segment or authorize export.

Consequential actions have exactly `{kind:"perform",operation,arguments}` and
run separately from atomic edits. The frozen public operations are
`selectWorkspace`, `importVideos`, `importVideoFolder`, `rescanVideoLibrary`,
`importQuestionnaire`, `saveQuestionnaire`, `confirmSegment`, `saveRecipe` and
`openRecipe`. Consult the consequential command document for exact arguments
and current availability. Internal opaque grant arguments are not the public
absolute-path CLI interface. Do not publish them as interchangeable forms.

## Open, edit and save a new version

Select a real work directory; create language/questionnaire slots before import;
import actual video and questionnaire files; save questionnaire sources; author
the settings and chronology; resolve validation issues; confirm P1, P2, P3, P4
and P6 in the existing order; then save through P7, which captures the current
P5 Live Preview settings. P5 has no independent confirmation action: the
registered `confirmSegment` vocabulary reports that final-capture requirement
explicitly for P5. Reopening restores editable content but
requires fresh media binding/preparation before it is ready to run or re-export.

Every export creates a new timestamped file. The implemented shared naming form
is `recipeId_YYYY-MM-DD_HH-mm-ss-SSSZ.json`, with `_001` through `_999` collision
suffixes as needed. UTC filename time does not alter canonical recipe content
or scientific identity. Use the returned **actual basename and save receipt**,
not a locally guessed clock time. Native save refuses replacement; browser save
has the documented weaker filesystem concurrency guarantee. A changed recipe
must preserve the earlier JSON file. The timestamp is a version naming aid,
not a replacement for content integrity or provenance.

Results contain schema/version, session/request identity, status, revision,
result and issues. Queries use `ok`; edits can be `applied` or `incomplete`;
`rejected` and `canceled` require inspection of the issues and any effect receipt.
An already written file is not rolled back by late cancellation or stale editor
adoption. Never blindly repeat an uncertain native write with a fresh request
identity. The shared API defines retained-request reconciliation and shutdown.

## Evidence and current limits

Root independently ran eight commands against native CLI source `680842a` and
verified all nine P7 policy readbacks, invalid/read-only rejection and clean EOF.
A later actual native `23e8f3a` run captured 155 settings/32 owner operations and
verified one seven-owner draft batch with readback and rejection/EOF checks.
The exact executable/transcript identities and captured catalogue are recorded
in [69](69-CLI-RUNNER-END-TO-END-GOAL.md). This establishes a seven-owner native
smoke, not every field or native import/file action. Browser parity has separate
source-bound receipts. Consequential operations are being integrated. The full
bilingual mock export, new typed demographics asset and XDF reconstruction
requirement, and actual Runner correspondence
remain open. Never infer their completion from the documentation or catalogue.

The external driver also supports a synchronous programmatic action resolver,
`action({ready, revision, lastResponse})`, so later steps can use actual generated
row IDs and returned filenames. It exposes detached validated replies and sends
the resolved action unchanged. Eight driver subprocess tests pass; their synthetic
children validate the driver only. JSON action files remain static, and the
driver imports no editor, media fixture or master compiler.

The requested authoring sequence is implemented as an external verification
driver in `scripts/qualification/planner-mock-experiment.mjs`. It consumes a
local configuration with `executable`, `expectedCommit`,
`expectedExecutableSha256`, a new empty `workspace`, new `evidenceDirectory`
and `scratchDirectory`, `video:{path,sha256}` and four
`questionnaires:[{path,sha256,familyId,language}]` entries. These configuration
paths are local verification inputs, never publicly shipped examples or recipe
fields. Usage: `node scripts/qualification/planner-mock-experiment.mjs <config.json>`.
The supplied production executable must include core9, typed P2 and master-v2
composition. The script verifies those descriptors before dispatching mutations.

It selects the workspace, imports the actual video/four questionnaire sources,
adds shipped EN/DE demographics, saves six sources, authors both language routes
and named ISI chronology, sets layout/Flubber/input/policy, then saves, reopens,
changes participant count and saves a second timestamped version. IDs and
basenames come from actual command readback. Only `saveRecipe` writes master
files; the script compares their bytes and semantics with authored inputs and
preserves earlier versions. Any unexpected command result or unknown timeout
stops the driver without repeating native work. It does not run the Runner.

This script is prepared, not yet production-executed. Ten focused driver/
comparison tests pass, including counterexamples with unchanged item counts but
wrong event/language order, video identity, layout, input, renderer, XR or LSL
policy. Those are driver checks only. Actual command/JSON/Runner evidence must
replace this pending status before E2E-RECIPE can be completed.

## Maintenance checklist for every segment pass

- [ ] Read this reference and the assigned segment's contract before editing.
- [ ] For each changed setting/operation, update its actual descriptor, argument
  constraints, units, default/initialization policy, UI counterpart, saved JSON
  contribution, invalidation and failure behavior in the same pass.
- [ ] Update the public About CLI library from that same source. Generate the
  inventory or compare it against owner descriptors; fail the documentation drift
  check for missing, extra or mismatched commands. Avoid a second manual inventory.
- [ ] Record status separately: declared interface, owner-tested, integrated,
  actual native CLI-verified, UI-verified and complete-recipe/Runner-verified.
  Bind verification to source/executable and artifact receipts.
- [ ] Keep examples executable for their declared status. Use returned IDs,
  current revisions and actual save basenames; never include personal machine
  paths, credentials, participant data or restricted questionnaire item text in
  the public reference.
- [ ] Verify changed links and catalogue freshness; inspect rendered wide/narrow
  About pages when markup/layout changes. Retain the receipt with the handoff.
- [ ] Update this entry point if ownership, document locations or workflow change.
  Route shared changes through main integration; other segment owners update only
  their allocated command metadata/docs and report dependencies in [55](55-AGENT-MESSAGE-BOARD.md).
- [ ] Before publishing, verify the deployed About page corresponds to the
  integrated documentation source. A successful local build is not deployment.

Online Version owns the new public About surface; Chat Orchestrator owns this
maintenance reference; segment owners own command semantics; main integration
owns combined catalogue/registration and final publication coordination. These
allocations preserve the single-editor and single-master-compiler boundaries.

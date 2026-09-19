# Current project entrypoint

Updated 2026-09-13; audit base `32c7c2d`. This is the current instruction
router. Historical receipts retain their original source and date.

File-size policy follows the [2026-09-13 charter amendment](15-RESEARCH-V1-CHARTER.md#file-size-guidance-amendment--2026-09-13):
arbitrary whole-file ceilings are no longer requirements. Historical implemented
limits do not instruct agents to retain or reinstate them.

Versioning policy follows the [2026-09-13 current-canonical amendment](15-RESEARCH-V1-CHARTER.md#current-canonical-versioning-amendment--2026-09-13):
Git worktree/branch commits and authorized GitHub history retain older states.
Do not add local schema/document generations for ordinary internal design
iteration; update the current canonical contract unless an external saved-file,
wire, Runner or fixture compatibility boundary truly requires a version.

## Current vs historical files

Future agents should spend their attention on current owners, not on reconciling
every dated receipt. Use this folder as follows:

| Role | Files | How to use |
| --- | --- | --- |
| Current router | `00` | Start here; follow only the routed files for the task. |
| Product authority | `15`, plus `16` for the companion split | These own the current product decisions. Later dated amendments in `15` supersede older wording lower in the same file. |
| Workflow and gates | `30`, `50` | Use for pass stage, evidence floor, launch/push handoff and release boundaries. |
| Current owner maps | `60`, `65`, `66`, `68`, `69`, `71`, `72`, `73` | Read the relevant owner/consumer ledger for the assigned work. |
| Architecture and provenance | `20`, `70`, relevant `docs/` contracts | Read when changing authority boundaries, contracts, dependencies or provenance. |
| Compact retired signposts | `45`, `61`, `62`, `64`, `67` | These are stubs only. Use Git history for their removed long-form content if an exact historical receipt is truly needed. |
| Coordination ledger | `55` | Read current and matching ownership entries before editing; older entries are diagnostic receipts, not standing instructions. |

Do not copy full amendment blocks into more files. Add the decision once to its
owner and link to it from dependent docs. If older copied wording conflicts with
`15`, `16`, `60`, `65`, `66`, `72` or direct user instructions, treat the copied
wording as historical unless the current owner explicitly re-adopts it.

Keep the active repository parsimonious. Do not add backup copies, superseded
architectures, old option matrices, duplicate ledgers, or local `vN` document
generations merely to preserve history. Git commits and pushed GitHub history
are the archive; the checked-out tree should contain current authority, live
contracts, active evidence, and compact signposts only. When retiring a large
historical document, either delete it or replace it with a short route to the
current owner and to Git history.

## Reading order

Read these core documents completely, in order: this file,
[15](15-RESEARCH-V1-CHARTER.md), [16](16-COMPANION-APP-BOUNDARY.md),
[30](30-TESTING-AND-RELEASE.md), [50](50-AGENT-WORKFLOW.md),
[60](60-SEGMENT-CATALOGUE.md), [66](66-PLANNER-RUNNER-COMPATIBILITY.md).
Then read the assigned owner's contract and applicable subtree instructions.

Before editing, read current and matching ownership entries in
[55](55-AGENT-MESSAGE-BOARD.md); consult older entries when they explain a
dependency or decision. This replaces repository directions to reread all
historical Markdown on every pass. Direct session instructions to read more
still take precedence.

## Product and authority

**Experiment Planner** and **Experiment Runner** are separate programs.
Planner UI and CLI author a canonical experiment manifest and questionnaire assets and retain previews.
Runner interprets that exact JSON, selects a session, executes the sequence,
acquires responses, emits LSL and records own/selected external streams to XDF.
Recording policy belongs to Runner sessions.

Current masters use `affect-research-planner-recipe` versions 1–5, with six
named contributions assembled by P7. Fresh master5 saves reference separate
SurveyJS files by ID, path and hash. P7 is not a seventh segment payload.
`ExperimentPackageV1` is a separate supported predecessor.
[66](66-PLANNER-RUNNER-COMPATIBILITY.md) maps versions, owners and known gaps.

The user's current instructions and dated charter amendments govern product
decisions; [60](60-SEGMENT-CATALOGUE.md) owns capability/checklist IDs.
Wire contracts in `docs/` and strict readers define exact representations.
A receipt proves only its named source, inputs and layer. Earlier wording does
not undo a later explicit amendment.

## Current status and work routes

Baseline Planner completion is summarized in [60](60-SEGMENT-CATALOGUE.md);
[67](67-PLANNER-COMPLETION-GOAL.md) is now only a retired signpost.
CLI and SurveyJS extend that baseline. Correspondence is now allocated by
[69](69-CLI-RUNNER-END-TO-END-GOAL.md) and
[72](72-RUNNER-FINAL-VALIDATION.md); blanket Runner deferral is historical.
Full native execution, geometry/timing and independent real-session XDF
verification remain open. Root owns current Runner closure; no delegation.
Do not reactivate historical owner tasks from old board assignments.

Determine source checkout/branch from Git. At audit start the canonical branch
was `codex/research-unified`. Verify actual-app source/binary hashes against
the receipt described in [73](73-CURRENT-APP-BUILD.md), independently of HEAD.
The [critical audit](../docs/planner-runner-correspondence-audit.md) records
current source gaps: owner-size limits, survey resource completeness, master4
validation availability and controller override execution.

| Work | Additional reading |
| --- | --- |
| Architecture / native authority | [20](20-ARCHITECTURE.md) and the relevant current wire contract |
| Planner composition / Open / Save | [Master](../docs/planner-master-recipe-v1.md), [restoration](../docs/planner-recipe-restoration.md), [P7](../docs/planner-p7-recipe-assembly.md) |
| Questionnaires / SurveyJS | [SurveyJS](../docs/surveyjs-questionnaires.md), [P2](../docs/planner-p2-questionnaire-recipe.md); [70](70-RESEARCH-PROVENANCE.md) for source/content changes |
| CLI | [68](68-PLANNER-CLI.md), [71](71-CLI-LIBRARY.md), registered descriptors and linked command contracts |
| Runner / recording | [65](65-RUNNER-SEGMENTS.md), [72](72-RUNNER-FINAL-VALIDATION.md), session/stream contracts |
| Optional XR authoring | [63](63-P6-XR-LAYOUT.md); desktop Runner cannot execute XR |
| Build / qualification | Relevant [40](40-ROADMAP.md) receipts, [72](72-RUNNER-FINAL-VALIDATION.md), [73](73-CURRENT-APP-BUILD.md) |
| Historical context | [05](05-PROJECT-METADATA.md), [10](10-PRODUCT-REQUIREMENTS.md), compact retired signposts [45](45-FUTURE-AGENT-CHECKLIST.md), [61](61-IMPLEMENTATION-AUDIT.md), [62](62-PLANNER-CLOSURE-PLAN.md), [64](64-SEGMENT-VISUAL-AUDIT.md), [67](67-PLANNER-COMPLETION-GOAL.md) |

The former copied entrypoint backup was removed from the active tree. Use Git
history for pre-cleanup text if an exact old router is needed.

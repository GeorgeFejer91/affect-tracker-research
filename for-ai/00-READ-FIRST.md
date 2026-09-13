# Current project entrypoint

Updated 2026-09-13; audit base `32c7c2d`. This is the current instruction
router. Historical receipts retain their original source and date.

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
Planner UI and CLI author one complete canonical JSON and retain previews.
Runner interprets that exact JSON, selects a session, executes the sequence,
acquires responses, emits LSL and records own/selected external streams to XDF.
Recording policy belongs to Runner sessions.

Current masters use `affect-research-planner-recipe` versions 1–4, with six
named contributions assembled by P7. P7 is not a seventh segment payload.
`ExperimentPackageV1` is a separate supported predecessor.
[66](66-PLANNER-RUNNER-COMPATIBILITY.md) maps versions, owners and known gaps.

The user's current instructions and dated charter amendments govern product
decisions; [60](60-SEGMENT-CATALOGUE.md) owns capability/checklist IDs.
Wire contracts in `docs/` and strict readers define exact representations.
A receipt proves only its named source, inputs and layer. Earlier wording does
not undo a later explicit amendment.

## Current status and work routes

Baseline Planner completion is recorded in [67](67-PLANNER-COMPLETION-GOAL.md).
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
| Historical context | [05](05-PROJECT-METADATA.md), [10](10-PRODUCT-REQUIREMENTS.md), [45](45-FUTURE-AGENT-CHECKLIST.md), [61](61-IMPLEMENTATION-AUDIT.md), [62](62-PLANNER-CLOSURE-PLAN.md), [64](64-SEGMENT-VISUAL-AUDIT.md), [67](67-PLANNER-COMPLETION-GOAL.md) |

The [old entrypoint](../docs/history/00-READ-FIRST-2026-09-13.md) is preserved
as historical evidence, not a competing current router.

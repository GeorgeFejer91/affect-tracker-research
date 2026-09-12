# Planner closure plan and future segment work

Updated 2026-09-12 against combined application
`875efae0a852bdcea978e8a12b74c0e81288d51c`.

The required Planner segments are implemented and have combined software
verification. Canonical source was delivered as
`1218c9ebef87111109d784bc2a9bf5827767917f`; the local native/frontend build
and exact artifact hash are recorded in 67. The former missing-editor design plan is
historical; do not restart those implementations. Source audit61 remains a dated
baseline, and Git history preserves the original design sketches.

[60-SEGMENT-CATALOGUE.md](60-SEGMENT-CATALOGUE.md) is the single capability and
decision checklist. [67-PLANNER-COMPLETION-GOAL.md](67-PLANNER-COMPLETION-GOAL.md)
records completion evidence. [64](64-SEGMENT-VISUAL-AUDIT.md) records rendered
checks. These documents distinguish Planner authoring from installed/physical
qualification and final Planner–Runner correspondence.

## Current segment contracts

| Owner | Implemented authoring and input | Complete master contribution / boundary |
| --- | --- | --- |
| P1 Workspace & Video Library | Select a workspace and videos, supply study identity, inspect/rescan the catalogue | Exact relative locations, reversible readable IDs, separate byte identity, duration and oriented geometry in `segments.P1`; Open needs fresh media authorization/rebind |
| P2 Questionnaires & Languages | Select languages, edit/paste/import items and options, labels/codes, instructions and presentation | Full definitions, module/language graph, scoring/provenance and hash-bound presentation in `segments.P2`; no source document needed to interpret the recipe |
| P3 Versions, Timing & Markers | Researcher-defined named ISIs and one Excel column per version | Exact ordered references/occurrences, dictionary, planned timelines and marker meaning in `segments.P3`; actual allocation/timestamps belong to Runner |
| P4 Screen & Layout | Explicit reference method, relative or calibrated physical sizes and centre offsets | Complete accepted profile and fit rules in `segments.P4`; one fixed reference and complete P1/P5 dependency geometry |
| P5 Flubber & Controls | Input bindings, Flubber/Grid/current procedural Face, colors/labels, halo, response and Advanced | Complete v2 input/visual/mappings/presentation/response in `segments.P5`; no transient test motion or second geometry authority |
| P6 Optional XR | Explicit inclusion, screen distance/size/angles/tilt, centre-relative feedback | Full world-fixed/head-forward profile in `segments.P6`, or explicit exclusion; inspection camera is transient and headset execution is later |
| P7 Review & Export | Target, authored policy, confirmation, naming, Save and Open | Strict master envelope, ordered P1–P6, integrity, exact save acknowledgement and coordinated editable restoration |

The exact wire contract is [planner-master-recipe-v1.md](../docs/planner-master-recipe-v1.md).
Its component contracts are [P2](../docs/planner-p2-questionnaire-recipe.md),
[P3](../docs/planner-p3-contribution-api.md),
[P4](../docs/planner-p4-layout-contract.md),
[P5](../docs/planner-p5-feedback-v2.md), [P6](63-P6-XR-LAYOUT.md) and
[P7 lifecycle](../docs/planner-p7-recipe-assembly.md). Preserve historical readers;
new meaning requires an explicit versioned contract.

## Remaining closeout and intentionally separate work

| Work | Owner | Required next action |
| --- | --- | --- |
| Canonical source and local artifact | Integration | Complete at `1218c9e`; exact source/native artifact and checks are recorded in 67. Publication or foreground launch remains separately requested work |
| Running roadmap/checklist | Root | Current 60/64/67 record delivered capabilities and precise evidence limits; future passes update only allocated items |
| Optional instrument content | P2, on researcher allocation | MAIA EN/DE content is present. TAS availability/rights and absent German content remain explicit; do not invent translations or equate catalogue entries with ready instruments |
| Optional scoring/placement extensions | P2/P3, on researcher allocation | Ask only concrete Q09 questions for newly requested computed scores, missing-answer rules or additional placements; current codes and before/after-session support are complete |
| Optional local preferences/draft recovery | P1/P7, on researcher allocation | Q05 absolute-root provenance/custom-root persistence and Q13 extra authoring-draft recovery are separate from the complete accepted master |
| Installed and physical qualification | Applicable platform owner | Preserve repository release gates for native DLL loading/resources, device input, accessibility and media playback; a linked build is not installed qualification |
| Runner implementation and correspondence | R1 under65/66 | Consume the full current master without dropping options, implement execution/recording in its separate program, then validate actual Planner–Runner correspondence as the last development stage |

No further blanket implementation task should be sent to idle segment owners.
A new defect or explicitly requested capability must identify its owner, precise
checklist ID, reproducible case, allowed files and acceptance evidence.

## Bounded future-pass checklist

1. Read the full project instructions and current catalogue; identify one segment.
2. State its function, added user input, JSON authority and the verified source.
3. Compare the requested capability with current code and exact evidence; do not
   treat dated baseline gaps or already fixed review findings as new work.
4. Allocate only the remaining slice. Send cross-segment dependencies to their
   owners and shared app/native composition changes to integration.
5. Verify successful, invalid and stale behavior appropriate to the change;
   inspect affected rendered states and repeat the complete JSON workflow when
   composition, persistence or owner contracts change.
6. Update the existing checklist and evidence, integrate through the sole owner,
   and preserve the distinction between a candidate, canonical source and an
   installed or remotely published product.

The user explicitly placed final Runner correspondence after Planner completion.
Do not keep this Planner goal open solely for execution, recording, headset or
physical experiment qualification, and do not claim those gates from Planner tests.

---
name: affect-chatdev-codex
description: Coordinate ChatDev-style parallel Planner and Runner development in Codex, with separate UI, function, recording, and packaging reviewers. Use for requested multi-agent or cross-app passes; ordinary single-segment edits follow the existing project workflow directly.
---

# Codex development team

Use Codex's available delegation and messaging tools for this workflow. A
separate ChatDev process, model key, or YAML run is not needed. The optional
ChatDev 2.0 graphs remain in `chatdev/` for users who explicitly choose that
runner. Follow [the project pass rules](../../50-AGENT-WORKFLOW.md),
[segment catalogue](../../60-SEGMENT-CATALOGUE.md), and
[Planner–Runner compatibility](../../66-PLANNER-RUNNER-COMPATIBILITY.md)
before dispatching work. Direct user instructions and project gates prevail.

## Assign work

The root agent writes the pass brief and both allocations in the message board
before dispatch: stage, one assigned P1–P7 segment for
Planner work, R1/RR IDs for Runner work, exact remaining checklist items,
allowed paths, shared contract, separate deliverables, and evidence now due.
Only allocate both owners when the task actually spans both apps. Each owner
uses its own `codex/segment-...` branch and isolated worktree. Owners read the
matching board entries and may record uniquely identified handoffs in their
own branches; root reconciles those entries at integration. Reserve shared app
source edits for the named integration owner. Do not send two writers to one
worktree or source file.

Delegate independent owner work in parallel when tools and slots are available:

| Role | Owns | Returns |
| --- | --- | --- |
| Planner owner | Assigned P segment and its named seams | Commit/patch, affected JSON contribution, tests and source evidence |
| Runner owner | Assigned R1/RR seam | Commit/patch, exact consumer behavior, tests and source evidence |

At their barrier, the root compares the two outputs against the same versioned
producer/consumer contract and sends any mismatch back to the relevant owner.
An owner must not silently repair the other app. Use direct agent messages for
specific dependencies; wait for both owner results before the next review wave.

## Verify in parallel

Assign independent read-only reviews after the owner patches exist. Run as
many concurrently as the current Codex session permits; queue remaining roles
without claiming that all ran at once.

| Reviewer | Checks |
| --- | --- |
| UI | Visible control and participant display behavior, keyboard/accessibility, bounded rendered Chrome/Edge checks, and missing installed observations |
| Function | Input validation, strict readers, deterministic output, JSON and JS/Rust producer/consumer parity, focused automated checks |
| Recording | Runner-owned sampling, observed timestamps, outbound LSL, own/external XDF, incomplete receipts, privacy and recovery gates |
| Packaging | Separate Planner/Runner entrypoints, Windows installer configuration and runtime provenance, static Chrome/Edge delivery, missing release gates |

Each reviewer labels its response `UI_VERIFY`, `FUNCTION_VERIFY`,
`RECORDING_GATE`, or `PACKAGING_GATE`; reports pass, fail, or not applicable;
names files/lines and actual receipts; and distinguishes code inspection from
executed, rendered, installed, or physical evidence. Missing reports block the
combined handoff. The root relays findings to the relevant owner for revision,
then rechecks the changed files. Reviewers may inspect existing installed and
packaging receipts but do not accept the current installation or release; root
owns those decisions. Reviewers do not edit owner patches.

## Integrate and report

The root is the integration owner. It checks ancestry, path separation,
contracts, combined tests and applicable app/build gates in the designated
integration worktree before promotion. Preserve the GitHub checkpoint and
record unresolved gates in the message board. Do not turn a proposed patch or
agent verdict into a qualification receipt.

Every owner/reviewer handoff includes role, segment/checklist IDs, branch and
worktree or inspected commit, touched paths, source-backed findings, checks
actually run, unresolved dependencies, and claim ceiling. If delegation is
unavailable, perform the same bounded roles sequentially and state that they
were sequential.

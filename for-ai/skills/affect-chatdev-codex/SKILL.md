---
name: affect-chatdev-codex
description: Coordinate ChatDev-style parallel work on the Experiment Planner, standard Runner, Flubber VLC Runner and FlubberRecorder in Codex. Use for requested multi-agent or cross-program passes; select only the specialist reviews the pass needs.
---

# Codex development team

Use Codex's delegation and messaging tools for this workflow. A separate
ChatDev process, model key, or YAML run is not needed. The optional ChatDev 2.0
graphs in `chatdev/` cover bounded one-segment and Planner/standard-Runner
passes; do not imply that they orchestrate all four programs. Follow
[the project pass rules](../../50-AGENT-WORKFLOW.md),
[segment catalogue](../../60-SEGMENT-CATALOGUE.md), and
[Planner–Runner compatibility](../../66-PLANNER-RUNNER-COMPATIBILITY.md)
before dispatching work. Direct user instructions and project gates prevail.

## Assign work

The root agent writes the pass brief and relevant allocations in the message
board before dispatch: stage, P1–P7 or R1/RR checklist IDs where applicable,
exact remaining items, allowed paths, shared contract, separate deliverables,
and evidence now due. Allocate only programs touched by the task. Each owner
uses its own `codex/segment-...` branch and isolated worktree. Owners read the
matching board entries and may record uniquely identified handoffs in their
own branches; root reconciles those entries at integration. Reserve shared app
source edits for the named integration owner. Do not send two writers to one
worktree or source file.

Delegate independent owner work in parallel when tools and slots are available:

| Role | Owns | Returns |
| --- | --- | --- |
| Planner owner | Assigned P segment and its named seams | Commit/patch, affected JSON contribution, tests and source evidence |
| Standard Runner owner | Assigned R1/RR seam and Windows WebView playback | Commit/patch, exact consumer behavior, tests and source evidence |
| Flubber VLC Runner owner | VLC playback seam within the same Runner recipe, LSL and XDF contract | Commit/patch, parity evidence and remaining installed gates |
| FlubberRecorder owner | Same-PC player control and its own installer, which also obtains the independently installable player | Commit/patch, pairing/control and package evidence |

At a shared-contract barrier, the root compares all affected outputs against
the same versioned producer/consumer contract and sends mismatches back to
their owners. Owners message peers directly when they change a consumed field,
event, playback endpoint or package dependency; include the contract, expected
behavior and source location, then acknowledge the resolution at the barrier.
An owner must not silently repair another program. Wait for all affected owner
results before the relevant review wave.

## Verify in parallel

Assign the relevant independent read-only reviews after owner patches exist.
One agent may cover related checks; run independent work concurrently up to the
session limit and queue the rest. These are responsibility domains, not standing
agents or mandatory roles for every pass.

| Reviewer | Checks |
| --- | --- |
| UI | Visible control and participant display behavior, keyboard/accessibility, bounded rendered Chrome/Edge checks and missing installed observations; use the [project Uncodixfy Pretext skill](../uncodixfy-pretext/SKILL.md) for text-bearing UI |
| Function and JSON | Input validation, strict master1–5 readers, deterministic output, JS/Rust producer/consumer parity and focused checks; use `for-ai/66` as the compatibility map |
| Recording | Shared Runner sampling and recording contract in both playback programs: observed timestamps, outbound LSL, own/external XDF, incomplete receipts, privacy and recovery gates |
| Packaging | Four separate Windows entrypoints/installers, player available alone and through Recorder, package contents, runtime provenance and missing release gates; use the Tauri Rust developer skill when available and changing Tauri packaging |
| Simplicity | Apply the Ponytail skill, when available, to a proposed design or patch if added code, dependencies or process are in question; name a smaller working alternative, if any |

Each assigned reviewer labels its response `UI_VERIFY`, `FUNCTION_JSON_VERIFY`,
`RECORDING_GATE`, `PACKAGING_GATE`, or `SIMPLICITY_VERIFY`; reports pass, fail,
or not applicable; names files/lines and actual receipts; and distinguishes
code inspection from executed, rendered, installed, or physical evidence. A
missing *assigned* report blocks its handoff. The root relays findings to the
relevant owner for revision, then rechecks changed files. Reviewers may inspect
installed and packaging receipts but do not accept installation or release;
root owns those decisions. Reviewers do not edit owner patches.

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

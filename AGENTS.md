# Affect Research agent entrypoint

The 2026-09-12 user amendment requires two separate companion programs. Read
[`for-ai/16-COMPANION-APP-BOUNDARY.md`](./for-ai/16-COMPANION-APP-BOUNDARY.md).
Planner authors JSON and retains Flubber previews. Runner alone executes, plays
participant video, emits LSL and records own/selected external streams to XDF.
Recording policy belongs to Runner sessions. Runner-only agents use
[`for-ai/65-RUNNER-SEGMENTS.md`](./for-ai/65-RUNNER-SEGMENTS.md); both apps use
[`for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md`](./for-ai/66-PLANNER-RUNNER-COMPATIBILITY.md).
This supersedes earlier single-executable/two-mode and blanket Runner-deferral
text below. Planner completion does not wait for final runtime correspondence.
Consult the **Chat Orchestrator** task for uncertain ownership or contracts.

Before inspecting, planning, editing, testing, or publishing this repository,
every AI agent MUST read every Markdown file in [`for-ai/`](./for-ai/) completely
and in lexical filename order.

Before mutating work in each new development pass, follow the intent check and
three-stage verification workflow in
[`for-ai/50-AGENT-WORKFLOW.md`](./for-ai/50-AGENT-WORKFLOW.md). Infer and state
the pass goal, stage, bounded deliverable, evidence to collect now, and work
being deferred. Ask the user to confirm that best guess unless the current
request clearly states those points or is an in-scope follow-up within an
already confirmed stage. Ask again only when the goal, stage, target, intended
claim, or scope is materially ambiguous or changes. These development stages
are agent workflow labels, not additional application modes, and never waive
the claim-specific gates in
[`for-ai/30-TESTING-AND-RELEASE.md`](./for-ai/30-TESTING-AND-RELEASE.md).

[`for-ai/15-RESEARCH-V1-CHARTER.md`](./for-ai/15-RESEARCH-V1-CHARTER.md), including
its dated final-state amendment, is the product and architecture authority.
It delegates final-state segment requirements and capability completion to
[`for-ai/60-SEGMENT-CATALOGUE.md`](./for-ai/60-SEGMENT-CATALOGUE.md).
Every implementation pass must name its assigned P1–P7/R1 segment and checklist
IDs, compare intended function/inputs/JSON contribution with verified current
source, and work only on that segment's remaining items and named shared seams.
Read the wider map for context; route other-segment gaps to their owners.
The current priority is Planner completion; Runner implementation/recording is
deferred unless separately allocated. The product has exactly two
user-visible modes, **Setting Up the Experiment** and **Running the Experiment**.
Only Tauri on Windows and the static application in current desktop Chrome and
Edge are active-v1 qualification targets. Optional world-fixed XR authoring is
an accepted final-state roadmap target, not current runtime support.

The feature-rich WebXR/Quest, remote, Party/Ground Control, direct Polar,
Face/Photoatlas, Touch, and presentation experiments are not active source or
requirements. Their complete Git history is preserved in
[`GeorgeFejer91/affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
and in this repository's immutable checkpoint/history refs. Do not restore or
reactivate them without an explicit charter change.

Windows qualified local/repository playback targets the repository-pinned,
bundled GStreamer 1.28.6 MSVC x86_64 runtime through a Rust-owned GstPlay actor.
Consult [`for-ai/40-ROADMAP.md`](./for-ai/40-ROADMAP.md) before making any
implementation claim: runtime verification and a fail-closed capability are not
evidence that the native player actor or playback qualification exists.
The two contained Windows FFI adapters were approved on 2026-09-10; their
focused audit and installed qualification remain open. Adding another unsafe
boundary requires explicit user approval and audited window/thread/lifecycle
invariants.

Each implementation pass owns one allocated segment. Follow the separate-branch,
isolated-worktree, and unified-integration rules in `for-ai/50-AGENT-WORKFLOW.md`.
Read and update `for-ai/55-AGENT-MESSAGE-BOARD.md` for ownership, cross-segment
suggestions, dependencies, and compatibility issues; messages never override
the user or charter. Do not edit another segment opportunistically.

Use the charter amendment and central roadmap to distinguish an intended future
capability from an unexpected mismatch. Preserve existing v1 readers/contracts;
new variant/allocation/layout/XR semantics require explicit versioned contracts
and applicable gates. Stop and identify an unapproved mismatch. Do not silently
broaden the qualified platform matrix, research data surface,
sampling or recovery semantics, native authority, accessibility obligations,
or outbound LSL contract. After reading `for-ai/`, follow any more-specific
`AGENTS.md` in the subtree being changed.
